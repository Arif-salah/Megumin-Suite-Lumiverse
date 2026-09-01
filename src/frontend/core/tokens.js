// ────────────────────────────────────────────────────────────────────────────
// The live token counter in the settings footer.
//
// Counting tokens means building the whole prompt, and the prompt builder moved
// to the backend when the extension was split — it has to live where the
// interceptor runs. So this file keeps the badge and the hover breakdown, and
// asks the backend for the numbers instead of computing them.
//
// That makes the update async where it used to be synchronous, which matters in
// one place: the counter is refreshed on every keystroke that changes a setting,
// and a slow round trip would let an older reply land after a newer one and show
// a stale figure. `pending` below is the guard — each request takes a ticket, and
// a reply whose ticket is not the latest is dropped.
// ────────────────────────────────────────────────────────────────────────────

import { $ } from "../host.js";
import { localProfile } from "./state.js";
import { call } from "../bridge.js";
import { registerRefreshHook, REFRESH } from "./refreshHooks.js";

let latestTicket = 0;

export async function updateLiveTokenCount() {
    const counterBadge = $("#ps_live_token_count");
    if (!counterBadge.length) return;

    const ticket = ++latestTicket;

    let counts;
    try {
        // The live profile travels with the request. Asking the backend to
        // read it from storage means counting the PREVIOUS edit: the save is
        // debounced by 400ms and this fires the moment a setting changes.
        counts = await call("tokens:estimate", { profile: localProfile });
    } catch (e) {
        // A failed estimate is not worth a toast — the badge is an aid, not a
        // result. Leave whatever it last showed rather than blanking it.
        return;
    }

    if (ticket !== latestTicket) return;

    const { engine = 0, cot = 0, style = 0, addons = 0 } = counts || {};
    const total = engine + cot + style + addons;

    counterBadge.html(`<i class="fa-solid fa-microchip"></i> ~${total}`);

    counterBadge.attr("data-breakdown", `
        <div style="text-align:left; min-width: 160px; font-family: 'Inter', sans-serif;">
            <div style="border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 6px; margin-bottom: 6px; color: var(--gold); font-size: 0.8rem;"><b>Payload Breakdown</b></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem; margin-bottom: 4px;"><span>Engine Core:</span> <span style="color:#10b981; font-weight:bold;">~${engine}</span></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem; margin-bottom: 4px;"><span>CoT / Logic:</span> <span style="color:#3b82f6; font-weight:bold;">~${cot}</span></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem; margin-bottom: 4px;"><span>Style &amp; Config:</span> <span style="color:#a855f7; font-weight:bold;">~${style}</span></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem;"><span>Add-ons/Blocks:</span> <span style="color:#ef4444; font-weight:bold;">~${addons}</span></div>
        </div>
    `);
    counterBadge.css("cursor", "help");

    // Flash green to show it updated.
    counterBadge.css("color", "#10b981");
    setTimeout(() => counterBadge.css("color", "var(--text-muted)"), 400);
}

registerRefreshHook(REFRESH.TOKEN_COUNT, () => { void updateLiveTokenCount(); });
