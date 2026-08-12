import type { MeguminProfile } from '../shared/types'
import { defaultProfile, withDefaults } from '../engine/defaults'

declare const spindle: any

/**
 * Profile persistence.
 *
 * The SillyTavern build kept profiles in two stores at once — `extension_settings`
 * for globals, `chat_metadata` for the per-chat copy — with a debounced writer
 * keeping them in step and a documented class of bugs where they drifted. Here
 * there is one store and one rule:
 *
 *   chats/{chatId}.json exists  →  this chat has its own profile
 *   it does not                 →  the chat inherits profile.json
 *
 * Resolution is a single read with a fallback, so a chat cannot half-inherit.
 */

const GLOBAL_PATH = 'profile.json'
const chatPath = (chatId: string) => `chats/${sanitize(chatId)}.json`

/** Chat ids come from the host, but they end up in a path, so they get checked. */
function sanitize(chatId: string): string {
  return String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_')
}

export async function readGlobal(): Promise<MeguminProfile> {
  const raw = await spindle.storage.getJson(GLOBAL_PATH, { fallback: null })
  return withDefaults(raw)
}

export async function writeGlobal(profile: MeguminProfile): Promise<void> {
  await spindle.storage.setJson(GLOBAL_PATH, profile, { indent: 2 })
}

export async function hasChatProfile(chatId: string): Promise<boolean> {
  return await spindle.storage.exists(chatPath(chatId))
}

/**
 * The profile that actually governs a generation. `chatId` is null for surfaces
 * that are not inside a chat yet, in which case the global profile is it.
 */
export async function resolveProfile(chatId: string | null): Promise<{
  profile: MeguminProfile
  chatScoped: boolean
}> {
  if (chatId) {
    const raw = await spindle.storage.getJson(chatPath(chatId), { fallback: null })
    if (raw) return { profile: withDefaults(raw), chatScoped: true }
  }
  return { profile: await readGlobal(), chatScoped: false }
}

/**
 * Applies a partial edit. A chat-scoped patch on a chat that was still inheriting
 * forks the global profile first — the user edited *this* chat, so this chat is
 * what changes, and every other chat keeps the profile it had.
 */
export async function patchProfile(
  chatId: string | null,
  patch: Partial<MeguminProfile>,
  scope: 'chat' | 'global',
): Promise<MeguminProfile> {
  if (scope === 'chat' && chatId) {
    const { profile } = await resolveProfile(chatId)
    const next = withDefaults({ ...profile, ...patch })
    await spindle.storage.setJson(chatPath(chatId), next, { indent: 2 })
    return next
  }

  const next = withDefaults({ ...(await readGlobal()), ...patch })
  await writeGlobal(next)
  return next
}

/**
 * Resets a scope. Resetting a chat *deletes* its file rather than writing defaults
 * into it, so the chat goes back to inheriting instead of being pinned to a
 * defaults snapshot that will never track the global profile again.
 */
export async function resetProfile(
  chatId: string | null,
  scope: 'chat' | 'global',
): Promise<MeguminProfile> {
  if (scope === 'chat' && chatId) {
    if (await hasChatProfile(chatId)) await spindle.storage.delete(chatPath(chatId))
    return await readGlobal()
  }

  const fresh = defaultProfile()
  await writeGlobal(fresh)
  return fresh
}
