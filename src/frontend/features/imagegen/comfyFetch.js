// ─────────────────────────────────────────────────────────────────────────────
// A fetch() that speaks to ComfyUI through the backend.
//
// The image-generation tab has about a dozen call sites shaped like
//
//     const res = await fetch('/api/sd/comfy/models', { ... });
//     if (!res.ok) return;
//     const models = await res.json();
//
// None of those requests can be made from the page: half of them are
// SillyTavern server routes that do not exist here, and the other half go
// straight to a ComfyUI host that sends no CORS headers. All of them work from
// the backend, which is where they now go.
//
// Rather than rewrite each call site into an RPC — a dozen edits, each one a
// chance to drop an error branch — this presents the RPC as a fetch. It accepts
// the same URLs and returns something with `.ok`, `.json()` and `.text()`, so
// the call sites keep the shape they were written in and the difference stays
// in one file.
//
// It is deliberately NOT a general-purpose fetch. Only the routes the tab
// actually uses are mapped; anything else throws rather than silently returning
// a not-ok response, because a URL that reaches here unmapped is a porting
// mistake and should be loud.
// ─────────────────────────────────────────────────────────────────────────────

import { call } from "../../bridge.js";

// A stand-in for the Response the call sites destructure. Only the three members
// they touch are implemented.
function respond(payload, ok = true) {
    return {
        ok,
        status: ok ? 200 : 500,
        json: async () => payload,
        text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    };
}

export async function comfyFetch(url, options = {}) {
    let body = {};
    try { body = options.body ? JSON.parse(options.body) : {}; }
    catch (e) { body = {}; }

    try {
        // SillyTavern's server helpers.
        if (url === "/api/sd/comfy/ping")            return respond(await call("comfy:ping", { url: body.url }));
        if (url === "/api/sd/comfy/models")          return respond(await call("comfy:models", { url: body.url }));
        if (url === "/api/sd/comfy/samplers")        return respond(await call("comfy:samplers", { url: body.url }));
        if (url === "/api/sd/comfy/workflows")       return respond(await call("comfy:workflows"));
        if (url === "/api/sd/comfy/workflow")        return respond(await call("comfy:readWorkflow", { name: body.file_name }));
        if (url === "/api/sd/comfy/save-workflow")   return respond(await call("comfy:saveWorkflow", { name: body.file_name, workflow: body.workflow }));
        if (url === "/api/sd/comfy/delete-workflow") return respond(await call("comfy:deleteWorkflow", { name: body.file_name }));

        // Direct ComfyUI routes, matched by their tail because the host part is
        // whatever the user configured.
        const loras = url.match(/^(.*)\/object_info\/LoraLoader$/);
        if (loras) return respond(await call("comfy:loras", { url: loras[1] }));

        const prompt = url.match(/^(.*)\/prompt$/);
        if (prompt) {
            return respond(await call("comfy:queue", {
                url: prompt[1],
                workflow: body.prompt,
                clientId: body.client_id,
            }, { timeoutMs: 120000 }));
        }

        const history = url.match(/^(.*)\/history\/([^/?]+)$/);
        if (history) return respond(await call("comfy:history", { url: history[1], promptId: history[2] }));

        const view = url.match(/^(.*)\/view\?(.*)$/);
        if (view) {
            const params = new URLSearchParams(view[2]);
            const dataUrl = await call("comfy:image", {
                url: view[1],
                filename: params.get("filename"),
                subfolder: params.get("subfolder") || "",
                type: params.get("type") || "output",
            }, { timeoutMs: 120000 });
            return {
                ok: true,
                status: 200,
                json: async () => ({ dataUrl }),
                text: async () => dataUrl,
                // The call sites that fetch an image want a blob to turn into a
                // data URL. It already IS a data URL, so this hands the same
                // string back through the shape they expect.
                blob: async () => dataUrl,
                dataUrl,
            };
        }
    } catch (e) {
        console.error("[Megumin Suite] ComfyUI request failed:", url, e);
        return respond({ error: (e && e.message) || String(e) }, false);
    }

    throw new Error(`comfyFetch has no mapping for "${url}" — add one rather than calling fetch() directly.`);
}
