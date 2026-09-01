// ────────────────────────────────────────────────────────────────────────────
// Drawing the master block card into chat messages.
//
// The chat side of blocks, kept apart from the Blocks TAB: the tab's preview
// renders through the dict builder, which sits at the top of the dependency
// graph, while this only needs the registry. Splitting there lets image gen ask
// for a redraw without pulling the settings UI in behind it.
//
// ── Why this is the one file the port rewrote rather than moved ─────────────
//
// The SillyTavern version walked `#chat .mes`, read each bubble's `mesid`
// attribute, looked the raw text up in the live chat array, and rewrote the
// bubble's `.mes_text` in place — stripping the block tags out of the prose and
// putting a card where they had been.
//
// Every step of that is unavailable here. Lumiverse's chat list is VIRTUALIZED:
// only bubbles near the viewport exist in the DOM at all, so a sweep finds a
// changing subset and anything written into a bubble is destroyed when the
// reader scrolls it away and back. There is no `mesid` attribute to read —
// the host says explicitly that the underlying one is private and that
// ctx.dom.getMessageId() is the contract. And rewriting the host's own rendered
// markup to remove the tags means guessing at its internal structure.
//
// Spindle answers all three directly, so this uses its answers:
//
//   registerTagInterceptor({ tagName: "Blocks", removeFromMessage: true })
//     The host strips the envelope out of the rendered message for us and hands
//     back its inner text plus the message id. That replaces both the tag
//     scraping and the "hide the raw text" half, and it works DURING streaming —
//     the reader sees a processing indicator instead of raw XML scrolling past,
//     which the SillyTavern build never managed.
//
//   ctx.dom.inject(bubble, ...)
//     Injections are re-attached automatically when a bubble remounts, so the
//     card survives scrolling. That is what makes the virtualized list a
//     non-issue rather than a permanent redraw loop.
//
// The card itself — extractBlocks, buildBlocksCard, the treatments — is the
// original code, untouched. Only the way it is attached changed.
// ────────────────────────────────────────────────────────────────────────────

import { getHostContext, getContext } from "../host.js";
import { extensionName } from "../core/constants.js";
import { extractBlocks, buildBlocksCard } from "./render.js";
import { meguminRenderRegistry, meguminBlocksTakenByPanel } from "../../shared/blocks/registry.js";
// One directed edge from blocks to the NPC feature. No cycle: nothing under
// features/npc/ imports the block card.
import { npcDecorateUpdatePane } from "../features/npc/updateCard.js";

// ── Clicking a choice ────────────────────────────────────────────────────────
//
// The card renderer knows nothing about the host — it is handed a callback and
// calls it. This is that callback, and it lives here because the chat is the
// only surface where a choice means anything. The BLOCKS tab preview passes no
// callback, so its buttons are inert by construction rather than by a flag
// someone has to remember to set.
//
// Plain click FILLS the input rather than sending. A choice is a suggestion, and
// the reader almost always wants to add to it — "3. Follow her out" becomes
// "Follow her out, but hang back at the door". Shift sends as-is.
function meguminApplyChoice(text, { send = false } = {}) {
    // Lumiverse's composer is not a documented surface, so the textarea is found
    // by trying the shapes a chat composer takes, most specific first. If none
    // matches, the click does nothing rather than throwing — a choice that does
    // not fill the box is a small disappointment; an exception here takes the
    // whole card's event handling down.
    const ta = document.querySelector(
        "textarea[data-chat-input], form textarea, main textarea, textarea",
    );
    if (!ta) return;

    // Appended, not replaced. Something half-typed in the box is the reader's
    // work and must not be thrown away by a click.
    const existing = String(ta.value || "").replace(/\s+$/, "");
    const next = existing ? `${existing} ${text}` : text;

    // React controls this textarea, so assigning .value directly is invisible to
    // it — the component's state still holds the old string and overwrites ours
    // on the next render. Going through the native setter and then dispatching
    // `input` is what makes React observe the change.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(ta, next);
    else ta.value = next;

    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    try { ta.selectionStart = ta.selectionEnd = ta.value.length; } catch (e) { /* not fatal */ }

    if (!send) return;

    // Enter is the composer's own send path, whatever button is drawn for it.
    ta.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, bubbles: true,
    }));
}

// ── Attaching cards ──────────────────────────────────────────────────────────

// What the interceptors have told us about each message, by message id. Held
// because a tag fires once, as the message renders, while the card may need
// rebuilding several times after that.
//
// Two sources per message, because the blocks arrive in two places:
//
//   envelope — the single <Blocks> section at the END of the reply, holding
//              World State, the chatter, the sheet and the rest.
//   lead     — <Dice>, which is deliberately NOT in the envelope. A roll has to
//              be written before the prose or it is not a roll: a number chosen
//              after the scene exists is chosen to fit it. So the model writes
//              it first, and there may be several in one reply — one per roll,
//              or one tag holding every line, depending on the model.
const blocksByMessage = new Map();   // messageId -> envelope inner text
const leadByMessage = new Map();     // messageId -> array of <Dice> inner texts

// The injected wrapper per message, so a rebuild replaces its card instead of
// stacking a second one underneath.
const cardByMessage = new Map();

let unsubscribers = [];

export function attachBlockCards() {
    const ctx = getHostContext();
    if (!ctx || !ctx.messages || typeof ctx.messages.registerTagInterceptor !== "function") return;

    unsubscribers.forEach((fn) => { try { fn(); } catch (e) { /* already gone */ } });
    unsubscribers = [];

    // SillyTavern had to find and hide this text in the rendered DOM — a
    // backward walk for the envelope, a forward walk for the lead, and a pile of
    // guards to keep either from eating the prose when the model put a blank
    // line somewhere unexpected. None of that is needed here: removeFromMessage
    // has the HOST take the tag out before it ever renders, which is both exact
    // and visible during streaming. render.js still ships those walkers; they
    // are simply unreachable on this platform.
    const on = (tagName, handle) => ctx.messages.registerTagInterceptor(
        { tagName, removeFromMessage: true },
        (payload) => {
            if (!payload || payload.isUser) return;
            if (payload.isStreaming) return;   // wait for the closing tag
            if (!payload.messageId) return;
            handle(payload.messageId, payload.content || "");
            renderCardFor(payload.messageId);
        },
    );

    unsubscribers.push(on("Blocks", (id, content) => blocksByMessage.set(id, content)));

    // Appended, not replaced: the tag is `repeating`, so each roll fires this
    // separately and overwriting would leave only the last one on screen.
    unsubscribers.push(on("Dice", (id, content) => {
        const rolls = leadByMessage.get(id) || [];
        rolls.push(content);
        leadByMessage.set(id, rolls);
    }));

    // Messages already on screen when the extension loads never fire a tag — it
    // only fires as a message renders. Nothing can be done for those without
    // re-reading their text, so they keep their raw markup until they are
    // re-rendered. New replies, which is what the reader is looking at, are
    // handled from here on.
    return () => unsubscribers.forEach((fn) => fn && fn());
}

// Rebuild the tag text the extractor expects.
//
// extractBlocks() parses a raw message: it looks for <Tag>...</Tag> and reads
// the registry to decide what each one is. The host hands us the INSIDE of a
// tag instead, so the wrapper is put back before parsing rather than teaching
// the extractor a second input shape — that function is shared with the BLOCKS
// tab's preview and the two must not drift.
function sourceFor(messageId) {
    const rolls = leadByMessage.get(messageId) || [];

    // Every roll goes into ONE <Dice> tag rather than one tag each.
    //
    // The registry marks the block `repeating`, so a reply with three rolls
    // fires the interceptor three times, and three tags would come back out of
    // the extractor as three separate blocks — which the card draws as three
    // tabs holding one number apiece. The upstream renderer merges consecutive
    // lead blocks into a single pane for exactly this reason; merging the SOURCE
    // reaches the same place without the card needing to know. The registry says
    // both shapes are valid input, so this is only picking the one that renders.
    const lead = rolls.length ? `<Dice>\n${rolls.join("\n")}\n</Dice>` : "";

    const envelope = blocksByMessage.get(messageId) || "";
    // Lead first, because that is message order: the roll is the first thing the
    // model wrote and the first thing that happened.
    return [lead, envelope].filter(Boolean).join("\n");
}

function renderCardFor(messageId) {
    const ctx = getHostContext();
    if (!ctx) return;

    // Both sources, not just the envelope. Reading blocksByMessage directly here
    // meant a reply that rolled but carried no envelope — an ordinary turn —
    // bailed on this line and drew no card at all.
    const source = sourceFor(messageId);
    if (!source) return;

    const bubble = ctx.dom.findMessageElement(messageId);
    // Not currently mounted. Nothing to do this tick — the injection is replayed
    // by the host when the bubble comes back, and the entry stays in the map so
    // a later rebuild still has its source text.
    if (!bubble) return;

    try {
        const blocks = extractBlocks(source, meguminRenderRegistry());
        if (!blocks.length) return;

        const card = buildBlocksCard(blocks, {
            omit: meguminBlocksTakenByPanel(),
            onChoice: meguminApplyChoice,
        });

        const previous = cardByMessage.get(messageId);
        if (previous) {
            // uninject, not remove: removing detaches the node but leaves the
            // host's replay record, which would resurrect the old card on the
            // next remount and leave two on screen.
            try { ctx.dom.uninject(previous); } catch (e) { /* already gone */ }
        }

        const wrapper = ctx.dom.inject(bubble, "<div class=\"meg-blocks-host\"></div>", "beforeend");
        wrapper.replaceChildren(card);
        cardByMessage.set(messageId, wrapper);

        // The NPC Update pane is redrawn from the CHANGELOG rather than from the
        // model's text, which is what gives each row its undo control. The card
        // renderer stays generic — it knows nothing about NPCs — so the pane is
        // found by block id afterwards and handed to the NPC feature.
        //
        // Rebuilding chat.js for this platform dropped this call, and the loss is
        // quiet: the pane still renders, just as the model's raw prose, with no
        // controls on it. That is indistinguishable from "the model wrote it that
        // way" unless you know what it should look like.
        //
        // The changelog is keyed by the message's INDEX, because SillyTavern
        // addressed messages by position. Here the tag interceptor gives an id,
        // so it is resolved against the chat mirror; a message not in the mirror
        // yet simply gets no decoration this pass.
        const pane = wrapper.querySelector('.meg-block-body[data-block-id="npcUpdate"]');
        if (pane) {
            const index = (getContext().chat || []).findIndex((m) => m && m.id === messageId);
            if (index >= 0) npcDecorateUpdatePane(pane, index);
        }
    } catch (e) {
        // Fail visible: the reader keeps whatever the message already showed,
        // which is what they had before this existed.
        console.debug(`[${extensionName}] block renderer skipped a message`, e);
    }
}

export let meguminBlocksRefreshTimer = null;

// Several things can rebuild a bubble — image generation, an edit, a swipe. Each
// drops the card, so every path that can rebuild one funnels through here, and
// the coalescing keeps a burst to a single pass.
export function scheduleBlockRefresh(delay = 60) {
    if (meguminBlocksRefreshTimer) clearTimeout(meguminBlocksRefreshTimer);
    meguminBlocksRefreshTimer = setTimeout(() => {
        meguminBlocksRefreshTimer = null;
        for (const messageId of blocksByMessage.keys()) renderCardFor(messageId);
    }, delay);
}

// The name the rest of the extension already calls.
export const meguminScheduleBlocksRefresh = scheduleBlockRefresh;
