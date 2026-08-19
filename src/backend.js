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

import { handle, installRouter } from "./backend/rpc.js";
import {
    loadSettings,
    saveSettings,
    loadMetadata,
    saveMetadata,
    getActiveChatId,
} from "./backend/store.js";

// -------------------------------------------------------------
// Settings and metadata
// -------------------------------------------------------------

handle("settings:load", () => loadSettings());

handle("settings:save", ({ settings }) => saveSettings(settings));

handle("metadata:load", async ({ chatId }) => {
    return loadMetadata(chatId || await getActiveChatId());
});

handle("metadata:save", async ({ chatId, metadata }) => {
    await saveMetadata(chatId || await getActiveChatId(), metadata);
});

// -------------------------------------------------------------
// Chat context
// -------------------------------------------------------------
//
// Feeds getContext() in the frontend shim. The message array is the expensive
// part, so it is fetched here in one call rather than left to the UI to page
// through.

handle("context:load", async () => {
    const chat = await spindle.chats.getActive();
    if (!chat) {
        return { chat: [], chatId: null, characterId: null, characters: [], groupId: null };
    }

    const [messages, character, persona] = await Promise.all([
        spindle.chat.getMessages(chat.id).catch(() => []),
        chat.character_id ? spindle.characters.get(chat.character_id).catch(() => null) : null,
        spindle.personas.getActive?.().catch(() => null) ?? null,
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
        userName: (persona && persona.name) || "You",
        isGenerating: false,
    };
});

// -------------------------------------------------------------
// Chat mutation
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Macros
// -------------------------------------------------------------

handle("macros:substitute", async ({ text }) => {
    if (!text) return text;
    const chatId = await getActiveChatId();
    try {
        return await spindle.macros.evaluate(text, { chatId });
    } catch (e) {
        // Substitution is cosmetic in every call site that uses it — a template
        // preview, a label. Returning the raw text keeps {{char}} visible instead
        // of blanking the field.
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
// Boot
// -------------------------------------------------------------

installRouter();
spindle.log.info("[Megumin Suite] backend ready");
