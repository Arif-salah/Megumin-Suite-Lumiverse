// ─────────────────────────────────────────────────────────────────────────────
// The backend half of the frontend<->backend contract.
//
// frontend/bridge.js stamps each request with a `__rid` and waits on a promise.
// This module runs the matching handler and echoes that id back, so the bridge
// knows which promise to settle. A message with no `__rid` is a notification and
// gets no reply at all.
//
// The router is deliberately the only thing in the backend that knows about
// message shapes. Handlers are plain async functions of (data, userId) -> result;
// they never see the envelope, and they throw rather than returning error
// objects, because a throw is what the bridge turns into a rejected promise on
// the other side.
//
// Every send passes the originating userId back. Omitting it does not fail
// loudly — it BROADCASTS the reply to every connected user, which on an
// operator-scoped install means one person's profile arriving in everyone
// else's browser. The userId is threaded through every path below for that
// reason, including the ones that look like they could not possibly need it.
// ─────────────────────────────────────────────────────────────────────────────

const handlers = new Map();

export function handle(type, fn) {
    handlers.set(type, fn);
}

// Push something to the frontend that nobody asked for — task progress, a
// profile the backend reloaded on its own. The bridge routes these by `type` to
// listeners registered with onPush().
export function push(type, data = {}, userId = undefined) {
    spindle.sendToFrontend({ type, ...data }, userId);
}

export function installRouter() {
    spindle.onFrontendMessage(async (payload, userId) => {
        if (!payload || typeof payload !== "object") return;

        const { __rid: rid, type } = payload;
        const fn = handlers.get(type);

        if (!fn) {
            // An unknown type from a notification is harmless — probably a build
            // mismatch between the two halves. An unknown type from a request is
            // not: the caller is waiting, and silence would hang it until the
            // bridge's timeout. Answer with an error so it fails immediately.
            if (rid !== undefined) {
                spindle.sendToFrontend({ __rid: rid, error: `Unknown request type "${type}"` }, userId);
            }
            return;
        }

        try {
            const result = await fn(payload, userId);
            if (rid !== undefined) spindle.sendToFrontend({ __rid: rid, result }, userId);
        } catch (e) {
            const message = (e && e.message) || String(e);
            spindle.log.error(`[Megumin Suite] "${type}" failed: ${message}`);
            if (rid !== undefined) spindle.sendToFrontend({ __rid: rid, error: message }, userId);
        }
    });
}
