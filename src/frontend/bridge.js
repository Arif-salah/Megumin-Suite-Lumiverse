// ─────────────────────────────────────────────────────────────────────────────
// Request/response over Spindle's fire-and-forget frontend<->backend channel.
//
// ctx.sendToBackend() posts a message and returns nothing; ctx.onBackendMessage()
// delivers replies with no notion of which send they answer. Everything the UI
// needs from the backend, though, is a question — load the profile, run a quiet
// generation, read the chat — and a question with no answer is useless.
//
// So this module stamps each outgoing message with an id, parks a promise under
// it, and resolves that promise when a reply carrying the same id arrives. The
// backend half of the contract is in backend/rpc.js: it echoes `__rid` back
// untouched and puts the payload under `result` or the message under `error`.
//
// Two details worth knowing:
//
//   - Every call has a timeout. A backend that throws before its reply is sent,
//     or one that was reloaded mid-call, would otherwise leave the caller's
//     promise pending forever and the UI stuck on a spinner with no error.
//
//   - `notify()` is the fire-and-forget half, for things with nothing to say
//     back (profile autosave, toasts). It deliberately does not allocate an id,
//     so a chatty UI does not fill the pending map with entries nobody awaits.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60000;

let sendToBackend = null;
const pending = new Map();
let nextId = 1;

// Called once from setup(). Everything else in the frontend goes through the
// functions below, so this is the only place that touches ctx's raw channel.
export function initBridge(ctx) {
    sendToBackend = (payload) => ctx.sendToBackend(payload);

    return ctx.onBackendMessage((payload) => {
        if (!payload || typeof payload !== "object") return;

        const rid = payload.__rid;
        if (rid === undefined) {
            // Not a reply — an unsolicited push from the backend (task progress,
            // a profile the backend reloaded on its own). Those go to listeners
            // registered via onPush() rather than to a waiting promise.
            dispatchPush(payload);
            return;
        }

        const entry = pending.get(rid);
        if (!entry) return; // already timed out, or a duplicate reply

        pending.delete(rid);
        clearTimeout(entry.timer);

        if (payload.error) entry.reject(new Error(payload.error));
        else entry.resolve(payload.result);
    });
}

// Ask the backend something and wait for the answer.
export function call(type, data = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!sendToBackend) return Promise.reject(new Error("Megumin bridge is not initialised"));

    const rid = nextId++;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(rid);
            reject(new Error(`Backend did not answer "${type}" within ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);

        pending.set(rid, { resolve, reject, timer });
        sendToBackend({ __rid: rid, type, ...data });
    });
}

// Tell the backend something. No id, no promise, no reply expected.
export function notify(type, data = {}) {
    if (!sendToBackend) return;
    sendToBackend({ type, ...data });
}

// -------------------------------------------------------------
// Unsolicited pushes
// -------------------------------------------------------------

const pushHandlers = new Map();

export function onPush(type, handler) {
    if (!pushHandlers.has(type)) pushHandlers.set(type, new Set());
    pushHandlers.get(type).add(handler);
    return () => pushHandlers.get(type)?.delete(handler);
}

function dispatchPush(payload) {
    const handlers = pushHandlers.get(payload.type);
    if (!handlers) return;
    for (const handler of handlers) {
        // One bad listener must not stop the others, for the same reason a
        // throwing refresh hook does not abort a profile load.
        try { handler(payload); }
        catch (e) { console.error(`[Megumin Suite] Push handler for "${payload.type}" failed:`, e); }
    }
}
