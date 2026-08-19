// ──────────────────────────────────────────────────────────────────────────────
// Running a one-off generation.
//
// The same three exports the SillyTavern build had, so the tabs that call them
// are unchanged. What is behind them is entirely different: the work happens in
// the backend now, because that is where the prompt engine and the LLM call
// both live. See backend/tasks.js for what actually runs.
//
// useMeguminEngine is the interesting one. In SillyTavern it reached into the
// page, found the OpenAI preset dropdown, selected "Megumin Engine" by its
// visible label, waited three seconds for SillyTavern to load it, ran the task,
// then put the old preset back. That worked, but it was a UI puppet: it depended
// on a dropdown existing, on its option text, and on a sleep long enough for an
// async load nobody reported the end of.
//
// None of that survives here, and none of it needs to. `spindle.generate.quiet`
// takes the messages it is given and does not run prompt assembly at all, so a
// background task is already isolated from whatever preset the roleplay uses.
// The preset swap was solving a problem this platform does not have, so
// useMeguminEngine is now just "run the task" — kept as a wrapper so its call
// sites read the same and so there is one place to hang a real preset switch if
// Lumiverse ever needs one.
// ──────────────────────────────────────────────────────────────────────────────

import { call } from "../bridge.js";

export async function analyzeSlopDirectly(chatText) {
    try {
        const raw = await call("task:run", { task: "banlist", payload: chatText }, { timeoutMs: 180000 });
        return String(raw).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    } catch (e) {
        console.error("[Megumin Suite] Ban List Analysis Failed:", e);
        return null;
    }
}

export async function analyzeSlopWithPreset(chatText) {
    let result = null;
    await useMeguminEngine(async () => {
        result = await analyzeSlopDirectly(chatText);
    });
    return result;
}

export async function useMeguminEngine(task) {
    try {
        return await task();
    } catch (e) {
        console.error("[Megumin Suite] AI Error:", e);
        return null;
    }
}

export async function runMeguminTask(orderText) {
    return call("task:run", { task: "order", payload: orderText }, { timeoutMs: 180000 });
}

// The generic form, for the tabs that need a task this file has no named helper
// for (the Story Director, the NPC scan, image prompts).
export function runBackendTask(task, payload) {
    return call("task:run", { task, payload }, { timeoutMs: 180000 });
}
