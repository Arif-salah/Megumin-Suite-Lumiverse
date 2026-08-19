// Identity constants. Kept apart from state.js because these never change at
// runtime, and because almost every module wants extensionName for the settings
// lookup — importing that shouldn't drag mutable state along.
//
// extensionName is now the Spindle manifest `identifier` rather than the folder
// name SillyTavern used. It has to match spindle.json exactly: the backend keys
// its storage by it, and a mismatch means the UI reads an empty settings object
// and silently shows every tab as untouched.

export const extensionName = "megumin_suite";
export const TARGET_PRESET_NAME = "Megumin Engine";
