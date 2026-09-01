// ─────────────────────────────────────────────────────────────────────────────
// Profile identity — which chat/character the settings on screen belong to.
//
// Everything here answers one question: "what key does this data save under?"
//
// The scheme is the SillyTavern one with the middle rung removed. There, a
// character was identified by its avatar FILENAME, because that was the only
// stable handle SillyTavern exposed — `characters[characterId].avatar`. Lumiverse
// gives characters real ids, so the key is the id and the avatar never enters
// into it. That also removes the failure the old code worked around at length:
// an avatar rename used to orphan a profile.
//
// Group chats are likewise not a separate rung any more. Lumiverse models a
// group as a chat that has several characters rather than as its own kind of
// object, so a group falls out as an ordinary `chat::` key and getProfileLevel()
// reports it as such.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, extension_settings } from "../host.js";
import { extensionName } from "./constants.js";

// One string naming which chat this data is for. Work that spans an await (an
// LLM call, a batch loop) captures this once at the start and re-checks it
// before every write, so nothing lands in a chat the user switched to mid-run.
// It falls back to a fixed string so a plain "not ready yet" reads as one
// identity rather than as constant churn.
export function meguminActiveDataIdentity() {
    return (getCharacterKey() || "default") + "|none";
}

export function getCharacterKey() {
    const context = getContext();
    const saveMode = extension_settings[extensionName]?.globalSettings?.saveMode || "chat";

    // Priority 1: chat-level, when the user has asked for per-chat settings.
    if (saveMode === "chat") {
        const chatId = context.chatId;
        if (chatId && typeof chatId === "string" && chatId.trim() !== "") {
            return `chat::${chatId}`;
        }
    }

    // Priority 2: character-level — every chat with this character shares one
    // profile.
    const character = (context.characters || [])[context.characterId];
    if (character && character.id) return `char::${character.id}`;

    return null;
}

export function getRawChatId() {
    return getContext().chatId ?? null;
}

export function isChatLevelProfile() {
    const key = getCharacterKey();
    return key !== null && key.startsWith("chat::");
}

export function getProfileLevel() {
    const context = getContext();
    const saveMode = extension_settings[extensionName]?.globalSettings?.saveMode || "chat";

    if (saveMode === "chat" && context.chatId && String(context.chatId).trim() !== "") return "chat";

    const character = (context.characters || [])[context.characterId];
    if (character && character.id) return "character";

    return "global";
}

// ── Identity rungs Lumiverse does not have ───────────────────────────────────
//
// profile.js walks a fallback chain when it loads: this chat's key, then the
// chat it was branched from, then the character's avatar key, then the global
// default. Two of those rungs have no Lumiverse equivalent, and the three
// helpers below are what the chain calls to ask about them.
//
// They return null rather than being deleted so the chain itself is untouched.
// Removing them would mean editing the load and save paths in half a dozen
// places to take a rung out, and every one of those edits is a chance to change
// which profile gets written — which is the one bug in this file a user cannot
// recover from. A rung that answers "not me" is skipped for free.
//
//   avatar keys  — SillyTavern identified a character by its avatar FILENAME.
//                  Lumiverse has real character ids, and getCharacterKey()
//                  already uses them, so there is no second character-level key
//                  to fall back to.
//
//   parent chats — SillyTavern encoded a branch's origin in the chat id, so the
//                  parent could be recovered by pattern-matching the name.
//                  Lumiverse branches are first-class and carry no such
//                  convention, so there is nothing to match. If the host later
//                  exposes a parent id, this is the only function that has to
//                  learn about it.

export function getRawAvatar() {
    return null;
}

export function getAvatarKey() {
    return null;
}

export function getParentChatKey() {
    return null;
}

// Drop stored profiles whose chat or character no longer exists.
//
// SillyTavern ran this on every startup, and most of its bulk was a guard
// against deleting every group profile during the window before groups had
// finished loading — an empty list could not be told apart from "not fetched
// yet", and guessing wrong destroyed live configs permanently.
//
// That hazard is worse here, not better: the frontend only ever knows about the
// ACTIVE chat, so from the browser's point of view every other profile looks
// orphaned. Cleanup therefore belongs on the backend, which can enumerate chats,
// and is deliberately not implemented in this pass. A few dead settings entries
// cost the user nothing; deleting a live profile is not recoverable.
export function cleanGhostProfiles() {
    // Intentionally a no-op. See the comment above before implementing it here
    // rather than on the backend.
}
