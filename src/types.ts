export type Role = "system" | "user" | "assistant";

export type LlmMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string };

export interface LlmMessage {
  role: Role;
  content: string | LlmMessagePart[];
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  swipe_id?: number;
  swipes?: string[];
}

export interface ChatContext {
  chatId: string | null;
  chatName?: string | null;
  characterId: string | null;
  characterName: string;
  characterAvatarUrl?: string | null;
  isGroup?: boolean;
  groupName?: string | null;
  scope: string;
}

export interface EngineMode {
  id: string;
  label: string;
  color?: string;
  recommended?: boolean;
  isNew?: boolean;
  isCoreClone?: boolean;
  [key: string]: unknown;
}

/**
 * Every Story Config field is a single string. Empty means the field is off and
 * its line never reaches the prompt.
 */
export interface StoryConfig {
  enabled: boolean;
  [key: string]: string | boolean;
}

export interface StoryConfigPreset {
  id: string;
  name: string;
  builtin?: boolean;
  values: Record<string, string>;
}

export interface StatField {
  id: string;
  label: string;
  type: "text" | "meter" | "number" | "list";
  hint?: string;
  max?: number;
  start?: number;
  /** Character Sheet only: render on its own line rather than the inline run. */
  ownLine?: boolean;
}

export interface CustomBlock {
  id: string;
  name: string;
  tag: string;
  content: string;
}

/** Membership *and* order: a block not listed in `order` is never emitted. */
export interface BlockStack {
  order: string[];
  custom: CustomBlock[];
  /** Per-block body overrides, keyed by block id. */
  overrides: Record<string, string>;
}

export interface NpcRecord {
  name: string;
  age?: string;
  sex?: string;
  appearance?: string;
  occupation?: string;
  background?: string;
  innerCircle?: string;
  personality?: string;
  agenda?: string;
  hiddenLayer?: string;
  pfp?: string;
  pfpImageId?: string;
  pfpImageUrl?: string;
  timestamp: number;
}

export type UtilityBackend = "direct" | "preset";

export interface ImageGenSettings {
  enabled: boolean;
  generatorBackend: UtilityBackend;
  comfyUrl: string;
  currentWorkflowName: string;
  savedWorkflowStates: Record<string, Partial<ImageGenSettings>>;
  connectionId: string;
  selectedModel: string;
  selectedSampler: string;
  scheduler: string;
  selectedLora: string;
  selectedLora2: string;
  selectedLora3: string;
  selectedLora4: string;
  selectedLoraWt: number;
  selectedLoraWt2: number;
  selectedLoraWt3: number;
  selectedLoraWt4: number;
  imgWidth: number;
  imgHeight: number;
  customNegative: string;
  customSeed: number;
  steps: number;
  cfg: number;
  denoise: number;
  clipSkip: number;
  promptStyle: "standard" | "illustrious" | "sdxl";
  promptPerspective: "scene" | "pov" | "character";
  promptExtra: string;
  triggerMode: "always" | "manual" | "frequency" | "conditional";
  autoGenFreq: number;
  previewPrompt: boolean;
}

export interface StoryPlanSettings {
  enabled: boolean;
  backend: UtilityBackend;
  triggerMode: "manual" | "frequency";
  autoFreq: number;
  currentPlan: string;
}

export interface NpcBankSettings {
  enabled: boolean;
  sendPortraitsToAi: boolean;
  npcs: NpcRecord[];
}

export interface MeguminProfile {
  mode: string;
  personality: string;
  toggles: Record<string, boolean>;
  disableUtilityPrefill: boolean;
  aiTags: string[];
  aiGeneratedOptions: string[];
  aiRule: string;
  customStyles: Array<{ id: string; name: string; notes?: string; rule: string }>;
  activeStyleId: string | null;
  dnRatio: { enabled: boolean; dialogue: number };
  onomatopoeia: { enabled: boolean; useStyling: boolean };
  addons: string[];
  blocks: string[];
  model: string;
  userNotes: string;
  userWordCount: string;
  userLanguage: string;
  userPronouns: "off" | "male" | "female";
  banList: string[];
  banListBackend: UtilityBackend;
  thinkEffort: "unspecified" | "100" | "250" | "450" | "custom";
  customThinkEffort: string;
  thinkingV2: boolean;
  /**
   * V9 response length bands. V9 engines ask for a lean reply most turns and a
   * full one when the scene earns it, so they take a range rather than the single
   * word count the older engines used.
   */
  v9Limits: { leanMin: number; leanMax: number; fullMin: number; fullMax: number };
  /** Standing story settings, compiled into the <config> block. */
  storyConfig: StoryConfig;
  /** Saved Story Config presets. Global — they follow the user across characters. */
  configPresets: StoryConfigPreset[];
  /** What sits inside the <Blocks> envelope, and in what order. */
  blockStack: BlockStack;
  /** Field lists the Bonds and Character Sheet templates are generated from. */
  statBlocks: Record<string, { fields: StatField[] }>;
  /** Compact World State: a short block most turns, the full one every Nth. */
  worldState: { compactEnabled: boolean; fullFreq: number };
  storyPlan: StoryPlanSettings;
  imageGen: ImageGenSettings;
  npcBank: NpcBankSettings;
}

export interface PromptBuildResult {
  messages: LlmMessage[];
  breakdown: Array<{ messageIndex: number; name: string }>;
  /** Always 0. Prompt-level pruning belonged to Memory Core, which this port drops. */
  prunedCount: number;
  replacementsMade: number;
  changedMessages: Array<{ messageIndex: number; replacementsMade: number }>;
  estimatedInjectionTokens: number;
}

export interface RpcEnvelope<T = unknown> {
  type: string;
  requestId?: string;
  payload?: T;
}

export interface RpcResponse<T = unknown> {
  type: "rpc:result" | "rpc:error";
  requestId?: string;
  payload?: T;
  error?: string;
}
