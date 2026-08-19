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

import { getHostContext } from "../host.js";
import { extensionName } from "../core/constants.js";
import { extractBlocks, buildBlocksCard } from "./render.js";
import { meguminRenderRegistry, meguminBlocksTakenByPanel } from "../../shared/blocks/registry.js";

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

// What the interceptor has told us about each message, by message id. Held
// because the tag fires once, when the envelope is rendered, while the card may
// need rebuilding several times after that.
const blocksByMessage = new Map();

// The injected wrapper per message, so a rebuild replaces its card instead of
// stacking a second one underneath.
const cardByMessage = new Map();

let unsubscribeTag = null;

export function attachBlockCards() {
    const ctx = getHostContext();
    if (!ctx || !ctx.messages || typeof ctx.messages.registerTagInterceptor !== "function") return;

    if (unsubscribeTag) unsubscribeTag();

    unsubscribeTag = ctx.messages.registerTagInterceptor(
        { tagName: "Blocks", removeFromMessage: true },
        (payload) => {
            if (!payload || payload.isUser) return;
            if (payload.isStreaming) return; // wait for the closing tag

            const messageId = payload.messageId;
            if (!messageId) return;

            // `content` is the envelope's inner text; the extractor wants the
            // child tags, which is exactly what that is.
            blocksByMessage.set(messageId, payload.content || "");
            renderCardFor(messageId);
        },
    );

    // Messages already on screen when the extension loads never fire the tag —
    // it only fires as a message renders. Nothing can be done for those without
    // re-reading their text, so they keep their raw envelope until they are
    // re-rendered. New replies, which is what the reader is looking at, are
    // handled from here on.
    return unsubscribeTag;
}

function renderCardFor(messageId) {
    const ctx = getHostContext();
    if (!ctx) return;

    const source = blocksByMessage.get(messageId);
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
