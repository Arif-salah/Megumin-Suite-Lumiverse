import type { LlmMessage, MeguminProfile, NpcBankSettings } from "./types";
import { DEFAULT_PROMPTS } from "./default-prompts";

/**
 * NPC Bank prompts.
 *
 * The port carried a single hardcoded dossier template. This restores the beta's
 * tuned scan prompts and its user-editable dossier format, which is also what the
 * parser expects the model to emit.
 */

export function npcPrompts(profile: MeguminProfile) {
  const bank = profile.npcBank as NpcBankSettings & {
    customPromptsEnabled?: boolean;
    customPrompts?: Record<string, string> | null;
  };
  const custom = bank.customPromptsEnabled ? bank.customPrompts : null;
  const defaults = DEFAULT_PROMPTS.npcBank as unknown as Record<string, string>;
  const pick = (key: string) => custom?.[key] || defaults[key] || "";
  return {
    systemPrompt: pick("systemPrompt"),
    userPrompt: pick("userPrompt"),
    thinkingPrompt: pick("thinkingPrompt"),
    dossierTemplate: pick("dossierTemplate")
  };
}

/**
 * The [[npc_dossier]] rules injected into the main generation. These are the
 * *rules*, not the block — the envelope's New_NPC slot line refers back to them,
 * which is why the engine never blanks this token.
 */
export function buildNpcDossierDirective(profile: MeguminProfile): string {
  if (!profile.npcBank.enabled) return "";
  return npcPrompts(profile).dossierTemplate;
}

/** The message array for an explicit "scan this chat for NPCs I don't have" run. */
export function buildNpcScanMessages(profile: MeguminProfile, chatText: string): LlmMessage[] {
  const prompts = npcPrompts(profile);
  const existingNames = profile.npcBank.npcs.map((npc) => npc.name).filter(Boolean).join(", ") || "None";

  const messages: LlmMessage[] = [
    { role: "system", content: prompts.systemPrompt },
    {
      role: "user",
      content: prompts.userPrompt
        .split("{{existingNames}}").join(existingNames)
        .split("{{dossierTemplate}}").join(prompts.dossierTemplate)
        .split("{{chatHistory}}").join(chatText)
        // The beta's scan prompt names these slots; anything it does not use is
        // left untouched rather than blanked, so a custom prompt can rely on them.
        .split("{{npcText}}").join(chatText)
    },
    { role: "system", content: prompts.thinkingPrompt }
  ];

  if (!profile.disableUtilityPrefill) {
    messages.push({ role: "assistant", content: "<think>\nScanning for missing significant NPCs...\n" });
  }
  return messages;
}
