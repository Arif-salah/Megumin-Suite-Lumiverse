// ─────────────────────────────────────────────────────────────────────────────
// Backend entry point — bootstrap only.
//
// Same rule index.js had in the SillyTavern build: this file wires things
// together and holds no feature logic. What changed is what "wiring" means. In
// SillyTavern the whole extension ran in the browser and index.js subscribed to
// host events. Here the extension is split, and this half owns the three things
// the browser cannot do:
//
//   1. Answer the frontend's RPCs (settings, metadata, chat, generation).
//   2. Run the pre-generation interceptor — the port of engine/injection.js.
//   3. Fire quiet generations for the background tasks (NPC scan, ban list,
//      story beats, image prompts).
//
// The interceptor is the reason the engine moved down here rather than staying
// with the UI. It is the only place the outgoing prompt can be rewritten, it
// runs in this worker, and it needs the profile — so the profile has to be
// readable here, which makes this side the source of truth and the browser a
// mirror of it.
// ─────────────────────────────────────────────────────────────────────────────

import { handle, push, installRouter } from "./backend/rpc.js";
import { enterEngine, resolvePersonaName, toEngineMessages } from "./backend/engine/context.js";
import { runTask } from "./backend/tasks.js";
import {
    comfyPing, comfyModels, comfySamplers, comfyLoras,
    listWorkflows, readWorkflow, saveWorkflow, deleteWorkflow,
    queuePrompt, promptHistory, fetchImage,
} from "./backend/comfy.js";
import { buildPromptMessages } from "./shared/engine/injection.js";
import { buildBaseDict } from "./shared/engine/buildBaseDict.js";
import {
    loadSettings,
    saveSettings,
    loadMetadata,
    saveMetadata,
    getActiveChatId,
    trackActiveChat,
} from "./backend/store.js";

// -------------------------------------------------------------
// Settings and metadata
// -------------------------------------------------------------

handle("settings:load", (_data, userId) => loadSettings(userId));

handle("settings:save", ({ settings }, userId) => saveSettings(settings, userId));

handle("metadata:load", async ({ chatId }, userId) => {
    return loadMetadata(chatId || await getActiveChatId(userId), userId);
});

handle("metadata:save", async ({ chatId, metadata }, userId) => {
    await saveMetadata(chatId || await getActiveChatId(userId), metadata, userId);
});

// -------------------------------------------------------------
// Chat context
// -------------------------------------------------------------
//
// Feeds getContext() in the frontend shim. The message array is the expensive
// part, so it is fetched here in one call rather than left to the UI to page
// through.

handle("context:load", async (_data, userId) => {
    // getActiveChatId(), not spindle.chats.getActive(). The host's own lookup
    // still names the last chat after the user returns to the lobby, and this
    // is what the settings window reads to draw its header — so calling it
    // directly is what kept the character's portrait on screen in the lobby and
    // kept edits saving into that character's profile.
    const chatId = await getActiveChatId(userId);
    const chat = chatId ? await spindle.chats.get(chatId, userId).catch(() => null) : null;

    if (!chat) {
        return { chat: [], chatId: null, characterId: null, characters: [], groupId: null, userName: "You", isGenerating: false };
    }

    const [messages, character, persona] = await Promise.all([
        spindle.chat.getMessages(chat.id).catch(() => []),
        chat.character_id ? spindle.characters.get(chat.character_id, userId).catch(() => null) : null,
        resolvePersonaName(chat.id, userId),
    ]);

    return {
        // `characters` is an array indexed by `characterId` because that is the
        // shape SillyTavern had and what the ported call sites index into. Only
        // the active character is ever in it — nothing in the ported code walks
        // the list, it only ever looks up the current one.
        // Mapped, not raw. Lumiverse messages carry { role, content }; every one
        // of the ~45 reads in the ported UI expects SillyTavern's
        // { mes, is_user, is_system }. Handing the raw array over meant .mes was
        // undefined everywhere — which is why the image pipeline reported no tags
        // on a reply that plainly had one, and why any chat-history scan saw an
        // empty transcript. The engine half already mapped; this half did not.
        chat: toEngineMessages(messages),
        chatId: chat.id,
        characterId: character ? 0 : null,
        characters: character
            ? [{
                ...character,
                // The hero banner wants a URL it can put in background-image.
                avatarUrl: `/api/v1/characters/${encodeURIComponent(character.id)}/avatar?size=lg`,
            }]
            : [],
        groupId: null,
        // Feeds substituteParamsLocal() in the host shim, which is what the
        // settings UI uses to preview a template. It has to agree with what the
        // interceptor sends the model, or the reader sees one name on screen and
        // the model is told another.
        userName: persona,
        isGenerating: false,
    };
});

// -------------------------------------------------------------
// Chat mutation
// -------------------------------------------------------------

// The ported call sites say updateMessageBlock(index, message), because
// SillyTavern addressed messages by position. Lumiverse addresses them by id, and
// wants its own field names back — so the id travels ON the message (kept by
// toEngineMessages) and the index is only a fallback for a caller that has one.
handle("chat:updateMessage", async ({ messageId, message }, userId) => {
    const chatId = await getActiveChatId(userId);
    if (!chatId) return;

    let id = (message && message.id) || null;
    if (!id && Number.isInteger(messageId)) {
        const all = await spindle.chat.getMessages(chatId).catch(() => []);
        id = all[messageId] && all[messageId].id;
    }
    if (!id && typeof messageId === "string") id = messageId;
    if (!id) return;

    await spindle.chat.updateMessage(chatId, id, { content: message.mes ?? message.content ?? "" });
});

handle("chat:appendMessage", async ({ message }, userId) => {
    const chatId = await getActiveChatId(userId);
    if (!chatId) return null;
    return spindle.chat.appendMessage(chatId, message);
});

// -------------------------------------------------------------
// Media
// -------------------------------------------------------------

// SillyTavern wrote the image to disk and handed back a path the message could
// reference. Lumiverse has an asset store, so it is uploaded and the stored URL
// comes back instead — the call sites only ever use the return value as
// something to point an <img> at, so a URL serves exactly as a path did.
//
// This runs AFTER comfy:image has already stored the picture, so a generated
// image is uploaded twice. That is deliberate for now: the second copy is what
// the caller has after its own optional JPEG compression, and threading the
// first upload's id through the ported compression path would mean editing code
// this port has otherwise left alone.
handle("media:saveBase64", async ({ base64, folder, filename, extension }, userId) => {
    const mime = extension === "jpeg" || extension === "jpg" ? "image/jpeg" : "image/png";
    const dataUrl = String(base64).startsWith("data:")
        ? String(base64)
        : `data:${mime};base64,${base64}`;

    const chatId = await getActiveChatId(userId);
    const chat = chatId ? await spindle.chats.get(chatId, userId).catch(() => null) : null;

    const stored = await spindle.images.uploadFromDataUrl(dataUrl, {
        originalFilename: `${filename || "megumin"}.${extension || "png"}`,
        owner_chat_id: chatId || undefined,
        owner_character_id: (chat && chat.character_id) || undefined,
        userId,
    });

    if (!stored || !stored.url) throw new Error("Image upload returned no URL");
    return stored.url;
});

// SillyTavern re-rendered a message's media strip after one was attached. Here
// the media lives on the message record, and the host redraws from that, so
// there is nothing to do — but the call site checks the function exists rather
// than whether it did anything, so it has to be answerable.
handle("chat:appendMedia", async () => null);

// -------------------------------------------------------------
// Macros
// -------------------------------------------------------------

// Only {{char}} and {{user}} are resolved, against the active chat's character.
// The host's own macro engine runs over the assembled prompt anyway, so anything
// richer than this would be resolved twice; the call sites here are labels and
// template previews in the settings UI, which is what these two cover.
// The settings UI's template previews. This one DOES go through the host's macro
// engine, because the text is whatever the reader typed and may use any macro
// Lumiverse supports — which is the opposite of the engine's own templates, full
// of internal {{tokens}} the host has never heard of. See the note on
// `substitute` in backend/engine/context.js for why the two paths differ.
//
// commit: false because this is a preview. Without it a macro with a side effect
// would fire every time the reader looked at the box.
handle("macros:substitute", async ({ text }, userId) => {
    if (!text) return text;

    const chatId = await getActiveChatId(userId);
    try {
        const result = await spindle.macros.resolve(text, { chatId, userId, commit: false });
        return (result && result.text) || text;
    } catch (e) {
        // A preview that cannot resolve is worth showing raw; blanking the field
        // would look like the template itself was empty.
        return text;
    }
});

// -------------------------------------------------------------
// Toasts
// -------------------------------------------------------------

handle("toast", ({ level, message, title }) => {
    const fn = spindle.toast[level] || spindle.toast.info;
    fn(message, title ? { title } : undefined);
});

// -------------------------------------------------------------
// Token estimate
// -------------------------------------------------------------
//
// Feeds the badge in the settings window's header. It lives here rather than in
// the browser because estimating means building the dictionary, and the
// dictionary builder is engine code.
//
// The categories and the 4.8-chars-per-token divisor are the originals. The
// excluded keys are the dynamic blocks whose size depends on the chat rather
// than on settings — counting them would make the badge jump around while the
// user is not changing anything.
const TOKEN_EXCLUDED_KEYS = new Set([
    "[[long-Memory]]", "[[Short-memory]]",
    "[[npc list]]", "[[npc_dossier]]", "[[npc_dossier2]]",
    "[[img1]]", "[[img2]]",
    "[[storyplan]]", "[[storytracker]]", "[[storytracker2]]",
    "[[banlist]]",
    // Both injection paths are built on every pass and only one of them ever
    // reaches the model, so counting both would roughly double the blocks. The
    // envelope is assembled FROM the per-block tags, which are counted above.
    "[[blocks]]",
]);

handle("tokens:estimate", async ({ profile }, userId) => {
    const chatId = await getActiveChatId(userId);
    const messages = chatId ? await spindle.chat.getMessages(chatId).catch(() => []) : [];
    // `profile` is what the settings window currently has on screen — see the
    // note on profileOverride in engine/context.js.
    const context = await enterEngine(chatId, messages, userId, profile || null);

    const dict = buildBaseDict(context, true);

    const buckets = { engine: "", cot: "", style: "", addons: "" };

    for (const [key, value] of Object.entries(dict)) {
        if (!value) continue;
        // Skip the single-bracket aliases to prevent double counting.
        if (/^\[prompt[1-6]\]$/.test(key)) continue;
        if (TOKEN_EXCLUDED_KEYS.has(key)) continue;

        if (["[[aiprompt]]", "[[config]]", "[[Language]]", "[[pronouns]]", "[[count]]", "[[DNRATIO]]", "[[onomato]]"].includes(key)) {
            buckets.style += value + " ";
        } else if (["[[COT]]", "[[prefill]]", "[[THINK]]"].includes(key)) {
            buckets.cot += value + " ";
        } else if (/^\[\[prompt[1-6]\]\]$/.test(key) || ["[[main]]", "[[AI1]]", "[[AI2]]"].includes(key)) {
            buckets.engine += value + " ";
        } else {
            buckets.addons += value + " ";
        }
    }

    const estimate = (text) => Math.ceil(text.replace(/\s+/g, " ").length / 4.8);

    return {
        engine: estimate(buckets.engine),
        cot: estimate(buckets.cot),
        style: estimate(buckets.style),
        addons: estimate(buckets.addons),
    };
});

// -------------------------------------------------------------
// Background tasks
// -------------------------------------------------------------

handle("task:run", ({ task, payload }, userId) => runTask(task, payload, userId));

// -------------------------------------------------------------
// ComfyUI
// -------------------------------------------------------------
//
// Every one of these exists because the browser cannot make the call itself —
// see backend/comfy.js.

handle("comfy:ping",       ({ url }) => comfyPing(url));
handle("comfy:models",     ({ url }) => comfyModels(url));
handle("comfy:samplers",   ({ url }) => comfySamplers(url));
handle("comfy:loras",      ({ url }) => comfyLoras(url));

handle("comfy:workflows",      () => listWorkflows());
handle("comfy:readWorkflow",   ({ name }) => readWorkflow(name));
handle("comfy:saveWorkflow",   ({ name, workflow }) => saveWorkflow(name, workflow));
handle("comfy:deleteWorkflow", ({ name }) => deleteWorkflow(name));

handle("comfy:queue",   ({ url, workflow, clientId }) => queuePrompt(url, workflow, clientId));
handle("comfy:history", ({ url, promptId }) => promptHistory(url, promptId));
handle("comfy:image", async ({ url, filename, subfolder, type }, userId) => {
    // The stored asset is tagged with the chat and character it belongs to, so
    // it is not an orphan in the user's image library.
    const chatId = await getActiveChatId(userId);
    const chat = chatId ? await spindle.chats.get(chatId, userId).catch(() => null) : null;
    return fetchImage(url, {
        filename, subfolder, type,
        chatId,
        characterId: (chat && chat.character_id) || null,
        userId,
    });
});

// -------------------------------------------------------------
// The interceptor
// -------------------------------------------------------------
//
// The one thing in this extension that cannot live anywhere else. Everything
// above exists to get the profile and the chat into a shape this can run
// against.

spindle.registerInterceptor(async (messages, generationContext) => {
    try {
        const userId = generationContext?.userId;
        const chatId = generationContext?.chatId || await getActiveChatId(userId);
        if (!chatId) return messages;

        const context = await enterEngine(chatId, messages, userId);
        context.generationType = generationContext?.generationType;
        context.onPreview = (promptString) => {
            push("prompt:preview", { prompt: promptString }, userId);
        };

        return await buildPromptMessages(messages, context);
    } catch (e) {
        // A thrown interceptor fails the whole generation. Nothing this module
        // does is worth costing the user their reply, so a broken prompt build
        // degrades to the unmodified prompt and says so in the server log.
        spindle.log.error(`[Megumin Suite] Prompt build failed, sending the prompt unmodified: ${(e && e.message) || e}`);
        return messages;
    }
}, 50);

// -------------------------------------------------------------
// Which chat is open
// -------------------------------------------------------------
//
// Subscribed rather than polled because spindle.chats.getActive() does not go
// back to null when the user returns to the home screen. See store.js.

spindle.on("CHAT_SWITCHED", (payload, userId) => {
    trackActiveChat(userId ?? payload?.userId, payload?.chatId ?? null);
});

// -------------------------------------------------------------
// Boot
// -------------------------------------------------------------

installRouter();
spindle.log.info("[Megumin Suite] backend ready");
