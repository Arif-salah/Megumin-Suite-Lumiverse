// ─────────────────────────────────────────────────────────────────────────────
// Assembling the context object the engine runs against.
//
// The shared engine — buildBaseDict, injection, chatText — was written against
// SillyTavern's `getContext()`, and the port turned that into an argument rather
// than a host global, because the browser and the backend get the same
// information from different places. This module is the backend's half of that:
// it turns a Lumiverse chat id into the shape the engine expects.
//
// The message shape is SillyTavern's, deliberately. Every cleaner and template
// in shared/ reads { name, mes, is_user, is_system }, and translating once here
// is a great deal less error-prone than teaching a dozen call sites about
// Lumiverse's field names. toEngineMessages() below is the only place the two
// vocabularies meet.
// ─────────────────────────────────────────────────────────────────────────────

import { loadSettings, loadMetadata } from "../store.js";
import { setLocalProfile } from "../../shared/state.js";
import { setGlobalSettings } from "../../shared/globals.js";
import { meguminRehydrateProfilePrompts } from "../../shared/prompts/storage.js";
import { mergeProfile } from "../../shared/defaults.js";

// Lumiverse message -> the shape the shared engine reads.
export function toEngineMessages(messages) {
    return (messages || []).map((m) => ({
        name: m.name || (m.is_user || m.role === "user" ? "You" : "Character"),
        mes: typeof m.content === "string" ? m.content : (m.mes || ""),
        is_user: m.role === "user" || m.is_user === true,
        is_system: m.role === "system" || m.is_system === true,
        swipe_id: m.swipe_id,
        extra: m.extra,
    }));
}

// Load the profile for a chat and publish it to the shared modules.
//
// The engine reads `localProfile` as a live binding rather than taking it as an
// argument — that is how ~490 call sites in the original are written, and
// rewriting them was never on the table. So the backend sets it before each run.
// That makes prepareEngineContext() the only safe way to enter the engine: call
// buildBaseDict() without it and you get whichever chat ran last.
export async function prepareEngineContext(chatId, userId) {
    const settings = await loadSettings(userId);

    setGlobalSettings({
        configPresets: settings.configPresets || [],
        globalSyncMap: settings.globalSyncMap || {},
        customModes: settings.customModes || [],
        globalSettings: settings.globalSettings || {},
    });

    const profiles = settings.profiles || {};
    const key = chatId ? `chat::${chatId}` : null;

    // Same fallback chain the browser walks: this chat, then the global default.
    const stored = (key && profiles[key]) || profiles.default || null;

    // Merged onto the full default shape, never used raw. A stored profile is
    // always partial — the chat-scoped fields are stripped before writing, and
    // anything added since it was last saved is absent — and the engine lookup
    // treats a missing `mode` as the legacy V4 path rather than as an error. So
    // a raw stored profile does not fail loudly, it generates with the wrong
    // engine. See shared/defaults.js.
    const profile = mergeProfile(stored);

    // Say which identity actually supplied the profile. The frontend derives its
    // save key from the active chat and the backend derives its lookup key from
    // the generation context; if those two ever disagree the lookup silently
    // falls through to `default`, and the symptom is a prompt built from
    // whatever was configured first while every later edit appears to do
    // nothing. That is invisible without this line.
    const source = (key && profiles[key]) ? key : (profiles.default ? "default (no profile for this chat)" : "NONE (nothing stored)");
    spindle.log.info(`[Megumin Suite] profile from ${source}; engine=${profile.mode}`);

    // Prompt blocks are stored as a diff against DEFAULT_PROMPTS. Without this
    // the engine would see only the keys the user edited and fall through to
    // `undefined` for the rest.
    meguminRehydrateProfilePrompts(profile);

    // The chat-scoped half — story plan, NPC bank — lives apart from settings and
    // has to be folded back in before the engine reads it.
    const metadata = await loadMetadata(chatId, userId);
    if (metadata.megumin_story_plan && profile.storyPlan) {
        profile.storyPlan.currentPlan = metadata.megumin_story_plan.currentPlan || "";
        profile.storyPlan.lastTrackerState = metadata.megumin_story_plan.lastTrackerState || "";
    }
    if (metadata.megumin_npc_bank && profile.npcBank) {
        profile.npcBank.npcs = metadata.megumin_npc_bank.npcs || [];
    }

    setLocalProfile(profile);
    return profile;
}

// The rest of what the engine wants to know about the chat.
export async function buildEngineContext(chatId, messages, userId) {
    const chat = await spindle.chats.get(chatId, userId).catch(() => null);

    let character = null;
    if (chat && chat.character_id) {
        character = await spindle.characters.get(chat.character_id, userId).catch(() => null);
    }

    return {
        chat: toEngineMessages(messages),
        chatId,
        characterName: (character && character.name) || "the character",
        characterDescription: (character && (character.description || character.personality)) || "",
        userPersona: "",

        // {{char}} and {{user}} are the only macros the engine's own injected text
        // uses. Resolving them here rather than calling the host's macro engine
        // keeps the interceptor free of an await it would otherwise pay on every
        // placeholder — and the host has already expanded macros in the preset
        // text by the time the interceptor sees it.
        substitute: (text) => {
            if (!text) return text;
            return String(text)
                .replace(/\{\{char\}\}/gi, (character && character.name) || "the character")
                .replace(/\{\{user\}\}/gi, "You");
        },
    };
}
