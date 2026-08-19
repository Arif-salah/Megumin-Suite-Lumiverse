// ─────────────────────────────────────────────────────────────────────────────
// Where the extension's data lives.
//
// SillyTavern split this two ways and core/profile.js was the only module that
// knew about the split: tab settings went to extension_settings, while the
// chat-scoped data (story plan, NPC bank, block state) went to chat metadata.
// That split is worth keeping — settings follow the user, story data follows the
// chat — so it survives here, but both halves land somewhere new:
//
//   settings  -> spindle.storage, one JSON file for the whole extension
//   metadata  -> spindle.variables.chat, keyed per chat by the host
//
// spindle.variables.chat is the right home for the chat half specifically
// because the host persists it across regens, swipes and message edits, which is
// exactly the durability chat_metadata had. The alternative — a per-chat file in
// extension storage — would have made us responsible for cleaning up after
// deleted chats, and nothing tells an extension that a chat is gone.
//
// One shape mismatch to know about: chat variables store strings, not objects.
// So the metadata blob is JSON-encoded on the way in and parsed on the way out.
// It is a single key rather than one per field because the frontend mirror is
// loaded and flushed whole, and splitting it would turn one round trip into a
// dozen with no reader that wants them separately.
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_FILE = "settings.json";
const METADATA_VAR = "megumin_metadata";

const EMPTY_SETTINGS = {
    profiles: {},
    configPresets: [],
    globalSyncMap: {},
};

// The settings file is read on nearly every RPC and written on a debounce, so it
// is held in memory after the first read. The backend is the only writer, so the
// cache cannot go stale behind our back.
let settingsCache = null;

export async function loadSettings() {
    if (settingsCache) return settingsCache;

    settingsCache = await spindle.storage.getJson(SETTINGS_FILE, { fallback: null })
        || structuredClone(EMPTY_SETTINGS);

    // Fill in keys a settings file written by an older build may not have, so
    // readers never have to guard for them.
    for (const [key, value] of Object.entries(EMPTY_SETTINGS)) {
        if (settingsCache[key] === undefined) settingsCache[key] = structuredClone(value);
    }

    return settingsCache;
}

export async function saveSettings(next) {
    settingsCache = next || structuredClone(EMPTY_SETTINGS);
    await spindle.storage.setJson(SETTINGS_FILE, settingsCache, { indent: 2 });
    return settingsCache;
}

// -------------------------------------------------------------
// Chat-scoped metadata
// -------------------------------------------------------------

export async function loadMetadata(chatId) {
    if (!chatId) return {};

    const raw = await spindle.variables.chat.get(chatId, METADATA_VAR);
    if (!raw) return {};

    try {
        return JSON.parse(raw);
    } catch (e) {
        // A blob we cannot parse is a blob we cannot repair, and refusing to load
        // would leave the tab permanently broken for that chat. Start clean and
        // say so loudly rather than throwing on every render.
        spindle.log.warn(`[Megumin Suite] Unreadable metadata on chat ${chatId}; starting fresh.`);
        return {};
    }
}

export async function saveMetadata(chatId, metadata) {
    if (!chatId) return;
    await spindle.variables.chat.set(chatId, METADATA_VAR, JSON.stringify(metadata || {}));
}

// -------------------------------------------------------------
// Active chat
// -------------------------------------------------------------

export async function getActiveChatId() {
    try {
        const chat = await spindle.chats.getActive();
        return chat ? chat.id : null;
    } catch (e) {
        return null;
    }
}
