// Rewrites a file copied out of the SillyTavern tree so it builds here.
//
// The port is overwhelmingly a matter of import paths: the code inside these
// files is the same code, and the whole point of the host shim was that it
// could stay that way. Doing the rewrite by hand across forty-odd files is how
// you get one file quietly importing the wrong `localProfile` and a tab that
// renders against a stale profile with no error anywhere.
//
// So the mapping lives here, once, and is applied mechanically:
//
//   ../st.js                  -> the host shim, plus the jQuery and toast
//                                globals SillyTavern put on window, which the
//                                shim exports instead and which therefore have
//                                to be imported explicitly now.
//   data/, prompts/, blocks/  -> shared/, since the backend reads them too.
//   engine/                   -> shared/ for the pure parts, frontend/ for the
//                                task runner, which is now an RPC.
//
// Usage: node tools/port.mjs <src-relative-path> <dest-relative-path>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, join } from "node:path";

const ST_ROOT = "C:/Users/arifs/OneDrive/Desktop/Megumin-Suite-Beta";
const HERE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const [srcRel, destRel] = process.argv.slice(2);
if (!srcRel || !destRel) {
    console.error("usage: node tools/port.mjs <src> <dest>");
    process.exit(1);
}

const destPath = join(HERE, destRel);
let s = readFileSync(join(ST_ROOT, srcRel), "utf8").replace(/\r\n/g, "\n");

// Where each old module now lives, as a path from the repo root. The rewriter
// turns these into the correct number of "../" for wherever the file landed.
const MOVED = {
    "st.js": "src/frontend/host.js",
    "core/constants.js": "src/frontend/core/constants.js",
    "core/state.js": "src/frontend/core/state.js",
    "core/keys.js": "src/frontend/core/keys.js",
    "core/profile.js": "src/frontend/core/profile.js",
    "core/sync.js": "src/frontend/core/sync.js",
    "core/tokens.js": "src/frontend/core/tokens.js",
    "core/refreshHooks.js": "src/frontend/core/refreshHooks.js",
    "core/activeRequests.js": "src/shared/engine/activeRequests.js",
    "utils/html.js": "src/frontend/utils/html.js",
    "utils/regex.js": "src/shared/utils/regex.js",
    "utils/download.js": "src/frontend/utils/download.js",
    "prompts/index.js": "src/shared/prompts/index.js",
    "prompts/defaults.js": "src/shared/prompts/defaults.js",
    "prompts/storage.js": "src/shared/prompts/storage.js",
    "engine/chatText.js": "src/shared/engine/chatText.js",
    "engine/buildBaseDict.js": "src/shared/engine/buildBaseDict.js",
    "engine/tasks.js": "src/frontend/engine/tasks.js",
    "features/blocks/registry.js": "src/shared/blocks/registry.js",
    "features/blocks/chat.js": "src/frontend/blocks/chat.js",
    "features/blocks/ui.js": "src/frontend/features/blocks/ui.js",
    "features/storyconfig/config.js": "src/shared/storyconfig/config.js",
    "features/storyconfig/ui.js": "src/frontend/features/storyconfig/ui.js",
    "features/storyplan/ui.js": "src/frontend/features/storyplan/ui.js",
    "features/banlist/ui.js": "src/frontend/features/banlist/ui.js",
    "features/npc/fields.js": "src/shared/npc/fields.js",
    "features/npc/data.js": "src/shared/npc/data.js",
    "features/npc/updates.js": "src/shared/npc/updates.js",
    "features/npc/ui.js": "src/frontend/features/npc/ui.js",
    "features/npc/pfp.js": "src/frontend/features/npc/pfp.js",
    "features/npc/updateCard.js": "src/frontend/features/npc/updateCard.js",
    "features/imagegen/index.js": "src/frontend/features/imagegen/index.js",
    "ui/tabs.js": "src/frontend/ui/tabs.js",
    "ui/devmode.js": "src/frontend/ui/devmode.js",
    "ui/promptEditor.js": "src/frontend/ui/promptEditor.js",
    "ui/progress.js": "src/frontend/ui/progress.js",
    "ui/launcher.js": "src/frontend/ui/window.js",
    "blocks/render.js": "src/frontend/blocks/render.js",
    "blocks/text.js": "src/frontend/blocks/text.js",
    "blocks/treatments.js": "src/frontend/blocks/treatments.js",
};

// data/ sits beside src/ in both trees, so it maps by name rather than by table.
function resolveTarget(spec, fromDir) {
    const cleaned = spec.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");

    let target = MOVED[cleaned];
    if (!target && /^data\//.test(cleaned)) target = "src/shared/" + cleaned;
    if (!target) return null;

    let rel = relative(dirname(join(HERE, destRel)), join(HERE, target)).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return rel;
}

s = s.replace(/from "([^"]+)"/g, (whole, spec) => {
    if (!spec.startsWith(".")) return whole;
    const rel = resolveTarget(spec, destRel);
    return rel ? `from "${rel}"` : whole;
});

// jQuery and toastr were globals on window. The shim exports them, so a file
// that uses them needs them named in its import list.
const needs = [];
if (/(^|[^A-Za-z0-9_$])\$\(/m.test(s)) needs.push("$");
if (/\btoastr\./.test(s)) needs.push("toastr");

if (needs.length) {
    const hostImport = new RegExp(`^import \\{([^}]*)\\} from "([^"]*host\\.js)";`, "m");
    if (hostImport.test(s)) {
        s = s.replace(hostImport, (whole, names, path) => {
            const have = names.split(",").map((n) => n.trim()).filter(Boolean);
            for (const n of needs) if (!have.includes(n)) have.unshift(n);
            return `import { ${have.join(", ")} } from "${path}";`;
        });
    } else {
        // No host import at all — add one above the first import in the file.
        let rel = relative(dirname(join(HERE, destRel)), join(HERE, "src/frontend/host.js")).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = "./" + rel;
        s = s.replace(/^import /m, `import { ${needs.join(", ")} } from "${rel}";\nimport `);
    }
}

mkdirSync(dirname(destPath), { recursive: true });
writeFileSync(destPath, s, "utf8");

const unresolved = [...s.matchAll(/from "(\.[^"]+)"/g)]
    .map((m) => m[1])
    .filter((spec) => {
        const cleaned = spec.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
        return /^(st\.js|core\/|utils\/|prompts\/|engine\/|features\/|ui\/|blocks\/|data\/|sidepanel\/)/.test(cleaned);
    });

console.log(`ported ${srcRel} -> ${destRel}${unresolved.length ? "  UNRESOLVED: " + unresolved.join(", ") : ""}`);
