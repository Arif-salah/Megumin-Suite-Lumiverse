import type { CustomBlock, MeguminProfile, StatField } from "./types";

/**
 * The tracker blocks the model is asked to emit at the end of a reply, and the
 * machinery that wraps them in the single <Blocks> envelope that [[blocks]]
 * resolves to.
 *
 * Ported from the V9 beta (index.js:1154-1516). One structural change: every
 * function takes the profile explicitly instead of reading a module-level
 * `localProfile`, so an envelope can be built for any profile — which is what
 * lets the settings UI preview one without touching the open chat.
 */

export interface BlockDef {
  id: string;
  tag: string;
  label: string;
  emoji?: string;
  icon?: string;
  color?: string;
  visibility?: string;
  builtin?: boolean;
  repeating?: boolean;
  /** System blocks are not the reader's to arrange — they always sit at the end. */
  system?: boolean;
  preferFirst?: boolean;
  /** Read the body from a dict token, so engine overrides still apply. */
  source?: string;
  /** Or generate it from the profile's stat field list. */
  build?: (profile: MeguminProfile) => string;
  /** Or carry a fixed instruction line instead of a template. */
  slot?: string;
  content?: string;
  legacyIds?: string[];
  requires?: (profile: MeguminProfile) => boolean;
  slotRequires?: (dict: Record<string, string>) => boolean;
}

export const BLOCK_REGISTRY: BlockDef[] = [
  {
    id: "cyoa",
    tag: "CYOA",
    label: "Choices",
    emoji: "🎲",
    icon: "fa-list-check",
    color: "#38bdf8",
    visibility: "open",
    builtin: true,
    // The one block the reader acts on rather than reads, so it opens first and
    // sits at the front of the strip unless they move it.
    preferFirst: true,
    source: "cyoa",
    legacyIds: ["cyoa"]
  },
  {
    id: "world",
    tag: "World_State",
    label: "World State",
    emoji: "📌",
    icon: "fa-thumbtack",
    color: "#f59e0b",
    visibility: "open",
    builtin: true,
    source: "infoblock",
    legacyIds: ["info"]
  },
  {
    id: "chatter",
    tag: "NPC_Inner_Chatter",
    label: "NPC Inner Chatter",
    emoji: "💭",
    icon: "fa-comment-dots",
    color: "#a855f7",
    visibility: "open",
    builtin: true,
    source: "npc_inner_chatter",
    legacyIds: ["npc_inner_chatter", "npc_inner_chatter_v2"]
  },
  {
    id: "bonds",
    tag: "Bonds",
    label: "Bonds",
    emoji: "❤️",
    icon: "fa-heart",
    color: "#f43f5e",
    visibility: "open",
    builtin: true,
    // Generated from the field list rather than read from a token, so adding a
    // field changes what the model is actually asked for.
    build: (profile) => buildBondsTemplate(profile)
  },
  {
    id: "sheet",
    tag: "Character_Sheet",
    label: "Character Sheet",
    emoji: "🎒",
    icon: "fa-shield-halved",
    color: "#38bdf8",
    visibility: "open",
    builtin: true,
    build: (profile) => buildSheetTemplate(profile)
  },
  {
    id: "newNpc",
    tag: "New_NPC",
    label: "New NPC Dossier",
    emoji: "🆕",
    icon: "fa-user-plus",
    color: "#10b981",
    visibility: "open",
    builtin: true,
    repeating: true,
    system: true,
    // The dossier rules ride in [[npc_dossier]] elsewhere in the prompt, so this
    // slot line only appears on the turns those rules were actually injected.
    slot: "[A <New_NPC> dossier goes here when this response introduces an NPC that earns one. Follow the NPC DOSSIER rules above. Omit this tag entirely otherwise.]",
    requires: (profile) => Boolean(profile.npcBank?.enabled),
    slotRequires: (dict) => Boolean(String(dict.npcDossier || "").trim())
  },
  {
    id: "tracker",
    tag: "Story_Tracker",
    label: "Story Tracker",
    emoji: "🎬",
    icon: "fa-map",
    color: "#f43f5e",
    visibility: "open",
    builtin: true,
    system: true,
    source: "storytracker",
    requires: (profile) => Boolean(profile.storyPlan?.enabled)
  }
];

/** Blocks the reader can arrange. System blocks are placed by the engine. */
export function arrangeableBlocks(): BlockDef[] {
  return BLOCK_REGISTRY.filter((block) => !block.system);
}

function statFields(profile: MeguminProfile, blockId: string): StatField[] {
  const config = profile.statBlocks?.[blockId];
  return Array.isArray(config?.fields) ? config.fields.filter((field) => field && field.label) : [];
}

/** One field as the model should see it, placeholders and all. */
function statFieldSpec(field: StatField): string {
  const max = field.max || 100;
  switch (field.type) {
    case "meter":
      return `${field.label}: [0-${max}]/${max} [(±N reason) or (=)]`;
    case "number":
      return `${field.label}: [number] [(±N reason) or (=)]`;
    case "list":
      return `${field.label}: [${field.hint || "comma separated"}]`;
    default:
      return `${field.label}: [${field.hint || "value"}]`;
  }
}

/**
 * Change rules, written once per block from the fields it actually has. A block
 * with no meters and no numbers gets no carry-forward paragraph, because there is
 * nothing to carry.
 */
function statRules(fields: StatField[], subject: string, options: { perSubject?: boolean } = {}): string {
  const tracked = fields.filter((field) => field.type === "meter" || field.type === "number");
  if (!tracked.length) return "";

  const meters = fields.filter((field) => field.type === "meter");
  const seeds = tracked.map((field) => `${field.label} ${field.start !== undefined ? field.start : 0}`).join(", ");

  const lines = [
    `- Carry every number forward from the previous ${subject} block. Never reset one, and never invent a value that already exists.`,
    "- A number moves only when something in THIS scene moved it. Write the change and the reason in brackets, e.g. (-6 he apologised and she heard pity). When nothing moved it, write (=)."
  ];
  // The cap is for meters only. A counted field like Gold legitimately jumps by
  // hundreds, and a rule forbidding that would quietly stop the story paying anyone.
  if (meters.length) {
    lines.push(`- ${meters.map((field) => field.label).join(", ")} move at most 10 in one reply unless the scene plainly earns more.`);
  }
  lines.push(`- Starting values when there is no previous one${options.perSubject ? " for that person" : ""}: ${seeds}.`);
  return lines.join("\n");
}

/** The Bonds template: one line per NPC, generated from the field list. */
export function buildBondsTemplate(profile: MeguminProfile): string {
  const fields = statFields(profile, "bonds");
  if (!fields.length) return "";
  const line = fields.map(statFieldSpec).join(" | ");
  return [
    "[One line per named NPC present in the scene, plus any NPC whose numbers changed this scene. Nobody else.",
    statRules(fields, "Bonds", { perSubject: true }),
    "- These are feelings, not bodies. Do not describe clothing, posture or location here.]",
    "",
    `[NPC Name]: ${line}`
  ].filter(Boolean).join("\n");
}

/** The Character Sheet template: {{user}} only, so nothing repeats. */
export function buildSheetTemplate(profile: MeguminProfile): string {
  const fields = statFields(profile, "sheet");
  if (!fields.length) return "";
  const inline = fields.filter((field) => !field.ownLine).map(statFieldSpec).join(" | ");
  const own = fields.filter((field) => field.ownLine).map(statFieldSpec);
  return [
    "[{{user}}'s sheet.",
    statRules(fields, "Character Sheet"),
    "- Inventory and skills change only when the story changes them. Do not restock or re-equip on your own.]",
    "",
    inline,
    ...own
  ].filter(Boolean).join("\n");
}

export function blockById(profile: MeguminProfile, id: string): BlockDef | CustomBlock | undefined {
  return BLOCK_REGISTRY.find((block) => block.id === id)
    || (profile.blockStack?.custom || []).find((block) => block.id === id);
}

/**
 * Every child tag the envelope can carry, custom blocks included. Derived rather
 * than typed out: a tag missing from this list is a block that silently leaks into
 * the summariser, the vault, image prompts and the ban list.
 */
export function allBlockTags(profile: MeguminProfile): string[] {
  const custom = profile.blockStack?.custom || [];
  const tags = [...BLOCK_REGISTRY.map((block) => block.tag), ...custom.map((block) => block.tag)];
  return [...new Set(tags.filter(Boolean))];
}

/**
 * Content written for the old format opens with <details><summary>…</summary>. An
 * engine override or a hand-edited custom prompt can still carry that, and
 * wrapping it in a clean tag without taking the old wrapper off would put both in
 * the prompt.
 */
export function normalizeBlockBody(content: unknown, tag?: string): string {
  let out = String(content || "")
    .replace(/<summary[^>]*>[\s\S]*?<\/summary\s*>/gi, "")
    .replace(/<\/?details[^>]*>/gi, "");
  if (tag) out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The blocks actually emitted this turn, in order: in the stack, and — for blocks
 * owned by a subsystem — with that subsystem switched on.
 */
export function activeBlocks(profile: MeguminProfile): Array<BlockDef | CustomBlock> {
  const stack = profile.blockStack || { order: [], custom: [], overrides: {} };
  const enabled = (block: any) => block && (typeof block.requires !== "function" || block.requires(profile));

  const chosen = (stack.order || [])
    .map((id) => blockById(profile, id))
    .filter((block): block is BlockDef | CustomBlock => enabled(block) && !(block as BlockDef).system);

  const system = BLOCK_REGISTRY.filter((block) => block.system && enabled(block));

  return [...chosen, ...system];
}

/**
 * Assembles the <Blocks> envelope. Returns "" when nothing is active, so [[blocks]]
 * is stripped rather than leaving an empty shell.
 *
 * The instruction is a literal skeleton rather than a description of one — models
 * follow a structure they can see far more reliably than one they must infer.
 */
export function buildBlocksEnvelope(profile: MeguminProfile, dict: Record<string, string>): string {
  const active = activeBlocks(profile);
  if (!active.length) return "";

  const parts: string[] = [];
  for (const block of active) {
    const def = block as BlockDef;
    const overrides = profile.blockStack?.overrides || {};

    // A conditional block contributes its instruction line, not a template, and
    // only on the turns its own subsystem actually asked for it.
    if (def.slot) {
      if (typeof def.slotRequires === "function" && !def.slotRequires(dict)) continue;
      parts.push(def.slot);
      continue;
    }

    // Four ways a body arrives, in priority order: the reader's own override, a
    // template generated from a field list, a dict token the rest of the pipeline
    // already produced, or a custom block's own text.
    let raw: string;
    if (overrides[block.id]?.trim()) raw = overrides[block.id];
    else if (typeof def.build === "function") raw = def.build(profile);
    else if (def.source) raw = dict[def.source] || "";
    else raw = (block as CustomBlock).content || "";

    const body = normalizeBlockBody(
      String(raw).replace(/^#{1,3}\s*At the end of your response[^\n]*\n?/i, ""),
      block.tag
    );
    if (!body) continue;

    parts.push(`<${block.tag}>\n${body}\n</${block.tag}>`);
  }

  if (!parts.length) return "";

  const header = [
    "## At the end of your response, output exactly one <Blocks> section.",
    "Put every block inside it, in this order, each in its own tag. Do not add tags that are not listed. Do not nest blocks inside each other. Close every tag you open. Never wrap a block in <details> or <summary> — the interface draws the header and the fold itself."
  ].join("\n");

  return `${header}\n\n<Blocks>\n${parts.join("\n")}\n</Blocks>`;
}

/** The compact World State body, used on the turns that do not get the full one. */
export const COMPACT_WORLD_STATE =
  "Omit deep lore, unresolved threads, and off-screen tracking. Focus ONLY on immediate physical presence:\n<World_State>\n**Time & Loc:** [Time] at [Location]\n**PC:** [Brief visible clothing] | [Current posture/position]\n**NPCs Present:**\n* [Name]: [Brief visible clothing] | [Posture/position]\n</World_State>";

/** Block visibility choices, copied from the SillyTavern build. */
export const BLOCK_VISIBILITY_CHOICES = [
  { v: "open", label: "Shown", hint: "Gets a tab in the chat card" },
  { v: "hidden", label: "Hidden", hint: "No tab. Still sent, still read by the side panel." }
];

export const STAT_FIELD_PACKS: Record<string, Array<{ id: string; label: string; fields: StatField[] }>> = {
    bonds: [
        { id: "pack_romance", label: "Romance", fields: [
            { id: "affection", label: "Affection", type: "meter", max: 100, start: 20 },
            { id: "trust", label: "Trust", type: "meter", max: 100, start: 30 },
            { id: "desire", label: "Desire", type: "meter", max: 100, start: 0 },
            { id: "tension", label: "Tension", type: "meter", max: 100, start: 10 }
        ] },
        { id: "pack_rivalry", label: "Rivalry", fields: [
            { id: "respect", label: "Respect", type: "meter", max: 100, start: 20 },
            { id: "fear", label: "Fear", type: "meter", max: 100, start: 0 },
            { id: "grudge", label: "Grudge", type: "meter", max: 100, start: 0 }
        ] },
        { id: "pack_social", label: "Social", fields: [
            { id: "reputation", label: "Reputation", type: "meter", max: 100, start: 50 },
            { id: "suspicion", label: "Suspicion", type: "meter", max: 100, start: 0 }
        ] }
    ],
    sheet: [
        { id: "pack_rpg", label: "RPG", fields: [
            { id: "hp", label: "HP", type: "meter", max: 100, start: 100 },
            { id: "stamina", label: "Stamina", type: "meter", max: 100, start: 100 },
            { id: "mana", label: "Mana", type: "meter", max: 100, start: 100 },
            { id: "gold", label: "Gold", type: "number", start: 0 },
            { id: "skills", label: "Skills", type: "list", ownLine: true, hint: "Name rank, comma separated" },
            { id: "inventory", label: "Inventory", type: "list", ownLine: true, hint: "items, or \"nothing\"" }
        ] },
        { id: "pack_survival", label: "Survival", fields: [
            { id: "hunger", label: "Hunger", type: "meter", max: 100, start: 0 },
            { id: "thirst", label: "Thirst", type: "meter", max: 100, start: 0 },
            { id: "warmth", label: "Warmth", type: "meter", max: 100, start: 100 },
            { id: "injuries", label: "Injuries", type: "text", ownLine: true, hint: "or \"none\"" }
        ] }
    ]
};

export const STAT_FIELD_TYPES: Array<{ v: StatField["type"]; label: string; hint: string }> = [
    { v: "meter", label: "Meter", hint: "0–max, drawn as a bar" },
    { v: "number", label: "Number", hint: "a plain count, no cap" },
    { v: "text", label: "Text", hint: "a short line of prose" },
    { v: "list", label: "List", hint: "comma separated items" }
];
