/**
 * The profile is the whole configurable state of the engine for one chat.
 *
 * In the SillyTavern build this lived in two places at once — `extension_settings`
 * for the globals and `chat_metadata` for the per-chat copy — and the code spent a
 * lot of effort keeping them in step. Here it is one object with one owner: the
 * backend, which reads a global default from storage and layers a chat override
 * on top (see backend/profile-store.ts).
 */

export type PronounSetting = '' | 'male' | 'female'

export interface V9Limits {
  leanMin: number
  leanMax: number
  fullMin: number
  fullMax: number
}

export interface StoryConfig {
  enabled: boolean
  genre: string
  culture: string
  era: string
  pov: string
  focus: string
  tone: string
  narratorPresence: string
  npcSpeechStyle: string
  npcDisposition: string
  pace: string
  length: string
  difficulty: string
  friction: string
  explicitness: string
  notes: string
  /** Fields are addressed by key at runtime, so allow the ones not spelled out above. */
  [key: string]: string | boolean
}

export interface StatField {
  id: string
  label: string
  type: 'text' | 'meter' | 'number' | 'list'
  hint?: string
  max?: number
  start?: number
  /** Sheet fields only: render on their own line instead of the inline run. */
  ownLine?: boolean
}

export interface CustomBlock {
  id: string
  name: string
  tag: string
  content: string
}

/** Membership *and* order: a block not listed in `order` is never emitted. */
export interface BlockStack {
  order: string[]
  custom: CustomBlock[]
  overrides: Record<string, string>
}

export interface MeguminProfile {
  /** Engine id from hardcodedLogic.modes — decides the V7/V8/V9 prompt family. */
  mode: string
  /** Personality id from hardcodedLogic.personalities. */
  personality: string
  /** The user's own narration/style instruction, injected as [[aiprompt]]. */
  aiRule: string
  /** CoT framework id from hardcodedLogic.models. */
  model: string
  cotEnabled: boolean
  /** Nests the opening <think> so models that swallow the first one still think. */
  thinkingV2: boolean
  /** "unspecified" | a word budget | "custom" (then customThinkEffort holds it). */
  thinkEffort: string
  customThinkEffort: string

  userLanguage: string
  userPronouns: PronounSetting

  toggles: { ooc: boolean; control: boolean }
  addons: string[]
  blocks: string[]
  blockStack: BlockStack
  statBlocks: Record<string, { fields: StatField[] }>

  v9Limits: V9Limits
  storyConfig: StoryConfig
  dnRatio: { enabled: boolean; dialogue: number }
  onomatopoeia: { enabled: boolean; useStyling: boolean }

  /**
   * Raw per-token overrides, keyed by the full `[[token]]` string. Whatever the
   * engine computed for that token is thrown away in favour of this text.
   */
  devOverrides: Record<string, string>
}

/** The `[[token]]` → replacement map handed to the substituter. */
export type EngineDict = Record<string, string>
