// ─────────────────────────────────────────────────────────────────────────────
// The background generations: the ban-list scan, the Story Director, the NPC
// scan, image prompts.
//
// In the SillyTavern build these went out through the interceptor. A feature
// parked its payload in activeRequests, fired a quiet prompt carrying a marker
// string, and the interceptor recognised the marker and swapped the whole
// message array for the task's prompt. The round trip through the interceptor
// was not a design choice — it was the only way to reach the prompt at all.
//
// Spindle removes the need for it. `spindle.generate.quiet` is a direct provider
// call: it does not run prompt assembly, context handlers, or the interceptor
// chain. So a task can build its messages and send them, with no marker and no
// interference from the roleplay path.
//
// What is kept is the marker STATE, because injection.js branches on it and
// those branches are where each task's prompt is actually written. run() below
// sets the marker, calls buildPromptMessages against an empty array so the
// matching branch fills it, clears the marker, and sends the result. The task
// prompts therefore stay in one file with the roleplay prompt, exactly as
// before, and none of that code had to be moved or duplicated.
//
// The `finally` is not optional. A marker left set makes the NEXT generation —
// including the user's actual roleplay turn — come out as whatever task crashed.
// ─────────────────────────────────────────────────────────────────────────────

import { buildPromptMessages } from "../shared/engine/injection.js";
import {
    setActiveBanListChat,
    setActiveStoryPlanRequest,
    setActiveNpcScanRequest,
    setActiveNpcUpdateRequest,
    setActiveImageGenRequest,
    setActiveNpcPfpRequest,
    setActiveGenerationOrder,
} from "../shared/engine/activeRequests.js";
import { prepareEngineContext, buildEngineContext } from "./engine/context.js";
import { getActiveChatId } from "./store.js";

// Which setter each task uses. Keyed by the name the frontend asks for.
const MARKERS = {
    banlist: setActiveBanListChat,
    storyPlan: setActiveStoryPlanRequest,
    npcScan: setActiveNpcScanRequest,
    npcUpdate: setActiveNpcUpdateRequest,
    imagePrompt: setActiveImageGenRequest,
    npcPortrait: setActiveNpcPfpRequest,
    order: setActiveGenerationOrder,
};

export async function runTask(taskName, payload, userId) {
    const setMarker = MARKERS[taskName];
    if (!setMarker) throw new Error(`Unknown Megumin task "${taskName}"`);

    const chatId = await getActiveChatId(userId);
    await prepareEngineContext(chatId, userId);

    const messages = chatId ? await spindle.chat.getMessages(chatId).catch(() => []) : [];
    const context = await (chatId
        ? buildEngineContext(chatId, messages, userId)
        : Promise.resolve({ chat: [], substitute: (t) => t }));

    // Tell injection.js this is a utility run, so it does not raise a preview.
    context.generationType = "quiet";

    let taskMessages;
    setMarker(payload);
    try {
        // An empty array, because every task branch begins by clearing whatever
        // it was given and writing its own prompt from scratch.
        taskMessages = await buildPromptMessages([], context);
    } finally {
        setMarker(null);
    }

    if (!taskMessages || taskMessages.length === 0) {
        throw new Error(`Megumin task "${taskName}" produced no prompt`);
    }

    const result = await spindle.generate.quiet({ messages: taskMessages });
    return (result && result.content) || "";
}
