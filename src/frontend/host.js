// ─────────────────────────────────────────────────────────────────────────────
// Host shim — what src/st.js was in the SillyTavern build.
//
// The old rule was "nothing under src/ imports SillyTavern directly; import from
// st.js instead". That rule is the reason this port is possible at all: the UI
// layer names about twenty host functions, and all twenty arrive through one
// file. Swapping the host means rewriting that one file, not the fourteen
// thousand lines above it.
//
// So this module keeps the *same export names with the same shapes* and backs
// them with Spindle instead. A ported UI file changes its import path and
// nothing else.
//
// Three of those shapes need explaining, because Spindle does not offer them
// natively and the difference leaks if you are not expecting it:
//
//   extension_settings / chat_metadata — SillyTavern handed the browser live
//     objects that could be read and mutated synchronously, and hundreds of call
//     sites do exactly that. Spindle keeps both behind async backend storage. So
//     we load once during setup and hold a LOCAL MIRROR here. Reads are
//     synchronous against the mirror; writes mutate the mirror and are flushed
//     by saveSettingsDebounced() / saveMetadata(), exactly the calls the old code
//     already made. The consequence: a write is not durable until the next flush,
//     so a call site that mutates and never saves was relying on SillyTavern's
//     own autosave and has to be given an explicit save here.
//
//   getContext().chat — SillyTavern exposed the live message array. Spindle's
//     chat lives on the server, so the mirror is refreshed on the chat events
//     that can change it rather than on every read. Anything that must be exact
//     at generation time runs in the backend interceptor instead, where the real
//     message array is passed in.
//
//   Popup — SillyTavern's promise-returning modal. Rebuilt on ctx.ui.showModal
//     and ctx.ui.showConfirm, which give us themed chrome for free but a
//     different call shape, so the class below adapts rather than forwards.
// ─────────────────────────────────────────────────────────────────────────────

import jQuery from "jquery";
import { call, notify } from "./bridge.js";
import {
    activeStoryPlanRequest, activeBanListChat, activeImageGenRequest,
    activeNpcScanRequest, activeNpcPfpRequest, activeNpcUpdateRequest,
    activeGenerationOrder,
} from "../shared/engine/activeRequests.js";

export const $ = jQuery;

// The Spindle frontend context, captured once in setup(). Everything below reads
// it lazily so that importing this module has no ordering requirement.
let ctx = null;

export function setHostContext(next) {
    ctx = next;
}

export function getHostContext() {
    return ctx;
}

// -------------------------------------------------------------
// Settings and metadata mirrors
// -------------------------------------------------------------
//
// Shaped to match what the old code indexed into:
//   extension_settings[extensionName].profiles[key]
//   chat_metadata.megumin_*
//
// Both start empty and are filled by hydrate() before any UI renders, which is
// why setup() awaits it before building the drawer tab.

export const extension_settings = {};
export let chat_metadata = {};

// chat_metadata is reassigned wholesale on chat switch, and an importer may not
// assign to an import — same setter rule core/state.js has always had.
export function setChatMetadata(next) {
    chat_metadata = next || {};
}

export async function hydrate(extensionName) {
    extension_settings[extensionName] = (await call("settings:load")) || {};
    chat_metadata = (await call("metadata:load")) || {};
    return { settings: extension_settings[extensionName], metadata: chat_metadata };
}

// Re-read chat metadata after the active chat changes. The profile layer calls
// this before it reads anything chat-scoped.
export async function rehydrateMetadata() {
    chat_metadata = (await call("metadata:load")) || {};
    return chat_metadata;
}

let settingsFlushTimer = null;

// Both writers below go out as REQUESTS, not notifications, and report what
// comes back.
//
// They were notifications first, which cost a day: a notification has no reply,
// so when the backend write threw, the error was logged on the server and
// nowhere else. The window went on showing "Saved" after every edit, and the old
// values came back on the next open — a settings screen that lies about having
// saved, with the only evidence in a log nobody had reason to read.
//
// The round trip is not free, but it happens on a 400ms debounce after the user
// stops typing, so nothing waits on it. Silence is the expensive option here.

export function saveSettingsDebounced() {
    clearTimeout(settingsFlushTimer);
    settingsFlushTimer = setTimeout(() => {
        // The extension owns exactly one key in the settings object, so send that
        // rather than the whole thing — the backend writes it as one file.
        const key = Object.keys(extension_settings)[0];
        call("settings:save", { settings: extension_settings[key] || {} })
            .catch((e) => {
                console.error("[Megumin Suite] Settings were NOT saved:", e);
                toastr.error("Settings could not be saved. See the browser console.", "Megumin Suite");
            });
    }, 400);
}

export function saveMetadata() {
    return call("metadata:save", { metadata: chat_metadata })
        .catch((e) => {
            console.error("[Megumin Suite] Chat data was NOT saved:", e);
            toastr.error("Story plan / NPC data could not be saved. See the browser console.", "Megumin Suite");
        });
}

// -------------------------------------------------------------
// Chat context
// -------------------------------------------------------------

const contextMirror = {
    chat: [],
    chatId: null,
    characterId: null,
    characters: [],
    groupId: null,
    userName: "You",
    isGenerating: false,
};

export function getContext() {
    return {
        ...contextMirror,
        // Kept on the context object because that is where the old call sites
        // reached for it: getContext().updateMessageBlock(...).
        updateMessageBlock,
    };
}

export async function refreshContext() {
    Object.assign(contextMirror, (await call("context:load")) || {});
    return contextMirror;
}

// -------------------------------------------------------------
// Generation
// -------------------------------------------------------------
//
// The background features — story beats, the NPC scan, image prompts — all fire
// the same way: park a payload in activeRequests, call generateQuietPrompt with
// a MARKER string, and let the interceptor recognise the marker and swap in the
// real prompt. Five call sites are written that way and they are unchanged.
//
// What changed underneath is that the two halves of that handshake no longer
// share a module. activeRequests lives in shared/, so both bundles have a copy —
// but they are separate copies in separate processes, and setting a marker in
// the browser is invisible to the interceptor reading its own. Left alone, each
// of those five features would have set a marker nothing ever read and asked for
// a generation with a literal "___PS_NPC_SCAN___" as its prompt.
//
// So the marker is resolved HERE, on the side that actually set it: the map
// below turns it back into the task name and the payload the frontend parked,
// and both go to the backend together. backend/tasks.js sets its own marker
// around building the prompt, which is where the interceptor can see it.

const MARKER_TASKS = {
    ___PS_STORY_PLAN___: ["storyPlan", () => activeStoryPlanRequest],
    ___PS_BANLIST___: ["banlist", () => activeBanListChat],
    ___PS_IMAGE_GEN___: ["imagePrompt", () => activeImageGenRequest],
    ___PS_NPC_SCAN___: ["npcScan", () => activeNpcScanRequest],
    ___PS_NPC_PFP___: ["npcPortrait", () => activeNpcPfpRequest],
    ___PS_NPC_UPDATE___: ["npcUpdate", () => activeNpcUpdateRequest],
    ___PS_DUMMY___: ["order", () => activeGenerationOrder],
};

export function generateQuietPrompt(options) {
    const prompt = typeof options === "string" ? options : (options && options.prompt);

    const entry = MARKER_TASKS[prompt];
    if (!entry) {
        return Promise.reject(new Error(
            `generateQuietPrompt was called with "${prompt}", which is not a known Megumin marker. `
            + "Add it to MARKER_TASKS in host.js and to MARKERS in backend/tasks.js.",
        ));
    }

    const [task, readPayload] = entry;
    return call("task:run", { task, payload: readPayload() }, { timeoutMs: 180000 });
}

export function isGenerating() {
    return contextMirror.isGenerating === true;
}

// -------------------------------------------------------------
// Message mutation
// -------------------------------------------------------------

export function updateMessageBlock(messageId, message) {
    notify("chat:updateMessage", { messageId, message });
}

export function addOneMessage(message, options = {}) {
    return call("chat:appendMessage", { message, options });
}

export function saveChat() {
    // Spindle persists messages as they are mutated; there is no separate chat
    // file to flush. Kept so the call sites that end an edit with saveChat() read
    // the way they did.
    return Promise.resolve();
}

export function reloadCurrentChat() {
    return refreshContext();
}

export function appendMediaToMessage(message) {
    return call("chat:appendMedia", { message });
}

// -------------------------------------------------------------
// Prompt macros
// -------------------------------------------------------------
//
// {{user}}, {{char}} and friends are resolved by the host's macro engine, which
// only exists on the backend. Substitution is therefore async here where it was
// synchronous before. Call sites that only need the common names can use
// substituteParamsLocal(), which fills them from the context mirror without a
// round trip; the async form is for text that may carry arbitrary macros.

export function substituteParams(text) {
    return call("macros:substitute", { text });
}

export function substituteParamsLocal(text) {
    if (!text) return text;
    const characters = contextMirror.characters || [];
    const charName = (characters[contextMirror.characterId] || {}).name || "the character";
    const userName = contextMirror.userName || "You";
    return String(text)
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName);
}

// -------------------------------------------------------------
// Events
// -------------------------------------------------------------
//
// The old code wrote eventSource.on(event_types.CHAT_CHANGED, fn). Lumiverse
// names its events differently and offers only a subset, so event_types maps our
// old names onto theirs and eventSource forwards to ctx.events. A name with no
// Lumiverse equivalent maps to null and its subscription is dropped — the same
// quiet no-op an unregistered refresh hook has.

export const event_types = {
    APP_READY: "APP_READY",
    CHAT_CHANGED: "CHAT_CHANGED",
    MESSAGE_SENT: "MESSAGE_SENT",
    MESSAGE_EDITED: "MESSAGE_EDITED",
    MESSAGE_DELETED: "MESSAGE_DELETED",
    MESSAGE_SWIPED: "MESSAGE_SWIPED",
    MESSAGE_UPDATED: "SWIPE_EDITED",
    MESSAGE_RECEIVED: "GENERATION_ENDED",
    CHARACTER_MESSAGE_RENDERED: "CHARACTER_MESSAGE_RENDERED",
    USER_MESSAGE_RENDERED: "USER_MESSAGE_RENDERED",
    GENERATION_STARTED: "GENERATION_STARTED",
    GENERATION_ENDED: "GENERATION_ENDED",
    GENERATION_STOPPED: "GENERATION_STOPPED",

    // No Lumiverse equivalent. The chat list is virtualized rather than paged, so
    // "more messages loaded" has no moment to fire; image swipes are not a host
    // concept; prompt-ready is the backend interceptor and never reaches the UI.
    MORE_MESSAGES_LOADED: null,
    IMAGE_SWIPED: null,
    CHAT_COMPLETION_PROMPT_READY: null,
};

const appReadyHandlers = new Set();

export const eventSource = {
    on(eventName, handler) {
        if (!eventName) return () => {};

        if (eventName === "APP_READY") {
            // Fired once by setup() when the tab is built, since Lumiverse has
            // already booted by the time a frontend module runs.
            appReadyHandlers.add(handler);
            return () => appReadyHandlers.delete(handler);
        }

        if (!ctx) return () => {};
        return ctx.events.on(eventName, handler);
    },
};

export function fireAppReady() {
    for (const handler of appReadyHandlers) {
        try { handler(); }
        catch (e) { console.error("[Megumin Suite] APP_READY handler failed:", e); }
    }
    appReadyHandlers.clear();
}

// -------------------------------------------------------------
// Toasts
// -------------------------------------------------------------
//
// SillyTavern put toastr on window. Lumiverse exposes toasts on the backend only,
// so each call is a one-way message. Every call site is a response to something
// the user just did, so the extra hop is not felt.

export const toastr = {
    success: (message, title) => notify("toast", { level: "success", message, title }),
    info:    (message, title) => notify("toast", { level: "info", message, title }),
    warning: (message, title) => notify("toast", { level: "warning", message, title }),
    error:   (message, title) => notify("toast", { level: "error", message, title }),
};

// -------------------------------------------------------------
// Popup
// -------------------------------------------------------------

export const POPUP_TYPE = {
    TEXT: 1,
    CONFIRM: 2,
    INPUT: 3,
};

// SillyTavern's Popup was new Popup(content, type, inputValue, opts) followed by
// await popup.show(), resolving to the input string, true/false, or null. Rebuilt
// on the two Spindle primitives so the call sites keep that shape.
export class Popup {
    constructor(content, type = POPUP_TYPE.TEXT, inputValue = "", options = {}) {
        this.content = content;
        this.type = type;
        this.inputValue = inputValue;
        this.options = options || {};
    }

    async show() {
        if (!ctx) return null;

        if (this.type === POPUP_TYPE.CONFIRM) {
            const result = await ctx.ui.showConfirm({
                title: this.options.title || "Megumin Suite",
                message: typeof this.content === "string" ? this.content : "",
                confirmLabel: this.options.okButton || "OK",
                cancelLabel: this.options.cancelButton || "Cancel",
            });
            return result && result.confirmed === true;
        }

        return new Promise((resolve) => {
            const modal = ctx.ui.showModal({
                title: this.options.title || "Megumin Suite",
                width: this.options.wide ? 900 : 520,
                maxHeight: this.options.large ? 760 : 560,
            });

            const body = document.createElement("div");
            body.className = "megumin-popup-body";
            if (typeof this.content === "string") body.innerHTML = this.content;
            else if (this.content instanceof Node) body.appendChild(this.content);
            modal.root.appendChild(body);

            let input = null;
            if (this.type === POPUP_TYPE.INPUT) {
                input = document.createElement("textarea");
                input.className = "megumin-popup-input";
                input.value = this.inputValue || "";
                modal.root.appendChild(input);
            }

            const actions = document.createElement("div");
            actions.className = "megumin-popup-actions";

            const ok = document.createElement("button");
            ok.type = "button";
            ok.className = "megumin-popup-ok";
            ok.textContent = this.options.okButton || "OK";

            // `settled` guards the double-resolve that happens when a button
            // handler dismisses the modal and onDismiss then fires for the same
            // interaction. Without it the null from dismissal races the real
            // answer and the caller sometimes sees "cancelled" after an OK.
            let settled = false;
            const settle = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
                modal.dismiss();
            };

            ok.addEventListener("click", () => settle(input ? input.value : true));
            actions.appendChild(ok);

            if (this.type === POPUP_TYPE.INPUT) {
                const cancel = document.createElement("button");
                cancel.type = "button";
                cancel.className = "megumin-popup-cancel";
                cancel.textContent = this.options.cancelButton || "Cancel";
                cancel.addEventListener("click", () => settle(null));
                actions.appendChild(cancel);
            }

            modal.root.appendChild(actions);
            modal.onDismiss(() => settle(null));
        });
    }
}

// -------------------------------------------------------------
// Small utilities SillyTavern happened to own
// -------------------------------------------------------------

// Same contract as SillyTavern's: a debounced wrapper carrying a .cancel(), so
// cancelDebounce() below can reach it.
export function debounce(fn, timeout = 300) {
    let timer = null;
    const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), timeout);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
}

export function cancelDebounce(debounced) {
    if (debounced && typeof debounced.cancel === "function") debounced.cancel();
}

export function humanizedDateTime() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `@${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s`;
}

export function saveBase64AsFile(base64, folder, filename, extension) {
    return call("media:saveBase64", { base64, folder, filename, extension });
}

// SillyTavern's fetch helper, used by the image-generation tab when it talks to a
// ComfyUI instance. A browser request to a third-party host is blocked by CORS, so
// those calls are routed through the backend instead. This remains only for the
// call sites that pass the headers straight into a helper that now ignores them.
export function getRequestHeaders() {
    return { "Content-Type": "application/json" };
}
