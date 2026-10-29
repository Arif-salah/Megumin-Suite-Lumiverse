// @bun
// src/lumi/backend/rpc.js
var handlers = new Map;
function handle(type, fn) {
  handlers.set(type, fn);
}
function push(type, data = {}, userId = undefined) {
  spindle.sendToFrontend({ __push: type, __data: data }, userId);
}
function installRouter() {
  spindle.onFrontendMessage(async (payload, userId) => {
    if (!payload || typeof payload !== "object")
      return;
    const { __rid: rid, __type: type, __data: data } = payload;
    const fn = handlers.get(type);
    if (!fn) {
      if (rid !== undefined) {
        spindle.sendToFrontend({ __rid: rid, error: `Unknown request type "${type}"` }, userId);
      }
      return;
    }
    try {
      const result = await fn(data || {}, userId);
      if (rid !== undefined)
        spindle.sendToFrontend({ __rid: rid, result }, userId);
    } catch (e) {
      const message = e && e.message || String(e);
      spindle.log.error(`[Megumin Suite] "${type}" failed: ${message}`);
      if (rid !== undefined)
        spindle.sendToFrontend({ __rid: rid, error: message }, userId);
    }
  });
}

// src/lumi/backend/store.js
var SETTINGS_FILE = "settings.json";
var EMPTY_SETTINGS = {
  profiles: {},
  configPresets: [],
  globalSyncMap: {},
  customModes: [],
  globalSettings: {}
};
async function readJson(path, userId) {
  try {
    return JSON.parse(await spindle.userStorage.read(path, userId));
  } catch (e) {}
  try {
    return JSON.parse(await spindle.storage.read(path));
  } catch (e) {
    return null;
  }
}
async function writeJson(path, value, userId) {
  await spindle.userStorage.write(path, JSON.stringify(value, null, 2), userId);
}
var settingsCache = new Map;
var cacheKey = (userId) => userId || "__self__";
async function loadSettings(userId) {
  const key = cacheKey(userId);
  if (settingsCache.has(key))
    return settingsCache.get(key);
  const settings = await readJson(SETTINGS_FILE, userId) || JSON.parse(JSON.stringify(EMPTY_SETTINGS));
  for (const [k, value] of Object.entries(EMPTY_SETTINGS)) {
    if (settings[k] === undefined)
      settings[k] = JSON.parse(JSON.stringify(value));
  }
  settingsCache.set(key, settings);
  return settings;
}
async function saveSettings(next, userId) {
  const settings = next || JSON.parse(JSON.stringify(EMPTY_SETTINGS));
  settingsCache.set(cacheKey(userId), settings);
  await writeJson(SETTINGS_FILE, settings, userId);
  return { ok: true, profiles: Object.keys(settings.profiles || {}) };
}
function metadataPath(chatId) {
  return `metadata/${String(chatId).replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}
async function loadMetadata(chatId, userId) {
  if (!chatId)
    return {};
  return await readJson(metadataPath(chatId), userId) || {};
}
async function saveMetadata(chatId, metadata, userId) {
  if (!chatId)
    return;
  await writeJson(metadataPath(chatId), metadata || {}, userId);
}
var activeChatByUser = new Map;
var sawSwitchEvent = false;
function trackActiveChat(userId, chatId) {
  sawSwitchEvent = true;
  activeChatByUser.set(userId || "__self__", chatId || null);
}
async function getActiveChatId(userId) {
  const cacheKey = userId || "__self__";
  if (activeChatByUser.has(cacheKey))
    return activeChatByUser.get(cacheKey);
  if (sawSwitchEvent && userId)
    return null;
  try {
    const chat = await spindle.chats.getActive(userId);
    return chat ? chat.id : null;
  } catch (e) {
    return null;
  }
}

// src/lumi/backend/comfy.js
var WORKFLOW_DIR = "workflows/";
function normalizeBase(baseUrl) {
  let base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base)
    throw new Error("No ComfyUI address is set");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base))
    base = `http://${base}`;
  return base;
}
async function corsCall(url, init) {
  try {
    return await spindle.cors(url, init);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    if (/PERMISSION_DENIED|cors_proxy/i.test(msg)) {
      throw new Error('Megumin Suite needs the "CORS proxy" (cors_proxy) permission to reach ComfyUI. ' + "Grant it in Lumiverse's Extensions panel, then try again.");
    }
    throw err;
  }
}
async function comfyGet(baseUrl, path) {
  const res = await corsCall(`${normalizeBase(baseUrl)}${path}`, { method: "GET" });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`ComfyUI answered ${res.status} for ${path}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`ComfyUI sent something other than JSON for ${path}`);
  }
}
function optionsFrom(info, nodeName, field) {
  const node = info && info[nodeName];
  const required = node && node.input && node.input.required;
  const entry = required && required[field];
  return Array.isArray(entry) && Array.isArray(entry[0]) ? entry[0] : [];
}
async function comfyPing(url) {
  await comfyGet(url, "/system_stats");
  return { ok: true };
}
async function comfyModels(url) {
  const info = await comfyGet(url, "/object_info/CheckpointLoaderSimple");
  return optionsFrom(info, "CheckpointLoaderSimple", "ckpt_name");
}
async function comfySamplers(url) {
  const info = await comfyGet(url, "/object_info/KSampler");
  return optionsFrom(info, "KSampler", "sampler_name");
}
function comfyLoras(url) {
  return comfyGet(url, "/object_info/LoraLoader");
}
function workflowPath(name) {
  const n = String(name || "");
  if (!n || n.includes("/") || n.includes("\\") || n.includes("..")) {
    throw new Error(`Invalid workflow name: ${n}`);
  }
  if (!n.endsWith(".json"))
    throw new Error("Workflow names must end in .json");
  return WORKFLOW_DIR + n;
}
async function listWorkflows(userId) {
  const files = await spindle.userStorage.list(WORKFLOW_DIR, userId).catch(() => []);
  return files.map((f) => String(f).replace(WORKFLOW_DIR, "")).filter((f) => f.endsWith(".json"));
}
function readWorkflow(name, userId) {
  return spindle.userStorage.read(workflowPath(name), userId);
}
function saveWorkflow(name, workflow, userId) {
  return spindle.userStorage.write(workflowPath(name), workflow, userId);
}
function deleteWorkflow(name, userId) {
  return spindle.userStorage.delete(workflowPath(name), userId);
}
async function queuePrompt(url, workflow, clientId) {
  const res = await corsCall(`${normalizeBase(url)}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`ComfyUI rejected the workflow (${res.status}): ${String(res.body || "").slice(0, 400)}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error("ComfyUI accepted the workflow but sent back unreadable JSON");
  }
}
function promptHistory(url, promptId) {
  return comfyGet(url, `/history/${encodeURIComponent(promptId)}`);
}
async function fetchImage(url, { filename, subfolder = "", type = "output", chatId, characterId, userId }) {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await corsCall(`${normalizeBase(url)}/view?${params}`, {
    method: "GET",
    responseType: "arraybuffer",
    mediaType: "image"
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`ComfyUI answered ${res.status} for the finished image`);
  }
  const headers = res.headers || {};
  const mime = String(headers["content-type"] || "image/png").split(";")[0].trim() || "image/png";
  const b64 = String(res.body || "");
  if (!b64)
    throw new Error("ComfyUI returned an empty image");
  const dataUrl = `data:${mime};base64,${b64}`;
  spindle.log.info(`[Megumin Suite] downloaded ${filename} from ComfyUI: ~${(b64.length * 3 / 4 / 1024).toFixed(0)}KB`);
  const stored = await spindle.images.uploadFromDataUrl(dataUrl, {
    originalFilename: filename || "megumin.png",
    owner_chat_id: chatId || undefined,
    owner_character_id: characterId || undefined,
    userId
  });
  if (!stored || !stored.url) {
    throw new Error("Lumiverse accepted the image but returned no URL for it");
  }
  spindle.log.info(`[Megumin Suite] stored as ${stored.url}`);
  return { url: stored.url, id: stored.id, mime };
}

// src/backend.js
var LOG = "[Megumin Suite]";
handle("settings:load", (_data, userId) => loadSettings(userId));
handle("settings:save", ({ settings }, userId) => saveSettings(settings, userId));
handle("metadata:load", async ({ chatId }, userId) => loadMetadata(chatId || await getActiveChatId(userId), userId));
handle("metadata:save", async ({ chatId, metadata }, userId) => {
  if (!chatId)
    return;
  await saveMetadata(chatId, metadata, userId);
});
async function resolvePersona(chatId, userId) {
  let name = null;
  try {
    const result = await spindle.macros.resolve("{{user}}", { chatId, userId, commit: false });
    const text = String(result && result.text || "").trim();
    if (text && text !== "{{user}}")
      name = text;
  } catch (e) {}
  let record = null;
  try {
    record = await spindle.personas.getActive(userId) || await spindle.personas.getDefault(userId);
  } catch (e) {}
  return {
    name: name || record && record.name || "You",
    description: record && record.description || ""
  };
}
handle("context:load", async (_data, userId) => {
  const chatId = await getActiveChatId(userId);
  const chat = chatId ? await spindle.chats.get(chatId, userId).catch(() => null) : null;
  if (!chat)
    return { chatId: null, messages: [], character: null, userName: "You", persona: "" };
  const [messages, character, persona] = await Promise.all([
    spindle.chat.getMessages(chat.id).catch(() => []),
    chat.character_id ? spindle.characters.get(chat.character_id, userId).catch(() => null) : null,
    resolvePersona(chat.id, userId)
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
      avatarUrl: `/api/v1/characters/${encodeURIComponent(character.id)}/avatar?size=lg`
    } : null,
    userName: persona.name,
    persona: persona.description
  };
});
handle("chat:updateMessage", async ({ chatId, messageId, content }, userId) => {
  const id = chatId || await getActiveChatId(userId);
  if (!id || !messageId)
    return;
  await spindle.chat.updateMessage(id, messageId, { content: String(content ?? "") });
});
handle("chat:appendMessage", async ({ chatId, message }, userId) => {
  const id = chatId || await getActiveChatId(userId);
  if (!id)
    return null;
  return spindle.chat.appendMessage(id, {
    role: message.role || "assistant",
    content: message.content || "",
    metadata: { source: "megumin_suite" }
  });
});
function toHostMessages(messages) {
  return (messages || []).map((m) => {
    if (!Array.isArray(m.content))
      return m;
    const parts = m.content.map((p) => {
      if (p && p.type === "image_url" && p.image_url && typeof p.image_url.url === "string") {
        const match = p.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
        if (match)
          return { type: "image", mime_type: match[1], data: match[2] };
        return { type: "text", text: "" };
      }
      return p;
    });
    return { ...m, content: parts };
  });
}
function endOnTurn(messages) {
  const out = messages.slice();
  for (let i = out.length - 1;i >= 0 && out[i].role === "system"; i--) {
    if (i === 0)
      break;
    out[i] = { ...out[i], role: "user" };
  }
  return out;
}
function answerText(result) {
  return String(result && result.content || "");
}
var storyConnection = new Map;
var userKey = (userId) => userId || "__self__";
handle("generate:quiet", async ({ messages, connectionId, think }, userId) => {
  if (!Array.isArray(messages) || !messages.length)
    return { content: "" };
  const request = { messages: endOnTurn(toHostMessages(messages)), userId };
  connectionId = connectionId || storyConnection.get(userKey(userId)) || null;
  if (connectionId)
    request.connection_id = connectionId;
  if (think !== true)
    request.reasoning = { source: "custom", apiReasoning: true, effort: "low" };
  const started = Date.now();
  spindle.log.info(`${LOG} quiet generation: ${messages.length} messages${connectionId ? ` on connection ${connectionId}` : ""}`);
  const send = async (req) => {
    if (typeof spindle.generate.quietStream !== "function")
      return answerText(await spindle.generate.quiet(req));
    let acc = "";
    for await (const chunk of spindle.generate.quietStream(req)) {
      if (chunk.type === "token")
        acc += chunk.token;
      else if (chunk.type === "done")
        acc = typeof chunk.content === "string" && chunk.content ? chunk.content : acc;
    }
    return acc;
  };
  let content = "";
  try {
    content = await send(request);
  } catch (e) {
    if (!request.reasoning || e && e.name === "AbortError")
      throw e;
    spindle.log.warn(`${LOG} quiet generation failed with low reasoning effort (${e && e.message || e}); retrying on the connection's own settings.`);
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
    activeId: active ? active.id : ""
  };
});
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
    userId
  };
  if (connectionId)
    request.connection_id = connectionId;
  if (negativePrompt)
    request.negativePrompt = String(negativePrompt);
  if (parameters && Object.keys(parameters).length)
    request.parameters = parameters;
  if (id)
    request.owner_chat_id = id;
  if (chat && chat.character_id)
    request.owner_character_id = chat.character_id;
  const result = await spindle.imageGen.generate(request);
  const url = result && (result.imageUrl || result.mediaUrl) || "";
  if (!url && !(result && result.imageDataUrl))
    throw new Error("The image generator returned no image.");
  return {
    url,
    dataUrl: wantDataUrl ? result.imageDataUrl || null : undefined,
    imageId: result.imageId || null,
    provider: result.provider,
    model: result.model
  };
});
handle("media:saveBase64", async ({ chatId, base64, filename, extension }, userId) => {
  const mime = extension === "jpeg" || extension === "jpg" ? "image/jpeg" : "image/png";
  const dataUrl = String(base64).startsWith("data:") ? String(base64) : `data:${mime};base64,${base64}`;
  const id = chatId || await getActiveChatId(userId);
  const stored = await spindle.images.uploadFromDataUrl(dataUrl, {
    originalFilename: `${filename || "megumin"}.${extension || "png"}`,
    owner_chat_id: id || undefined,
    userId
  });
  if (!stored || !stored.url)
    throw new Error("Image upload returned no URL");
  return stored.url;
});
handle("comfy:ping", ({ url }) => comfyPing(url));
handle("comfy:models", ({ url }) => comfyModels(url));
handle("comfy:samplers", ({ url }) => comfySamplers(url));
handle("comfy:loras", ({ url }) => comfyLoras(url));
handle("comfy:workflows", (_d, userId) => listWorkflows(userId));
handle("comfy:readWorkflow", ({ name }, userId) => readWorkflow(name, userId));
handle("comfy:saveWorkflow", ({ name, workflow }, userId) => saveWorkflow(name, workflow, userId));
handle("comfy:deleteWorkflow", ({ name }, userId) => deleteWorkflow(name, userId));
handle("comfy:queue", ({ url, workflow, clientId }) => queuePrompt(url, workflow, clientId));
handle("comfy:history", ({ url, promptId }) => promptHistory(url, promptId));
handle("comfy:image", async ({ url, filename, subfolder, type, chatId }, userId) => {
  const id = chatId || await getActiveChatId(userId);
  const chat = id ? await spindle.chats.get(id, userId).catch(() => null) : null;
  return fetchImage(url, { filename, subfolder, type, chatId: id, characterId: chat && chat.character_id || null, userId });
});
var activeLore = new Map;
function loreEntries(context) {
  const list = Array.isArray(context && context.activatedWorldInfo) ? context.activatedWorldInfo : [];
  return list.map((e) => ({
    content: String(e && (e.content ?? e.entry?.content) || ""),
    key: [].concat(e && (e.key ?? e.keys ?? e.entry?.key) || []),
    keysecondary: [].concat(e && (e.keysecondary ?? e.secondary_keys ?? e.entry?.keysecondary) || []),
    comment: String(e && (e.comment ?? e.name ?? e.entry?.comment) || "")
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
handle("toast", ({ level, message, title }) => {
  const fn = spindle.toast[level] || spindle.toast.info;
  const t = title && !/^megumin suite$/i.test(String(title).trim()) ? String(title).replace(/^Megumin Suite\s*[\u2014-]\s*/i, "") : "";
  fn(String(message || ""), t ? { title: t } : undefined);
});
var ACK_TIMEOUT_MS = 4000;
var BUILD_TIMEOUT_MS = 280000;
var builds = new Map;
var nextBuild = 1;
handle("prompt:ack", ({ reqId }) => {
  const entry = builds.get(reqId);
  if (entry)
    entry.ack();
});
handle("prompt:built", ({ reqId, messages, error }) => {
  const entry = builds.get(reqId);
  if (!entry)
    return;
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
      done: finish
    });
    timer = setTimeout(() => finish(null), ACK_TIMEOUT_MS);
    if (signal)
      signal.addEventListener("abort", () => finish(null), { once: true });
    push("prompt:build", { reqId, ...payload }, userId);
  });
}
spindle.registerInterceptor(async (messages, context) => {
  try {
    const userId = context && context.userId;
    const chatId = context && context.chatId || await getActiveChatId(userId);
    if (!chatId)
      return messages;
    if (context && context.connectionId && context.generationType !== "quiet") {
      storyConnection.set(userKey(userId), context.connectionId);
    }
    const lore = loreEntries(context);
    activeLore.set(chatId, lore);
    const plain = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : null
    }));
    const started = Date.now();
    const built = await askFrontendToBuild({
      chatId,
      generationType: context && context.generationType || "normal",
      messages: plain
    }, userId, context && context.signal);
    spindle.log.info(`${LOG} prompt ${Array.isArray(built) ? "built" : "left unmodified"} in ${Date.now() - started}ms`);
    if (!Array.isArray(built))
      return messages;
    if (built.length === 0 && messages.length > 0)
      throw new Error("Generation cancelled in the prompt preview.");
    const restored = built.map((m) => {
      if (m && m.__keepIndex !== undefined)
        return messages[m.__keepIndex];
      if (!m)
        return m;
      const { __sourceIndex, ...edited } = m;
      const original = Number.isInteger(__sourceIndex) && __sourceIndex >= 0 ? messages[__sourceIndex] : undefined;
      return original ? { ...original, role: edited.role, content: edited.content } : edited;
    }).filter(Boolean);
    return toHostMessages(restored);
  } catch (e) {
    if (e && /cancelled in the prompt preview/.test(e.message))
      throw e;
    spindle.log.error(`${LOG} Prompt build failed, sending the prompt unmodified: ${e && e.message || e}`);
    return messages;
  }
}, 50, requiredInterceptors() ? { required: true } : undefined);
function requiredInterceptors() {
  try {
    return (spindle.host && spindle.host.capabilities && spindle.host.capabilities["required-interceptors-v1"]) >= 1;
  } catch (e) {
    return false;
  }
}
handle("debug:dryRun", async ({ generationType }, userId) => {
  const chatId = await getActiveChatId(userId);
  if (!chatId)
    return { error: "no chat open" };
  const result = await spindle.generate.dryRun({ chatId, generationType: generationType || "normal" }, userId);
  return {
    presetId: result.presetId || null,
    model: result.model,
    messages: (result.messages || []).map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "[parts]"
    }))
  };
});
spindle.on("CHAT_SWITCHED", (payload, userId) => {
  trackActiveChat(userId ?? payload?.userId, payload?.chatId ?? null);
});
try {
  spindle.frontendCapabilities.declare("message_tag_interceptor");
} catch (e) {}
installRouter();
spindle.log.info(`${LOG} backend ready`);
