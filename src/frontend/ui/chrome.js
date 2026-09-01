// ─────────────────────────────────────────────────────────────────────────────
// The settings window's own controls: the dock, the header buttons, the
// tooltips.
//
// All of this lived loose in index.js in the SillyTavern build, as a run of
// `$("body").on(...)` calls among the extension's other startup. It is gathered
// here because it is one thing — the chrome around the tabs, as opposed to
// anything a tab draws for itself — and because leaving it in the entry point is
// how it came to be missed entirely on the first pass, which left a dock whose
// icons did nothing.
//
// Every binding is DELEGATED, from the document, and every one is namespaced and
// removed before it is re-added. That is not defensive habit, it is required:
// switchTab() empties and refills the stage on every tab change, so a handler
// bound to an element inside it dies with the first switch; and setup() can run
// again when the extension reloads, so a binding that is not removed first is
// simply added twice and fires twice.
// ─────────────────────────────────────────────────────────────────────────────

import { $, toastr, extension_settings, saveSettingsDebounced, cancelDebounce } from "../host.js";
import { extensionName } from "../core/constants.js";
import { localProfile, isDevEngineDirty, setDevEngineDirty } from "../core/state.js";
import { getCharacterKey } from "../core/keys.js";
import {
    initProfile,
    saveProfileToMemory,
    saveProfileDebounced,
    _saveProfileDebouncedInner,
} from "../core/profile.js";
import { switchTab, toggleTabGlobalSync } from "./tabs.js";
import { renderDevMode } from "./devmode.js";
import { closeSettingsWindow } from "./window.js";

const NS = ".meguminChrome";

export function bindWindowChrome() {
    const body = $(document);

    // One namespace for the lot, so a re-bind cannot leave a stale handler
    // behind no matter which of these changes.
    body.off(NS);

    // ── The dock ─────────────────────────────────────────────────────────────
    //
    // The single most important binding in the extension: without it the icons
    // down the left edge render and do nothing at all.
    body.on(`click${NS}`, ".sidebar-step", function () {
        const index = parseInt(String($(this).attr("id")).replace("dot_", ""), 10);
        if (!Number.isNaN(index)) switchTab(index);
    });

    // ── Header buttons ───────────────────────────────────────────────────────

    body.on(`click${NS}`, "#ps_btn_save_close", function () {
        saveProfileToMemory();
        closeSettingsWindow();
        toastr.success("Workflow Configured & Applied Successfully!");
    });

    body.on(`click${NS}`, "#ps_btn_close", function () {
        closeSettingsWindow();
    });

    body.on(`click${NS}`, "#ps_btn_reset", function () {
        if (!confirm("Are you sure you want to completely reset this character's profile to the default template?")) return;

        // A save debounced by an edit made just before the click would fire
        // ~500ms from now, AFTER the delete, and write the old profile straight
        // back under the same live key. Drop it first, the same way the chat
        // switch does.
        cancelDebounce(_saveProfileDebouncedInner);

        const key = getCharacterKey() || "default";
        delete extension_settings[extensionName].profiles[key];
        saveSettingsDebounced();

        initProfile();
        switchTab(0);
        toastr.info("Profile has been reset to defaults.");
    });

    body.on(`click${NS}`, "#btn_apply_tab_all", toggleTabGlobalSync);

    body.on(`click${NS}`, "#ps_btn_dev_mode", function (e) {
        e.preventDefault();
        if ($(this).text().includes("Exit Dev")) {
            if (isDevEngineDirty
                && !confirm("You have unsaved changes in your custom engine. Are you sure you want to exit? Changes will be lost.")) {
                return;
            }
            setDevEngineDirty(false);
            switchTab(0);
        } else {
            renderDevMode("landing");
        }
    });

    // ── The one field that lives on the chrome rather than in a tab ─────────
    body.on(`input${NS}`, "#ps_main_current_rule", function () {
        localProfile.aiRule = $(this).val();
        saveProfileDebounced();
    });

    bindTooltips(body);
}

// The hover tooltip shared by the preset tags and the token badge.
//
// It is one floating element positioned at the cursor rather than a CSS
// `title`, because the token breakdown is a block of markup and the tag hints
// are long enough that the native tooltip's delay and wrapping make them
// useless.
function bindTooltips(body) {
    if (!$("#ps-global-tooltip").length) {
        $(document.body).append('<div id="ps-global-tooltip"></div>');
    }

    const tooltip = () => $("#ps-global-tooltip");

    body.on(`mouseenter${NS}`, ".ps-modern-tag", function () {
        const hint = $(this).attr("data-hint");
        if (!hint) return;
        const title = $(this).text().trim();
        tooltip().html(`<span class="ps-tooltip-title">${title}:</span> ${hint}`).addClass("visible");
    });

    body.on(`mousemove${NS}`, ".ps-modern-tag", function (e) {
        if (!$(this).attr("data-hint")) return;
        const t = tooltip();
        // Flip to the other side of the cursor rather than letting the box run
        // off the edge of the window.
        let x = e.clientX + 15;
        let y = e.clientY + 15;
        if (x + t.outerWidth() > window.innerWidth) x = e.clientX - t.outerWidth() - 15;
        if (y + t.outerHeight() > window.innerHeight) y = e.clientY - t.outerHeight() - 15;
        t.css({ left: `${x}px`, top: `${y}px` });
    });

    body.on(`mouseleave${NS}`, ".ps-modern-tag", () => tooltip().removeClass("visible"));

    body.on(`mouseenter${NS}`, "#ps_live_token_count", function () {
        const hint = $(this).attr("data-breakdown");
        if (!hint) return;
        tooltip().html(hint).addClass("visible");
    });

    body.on(`mousemove${NS}`, "#ps_live_token_count", function (e) {
        const t = tooltip();
        // Always to the LEFT: the badge sits in the top-right of the window, so
        // the usual offset would put the panel off-screen every time.
        t.css({ left: `${e.clientX - t.outerWidth() - 15}px`, top: `${e.clientY + 15}px` });
    });

    body.on(`mouseleave${NS}`, "#ps_live_token_count", () => tooltip().removeClass("visible"));
}

export function unbindWindowChrome() {
    $(document).off(NS);
    $("#ps-global-tooltip").remove();
}
