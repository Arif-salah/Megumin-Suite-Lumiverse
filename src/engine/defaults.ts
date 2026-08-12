import type { MeguminProfile } from '../shared/types'

/**
 * The profile a chat starts with. Mirrors `initProfile()`'s defaults from the
 * SillyTavern build, minus the subsystems that are not ported yet.
 */
export function defaultProfile(): MeguminProfile {
  return {
    mode: 'v9-core',
    personality: 'engine',
    aiRule: '',
    // Paired with the default v9-core engine. An id with no match in
    // hardcodedLogic.models silently disables thinking, so this is not a free
    // placeholder — it has to name a real framework.
    model: 'cot-v9-english',
    cotEnabled: true,
    thinkingV2: false,
    thinkEffort: 'unspecified',
    customThinkEffort: '100',

    userLanguage: '',
    userPronouns: '',

    toggles: { ooc: false, control: false },
    addons: [],
    blocks: [],
    blockStack: { order: [], custom: [], overrides: {} },
    statBlocks: {
      bonds: {
        fields: [
          { id: 'mood', label: 'Mood', type: 'text', hint: 'emotional surface' },
          { id: 'affection', label: 'Affection', type: 'meter', max: 100, start: 20 },
          { id: 'trust', label: 'Trust', type: 'meter', max: 100, start: 30 },
          { id: 'desire', label: 'Desire', type: 'meter', max: 100, start: 0 },
        ],
      },
      sheet: { fields: [] },
    },

    v9Limits: { leanMin: 300, leanMax: 400, fullMin: 700, fullMax: 1200 },
    storyConfig: {
      enabled: false,
      genre: '',
      culture: '',
      era: '',
      pov: '',
      focus: '',
      tone: '',
      narratorPresence: '',
      npcSpeechStyle: '',
      npcDisposition: '',
      pace: '',
      length: '',
      difficulty: '',
      friction: '',
      explicitness: '',
      notes: '',
    },
    dnRatio: { enabled: false, dialogue: 50 },
    onomatopoeia: { enabled: false, useStyling: false },

    devOverrides: {},
  }
}

/**
 * Fills in anything a stored profile is missing. Profiles are persisted as plain
 * JSON and survive across versions, so every read goes through this rather than
 * trusting the shape on disk.
 */
export function withDefaults(stored: unknown): MeguminProfile {
  const base = defaultProfile()
  if (!stored || typeof stored !== 'object') return base
  const p = stored as Partial<MeguminProfile>

  return {
    ...base,
    ...p,
    toggles: { ...base.toggles, ...(p.toggles ?? {}) },
    blockStack: { ...base.blockStack, ...(p.blockStack ?? {}) },
    statBlocks: { ...base.statBlocks, ...(p.statBlocks ?? {}) },
    v9Limits: { ...base.v9Limits, ...(p.v9Limits ?? {}) },
    storyConfig: { ...base.storyConfig, ...(p.storyConfig ?? {}) },
    dnRatio: { ...base.dnRatio, ...(p.dnRatio ?? {}) },
    onomatopoeia: { ...base.onomatopoeia, ...(p.onomatopoeia ?? {}) },
    devOverrides: { ...base.devOverrides, ...(p.devOverrides ?? {}) },
    addons: Array.isArray(p.addons) ? p.addons : base.addons,
    blocks: Array.isArray(p.blocks) ? p.blocks : base.blocks,
  }
}
