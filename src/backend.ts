/**
 * Megumin Suite — backend entry point.
 *
 * One job in this build: assemble the engine dict from the active profile and run
 * it over the prompt before it reaches the model.
 *
 * How this differs from the SillyTavern build it was ported from:
 *
 *   - ST fired on CHAT_COMPLETION_PROMPT_READY and mutated a shared array in
 *     place. Here the host hands us the assembled messages and takes back what we
 *     return, so nothing else can observe a half-substituted prompt.
 *   - ST routed utility generations by setting a module-level `activeXRequest`
 *     flag, emptying the prompt, and swapping the preset dropdown in the DOM.
 *     None of that survives the port: utility work becomes a direct
 *     `spindle.generate.quiet({ connection_id })` call in the slice that needs it.
 *   - A thrown error or a timeout here is a no-op, not a broken generation — the
 *     host passes the pre-interceptor messages straight through.
 */

declare const spindle: any

import type { FrontendToBackend, PanelState } from './shared/protocol'
import { buildBaseDict } from './engine/dict'
import { substituteTokens } from './engine/substitute'
import { hardcodedLogic } from './engine/database'
import { resolveProfile, patchProfile, resetProfile, hasChatProfile } from './backend/profile-store'

/**
 * The chat the user is currently looking at. Tracked from CHAT_SWITCHED (free
 * tier) so the panel can address the right profile without the `chats`
 * permission. The interceptor never reads this — it uses the chatId on its own
 * context, which is authoritative for the generation actually running.
 */
let activeChatId: string | null = null

spindle.on('CHAT_SWITCHED', (payload: { chatId: string | null }) => {
  activeChatId = payload?.chatId ?? null
})

// ── Interceptor ───────────────────────────────────────────────────────────────

let interceptorRegistered = false

function registerInterceptor() {
  if (interceptorRegistered) return
  if (!spindle.permissions.has('interceptor')) return

  spindle.registerInterceptor(async (messages: any[], context: any) => {
    const chatId: string | null = context?.chatId ?? null
    const { profile } = await resolveProfile(chatId)

    const dict = buildBaseDict(profile, {
      aiMessageCount: countAssistantTurns(messages),
    })

    let total = 0
    const out = messages.map((msg) => {
      if (typeof msg.content !== 'string') return msg
      const { content, replacements } = substituteTokens(msg.content, dict)
      total += replacements
      // A new object rather than a mutation: the input array is the host's.
      return replacements > 0 || content !== msg.content ? { ...msg, content } : msg
    })

    if (total > 0) {
      spindle.log.info(`[Megumin] ${total} token replacements in chat ${chatId ?? '(none)'}`)
    }
    return out
  }, 50)

  interceptorRegistered = true
}

/**
 * How many assistant turns are already in the prompt. Drives the compact World
 * State cadence, which alternates a full block in every Nth reply.
 */
function countAssistantTurns(messages: any[]): number {
  return messages.filter((m) => m?.role === 'assistant' && m?.__isChatHistory).length
}

registerInterceptor()

spindle.permissions.onChanged(({ permission, granted }: { permission: string; granted: boolean }) => {
  if (permission === 'interceptor' && granted) registerInterceptor()
})

spindle.permissions.onDenied?.(({ permission, operation }: { permission: string; operation: string }) => {
  spindle.log.warn(`[Megumin] permission "${permission}" denied for ${operation}`)
})

// ── Panel ─────────────────────────────────────────────────────────────────────

const logic = hardcodedLogic as Record<string, any>

function optionsFrom(list: any[] | undefined) {
  return (list || []).map((m) => ({
    id: m.id,
    label: m.label || m.name || m.id,
    color: m.color,
    recommended: m.recommended,
    isNew: m.isNew,
  }))
}

async function buildPanelState(): Promise<PanelState> {
  const { profile } = await resolveProfile(activeChatId)
  return {
    profile,
    chatId: activeChatId,
    chatScoped: activeChatId ? await hasChatProfile(activeChatId) : false,
    options: {
      modes: optionsFrom(logic.modes),
      personalities: optionsFrom(logic.personalities),
      models: optionsFrom(logic.models),
      addons: optionsFrom(logic.addons),
      blocks: optionsFrom(logic.blocks),
    },
  }
}

spindle.onFrontendMessage(async (payload: FrontendToBackend, userId?: string) => {
  try {
    switch (payload?.type) {
      case 'panel:get':
        spindle.sendToFrontend({ type: 'panel:state', state: await buildPanelState() }, userId)
        break

      case 'profile:patch':
        await patchProfile(activeChatId, payload.patch, payload.scope)
        spindle.sendToFrontend({ type: 'panel:state', state: await buildPanelState() }, userId)
        break

      case 'profile:reset':
        await resetProfile(activeChatId, payload.scope)
        spindle.sendToFrontend({ type: 'panel:state', state: await buildPanelState() }, userId)
        break

      case 'preview:get': {
        const { profile } = await resolveProfile(activeChatId)
        // preview: true keeps the output deterministic — no chat-position branches.
        const dict = buildBaseDict(profile, { preview: true })
        spindle.sendToFrontend({ type: 'preview:result', dict }, userId)
        break
      }
    }
  } catch (err: any) {
    spindle.log.error(`[Megumin] ${payload?.type} failed: ${err?.message ?? err}`)
    spindle.sendToFrontend({ type: 'error', message: String(err?.message ?? err) }, userId)
  }
})

spindle.log.info('[Megumin] backend ready')
