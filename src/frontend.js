// ─────────────────────────────────────────────────────────────────────────────
// Frontend entry point — bootstrap only.
//
// The direct descendant of index.js in the SillyTavern build, and it keeps that
// file's rule: imports and host wiring, no feature logic.
//
// The one structural decision worth stating here is why the whole suite lives
// behind a SINGLE drawer tab rather than one Spindle tab per settings screen.
// Spindle allows eight drawer tabs per extension and the suite has twelve
// screens, so a tab-per-screen does not fit — but the cap is not really the
// reason. The dock down the left of the settings window, the PRESETS & COT →
// Persona → Story Config progression, the per-tab sync toggle: those are one
// window with twelve panes, not twelve windows. Registering one drawer tab and
// handing its root to the existing switchTab() keeps that window intact and
// keeps ui/tabs.js the only module that knows which renderer draws what.
// ─────────────────────────────────────────────────────────────────────────────

import { initBridge } from "./frontend/bridge.js";
import {
    $,
    setHostContext,
    hydrate,
    refreshContext,
    rehydrateMetadata,
    fireAppReady,
    event_types,
    eventSource,
} from "./frontend/host.js";
import { extensionName } from "./frontend/core/constants.js";
import { MEGUMIN_STYLES } from "./frontend/styles.generated.js";
import { TAB_ICON_SVG } from "./frontend/ui/icon.js";
import { buildSettingsWindow } from "./frontend/ui/window.js";
import { switchTab } from "./frontend/ui/tabs.js";
import { initProfile } from "./frontend/core/profile.js";
import { attachBlockCards, scheduleBlockRefresh } from "./frontend/blocks/chat.js";

export function setup(ctx) {
    // Startup is async — settings, metadata and the chat context all have to come
    // back from the backend before a single tab can render. deferReady() holds
    // the host's startup queue until that is done, so a push sent while we are
    // still booting is delivered rather than dropped.
    ctx.deferReady();

    setHostContext(ctx);
    const unsubBridge = initBridge(ctx);

    const removeStyles = ctx.dom.addStyle(MEGUMIN_STYLES);

    const tab = ctx.ui.registerDrawerTab({
        id: "megumin",
        title: "Megumin Suite",
        shortName: "Megumin",
        description: "Preset engine, story director, block trackers, NPC bank and image generation",
        keywords: ["megumin", "preset", "story", "blocks", "npc", "director", "prompt"],
        headerTitle: "Megumin Suite",
        iconSvg: TAB_ICON_SVG,
    });

    // The settings window is built once and kept. switchTab() empties and refills
    // only the stage, exactly as it did before, so tab state and scroll position
    // survive the user leaving the drawer and coming back.
    buildSettingsWindow(tab.root);

    const boot = (async () => {
        await hydrate(extensionName);
        await refreshContext();
        await initProfile();

        switchTab(0);
        fireAppReady();
        attachBlockCards();
    })();

    boot.catch((e) => {
        console.error("[Megumin Suite] failed to start:", e);
        $(tab.root).html(
            '<div class="megumin-boot-error">Megumin Suite could not start. '
            + "See the browser console for details.</div>",
        );
    }).finally(() => ctx.ready());

    // ── Host events ──────────────────────────────────────────────────────────
    //
    // A chat switch changes both halves of the stored data: the profile key is
    // derived from the chat, and the metadata blob is per-chat. Both have to be
    // re-read before anything renders against them.
    const unsubChat = eventSource.on(event_types.CHAT_CHANGED, async () => {
        await rehydrateMetadata();
        await refreshContext();
        await initProfile();
        switchTab(-1);
        attachBlockCards();
    });

    // The block cards are decoration over rendered messages, so they are redrawn
    // on anything that can change what is on screen. The refresh is debounced
    // inside blocks/chat.js — several of these fire together on a single turn.
    const messageEvents = [
        event_types.CHARACTER_MESSAGE_RENDERED,
        event_types.USER_MESSAGE_RENDERED,
        event_types.MESSAGE_EDITED,
        event_types.MESSAGE_SWIPED,
        event_types.MESSAGE_UPDATED,
        event_types.GENERATION_ENDED,
    ];
    const unsubMessages = messageEvents.map((evt) => eventSource.on(evt, () => scheduleBlockRefresh(120)));

    return () => {
        unsubMessages.forEach((fn) => fn && fn());
        unsubChat && unsubChat();
        unsubBridge && unsubBridge();
        removeStyles();
        tab.destroy();
        ctx.dom.cleanup();
    };
}
