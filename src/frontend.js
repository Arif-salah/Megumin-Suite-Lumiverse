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
    clearChatContext,
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
import { bindWindowChrome, unbindWindowChrome } from "./frontend/ui/chrome.js";
import { initProfile } from "./frontend/core/profile.js";
import { attachBlockCards, scheduleBlockRefresh } from "./frontend/blocks/chat.js";
import { onMessageReceived } from "./frontend/features/afterReply.js";
import { installDebugHandle } from "./frontend/debug.js";

export function setup(ctx) {
    setHostContext(ctx);
    const unsubBridge = initBridge(ctx);
    const removeStyles = ctx.dom.addStyle(MEGUMIN_STYLES);

    // "end" puts the mount at the end of document.body. "app-overlay" reads like
    // the better fit — it is the host's own overlay layer — but it mounts INSIDE
    // the app shell, and the shell applies containment, which makes a
    // position: fixed child anchor to the shell rather than to the viewport. The
    // window came out pushed down the page by the height of the chrome above it.
    //
    // A direct body child has no such ancestor, so the window covers the viewport
    // the way it did in SillyTavern. The cost is that host chrome no longer paints
    // over it, which is why the stylesheet gives it an explicit z-index.
    const appMount = ctx.ui.mountApp({
        className: "megumin-suite-app",
        position: "end",
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

    // Reload the profile every time the window is opened, before anything is
    // drawn. index.js did this and dropping it was the whole "my settings do
    // nothing" bug: saveProfileToMemory() refuses to write when the profile in
    // memory belongs to a different chat than the active one, so if the window
    // was opened after a chat switch that this extension had not caught, every
    // edit was declined and only a console.debug said so.
    //
    // Re-reading here makes the window's own open the synchronisation point, so
    // it no longer depends on having seen the chat-switch event.
    buildLauncher(launcher, () => {
        openSettingsWindow();
        (async () => {
            await refreshContext();
            await initProfile();
            updateCharacterDisplay();
            switchTab(0);
        })().catch((err) => console.error("[Megumin Suite] could not open the settings window:", err));
    });

    bindWindowChrome();

    // window.megumin — see frontend/debug.js. Installed before boot so it is
    // reachable even when startup fails, which is when it is most wanted.
    const removeDebugHandle = installDebugHandle();

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

    // Everything that inspects a finished reply: the Story Director capturing its
    // tracker, the NPC bank scanning for new faces, and the image pipeline
    // spotting <img prompt="..."> and sending it to ComfyUI.
    //
    // GENERATION_ENDED is this platform's MESSAGE_RECEIVED. The context mirror is
    // refreshed first because every one of those readers works from
    // getContext().chat, and the reply that just landed is not in it yet.
    unsubsMessages.push(ctx.events.on("GENERATION_ENDED", async () => {
        try {
            await refreshContext();
            await onMessageReceived();
        } catch (err) {
            console.error("[Megumin Suite] post-reply pipeline failed:", err);
        }
    }));

    const unsubs = ["CHAT_SWITCHED", "CHAT_CHANGED"].map((evt) =>
        ctx.events.on(evt, async (payload) => {
            // CHAT_SWITCHED carries a null chatId when the user goes back to the
            // home screen. That has to be handled as its own case: the host's
            // active-chat lookup still names the chat they just left, so
            // re-reading the context would restore it and the lobby would go on
            // behaving as though that character were open.
            const leftChat = evt === "CHAT_SWITCHED" && payload && !payload.chatId;

            if (leftChat) clearChatContext();
            else await refreshContext();

            await rehydrateMetadata();
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
        removeDebugHandle();
        unbindWindowChrome();
        removeStyles();
        ctx.dom.cleanup();
    };
}
