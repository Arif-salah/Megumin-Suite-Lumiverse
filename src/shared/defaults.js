// ─────────────────────────────────────────────────────────────────────────────
// The shape of a profile, with every field at its default.
//
// This was a local `const defaults` inside initProfile(), which was correct when
// the browser was the only thing that read a profile. It is not any more: the
// backend loads a stored profile to build the prompt, and a stored profile is
// only ever a PARTIAL — saveProfileToMemory strips the chat-scoped fields out
// before writing, and any field added since the profile was last saved is simply
// absent.
//
// Without a base to merge onto, the backend saw those gaps as undefined, and the
// engine lookup is the place that hurts:
//
//     const activeEngine = allAvailableModes.find(m => m.id === localProfile.mode)
//     const isV9 = activeEngine ? ... : false
//
// A missing or unknown `mode` makes every version flag false, which is not an
// error — it is the legacy V4 path. So a half-loaded profile does not throw, it
// quietly generates with a four-generation-old engine.
//
// Both runtimes now merge onto this. The browser fills a profile as it loads it,
// the backend fills one before the interceptor reads it, and neither can drift
// from the other because there is one copy of the shape.
// ─────────────────────────────────────────────────────────────────────────────

// The NPC dossier's field list is data, not a constant — the reader edits it —
// so the default profile takes its shape from the same place the NPC bank does
// rather than restating it.
import { NPC_DEFAULT_FIELDS } from "./npc/fields.js";

export const DEFAULT_PROFILE = {
    mode: "balance",
    personality: "engine",
    v9Limits: { leanMin: 300, leanMax: 400, fullMin: 700, fullMax: 1200 },
    toggles: { ooc: false, control: false },
    aiTags: [],
    aiGeneratedOptions: [],
    aiRule: "",
    customStyles: [],
    activeStyleId: null,
    storyConfig: {
        enabled: false,
        genre: "",
        tone: "",
        pov: "",
        pace: "",
        length: "",
        difficulty: "",
        friction: "",
        npcDisposition: "",
        explicitness: "",
        narratorPresence: "",
        focus: "",
        culture: "",
        era: "",
        npcSpeechStyle: "",
        notes: ""
    },
    dnRatio: {
        enabled: false,
        dialogue: 50
    },
    onomatopoeia: {
        enabled: false,
        useStyling: false
    },
    addons: [],
    blocks: [],
    // What sits inside the <Blocks> envelope, and in what order. `order` is
    // membership as well as sequence: a block not listed is not emitted.
    blockStack: {
        order: [],
        custom: [],
        overrides: {}
    },
    // Fields for the stat blocks. Their templates are generated from these,
    // so adding Jealousy or Mana is a setting, not a code change.
    statBlocks: {
        bonds: {
            fields: [
                { id: "mood", label: "Mood", type: "text", hint: "emotional surface" },
                { id: "affection", label: "Affection", type: "meter", max: 100, start: 20 },
                { id: "trust", label: "Trust", type: "meter", max: 100, start: 30 },
                { id: "desire", label: "Desire", type: "meter", max: 100, start: 0 }
            ]
        },
        sheet: {
            fields: [
                { id: "hp", label: "HP", type: "meter", max: 100, start: 100 },
                { id: "stamina", label: "Stamina", type: "meter", max: 100, start: 100 },
                { id: "gold", label: "Gold", type: "number", start: 0 },
                { id: "status", label: "Status", type: "text", ownLine: true, hint: "conditions, or \"none\"" },
                { id: "skills", label: "Skills", type: "list", ownLine: true, hint: "Name rank, comma separated" },
                { id: "inventory", label: "Inventory", type: "list", ownLine: true, hint: "items, or \"nothing\"" }
            ]
        }
    },
    model: "cot-v1-english",
    userNotes: "",
    userLanguage: "",
    userPronouns: "off",
    devOverrides: {},
    banList: [],
    banListBackend: "direct",
    banListCustomPrompts: null,
    banListCustomPromptsEnabled: false,
    customModes: [],
    thinkEffort: "unspecified",
    customThinkEffort: "100",
    storyPlan: {
        enabled: false,
        backend: "direct",
        triggerMode: "auto",
        autoFreq: 10,
        currentPlan: "",
        customPrompts: null,
        customPromptsEnabled: false,
        contentRating: "none",
        pacing: "natural",
        primaryGenre: "drama",
        flavorTags: [],
        directorsNote: "",
        unrestrictedContent: false,
        lastTrackerState: "",
        planMessageIndex: null
    },
    imageGen: {
        enabled: false,
        generatorBackend: "direct",
        injectMode: "inline",
        imageCount: 1,
        comfyUrl: "http://127.0.0.1:8188",
        currentWorkflowName: "",
        selectedModel: "",
        selectedLora: "", selectedLora2: "", selectedLora3: "", selectedLora4: "",
        selectedLoraWt: 1.0, selectedLoraWt2: 1.0, selectedLoraWt3: 1.0, selectedLoraWt4: 1.0,
        imgWidth: 1024, imgHeight: 1024,
        customNegative: "bad quality, blurry, worst quality, low quality",
        customSeed: -1,
        selectedSampler: "euler",
        compressImages: true,
        steps: 20, cfg: 7.0, denoise: 0.5, clipSkip: 1,
        promptTemplate: "illus_cinematic",
        includeExamples: true,
        directLanguage: false,
        injectNpcTags: false,
        promptExtra: "",
        triggerMode: "always",
        autoGenFreq: 1,
        previewPrompt: false,
        savedWorkflowStates: {},
        customPrompts: null,
        customPromptsEnabled: false
    },
    npcBank: {
        enabled: false,
        oocTrigger: false,
        sendPortraitsToAi: false,
        npcs: [],
        // The dossier's shape. The prompt template, the parser, the card and
        // the injected text are all generated from this, so adding a field
        // is a setting the reader changes rather than a code change.
        fields: JSON.parse(JSON.stringify(NPC_DEFAULT_FIELDS)),
        customPrompts: null,
        customPromptsEnabled: false,
        scanDepth: 60,
        ignoredNames: "",
        injectionLimit: 3
    }
};


// Fill a stored profile out to the full shape.
//
// Shallow-merges the nested objects one level down, because that is where the
// gaps actually appear — a profile written before v9Limits existed has no
// v9Limits at all, and `{ ...base, ...input }` alone would not put it back. It
// does NOT deep-merge arrays: blockStack.order and the NPC list are the user's
// content, and a default leaking into them would resurrect blocks they removed.
export function mergeProfile(raw) {
    const base = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
    if (!raw || typeof raw !== "object") return base;

    const merged = { ...base, ...raw };

    for (const key of Object.keys(base)) {
        const baseValue = base[key];
        const rawValue = raw[key];
        const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

        if (isPlainObject(baseValue) && isPlainObject(rawValue)) {
            merged[key] = { ...baseValue, ...rawValue };
        }
    }

    return merged;
}
