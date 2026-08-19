// src/backend/rpc.js
var handlers = /* @__PURE__ */ new Map();
function handle(type, fn) {
  handlers.set(type, fn);
}
function installRouter() {
  spindle.onFrontendMessage(async (payload, userId) => {
    if (!payload || typeof payload !== "object") return;
    const { __rid: rid, type } = payload;
    const fn = handlers.get(type);
    if (!fn) {
      if (rid !== void 0) {
        spindle.sendToFrontend({ __rid: rid, error: `Unknown request type "${type}"` }, userId);
      }
      return;
    }
    try {
      const result = await fn(payload, userId);
      if (rid !== void 0) spindle.sendToFrontend({ __rid: rid, result }, userId);
    } catch (e) {
      const message = e && e.message || String(e);
      spindle.log.error(`[Megumin Suite] "${type}" failed: ${message}`);
      if (rid !== void 0) spindle.sendToFrontend({ __rid: rid, error: message }, userId);
    }
  });
}

// src/backend/store.js
var SETTINGS_FILE = "settings.json";
var METADATA_VAR = "megumin_metadata";
var EMPTY_SETTINGS = {
  profiles: {},
  configPresets: [],
  globalSyncMap: {}
};
var settingsCache = null;
async function loadSettings() {
  if (settingsCache) return settingsCache;
  settingsCache = await spindle.storage.getJson(SETTINGS_FILE, { fallback: null }) || structuredClone(EMPTY_SETTINGS);
  for (const [key, value] of Object.entries(EMPTY_SETTINGS)) {
    if (settingsCache[key] === void 0) settingsCache[key] = structuredClone(value);
  }
  return settingsCache;
}
async function saveSettings(next) {
  settingsCache = next || structuredClone(EMPTY_SETTINGS);
  await spindle.storage.setJson(SETTINGS_FILE, settingsCache, { indent: 2 });
  return settingsCache;
}
async function loadMetadata(chatId) {
  if (!chatId) return {};
  const raw = await spindle.variables.chat.get(chatId, METADATA_VAR);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    spindle.log.warn(`[Megumin Suite] Unreadable metadata on chat ${chatId}; starting fresh.`);
    return {};
  }
}
async function saveMetadata(chatId, metadata) {
  if (!chatId) return;
  await spindle.variables.chat.set(chatId, METADATA_VAR, JSON.stringify(metadata || {}));
}
async function getActiveChatId() {
  try {
    const chat = await spindle.chats.getActive();
    return chat ? chat.id : null;
  } catch (e) {
    return null;
  }
}

// src/backend.js
handle("settings:load", () => loadSettings());
handle("settings:save", ({ settings }) => saveSettings(settings));
handle("metadata:load", async ({ chatId }) => {
  return loadMetadata(chatId || await getActiveChatId());
});
handle("metadata:save", async ({ chatId, metadata }) => {
  await saveMetadata(chatId || await getActiveChatId(), metadata);
});
handle("context:load", async () => {
  const chat = await spindle.chats.getActive();
  if (!chat) {
    return { chat: [], chatId: null, characterId: null, characters: [], groupId: null };
  }
  const [messages, character, persona] = await Promise.all([
    spindle.chat.getMessages(chat.id).catch(() => []),
    chat.character_id ? spindle.characters.get(chat.character_id).catch(() => null) : null,
    spindle.personas.getActive?.().catch(() => null) ?? null
  ]);
  return {
    // `characters` is an array indexed by `characterId` because that is the
    // shape SillyTavern had and what the ported call sites index into. Only
    // the active character is ever in it — nothing in the ported code walks
    // the list, it only ever looks up the current one.
    chat: messages || [],
    chatId: chat.id,
    characterId: character ? 0 : null,
    characters: character ? [character] : [],
    groupId: null,
    userName: persona && persona.name || "You",
    isGenerating: false
  };
});
handle("chat:updateMessage", async ({ messageId, message }) => {
  const chatId = await getActiveChatId();
  if (!chatId) return;
  await spindle.chat.updateMessage(chatId, messageId, message);
});
handle("chat:appendMessage", async ({ message }) => {
  const chatId = await getActiveChatId();
  if (!chatId) return null;
  return spindle.chat.appendMessage(chatId, message);
});
handle("macros:substitute", async ({ text }) => {
  if (!text) return text;
  const chatId = await getActiveChatId();
  try {
    return await spindle.macros.evaluate(text, { chatId });
  } catch (e) {
    return text;
  }
});
handle("toast", ({ level, message, title }) => {
  const fn = spindle.toast[level] || spindle.toast.info;
  fn(message, title ? { title } : void 0);
});
installRouter();
spindle.log.info("[Megumin Suite] backend ready");
