// ─────────────────────────────────────────────────────────────────────────────
// Icons.
//
// SillyTavern ships Font Awesome as a webfont, so the suite's markup could write
// <i class="fa-solid fa-cubes"></i> and get a glyph for free. Lumiverse makes no
// such promise, and the icons are not decoration here — the settings dock is a
// column of them, so without a source they degrade to a column of blank boxes.
//
// The fix is Font Awesome's SVG package rather than the webfont. A webfont has
// to arrive as a data: URI (an extension has no static asset host), which means
// carrying every glyph in the bundle and betting that the host's CSP allows
// data: fonts. The SVG package carries only the icons that are imported and
// needs no font loading at all.
//
// What it does NOT give us is the <i class="fa-...">  markup the ~330 existing
// call sites are written in. Rather than rewrite all of them — which would touch
// every UI file to change nothing a user can see — hydrate() sweeps a container
// after render and swaps each <i> for the matching SVG. So the markup stays as
// it was, and the icon still appears.
//
// Adding an icon means importing it below. An <i> whose name is not in the map
// is left alone rather than blanked, so a missed import shows up as a missing
// icon in one spot instead of an exception that takes the whole pane down.
// ─────────────────────────────────────────────────────────────────────────────

import { icon as renderIcon, library, findIconDefinition } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";

// The whole solid set is registered rather than a hand-listed subset. The bundler
// cannot tree-shake it either way — the names are resolved from strings at
// runtime, not from imports — and a hand-listed subset would silently lose an
// icon every time someone added one to a template.
library.add(fas);

// Names the markup uses that Font Awesome either renamed or never had. Kept here
// rather than fixed in the templates so the templates stay comparable to the
// SillyTavern originals.
const ALIASES = {
    "fa-save": "floppy-disk",
    "fa-sparkles": "wand-magic-sparkles",
    "fa-refresh": "arrows-rotate",
    "fa-close": "xmark",
    "fa-remove": "xmark",
    "fa-cog": "gear",
    "fa-picture-o": "image",
    "fa-vial": "flask",
};

const svgCache = new Map();

// Returns the SVG markup for a Font Awesome class name, or "" if there is no
// such icon.
export function iconSvg(name) {
    if (svgCache.has(name)) return svgCache.get(name);

    const iconName = ALIASES[name] || name.replace(/^fa-/, "");
    let html = "";

    try {
        const definition = findIconDefinition({ prefix: "fas", iconName });
        if (definition) html = renderIcon(definition).html.join("");
    } catch (e) {
        html = "";
    }

    svgCache.set(name, html);
    return html;
}

// Swap every <i class="fa-solid fa-x"> inside `root` for its SVG.
//
// Called after each render. It is safe to call twice on the same subtree: the
// replacement is an <svg>, not an <i>, so a second sweep finds nothing left to
// do and costs one empty querySelectorAll.
export function hydrateIcons(root) {
    if (!root) return;

    for (const element of root.querySelectorAll("i[class*='fa-']")) {
        // The style/class the template put on the <i> is what positions and
        // colours the icon, so it has to survive onto the <svg> that replaces it.
        const classes = Array.from(element.classList);
        const name = classes.find((cls) => /^fa-/.test(cls) && !isFaModifier(cls));
        if (!name) continue;

        const html = iconSvg(name);
        if (!html) continue;

        const holder = document.createElement("span");
        holder.innerHTML = html;
        const svg = holder.firstElementChild;
        if (!svg) continue;

        for (const cls of classes) {
            if (cls !== name) svg.classList.add(cls);
        }
        if (element.getAttribute("style")) svg.setAttribute("style", element.getAttribute("style"));
        if (element.getAttribute("title")) svg.setAttribute("title", element.getAttribute("title"));

        element.replaceWith(svg);
    }
}

// fa-solid, fa-spin, fa-fw and friends are modifiers, not icon names. Picking one
// of them as the icon is the failure that turns a whole pane's icons into the
// same wrong glyph, so they are excluded explicitly.
function isFaModifier(cls) {
    return /^fa-(solid|regular|brands|light|thin|duotone|fw|spin|pulse|border|pull-left|pull-right|[0-9]+x|lg|sm|xs|rotate-90|rotate-180|rotate-270|flip-horizontal|flip-vertical|beat|fade|bounce|shake|spin-reverse|inverse|stack|stack-1x|stack-2x|li|ul)$/.test(cls);
}

// The launcher button's icon, needed as a raw string before any DOM exists.
export const LAUNCHER_ICON_SVG = iconSvg("fa-wand-magic-sparkles");
