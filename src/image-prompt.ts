import type { ImageGenSettings, LlmMessage, MeguminProfile, NpcRecord } from "./types";
import { DEFAULT_PROMPTS } from "./default-prompts";

/**
 * Image Generation prompt assembly.
 *
 * The port previously built image prompts from three canned sentences. This
 * restores the beta's six tuned template variants (Illustrious / SDXL crossed
 * with POV / Cinematic / Portrait), the optional example sets, the direct-language
 * tag reference, and NPC appearance tag injection.
 */

/** Booru-tag mode. Verbatim from the beta so explicit scenes tag consistently. */
export const DIRECT_LANGUAGE_BLOCK = "**DIRECT LANGUAGE:** Use exact Booru tags only. \"naked\" not \"wearing nothing.\" \"erection\" not \"visible arousal.\"\n\n**NSFW TAG REFERENCE (use when scene is explicit):**\nBody: naked, nude, topless, exposed nipples, small breasts, medium breasts, large breasts, spread legs, ass, erection, veins, veiny penis\nActions: hetero, sex, vaginal, anal, oral, fellatio, after fellatio, paizuri, straddling, riding, missionary, doggystyle, cowgirl position, moaning, open mouth, tongue out, ahegao, clenching teeth\nFluids: cum, cum on body, cum on breasts, cum on face, cum on hair, cum on tongue, cum in mouth, cum inside, ejaculation, facial, saliva, sweat\nState: flushed face, heavy breathing, trembling, crying with eyes open, half-closed eyes, solo focus";

type TemplateKey =
  | "illus_pov" | "sdxl_pov"
  | "illus_cinematic" | "sdxl_cinematic"
  | "illus_portrait" | "sdxl_portrait";

const TEMPLATE_FIELDS: Record<TemplateKey, [rules: string, examples: string]> = {
  illus_pov: ["rulesIllusPov", "examplesIllusPov"],
  sdxl_pov: ["rulesSdxlPov", "examplesSdxlPov"],
  illus_cinematic: ["rulesIllusCinematic", "examplesIllusCinematic"],
  sdxl_cinematic: ["rulesSdxlCinematic", "examplesSdxlCinematic"],
  illus_portrait: ["rulesIllusPortrait", "examplesIllusPortrait"],
  sdxl_portrait: ["rulesSdxlPortrait", "examplesSdxlPortrait"]
};

/**
 * The beta stored one `promptTemplate` key; this port stores style and
 * perspective separately and already has UI for both. Crossing them here keeps
 * existing settings working while reaching the beta's template set. The
 * "standard" style has no templates of its own, so it borrows the Illustrious
 * rules, which is what the beta's default did.
 */
export function templateKey(settings: ImageGenSettings): TemplateKey {
  const style = settings.promptStyle === "sdxl" ? "sdxl" : "illus";
  const shape =
    settings.promptPerspective === "pov" ? "pov"
      : settings.promptPerspective === "character" ? "portrait"
        : "cinematic";
  return `${style}_${shape}` as TemplateKey;
}

export function imagePrompts(profile: MeguminProfile) {
  const settings = profile.imageGen as ImageGenSettings & {
    customPromptsEnabled?: boolean;
    customPrompts?: Record<string, string> | null;
  };
  const custom = settings.customPromptsEnabled ? settings.customPrompts : null;
  const defaults = DEFAULT_PROMPTS.imageGen as unknown as Record<string, string>;
  const pick = (key: string) => custom?.[key] || defaults[key] || "";
  return {
    systemPrompt: pick("systemPrompt"),
    userPrompt: pick("userPrompt"),
    thinkingPrompt: pick("thinkingPrompt"),
    injectionTemplate: pick("injectionTemplate"),
    field: pick
  };
}

/** Rules and examples for the active template. Examples are optional. */
export function templateParts(profile: MeguminProfile): { rules: string; examples: string } {
  const prompts = imagePrompts(profile);
  const [rulesKey, examplesKey] = TEMPLATE_FIELDS[templateKey(profile.imageGen)];
  const includeExamples = (profile.imageGen as { includeExamples?: boolean }).includeExamples !== false;
  return {
    rules: prompts.field(rulesKey),
    examples: includeExamples ? prompts.field(examplesKey) : ""
  };
}

/**
 * Booru tags for the NPCs the recent scene actually mentions, so the image model
 * draws established characters consistently instead of reinventing them.
 */
export function relevantNpcImageTags(profile: MeguminProfile, recentText: string): string {
  if (!(profile.imageGen as { injectNpcTags?: boolean }).injectNpcTags) return "";
  const npcs = profile.npcBank?.npcs || [];
  if (!npcs.length || !recentText.trim()) return "";

  const haystack = recentText.toLowerCase();
  const lines = npcs
    .filter((npc: NpcRecord) => npc.name && haystack.includes(npc.name.toLowerCase()))
    .map((npc: NpcRecord) => {
      const tags = String((npc as NpcRecord & { imageTags?: string }).imageTags || npc.appearance || "").trim();
      return tags ? `${npc.name}: ${tags}` : "";
    })
    .filter(Boolean);

  if (!lines.length) return "";
  return `**KNOWN CHARACTER TAGS (use these exact tags for these characters):**\n${lines.join("\n")}`;
}

function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function extraSection(settings: ImageGenSettings): string {
  return settings.promptExtra ? `Extra Instructions: ${settings.promptExtra}` : "";
}

function directLanguage(settings: ImageGenSettings): string {
  return (settings as { directLanguage?: boolean }).directLanguage ? DIRECT_LANGUAGE_BLOCK : "";
}

/** The [[img1]] / [[img2]] injection that rides along with the main generation. */
export function buildImageInjection(profile: MeguminProfile, recentText: string): { img1: string; img2: string } {
  const settings = profile.imageGen;
  if (!settings.enabled) return { img1: "", img2: "" };

  const prompts = imagePrompts(profile);
  const { rules, examples } = templateParts(profile);
  const imageCount = String((settings as { imageCount?: number }).imageCount || 1);
  const conditionalText = settings.triggerMode === "conditional"
    ? "Only output the image tag if a character explicitly takes, sends, or shares an image in this moment.\n"
    : "";

  const img1 = fillTemplate(prompts.injectionTemplate, {
    conditionalText,
    imageCount,
    templateRules: rules,
    promptExtra: extraSection(settings),
    directLanguage: directLanguage(settings),
    npcImageTags: relevantNpcImageTags(profile, recentText),
    templateExamples: examples
  });

  return { img1, img2: ` and the ${imageCount} image tag` };
}

/** The message array for a standalone image-prompt generation. */
export function buildImagePromptMessages(profile: MeguminProfile, chatText: string): LlmMessage[] {
  const settings = profile.imageGen;
  const prompts = imagePrompts(profile);
  const { rules, examples } = templateParts(profile);

  const messages: LlmMessage[] = [
    { role: "system", content: prompts.systemPrompt },
    {
      role: "user",
      content: fillTemplate(prompts.userPrompt, {
        chatHistory: chatText,
        templateRules: rules,
        extraStr: extraSection(settings),
        directLanguage: directLanguage(settings),
        npcImageTags: relevantNpcImageTags(profile, chatText),
        templateExamples: examples
      })
    },
    { role: "system", content: prompts.thinkingPrompt }
  ];

  if (!profile.disableUtilityPrefill) {
    messages.push({ role: "assistant", content: "<think>\nAnalyzing the scene for the image prompt...\n" });
  }
  return messages;
}

/**
 * Pulls the prompt out of an <img prompt="..."> tag when the model wraps it, which
 * it does whenever the injection template is in play.
 */
export function extractImagePrompt(raw: string): string {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = /<img[^>]*?prompt=(["']?)([\s\S]*?)(?:\1\s*\/?>|\1\s+[a-zA-Z]+=)/i.exec(cleaned);
  return (match ? match[2] : cleaned).trim();
}
