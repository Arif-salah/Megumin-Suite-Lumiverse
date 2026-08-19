// -------------------------------------------------------------
// CUSTOM PROMPT STORAGE (diff against DEFAULT_PROMPTS)
// -------------------------------------------------------------
// Editing one prompt key seeds the whole block from DEFAULT_PROMPTS and then
// syncPromptsGlobally() broadcasts that block into EVERY stored profile. Written out
// in full that costs (profile count x ~17KB): one install reached 99 profiles holding
// 1.6MB of prompt text that was only 4 distinct values, and settings.json got big
// enough to be a problem. Only the keys that actually differ from DEFAULT_PROMPTS are
// stored; meguminFillPrompts() restores the rest on load, so every reader downstream
// still sees a complete block and no call site had to change.
//
// A key whose text equals the built-in default is dropped and re-derived from
// DEFAULT_PROMPTS on load. That is the same thing `customPrompts: null` already meant,
// but it does mean such a key follows the built-in default if a later version rewrites
// it, instead of staying pinned to the old wording.

import { DEFAULT_PROMPTS, MEGUMIN_PROMPT_MODULES } from "./defaults.js";

export function meguminDiffPrompts(prompts, moduleName) {
    const base = DEFAULT_PROMPTS[moduleName];
    if (!prompts || typeof prompts !== 'object' || !base) return prompts ?? null;
    const diff = {};
    for (const [k, v] of Object.entries(prompts)) {
        // Keys the defaults no longer define are kept as-is: they are either a user
        // addition or a leftover from an older build, and neither is ours to discard.
        if (!(k in base) || JSON.stringify(v) !== JSON.stringify(base[k])) diff[k] = v;
    }
    return Object.keys(diff).length > 0 ? diff : null;
}

export function meguminFillPrompts(prompts, moduleName) {
    const base = DEFAULT_PROMPTS[moduleName];
    // null stays null. It already means "use the built-in prompts", every reader
    // handles it, and inflating it here would turn an untouched module into stored data.
    if (!prompts || typeof prompts !== 'object' || !base) return prompts;
    for (const [k, v] of Object.entries(base)) {
        if (prompts[k] === undefined) prompts[k] = JSON.parse(JSON.stringify(v));
    }
    return prompts;
}

// Shrink every prompt block on a profile that is about to be written to settings.
// Mutates in place, so callers must hand it a clone and never localProfile itself:
// the live profile has to stay complete for the editor UI to render.
export function meguminSparsifyProfilePrompts(prof) {
    if (!prof || typeof prof !== 'object') return prof;
    for (const mod of MEGUMIN_PROMPT_MODULES) {
        if (prof[mod] && prof[mod].customPrompts) {
            prof[mod].customPrompts = meguminDiffPrompts(prof[mod].customPrompts, mod);
        }
    }
    if (prof.banListCustomPrompts) {
        prof.banListCustomPrompts = meguminDiffPrompts(prof.banListCustomPrompts, 'banList');
    }
    return prof;
}

// The load-side inverse. Runs on localProfile so the editor and every prompt builder
// see full text regardless of how little of it was on disk.
export function meguminRehydrateProfilePrompts(prof) {
    if (!prof || typeof prof !== 'object') return prof;
    for (const mod of MEGUMIN_PROMPT_MODULES) {
        if (prof[mod] && prof[mod].customPrompts) {
            meguminFillPrompts(prof[mod].customPrompts, mod);
        }
    }
    if (prof.banListCustomPrompts) {
        meguminFillPrompts(prof.banListCustomPrompts, 'banList');
    }
    return prof;
}

// The pre-diff repair pass (meguminCompactStoredPrompts) is not carried over. It
// existed to fold down profiles written by builds that stored every prompt in full,
// and no such profile can exist here — the Lumiverse build has only ever written the
// sparse form. Reintroducing it would mean maintaining a migration for a state this
// extension cannot reach.
