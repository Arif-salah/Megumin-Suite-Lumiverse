import type { LlmMessage, MeguminProfile, StoryPlanSettings } from "./types";
import { DEFAULT_PROMPTS } from "./default-prompts";

/**
 * Story Planner — the Director.
 *
 * Ported from the V9 beta. The port previously shipped a two-line brainstorm
 * prompt; this restores the real thing: director settings, the narrative
 * blueprint format, plan evolution, and the tracker template.
 */

export const SD_GENRES: Record<string, { label: string; desc: string }> = {
  "slice-of-life": { label: "Slice of Life", desc: "Daily rhythms, small moments, character-driven warmth." },
  drama: { label: "Drama", desc: "Emotional conflict, relationship tension, high stakes feelings." },
  romance: { label: "Romance", desc: "Love as the central engine — pursuit, longing, devotion." },
  action: { label: "Action / Adventure", desc: "Physical danger, quests, combat, exploration." },
  mystery: { label: "Mystery / Thriller", desc: "Secrets, investigation, paranoia, carefully timed reveals." },
  fantasy: { label: "Fantasy / RPG", desc: "Magic systems, world-building, quests, power progression." },
  horror: { label: "Horror / Dark", desc: "Dread, survival, psychological terror, body horror." },
  scifi: { label: "Sci-Fi", desc: "Technology, space, dystopia, transhumanism." },
  comedy: { label: "Comedy", desc: "Humor-driven, absurdist, sitcom energy, comedic timing." }
};

export const SD_FLAVORS = [
  // Relationship Dynamics
  "Rivals to Lovers", "Forbidden Love", "Found Family", "Toxic Attachment", "Slow Burn Romance", "Love Triangle",
  // Plot Structure
  "Heist", "Revenge", "Redemption Arc", "Secret Identity", "Mystery & Deception", "Tournament Arc",
  // Tone & Mood
  "Dark Comedy", "Gothic", "Bittersweet", "Tragic", "Horror-Comedy", "Noir",
  // Setting & World
  "Urban Fantasy", "Historical", "Survival", "Post-Apocalyptic", "Victorian Gothic", "Cyberpunk",
  // Character & Theme
  "Coming of Age", "Identity", "Cognitive Dissonance", "Moral Ambiguity", "Corruption Arc",
  // Special & Niche
  "Slice of Life", "Body Horror", "Fish Out of Water", "Fish In Water", "Political Intrigue",
  "War", "Isekai", "Harem", "Monster", "Mind Control", "Memory Loss", "Time Loop"
];

export const SD_CONTENT_RATINGS = ["none", "sfw", "nsfw"];
export const SD_PACING = ["slowburn", "natural", "accelerate"];

/** The user's overrides for this subsystem, or the shipped defaults. */
function storyPrompts(plan: StoryPlanSettings) {
  const custom = plan.customPromptsEnabled ? plan.customPrompts : null;
  const defaults = DEFAULT_PROMPTS.storyPlan;
  return {
    systemPrompt: custom?.systemPrompt || defaults.systemPrompt,
    userPrompt: custom?.userPrompt || defaults.userPrompt,
    thinkingPrompt: custom?.thinkingPrompt || defaults.thinkingPrompt,
    injectionTemplate: custom?.injectionTemplate || defaults.injectionTemplate,
    trackerTemplate: custom?.trackerTemplate || defaults.trackerTemplate,
    unrestrictedBlock: custom?.unrestrictedBlock || defaults.unrestrictedBlock
  };
}

/**
 * The DIRECTOR SETTINGS block handed to the Story Maker. An existing plan is
 * passed back in so the model evolves it rather than starting over.
 */
export function buildDirectorSettings(plan: StoryPlanSettings): string {
  let out = "DIRECTOR SETTINGS:\n";
  if (plan.contentRating && plan.contentRating !== "none") out += `- Content Rating: ${plan.contentRating.toUpperCase()}\n`;
  out += `- Pacing: ${String(plan.pacing || "natural").toUpperCase()}\n`;
  out += `- Primary Genre: ${SD_GENRES[plan.primaryGenre]?.label || "Drama"}\n`;
  if (plan.flavorTags?.length) out += `- Flavor Elements: ${plan.flavorTags.join(", ")}\n`;
  if (plan.directorsNote?.trim()) out += `- Director's Note: ${plan.directorsNote.trim()}\n`;

  if (plan.currentPlan?.trim()) {
    out += `\nPREVIOUS DIRECTIVE (Update/Evolve this):\n${plan.currentPlan.trim()}\n`;
  } else {
    out += "\nGenerate the first narrative directive for this story.\n";
  }
  return out;
}

/**
 * The message array for a directive generation. This is a direct provider call,
 * so the messages are supplied whole rather than shaped by the preset — the ST
 * build achieved the same thing by emptying the prompt and refilling it.
 */
export function buildStoryPlanMessages(
  profile: MeguminProfile,
  chatText: string,
  lore: { charLore: string; userPersona: string }
): LlmMessage[] {
  const plan = profile.storyPlan;
  const prompts = storyPrompts(plan);

  const messages: LlmMessage[] = [
    {
      role: "system",
      content: prompts.systemPrompt
        .replace("{{charLore}}", lore.charLore || "No character description found.")
        .replace("{{userPersona}}", lore.userPersona || "No user persona found.")
        .replace("{{chatHistory}}", chatText)
    },
    { role: "user", content: prompts.userPrompt.replace("{{directorSettings}}", buildDirectorSettings(plan)) },
    { role: "system", content: prompts.thinkingPrompt }
  ];

  if (!profile.disableUtilityPrefill) {
    messages.push({ role: "assistant", content: "ok i will start thinking \n<think>\n" });
  }
  return messages;
}

/** Pulls the directive out of the model's reply, tolerating the thinking block. */
export function extractDirective(raw: string): string {
  const tagged = /<directive>([\s\S]*?)<\/directive>/i.exec(raw);
  if (tagged) return tagged[1].trim();
  // No tags: drop any thinking block and keep the rest.
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?directive>/gi, "").trim();
}

/** What [[storyplan]] and [[storytracker]] resolve to for the main generation. */
export function buildStoryPlanInjection(profile: MeguminProfile): { storyplan: string; storytracker: string } {
  const plan = profile.storyPlan;
  if (!plan.enabled) return { storyplan: "", storytracker: "" };

  const prompts = storyPrompts(plan);
  let injection = "";
  if (plan.unrestrictedContent) injection += prompts.unrestrictedBlock + "\n\n";
  if (plan.currentPlan?.trim()) injection += prompts.injectionTemplate.replace("{{planText}}", plan.currentPlan.trim());

  return { storyplan: injection.trim(), storytracker: prompts.trackerTemplate };
}
