// ─────────────────────────────────────────────────────────────────────────────
// window.megumin — the console handle.
//
// Every one of these enters the SAME code path the extension uses at runtime.
// That is the point: a helper that reimplements the pipeline would prove the
// helper works and nothing else. So `afterReply()` is the exact call
// GENERATION_ENDED makes, `generateImage()` is the exact call the image
// pipeline makes per tag, and `extractImageTags()` runs the real regex from
// features/afterReply.js rather than a copy.
//
// It also answers the slower problem: several of this port's bugs were only
// visible after a reply, so testing meant sending a message and waiting on a
// model. These let the same code run against text typed into the console.
//
// Attached to window deliberately. The extension has no other way to be poked
// at from devtools, and it is namespaced under one object so it cannot collide
// with the host or another extension.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, refreshContext, hydrate, extension_settings, toastr } from "./host.js";
import { localProfile } from "./core/state.js";
import { getCharacterKey, getProfileLevel } from "./core/keys.js";
import { extensionName } from "./core/constants.js";
import { initProfile } from "./core/profile.js";
import { onMessageReceived, IMG_TAG_RE } from "./features/afterReply.js";
import { igGenerateWithComfy } from "./features/imagegen/index.js";
import { attachBlockCards, scheduleBlockRefresh } from "./blocks/chat.js";
import { call } from "./bridge.js";


// What the image pipeline would find in a piece of text, without generating
// anything. Applies the same <think> filter the real path does, so a tag the
// model only planned aloud is reported as ignored rather than silently absent.
function extractImageTags(text) {
    const mes = String(text || "");
    // A fresh instance, for the same reason the pipeline makes one: the shared
    // pattern is /g and would carry lastIndex between calls.
    const all = [...mes.matchAll(new RegExp(IMG_TAG_RE.source, IMG_TAG_RE.flags))];
    const lastThinkEnd = mes.lastIndexOf("</think>");

    return {
        found: all.length,
        prompts: all.filter((m) => m.index > lastThinkEnd).map((m) => m[2]),
        ignoredInThink: all.filter((m) => m.index <= lastThinkEnd).map((m) => m[2]),
    };
}

export function installDebugHandle() {
    const api = {
        // ── Seeing what the pipeline sees ───────────────────────────────────
        context: () => getContext(),
        profile: () => localProfile,

        where: () => ({
            chatId: getContext().chatId,
            profileKey: getCharacterKey() || "default",
            level: getProfileLevel(),
            engine: localProfile.mode,
            imageGenEnabled: !!(localProfile.imageGen && localProfile.imageGen.enabled),
            addons: localProfile.addons,
        }),

        lastMessage: () => {
            const chat = getContext().chat || [];
            return chat.length ? chat[chat.length - 1] : null;
        },

        // ── Image generation ────────────────────────────────────────────────

        // Dry: what WOULD be picked up. Defaults to the last message, so calling
        // it bare answers "why did my reply not trigger anything?".
        tags: (text) => extractImageTags(
            text !== undefined ? text : (api.lastMessage() || {}).mes || "",
        ),

        // Wet: run one prompt through the real generator, exactly as the
        // pipeline does per tag. No message is written to, so it lands wherever
        // the tab's inject mode sends a manual generation.
        generateImage: (prompt) => igGenerateWithComfy(String(prompt || "").trim() || "a test image"),

        // ── The whole post-reply pipeline ───────────────────────────────────
        //
        // The same two calls GENERATION_ENDED makes. Re-runs the Story Director
        // capture, the NPC scan and the image pipeline against whatever the last
        // message currently is — so a reply that already arrived can be re-tested
        // without asking the model for another one.
        afterReply: async () => {
            await refreshContext();
            await onMessageReceived();
            return api.lastMessage();
        },

        // ── Recovering from a stale load ────────────────────────────────────
        //
        // Re-reads settings, profile and chat from the backend and redraws the
        // block cards, without reloading the page. A new build only reaches the
        // browser on a refresh, but everything the extension holds in memory can
        // be re-synced this way.
        reload: async () => {
            await hydrate(extensionName);
            await refreshContext();
            await initProfile();
            attachBlockCards();
            scheduleBlockRefresh(0);
            toastr.success("Megumin Suite reloaded from the backend.");
            return api.where();
        },

        // ── Talking to the backend directly ─────────────────────────────────
        //
        // The raw RPC, for checking a handler in isolation:
        //   megumin.rpc("comfy:loras", { url: megumin.profile().imageGen.comfyUrl })
        rpc: (type, data) => call(type, data || {}),

        settings: () => extension_settings[extensionName],
    };

    window.megumin = api;

    console.info(
        "%c[Megumin Suite]%c console handle ready — try megumin.where(), megumin.tags(), megumin.afterReply()",
        "color:#f59e0b;font-weight:bold", "color:inherit",
    );

    return () => { delete window.megumin; };
}
