import type { MemoryChunk, NpcRecord } from "./types";

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

export function parseNpcBlock(rawBlock: string): Partial<NpcRecord> {
  const strip = (s: string | undefined) => stripXmlishTags((s || "").replace(/\*\*/g, ""));
  const data: Partial<NpcRecord> = {};

  const nameLine = rawBlock.match(/\*\*Name:\*\*\s*(.*?)(?:\||$)/im);
  const ageLine = rawBlock.match(/\*\*Age:\*\*\s*(.*?)(?:\||$)/im);
  const sexLine = rawBlock.match(/\*\*Sex:\*\*\s*(.*?)(?:\||$|\n)/im);
  if (nameLine) data.name = strip(nameLine[1]);
  if (ageLine) data.age = strip(ageLine[1]);
  if (sexLine) data.sex = strip(sexLine[1]);

  const fields: Array<[keyof NpcRecord, RegExp]> = [
    ["appearance", /\*\*Appearance:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z]|<\/details>|$)/i],
    ["occupation", /\*\*Occupation:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z]|<\/details>|$)/i],
    ["background", /\*\*Background:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z]|<\/details>|$)/i],
    ["innerCircle", /\*\*Inner Circle:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z]|<\/details>|$)/i],
    ["personality", /\*\*Personality Snapshot:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z]|<\/details>|$)/i],
    ["agenda", /\*\*Current Agenda:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z]|<\/details>|$)/i],
    ["hiddenLayer", /\*\*Hidden Layer:\*\*\s*([\s\S]*?)(?=\s*<\/details>|$)/i]
  ];

  for (const [key, regex] of fields) {
    const match = rawBlock.match(regex);
    if (match) (data as Record<string, unknown>)[key] = strip(match[1]);
  }
  return data;
}

export function extractNpcBlocks(content: string): NpcRecord[] {
  const records: NpcRecord[] = [];
  const npcRegex = /<details>[\s\S]*?<summary>.*?New NPC:\s*(.*?)<\/summary>([\s\S]*?)<\/details>/gi;
  let match: RegExpExecArray | null;
  while ((match = npcRegex.exec(content)) !== null) {
    const fallbackName = stripXmlishTags(match[1]).replace(/\*\*/g, "").trim();
    const parsed = parseNpcBlock(match[0]);
    const name = parsed.name || fallbackName;
    if (!name) continue;
    records.push({
      name,
      age: parsed.age || "",
      sex: parsed.sex || "",
      appearance: parsed.appearance || "",
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

export function relevantChunks(vault: MemoryChunk[], recentText: string, topK = 3): MemoryChunk[] {
  if (vault.length === 0) return [];
  const keywords = extractKeywords(recentText);
  if (keywords.length === 0) return [];
  const totalDocs = vault.length;
  return vault
    .map((chunk) => {
      const text = normalizeText(chunk.text || chunk.summary || "");
      let score = 0;
      for (const keyword of keywords) {
        if (!text.includes(keyword)) continue;
        const docCount = Math.max(1, vault.filter((item) => normalizeText(item.text || item.summary || "").includes(keyword)).length);
        if (docCount < totalDocs * 0.5 || totalDocs < 3) score += Math.round(50 / docCount);
      }
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.chunk);
}

export function chunkContainsIndex(chunk: MemoryChunk, index: number): boolean {
  return index >= chunk.startIndex && index <= chunk.endIndex;
}
