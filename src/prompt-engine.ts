import { DEFAULT_PROFILE, clone, mergeProfile } from "./defaults";
import type {
  ChatContext,
  ChatMessage,
  EngineMode,
  LlmMessage,
  MeguminProfile,
  NpcRecord,
  PromptBuildResult
} from "./types";
import { cleanChatText, npcBuildText } from "./text";
import { COMPACT_WORLD_STATE, buildBlocksEnvelope } from "./blocks";
import { buildConfigBlock } from "./story-config";
// The prompt database is the original Megumin prompt content, relocated into src.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { hardcodedLogic } from "./megumin-data.js";

type HardcodedLogic = {
  modes: EngineMode[];
  personalities: Array<{ id: string; label: string; content: string; recommended?: boolean }>;
  toggles: Record<string, { content: string; trigger: string; label: string }>;
  addons: Array<{ id: string; label: string; content: string; trigger: string }>;
  blocks: Array<{ id: string; label: string; content: string; trigger: string }>;
  models: Array<{ id: string; label?: string; content: string; prefill?: string }>;
};

const logic = hardcodedLogic as unknown as HardcodedLogic;

export function getLogic() {
  return logic;
}

export function allEngines(customEngines: EngineMode[] = []): EngineMode[] {
  return [...logic.modes, ...customEngines];
}

export function hydrateProfile(raw: unknown): MeguminProfile {
  return mergeProfile(raw);
}

function normalizeMacroTargets(text: string, context: ChatContext): string {
  return text
    .replace(/<BOT>/g, context.characterName || "the character")
    .replace(/<USER>/g, "the user");
}

function cleanEmptyLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(?:\r?\n[ \t]*){3,}/g, "\n\n")
    .trim();
}

const UNUSED_PLACEHOLDERS = [
  "[[long-Memory]]",
  "[[Short-memory]]",
  "[[prompt1]]",
  "[[prompt2]]",
  "[[prompt3]]",
  "[[prompt4]]",
  "[[prompt5]]",
  "[[prompt6]]",
  "[prompt1]",
  "[prompt2]",
  "[prompt3]",
  "[prompt4]",
  "[prompt5]",
  "[prompt6]",
  "[[AI1]]",
  "[[AI2]]",
  "[[main]]",
  "[[OOC]]",
  "[[control]]",
  "[[aiprompt]]",
  "[[death]]",
  "[[combat]]",
  "[[Direct]]",
  "[[DN]]",
  "[[COLOR]]",
  "[[infoblock]]",
  "[[summary]]",
  "[[cyoa]]",
  "[[COT]]",
  "[[prefill]]",
  "[[order]]",
  "[[Language]]",
  "[[pronouns]]",
  "[[banlist]]",
  "[[count]]",
  "[[MVU]]",
  "[[img1]]",
  "[[img2]]",
  "[[storyplan]]",
  "[[storytracker]]",
  "[[DNRATIO]]",
  "[[THINK]]",
  "[[onomato]]",
  "[[npc_events]]",
  "[[cyoa2]]",
  "[[infoblock2]]",
  "[[summary2]]",
  "[[storytracker2]]",
  "[[npc_inner_chatter]]",
  "[[npc_inner_chatter2]]",
  "[[npc_dossier]]",
  "[[npc_dossier2]]",
  "[[npc list]]",
  "[[v9_lean_min]]",
  "[[v9_lean_max]]",
  "[[v9_full_min]]",
  "[[v9_full_max]]",
  "[[config]]",
  "[[blocks]]"
];

export type PlaceholderHookGroup = {
  label: string;
  aliases: string[];
};

export type PlaceholderFeatureSpec = {
  id: string;
  label: string;
  hooks: PlaceholderHookGroup[];
  placeholders: string[];
};

function featureSpec(id: string, label: string, hooks: PlaceholderHookGroup[]): PlaceholderFeatureSpec {
  return {
    id,
    label,
    hooks,
    placeholders: [...new Set(hooks.flatMap((hook) => hook.aliases))]
  };
}

export const REQUIRED_PLACEHOLDER_FEATURES = [
  featureSpec("core-engines", "Core Engines", [
    { label: "prompt1 hook", aliases: ["[[prompt1]]", "[prompt1]"] },
    { label: "prompt2 hook", aliases: ["[[prompt2]]", "[prompt2]"] },
    { label: "prompt3 hook", aliases: ["[[prompt3]]", "[prompt3]"] },
    { label: "prompt4 hook", aliases: ["[[prompt4]]", "[prompt4]"] },
    { label: "prompt5 hook", aliases: ["[[prompt5]]", "[prompt5]"] },
    { label: "prompt6 hook", aliases: ["[[prompt6]]", "[prompt6]"] },
    { label: "main personality hook", aliases: ["[[main]]"] },
    { label: "AI1 prefill hook", aliases: ["[[AI1]]"] },
    { label: "AI2 prefill hook", aliases: ["[[AI2]]"] },
    { label: "OOC hook", aliases: ["[[OOC]]"] },
    { label: "control hook", aliases: ["[[control]]"] }
  ]),
  featureSpec("writing-style", "Writing Style", [{ label: "style hook", aliases: ["[[aiprompt]]"] }]),
  featureSpec("global-settings", "Global Settings", [
    { label: "language hook", aliases: ["[[Language]]"] },
    { label: "pronouns hook", aliases: ["[[pronouns]]"] },
    { label: "word count hook", aliases: ["[[count]]"] }
  ]),
  featureSpec("gameplay-addons", "Gameplay Add-ons", [
    { label: "death hook", aliases: ["[[death]]"] },
    { label: "combat hook", aliases: ["[[combat]]"] },
    { label: "directness hook", aliases: ["[[Direct]]"] },
    { label: "deep narration hook", aliases: ["[[DN]]"] },
    { label: "dialogue color hook", aliases: ["[[COLOR]]"] },
    { label: "NPC events hook", aliases: ["[[npc_events]]"] },
    { label: "onomatopoeia hook", aliases: ["[[onomato]]"] }
  ]),
  featureSpec("response-blocks", "Response Blocks", [
    { label: "info block hook", aliases: ["[[infoblock]]"] },
    { label: "summary hook", aliases: ["[[summary]]"] },
    { label: "CYOA hook", aliases: ["[[cyoa]]"] },
    { label: "CYOA display hook", aliases: ["[[cyoa2]]"] },
    { label: "MVU hook", aliases: ["[[MVU]]"] },
    { label: "NPC inner chatter hook", aliases: ["[[npc_inner_chatter]]"] },
    { label: "NPC inner chatter display hook", aliases: ["[[npc_inner_chatter2]]"] }
  ]),
  featureSpec("chain-of-thought", "Chain of Thought", [
    { label: "CoT framework hook", aliases: ["[[COT]]"] },
    { label: "prefill hook", aliases: ["[[prefill]]"] },
    { label: "thinking hook", aliases: ["[[THINK]]"] }
  ]),
  featureSpec("story-planner", "Story Planner", [
    { label: "story plan hook", aliases: ["[[storyplan]]"] },
    { label: "story tracker hook", aliases: ["[[storytracker]]"] },
    { label: "story tracker display hook", aliases: ["[[storytracker2]]"] }
  ]),
  featureSpec("image-generation", "Image Generation", [
    { label: "image instruction hook", aliases: ["[[img1]]"] },
    { label: "image tag hook", aliases: ["[[img2]]"] }
  ]),
  featureSpec("npc-bank", "NPC Bank", [
    { label: "NPC list hook", aliases: ["[[npc list]]"] },
    { label: "NPC dossier hook", aliases: ["[[npc_dossier]]"] },
    { label: "NPC dossier display hook", aliases: ["[[npc_dossier2]]"] }
  ]),
  featureSpec("story-config", "Story Config", [{ label: "config block hook", aliases: ["[[config]]"] }]),
  featureSpec("blocks-envelope", "Response Blocks Envelope", [{ label: "blocks envelope hook", aliases: ["[[blocks]]"] }]),
  featureSpec("dynamic-ban-list", "Dynamic Ban List", [{ label: "ban list hook", aliases: ["[[banlist]]"] }]),
  featureSpec("dialogue-narration", "Dialogue / Narration Ratio", [{ label: "D/N ratio hook", aliases: ["[[DNRATIO]]"] }])
] as const;

export type PlaceholderFeatureAudit = {
  id: string;
  label: string;
  placeholders: string[];
  present: string[];
  missing: string[];
  connected: boolean;
};

export function auditPresetPlaceholders(presentPlaceholders: Iterable<string>, hasScannedPreset: boolean): PlaceholderFeatureAudit[] {
  const presentSet = new Set(presentPlaceholders);
  return REQUIRED_PLACEHOLDER_FEATURES.map((feature) => {
    const placeholders = [...feature.placeholders];
    const present = placeholders.filter((placeholder) => presentSet.has(placeholder));
    const missing = hasScannedPreset
      ? feature.hooks
        .filter((hook) => !hook.aliases.some((placeholder) => presentSet.has(placeholder)))
        .map((hook) => hook.label)
      : [];
    return {
      id: feature.id,
      label: feature.label,
      placeholders,
      present,
      missing,
      connected: missing.length === 0
    };
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectedEngine(profile: MeguminProfile, customEngines: EngineMode[]): EngineMode {
  return allEngines(customEngines).find((mode) => mode.id === profile.mode) || logic.modes[0] || { id: "fallback", label: "Fallback" };
}

function getContent<T extends { id: string; content?: string }>(items: T[], id: string): string {
  return items.find((item) => item.id === id)?.content || "";
}

/**
 * Which prompt family an engine belongs to. Engines declare it with an isV7/isV8/
 * isV9 flag, but the id prefix is authoritative for the built-ins and for custom
 * engines cloned from them, so both are checked.
 */
function engineFamily(engine: EngineMode): { isV7: boolean; isV8: boolean; isV9: boolean } {
  const id = String(engine.id || "");
  return {
    isV7: id.startsWith("v7") || engine.isV7 === true,
    isV8: id.startsWith("v8") || engine.isV8 === true,
    isV9: id.startsWith("v9") || engine.isV9 === true
  };
}

/** The V7 director styles keep the user's rule verbatim rather than wrapping it. */
const V7_DIRECTOR_STYLES = new Set(["dir_v7", "dir_v7_core", "dir_v7_gentle"]);

/** Does this preset actually carry the [[blocks]] anchor? */
function presetUsesEnvelope(incoming: LlmMessage[]): boolean {
  return incoming.some((message) => {
    if (typeof message.content === "string") return message.content.includes("[[blocks]]");
    return message.content.some((part) => part.type === "text" && part.text.includes("[[blocks]]"));
  });
}

function buildBaseDict(
  profile: MeguminProfile,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext,
  usesEnvelope = false
): Record<string, string> {
  const dict: Record<string, string> = {};
  const activeEngine = selectedEngine(profile, customEngines);
  const allModes = allEngines(customEngines);
  const isCustom = !logic.modes.some((mode) => mode.id === activeEngine.id);
  const { isV7, isV8, isV9 } = engineFamily(activeEngine);

  const targetLang = profile.userLanguage.trim() ? profile.userLanguage.trim().toUpperCase() : "ENGLISH";
  dict.Language = `[LANGUAGE RULE]\nALL OUTPUT EXCEPT THINKING MUST BE IN ${targetLang} ONLY.`;
  dict.pronouns = profile.userPronouns === "male"
    ? "{{user}} is male. Always portray and address him as such."
    : profile.userPronouns === "female"
      ? "{{user}} is female. Always portray and address her as such."
      : "";

  // V9 asks for a length band per response shape rather than one flat maximum, so
  // the single word count is not meaningful for it and is emitted empty.
  const limits = profile.v9Limits || DEFAULT_PROFILE.v9Limits;
  dict.v9_lean_min = isV9 ? String(limits.leanMin || 300) : "";
  dict.v9_lean_max = isV9 ? String(limits.leanMax || 400) : "";
  dict.v9_full_min = isV9 ? String(limits.fullMin || 700) : "";
  dict.v9_full_max = isV9 ? String(limits.fullMax || 1200) : "";

  const wordCountStr = isV9 ? "" : profile.userWordCount.trim() || "";
  dict.count = wordCountStr ? `— maximum ${wordCountStr} words` : "";

  // Standing story settings. Empty when the config is off or every field is on
  // Default, so [[config]] is stripped rather than leaving an empty shell.
  dict.config = buildConfigBlock(profile.storyConfig);

  const personality = logic.personalities.find((item) => item.id === profile.personality);
  dict.main = personality?.content || "";
  dict.AI1 = profile.personality === "megumin" ? "Fine i read the rules." : "Understood.";
  dict.AI2 = profile.personality === "megumin" ? "OK i Understnd it." : "Understood.";
  dict.OOC = profile.toggles.ooc ? logic.toggles.ooc?.content || "" : "";
  dict.control = profile.toggles.control ? logic.toggles.control?.content || "" : "";

  for (let i = 1; i <= 6; i++) {
    dict[`prompt${i}`] = String(activeEngine[`p${i}`] || "");
  }

  if (isCustom && activeEngine.isCoreClone !== true) dict.main = "";
  if (typeof activeEngine.A1 === "string") dict.AI1 = activeEngine.A1;
  if (typeof activeEngine.A2 === "string") dict.AI2 = activeEngine.A2;

  // From V6 on the engine prompts carry the persona themselves.
  if (profile.mode.includes("v6-dream-team") || isV7 || isV8 || isV9) {
    dict.main = "";
  }

  // V7.5 is the narrator engine: it takes the user's rule as a narrator persona
  // and supplies its own when the user hasn't written one.
  if (profile.mode === "v7.5") {
    const narratorPersona = profile.aiRule.trim() ||
      "Adopt the narration of an unseen, witty observer who is vividly present in the scene. The narrator has a distinct personality—dry, occasionally judgmental, quietly amused, or sharply critical. Feel free to throw subtle shade at terrible decisions, point out the absurdity of a situation, or comment on the scene's chaos with a bit of comedic flair.";
    dict.aiprompt = `<Narration_style>\n narrator_persona: "${narratorPersona}"\n quarantine_rule: "CRITICAL: This opinionated voice applies STRICTLY and EXCLUSIVELY to the narration. It MUST NOT bleed into <NPC_dialogue>. NPCs do not share the narrator's wit or perspective; their dialogue remains entirely bound by their own demographics, stress levels, and individual flaws."\n proportional_prose: "Match narrative intensity to the event. A spilled coffee is just a minor annoyance, not a catalyst for dramatic prose. Zero purple prose. Use grounded metaphors sparingly to anchor a scene, not distract from it."\n</Narration_style>`;
  } else if (profile.aiRule.trim()) {
    dict.aiprompt = isV7 && !V7_DIRECTOR_STYLES.has(profile.activeStyleId || "")
      ? `<narrative_style>\n voice: ${profile.aiRule.trim()}\n  pacing: "Unhurried where it should be. A quiet moment can take a paragraph. A violent one can take a sentence. Match the rhythm to the content."\n  length_directive: "Typical outputs should run 3–6 substantial paragraphs, scaling with scene density. Lean toward the higher end during rich, atmospheric, or multi-character scenes. Go shorter — even a single paragraph — only when the moment genuinely demands economy: a held breath, a door closing, a line that hits harder alone. Never pad, never rush."\n</narrative_style>`
      : profile.aiRule.trim();
  } else {
    dict.aiprompt = "";
  }

  for (const addonId of profile.addons) {
    const item = logic.addons.find((addon) => addon.id === addonId);
    if (item?.trigger) dict[item.trigger.replace(/\[|\]/g, "")] = item.content;
  }

  for (const blockId of profile.blocks) {
    const item = logic.blocks.find((block) => block.id === blockId);
    if (item?.trigger) dict[item.trigger.replace(/\[|\]/g, "")] = item.content;
  }

  const model = logic.models.find((item) => item.id === profile.model);
  dict.COT = model?.content || "";
  dict.prefill = model?.prefill || "";

  if (profile.thinkEffort !== "unspecified" && dict.COT) {
    const effort = profile.thinkEffort === "custom" ? profile.customThinkEffort || "100" : profile.thinkEffort;
    dict.COT = `Your thinking must not be more than ${effort} words.\n\n${dict.COT}`;
  }

  dict.DNRATIO = profile.dnRatio.enabled
    ? `- Ratio: Maintain a balance of ${profile.dnRatio.dialogue}% Dialogue and ${100 - profile.dnRatio.dialogue}% Narration.`
    : "";
  dict.onomato = profile.onomatopoeia.enabled
    ? `- Narration must utilize onomatopoeia. Use precise, context-specific phonetic representations for physical interactions (e.g., the click of a latch, the thud of a heavy object, the soughing of wind) rather than abstract descriptions of sound.${profile.onomatopoeia.useStyling ? "\nAll onomatopoeic words must animated and colored using HTML and CSS. The selected style tag and color must objectively correspond to the physical nature or movement of the sound produced; for example, a repetitive friction sound such as \"shush-shush\" must utilize a sliding animation tag to represent the physical action." : ""}`
    : "";
  dict.MVU = profile.blocks.includes("mvu")
    ? (getContent(logic.blocks, "mvu") || "{main response}").replace("[[count]]", wordCountStr ? `maximum ${wordCountStr} words` : "...")
    : (wordCountStr ? `{main response — maximum ${wordCountStr} words}` : "{main response}");

  const overrides = [
    ["cot", "COT", true],
    ["prefill", "prefill", true],
    ["think", "THINK", profile.thinkingV2],
    ["info", "infoblock", profile.blocks.includes("info")],
    ["summary", "summary", profile.blocks.includes("summary")],
    ["cyoa", "cyoa", profile.blocks.includes("cyoa")],
    ["mvu", "MVU", profile.blocks.includes("mvu")],
    ["death", "death", profile.addons.includes("death")],
    ["combat", "combat", profile.addons.includes("combat")],
    ["direct", "Direct", profile.addons.includes("direct")],
    ["dn", "DN", profile.addons.includes("dn")],
    ["dialogueColor", "COLOR", profile.addons.includes("color")],
    ["npc_inner_chatter", "npc_inner_chatter", profile.blocks.includes("npc_inner_chatter") || profile.blocks.includes("npc_inner_chatter_v2")],
    ["storytracker", "storytracker", profile.storyPlan.enabled],
    ["language", "Language", true],
    ["pronouns", "pronouns", true],
    ["count", "count", true],
    ["dnratio", "DNRATIO", profile.dnRatio.enabled],
    ["onomato", "onomato", profile.onomatopoeia.enabled],
    ["banlist", "banlist", true]
  ] as const;

  for (const [source, target, condition] of overrides) {
    const value = activeEngine[source];
    if (condition && typeof value === "string" && value.trim()) dict[target] = value;
  }

  if (Array.isArray(activeEngine.customToggles)) {
    for (const customToggle of activeEngine.customToggles as Array<{ id?: string; attachPoint?: string; content?: string }>) {
      if (!customToggle?.id || !profile.toggles[customToggle.id]) continue;
      const targetKey = `prompt${String(customToggle.attachPoint || "").replace("p", "")}`;
      if (dict[targetKey] !== undefined && customToggle.content) {
        dict[targetKey] = `${dict[targetKey]}\n\n${customToggle.content}`.trim();
      }
    }
  }

  if (isV7) {
    if (!profile.toggles.v7_ooc) dict.prompt1 = dict.prompt1.replace(/<ooc_protocol>[\s\S]*?<\/ooc_protocol>/g, "");
    if (!profile.toggles.v7_pcsolo) dict.prompt4 = dict.prompt4.replace(/<pc_solo_physicality[\s\S]*?<\/pc_solo_physicality>/g, "");
    if (!profile.toggles.v7_culture) dict.prompt4 = dict.prompt4.replace(/<cultural_anchoring>[\s\S]*?<\/cultural_anchoring>/g, "");
    if (!profile.toggles.v7_scene) dict.prompt4 = dict.prompt4.replace(/<scene_choreography>[\s\S]*?<\/scene_choreography>/g, "");
    if (!profile.toggles.v7_intro) dict.prompt4 = dict.prompt4.replace(/\s*introduction_protocol:\s*"[^"]*"/g, "");
  }

  // V8 and V9 carry the writing style inside their own prompt bodies. The style is
  // folded in there and then wiped from the dict, because leaving it would also
  // emit it at the preset's own [[aiprompt]] anchor — the same rule twice.
  if (isV8 || isV9) {
    const styleValue = dict.aiprompt || "";
    for (let i = 1; i <= 6; i++) {
      const key = `prompt${i}`;
      if (dict[key]?.includes("[[aiprompt]]")) {
        dict[key] = dict[key].split("[[aiprompt]]").join(styleValue);
      }
    }
    dict.aiprompt = "";

    // Same reasoning for the persona scaffolding: these engines speak for
    // themselves and the preset's separate anchors would double them up.
    dict.OOC = "";
    dict.control = "";
    dict.AI1 = "";
    dict.AI2 = "";
  }

  if (profile.storyPlan.enabled && profile.storyPlan.currentPlan.trim()) {
    dict.storyplan = `<Story_Plan>\nThis is a possible event for the story, take from it:\n${profile.storyPlan.currentPlan.trim()}\n</Story_Plan>`;
    dict.storytracker = "<Story_Tracker>\narc: The Arc that is now active.\nchapter: The chapter that is now active.\nEpisode: The episode that is now active.\nSecrets: Any secret that the user/{{user}} doesn't know.\n</Story_Tracker>";
  } else {
    dict.storyplan = "";
    dict.storytracker = "";
  }

  dict.banlist = profile.banList.length > 0
    ? `[BAN LIST]\nNever rely on these clichés, tropes, or repetitive patterns. They are dead language:\n${profile.banList.map((item) => `- ${item}`).join("\n")}`
    : "";

  for (const [source, target, condition] of overrides) {
    const value = activeEngine[source];
    if (condition && typeof value === "string" && value.trim()) dict[target] = value;
  }

  // The thinking framework is delivered through [[THINK]], wrapped in the <think>
  // tags the model is expected to open with, and [[COT]] is then cleared so the
  // preset's separate CoT anchor does not emit the same framework a second time.
  // This runs after the overrides so an engine that ships its own cot/think wins.
  if (profile.model !== "cot-off" && dict.COT) {
    dict.THINK = profile.thinkingV2
      ? `<think>\n<think>\n<think>\n${dict.COT}\n</think>`
      : `<think>\n${dict.COT}\n</think>`;
    dict.COT = "";
  } else {
    dict.THINK = "";
  }

  const aiMessageCount = chatMessages.filter((msg) => msg.role === "assistant").length;
  const imageMode = profile.imageGen.triggerMode || "manual";
  const shouldInjectImage =
    profile.imageGen.enabled &&
    (imageMode === "always" ||
      (imageMode === "frequency" && (aiMessageCount + 1) % Math.max(1, profile.imageGen.autoGenFreq || 1) === 0) ||
      imageMode === "conditional");
  if (shouldInjectImage) {
    const style = profile.imageGen.promptStyle === "illustrious"
      ? "Use Danbooru-style tags focused on anime art."
      : profile.imageGen.promptStyle === "sdxl"
        ? "Use natural descriptive prose focused on photorealism."
        : "Use concise visual keywords.";
    const perspective = profile.imageGen.promptPerspective === "pov"
      ? "First-person POV."
      : profile.imageGen.promptPerspective === "character"
        ? "Focus on character appearance."
        : "Describe the scene and environment.";
    const conditional = imageMode === "conditional"
      ? "Only output the image tag if the character explicitly takes, sends, or shares an image in this moment.\n"
      : "";
    dict.img1 = `[IMAGE GENERATION]\n${conditional}Style: ${style}\nPerspective: ${perspective}${profile.imageGen.promptExtra ? `\nExtra: ${profile.imageGen.promptExtra}` : ""}`;
    dict.img2 = `<img prompt="prompt">`;
  } else {
    dict.img1 = "";
    dict.img2 = "";
  }

  const recentText = chatMessages.slice(-4).map((msg) => cleanChatText(msg.content)).join(" ").toLowerCase();
  const npcBlock = buildNpcInjection(profile.npcBank.npcs, recentText);
  dict.npcList = npcBlock;
  dict.npcDossier = profile.npcBank.enabled ? npcDossierDirective() : "";
  dict.npcDossierSlot = profile.npcBank.enabled ? "[NPC Dossier block here]" : "";

  // Memory Core is not part of this port. The hooks stay declared and empty so a
  // preset carrying [[long-Memory]] / [[Short-memory]] has them stripped along
  // with their lines rather than shipping raw tokens to the model.
  dict.longMemory = "";
  dict.shortMemory = "";

  if (profile.thinkingV2 && dict.prefill) {
    dict.prefill = dict.prefill.replace(/\n<think>[\s\S]*/, "\n<think>\n<think>");
  }
  if (profile.disableUtilityPrefill) dict.prefill = "";

  dict.cyoa2 = dict.cyoa ? "[CYOA block here]" : "";
  dict.infoblock2 = dict.infoblock ? "[Info block here]" : "";
  dict.summary2 = dict.summary ? "[Summary block here]" : "";
  dict.storytracker2 = dict.storytracker ? "[Story tracker here]" : "";
  dict.npc_inner_chatter2 = dict.npc_inner_chatter ? "[Npc inner chatter here]" : "";

  // Tokens that appear *inside* other tokens' values — the V9 length bands are
  // written into the V9 engine prompt bodies — have to be resolved before the
  // substituter runs, or they reach the model raw.
  const earlyTokens = [
    "count",
    "Language",
    "pronouns",
    "DNRATIO",
    "v9_lean_min",
    "v9_lean_max",
    "v9_full_min",
    "v9_full_max"
  ];
  for (const token of earlyTokens) {
    const value = dict[token] || "";
    const marker = `[[${token}]]`;
    for (const key of Object.keys(dict)) {
      if (key !== token && dict[key]?.includes(marker)) dict[key] = dict[key].split(marker).join(value);
    }
  }

  // ── Compact World State ─────────────────────────────────────────────────────
  // A short block most turns, the full one every Nth reply, so the running state
  // costs a fraction of the tokens without ever going stale.
  if (profile.blocks.includes("info") && dict.infoblock && profile.worldState?.compactEnabled) {
    const frequency = Math.max(1, profile.worldState.fullFreq || 5);
    if ((aiMessageCount + 1) % frequency !== 0) dict.infoblock = COMPACT_WORLD_STATE;
  }

  // The envelope carries one header above everything. These lines were written
  // when each block had to introduce itself, and inside the envelope they are noise.
  for (const key of ["infoblock", "npc_inner_chatter", "cyoa", "storytracker"]) {
    if (dict[key]?.trim()) {
      dict[key] = dict[key].replace(/# at the very end of the response put this block:\s*/gi, "");
    }
  }

  // ── The <Blocks> envelope ───────────────────────────────────────────────────
  dict.blocks = buildBlocksEnvelope(profile, dict);

  // With the envelope in play, the loose per-block anchors would emit each block a
  // second time, so they are blanked.
  //
  // The V9 beta blanks these unconditionally and treats a preset with no [[blocks]]
  // anchor as a visible failure that emits nothing. This port still ships and
  // supports the V7 presets, which carry the per-block anchors and no [[blocks]], so
  // the anchors are surrendered only to a preset that actually asked for the
  // envelope. Keying off the envelope merely being non-empty is not enough: the
  // system blocks (Story Tracker, New NPC) populate it whenever their subsystem is
  // on, which would strip [[storytracker]] out of a V7 preset that has nowhere else
  // to put it.
  //
  // [[npc_dossier]] is deliberately NOT blanked: it is the dossier *rules*, not the
  // block, and the envelope's slot line refers back to them.
  //
  // cyoa/cyoa2 are in this list where the beta's is missing them. The beta's own
  // comment says the anchors are blanked so a block is not emitted twice, but CYOA
  // was left out, so a V9.1 preset carrying both [[cyoa]] and [[blocks]] shipped the
  // whole CYOA template to the model twice. Verified against the real preset.
  if (usesEnvelope && dict.blocks.trim()) {
    const owned = [
      "infoblock", "infoblock2",
      "cyoa", "cyoa2",
      "npc_inner_chatter", "npc_inner_chatter2",
      "storytracker", "storytracker2",
      "npcDossierSlot"
    ];
    for (const key of owned) dict[key] = "";
  }

  for (const key of Object.keys(dict)) dict[key] = normalizeMacroTargets(dict[key], context);
  return dict;
}

function placeholderMapFromDict(dict: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  const set = (placeholder: string, value: string | undefined) => {
    map[placeholder] = value || "";
  };

  for (const [key, value] of Object.entries(dict)) {
    set(`[[${key}]]`, value);
  }

  for (let index = 1; index <= 6; index += 1) {
    set(`[prompt${index}]`, dict[`prompt${index}`]);
  }

  set("[[long-Memory]]", dict.longMemory);
  set("[[Short-memory]]", dict.shortMemory);
  set("[[npc list]]", dict.npcList);
  set("[[npc_dossier]]", dict.npcDossier);
  set("[[npc_dossier2]]", dict.npcDossierSlot);
  return map;
}

export function buildMeguminReplacementMap(
  rawProfile: unknown,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext,
  usesEnvelope = false
): Record<string, string> {
  const profile = hydrateProfile(rawProfile || DEFAULT_PROFILE);
  return placeholderMapFromDict(buildBaseDict(profile, customEngines, chatMessages, context, usesEnvelope));
}

export function estimateMeguminPayloadTokens(
  rawProfile: unknown,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext,
  presentPlaceholders?: Set<string>
): number {
  const replacements = buildMeguminReplacementMap(rawProfile, customEngines, chatMessages, context);
  const counted = new Set<string>();
  let chars = 0;
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (presentPlaceholders && !presentPlaceholders.has(placeholder)) continue;
    const text = String(value || "").trim();
    if (!text || counted.has(text)) continue;
    counted.add(text);
    chars += text.replace(/\s+/g, " ").length;
  }
  return Math.max(0, Math.ceil(chars / 4));
}

function replacePlaceholderText(content: string, replacements: Record<string, string>): { content: string; replacementsMade: number; changed: boolean } {
  let next = content;
  let replacementsMade = 0;
  let changed = false;

  for (const [placeholder, replacement] of Object.entries(replacements)) {
    if (!next.includes(placeholder)) continue;
    const processed = replacement || "";
    if (processed.trim() === "") {
      next = next.replace(new RegExp(`^[ \\t]*${escapeRegex(placeholder)}[ \\t]*\\r?\\n?`, "gm"), "");
    }
    next = next.replace(new RegExp(escapeRegex(placeholder), "g"), processed);
    replacementsMade += 1;
    changed = true;
  }

  for (const placeholder of UNUSED_PLACEHOLDERS) {
    if (!next.includes(placeholder)) continue;
    next = next.replace(new RegExp(`^[ \\t]*${escapeRegex(placeholder)}[ \\t]*\\r?\\n?`, "gm"), "");
    next = next.replace(new RegExp(escapeRegex(placeholder), "g"), "");
    replacementsMade += 1;
    changed = true;
  }

  const cleaned = cleanEmptyLines(next);
  return { content: cleaned, replacementsMade, changed: changed || cleaned !== content };
}

export function replaceMeguminPlaceholders(
  incoming: LlmMessage[],
  rawProfile: unknown,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext
): { messages: LlmMessage[]; replacementsMade: number; changedMessages: Array<{ messageIndex: number; replacementsMade: number }> } {
  const profile = hydrateProfile(rawProfile || DEFAULT_PROFILE);
  // The envelope only takes ownership of the per-block anchors in a preset that
  // actually has somewhere to put it.
  const replacements = placeholderMapFromDict(
    buildBaseDict(profile, customEngines, chatMessages, context, presetUsesEnvelope(incoming))
  );
  let replacementsMade = 0;
  const changedMessages: Array<{ messageIndex: number; replacementsMade: number }> = [];
  const messages = incoming.map((message, messageIndex) => {
    let messageReplacements = 0;
    let messageChanged = false;
    if (typeof message.content === "string") {
      const replaced = replacePlaceholderText(message.content, replacements);
      replacementsMade += replaced.replacementsMade;
      messageReplacements += replaced.replacementsMade;
      messageChanged = replaced.changed;
      if (messageChanged) changedMessages.push({ messageIndex, replacementsMade: messageReplacements });
      return { ...message, content: replaced.content };
    }
    const content = message.content.map((part) => {
      if (part.type !== "text") return part;
      const replaced = replacePlaceholderText(part.text, replacements);
      replacementsMade += replaced.replacementsMade;
      messageReplacements += replaced.replacementsMade;
      if (replaced.changed) messageChanged = true;
      return { ...part, text: replaced.content };
    });
    if (messageChanged) changedMessages.push({ messageIndex, replacementsMade: messageReplacements });
    return { ...message, content };
  });
  return { messages, replacementsMade, changedMessages };
}

function buildNpcInjection(npcs: NpcRecord[], recentText: string): string {
  if (npcs.length === 0 || !recentText.trim()) return "";
  const words = new Set(recentText.match(/\p{L}[\p{L}\p{N}_-]*/gu)?.map((word) => word.toLowerCase()) || []);
  const scored = npcs
    .map((npc) => {
      const text = npcBuildText(npc).toLowerCase();
      let score = npc.name && recentText.includes(npc.name.toLowerCase()) ? 10 : 0;
      for (const word of words) if (word.length >= 3 && text.includes(word)) score += 1;
      return { npc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (scored.length === 0) return "";
  return `[RELEVANT NPCs]\nThe following known NPCs are relevant to the current context:\n<retrieved_npcs>\n${scored.map(({ npc }) => `<npc name="${npc.name}">\n${npcBuildText(npc)}\n</npc>`).join("\n\n")}\n</retrieved_npcs>`;
}

function npcDossierDirective(): string {
  return `<npc_dossier>
trigger: Generate only when a new significant NPC is introduced.
format: Collapsible HTML details block. Dense, dashboard-style, no prose.
template:
<details>
<summary>New NPC: [Full Name]</summary>
**Name:** [Full name] | **Age:** [Age] | **Sex:** [M/F/Other]
**Appearance:** [Visual description]
**Occupation:** [Current role]
**Background:** [3-5 sentence life sketch]
**Inner Circle:**
* [Name] - [Relationship and dynamic]
**Personality Snapshot:** [Contradictions and defining behavior]
**Current Agenda:** [What they want right now]
**Hidden Layer:** [A secret or motive]
</details>
</npc_dossier>`;
}

export function buildPromptMessages(
  incoming: LlmMessage[],
  chatMessages: ChatMessage[],
  rawProfile: unknown,
  customEngines: EngineMode[],
  context: ChatContext
): PromptBuildResult {
  const profile = hydrateProfile(rawProfile || DEFAULT_PROFILE);
  const prunedMessages = incoming.map((msg) => ({ ...msg, content: Array.isArray(msg.content) ? clone(msg.content) : msg.content }));
  const replaced = replaceMeguminPlaceholders(prunedMessages, profile, customEngines, chatMessages, context);
  const indexedMessages = replaced.messages.map((message, originalIndex) => ({ message, originalIndex })).filter((entry) => {
    if (typeof entry.message.content === "string") return entry.message.content.trim().length > 0;
    return entry.message.content.length > 0;
  });
  const resultMessages = indexedMessages.map((entry) => entry.message);
  const indexMap = new Map<number, number>();
  indexedMessages.forEach((entry, resultIndex) => indexMap.set(entry.originalIndex, resultIndex));

  const changedMessages = replaced.changedMessages
    .map((entry) => {
      const messageIndex = indexMap.get(entry.messageIndex);
      return messageIndex === undefined ? null : { messageIndex, replacementsMade: entry.replacementsMade };
    })
    .filter((entry): entry is { messageIndex: number; replacementsMade: number } => !!entry);

  return {
    messages: resultMessages,
    breakdown: [],
    prunedCount: 0,
    replacementsMade: replaced.replacementsMade,
    changedMessages,
    estimatedInjectionTokens: estimateMeguminPayloadTokens(profile, customEngines, chatMessages, context)
  };
}
