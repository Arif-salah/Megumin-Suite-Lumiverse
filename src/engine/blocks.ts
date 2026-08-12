import type { CustomBlock, EngineDict, MeguminProfile, StatField } from '../shared/types'

/**
 * The tracker blocks the model can be asked to emit at the end of a reply, and the
 * machinery that assembles them into the single <Blocks> envelope.
 *
 * Ported from index.js:1154-1516. The one structural change: every function takes
 * the profile explicitly instead of reading a module-level `localProfile`, so the
 * envelope can be built for any profile — which is what makes the panel's live
 * preview possible without touching the chat that is actually open.
 */

export interface BlockDef {
  id: string
  tag: string
  label: string
  emoji?: string
  icon?: string
  color?: string
  visibility?: string
  builtin?: boolean
  repeating?: boolean
  /** System blocks are not the reader's to arrange — they sit at the end, always. */
  system?: boolean
  preferFirst?: boolean
  /** Read the body from a dict token, so engine overrides still apply. */
  source?: string
  /** Or generate it from the profile's field list. */
  build?: (profile: MeguminProfile) => string
  /** Or carry a fixed instruction line instead of a template. */
  slot?: string
  content?: string
  legacyIds?: string[]
  requires?: (profile: MeguminProfile) => boolean
  slotRequires?: (dict: EngineDict) => boolean
}

export const BLOCK_REGISTRY: BlockDef[] = [
  {
    id: 'cyoa',
    tag: 'CYOA',
    label: 'Choices',
    emoji: '🎲',
    icon: 'fa-list-check',
    color: '#38bdf8',
    visibility: 'open',
    builtin: true,
    // The one block the reader acts on rather than reads, so it opens first
    // and sits at the front of the strip unless they move it.
    preferFirst: true,
    source: '[[cyoa]]',
    legacyIds: ['cyoa'],
  },
  {
    id: 'world',
    tag: 'World_State',
    label: 'World State',
    emoji: '📌',
    icon: 'fa-thumbtack',
    color: '#f59e0b',
    visibility: 'open',
    builtin: true,
    source: '[[infoblock]]',
    legacyIds: ['info'],
  },
  {
    id: 'chatter',
    tag: 'NPC_Inner_Chatter',
    label: 'NPC Inner Chatter',
    emoji: '💭',
    icon: 'fa-comment-dots',
    color: '#a855f7',
    visibility: 'open',
    builtin: true,
    source: '[[npc_inner_chatter]]',
    legacyIds: ['npc_inner_chatter', 'npc_inner_chatter_v2'],
  },
  {
    id: 'bonds',
    tag: 'Bonds',
    label: 'Bonds',
    emoji: '❤️',
    icon: 'fa-heart',
    color: '#f43f5e',
    visibility: 'open',
    builtin: true,
    // Generated from the field list rather than read from a dict tag, so
    // adding a field changes what the model is asked for.
    build: (p) => buildBondsTemplate(p),
  },
  {
    id: 'sheet',
    tag: 'Character_Sheet',
    label: 'Character Sheet',
    emoji: '🎒',
    icon: 'fa-shield-halved',
    color: '#38bdf8',
    visibility: 'open',
    builtin: true,
    build: (p) => buildSheetTemplate(p),
  },
  {
    id: 'newNpc',
    tag: 'New_NPC',
    label: 'New NPC Dossier',
    emoji: '🆕',
    icon: 'fa-user-plus',
    color: '#10b981',
    visibility: 'open',
    builtin: true,
    repeating: true,
    system: true,
    // The dossier rules ride in [[npc_dossier]] elsewhere in the prompt. The
    // slot line only makes sense next to those rules, so it appears only on the
    // turns where they were actually injected.
    slot: '[A <New_NPC> dossier goes here when this response introduces an NPC that earns one. Follow the NPC DOSSIER rules above. Omit this tag entirely otherwise.]',
    requires: (p) => Boolean((p as any).npcBank?.enabled),
    slotRequires: (dict) => Boolean(String(dict['[[npc_dossier]]'] || '').trim()),
  },
  {
    id: 'tracker',
    tag: 'Story_Tracker',
    label: 'Story Tracker',
    emoji: '🎬',
    icon: 'fa-map',
    color: '#f43f5e',
    visibility: 'open',
    builtin: true,
    system: true,
    source: '[[storytracker]]',
    requires: (p) => Boolean((p as any).storyPlan?.enabled),
  },
]

function statFields(profile: MeguminProfile, blockId: string): StatField[] {
  const cfg = profile.statBlocks?.[blockId]
  return Array.isArray(cfg?.fields) ? cfg.fields.filter((f) => f && f.label) : []
}

/** One field as the model should see it, placeholders and all. */
function statFieldSpec(f: StatField): string {
  const max = f.max || 100
  switch (f.type) {
    case 'meter':
      return `${f.label}: [0-${max}]/${max} [(±N reason) or (=)]`
    case 'number':
      return `${f.label}: [number] [(±N reason) or (=)]`
    case 'list':
      return `${f.label}: [${f.hint || 'comma separated'}]`
    default:
      return `${f.label}: [${f.hint || 'value'}]`
  }
}

/**
 * Change rules, written once per block from the fields it actually has. A block
 * with no meters and no numbers gets no carry-forward paragraph, because there is
 * nothing to carry.
 */
function statRules(fields: StatField[], subject: string, opts: { perSubject?: boolean } = {}): string {
  const tracked = fields.filter((f) => f.type === 'meter' || f.type === 'number')
  if (!tracked.length) return ''

  const meters = fields.filter((f) => f.type === 'meter')
  const seeds = tracked.map((f) => `${f.label} ${f.start !== undefined ? f.start : 0}`).join(', ')

  const lines = [
    `- Carry every number forward from the previous ${subject} block. Never reset one, and never invent a value that already exists.`,
    `- A number moves only when something in THIS scene moved it. Write the change and the reason in brackets, e.g. (-6 he apologised and she heard pity). When nothing moved it, write (=).`,
  ]
  // The cap is for meters only. A counted field like Gold legitimately jumps by
  // hundreds, and a rule forbidding it would quietly stop the story paying anyone.
  if (meters.length) {
    lines.push(`- ${meters.map((f) => f.label).join(', ')} move at most 10 in one reply unless the scene plainly earns more.`)
  }
  lines.push(`- Starting values when there is no previous one${opts.perSubject ? ' for that person' : ''}: ${seeds}.`)
  return lines.join('\n')
}

/** The Bonds template: one line per NPC, generated from the field list. */
export function buildBondsTemplate(profile: MeguminProfile): string {
  const fields = statFields(profile, 'bonds')
  if (!fields.length) return ''
  const line = fields.map(statFieldSpec).join(' | ')
  return [
    '[One line per named NPC present in the scene, plus any NPC whose numbers changed this scene. Nobody else.',
    statRules(fields, 'Bonds', { perSubject: true }),
    '- These are feelings, not bodies. Do not describe clothing, posture or location here.]',
    '',
    `[NPC Name]: ${line}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The Character Sheet template: {{user}} only, so nothing repeats. */
export function buildSheetTemplate(profile: MeguminProfile): string {
  const fields = statFields(profile, 'sheet')
  if (!fields.length) return ''
  const inline = fields.filter((f) => !f.ownLine).map(statFieldSpec).join(' | ')
  const own = fields.filter((f) => f.ownLine).map(statFieldSpec)
  return [
    "[{{user}}'s sheet.",
    statRules(fields, 'Character Sheet'),
    '- Inventory and skills change only when the story changes them. Do not restock or re-equip on your own.]',
    '',
    inline,
    ...own,
  ]
    .filter(Boolean)
    .join('\n')
}

export function blockById(profile: MeguminProfile, id: string): BlockDef | CustomBlock | undefined {
  return (
    BLOCK_REGISTRY.find((b) => b.id === id) ||
    (profile.blockStack?.custom || []).find((b) => b.id === id)
  )
}

/**
 * Every child tag the envelope can carry, custom blocks included. Derived rather
 * than typed out: a tag missing from this list is a block that silently leaks into
 * the summariser and the image prompts.
 */
export function allBlockTags(profile: MeguminProfile): string[] {
  const custom = profile.blockStack?.custom || []
  const tags = [...BLOCK_REGISTRY.map((b) => b.tag), ...custom.map((b) => b.tag)]
  return [...new Set(tags.filter(Boolean))]
}

/**
 * Content written for the old format opens with <details><summary>…</summary>.
 * An engine override or a custom prompt can still be carrying that, and wrapping
 * it in a clean tag without taking the old wrapper off would put both in the prompt.
 */
export function normalizeBlockBody(content: unknown, tag?: string): string {
  let out = String(content || '')
    .replace(/<summary[^>]*>[\s\S]*?<\/summary\s*>/gi, '')
    .replace(/<\/?details[^>]*>/gi, '')
  if (tag) {
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The blocks actually emitted this turn, in order: in the stack, and — for blocks
 * owned by a subsystem — with that subsystem switched on.
 */
export function activeBlocks(profile: MeguminProfile): Array<BlockDef | CustomBlock> {
  const stack = profile.blockStack || { order: [], custom: [], overrides: {} }
  const on = (b: any) => b && (typeof b.requires !== 'function' || b.requires(profile))

  const chosen = (stack.order || [])
    .map((id) => blockById(profile, id))
    .filter((b): b is BlockDef | CustomBlock => on(b) && !(b as BlockDef).system)

  const system = BLOCK_REGISTRY.filter((b) => b.system && on(b))

  return [...chosen, ...system]
}

/**
 * Assembles the <Blocks> envelope. Returns "" when nothing is active, so the
 * [[blocks]] token is stripped from the preset rather than leaving an empty shell.
 *
 * The instruction is a literal skeleton rather than a description of one — models
 * follow a structure they can see far more reliably than one they must infer.
 */
export function buildBlocksEnvelope(profile: MeguminProfile, dict: EngineDict): string {
  const active = activeBlocks(profile)
  if (!active.length) return ''

  const parts: string[] = []
  for (const b of active) {
    const def = b as BlockDef

    // A conditional block contributes its instruction line, not a template, and
    // only on the turns its own subsystem actually asked for it.
    if (def.slot) {
      if (typeof def.slotRequires === 'function' && !def.slotRequires(dict)) continue
      parts.push(def.slot)
      continue
    }

    // Three ways a body arrives: a dict token the rest of the pipeline already
    // produced (so engine overrides and custom prompts still apply), a template
    // generated from a field list, or a custom block's own text.
    let raw: string
    if (typeof def.build === 'function') raw = def.build(profile)
    else if (def.source) raw = dict[def.source] || ''
    else raw = (b as CustomBlock).content || ''

    const body = normalizeBlockBody(
      String(raw).replace(/^#{1,3}\s*At the end of your response[^\n]*\n?/i, ''),
      b.tag,
    )
    if (!body) continue

    parts.push(`<${b.tag}>\n${body}\n</${b.tag}>`)
  }

  if (!parts.length) return ''

  const header = [
    '## At the end of your response, output exactly one <Blocks> section.',
    'Put every block inside it, in this order, each in its own tag. Do not add tags that are not listed. Do not nest blocks inside each other. Close every tag you open. Never wrap a block in <details> or <summary> — the interface draws the header and the fold itself.',
  ].join('\n')

  return `${header}\n\n<Blocks>\n${parts.join('\n')}\n</Blocks>`
}
