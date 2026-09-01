// ────────────────────────────────────────────────────────────────────────────
// What runs after every AI reply.
//
// The Story Director capturing its tracker and evolving the directive, the NPC
// bank scanning for new faces and applying updates, and the image pipeline
// spotting <img prompt="..."> and sending it to ComfyUI.
//
// All of it lived loose in index.js in the SillyTavern build, inside one
// MESSAGE_RECEIVED handler. That file reads as bootstrap — it is mostly imports
// and event wiring — which is exactly why this was missed on the first pass, the
// same way the settings window's dock handlers were: real feature logic sitting
// among the plumbing. Nothing failed loudly. The model kept writing image tags
// and nothing ever fetched them.
//
// It is one module now because it is one pipeline: a reply arrives and several
// subsystems get a look at it, in order, sharing the same "is this still the
// chat I started in?" guard.
// ────────────────────────────────────────────────────────────────────────────

import { $, toastr, getContext, saveChat, updateMessageBlock } from "../host.js";
import { localProfile, _loadedProfileKey } from "../core/state.js";
import { extensionName } from "../core/constants.js";
import { meguminActiveDataIdentity, getCharacterKey } from "../core/keys.js";
import { saveProfileToMemory } from "../core/profile.js";
import { fireRefreshHook, REFRESH } from "../core/refreshHooks.js";
import { getChatForStoryDirector } from "../../shared/engine/chatText.js";
import { useMeguminEngine } from "../engine/tasks.js";
import { generateStoryPlanLogic } from "./storyplan/ui.js";
import { npcParseBlock, npcCreateRecord, meguminFindNpcDossiers } from "../../shared/npc/data.js";
import { npcParseUpdateBlocks, npcApplyUpdates } from "../../shared/npc/updates.js";
import { igGenerateWithComfy } from "./imagegen/index.js";
import { meguminScheduleBlocksRefresh } from "../blocks/chat.js";

// `renderNpcList` is reached through the refresh hook rather than imported: the
// NPC tab already imports this feature's neighbours, and calling its renderer
// directly is the cycle core/refreshHooks.js exists to prevent.
function renderNpcList() {
    fireRefreshHook(REFRESH.NPC_LIST);
}

// The image tag the model writes, and the one definition of it.
//
// debug.js reports what this would match. Reporting it with a second copy of the
// pattern would make the report true of the copy rather than of the pipeline —
// which is the failure mode a debug helper exists to avoid.
export const IMG_TAG_RE = /<img[^>]*?prompt=(["']?)([\s\S]*?)(?:\1\s*\/?>|\1\s*>|\1\s+[a-zA-Z]+=| \/>|>|$)/ig;

export async function onMessageReceived() {

    // --- STORY DIRECTOR FEEDBACK & AUTO-EVOLVE ---
    const sp = localProfile?.storyPlan;
    // Stamped next to the capture of `sp` itself: the auto-evolve below waits
    // 2 seconds and then awaits a full generation, so `sp` can easily belong to
    // a chat the user has left by the time the directive comes back.
    const spIdentity = meguminActiveDataIdentity();
    if (sp && sp.enabled) {
        const chat = getContext().chat;
        if (chat && chat.length > 0) {
            const lastIndex = chat.length - 1;
            const lastMsg = chat[lastIndex];
            if (!lastMsg.is_user && !lastMsg.is_system) {
            
                // 1. Extract the Tracker
                const trackerRegex = /<Story_Tracker[^>]*>([\s\S]*?)<\/Story_Tracker\s*>/i;
                const match = lastMsg.mes.match(trackerRegex);
                let needsEvolve = false;

                if (match) {
                    sp.lastTrackerState = match[1].trim();
                    saveProfileToMemory();
                
                    console.log(`[${extensionName}] 🎬 Story Tracker captured (kept visible).`);

                    // Check if we need to auto-evolve based on status (ONLY if not set to manual)
                    if (sp.triggerMode !== 'manual') {
                        // Looks for either arc_status or directive_status
                        const statusMatch = sp.lastTrackerState.match(/(?:directive_status|arc_status):\s*\[?(completed|pivoted|progressing|nearing_completion|nearing_climax)\]?/i);
                        if (statusMatch) {
                            const status = statusMatch[1].toLowerCase();
                            if (status === 'completed' || status === 'pivoted') {
                                needsEvolve = true;
                                console.log(`[${extensionName}] 🎬 Directive ${status}. Triggering smart auto-evolve.`);
                            }
                        }
                    }
                } else if (/<Story_Tracker/i.test(lastMsg.mes || "")) {
                    // Slice from the opening tag, not from character 0 — the tracker
                    // sits after the prose, so the first 200 characters of the message
                    // would show narration and none of the block that failed to parse.
                    const trackerMes = lastMsg.mes || "";
                    const trackerAt = Math.max(0, trackerMes.search(/<Story_Tracker/i));
                    console.debug(`[Megumin-Suite] <Story_Tracker> block present but unparseable in message ${lastIndex}`, trackerMes.slice(trackerAt, trackerAt + 200));
                }

                // 2. Frequency-based Trigger Fallback (ONLY if set to frequency)
                if (!needsEvolve && sp.triggerMode === 'frequency') {
                    const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;
                    if (aiMsgCount > 0 && aiMsgCount % sp.autoFreq === 0) {
                        needsEvolve = true;
                        console.log(`[${extensionName}] 🎬 Frequency safety net reached. Triggering auto-evolve.`);
                    }
                }

                // 3. Execute Auto-Evolve
                if (needsEvolve) {
                    toastr.info("Auto-Evolving Narrative Directive...", "Story Director");
                    setTimeout(async () => {
                        // getChatForStoryDirector(getContext().chat) reads whatever chat is open
                        // NOW, so once the chat has moved this would evolve the
                        // new chat's story into the old chat's plan. Checked here
                        // as well so a switch during the 2s wait costs no call.
                        if (meguminActiveDataIdentity() !== spIdentity) {
                            console.debug(`[Megumin-Suite] Story Director auto-evolve skipped: it was queued for "${spIdentity}" but "${meguminActiveDataIdentity()}" is active now.`);
                            return;
                        }
                        const chatText = getChatForStoryDirector(getContext().chat);
                        if (chatText.length < 100) return;
                        try {
                            let output = sp.backend === "direct" ? await generateStoryPlanLogic(chatText) : await new Promise(r => useMeguminEngine(async () => r(await generateStoryPlanLogic(chatText))));
                            if (meguminActiveDataIdentity() !== spIdentity) {
                                console.debug(`[Megumin-Suite] Story Director auto-evolve declined: the chat changed while the directive was generating ("${spIdentity}" to "${meguminActiveDataIdentity()}"). The new directive was discarded, not applied.`);
                                return;
                            }
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
                            }
                        } catch (e) { console.error("[Megumin Suite] Story Director auto-evolve failed", e); }
                    }, 2000); // Delay to let UI settle
                }
            }
        }
    }

    const s = localProfile?.imageGen;

    // AUTO-EXTRACT NPCs
    const npcBank = localProfile?.npcBank;
    // Stamped next to the capture of `npcBank`, the same way `sp` is stamped
    // above. This block never awaits, so the risk is not a chat switch mid-run:
    // it is that localProfile is ALREADY behind. CHAT_CHANGED reloads it 200ms
    // late, so a message arriving inside that window would parse the new chat's
    // dossiers and push them into the previous chat's bank. saveProfileToMemory()
    // would refuse to write that to disk, but the objects would stay in memory
    // and ride along on the next legitimate save.
    const npcLiveKey = getCharacterKey() || "default";
    if (npcBank && npcBank.enabled && _loadedProfileKey && npcLiveKey !== _loadedProfileKey) {
        console.debug(`[Megumin-Suite] NPC auto-extract declined: the NPC bank in memory belongs to "${_loadedProfileKey}" but this message arrived in "${npcLiveKey}". No NPCs were added, so none land in the wrong chat's bank.`);
    } else if (npcBank && npcBank.enabled) {
        const chat = getContext().chat;
        if (chat && chat.length) {
            const lastMsg = chat[chat.length - 1];
            if (!lastMsg.is_user && !lastMsg.is_system) {
                const dossiers = meguminFindNpcDossiers(lastMsg.mes);
                let added = false;
                let matched = dossiers.length > 0;
                for (const dossier of dossiers) {
                    const npcName = dossier.name;
                    const npcContent = dossier.raw;
                    if (!npcBank.npcs) npcBank.npcs = [];
                    if (!npcBank.npcs.find(n => (n.name || "").trim().toLowerCase() === npcName.toLowerCase())) {
                        // Parse structured fields from the raw block
                        const parsed = npcParseBlock(npcContent);
                        npcBank.npcs.push(npcCreateRecord({
                            parsed,
                            name: npcName,
                            messageIndex: chat.length - 1
                        }));
                        added = true;
                        toastr.success(`NPC added to Bank: ${npcName}`, "Megumin Suite");
                        if ($("#npc_bank_list").length) renderNpcList();
                    }
                }
                // --- APPLY DOSSIER UPDATES ---
                // After the new-NPC pass, so a dossier and an update
                // arriving in the same reply land in that order and
                // the update has someone to apply to.
                const parsedUpdates = npcParseUpdateBlocks(lastMsg.mes);
                if (parsedUpdates.length) {
                    const { applied, refused } = npcApplyUpdates(parsedUpdates, { messageIndex: chat.length - 1 });
                    if (applied.length) {
                        added = true;
                        const who = [...new Set(applied.map(e => e.npc))].join(", ");
                        toastr.info(
                            applied.map(e => `${e.label}: ${e.op === "+" ? "added" : e.op === "-" ? "removed" : "replaced"}`).join(" · "),
                            `Megumin Suite — ${who} updated`
                        );
                    }
                    // Refusals are the model going outside the field
                    // list it was given. Not worth a toast, but a
                    // silent drop is how a broken update block stays
                    // broken for weeks.
                    refused.forEach(r => console.debug(`[Megumin-Suite] NPC update declined for "${r.name}": ${r.reason}.`));
                }

                if (added) saveProfileToMemory();
                if (!matched && /New[ _]NPC/i.test(lastMsg.mes || "")) {
                    // Slice from the block opener, not from character 0, so the debug
                    // line shows the dossier that failed to parse rather than prose.
                    const npcMes = lastMsg.mes || "";
                    const npcAt = Math.max(0, npcMes.search(/New[ _]NPC/i));
                    console.debug(`[Megumin-Suite] New NPC block present but unparseable in message ${chat.length - 1}`, npcMes.slice(npcAt, npcAt + 200));
                }
            }
        }
    }

    if (!s || !s.enabled) return;

    const chat = getContext().chat;
    if (!chat || !chat.length) return;

    const lastMsg = chat[chat.length - 1];
    if (lastMsg.is_user || lastMsg.is_system) return;

    // Look for the <img prompt="..."> tags in the AI's response (supports multiple)
    // A fresh instance every call. The shared pattern is /g, so reusing the same
    // object would carry lastIndex between messages and the next reply would
    // start scanning from wherever this one stopped.
    const imgRegexGlobal = new RegExp(IMG_TAG_RE.source, IMG_TAG_RE.flags);
    const allMatches = [...lastMsg.mes.matchAll(imgRegexGlobal)];

    // FILTER: Ignore any image tags that appear inside the <think>...</think> block
    const lastThinkEnd = lastMsg.mes.lastIndexOf("</think>");
    const matches = allMatches.filter(m => m.index > lastThinkEnd);

    if (matches.length > 0) {
        const msgIndex = chat.length - 1;
        const injectMode = s.injectMode || "new_msg";
        const batchId = Date.now();
    
        let modifiedMes = lastMsg.mes;

        // Iterate backwards so we can replace by exact index without shifting string positions
        for (let i = matches.length - 1; i >= 0; i--) {
            const match = matches[i];
            const uniquePlaceholderId = `kazuma-img-${batchId}-${i}`;
            const placeholder = `<div id="${uniquePlaceholderId}" class="kazuma-img-placeholder" style="color:var(--gold); font-style: italic; margin: 10px 0;">[Generating Image...]</div>`;

            if (injectMode === "inline") {
                modifiedMes = modifiedMes.substring(0, match.index) + placeholder + modifiedMes.substring(match.index + match[0].length);
            } else {
                modifiedMes = modifiedMes.substring(0, match.index) + modifiedMes.substring(match.index + match[0].length);
            }
        }

        lastMsg.mes = modifiedMes.trim();
        await saveChat();
    
        // Delay the UI update slightly so the host finishes rendering the message
        // before the block is rewritten under it.
        setTimeout(() => {
            updateMessageBlock(msgIndex, lastMsg);
            // The rebuild dropped the block card with the rest of the body.
            meguminScheduleBlocksRefresh();
        }, 100);

        // 2. Send the extracted prompts to ComfyUI!
        matches.forEach((match, idx) => {
            const extractedPrompt = match[2];
            const uniquePlaceholderId = `kazuma-img-${batchId}-${idx}`;
        
            setTimeout(() => {
                toastr.info(`Image tag ${idx + 1} detected. Sending to ComfyUI...`);
                igGenerateWithComfy(extractedPrompt, { 
                    message: lastMsg, 
                    index: msgIndex, 
                    mode: injectMode, 
                    isInlineAuto: true,
                    placeholderId: uniquePlaceholderId 
                });
            }, 500 + (idx * 1500)); // Stagger calls slightly to prevent overloading ComfyUI
        });
    }
}
