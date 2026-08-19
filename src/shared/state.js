// ─────────────────────────────────────────────────────────────────────────────
// The active profile, shared by both runtimes.
//
// In the SillyTavern build this lived in src/core/state.js and only the browser
// ever read it. Spindle splits the extension in two: the UI edits the profile in
// the browser, the interceptor reads it in the Bun worker. Both need the same
// shape, and neither may import the other's modules.
//
// So the profile object itself lives here, in shared/, and each runtime is
// responsible for filling it: the frontend after loading from the backend, the
// backend after reading its storage. Everything under shared/ then reads
// `localProfile` exactly the way it always did.
//
// ES module imports are live bindings, so readers see the current value with no
// extra work. Reassignment must go through the setter — an importer may not
// assign to an import.
// ─────────────────────────────────────────────────────────────────────────────

export let localProfile = {};

export function setLocalProfile(next) {
    localProfile = next || {};
}
