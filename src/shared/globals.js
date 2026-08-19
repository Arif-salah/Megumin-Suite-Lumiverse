// ─────────────────────────────────────────────────────────────────────────────
// Extension-wide settings — the things that are the same on every character and
// every chat: user-saved Story Config presets, the per-tab global-sync map, UI
// preferences.
//
// In the SillyTavern build these lived in extension_settings[extensionName],
// which every module could reach because SillyTavern handed the whole settings
// object to the browser. Spindle has no such object: settings are files under
// the backend's storage root, and the frontend cannot touch them directly.
//
// So this module plays the same role shared/state.js plays for the profile — it
// holds the object, and each runtime fills it from wherever that runtime gets
// its data (the frontend from a backend RPC, the backend from storage). Readers
// under shared/ carry on reading `globalSettings` as if nothing changed.
// ─────────────────────────────────────────────────────────────────────────────

export let globalSettings = {
    configPresets: [],
    globalSyncMap: {},
};

export function setGlobalSettings(next) {
    globalSettings = next || { configPresets: [], globalSyncMap: {} };
}
