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
//
// ── One entry point, on purpose ──────────────────────────────────────────────
//
// This used to be two exported functions that callers had to invoke in the right
// order, because the first published the profile and the second looked up the
// character. That split is what hid the bug documented in resolveProfile(): the
// half that knew the character id was not the half that chose the profile, so
// they could not agree. enterEngine() does both and is the only way in.
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

// Which stored profile belongs to this chat, in the order the browser would try.
//
// This has to agree with getCharacterKey() in frontend/core/keys.js, and the
// first version did not — which is the entire reason settings appeared to do
// nothing. The browser writes under whichever key the user's "Save mode" setting
// selects: `chat::<chatId>` for Per Chat, `char::<characterId>` for Per
// Character — and Per Character is the DEFAULT. This looked up `chat::<chatId>`
// and nothing else. So every save landed under a key the prompt builder never
// read, the lookup fell through to `default` — the untouched boot profile — and
// every generation ran on its V4.2 engine regardless of what the user picked.
//
// Rather than read the save mode and reproduce the branch, both keys are tried
// in turn and then `default`. That is deliberately more forgiving than the
// browser: it also finds a profile written before the user changed the save
// mode, which a faithful copy of the branch would strand.
function resolveProfile(profiles, chatId, characterId) {
    const candidates = [];
    if (chatId) candidates.push(`chat::${chatId}`);
    if (characterId) candidates.push(`char::${characterId}`);
    candidates.push("default");

    for (const key of candidates) {
        if (profiles[key]) return { key, stored: profiles[key] };
    }
    return { key: null, stored: null };
}

// Load everything the engine needs for one run, and publish it.
//
// The engine reads `localProfile` and `globalSettings` as live bindings rather
// than taking them as arguments — that is how ~490 call sites in the original
// are written, and rewriting them was never on the table. So this sets them
// before returning. Nothing may call buildBaseDict() or buildPromptMessages()
// without going through here first, or it runs against whichever chat went last.
export async function enterEngine(chatId, messages, userId) {
    const settings = await loadSettings(userId);

    setGlobalSettings({
        configPresets: settings.configPresets || [],
        globalSyncMap: settings.globalSyncMap || {},
        customModes: settings.customModes || [],
        globalSettings: settings.globalSettings || {},
    });

    const chat = chatId ? await spindle.chats.get(chatId, userId).catch(() => null) : null;
    const characterId = (chat && chat.character_id) || null;

    let character = null;
    if (characterId) {
        character = await spindle.characters.get(characterId, userId).catch(() => null);
    }

    const { key, stored } = resolveProfile(settings.profiles || {}, chatId, characterId);

    // Merged onto the full default shape, never used raw. A stored profile is
    // always partial — the chat-scoped fields are stripped before writing and
    // anything added since it was last saved is absent — and the engine lookup
    // treats an unresolvable `mode` as the legacy V4 path rather than as an
    // error, so a gap generates with the wrong engine instead of failing.
    const profile = mergeProfile(stored);

    // Prompt blocks are stored as a diff against DEFAULT_PROMPTS. Without this
    // the engine would see only the keys the user actually edited.
    meguminRehydrateProfilePrompts(profile);

    // The chat-scoped half — story plan, NPC bank — lives apart from settings.
    const metadata = await loadMetadata(chatId, userId);
    if (metadata.megumin_story_plan && profile.storyPlan) {
        profile.storyPlan.currentPlan = metadata.megumin_story_plan.currentPlan || "";
        profile.storyPlan.lastTrackerState = metadata.megumin_story_plan.lastTrackerState || "";
    }
    if (metadata.megumin_npc_bank && profile.npcBank) {
        profile.npcBank.npcs = metadata.megumin_npc_bank.npcs || [];
    }

    setLocalProfile(profile);

    spindle.log.info(
        `[Megumin Suite] profile from ${key || "NONE (nothing stored)"}; engine=${profile.mode}`,
    );

    return {
        chat: toEngineMessages(messages),
        chatId,
        characterName: (character && character.name) || "the character",
        characterDescription: (character && (character.description || character.personality)) || "",
        userPersona: "",

        // {{char}} and {{user}} are the only macros the engine's own injected text
        // uses. Resolving them here rather than calling the host's macro engine
        // keeps the interceptor free of an await on every placeholder — and the
        // host has already expanded macros in the preset text by the time the
        // interceptor sees it.
        substitute: (text) => {
            if (!text) return text;
            return String(text)
                .replace(/\{\{char\}\}/gi, (character && character.name) || "the character")
                .replace(/\{\{user\}\}/gi, "You");
        },
    };
}
