import type { MeguminProfile } from "./types";

export const EXTENSION_ID = "megumin_suite";
export const EXTENSION_NAME = "Megumin Suite";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const DEFAULT_PROFILE: MeguminProfile = {
  mode: "v9-core",
  personality: "engine",
  toggles: {
    ooc: false,
    control: false,
    v7_ooc: true,
    v7_pcsolo: true,
    v7_culture: true,
    v7_scene: true,
    v7_intro: true,
    promptPreview: false
  },
  disableUtilityPrefill: false,
  aiTags: [],
  aiGeneratedOptions: [],
  aiRule: "",
  customStyles: [],
  activeStyleId: null,
  dnRatio: { enabled: false, dialogue: 50 },
  onomatopoeia: { enabled: false, useStyling: false },
  addons: [],
  blocks: [],
  // Paired with the default v9-core engine. A model id with no match in
  // hardcodedLogic.models silently disables thinking, so this has to name a
  // framework that actually exists.
  model: "cot-v9-english",
  userNotes: "",
  userWordCount: "",
  userLanguage: "",
  userPronouns: "off",
  banList: [],
  banListBackend: "direct",
  banListCustomPrompts: null,
  banListCustomPromptsEnabled: false,
  thinkEffort: "unspecified",
  customThinkEffort: "100",
  thinkingV2: false,
  v9Limits: { leanMin: 300, leanMax: 400, fullMin: 700, fullMax: 1200 },
  storyConfig: {
    enabled: false,
    genre: "",
    culture: "",
    era: "",
    pov: "",
    focus: "",
    tone: "",
    narratorPresence: "",
    npcSpeechStyle: "",
    npcDisposition: "",
    pace: "",
    difficulty: "",
    friction: "",
    explicitness: "",
    length: "",
    notes: ""
  },
  configPresets: [],
  // Empty by default: the reader chooses what the model emits. An empty stack
  // means [[blocks]] resolves to "" and is stripped, which is the intended
  // starting state rather than a failure.
  blockStack: { order: [], custom: [], overrides: {} },
  statBlocks: {
    bonds: {
      fields: [
        { id: "mood", label: "Mood", type: "text", hint: "emotional surface" },
        { id: "affection", label: "Affection", type: "meter", max: 100, start: 20 },
        { id: "trust", label: "Trust", type: "meter", max: 100, start: 30 },
        { id: "desire", label: "Desire", type: "meter", max: 100, start: 0 }
      ]
    },
    sheet: { fields: [] }
  },
  worldState: { compactEnabled: false, fullFreq: 5 },
  storyPlan: {
    enabled: false,
    backend: "direct",
    triggerMode: "manual",
    autoFreq: 10,
    currentPlan: "",
    contextLimit: 100,
    contentRating: "none",
    pacing: "natural",
    primaryGenre: "drama",
    flavorTags: [],
    directorsNote: "",
    unrestrictedContent: false,
    customPrompts: null,
    customPromptsEnabled: false
  },
  imageGen: {
    enabled: false,
    generatorBackend: "direct",
    comfyUrl: "http://127.0.0.1:8188",
    currentWorkflowName: "",
    savedWorkflowStates: {},
    connectionId: "",
    selectedModel: "",
    selectedSampler: "euler",
    scheduler: "",
    selectedLora: "",
    selectedLora2: "",
    selectedLora3: "",
    selectedLora4: "",
    selectedLoraWt: 1,
    selectedLoraWt2: 1,
    selectedLoraWt3: 1,
    selectedLoraWt4: 1,
    imgWidth: 1024,
    imgHeight: 1024,
    customNegative: "bad quality, blurry, worst quality, low quality",
    customSeed: -1,
    steps: 20,
    cfg: 7,
    denoise: 0.5,
    clipSkip: 1,
    promptStyle: "standard",
    promptPerspective: "scene",
    promptExtra: "",
    triggerMode: "manual",
    autoGenFreq: 1,
    previewPrompt: false,
    imageCount: 1,
    includeExamples: true,
    directLanguage: false,
    injectNpcTags: false,
    customPrompts: null,
    customPromptsEnabled: false
  },
  npcBank: {
    enabled: false,
    sendPortraitsToAi: false,
    npcs: [],
    customPrompts: null,
    customPromptsEnabled: false
  }
};

export function mergeProfile(raw: unknown): MeguminProfile {
  const base = clone(DEFAULT_PROFILE);
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Partial<MeguminProfile>;
  const merged = { ...base, ...input } as MeguminProfile;
  merged.toggles = { ...base.toggles, ...(input.toggles || {}) };
  merged.dnRatio = { ...base.dnRatio, ...(input.dnRatio || {}) };
  merged.onomatopoeia = { ...base.onomatopoeia, ...(input.onomatopoeia || {}) };
  // Profiles saved before V9 have no v9Limits at all, so this fills the band in
  // rather than leaving the engine to stringify undefined into the prompt.
  merged.v9Limits = { ...base.v9Limits, ...(input.v9Limits || {}) };
  merged.storyConfig = { ...base.storyConfig, ...(input.storyConfig || {}) };
  merged.worldState = { ...base.worldState, ...(input.worldState || {}) };
  merged.configPresets = Array.isArray(input.configPresets) ? input.configPresets : [];
  merged.blockStack = {
    ...base.blockStack,
    ...(input.blockStack || {}),
    order: Array.isArray(input.blockStack?.order) ? input.blockStack.order : [],
    custom: Array.isArray(input.blockStack?.custom) ? input.blockStack.custom : [],
    overrides: input.blockStack?.overrides || {}
  };
  merged.statBlocks = {
    ...base.statBlocks,
    ...(input.statBlocks || {})
  };
  merged.storyPlan = {
    ...base.storyPlan,
    ...(input.storyPlan || {}),
    flavorTags: Array.isArray(input.storyPlan?.flavorTags) ? input.storyPlan.flavorTags : []
  };
  merged.imageGen = { ...base.imageGen, ...(input.imageGen || {}) };
  merged.userWordCount = String((input as any).userWordCount ?? base.userWordCount);
  merged.userLanguage = String((input as any).userLanguage ?? base.userLanguage);
  merged.customThinkEffort = String((input as any).customThinkEffort ?? base.customThinkEffort);
  merged.npcBank = {
    ...base.npcBank,
    ...(input.npcBank || {}),
    npcs: input.npcBank?.npcs || []
  };
  return merged;
}
