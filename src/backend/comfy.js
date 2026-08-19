// ─────────────────────────────────────────────────────────────────────────────
// Talking to ComfyUI.
//
// The image-generation tab made two kinds of request, and neither survives a
// move to the browser on this platform:
//
//   /api/sd/comfy/*        SillyTavern's own server-side helpers — ping the
//                          instance, list checkpoints and samplers, read and
//                          write saved workflow files. Lumiverse has no such
//                          routes, so these had to be reimplemented rather than
//                          re-pointed.
//
//   http://comfy-host/...  Direct calls to the ComfyUI instance: queue a prompt,
//                          poll history, fetch the finished image. A browser
//                          cannot make these — ComfyUI sends no CORS headers, so
//                          every one is blocked before it leaves the page.
//
// Both work from here, because the backend is a server: it has no origin and no
// CORS to answer to. So this module is the whole ComfyUI surface, and the tab
// reaches it over RPC. The frontend's comfyFetch() presents the results in the
// shape the ported call sites already expect.
//
// The workflow files live in extension storage rather than anywhere of
// Lumiverse's, because they are ComfyUI graphs the user pasted in — the host has
// no concept that matches them, and putting them in our own storage means they
// travel with the extension and are removed with it.
// ─────────────────────────────────────────────────────────────────────────────

const WORKFLOW_DIR = "workflows/";

// ComfyUI is a machine the user named, which means it can be off, wrong, or slow.
// Every call below is expected to fail routinely, so they return a shape the tab
// can display rather than throwing into a toast.
async function comfyGet(baseUrl, path) {
    const url = `${String(baseUrl).replace(/\/+$/, "")}${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ComfyUI answered ${res.status} for ${path}`);
    return res.json();
}

// Pull the option list out of an /object_info node description. ComfyUI nests it
// as input.required.<field>[0], and which field varies by node, so the caller
// names it.
function optionsFrom(info, nodeName, field) {
    const node = info && info[nodeName];
    const required = node && node.input && node.input.required;
    const entry = required && required[field];
    return Array.isArray(entry) && Array.isArray(entry[0]) ? entry[0] : [];
}

export async function comfyPing(url) {
    await comfyGet(url, "/system_stats");
    return { ok: true };
}

export async function comfyModels(url) {
    const info = await comfyGet(url, "/object_info/CheckpointLoaderSimple");
    return optionsFrom(info, "CheckpointLoaderSimple", "ckpt_name");
}

export async function comfySamplers(url) {
    const info = await comfyGet(url, "/object_info/KSampler");
    return optionsFrom(info, "KSampler", "sampler_name");
}

export async function comfyLoras(url) {
    const info = await comfyGet(url, "/object_info/LoraLoader");
    return optionsFrom(info, "LoraLoader", "lora_name");
}

// ── Saved workflows ──────────────────────────────────────────────────────────

export async function listWorkflows() {
    const files = await spindle.storage.list(WORKFLOW_DIR).catch(() => []);
    return files
        .map((f) => f.replace(WORKFLOW_DIR, ""))
        .filter((f) => f.endsWith(".json"));
}

export function readWorkflow(name) {
    return spindle.storage.read(WORKFLOW_DIR + name);
}

export function saveWorkflow(name, workflow) {
    return spindle.storage.write(WORKFLOW_DIR + name, workflow);
}

export function deleteWorkflow(name) {
    return spindle.storage.delete(WORKFLOW_DIR + name);
}

// ── Running a generation ─────────────────────────────────────────────────────

export async function queuePrompt(url, workflow, clientId) {
    const res = await fetch(`${String(url).replace(/\/+$/, "")}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    if (!res.ok) {
        // ComfyUI puts the reason a graph was rejected in the body, and it is the
        // only useful thing the user can act on — a bare status tells them
        // nothing about which node is wrong.
        const detail = await res.text().catch(() => "");
        throw new Error(`ComfyUI rejected the workflow (${res.status}): ${detail.slice(0, 400)}`);
    }
    return res.json();
}

export function promptHistory(url, promptId) {
    return comfyGet(url, `/history/${encodeURIComponent(promptId)}`);
}

// Fetch a finished image and hand it back as a data URL.
//
// A URL pointing at the ComfyUI host would be just as unreachable from the page
// as the request that produced it, so the bytes come back inline. They are then
// handed to spindle.images, which gives a URL the chat can actually display.
export async function fetchImage(url, { filename, subfolder = "", type = "output" }) {
    const params = new URLSearchParams({ filename, subfolder, type });
    const res = await fetch(`${String(url).replace(/\/+$/, "")}/view?${params}`);
    if (!res.ok) throw new Error(`ComfyUI answered ${res.status} for the finished image`);

    const buffer = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000; // String.fromCharCode is applied to the chunk as
                          // arguments, and a whole image blows the argument limit.
    for (let i = 0; i < buffer.length; i += CHUNK) {
        binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
    }

    const mime = res.headers.get("content-type") || "image/png";
    return `data:${mime};base64,${btoa(binary)}`;
}
