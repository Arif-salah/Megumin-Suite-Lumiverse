// ─────────────────────────────────────────────────────────────────────────────
// Backend: the half of the suite that runs in the Lumiverse server.
//
// The suite itself — the prompt engine, the background jobs, every tab — runs
// in the browser, exactly as it does in SillyTavern. This worker owns only what
// a browser cannot do:
//
//   1. Storage: settings and per-chat data, in spindle.storage.
//   2. Reading and writing the chat, characters and personas.
//   3. Sending generations: quiet ones for the background jobs, on the user's
//      connection or on Chomusuke's, and images through Lumiverse's own image
//      generation.
//   4. The prompt interceptor. Lumiverse runs it here, in the worker, but the
//      prompt engine lives in the browser with the profile and the World State,
//      so the interceptor hands the assembled messages to the browser, which
//      rewrites them the way SillyTavern's prompt event let it, and sends them
//      back.
//
// Rule for this file: no fetch. Lumiverse refuses to start a backend that makes
// raw network calls, and nothing here needs one — every outside request goes
// through a host API.
// ─────────────────────────────────────────────────────────────────────────────

import { handle, push, installRouter } from "./lumi/backend/rpc.js";
import {
    loadSettings, saveSettings, loadMetadata, saveMetadata,
    getActiveChatId, trackActiveChat,
} from "./lumi/backend/store.js";
import {
    comfyPing, comfyModels, comfySamplers, comfyLoras,
    listWorkflows, readWorkflow, saveWorkflow, deleteWorkflow,
    queuePrompt, promptHistory, fetchImage,
} from "./lumi/backend/comfy.js";

const LOG = "[Megumin Suite]";

// -------------------------------------------------------------
// Settings and chat data
// -------------------------------------------------------------

handle("settings:load", (_data, userId) => loadSettings(userId));
handle("settings:save", ({ settings }, userId) => saveSettings(settings, userId));

handle("metadata:load", async ({ chatId }, userId) => loadMetadata(chatId || await getActiveChatId(userId), userId));
handle("metadata:save", async ({ chatId, metadata }, userId) => {
    if (!chatId) return;
    await saveMetadata(chatId, metadata, userId);
});

// -------------------------------------------------------------
// Chat context
// -------------------------------------------------------------

// Who {{user}} is. Asked of the host's own macro engine first: {{user}} is a
// Lumiverse built-in, so that is by definition the answer the host gives
// everywhere else. The persona record is still read for its description.
async function resolvePersona(chatId, userId) {
    let name = null;
    try {
        const result = await spindle.macros.resolve("{{user}}", { chatId, userId, commit: false });
        const text = String((result && result.text) || "").trim();
        if (text && text !== "{{user}}") name = text;
    } catch (e) { /* fall back to the persona record */ }

    let record = null;
    try {
        record = await spindle.personas.getActive(userId) || await spindle.personas.getDefault(userId);
    } catch (e) { /* no persona */ }

    return {
        name: name || (record && record.name) || "You",
        description: (record && record.description) || "",
    };
}

handle("context:load", async (_data, userId) => {
    const chatId = await getActiveChatId(userId);
    const chat = chatId ? await spindle.chats.get(chatId, userId).catch(() => null) : null;
    if (!chat) return { chatId: null, messages: [], character: null, userName: "You", persona: "" };

    const [messages, character, persona] = await Promise.all([
        spindle.chat.getMessages(chat.id).catch(() => []),
        chat.character_id ? spindle.characters.get(chat.character_id, userId).catch(() => null) : null,
        resolvePersona(chat.id, userId),
    ]);

    return {
        chatId: chat.id,
        chatName: chat.name || null,
        messages,
        character: character ? {
            id: character.id,
            name: character.name || "",
            description: character.description || "",
            personality: character.personality || "",
            scenario: character.scenario || "",
            mes_example: character.mes_example || "",
            first_mes: character.first_mes || "",
            // The settings window's banner. Lumiverse serves avatars from its
            // own route rather than SillyTavern's /characters/<file>.
            avatarUrl: `/api/v1/characters/${encodeURIComponent(character.id)}/avatar?size=lg`,
        } : null,
        userName: persona.name,
        persona: persona.description,
    };
});

// -------------------------------------------------------------
// Chat mutation
// -------------------------------------------------------------

handle("chat:updateMessage", async ({ chatId, messageId, content }, userId) => {
    const id = chatId || await getActiveChatId(userId);
    if (!id || !messageId) return;
    await spindle.chat.updateMessage(id, messageId, { content: String(content ?? "") });
});

handle("chat:appendMessage", async ({ chatId, message }, userId) => {
    const id = chatId || await getActiveChatId(userId);
    if (!id) return null;
    return spindle.chat.appendMessage(id, {
        role: message.role || "assistant",
        content: message.content || "",
        metadata: { source: "megumin_suite" },
    });
});

// -------------------------------------------------------------
// Generation
// -------------------------------------------------------------

// Image parts as the suite writes them (OpenAI's image_url with a data URL),
// turned into Lumiverse's { type: "image", data, mime_type }.
function toHostMessages(messages) {
    return (messages || []).map((m) => {
        if (!Array.isArray(m.content)) return m;
        const parts = m.content.map((p) => {
            if (p && p.type === "image_url" && p.image_url && typeof p.image_url.url === "string") {
                const match = p.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
                if (match) return { type: "image", mime_type: match[1], data: match[2] };
                return { type: "text", text: "" };
            }
            return p;
        });
        return { ...m, content: parts };
    });
}

// The background jobs' prompts end with a system message (the thinking
// instructions). SillyTavern's request pipeline smooths that over for most
// APIs; sent as is, some providers never answer a conversation whose last turn
// is a system message (NanoGPT held it until the connection was cut). Trailing
// system messages go as the user's turn instead.
function endOnTurn(messages) {
    const out = messages.slice();
    for (let i = out.length - 1; i >= 0 && out[i].role === "system"; i--) {
        if (i === 0) break;   // a prompt that is nothing but system text
        out[i] = { ...out[i], role: "user" };
    }
    return out;
}

// The answer's text, as SillyTavern's quiet generation returns it. Lumiverse
// hands reasoning back separately; a model that writes its thinking inline
// leaves <think> in the content, and the suite strips that itself.
function answerText(result) {
    return String((result && result.content) || "");
}

// The connection the story is on, per user: the one the last real generation
// used, as the interceptor saw it. SillyTavern's quiet prompt goes to the
// connection the story is using; Lumiverse's quiet generation would otherwise
// go to the user's DEFAULT connection, which need not be the same one.
const storyConnection = new Map();
const userKey = (userId) => userId || "__self__";

// `think`: let the model reason the way the user set it up. Off by default
// for the suite's background jobs, which are asked for LOW reasoning effort
// instead: their prompts carry their own thinking steps, and a reasoning model
// on the user's own effort thought for minutes over a long job (an NPC scan
// over 60 messages) until the provider dropped the connection. Turning
// reasoning off outright is worse on some models: GLM 5.3 still reasoned,
// invisibly, and spent the whole answer on it. Low effort answered a scan in
// about 20 seconds.
handle("generate:quiet", async ({ messages, connectionId, think }, userId) => {
    if (!Array.isArray(messages) || !messages.length) return { content: "" };
    const request = { messages: endOnTurn(toHostMessages(messages)), userId };
    connectionId = connectionId || storyConnection.get(userKey(userId)) || null;
    if (connectionId) request.connection_id = connectionId;
    if (think !== true) request.reasoning = { source: "custom", apiReasoning: true, effort: "low" };
    const started = Date.now();
    spindle.log.info(`${LOG} quiet generation: ${messages.length} messages${connectionId ? ` on connection ${connectionId}` : ""}`);
    // Streamed. A non-streamed request waits for the whole answer on one open
    // connection, and providers cut those off after a few minutes (NanoGPT at
    // 5m41s): a long background answer from a slow model never arrived. A
    // stream keeps the connection busy the whole time.
    const send = async (req) => {
        if (typeof spindle.generate.quietStream !== "function") return answerText(await spindle.generate.quiet(req));
        let acc = "";
        for await (const chunk of spindle.generate.quietStream(req)) {
            if (chunk.type === "token") acc += chunk.token;
            else if (chunk.type === "done") acc = typeof chunk.content === "string" && chunk.content ? chunk.content : acc;
        }
        return acc;
    };
    let content = "";
    try {
        content = await send(request);
    } catch (e) {
        // A provider that refuses the reasoning override gets the request
        // once more on the user's own reasoning settings.
        if (!request.reasoning || (e && e.name === "AbortError")) throw e;
        spindle.log.warn(`${LOG} quiet generation failed with low reasoning effort (${(e && e.message) || e}); retrying on the connection's own settings.`);
        delete request.reasoning;
        content = await send(request);
    }
    spindle.log.info(`${LOG} quiet generation answered in ${Date.now() - started}ms (${content.length} chars)`);
    return { content };
});

handle("connections:list", async (_data, userId) => {
    const list = await spindle.connections.list(userId).catch(() => []);
    const story = storyConnection.get(userKey(userId));
    const active = list.find((c) => c.id === story) || list.find((c) => c.is_default) || null;
    return {
        connections: list.map((c) => ({ id: c.id, name: c.name, provider: c.provider, model: c.model })),
        activeId: active ? active.id : "",
    };
});

// -------------------------------------------------------------
// Images
// -------------------------------------------------------------

handle("imagegen:connections", async (_data, userId) => {
    const list = await spindle.imageGen.listConnections(userId).catch(() => []);
    return list.map((c) => ({ id: c.id, name: c.name, provider: c.provider, model: c.model, is_default: c.is_default }));
});

handle("imagegen:generate", async ({ chatId, prompt, negativePrompt, connectionId, parameters, wantDataUrl }, userId) => {
    const id = chatId || await getActiveChatId(userId);
    const chat = id ? await spindle.chats.get(id, userId).catch(() => null) : null;
    const request = {
        prompt: String(prompt || ""),
        includeDataUrl: Boolean(wantDataUrl),
        userId,
    };
    if (connectionId) request.connection_id = connectionId;
    if (negativePrompt) request.negativePrompt = String(negativePrompt);
    if (parameters && Object.keys(parameters).length) request.parameters = parameters;
    if (id) request.owner_chat_id = id;
    if (chat && chat.character_id) request.owner_character_id = chat.character_id;

    const result = await spindle.imageGen.generate(request);
    const url = (result && (result.imageUrl || result.mediaUrl)) || "";
    if (!url && !(result && result.imageDataUrl)) throw new Error("The image generator returned no image.");
    return {
        url,
        dataUrl: wantDataUrl ? (result.imageDataUrl || null) : undefined,
        imageId: result.imageId || null,
        provider: result.provider,
        model: result.model,
    };
});

handle("media:saveBase64", async ({ chatId, base64, filename, extension }, userId) => {
    const mime = extension === "jpeg" || extension === "jpg" ? "image/jpeg" : "image/png";
    const dataUrl = String(base64).startsWith("data:") ? String(base64) : `data:${mime};base64,${base64}`;
    const id = chatId || await getActiveChatId(userId);
    const stored = await spindle.images.uploadFromDataUrl(dataUrl, {
        originalFilename: `${filename || "megumin"}.${extension || "png"}`,
        owner_chat_id: id || undefined,
        userId,
    });
    if (!stored || !stored.url) throw new Error("Image upload returned no URL");
    return stored.url;
});

// -------------------------------------------------------------
// ComfyUI
// -------------------------------------------------------------
//
// The Images tab's ComfyUI side (the SillyTavern way: an address, workflows,
// model / sampler / LoRA lists). A browser cannot reach ComfyUI, so every
// request comes here and goes out through spindle.cors (lumi/backend/comfy.js).

handle("comfy:ping",     ({ url }) => comfyPing(url));
handle("comfy:models",   ({ url }) => comfyModels(url));
handle("comfy:samplers", ({ url }) => comfySamplers(url));
handle("comfy:loras",    ({ url }) => comfyLoras(url));

handle("comfy:workflows",      (_d, userId) => listWorkflows(userId));
handle("comfy:readWorkflow",   ({ name }, userId) => readWorkflow(name, userId));
handle("comfy:saveWorkflow",   ({ name, workflow }, userId) => saveWorkflow(name, workflow, userId));
handle("comfy:deleteWorkflow", ({ name }, userId) => deleteWorkflow(name, userId));

handle("comfy:queue",   ({ url, workflow, clientId }) => queuePrompt(url, workflow, clientId));
handle("comfy:history", ({ url, promptId }) => promptHistory(url, promptId));
handle("comfy:image", async ({ url, filename, subfolder, type, chatId }, userId) => {
    const id = chatId || await getActiveChatId(userId);
    const chat = id ? await spindle.chats.get(id, userId).catch(() => null) : null;
    return fetchImage(url, { filename, subfolder, type, chatId: id, characterId: (chat && chat.character_id) || null, userId });
});

// -------------------------------------------------------------
// Lorebooks
// -------------------------------------------------------------
//
// The background jobs replace the whole prompt with their own, so the World
// Info the story activated never reaches them. SillyTavern lets the suite ask
// for it; here the interceptor remembers what the last real generation in each
// chat activated, and the jobs read that.

const activeLore = new Map();

function loreEntries(context) {
    const list = Array.isArray(context && context.activatedWorldInfo) ? context.activatedWorldInfo : [];
    return list.map((e) => ({
        content: String((e && (e.content ?? e.entry?.content)) || ""),
        key: [].concat((e && (e.key ?? e.keys ?? e.entry?.key)) || []),
        keysecondary: [].concat((e && (e.keysecondary ?? e.secondary_keys ?? e.entry?.keysecondary)) || []),
        comment: String((e && (e.comment ?? e.name ?? e.entry?.comment)) || ""),
    })).filter((e) => e.content.trim());
}

handle("lore:active", async ({ chatId }, userId) => {
    const id = chatId || await getActiveChatId(userId);
    return { entries: (activeLore.get(id) || []).map((e) => e.content) };
});

handle("lore:entries", async ({ chatId }, userId) => {
    const id = chatId || await getActiveChatId(userId);
    return activeLore.get(id) || [];
});

// -------------------------------------------------------------
// Toasts
// -------------------------------------------------------------

// Lumiverse already heads every toast with the extension's name, so a title
// that only repeats it is dropped ("Megumin Suite: Megumin Suite").
handle("toast", ({ level, message, title }) => {
    const fn = spindle.toast[level] || spindle.toast.info;
    const t = title && !/^megumin suite$/i.test(String(title).trim()) ? String(title).replace(/^Megumin Suite\s*[—-]\s*/i, "") : "";
    fn(String(message || ""), t ? { title: t } : undefined);
});

// -------------------------------------------------------------
// The interceptor
// -------------------------------------------------------------
//
// The browser builds the prompt: it has the profile, the chat's World State and
// the Chomusuke queue. The request goes out as a push, and the browser answers
// in two steps — an acknowledgement at once, then the messages. No
// acknowledgement within a few seconds means no browser is running the suite
// (the tab is closed, the frontend failed to load), and the prompt goes out
// unmodified rather than holding the generation for the full timeout.

const ACK_TIMEOUT_MS = 4000;
const BUILD_TIMEOUT_MS = 280000;
const builds = new Map();
let nextBuild = 1;

handle("prompt:ack", ({ reqId }) => {
    const entry = builds.get(reqId);
    if (entry) entry.ack();
});

handle("prompt:built", ({ reqId, messages, error }) => {
    const entry = builds.get(reqId);
    if (!entry) return;
    builds.delete(reqId);
    entry.done(error ? null : messages);
});

function askFrontendToBuild(payload, userId, signal) {
    const reqId = `${Date.now()}-${nextBuild++}`;
    return new Promise((resolve) => {
        let timer = null;
        const finish = (value) => {
            clearTimeout(timer);
            builds.delete(reqId);
            resolve(value);
        };
        builds.set(reqId, {
            ack: () => {
                clearTimeout(timer);
                timer = setTimeout(() => finish(null), BUILD_TIMEOUT_MS);
            },
            done: finish,
        });
        timer = setTimeout(() => finish(null), ACK_TIMEOUT_MS);
        if (signal) signal.addEventListener("abort", () => finish(null), { once: true });
        push("prompt:build", { reqId, ...payload }, userId);
    });
}

spindle.registerInterceptor(async (messages, context) => {
    try {
        const userId = context && context.userId;
        const chatId = (context && context.chatId) || await getActiveChatId(userId);
        if (!chatId) return messages;

        if (context && context.connectionId && context.generationType !== "quiet") {
            storyConnection.set(userKey(userId), context.connectionId);
        }

        const lore = loreEntries(context);
        activeLore.set(chatId, lore);

        // Plain strings for the browser; anything multimodal already in the
        // prompt (an attached image) is kept by index and put back after.
        const plain = messages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : null,
        }));

        const started = Date.now();
        const built = await askFrontendToBuild({
            chatId,
            generationType: (context && context.generationType) || "normal",
            messages: plain,
        }, userId, context && context.signal);

        spindle.log.info(`${LOG} prompt ${Array.isArray(built) ? "built" : "left unmodified"} in ${Date.now() - started}ms`);
        if (!Array.isArray(built)) return messages;
        // The prompt preview was cancelled: SillyTavern's handler empties the
        // messages and stops the generation. Throwing from a required
        // interceptor is how a generation is stopped here.
        if (built.length === 0 && messages.length > 0) throw new Error("Generation cancelled in the prompt preview.");

        // Restore host metadata by original index, even after insertions or deletions.
        // Untouched multimodal messages keep their original content too.
        const restored = built.map((m) => {
            if (m && m.__keepIndex !== undefined) return messages[m.__keepIndex];
            if (!m) return m;
            const { __sourceIndex, ...edited } = m;
            const original = Number.isInteger(__sourceIndex) && __sourceIndex >= 0
                ? messages[__sourceIndex] : undefined;
            return original ? { ...original, role: edited.role, content: edited.content } : edited;
        }).filter(Boolean);

        return toHostMessages(restored);
    } catch (e) {
        if (e && /cancelled in the prompt preview/.test(e.message)) throw e;
        // Anything else: nothing here is worth costing the user their reply.
        spindle.log.error(`${LOG} Prompt build failed, sending the prompt unmodified: ${(e && e.message) || e}`);
        return messages;
    }
}, 50, requiredInterceptors() ? { required: true } : undefined);

// Required: a throw stops the generation (the cancelled preview) instead of
// sending the prompt anyway. Every other failure above returns the prompt
// unmodified, so being required never costs the user a reply.
function requiredInterceptors() {
    try { return (spindle.host && spindle.host.capabilities && spindle.host.capabilities["required-interceptors-v1"]) >= 1; }
    catch (e) { return false; }
}

// -------------------------------------------------------------
// Console aids (window.megumin.call("debug:...") in the browser)
// -------------------------------------------------------------

// The prompt Lumiverse would send for the open chat, interceptor included,
// without calling the model.
handle("debug:dryRun", async ({ generationType }, userId) => {
    const chatId = await getActiveChatId(userId);
    if (!chatId) return { error: "no chat open" };
    const result = await spindle.generate.dryRun({ chatId, generationType: generationType || "normal" }, userId);
    return {
        presetId: result.presetId || null,
        model: result.model,
        messages: (result.messages || []).map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : "[parts]",
        })),
    };
});

// -------------------------------------------------------------
// Which chat is open
// -------------------------------------------------------------

spindle.on("CHAT_SWITCHED", (payload, userId) => {
    trackActiveChat(userId ?? payload?.userId, payload?.chatId ?? null);
});

// -------------------------------------------------------------
// Boot
// -------------------------------------------------------------

// The block tags are taken out of rendered messages by the frontend's tag
// interceptors. Declaring it here keeps chat content hidden on a cold load
// until those are attached, so raw <Blocks> never flashes on screen.
try { spindle.frontendCapabilities.declare("message_tag_interceptor"); } catch (e) { /* older host */ }

installRouter();
spindle.log.info(`${LOG} backend ready`);
