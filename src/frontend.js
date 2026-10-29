// ─────────────────────────────────────────────────────────────────────────────
// Frontend entry point — what index.js is in the SillyTavern build.
//
// The suite runs in the browser here exactly as it does in SillyTavern: the
// profile, the prompt engine, the World State and Chomusuke's queue all live in
// this page. What this file adds is the Lumiverse side of the wiring:
//
//   - the launcher (a host float widget) and the settings window (an app mount);
//   - Lumiverse's events, translated into the SillyTavern events the suite's
//     listeners were written for, with SillyTavern's arguments (a message INDEX,
//     not an id);
//   - the prompt: Lumiverse's interceptor runs in the backend, which hands the
//     assembled messages here. They are rewritten by the same handler that
//     SillyTavern's CHAT_COMPLETION_PROMPT_READY event calls, and sent back.
//
// The after-reply pipeline below (World State, Chomusuke's reads, images, the
// Story Director, the NPC Bank) is index.js's MESSAGE_RECEIVED handler, with
// the Memory Core step taken out: memory and the side panel are not part of
// this port.
// ─────────────────────────────────────────────────────────────────────────────

import { $, toastr } from "./lumi/globals.js";
import { initBridge, call, notify, onPush } from "./lumi/bridge.js";
import { MEGUMIN_STYLES } from "./lumi/styles.generated.js";
import { buildSettingsWindow, buildLauncher, openSettingsWindow, closeSettingsWindow, isSettingsWindowOpen } from "./lumi/window.js";
import { stopWatchingIcons, iconSvg } from "./lumi/icon.js";
import {
    setHostContext, getContext, extension_settings, saveSettingsDebounced, flushSettings, hydrate, refreshContext,
    clearChatContext, refreshConnections, setGenerating, setPromptBuilder, eventSource, event_types, cancelDebounce,
    saveChat, syncedTextOf, saveMetadata, buildQuietMessages, generateQuietPrompt,
} from "./st.js";
import * as activeRequests from "./core/activeRequests.js";
import { setEngineClonesReader } from "../data/slots.js";
import { extensionName } from "./core/constants.js";
import { localProfile, _loadedProfileKey, currentTab, isDevEngineDirty, setDevEngineDirty } from "./core/state.js";
import { meguminActiveDataIdentity, getCharacterKey, cleanGhostProfiles } from "./core/keys.js";
import { cleanLegacySettings, migrateRenamedTabs, migrateUtilityPrefillFlag, dropLookResidue } from "./core/migrations.js";
import { meguminCompactStoredPrompts } from "./prompts/storage.js";
import { cleanAIOutput, getChatForStoryDirector } from "./engine/chatText.js";
import { runWithChomusuke, chomusukeSessionPromise, setReplyHeld, stopJobsForOtherChats } from "./engine/tasks.js";
import { initChomusukeIndicator } from "./features/blocks/chomusukeIndicator.js";
import { warnChomusuke, answerKind } from "./engine/chomusukeNotice.js";
import {
    initProfile, saveProfileToMemory, flushProfileSettingsToLoadedKey, saveProfileDebounced, _saveProfileDebouncedInner, pruneFutureData,
} from "./core/profile.js";
import { blocksReadForReply, NOT_A_REPLY as BLOCKS_NOT_A_REPLY } from "./features/blocks/worker.js";
import { notebookReadForReply } from "./features/notebook/worker.js";
import { generateStoryPlanLogic } from "./features/storyplan/ui.js";
import { npcParseBlock, meguminFindNpcDossiers, npcCreateRecord } from "./features/npc/data.js";
import { npcParseUpdateBlocks, npcApplyUpdates } from "./features/npc/updates.js";
import { renderNpcList } from "./features/npc/ui.js";
import {
    stateOnMessageReceived, stateOnSwiped, stateOnSwipeDeleted, stateOnEdited, stateOnDeleted, stateOnChatLoaded,
    setWorldStateChangedHook,
} from "./state/index.js";
import { attachBlockCards, meguminScheduleBlocksRefresh, meguminDebugBlocks } from "./features/blocks/chat.js";
import {
    igManualGenerate, generateImagePromptText, addKazumaRetryButtons, igGenerateWithComfy, igAutoImageForReply,
    v2LooksForArrivals, prepareImagePrompt, combinedTurnWanted, runCombinedTurn, setQuickGenAction, bindKazumaImageViewer,
} from "./features/imagegen/index.js";
import { handlePromptInjection } from "./engine/injection.js";
import { suiteEnabled, setSuiteEnabled, syncPowerUI } from "./core/power.js";
import { tabsUI, switchTab, toggleTabGlobalSync } from "./ui/tabs.js";
import { renderDevMode } from "./ui/devmode.js";

const NS = ".meguminChrome";

// The chat's bubbles mount a moment after a chat opens, and not all at once;
// the cards are drawn in a few passes. A card already up to date is skipped.
function refreshSoon() {
    [300, 1000, 2500].forEach((ms) => setTimeout(() => meguminScheduleBlocksRefresh(0), ms));
}

// -------------------------------------------------------------
// The settings window's banner
// -------------------------------------------------------------

function updateCharacterDisplay() {
    const context = getContext();
    const character = context.characters[context.characterId];
    const url = (character && character.avatarUrl) || "";
    // No avatar (the lobby, a fresh install): the banner's CSS gradient.
    $("#ps_hero_banner").css("background-image", url ? `url('${url}')` : "");
}

// -------------------------------------------------------------
// Lumiverse events -> SillyTavern events
// -------------------------------------------------------------

// The type of the generation in flight, as the prompt build saw it. Lumiverse's
// GENERATION_ENDED does not carry it, and the suite's MESSAGE_RECEIVED
// listeners branch on it (a continue, a swipe).
let lastGenerationType = "normal";

const indexOf = (messageId) => getContext().chat.findIndex((m) => m && m.id === messageId);

function bindHostEvents(ctx) {
    const on = (evt, fn) => ctx.events.on(evt, async (payload) => {
        try { await fn(payload || {}); }
        catch (e) { console.error(`[Megumin Suite] ${evt} handler failed:`, e); }
    });

    const unsubs = [];

    unsubs.push(on("CHAT_SWITCHED", async (p) => {
        if (!p.chatId) await clearChatContext();
        else await refreshContext();
        await eventSource.emit(event_types.CHAT_CHANGED, p.chatId || null);
    }));

    // Lumiverse fires this when the open chat changes underneath it (a rename,
    // a branch). A different id is a switch; the same id is a reload.
    unsubs.push(on("CHAT_CHANGED", async (p) => {
        const before = getContext().chatId;
        await refreshContext();
        if (getContext().chatId !== before) await eventSource.emit(event_types.CHAT_CHANGED, getContext().chatId);
    }));

    unsubs.push(on("MESSAGE_SENT", async (p) => {
        await refreshContext();
        const index = indexOf(p.message && p.message.id);
        await eventSource.emit(event_types.MESSAGE_SENT, index);
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, index);
    }));

    unsubs.push(on("GENERATION_STARTED", async () => {
        setGenerating(true);
    }));

    unsubs.push(on("GENERATION_ENDED", async (p) => {
        setGenerating(false);
        await refreshContext();
        if (p.error || !p.messageId) return;
        const index = indexOf(p.messageId);
        if (index < 0) return;
        await eventSource.emit(event_types.MESSAGE_RECEIVED, index, lastGenerationType);
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, index, lastGenerationType);
        await eventSource.emit(event_types.GENERATION_ENDED, index);
    }));

    unsubs.push(on("GENERATION_STOPPED", async () => {
        setGenerating(false);
        await refreshContext();
        await eventSource.emit(event_types.GENERATION_STOPPED);
    }));

    unsubs.push(on("MESSAGE_EDITED", async (p) => {
        const msg = p.message || {};
        // The echo of the suite's own write (an image landing, a tracker
        // captured): SillyTavern never reports those as edits, and the World
        // State would otherwise re-read a reply nobody touched.
        const own = msg.id && typeof msg.content === "string" && syncedTextOf(msg.id) === msg.content;
        await refreshContext();
        if (own) { meguminScheduleBlocksRefresh(120); return; }
        const index = indexOf(msg.id);
        if (index < 0) return;
        await eventSource.emit(event_types.MESSAGE_EDITED, index);
        await eventSource.emit(event_types.MESSAGE_UPDATED, index);
    }));

    unsubs.push(on("MESSAGE_DELETED", async () => {
        await refreshContext();
        await eventSource.emit(event_types.MESSAGE_DELETED, getContext().chat.length);
    }));

    unsubs.push(on("MESSAGE_SWIPED", async (p) => {
        await refreshContext();
        const index = indexOf(p.message && p.message.id);
        if (index < 0) return;
        if (p.action === "deleted") {
            await eventSource.emit(event_types.MESSAGE_SWIPE_DELETED, { messageId: index, swipeId: p.swipeId, newSwipeId: p.message.swipe_id });
        } else if (p.action === "navigated" || p.action === "added") {
            await eventSource.emit(event_types.MESSAGE_SWIPED, index);
        } else {
            await eventSource.emit(event_types.MESSAGE_UPDATED, index);
        }
    }));

    unsubs.push(on("SWIPE_EDITED", async (p) => {
        await refreshContext();
        const index = indexOf(p.message && p.message.id);
        if (index >= 0) await eventSource.emit(event_types.MESSAGE_SWIPED, index);
    }));

    return unsubs;
}

// -------------------------------------------------------------
// The prompt
// -------------------------------------------------------------
//
// The backend asks; this answers twice: an acknowledgement at once (so the
// backend knows a browser is running the suite and waits), then the messages.

let ready = false;

async function buildPrompt({ reqId, chatId, generationType, messages }) {
    notify("prompt:ack", { reqId });
    try {
        if (!ready || !Array.isArray(messages)) throw new Error("not ready");

        // The user's new message is in the chat by now; the mirror may not be.
        if (getContext().chatId !== chatId || generationType !== "quiet") await refreshContext();
        lastGenerationType = generationType || "normal";

        // Send guard (index.js's GENERATION_STARTED handler): a reply sent while
        // Chomusuke still reads the last one (World State, Blocks, the Notebook)
        // waits for it, so its Current Info is up to date. 30s cap so a stuck
        // job can never block the chat.
        if (generationType !== "quiet") {
            const session = chomusukeSessionPromise();
            if (session) {
                toastr.info("Waiting a moment for Chomusuke to finish reading the last reply…", "Megumin Suite");
                setReplyHeld(true);
                try {
                    const gaveUp = await Promise.race([
                        session.then(() => false),
                        new Promise((r) => setTimeout(() => r(true), 30000)),
                    ]);
                    if (gaveUp) console.warn("[Megumin Suite] Send guard: Chomusuke still busy after 30s; sending anyway.");
                } finally { setReplyHeld(false); }
            }
        }

        // Messages the backend could not show as plain text (an attached image)
        // go in as empty strings and come back as a pointer to the original.
        const work = messages.map((m, i) => ({ role: m.role, content: m.content ?? "", __i: i, __opaque: m.content === null }));
        await handlePromptInjection({ chat: work }, generationType);
        const out = work.map((m) => (m.__opaque && m.content === "")
            ? { __keepIndex: m.__i }
            : { role: m.role, content: m.content, __sourceIndex: m.__i });
        notify("prompt:built", { reqId, messages: out });
    } catch (e) {
        if (String(e && e.message) !== "not ready") console.error("[Megumin Suite] Prompt build failed:", e);
        notify("prompt:built", { reqId, error: String((e && e.message) || e) });
    }
}

// -------------------------------------------------------------
// After a reply (index.js's MESSAGE_RECEIVED handler)
// -------------------------------------------------------------

async function onMessageReceived(receivedId, receivedType) {
    // Master switch off: nothing below runs.
    if (!suiteEnabled()) return;

    // An empty reply (or one with only its thinking) has nothing for Chomusuke
    // to read: no read, no blocks, no image for it.
    const replyNow = (getContext().chat || [])[typeof receivedId === "number" ? receivedId : (getContext().chat || []).length - 1];
    const emptyReply = Boolean(replyNow && !replyNow.is_user && !replyNow.is_system
        && !cleanAIOutput(String(replyNow.mes || "").replace(/<!--[\s\S]*?-->/g, "")).trim());

    // --- WORLD STATE --- first, so everything below sees this reply's outfits.
    const combinedTurn = emptyReply ? null : combinedTurnWanted(receivedId, receivedType);
    try {
        if (stateOnMessageReceived(receivedId, receivedType, { skipSideRead: emptyReply || Boolean(combinedTurn && combinedTurn.world) })) meguminScheduleBlocksRefresh();
        v2LooksForArrivals();
    } catch (e) {
        console.error("[Megumin Suite] World State update failed", e);
    }

    // --- BLOCKS BY CHOMUSUKE ---
    if (!emptyReply && !BLOCKS_NOT_A_REPLY.has(receivedType) && !(combinedTurn && combinedTurn.blocks)) {
        const chatNow = getContext().chat || [];
        const blocksIndex = typeof receivedId === "number" ? receivedId : chatNow.length - 1;
        blocksReadForReply(blocksIndex, { force: receivedType === "continue" })
            .catch((e) => console.error("[Megumin Suite] Blocks read failed", e));
    }

    // --- NOTEBOOK BY CHOMUSUKE ---
    if (!emptyReply && !BLOCKS_NOT_A_REPLY.has(receivedType) && !(combinedTurn && combinedTurn.notebook)) {
        const chatNow = getContext().chat || [];
        const nbIndex = typeof receivedId === "number" ? receivedId : chatNow.length - 1;
        notebookReadForReply(nbIndex, { force: receivedType === "continue" })
            .catch((e) => console.error("[Megumin Suite] Notebook read failed", e));
    }

    // --- AUTOMATIC IMAGE BY CHOMUSUKE ---
    if (!emptyReply) (combinedTurn
        ? runCombinedTurn(receivedId, receivedType, combinedTurn)
        : igAutoImageForReply(receivedId, receivedType, generateImagePromptText, prepareImagePrompt))
        .catch((e) => console.error("[Megumin Suite] Automatic image failed", e));
    if (combinedTurn && !combinedTurn.image) {
        igAutoImageForReply(receivedId, receivedType, generateImagePromptText, prepareImagePrompt)
            .catch((e) => console.error("[Megumin Suite] Automatic image failed", e));
    }

    // --- STORY DIRECTOR FEEDBACK & AUTO-EVOLVE ---
    const sp = localProfile?.storyPlan;
    const spIdentity = meguminActiveDataIdentity();
    if (sp && sp.enabled) {
        const chat = getContext().chat;
        if (chat && chat.length > 0) {
            const lastIndex = chat.length - 1;
            const lastMsg = chat[lastIndex];
            if (!lastMsg.is_user && !lastMsg.is_system) {
                const trackerRegex = /<Story_Tracker[^>]*>([\s\S]*?)<\/Story_Tracker\s*>/i;
                const match = lastMsg.mes.match(trackerRegex);
                let needsEvolve = false;

                if (match) {
                    sp.lastTrackerState = match[1].trim();
                    saveProfileToMemory();
                    if (sp.triggerMode !== "manual") {
                        const statusMatch = sp.lastTrackerState.match(/(?:directive_status|arc_status):\s*\[?(completed|pivoted|progressing|nearing_completion|nearing_climax)\]?/i);
                        if (statusMatch) {
                            const status = statusMatch[1].toLowerCase();
                            if (status === "completed" || status === "pivoted") needsEvolve = true;
                        }
                    }
                }

                if (!needsEvolve && sp.triggerMode === "frequency") {
                    const aiMsgCount = chat.filter((m) => !m.is_user && !m.is_system).length;
                    if (aiMsgCount > 0 && aiMsgCount % sp.autoFreq === 0) needsEvolve = true;
                }

                if (needsEvolve) {
                    toastr.info("Auto-Evolving Narrative Directive...", "Story Director");
                    setTimeout(async () => {
                        if (meguminActiveDataIdentity() !== spIdentity) return;
                        const chatText = getChatForStoryDirector();
                        if (chatText.length < 100) return;
                        try {
                            const output = await runWithChomusuke("storyPlan", () => generateStoryPlanLogic(chatText));
                            if (meguminActiveDataIdentity() !== spIdentity) return;
                            const directiveMatch = output?.match(/<directive>([\s\S]*?)<\/directive>/i) || output?.match(/<plot>([\s\S]*?)<\/plot>/i);
                            if (directiveMatch) {
                                sp.currentPlan = directiveMatch[1].trim();
                                sp.planMessageIndex = (getContext().chat?.length || 1) - 1;
                                saveProfileToMemory();
                                if ($("#sd_current_plan").length) {
                                    $("#sd_current_plan").val(sp.currentPlan);
                                    $("#sd_btn_evolve").prop("disabled", false);
                                }
                                toastr.success("Narrative Directive Evolved silently!", "Story Director");
                            } else if (output !== null) {
                                warnChomusuke(answerKind(output), ["storyPlan"]);
                            }
                        } catch (e) {
                            console.error("[Megumin Suite] Story Director auto-evolve failed", e);
                            warnChomusuke("failed", ["storyPlan"], { error: e });
                        }
                    }, 2000);
                }
            }
        }
    }

    // --- AUTO-EXTRACT NPCs ---
    const npcBank = localProfile?.npcBank;
    const npcLiveKey = getCharacterKey() || "default";
    if (npcBank && npcBank.enabled && _loadedProfileKey && npcLiveKey !== _loadedProfileKey) {
        console.debug(`[Megumin Suite] NPC auto-extract declined: the bank in memory belongs to "${_loadedProfileKey}", this message arrived in "${npcLiveKey}".`);
    } else if (npcBank && npcBank.enabled) {
        const chat = getContext().chat;
        if (chat && chat.length) {
            const lastMsg = chat[chat.length - 1];
            if (!lastMsg.is_user && !lastMsg.is_system) {
                const dossiers = meguminFindNpcDossiers(lastMsg.mes);
                let added = false;
                for (const dossier of dossiers) {
                    if (!npcBank.npcs) npcBank.npcs = [];
                    if (!npcBank.npcs.find((n) => (n.name || "").trim().toLowerCase() === dossier.name.toLowerCase())) {
                        npcBank.npcs.push(npcCreateRecord({ parsed: npcParseBlock(dossier.raw), name: dossier.name, messageIndex: chat.length - 1 }));
                        added = true;
                        toastr.success(`NPC added to Bank: ${dossier.name}`, "Megumin Suite");
                        if ($("#npc_bank_list").length) renderNpcList();
                    }
                }
                const parsedUpdates = npcParseUpdateBlocks(lastMsg.mes);
                if (parsedUpdates.length) {
                    const { applied, refused } = npcApplyUpdates(parsedUpdates, { messageIndex: chat.length - 1 });
                    if (applied.length) {
                        added = true;
                        const who = [...new Set(applied.map((e) => e.npc))].join(", ");
                        toastr.info(
                            applied.map((e) => `${e.label}: ${e.op === "+" ? "added" : e.op === "-" ? "removed" : "replaced"}`).join(" · "),
                            `Megumin Suite — ${who} updated`,
                        );
                    }
                    refused.forEach((r) => console.debug(`[Megumin Suite] NPC update declined for "${r.name}": ${r.reason}.`));
                }
                if (added) saveProfileToMemory();
            }
        }
    }

    // --- IMAGES THE STORY MODEL ASKED FOR (<img prompt="...">) ---
    const s = localProfile?.imageGen;
    if (!s || !s.enabled) return;
    const chat = getContext().chat;
    if (!chat || !chat.length) return;
    const lastMsg = chat[chat.length - 1];
    if (lastMsg.is_user || lastMsg.is_system) return;

    const imgRegexGlobal = /<img[^>]*?prompt=(["']?)([\s\S]*?)(?:\1\s*\/?>|\1\s*>|\1\s+[a-zA-Z]+=| \/>|>|$)/ig;
    const allMatches = [...lastMsg.mes.matchAll(imgRegexGlobal)];
    // Tags inside the thinking are the model planning, not asking.
    const lastThinkEnd = lastMsg.mes.lastIndexOf("</think>");
    const matches = allMatches.filter((m) => m.index > lastThinkEnd);
    if (!matches.length) return;

    const msgIndex = chat.length - 1;
    const injectMode = s.injectMode || "new_msg";
    const batchId = Date.now();
    let modifiedMes = lastMsg.mes;
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const placeholder = `<div id="kazuma-img-${batchId}-${i}" class="kazuma-img-placeholder" style="color:var(--gold); font-style: italic; margin: 10px 0;">[Generating Image...]</div>`;
        modifiedMes = injectMode === "inline"
            ? modifiedMes.substring(0, match.index) + placeholder + modifiedMes.substring(match.index + match[0].length)
            : modifiedMes.substring(0, match.index) + modifiedMes.substring(match.index + match[0].length);
    }
    lastMsg.mes = modifiedMes.trim();
    await saveChat();
    meguminScheduleBlocksRefresh();

    matches.forEach((match, idx) => {
        setTimeout(() => {
            toastr.info(`Image tag ${idx + 1} detected. Generating...`);
            igGenerateWithComfy(match[2], {
                message: lastMsg, index: msgIndex, mode: injectMode, isInlineAuto: true,
                placeholderId: `kazuma-img-${batchId}-${idx}`,
            });
        }, 500 + (idx * 1500));
    });
}

// -------------------------------------------------------------
// The window's own controls
// -------------------------------------------------------------

function bindWindowChrome() {
    const body = $(document);
    body.off(NS);

    body.on(`click${NS}`, ".sidebar-step", function () {
        const index = parseInt(String($(this).attr("id")).replace("dot_", ""), 10);
        if (!Number.isNaN(index)) switchTab(index);
    });

    body.on(`click${NS}`, "#ps_btn_power", (e) => { e.preventDefault(); setSuiteEnabled(!suiteEnabled()); });
    body.on(`click${NS}`, "#btn_apply_tab_all", toggleTabGlobalSync);

    body.on(`click${NS}`, "#ps_btn_save_close", () => {
        saveProfileToMemory();
        closeWindow();
        toastr.success("Workflow Configured & Applied Successfully!");
    });
    body.on(`click${NS}`, "#ps_btn_close", () => closeWindow());
    // A click on the dimmed backdrop, not on the window, closes it.
    body.on(`click${NS}`, "#prompt-slot-modal-overlay", function (e) { if (e.target === this) closeWindow(); });

    body.on(`click${NS}`, "#ps_btn_reset", () => {
        if (!confirm("Are you sure you want to completely reset this character's profile to the default template?")) return;
        cancelDebounce(_saveProfileDebouncedInner);
        const key = getCharacterKey() || "default";
        delete extension_settings[extensionName].profiles[key];
        saveSettingsDebounced();
        initProfile();
        switchTab(0);
        toastr.info("Profile has been reset to defaults.");
    });

    body.on(`click${NS}`, "#ps_btn_dev_mode", function (e) {
        e.preventDefault();
        if ($(this).text().includes("Exit Dev")) {
            if (isDevEngineDirty && !confirm("You have unsaved changes in your custom engine. Are you sure you want to exit? Changes will be lost.")) return;
            setDevEngineDirty(false);
            switchTab(0);
        } else {
            renderDevMode("landing");
        }
    });

    body.on(`input${NS}`, "#ps_main_current_rule", function () {
        localProfile.aiRule = $(this).val();
        saveProfileDebounced();
    });

    // The hover tooltip shared by the preset tags and the token badge.
    if (!$("#ps-global-tooltip").length) $(document.body).append('<div id="ps-global-tooltip"></div>');
    const tip = () => $("#ps-global-tooltip");
    body.on(`mouseenter${NS}`, ".ps-modern-tag", function () {
        const hint = $(this).attr("data-hint");
        if (!hint) return;
        tip().html(`<span class="ps-tooltip-title">${$(this).text().trim()}:</span> ${hint}`).addClass("visible");
    });
    body.on(`mousemove${NS}`, ".ps-modern-tag", function (e) {
        if (!$(this).attr("data-hint")) return;
        const t = tip();
        let x = e.clientX + 15;
        let y = e.clientY + 15;
        if (x + t.outerWidth() > window.innerWidth) x = e.clientX - t.outerWidth() - 15;
        if (y + t.outerHeight() > window.innerHeight) y = e.clientY - t.outerHeight() - 15;
        t.css({ left: `${x}px`, top: `${y}px` });
    });
    body.on(`mouseleave${NS}`, ".ps-modern-tag", () => tip().removeClass("visible"));
    body.on(`mouseenter${NS}`, "#ps_live_token_count", function () {
        const hint = $(this).attr("data-breakdown");
        if (hint) tip().html(hint).addClass("visible");
    });
    body.on(`mousemove${NS}`, "#ps_live_token_count", (e) => {
        const t = tip();
        t.css({ left: `${e.clientX - t.outerWidth() - 15}px`, top: `${e.clientY + 15}px` });
    });
    body.on(`mouseleave${NS}`, "#ps_live_token_count", () => tip().removeClass("visible"));
}

function closeWindow() {
    if (isDevEngineDirty) {
        if (!confirm("You have unsaved changes in your custom engine. Are you sure you want to close? Changes will be lost.")) return;
        setDevEngineDirty(false);
    }
    saveProfileToMemory();
    closeSettingsWindow();
}

// -------------------------------------------------------------
// setup
// -------------------------------------------------------------

export function setup(ctx) {
    setHostContext(ctx);
    const unsubBridge = initBridge(ctx);
    const removeStyles = ctx.dom.addStyle(MEGUMIN_STYLES);
    setPromptBuilder(handlePromptInjection);
    setEngineClonesReader(() => (extension_settings[extensionName] || {}).customModes || []);

    const appMount = ctx.ui.mountApp({ className: "megumin-suite-app", position: "end" });
    buildSettingsWindow(appMount);

    const launcher = ctx.ui.createFloatWidget({
        width: 52,
        height: 52,
        initialPosition: { x: 24, y: 160 },
        snapToEdge: true,
        tooltip: "Megumin Suite",
        chromeless: true,
    });

    // The profile is loaded again every time the window opens, before anything
    // is drawn, as index.js does: the open is the synchronisation point, so the
    // window never edits a profile that belongs to a chat it missed a switch to.
    buildLauncher(launcher, () => {
        openSettingsWindow();
        (async () => {
            // Opened before startup finished: wait for the settings to load
            // first, or the window draws (and saves) an empty profile.
            await booted;
            // Settings may have been changed from another browser or device
            // since this page loaded; the window edits the latest copy.
            await hydrate();
            await refreshContext();
            initProfile();
            updateCharacterDisplay();
            switchTab(0);
        })().catch((err) => console.error("[Megumin Suite] could not open the settings window:", err));
    });

    bindWindowChrome();

    // A click on one of the suite's images opens it with its prompt and Regenerate.
    bindKazumaImageViewer();

    // The tag interceptors go on first: the host keeps the chat hidden until
    // they are attached, so raw <Blocks> never flashes on screen.
    attachBlockCards();

    // The quick-generate button lives in the input bar's Extras menu.
    let quickGen = null;
    try {
        quickGen = ctx.ui.registerInputBarAction({ id: "megumin-quick-image", label: "Visualize last scene", iconSvg: iconSvg("fa-image"), enabled: false });
        quickGen.onClick(() => igManualGenerate());
        setQuickGenAction(quickGen);
    } catch (e) { /* older host */ }

    const unsubPush = onPush("prompt:build", (data) => { buildPrompt(data); });
    const unsubHost = bindHostEvents(ctx);

    // ── The suite's own listeners (index.js) ────────────────────────────────
    eventSource.on(event_types.APP_READY, () => {
        cleanGhostProfiles();
        meguminCompactStoredPrompts();
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // A save debounced at 500ms would die when initProfile swaps the
        // profile. Flush it under the OLD key first.
        cancelDebounce(_saveProfileDebouncedInner);
        flushProfileSettingsToLoadedKey();
        initProfile();
        updateCharacterDisplay();
        if (isSettingsWindowOpen()) switchTab(currentTab);
        // Chomusuke's jobs for the chat you left: stopped, not run for nothing.
        stopJobsForOtherChats();
        if (stateOnChatLoaded()) meguminScheduleBlocksRefresh();
        refreshSoon();
    });
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        pruneFutureData();
        if (stateOnDeleted()) meguminScheduleBlocksRefresh();
    });
    setWorldStateChangedHook(() => { meguminScheduleBlocksRefresh(); v2LooksForArrivals(); });
    eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => { if (stateOnSwiped(mesId)) meguminScheduleBlocksRefresh(); });
    eventSource.on(event_types.MESSAGE_SWIPE_DELETED, (data) => { if (stateOnSwipeDeleted(data)) meguminScheduleBlocksRefresh(); });
    eventSource.on(event_types.MESSAGE_EDITED, (mesId) => { if (stateOnEdited(mesId)) meguminScheduleBlocksRefresh(); });
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    const retryAll = () => setTimeout(() => {
        const chat = getContext().chat || [];
        for (let i = 0; i < chat.length; i++) addKazumaRetryButtons(i);
    }, 300);
    [event_types.CHAT_CHANGED, event_types.MESSAGE_SWIPED, event_types.MESSAGE_UPDATED, event_types.MESSAGE_EDITED,
        event_types.CHARACTER_MESSAGE_RENDERED].forEach((evt) => eventSource.on(evt, retryAll));
    [event_types.CHARACTER_MESSAGE_RENDERED, event_types.MESSAGE_SWIPED, event_types.MESSAGE_UPDATED,
        event_types.MESSAGE_EDITED, event_types.GENERATION_ENDED].forEach((evt) => eventSource.on(evt, () => meguminScheduleBlocksRefresh(120)));

    // ── Flush pending saves when the tab is hidden or closed ────────────────
    let hideFlushed = false;
    const flushOnHide = () => {
        if (hideFlushed) return;
        hideFlushed = true;
        cancelDebounce(_saveProfileDebouncedInner);
        if (getCharacterKey()) saveProfileToMemory();
        else flushProfileSettingsToLoadedKey();
        flushSettings();
        saveMetadata();
    };
    const onVisibility = () => {
        if (document.visibilityState === "hidden") flushOnHide();
        else hideFlushed = false;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushOnHide);

    // window.megumin: a console handle for checking the port by hand.
    window.megumin = {
        context: () => getContext(),
        profile: () => localProfile,
        settings: () => extension_settings[extensionName],
        refresh: () => refreshContext(),
        refreshBlocks: () => meguminScheduleBlocksRefresh(0),
        debugBlocks: (i) => meguminDebugBlocks(i),
        buildPrompt: async (messages) => { const work = messages.map((m) => ({ ...m })); await handlePromptInjection({ chat: work }, "normal"); return work; },
        call,
        buildQuietMessages,
        generateQuietPrompt,
        activeRequests,
    };

    // ── Boot ────────────────────────────────────────────────────────────────
    let markBooted;
    const booted = new Promise((r) => { markBooted = r; });
    (async () => {
        await hydrate();
        cleanLegacySettings();
        migrateRenamedTabs();
        migrateUtilityPrefillFlag();
        dropLookResidue();
        await refreshContext();
        initProfile();
        initChomusukeIndicator();
        syncPowerUI();
        ready = true;
        markBooted();
        await eventSource.emit(event_types.APP_READY);
        if (getContext().chatId) {
            if (stateOnChatLoaded()) meguminScheduleBlocksRefresh();
            refreshSoon();
            retryAll();
        }
    })().catch((err) => {
        console.error("[Megumin Suite] failed to start:", err);
        $("#ps_stage_content").html('<div class="megumin-boot-error">Megumin Suite could not start. See the browser console for details.</div>');
    });

    return () => {
        ready = false;
        unsubHost.forEach((fn) => typeof fn === "function" && fn());
        unsubPush && unsubPush();
        unsubBridge && unsubBridge();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", flushOnHide);
        quickGen && quickGen.destroy();
        launcher.destroy();
        appMount.destroy();
        stopWatchingIcons();
        $(document).off(NS);
        $("#ps-global-tooltip").remove();
        removeStyles();
        ctx.dom.cleanup();
        delete window.megumin;
    };
}
