// ─────────────────────────────────────────────────────────────────────────────
// Frontend entry point — bootstrap only.
//
// The direct descendant of index.js in the SillyTavern build, and it keeps that
// file's rule: imports and host wiring, no feature logic.
//
// The shape of the UI is the same one the SillyTavern build had, because Spindle
// happens to offer both halves of it natively:
//
//   the draggable launcher button  ->  ctx.ui.createFloatWidget()
//   the full-screen settings modal ->  ctx.ui.mountApp({ position: "app-overlay" })
//
// A drawer tab was the other option and it is the wrong one. The suite is not a
// panel — it is a twelve-pane window with a dock down its left edge, and the
// drawer would have squeezed that into a sidebar. The app mount lets the window
// stay the size it was designed at, and "app-overlay" means the host still
// layers its own sidebar and modals above it rather than the extension having to
// guess z-indexes.
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
import {
    buildSettingsWindow,
    buildLauncher,
    openSettingsWindow,
    closeSettingsWindow,
    isSettingsWindowOpen,
    updateCharacterDisplay,
} from "./frontend/ui/window.js";
import { switchTab, currentTab } from "./frontend/ui/tabs.js";
import { initProfile, saveProfileToMemory } from "./frontend/core/profile.js";
import { attachBlockCards, scheduleBlockRefresh } from "./frontend/blocks/chat.js";

export function setup(ctx) {
    setHostContext(ctx);
    const unsubBridge = initBridge(ctx);
    const removeStyles = ctx.dom.addStyle(MEGUMIN_STYLES);

    const appMount = ctx.ui.mountApp({
        className: "megumin-suite-app",
        position: "app-overlay",
    });
    buildSettingsWindow(appMount);

    const launcher = ctx.ui.createFloatWidget({
        width: 52,
        height: 52,
        initialPosition: { x: 24, y: 160 },
        snapToEdge: true,
        tooltip: "Megumin Suite",
        chromeless: true,
    });

    buildLauncher(launcher, () => {
        openSettingsWindow();
        updateCharacterDisplay();
        switchTab(0);
    });

    bindWindowChrome();

    // Startup is async — settings, metadata and the chat context all have to come
    // back from the backend before a tab can render. The window is already built
    // and hidden by this point, so a user who clicks the launcher mid-boot gets
    // the chrome and an empty stage rather than nothing at all.
    (async () => {
        await hydrate(extensionName);
        await refreshContext();
        await initProfile();
        attachBlockCards();
        fireAppReady();
    })().catch((err) => {
        console.error("[Megumin Suite] failed to start:", err);
        $("#ps_stage_content").html(
            '<div class="megumin-boot-error">Megumin Suite could not start. '
            + "See the browser console for details.</div>",
        );
    });

    // ── Host events ──────────────────────────────────────────────────────────
    //
    // A chat switch changes both halves of the stored data: the profile is keyed
    // by chat, and so is the metadata blob. Both are re-read before anything
    // renders against them. CHAT_SWITCHED and CHAT_CHANGED are both subscribed
    // because they are not the same event — one fires when the user opens a
    // different chat, the other when the open chat's own content changes.
    // The block cards are decoration over rendered messages, so they are redrawn
    // on anything that can rebuild a bubble. The redraw is debounced inside
    // blocks/chat.js — several of these fire together on a single turn.
    const unsubsMessages = ["MESSAGE_EDITED", "MESSAGE_SWIPED", "GENERATION_ENDED"].map((evt) =>
        ctx.events.on(evt, () => scheduleBlockRefresh(120)));

    const unsubs = ["CHAT_SWITCHED", "CHAT_CHANGED"].map((evt) =>
        ctx.events.on(evt, async () => {
            await rehydrateMetadata();
            await refreshContext();
            await initProfile();
            attachBlockCards();
            if (isSettingsWindowOpen()) {
                updateCharacterDisplay();
                switchTab(currentTab);
            }
        }),
    );

    return () => {
        [...unsubs, ...unsubsMessages].forEach((fn) => typeof fn === "function" && fn());
        unsubBridge && unsubBridge();
        launcher.destroy();
        appMount.destroy();
        removeStyles();
        ctx.dom.cleanup();
    };
}

// The window's own buttons. Bound once, by delegation off the document, because
// switchTab() replaces the stage's contents on every tab change and a handler
// bound directly to a button inside it would not survive.
function bindWindowChrome() {
    $(document)
        .off("click.megumin-chrome")
        .on("click.megumin-chrome", "#ps_btn_save_close", async () => {
            await saveProfileToMemory();
            closeSettingsWindow();
        })
        .on("click.megumin-chrome", "#ps_btn_close", () => closeSettingsWindow());
}
