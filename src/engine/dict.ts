import type { EngineDict, MeguminProfile } from '../shared/types'
import { hardcodedLogic } from './database'
import { buildBlocksEnvelope } from './blocks'
import { buildConfigBlock } from './config-block'

/**
 * Builds the `[[token]]` → replacement map for one generation.
 *
 * Ported from `buildBaseDict()` (index.js:9016-9420). Two changes from the
 * SillyTavern version:
 *
 *  - the profile is a parameter, not a module global, so the panel can preview a
 *    dict for a profile that isn't the active one
 *  - the tokens owned by subsystems this build doesn't ship yet (Memory Core,
 *    Story Planner, Image Gen, NPC Bank, ban list) are emitted as empty strings.
 *    They are *declared*, not forgotten: the substituter strips an empty token
 *    along with the line it sits on, so a preset carrying them stays clean until
 *    the subsystem that owns them lands.
 */

/** Tokens whose owning subsystem has not been ported yet. Declared empty. */
export const UNPORTED_TOKENS = [
  '[[long-Memory]]',
  '[[Short-memory]]',
  '[[storyplan]]',
  '[[storytracker]]',
  '[[storytracker2]]',
  '[[banlist]]',
  '[[img1]]',
  '[[img2]]',
  '[[npc_dossier]]',
  '[[npc_dossier2]]',
  '[[npc list]]',
  '[[npc_events]]',
] as const

export interface DictOptions {
  /**
   * Token-count / preview mode. Skips the work whose result gets thrown away and
   * keeps the output deterministic (no chat-position-dependent branches).
   */
  preview?: boolean
  /** AI message count so far in this chat — drives compact World State cadence. */
  aiMessageCount?: number
}

type AnyEngine = Record<string, any>

export function buildBaseDict(profile: MeguminProfile, opts: DictOptions = {}): EngineDict {
  const dict: EngineDict = {}
  if (!profile) return dict

  const logic = hardcodedLogic as AnyEngine
  const activeEngine: AnyEngine | undefined = (logic.modes as AnyEngine[]).find(
    (m) => m.id === profile.mode,
  )

  const isV7 = activeEngine ? activeEngine.id.startsWith('v7') || activeEngine.isV7 === true : false
  const isV8 = activeEngine ? activeEngine.id.startsWith('v8') || activeEngine.isV8 === true : false
  const isV9 = activeEngine ? activeEngine.id.startsWith('v9') || activeEngine.isV9 === true : false

  // ── V9 length bands ──────────────────────────────────────────────────────────
  if (isV9) {
    const v9l: Partial<MeguminProfile['v9Limits']> = profile.v9Limits || {}
    dict['[[v9_lean_min]]'] = String(v9l.leanMin || 300)
    dict['[[v9_lean_max]]'] = String(v9l.leanMax || 400)
    dict['[[v9_full_min]]'] = String(v9l.fullMin || 700)
    dict['[[v9_full_max]]'] = String(v9l.fullMax || 1200)
  } else {
    dict['[[v9_lean_min]]'] = ''
    dict['[[v9_lean_max]]'] = ''
    dict['[[v9_full_min]]'] = ''
    dict['[[v9_full_max]]'] = ''
  }

  // ── 1. Globals ───────────────────────────────────────────────────────────────
  const targetLang =
    profile.userLanguage && profile.userLanguage.trim() !== ''
      ? profile.userLanguage.toUpperCase()
      : 'ENGLISH'
  dict['[[Language]]'] = `[LANGUAGE RULE]\nALL OUTPUT EXCEPT THINKING MUST BE IN ${targetLang} ONLY.`

  if (profile.userPronouns === 'male') {
    dict['[[pronouns]]'] = `{{user}} is male. Always portray and address him as such.`
  } else if (profile.userPronouns === 'female') {
    dict['[[pronouns]]'] = `{{user}} is female. Always portray and address her as such.`
  } else {
    dict['[[pronouns]]'] = ''
  }

  // Length lives in the Story Config block now. The token is still emitted so any
  // preset still carrying it gets it stripped rather than shown to the model.
  dict['[[count]]'] = ''

  dict['[[config]]'] = buildConfigBlock(profile.storyConfig)

  // ── 2. Stage selections ──────────────────────────────────────────────────────
  const pData = (logic.personalities as AnyEngine[]).find((p) => p.id === profile.personality)
  dict['[[main]]'] = pData ? pData.content : ''
  dict['[[AI1]]'] = 'Understood.'
  dict['[[AI2]]'] = 'Understood.'

  if (profile.personality === 'megumin') {
    dict['[[AI1]]'] = 'Fine i read the rules.'
    dict['[[AI2]]'] = 'OK i Understnd it.'
  }

  dict['[[OOC]]'] = profile.toggles.ooc ? logic.toggles.ooc.content : ''
  dict['[[control]]'] = profile.toggles.control ? logic.toggles.control.content : ''

  // The user's own narration instruction. V7.5 wraps it in a narrator persona;
  // other V7 engines wrap it in a style block unless a V7 director style is active.
  dict['[[aiprompt]]'] = ''
  if (profile.mode === 'v7.5') {
    const narratorPersona =
      profile.aiRule ||
      "Adopt the narration of an unseen, witty observer who is vividly present in the scene. The narrator has a distinct personality—dry, occasionally judgmental, quietly amused, or sharply critical. Feel free to throw subtle shade at terrible decisions, point out the absurdity of a situation, or comment on the scene's chaos with a bit of comedic flair."
    dict['[[aiprompt]]'] =
      `<Narration_style>\n narrator_persona: "${narratorPersona}"\n quarantine_rule: "CRITICAL: This opinionated voice applies STRICTLY and EXCLUSIVELY to the narration. It MUST NOT bleed into <NPC_dialogue>. NPCs do not share the narrator's wit or perspective; their dialogue remains entirely bound by their own demographics, stress levels, and individual flaws."\n proportional_prose: "Match narrative intensity to the event. A spilled coffee is just a minor annoyance, not a catalyst for dramatic prose. Zero purple prose. Use grounded metaphors sparingly to anchor a scene, not distract from it."\n</Narration_style>`
  } else if (profile.aiRule) {
    const styleId = (profile as AnyEngine).activeStyleId
    const isV7Director = styleId === 'dir_v7' || styleId === 'dir_v7_core' || styleId === 'dir_v7_gentle'
    if (isV7 && !isV7Director) {
      dict['[[aiprompt]]'] =
        `<narrative_style>\n voice: ${profile.aiRule}\n  pacing: "Unhurried where it should be. A quiet moment can take a paragraph. A violent one can take a sentence. Match the rhythm to the content."\n  length_directive: "Typical outputs should run 3–6 substantial paragraphs, scaling with scene density. Lean toward the higher end during rich, atmospheric, or multi-character scenes. Go shorter — even a single paragraph — only when the moment genuinely demands economy: a held breath, a door closing, a line that hits harder alone. Never pad, never rush."\n</narrative_style>`
    } else {
      dict['[[aiprompt]]'] = profile.aiRule
    }
  }

  for (const aId of profile.addons) {
    const item = (logic.addons as AnyEngine[]).find((a) => a.id === aId)
    if (item) dict[item.trigger] = item.content
  }

  for (const bId of profile.blocks) {
    if (bId === 'summary') continue
    const item = (logic.blocks as AnyEngine[]).find((b) => b.id === bId)
    if (item) dict[item.trigger] = item.content
  }

  // ── CoT framework ────────────────────────────────────────────────────────────
  const modData = (logic.models as AnyEngine[]).find((m) => m.id === profile.model)
  if (profile.cotEnabled !== false && modData) {
    dict['[[COT]]'] = modData.content
    dict['[[prefill]]'] = modData.prefill || ''
  } else {
    dict['[[COT]]'] = ''
    dict['[[prefill]]'] = ''
  }

  dict['[[DNRATIO]]'] = profile.dnRatio?.enabled
    ? `- Ratio: Maintain a balance of ${profile.dnRatio.dialogue}% Dialogue and ${100 - profile.dnRatio.dialogue}% Narration.`
    : ''

  if (profile.onomatopoeia?.enabled) {
    let onoRule = `- Narration must utilize onomatopoeia. Use precise, context-specific phonetic representations for physical interactions (e.g., the click of a latch, the thud of a heavy object, the soughing of wind) rather than abstract descriptions of sound.`
    if (profile.onomatopoeia.useStyling) {
      onoRule += `\nAll onomatopoeic words must animated and colored using HTML and CSS. The selected style tag and color must objectively correspond to the physical nature or movement of the sound produced; for example, a repetitive friction sound such as "shush-shush" must utilize a sliding animation tag to represent the physical action.`
    }
    dict['[[onomato]]'] = onoRule
  } else {
    dict['[[onomato]]'] = ''
  }

  // MVU carries no word count of its own — length is a Story Config field now.
  if (profile.blocks.includes('mvu')) {
    const baseMvu = (logic.blocks as AnyEngine[]).find((b) => b.id === 'mvu')?.content || ''
    dict['[[MVU]]'] = baseMvu.replace('[[count]]', '')
  } else {
    dict['[[MVU]]'] = ''
  }

  // ── 3. Engine overrides — runs last so it can overwrite stage choices ────────
  const isCustom = Boolean(
    activeEngine && !(logic.modes as AnyEngine[]).find((x) => x.id === activeEngine.id),
  )

  if (activeEngine) {
    for (let i = 1; i <= 6; i++) {
      const val = activeEngine[`p${i}`] || ''
      dict[`[[prompt${i}]]`] = val
      dict[`[prompt${i}]`] = val
    }

    // A custom engine kills the personality only if it is truly built from scratch.
    if (isCustom && activeEngine.isCoreClone !== true) dict['[[main]]'] = ''

    if (activeEngine.A1) dict['[[AI1]]'] = activeEngine.A1
    if (activeEngine.A2) dict['[[AI2]]'] = activeEngine.A2

    const overrides: Array<{ key: string; trigger: string; condition: boolean }> = [
      { key: 'cot', trigger: '[[COT]]', condition: true },
      { key: 'prefill', trigger: '[[prefill]]', condition: true },
      { key: 'think', trigger: '[[THINK]]', condition: profile.thinkingV2 },
      { key: 'info', trigger: '[[infoblock]]', condition: profile.blocks.includes('info') },
      { key: 'cyoa', trigger: '[[cyoa]]', condition: profile.blocks.includes('cyoa') },
      { key: 'mvu', trigger: '[[MVU]]', condition: profile.blocks.includes('mvu') },
      { key: 'death', trigger: '[[death]]', condition: profile.addons.includes('death') },
      { key: 'combat', trigger: '[[combat]]', condition: profile.addons.includes('combat') },
      { key: 'direct', trigger: '[[Direct]]', condition: profile.addons.includes('direct') },
      { key: 'dn', trigger: '[[DN]]', condition: profile.addons.includes('dn') },
      { key: 'dialogueColor', trigger: '[[COLOR]]', condition: profile.addons.includes('color') },
      {
        key: 'npc_inner_chatter',
        trigger: '[[npc_inner_chatter]]',
        condition:
          profile.blocks.includes('npc_inner_chatter') ||
          profile.blocks.includes('npc_inner_chatter_v2'),
      },
      { key: 'language', trigger: '[[Language]]', condition: true },
      { key: 'pronouns', trigger: '[[pronouns]]', condition: true },
      { key: 'count', trigger: '[[count]]', condition: true },
      { key: 'dnratio', trigger: '[[DNRATIO]]', condition: Boolean(profile.dnRatio?.enabled) },
      { key: 'onomato', trigger: '[[onomato]]', condition: Boolean(profile.onomatopoeia?.enabled) },
    ]

    for (const o of overrides) {
      if (o.condition && activeEngine[o.key] && String(activeEngine[o.key]).trim() !== '') {
        dict[o.trigger] = activeEngine[o.key]
      }
    }

    // Custom toggles append themselves to whichever engine prompt they name.
    if (Array.isArray(activeEngine.customToggles)) {
      for (const ct of activeEngine.customToggles as AnyEngine[]) {
        if ((profile.toggles as Record<string, boolean>)[ct.id]) {
          const targetKey = '[[prompt' + String(ct.attachPoint).replace('p', '') + ']]'
          if (dict[targetKey] !== undefined) dict[targetKey] += `\n\n${ct.content}`
        }
      }
    }

    // V7 strips optional sections out of its own prompts by toggle.
    if (isV7) {
      const t = profile.toggles as Record<string, boolean>
      if (!t.v7_ooc && dict['[[prompt1]]']) {
        dict['[[prompt1]]'] = dict['[[prompt1]]'].replace(/<ooc_protocol>[\s\S]*?<\/ooc_protocol>/g, '')
      }
      if (dict['[[prompt4]]']) {
        if (!t.v7_pcsolo) {
          dict['[[prompt4]]'] = dict['[[prompt4]]'].replace(/<pc_solo_physicality[\s\S]*?<\/pc_solo_physicality>/g, '')
        }
        if (!t.v7_culture) {
          dict['[[prompt4]]'] = dict['[[prompt4]]'].replace(/<cultural_anchoring>[\s\S]*?<\/cultural_anchoring>/g, '')
        }
        if (!t.v7_scene) {
          dict['[[prompt4]]'] = dict['[[prompt4]]'].replace(/<scene_choreography>[\s\S]*?<\/scene_choreography>/g, '')
        }
        if (!t.v7_intro) {
          dict['[[prompt4]]'] = dict['[[prompt4]]'].replace(/\s*introduction_protocol:\s*"[^"]*"/g, '')
        }
      }
    }

    // V8/V9 carry [[aiprompt]] inside their own prompts, so it is folded in there
    // and then wiped from the dict — otherwise the preset would emit it twice.
    if (isV8 || isV9) {
      const aiPromptVal = dict['[[aiprompt]]'] || ''
      for (let i = 1; i <= 6; i++) {
        const k = `[[prompt${i}]]`
        if (dict[k] && dict[k].includes('[[aiprompt]]')) {
          dict[k] = dict[k].split('[[aiprompt]]').join(aiPromptVal)
        }
      }
      dict['[[aiprompt]]'] = ''
    }
  }

  // The engine prompts carry the persona themselves from V6 on.
  if (profile.mode.includes('v6-dream-team') || isV7 || isV8 || isV9) dict['[[main]]'] = ''

  if (isV8 || isV9) {
    dict['[[OOC]]'] = ''
    dict['[[control]]'] = ''
    dict['[[AI1]]'] = ''
    dict['[[AI2]]'] = ''
  }

  // ── Thinking ─────────────────────────────────────────────────────────────────
  const effort = profile.thinkEffort || 'unspecified'
  if (effort !== 'unspecified' && dict['[[COT]]']) {
    const words = effort === 'custom' ? profile.customThinkEffort || '100' : effort
    dict['[[COT]]'] = `Your Thinking must not be more than ${words} words.\n\n` + dict['[[COT]]']
  }

  if (profile.cotEnabled !== false && dict['[[COT]]']) {
    dict['[[THINK]]'] = profile.thinkingV2
      ? `<think>\n<think>\n<think>\n${dict['[[COT]]']}\n</think>`
      : `<think>\n${dict['[[COT]]']}\n</think>`
    dict['[[COT]]'] = '' // cleared so it is not injected twice
  } else {
    dict['[[THINK]]'] = ''
  }

  if (profile.thinkingV2 && dict['[[prefill]]']) {
    dict['[[prefill]]'] = dict['[[prefill]]'].replace(/\n<think>[\s\S]*/, '\n<think>\n<think>')
  }

  // Tokens owned by subsystems that are not ported yet.
  for (const t of UNPORTED_TOKENS) if (dict[t] === undefined) dict[t] = ''

  // ── Companion tokens ─────────────────────────────────────────────────────────
  dict['[[cyoa2]]'] = dict['[[cyoa]]'] ? '[CYOA block here]' : ''
  dict['[[infoblock2]]'] = dict['[[infoblock]]'] ? '[World state block here]' : ''
  dict['[[storytracker2]]'] = dict['[[storytracker]]'] ? '[Story tracker here]' : ''
  dict['[[npc_inner_chatter2]]'] = dict['[[npc_inner_chatter]]'] ? '[Npc inner chatter here]' : ''

  // Tokens that appear *inside* other token values have to be resolved before the
  // substituter runs, or they reach the model raw.
  const earlyTokens = [
    '[[count]]',
    '[[Language]]',
    '[[pronouns]]',
    '[[DNRATIO]]',
    '[[img2]]',
    '[[v9_lean_min]]',
    '[[v9_lean_max]]',
    '[[v9_full_min]]',
    '[[v9_full_max]]',
  ]
  for (const et of earlyTokens) {
    if (dict[et] === undefined) continue
    const val = dict[et]
    for (const k of Object.keys(dict)) {
      if (k !== et && typeof dict[k] === 'string' && dict[k].includes(et)) {
        dict[k] = dict[k].split(et).join(val)
      }
    }
  }

  // ── Compact World State ──────────────────────────────────────────────────────
  const ws = (profile as AnyEngine).worldState
  if (profile.blocks.includes('info') && dict['[[infoblock]]'] && ws?.compactEnabled) {
    const freq = ws.fullFreq || 5
    const aiMsgCount = opts.aiMessageCount ?? 0
    // Preview always shows the compact form: the full one is the exception, and a
    // preview that flipped shape every fifth message would be unreadable.
    if (opts.preview || (aiMsgCount + 1) % freq !== 0) {
      dict['[[infoblock]]'] =
        `Omit deep lore, unresolved threads, and off-screen tracking. Focus ONLY on immediate physical presence:\n<World_State>\n**Time & Loc:** [Time] at [Location]\n**PC:** [Brief visible clothing] | [Current posture/position]\n**NPCs Present:**\n* [Name]: [Brief visible clothing] | [Posture/position]\n</World_State>`
    }
  }

  // The envelope carries one header above everything. These lines were written back
  // when each block had to introduce itself, and inside the envelope they are noise.
  for (const block of ['[[infoblock]]', '[[npc_inner_chatter]]', '[[cyoa]]', '[[storytracker]]']) {
    if (dict[block] && dict[block].trim() !== '') {
      dict[block] = dict[block].replace(/# at the very end of the response put this block:\s*/gi, '')
    }
  }

  // ── The envelope is the only way blocks reach the model ──────────────────────
  dict['[[blocks]]'] = buildBlocksEnvelope(profile, dict)

  // Per-token dev overrides win over everything the engine computed.
  for (const [key, value] of Object.entries(profile.devOverrides || {})) {
    if (dict[key] !== undefined) dict[key] = value
  }

  // The per-block anchors are blanked unconditionally: leaving them populated
  // would emit each block twice, once loose and once wrapped. A preset with no
  // [[blocks]] anchor emits no blocks at all — the intended, visible failure
  // rather than a silent fallback to a format nothing renders.
  //
  // [[npc_dossier]] is deliberately NOT blanked: it is the dossier *rules*, not
  // the block, and the envelope's slot line refers back to them.
  for (const t of [
    '[[infoblock]]',
    '[[infoblock2]]',
    '[[npc_inner_chatter]]',
    '[[npc_inner_chatter2]]',
    '[[storytracker]]',
    '[[storytracker2]]',
    '[[npc_dossier2]]',
  ]) {
    dict[t] = ''
  }

  return dict
}
