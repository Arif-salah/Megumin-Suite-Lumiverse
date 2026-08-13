import type { NpcRecord } from "./types";

export function cleanAIOutput(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function cleanChatText(text: string): string {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<details>[\s\S]*?<\/details>/gi, "")
    .replace(/<img\s+prompt=["'][\s\S]*?["']\s*\/?>/gi, "")
    .replace(/<megumin-image[\s\S]*?<\/megumin-image>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(text: string): string {
  return cleanChatText(text).toLowerCase();
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function stripXmlishTags(value: string): string {
  return value.replace(/<\/?[^>]+>/g, "").trim();
}

export function npcBuildText(n: NpcRecord): string {
  const lines: string[] = [];
  lines.push(`Name: ${n.name || "Unknown"} | Age: ${n.age || "?"} | Sex: ${n.sex || "?"}`);
  if (n.appearance) lines.push(`Appearance: ${n.appearance}`);
  if (n.occupation) lines.push(`Occupation: ${n.occupation}`);
  if (n.background) lines.push(`Background: ${n.background}`);
  if (n.innerCircle) lines.push(`Inner Circle:\n${n.innerCircle}`);
  if (n.personality) lines.push(`Personality Snapshot: ${n.personality}`);
  if (n.agenda) lines.push(`Current Agenda: ${n.agenda}`);
  if (n.hiddenLayer) lines.push(`Hidden Layer: ${n.hiddenLayer}`);
  return lines.join("\n");
}

/**
 * Field labels, newest first. The V9 dossier template renamed several of them
 * (Occupation → Role, Personality Snapshot → Personality, Current Agenda →
 * Agenda, Hidden Layer → Secrets), so each record field accepts every label it
 * has ever been written under. A dossier from either template parses.
 */
const NPC_FIELD_LABELS: Array<[keyof NpcRecord, string[]]> = [
  ["appearance", ["Appearance"]],
  ["imageTags", ["Image Tags"]],
  ["occupation", ["Role", "Occupation"]],
  ["background", ["Background"]],
  ["innerCircle", ["Inner Circle"]],
  ["personality", ["Personality", "Personality Snapshot"]],
  ["agenda", ["Agenda", "Current Agenda"]],
  ["hiddenLayer", ["Secrets \\(never narrated unless disclosed\\)", "Secrets", "Hidden Layer"]]
];

export function parseNpcBlock(rawBlock: string): Partial<NpcRecord> {
  const strip = (s: string | undefined) => stripXmlishTags((s || "").replace(/\*\*/g, ""));
  const data: Partial<NpcRecord> = {};

  const nameLine = rawBlock.match(/\*\*Name:\*\*\s*(.*?)(?:\||$)/im);
  const ageLine = rawBlock.match(/\*\*Age:\*\*\s*(.*?)(?:\||$)/im);
  const sexLine = rawBlock.match(/\*\*Sex:\*\*\s*(.*?)(?:\||$|\n)/im);
  if (nameLine) data.name = strip(nameLine[1]);
  if (ageLine) data.age = strip(ageLine[1]);
  if (sexLine) data.sex = strip(sexLine[1]);

  for (const [key, labels] of NPC_FIELD_LABELS) {
    for (const label of labels) {
      // A field runs until the next bolded field, the end of either wrapper, or
      // the end of the block.
      const regex = new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[A-Z]|<\\/details>|<\\/New_NPC>|$)`, "i");
      const match = rawBlock.match(regex);
      if (match && strip(match[1])) {
        (data as Record<string, unknown>)[key] = strip(match[1]);
        break;
      }
    }
  }
  return data;
}

/**
 * Both dossier wrappers the suite has shipped:
 *   V9  — <New_NPC name="Arue"> … </New_NPC>, which the Blocks envelope emits
 *   V7  — <details><summary>New NPC: Arue</summary> … </details>
 *
 * Reading only the one the current template asks for would silently drop every
 * dossier written under the other, so both are matched.
 */
const NPC_BLOCK_PATTERNS: RegExp[] = [
  /<New_NPC(?:\s+name=["']?(.*?)["']?)?\s*>([\s\S]*?)<\/New_NPC\s*>/gi,
  /<details>[\s\S]*?<summary>.*?New NPC:\s*(.*?)<\/summary>([\s\S]*?)<\/details>/gi
];

export function extractNpcBlocks(content: string): NpcRecord[] {
  const records: NpcRecord[] = [];
  const seen = new Set<string>();

  for (const pattern of NPC_BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const fallbackName = stripXmlishTags(match[1] || "").replace(/\*\*/g, "").trim();
      const parsed = parseNpcBlock(match[0]);
      const name = parsed.name || fallbackName;
      if (!name) continue;

      // The same NPC can appear under both wrappers in one message; keep the first.
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      records.push({
        name,
        age: parsed.age || "",
        sex: parsed.sex || "",
        appearance: parsed.appearance || "",
        imageTags: parsed.imageTags || "",
        occupation: parsed.occupation || "",
        background: parsed.background || "",
        innerCircle: parsed.innerCircle || "",
        personality: parsed.personality || "",
        agenda: parsed.agenda || "",
        hiddenLayer: parsed.hiddenLayer || "",
        pfp: "",
        timestamp: Date.now()
      });
    }
  }
  return records;
}

const STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "almost", "along", "already",
  "always", "among", "another", "around", "because", "before", "behind",
  "being", "between", "beyond", "could", "during", "enough", "every",
  "everything", "from", "have", "having", "here", "inside", "itself", "just",
  "know", "known", "like", "little", "made", "make", "many", "more", "most",
  "much", "never", "next", "nothing", "often", "only", "other", "perhaps",
  "please", "quite", "rather", "really", "same", "seems", "should", "since",
  "some", "someone", "something", "still", "such", "than", "that", "their",
  "them", "then", "there", "these", "they", "thing", "things", "this", "those",
  "through", "together", "toward", "under", "until", "upon", "very", "want",
  "wanted", "well", "were", "what", "when", "where", "which", "while", "will",
  "with", "within", "would", "your", "yours", "dialogue", "narration",
  "narrative", "summary", "world", "state", "action", "voice", "eyes", "face",
  "hands", "room", "time", "back", "away", "down", "slowly", "softly"
]);

export function extractKeywords(text: string): string[] {
  const words = (text.match(/\p{L}[\p{L}\p{N}_-]*/gu) || []).map((word) => word.toLowerCase());
  return [...new Set(words)].filter((word) => {
    if (STOP_WORDS.has(word)) return false;
    if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(word)) return word.length >= 1;
    return word.length >= 3;
  });
}

