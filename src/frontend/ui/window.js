// ─────────────────────────────────────────────────────────────────────────────
// The settings window and the launcher button that opens it.
//
// This is the markup that used to live in example.html and be appended to the
// page by index.js, reproduced here because a Spindle extension has no HTML file
// the host will load for it — everything reaches the DOM through JS.
//
// Two things it does NOT reproduce, both deliberately:
//
//   The overlay. index.js wrapped the window in #prompt-slot-modal-overlay and
//   faded it in and out itself. Here the window lives inside a Spindle app mount
//   ("app-overlay" position), so the host handles layering it under the sidebar
//   and modals. The mount is hidden and shown instead of the overlay.
//
//   The drag logic. ui/launcher.js carried ~150 lines of pointer handling to
//   make the button draggable and snap it to an edge, plus a localStorage entry
//   to remember where. Spindle's float widget does all of that natively, with
//   the position persisted by the host, so that code is dropped rather than
//   ported. The one part worth keeping is the click/drag discrimination — a
//   widget that opens the window every time the user finishes dragging it is
//   maddening — so bindLauncher() below still measures pointer travel.
// ─────────────────────────────────────────────────────────────────────────────

import { $, getContext } from "../host.js";
import { hydrateIcons, LAUNCHER_ICON_SVG } from "./icon.js";

const WINDOW_HTML = `
<div class="ps-modern-modal app-container">

    <!-- The Floating Glass Dock -->
    <div class="dock" id="ps_dynamic_dots">
        <!-- Icons injected by switchTab() -->
    </div>

    <div class="main-wrapper">
        <!-- The Full-Width Hero Banner -->
        <div class="hero-banner" id="ps_hero_banner">
            <div class="hero-overlay"></div>

            <div class="top-app-bar">
                <div class="app-actions">
                    <div id="ps_live_token_count" title="Estimated Payload Tokens"><i class="fa-solid fa-microchip"></i> ~0</div>
                    <button id="btn_apply_tab_all" class="ps-modern-btn secondary" title="When on, every change on this tab is applied to all characters and groups."><i class="fa-solid fa-earth-americas"></i> Global: Off</button>
                    <button id="ps_btn_reset" class="ps-modern-btn secondary"><i class="fa-solid fa-rotate-left"></i> Reset</button>
                    <button id="ps_btn_dev_mode" class="ps-modern-btn secondary"><i class="fa-solid fa-code"></i> Dev</button>
                    <div id="ps_save_indicator"><i class="fa-solid fa-check"></i> Saved</div>
                    <button id="ps_btn_save_close" class="ps-modern-btn primary"><i class="fa-solid fa-floppy-disk"></i> Save &amp; Close</button>
                    <button id="ps_btn_close" class="ps-modern-btn secondary" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>

            <div class="hero-content">
                <div class="status" id="ps_rule_status_main">Global Default</div>
                <h2 class="name" id="ps_char_rule_label">Lumiverse Profile</h2>
            </div>
        </div>

        <!-- Main Content Area -->
        <div class="main-content" id="ps_stage_content">
            <!-- Settings injected by the tab renderers -->
        </div>
    </div>

</div>
`;

let appMount = null;

// Build the window once, into the app mount's root. switchTab() empties and
// refills only #ps_stage_content after this, so the chrome, the dock and the
// scroll container all persist across tab changes.
export function buildSettingsWindow(mount) {
    appMount = mount;
    mount.root.classList.add("megumin-suite-app");
    mount.root.innerHTML = WINDOW_HTML;
    hydrateIcons(mount.root);
    mount.setVisible(false);
    return mount.root;
}

export function openSettingsWindow() {
    appMount && appMount.setVisible(true);
}

export function closeSettingsWindow() {
    appMount && appMount.setVisible(false);
}

export function isSettingsWindowOpen() {
    return !!(appMount && appMount.root && appMount.root.offsetParent !== null);
}

// -------------------------------------------------------------
// Launcher
// -------------------------------------------------------------

export function buildLauncher(widget, onOpen) {
    widget.root.className = "meg-float";
    widget.root.innerHTML =
        `<button class="meg-float-btn" type="button" title="Megumin Suite" aria-label="Megumin Suite">`
        + LAUNCHER_ICON_SVG
        + `</button>`;

    bindLauncher(widget.root.querySelector("button"), onOpen);
}

// A float widget is dragged by its contents, so the pointerup that ends a drag
// also lands on the button as a click. Measuring travel between pointerdown and
// pointerup separates "moved it" from "pressed it"; anything past a few pixels
// is a drag and the click is swallowed.
function bindLauncher(button, onOpen) {
    if (!button) return;

    const THRESHOLD_PX = 6;
    let start = null;
    let dragged = false;

    button.addEventListener("pointerdown", (event) => {
        start = { x: event.clientX, y: event.clientY };
        dragged = false;
    });

    button.addEventListener("pointerup", (event) => {
        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > THRESHOLD_PX) dragged = true;
        start = null;
    });

    button.addEventListener("pointercancel", () => {
        start = null;
        dragged = true;
    });

    // Capture phase, so the click is stopped before anything else sees it.
    button.addEventListener("click", (event) => {
        if (dragged) {
            dragged = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        onOpen();
    }, true);
}

// -------------------------------------------------------------
// Hero banner
// -------------------------------------------------------------

// The banner behind the window's title. SillyTavern served character avatars from
// /characters/<file>; Lumiverse serves them from its own REST route, which the
// backend hands us on the context object.
export function updateCharacterDisplay() {
    const context = getContext();
    const banner = $("#ps_hero_banner");
    if (!banner.length) return;

    const character = (context.characters || [])[context.characterId];
    const url = (character && character.avatarUrl) || null;

    // No avatar is a normal state (a fresh chat, a group), so the banner falls
    // back to its CSS gradient rather than a broken image.
    banner.css("background-image", url ? `url('${url}')` : "");

    $("#ps_char_rule_label").text(context.chatName || character?.name || "Lumiverse Profile");
}
