import { DEFAULT_PROFILE, EXTENSION_NAME, clone, mergeProfile } from "./defaults";
import {
  REQUIRED_PLACEHOLDER_FEATURES,
  auditPresetPlaceholders,
  buildPromptMessages,
  estimateMeguminPayloadTokens,
  getLogic,
  allEngines
} from "./prompt-engine";
import type { ChatContext, ChatMessage, EngineMode, MeguminProfile, NpcRecord, RpcEnvelope, RpcResponse } from "./types";
import { cleanAIOutput, cleanChatText, escapeXmlAttr, extractNpcBlocks, npcBuildText } from "./text";
import { patchComfyWorkflow } from "./image-workflow";

declare const spindle: any;

const CUSTOM_ENGINES_PATH = "custom-engines.json";
const PRESET_BRIDGE_PATH = "preset-bridge.json";
const DEFAULT_HERO_ASSETS = ["img/default.png", "img/default1.png", "img/default2.png", "img/default3.png"];
const SYNCABLE_PROFILE_KEYS = new Set([
  "mode",
  "personality",
  "toggles",
  "activeStyleId",
  "aiRule",
  "customStyles",
  "dnRatio",
  "userWordCount",
  "userLanguage",
  "userPronouns",
  "disableUtilityPrefill",
  "onomatopoeia",
  "addons",
  "blocks",
  "v9Limits",
  "storyConfig",
  "configPresets",
  "blockStack",
  "statBlocks",
  "worldState",
  "model",
  "thinkEffort",
  "customThinkEffort",
  "thinkingV2",
  "storyPlan",
  "banList",
  "banListBackend",
  "imageGen",
  "npcBank",
  "memoryCore"
]);
let utilityBypassDepth = 0;
let activeUtilityRequest: { messages: Array<{ role: "system" | "user" | "assistant"; content: string }>; trigger: string } | null = null;

type PresetKind = "engine" | "image";
type MeguminPresetKey = PresetKind | "suite-ds4" | "suite-gemini" | "suite-v91";
type UtilityTrigger = "storyPlan" | "banList" | "memorySummary" | "imagePrompt" | "npcPortrait" | "dummyOrder";

type PresetBridgeState = {
  enginePresetId?: string;
  imagePresetId?: string;
  suiteDs4PresetId?: string;
  suiteGeminiPresetId?: string;
  suiteV91PresetId?: string;
  updatedAt?: number;
};

const MEGUMIN_PRESET_TARGETS: Record<MeguminPresetKey, { name: string; stateKey: keyof PresetBridgeState }> = {
  engine: { name: "Megumin Engine", stateKey: "enginePresetId" },
  image: { name: "Megumin Image", stateKey: "imagePresetId" },
  "suite-ds4": { name: "Megumin Suite V7 DS4", stateKey: "suiteDs4PresetId" },
  "suite-gemini": { name: "Megumin Suite V7 Gemini", stateKey: "suiteGeminiPresetId" },
  "suite-v91": { name: "Megumin Suite V9.1 Universal", stateKey: "suiteV91PresetId" }
};

const UTILITY_TRIGGERS: Record<UtilityTrigger, string> = {
  storyPlan: "___PS_STORY_PLAN___",
  banList: "___PS_BANLIST___",
  memorySummary: "___PS_MEMORY_SUMMARIZE___",
  imagePrompt: "___PS_IMAGE_GEN___",
  npcPortrait: "___PS_NPC_PFP___",
  dummyOrder: "___PS_DUMMY___"
};

async function readJson<T>(path: string, fallback: T, userId?: string): Promise<T> {
  void userId;
  try {
    const raw = await spindle.storage.read(path);
    return JSON.parse(raw) as T;
  } catch {
    return clone(fallback);
  }
}

async function writeJson(path: string, value: unknown, userId?: string): Promise<void> {
  void userId;
  await spindle.storage.write(path, JSON.stringify(value, null, 2));
}

function profilePath(scope: string): string {
  return `profiles/${scope}.json`;
}

async function getCustomEngines(userId?: string): Promise<EngineMode[]> {
  return readJson<EngineMode[]>(CUSTOM_ENGINES_PATH, [], userId);
}

async function saveCustomEngines(engines: EngineMode[], userId?: string): Promise<void> {
  await writeJson(CUSTOM_ENGINES_PATH, engines, userId);
}

async function hasPresetAccess(): Promise<boolean> {
  try {
    return !spindle.permissions?.has || await spindle.permissions.has("presets");
  } catch {
    return false;
  }
}

function matchesTargetPreset(preset: any, kind: MeguminPresetKey): boolean {
  return String(preset?.name || "").trim().toLowerCase() === MEGUMIN_PRESET_TARGETS[kind].name.toLowerCase();
}

async function findMeguminPreset(kind: MeguminPresetKey, userId?: string): Promise<any | null> {
  if (!await hasPresetAccess()) return null;
  const target = MEGUMIN_PRESET_TARGETS[kind];
  const state = await readJson<PresetBridgeState>(PRESET_BRIDGE_PATH, {}, userId);
  const knownId = state[target.stateKey];
  if (knownId) {
    try {
      const preset = await spindle.presets.get(knownId, userId);
      if (preset && matchesTargetPreset(preset, kind)) return preset;
    } catch {
      // Fall through to list lookup.
    }
  }

  const listed = await spindle.presets.list({ limit: 200, userId });
  const preset = (listed?.data || []).find((item: any) => matchesTargetPreset(item, kind)) || null;
  if (preset?.id && state[target.stateKey] !== preset.id) {
    state[target.stateKey] = preset.id;
    state.updatedAt = Date.now();
    await writeJson(PRESET_BRIDGE_PATH, state, userId);
  }
  return preset;
}

async function resolveMeguminPreset(kind: PresetKind, userId?: string): Promise<any> {
  if (!await hasPresetAccess()) throw new Error("Megumin preset mode requires the presets permission.");
  const preset = await findMeguminPreset(kind, userId);
  if (!preset) {
    throw new Error(`"${MEGUMIN_PRESET_TARGETS[kind].name}" is not imported in Lumiverse. Import the preset first, then refresh Megumin Suite.`);
  }
  return preset;
}

async function presetBridgeStatus(userId?: string): Promise<{ available: boolean; enginePresetId?: string; imagePresetId?: string; suiteDs4PresetId?: string; suiteGeminiPresetId?: string; missing: string[] }> {
  const available = await hasPresetAccess();
  if (!available) return { available: false, missing: Object.values(MEGUMIN_PRESET_TARGETS).map((target) => target.name) };
  const [engine, image, suiteDs4, suiteGemini] = await Promise.all([
    findMeguminPreset("engine", userId).catch(() => null),
    findMeguminPreset("image", userId).catch(() => null),
    findMeguminPreset("suite-ds4", userId).catch(() => null),
    findMeguminPreset("suite-gemini", userId).catch(() => null)
  ]);
  return {
    available: true,
    enginePresetId: engine?.id,
    imagePresetId: image?.id,
    suiteDs4PresetId: suiteDs4?.id,
    suiteGeminiPresetId: suiteGemini?.id,
    missing: [
      !engine ? MEGUMIN_PRESET_TARGETS.engine.name : "",
      !image ? MEGUMIN_PRESET_TARGETS.image.name : "",
      !suiteDs4 ? MEGUMIN_PRESET_TARGETS["suite-ds4"].name : "",
      !suiteGemini ? MEGUMIN_PRESET_TARGETS["suite-gemini"].name : ""
    ].filter(Boolean)
  };
}

type PresetContractFeature = {
  id: string;
  label: string;
  placeholders: string[];
  present: string[];
  missing: string[];
  connected: boolean;
};

type PresetContractAudit = {
  available: boolean;
  scannedPresetIds: string[];
  scannedPresetNames: string[];
  statusMessage?: string;
  presentPlaceholders: string[];
  missingPlaceholders: string[];
  missingFeatures: string[];
  features: PresetContractFeature[];
  payloadEstimateTokens: number;
  payloadEstimateSource: "preset-audit" | "fallback";
  updatedAt: number;
};

function presetBlockText(block: any): string {
  const parts = [
    block?.content,
    block?.prompt,
    block?.text,
    block?.name,
    ...(Array.isArray(block?.injectionTrigger) ? block.injectionTrigger : [])
  ];
  if (Array.isArray(block?.prompt_order)) {
    parts.push(
      ...block.prompt_order
        .filter((child: any) => child?.enabled !== false)
        .map(presetBlockText)
    );
  }
  return parts.filter((part) => typeof part === "string" && part.trim()).join("\n");
}

async function presetContractAudit(
  profile: MeguminProfile,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext,
  userId?: string
): Promise<PresetContractAudit> {
  const available = await hasPresetAccess();
  const presentPlaceholders = new Set<string>();
  const scannedPresetIds: string[] = [];
  const scannedPresetNames: string[] = [];

  if (available) {
    // V9.1 first: it is the current preset and the only one carrying the
    // [[config]] and [[blocks]] hooks, so the audit must see it to report them.
    const presets = await Promise.all([
      findMeguminPreset("suite-v91", userId).catch(() => null),
      findMeguminPreset("suite-ds4", userId).catch(() => null),
      findMeguminPreset("suite-gemini", userId).catch(() => null)
    ]);
    for (const preset of presets) {
      if (!preset?.id || scannedPresetIds.includes(preset.id)) continue;
      scannedPresetIds.push(preset.id);
      scannedPresetNames.push(preset.name || preset.id);
      let searchableText = presetBlockText(preset);
      try {
        const blocks = await spindle.presets.blocks.list(preset.id, userId);
        searchableText += "\n" + (blocks || [])
          .filter((block: any) => block?.enabled !== false)
          .map(presetBlockText)
          .join("\n");
      } catch (err) {
        spindle.log.warn(`Megumin preset block audit failed for ${preset.name || preset.id}: ${String(err)}`);
      }
      for (const feature of REQUIRED_PLACEHOLDER_FEATURES) {
        for (const placeholder of feature.placeholders) {
          if (searchableText.includes(placeholder)) presentPlaceholders.add(placeholder);
        }
      }
    }
  }

  const hasScannedPreset = scannedPresetIds.length > 0;
  const hasDetectedHooks = presentPlaceholders.size > 0;
  const canEvaluateHooks = hasScannedPreset && hasDetectedHooks;
  const features = auditPresetPlaceholders(presentPlaceholders, canEvaluateHooks);
  const estimateSet = hasDetectedHooks ? presentPlaceholders : undefined;
  const statusMessage = !available
    ? "Lumiverse preset access is unavailable."
    : !hasScannedPreset
      ? "Uploaded Megumin Suite preset not detected. Import a Megumin Suite preset (V9.1 Universal is the current one) in Lumiverse, then refresh Megumin Suite."
      : !hasDetectedHooks
        ? "Megumin Suite preset was found, but no Megumin placeholder hooks were detected in its prompt blocks."
        : undefined;
  return {
    available,
    scannedPresetIds,
    scannedPresetNames,
    statusMessage,
    presentPlaceholders: [...presentPlaceholders].sort(),
    missingPlaceholders: [...new Set(features.flatMap((feature) => feature.missing))].sort(),
    missingFeatures: features.filter((feature) => !feature.connected).map((feature) => feature.id),
    features,
    payloadEstimateTokens: estimateMeguminPayloadTokens(profile, customEngines, chatMessages, context, estimateSet),
    payloadEstimateSource: hasDetectedHooks ? "preset-audit" : "fallback",
    updatedAt: Date.now()
  };
}

async function loadProfile(scope: string, userId?: string): Promise<MeguminProfile> {
  const globalProfile = await readJson(profilePath("global"), DEFAULT_PROFILE, userId);
  const raw = scope === "global" ? globalProfile : await readJson(profilePath(scope), globalProfile, userId);
  return mergeProfile(raw);
}

async function saveProfile(scope: string, profile: MeguminProfile, userId?: string): Promise<MeguminProfile> {
  const merged = mergeProfile(profile);
  await writeJson(profilePath(scope), merged, userId);
  return merged;
}

function mimeForPath(path: string): string {
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

function stableIndex(input: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (const char of input) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % length;
}

async function readAssetDataUrl(path: string): Promise<string | null> {
  try {
    const bytes = await spindle.storage.readBinary(path);
    const base64 = Buffer.from(bytes).toString("base64");
    return `data:${mimeForPath(path)};base64,${base64}`;
  } catch {
    return null;
  }
}

async function loadUiAssets(context: ChatContext): Promise<{ heroImages: string[]; groupImage?: string; mascotImage?: string }> {
  const start = stableIndex(context.chatId || context.scope, DEFAULT_HERO_ASSETS.length);
  const ordered = [...DEFAULT_HERO_ASSETS.slice(start), ...DEFAULT_HERO_ASSETS.slice(0, start)];
  const heroImages: string[] = [];
  for (const path of ordered) {
    const data = await readAssetDataUrl(path);
    if (data) heroImages.push(data);
  }
  const groupImage = await readAssetDataUrl("img/group.png");
  const mascotImage = await readAssetDataUrl("img/Cat.png");
  return { heroImages, groupImage: groupImage || undefined, mascotImage: mascotImage || undefined };
}

async function listProfileFiles(userId?: string): Promise<string[]> {
  void userId;
  const files = new Set<string>();
  try {
    for (const file of await spindle.storage.list("profiles/")) files.add(String(file));
  } catch {
    // Extension storage may not have profile files yet.
  }
  return [...files];
}

function safeProfileScope(value: unknown, fallback: string): string {
  const scope = String(value || "").trim();
  return /^[A-Za-z0-9_-]+$/.test(scope) ? scope : fallback;
}

async function syncProfileKeysFrom(scope: string, keys: string[], userId?: string): Promise<number> {
  const safeKeys = keys.filter((key) => SYNCABLE_PROFILE_KEYS.has(key));
  if (safeKeys.length === 0) return 0;
  const source = await loadProfile(scope, userId);
  const profileFiles = await listProfileFiles(userId);
  const targets = new Set<string>(["profiles/global.json", profilePath(scope)]);
  for (const file of profileFiles) {
    const path = String(file);
    if (!path.endsWith(".json")) continue;
    targets.add(path.startsWith("profiles/") ? path : `profiles/${path}`);
  }
  for (const path of targets) {
    const current = mergeProfile(await readJson(path, DEFAULT_PROFILE, userId));
    for (const key of safeKeys) {
      (current as unknown as Record<string, unknown>)[key] = clone((source as unknown as Record<string, unknown>)[key]);
    }
    await writeJson(path, current, userId);
  }
  return targets.size;
}

function chatToScope(chatId: string | null): string {
  return chatId ? `chat_${chatId}` : "global";
}

async function getActiveContext(userId?: string): Promise<ChatContext> {
  try {
    const active = await spindle.chats.getActive(userId);
    const chatId = active?.id || null;
    const characterId = active?.character_id || active?.characterId || null;
    const isGroup = !!(active?.is_group || active?.isGroup || active?.group_id || active?.groupId || Array.isArray(active?.character_ids) || Array.isArray(active?.characterIds));
    let characterName = "the character";
    let characterAvatarUrl: string | null = null;
    if (characterId) {
      try {
        const character = await spindle.characters.get(characterId, userId);
        characterName = character?.name || characterName;
        characterAvatarUrl = character ? `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=lg` : null;
      } catch {
        // Character permission may be missing; prompts still work with a generic name.
      }
    }
    return {
      chatId,
      chatName: active?.name || null,
      characterId,
      characterName,
      characterAvatarUrl,
      isGroup,
      groupName: isGroup ? active?.name || "Group Chat" : null,
      scope: chatToScope(chatId)
    };
  } catch {
    return { chatId: null, chatName: null, characterId: null, characterName: "the character", characterAvatarUrl: null, isGroup: false, groupName: null, scope: "global" };
  }
}

async function getChatContext(chatId: string | null, userId?: string): Promise<ChatContext> {
  if (!chatId) return getActiveContext(userId);
  try {
    const chat = await spindle.chats.get(chatId, userId);
    const characterId = chat?.character_id || chat?.characterId || null;
    const isGroup = !!(chat?.is_group || chat?.isGroup || chat?.group_id || chat?.groupId || Array.isArray(chat?.character_ids) || Array.isArray(chat?.characterIds));
    let characterName = "the character";
    let characterAvatarUrl: string | null = null;
    if (characterId) {
      try {
        const character = await spindle.characters.get(characterId, userId);
        characterName = character?.name || characterName;
        characterAvatarUrl = character ? `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=lg` : null;
      } catch {
        // best effort
      }
    }
    return {
      chatId,
      chatName: chat?.name || null,
      characterId,
      characterName,
      characterAvatarUrl,
      isGroup,
      groupName: isGroup ? chat?.name || "Group Chat" : null,
      scope: chatToScope(chatId)
    };
  } catch {
    return { chatId, chatName: null, characterId: null, characterName: "the character", characterAvatarUrl: null, isGroup: false, groupName: null, scope: chatToScope(chatId) };
  }
}

async function getMessages(chatId: string | null): Promise<ChatMessage[]> {
  if (!chatId) return [];
  try {
    return (await spindle.chat.getMessages(chatId)) as ChatMessage[];
  } catch {
    return [];
  }
}

async function generateQuiet(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { backend?: "direct" | "preset"; presetKind?: PresetKind; userId?: string; trigger?: UtilityTrigger } = {}
): Promise<string> {
  const usePreset = options.backend === "preset" && !!options.presetKind;
  if (!usePreset) utilityBypassDepth += 1;
  try {
    const input: Record<string, unknown> = { type: "quiet", messages };
    if (usePreset && options.presetKind) {
      const preset = await resolveMeguminPreset(options.presetKind, options.userId);
      const trigger = UTILITY_TRIGGERS[options.trigger || "dummyOrder"];
      activeUtilityRequest = { messages, trigger };
      input.messages = [{ role: "user", content: trigger }];
      input.presetId = preset.id;
      input.preset_id = preset.id;
      input.force_preset_id = true;
    }
    const result = await spindle.generate.quiet(input);
    return cleanAIOutput(String(result?.content || result || ""));
  } finally {
    if (usePreset) activeUtilityRequest = null;
    else utilityBypassDepth = Math.max(0, utilityBypassDepth - 1);
  }
}

function cleanedTranscript(messages: ChatMessage[], limit = 50): string {
  return messages
    .filter((message) => message.role !== "system")
    .slice(-limit)
    .map((message) => `${message.role}: ${cleanChatText(message.content)}`)
    .filter((line) => line.trim().length > 8)
    .join("\n\n");
}

function lastAssistant(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messages[index];
  }
  return null;
}

async function processMemory(scope: string, chatId: string, userId?: string): Promise<MeguminProfile> {
  const profile = await loadProfile(scope, userId);
  const mem = profile.memoryCore;
  const messages = await getMessages(chatId);
  const real = messages
    .map((msg, index) => ({ msg, index }))
    .filter((item) => item.msg.role !== "system" && cleanChatText(item.msg.content).length > 0);

  if (!mem.enabled || real.length <= mem.workingLimit) return profile;
  const archivedIds = new Set([...mem.shortTermChunks, ...mem.longTermVault].map((chunk) => chunk.id));
  const effectiveLimit = mem.architecture === "raw_long" ? mem.workingLimit : mem.workingLimit + mem.shortTermLimit;
  const vaultCutoff = Math.max(0, real.length - effectiveLimit);
  const archivable = real.slice(0, real.length - mem.workingLimit);

  for (let offset = 0; offset < archivable.length; offset += 10) {
    const chunk = archivable.slice(offset, offset + 10);
    if (chunk.length === 0) continue;
    const startIndex = chunk[0].index;
    const endIndex = chunk[chunk.length - 1].index;
    const id = `${startIndex}-${endIndex}`;
    if (archivedIds.has(id)) continue;
    const text = chunk.map((item) => `${item.msg.role}: ${cleanChatText(item.msg.content)}`).join("\n\n");
    if (offset < vaultCutoff || mem.architecture === "raw_long") {
      mem.longTermVault.push({ id, startIndex, endIndex, text, timestamp: Date.now() });
      archivedIds.add(id);
      continue;
    }

    const summary = await generateQuiet([
      {
        role: "system",
        content: "You are an expert narrative condenser. Summarize important story events and meaningful dialogue. Remove flowery prose and trivial motion. Do not quote dialogue unless necessary."
      },
      { role: "user", content: `Summarize this chat chunk clearly:\n\n<chat>\n${text}\n</chat>` }
    ], { backend: mem.backend, presetKind: "engine", userId, trigger: "memorySummary" });
    mem.shortTermChunks.push({ id, startIndex, endIndex, summary, timestamp: Date.now() });
    archivedIds.add(id);
  }

  const shortCutoffIndex = real.length <= effectiveLimit ? 0 : real[real.length - effectiveLimit]?.index ?? 0;
  for (let index = mem.shortTermChunks.length - 1; index >= 0; index -= 1) {
    const chunk = mem.shortTermChunks[index];
    if (chunk.endIndex < shortCutoffIndex) {
      mem.shortTermChunks.splice(index, 1);
      const rawText = messages
        .slice(chunk.startIndex, chunk.endIndex + 1)
        .filter((message) => message.role !== "system")
        .map((message) => `${message.role}: ${cleanChatText(message.content)}`)
        .join("\n\n");
      mem.longTermVault.push({ ...chunk, text: rawText, summary: undefined, timestamp: Date.now() });
    }
  }

  return saveProfile(scope, profile, userId);
}

async function scanNpcBlocks(scope: string, chatId: string, userId?: string): Promise<MeguminProfile> {
  const profile = await loadProfile(scope, userId);
  if (!profile.npcBank.enabled) return profile;
  const messages = await getMessages(chatId);
  const assistant = lastAssistant(messages);
  if (!assistant) return profile;
  const found = extractNpcBlocks(assistant.content);
  if (found.length === 0) return profile;
  const existing = new Set(profile.npcBank.npcs.map((npc) => npc.name.trim().toLowerCase()));
  let changed = false;
  for (const npc of found) {
    if (existing.has(npc.name.trim().toLowerCase())) continue;
    profile.npcBank.npcs.push(npc);
    existing.add(npc.name.trim().toLowerCase());
    changed = true;
  }
  return changed ? saveProfile(scope, profile, userId) : profile;
}

function parseImageTag(content: string): { prompt: string; cleaned: string } | null {
  const match = content.match(/<img\s+prompt=["']([\s\S]*?)["']\s*\/?>/i);
  if (!match) return null;
  return { prompt: match[1].trim(), cleaned: content.replace(match[0], "").trim() };
}

async function resolveImageConnection(profile: MeguminProfile, userId?: string): Promise<any | null> {
  try {
    if (profile.imageGen.connectionId) {
      return await spindle.imageGen.getConnection(profile.imageGen.connectionId, userId);
    }
    const connections = await spindle.imageGen.listConnections(userId);
    return connections.find((connection: any) => connection.is_default) || connections[0] || null;
  } catch {
    return null;
  }
}

async function generateImageForChat(scope: string, chatId: string, prompt: string, attachToMessageId?: string, userId?: string): Promise<{ imageId?: string; imageUrl?: string; prompt: string }> {
  const profile = await loadProfile(scope, userId);
  const connection = await resolveImageConnection(profile, userId);
  const parameters: Record<string, unknown> = {
    width: profile.imageGen.imgWidth,
    height: profile.imageGen.imgHeight,
    steps: profile.imageGen.steps,
    cfg: profile.imageGen.cfg,
    seed: profile.imageGen.customSeed >= 0 ? profile.imageGen.customSeed : undefined,
    sampler_name: profile.imageGen.selectedSampler || undefined,
    scheduler: profile.imageGen.scheduler || undefined,
    checkpoint: profile.imageGen.selectedModel || undefined,
    denoise: profile.imageGen.denoise,
    clip_skip: profile.imageGen.clipSkip
  };
  if (connection?.provider === "comfyui" || connection?.provider === "swarmui") {
    const workflow = patchComfyWorkflow(connection, profile, prompt);
    if (workflow) parameters.workflow = workflow;
  }
  const result = await spindle.imageGen.generate({
    prompt,
    connection_id: connection?.id || profile.imageGen.connectionId || undefined,
    model: profile.imageGen.selectedModel || undefined,
    negativePrompt: profile.imageGen.customNegative,
    parameters,
    owner_chat_id: chatId
  });

  if (attachToMessageId && result?.imageId) {
    const messages = await getMessages(chatId);
    const target = messages.find((message) => message.id === attachToMessageId);
    if (target) {
      const tag = `<megumin-image image-id="${escapeXmlAttr(result.imageId)}" src="${escapeXmlAttr(result.imageUrl || "")}" prompt="${escapeXmlAttr(prompt)}"></megumin-image>`;
      await spindle.chat.updateMessage(chatId, attachToMessageId, {
        content: `${target.content.trim()}\n\n${tag}`.trim(),
        skipChunkRebuild: true
      });
    }
  }

  return { imageId: result?.imageId, imageUrl: result?.imageUrl, prompt };
}

async function generateImagePromptFromChat(profile: MeguminProfile, messages: ChatMessage[], userId?: string): Promise<string> {
  const chatText = cleanedTranscript(messages, 10);
  const style = profile.imageGen.promptStyle === "illustrious"
    ? "Use Danbooru-style tags separated by commas. Focus on anime art style."
    : profile.imageGen.promptStyle === "sdxl"
      ? "Use natural, descriptive prose. Focus on photorealism."
      : "Use a comma-separated list of detailed keywords and visual descriptors.";
  const perspective = profile.imageGen.promptPerspective === "pov"
    ? "First-person POV."
    : profile.imageGen.promptPerspective === "character"
      ? "Focus on character appearance and expression."
      : "Focus on the whole scene and environment.";
  return generateQuiet([
    {
      role: "system",
      content: "You are an expert image prompt engineer. Convert the latest scene into a concise, high-quality image prompt. Return only the prompt."
    },
    {
      role: "user",
      content: `Chat:\n${chatText}\n\nStyle: ${style}\nPerspective: ${perspective}\nExtra: ${profile.imageGen.promptExtra || "None"}`
    }
  ], { backend: profile.imageGen.generatorBackend, presetKind: "image", userId, trigger: "imagePrompt" });
}

async function generateWritingStyleRule(input: any, userId?: string): Promise<string> {
  const name = String(input?.name || "Custom AI Style").trim();
  const notes = String(input?.notes || "").trim();
  const tags = Array.isArray(input?.tags) ? input.tags.map(String).filter(Boolean) : [];
  const tagText = tags.length ? tags.join(", ") : "cinematic prose, grounded character behavior, natural pacing";
  const orderText = `Inspired by ${notes || name}. Write a writing style rule based on: ${tagText}. Direct instructions only. 2-3 paragraphs. No fluff.`;
  return generateQuiet([
    { role: "system", content: "You write concise Megumin Suite writing-style directives. Return only the directive text." },
    { role: "user", content: orderText }
  ], { backend: "preset", presetKind: "engine", userId, trigger: "dummyOrder" });
}

async function generateWritingStyleInsights(input: any, userId?: string): Promise<string> {
  const notes = String(input?.notes || "").trim();
  const name = String(input?.name || "Custom AI Style").trim();
  return generateQuiet([
    { role: "system", content: "Suggest concise writing-style inspirations for Megumin Suite. Return 2 author/style influences and 5 short style tags, comma-separated." },
    { role: "user", content: `Style name: ${name}\nNotes: ${notes || "No notes yet. Suggest grounded cinematic prose options."}` }
  ], { backend: "preset", presetKind: "engine", userId, trigger: "dummyOrder" });
}

async function handlePostGeneration(chatId: string, userId?: string): Promise<void> {
  const context = await getChatContext(chatId, userId);
  const profile = await loadProfile(context.scope, userId);
  const messages = await getMessages(chatId);
  await scanNpcBlocks(context.scope, chatId, userId);

  if (profile.memoryCore.enabled && profile.memoryCore.triggerMode === "frequency") {
    const aiCount = messages.filter((message) => message.role === "assistant").length;
    if (aiCount > 0 && aiCount % Math.max(1, profile.memoryCore.autoFreq || 10) === 0) {
      processMemory(context.scope, chatId, userId).catch((err: unknown) => spindle.log.warn(`Memory scan failed: ${String(err)}`));
    }
  }

  const assistant = lastAssistant(messages);
  if (!assistant || !profile.imageGen.enabled) return;
  const imageTag = parseImageTag(assistant.content);
  if (!imageTag) return;
  await spindle.chat.updateMessage(chatId, assistant.id, { content: imageTag.cleaned, skipChunkRebuild: true });
  await generateImageForChat(context.scope, chatId, imageTag.prompt, assistant.id, userId);
}

async function rpc(payload: RpcEnvelope, userId?: string): Promise<unknown> {
  const context = await getActiveContext(userId);
  switch (payload.type) {
    case "bootstrap": {
      const profile = await loadProfile(context.scope, userId);
      const customEngines = await getCustomEngines(userId);
      const chatMessages = await getMessages(context.chatId);
      let imageConnections: any[] = [];
      try {
        imageConnections = await spindle.imageGen.listConnections(userId);
      } catch {
        imageConnections = [];
      }
      return {
        context,
        profile,
        logic: getLogic(),
        engines: allEngines(customEngines),
        customEngines,
        imageConnections,
        uiAssets: await loadUiAssets(context),
        presetBridge: await presetBridgeStatus(userId),
        presetAudit: await presetContractAudit(profile, customEngines, chatMessages, context, userId)
      };
    }
    case "profile:save": {
      const profile = mergeProfile((payload.payload as any)?.profile);
      const scope = safeProfileScope((payload.payload as any)?.scope, context.scope);
      return { profile: await saveProfile(scope, profile, userId), context };
    }
    case "profile:syncTab": {
      const keys = Array.isArray((payload.payload as any)?.keys) ? (payload.payload as any).keys.map(String) : [];
      const syncedTargets = await syncProfileKeysFrom(context.scope, keys, userId);
      return { profile: await loadProfile(context.scope, userId), context, syncedTargets };
    }
    case "profile:reset":
      await saveProfile(context.scope, DEFAULT_PROFILE, userId);
      return { profile: await loadProfile(context.scope, userId), context };
    case "engine:save": {
      const engine = (payload.payload as any)?.engine as EngineMode;
      if (!engine?.id) throw new Error("Engine id is required");
      const engines = await getCustomEngines(userId);
      const index = engines.findIndex((item) => item.id === engine.id);
      if (index >= 0) engines[index] = engine;
      else engines.push(engine);
      await saveCustomEngines(engines, userId);
      return { customEngines: engines, engines: allEngines(engines) };
    }
    case "engine:delete": {
      const id = String((payload.payload as any)?.id || "");
      const engines = (await getCustomEngines(userId)).filter((engine) => engine.id !== id);
      await saveCustomEngines(engines, userId);
      return { customEngines: engines, engines: allEngines(engines) };
    }
    case "story:generate": {
      if (!context.chatId) throw new Error("Open a chat before generating a story plan");
      const profile = await loadProfile(context.scope, userId);
      const messages = await getMessages(context.chatId);
      const plan = await generateQuiet([
        { role: "system", content: "You are an expert story architect. Brainstorm medium-to-long-term plot developments. Do not write actions, thoughts, or dialogue for the user character." },
        { role: "user", content: `Create at least 10 future arc/chapter/episode possibilities from this story:\n\n${cleanedTranscript(messages, 60)}` }
      ], { backend: profile.storyPlan.backend, presetKind: "engine", userId, trigger: "storyPlan" });
      profile.storyPlan.currentPlan = plan;
      profile.storyPlan.enabled = true;
      return { profile: await saveProfile(context.scope, profile, userId), plan };
    }
    case "banlist:analyze": {
      if (!context.chatId) throw new Error("Open a chat before analyzing style");
      const profile = await loadProfile(context.scope, userId);
      const messages = await getMessages(context.chatId);
      const analysis = await generateQuiet([
        { role: "system", content: "Identify the 5 most repetitive cliche or overused stylistic patterns. Return only short generalized rules separated by commas." },
        { role: "user", content: cleanedTranscript(messages.filter((message) => message.role === "assistant"), 50) }
      ], { backend: profile.banListBackend, presetKind: "engine", userId, trigger: "banList" });
      const phrases = analysis.split(/[,\n-]+/).map((item) => item.trim().replace(/^["']|["']$/g, "")).filter((item) => item.length > 3);
      for (const phrase of phrases) if (!profile.banList.includes(phrase)) profile.banList.push(phrase);
      return { profile: await saveProfile(context.scope, profile, userId), added: phrases };
    }
    case "memory:process": {
      if (!context.chatId) throw new Error("Open a chat before processing memory");
      return { profile: await processMemory(context.scope, context.chatId, userId) };
    }
    case "npc:scan": {
      if (!context.chatId) throw new Error("Open a chat before scanning NPCs");
      return { profile: await scanNpcBlocks(context.scope, context.chatId, userId) };
    }
    case "npc:portrait": {
      if (!context.chatId) throw new Error("Open a chat before generating portraits");
      const name = String((payload.payload as any)?.name || "");
      const profile = await loadProfile(context.scope, userId);
      const npc = profile.npcBank.npcs.find((item) => item.name === name);
      if (!npc) throw new Error("NPC not found");
      const prompt = await generateQuiet([
        { role: "system", content: "You are an expert image prompt engineer specializing in character portraits. Return only the image prompt." },
        { role: "user", content: `Create a portrait prompt from this NPC dossier:\n\n${npcBuildText(npc)}` }
      ], { backend: profile.imageGen.generatorBackend, presetKind: "image", userId, trigger: "npcPortrait" });
      const image = await generateImageForChat(context.scope, context.chatId, prompt, undefined, userId);
      npc.pfpImageId = image.imageId;
      npc.pfpImageUrl = image.imageUrl;
      npc.pfp = image.imageUrl || "";
      return { profile: await saveProfile(context.scope, profile, userId), image };
    }
    case "npc:uploadPortrait": {
      if (!context.chatId) throw new Error("Open a chat before uploading portraits");
      const name = String((payload.payload as any)?.name || "");
      const dataUrl = String((payload.payload as any)?.dataUrl || "");
      const filename = String((payload.payload as any)?.filename || "npc-portrait.png");
      if (!dataUrl.startsWith("data:image/")) throw new Error("Choose an image file for the NPC portrait");
      const profile = await loadProfile(context.scope, userId);
      const npc = profile.npcBank.npcs.find((item) => item.name === name);
      if (!npc) throw new Error("NPC not found");
      const uploaded = await spindle.images.uploadFromDataUrl(dataUrl, {
        originalFilename: filename,
        owner_chat_id: context.chatId,
        owner_character_id: context.characterId || undefined
      });
      npc.pfpImageId = uploaded?.id;
      npc.pfpImageUrl = uploaded?.url;
      npc.pfp = uploaded?.url || "";
      return { profile: await saveProfile(context.scope, profile, userId), image: uploaded };
    }
    case "image:connections": {
      return { imageConnections: await spindle.imageGen.listConnections(userId) };
    }
    case "image:prompt": {
      if (!context.chatId) throw new Error("Open a chat before generating an image prompt");
      const profile = await loadProfile(context.scope, userId);
      const messages = await getMessages(context.chatId);
      return { prompt: await generateImagePromptFromChat(profile, messages, userId) };
    }
    case "image:manual": {
      if (!context.chatId) throw new Error("Open a chat before generating an image");
      const profile = await loadProfile(context.scope, userId);
      const messages = await getMessages(context.chatId);
      const prompt = String((payload.payload as any)?.prompt || "").trim() || await generateImagePromptFromChat(profile, messages, userId);
      const target = lastAssistant(messages);
      const image = await generateImageForChat(context.scope, context.chatId, prompt, target?.id, userId);
      return { image };
    }
    case "style:generate": {
      return { rule: await generateWritingStyleRule(payload.payload, userId) };
    }
    case "style:insights": {
      return { insights: await generateWritingStyleInsights(payload.payload, userId) };
    }
    case "prompt:dryRun": {
      if (!context.chatId) throw new Error("Open a chat before previewing the prompt");
      return spindle.generate.dryRun({ chatId: context.chatId }, userId);
    }
    case "preset:resolve": {
      const kind = ((payload.payload as any)?.kind === "image" ? "image" : "engine") as PresetKind;
      const preset = await resolveMeguminPreset(kind, userId);
      return { presetBridge: await presetBridgeStatus(userId), preset };
    }
    case "preset:status":
      return { presetBridge: await presetBridgeStatus(userId) };
    case "preset:audit": {
      const profile = await loadProfile(context.scope, userId);
      const customEngines = await getCustomEngines(userId);
      const chatMessages = await getMessages(context.chatId);
      return { presetAudit: await presetContractAudit(profile, customEngines, chatMessages, context, userId), presetBridge: await presetBridgeStatus(userId) };
    }
    default:
      throw new Error(`Unknown Megumin RPC: ${payload.type}`);
  }
}

function sendRpc(userId: string | undefined, response: RpcResponse): void {
  spindle.sendToFrontend(response, userId);
}

function messagesContainText(messages: any[], text: string): boolean {
  return messages.some((message) => {
    const content = message?.content;
    if (typeof content === "string") return content.includes(text);
    if (Array.isArray(content)) {
      return content.some((part) => typeof part?.text === "string" && part.text.includes(text));
    }
    return false;
  });
}

function previewMessageText(messages: any[]): Array<{ role: string; content: string }> {
  return messages.slice(0, 40).map((message) => {
    const content = message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part: any) => part?.text || "").join("\n")
        : "";
    return { role: String(message?.role || "system"), content: text.slice(0, 12000) };
  });
}

spindle.onFrontendMessage(async (payload: RpcEnvelope, userId?: string) => {
  try {
    const result = await rpc(payload, userId);
    sendRpc(userId, { type: "rpc:result", requestId: payload.requestId, payload: result });
  } catch (err) {
    sendRpc(userId, { type: "rpc:error", requestId: payload.requestId, error: err instanceof Error ? err.message : String(err) });
  }
});

spindle.registerInterceptor(async (messages: any[], generationContext: any) => {
  if (activeUtilityRequest && (generationContext?.generationType === "quiet" || messagesContainText(messages, activeUtilityRequest.trigger))) {
    return {
      messages: clone(activeUtilityRequest.messages),
      breakdown: [{ messageIndex: 0, name: `Megumin Utility Prompt (${activeUtilityRequest.trigger})` }]
    };
  }
  if (utilityBypassDepth > 0 && generationContext?.generationType === "quiet") return messages;
  const chatId = generationContext?.chatId || null;
  const context = await getChatContext(chatId, generationContext?.userId);
  const profile = await loadProfile(context.scope, generationContext?.userId);
  const customEngines = await getCustomEngines(generationContext?.userId);
  const chatMessages = await getMessages(context.chatId);
  const result = buildPromptMessages(messages, chatMessages, profile, customEngines, context);
  if (profile.toggles.promptPreview) {
    spindle.sendToFrontend({
      type: "prompt:preview",
      payload: {
        estimatedInjectionTokens: result.estimatedInjectionTokens,
        changedMessages: result.changedMessages,
        messages: previewMessageText(result.messages)
      }
    }, generationContext?.userId);
  }
  return {
    messages: result.messages
  };
}, 40);

try {
  spindle.on("GENERATION_ENDED", (payload: any) => {
    const chatId = payload?.chatId;
    if (chatId) handlePostGeneration(chatId, payload?.userId).catch((err) => spindle.log.warn(`Megumin post-generation failed: ${String(err)}`));
  });
} catch {
  // Generation event permission may not be granted yet; the rest of the extension still works.
}

spindle.log.info(`${EXTENSION_NAME} Lumiverse backend loaded`);
