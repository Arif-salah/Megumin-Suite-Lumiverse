/**
 * The frontend and backend live in different processes and only ever exchange
 * these messages. Keeping the contract in one file means a rename breaks the
 * build rather than the extension.
 */

import type { MeguminProfile } from './types'

export interface EngineOption {
  id: string
  label: string
  color?: string
  recommended?: boolean
  isNew?: boolean
}

/** Everything the panel needs to draw itself, in one round trip. */
export interface PanelState {
  profile: MeguminProfile
  chatId: string | null
  /** true when this chat has its own profile rather than inheriting the global one. */
  chatScoped: boolean
  options: {
    modes: EngineOption[]
    personalities: EngineOption[]
    models: EngineOption[]
    addons: EngineOption[]
    blocks: EngineOption[]
  }
}

export type FrontendToBackend =
  | { type: 'panel:get' }
  | { type: 'profile:patch'; patch: Partial<MeguminProfile>; scope: 'chat' | 'global' }
  | { type: 'profile:reset'; scope: 'chat' | 'global' }
  | { type: 'preview:get' }

export type BackendToFrontend =
  | { type: 'panel:state'; state: PanelState }
  | { type: 'preview:result'; dict: Record<string, string> }
  | { type: 'error'; message: string }
