import type { EngineDict } from '../shared/types'

/**
 * Replaces every `[[token]]` in an assembled prompt with what the engine built
 * for it, then sweeps up the ones nothing filled.
 *
 * Ported from the substitution pass in `handlePromptInjection` (index.js:9835-9890).
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Every token the engine knows about. A token left in the prompt because nothing
 * filled it is stripped along with the line it sits on — the model should never
 * see engine syntax.
 */
export const ALL_TOKENS = [
  '[[long-Memory]]', '[[Short-memory]]',
  '[[prompt1]]', '[[prompt2]]', '[[prompt3]]', '[[prompt4]]', '[[prompt5]]', '[[prompt6]]',
  '[prompt1]', '[prompt2]', '[prompt3]', '[prompt4]', '[prompt5]', '[prompt6]',
  '[[AI1]]', '[[AI2]]', '[[main]]', '[[OOC]]', '[[control]]', '[[aiprompt]]',
  '[[death]]', '[[combat]]', '[[Direct]]', '[[DN]]', '[[COLOR]]',
  '[[infoblock]]', '[[cyoa]]', '[[COT]]', '[[prefill]]', '[[order]]',
  '[[Language]]', '[[pronouns]]', '[[banlist]]', '[[count]]', '[[MVU]]',
  '[[img1]]', '[[img2]]', '[[storyplan]]', '[[storytracker]]', '[[blocks]]',
  '[[DNRATIO]]', '[[THINK]]', '[[onomato]]', '[[npc_events]]', '[[config]]',
  '[[cyoa2]]', '[[infoblock2]]', '[[storytracker2]]',
  '[[npc_inner_chatter]]', '[[npc_inner_chatter2]]',
  '[[npc_dossier]]', '[[npc_dossier2]]', '[[npc list]]',
  '[[v9_lean_min]]', '[[v9_lean_max]]', '[[v9_full_min]]', '[[v9_full_max]]',
]

export interface SubstituteResult {
  content: string
  replacements: number
}

/**
 * Runs the dict over one message's text.
 *
 * `resolveMacros` is the host's macro pass ({{user}}, {{char}}, …). The engine's
 * own replacements can contain host macros — `{{user}} is male` is a canned one —
 * so a replacement is macro-resolved on the way in rather than trusting the host
 * to make a second pass over text it has already assembled.
 */
export function substituteTokens(
  content: string,
  dict: EngineDict,
  resolveMacros: (text: string) => string = (t) => t,
): SubstituteResult {
  let out = content
  let replacements = 0

  for (const [token, replacement] of Object.entries(dict)) {
    if (!out.includes(token)) continue
    const processed = resolveMacros(replacement ?? '')

    // An empty replacement takes the line it sits on with it, so the prompt does
    // not fill up with blank gaps where a disabled feature used to be.
    if (processed.trim() === '') {
      out = out.replace(new RegExp(`^[ \\t]*${escapeRegex(token)}[ \\t]*\\r?\\n?`, 'gm'), '')
    }

    out = out.replace(new RegExp(escapeRegex(token), 'g'), processed)
    replacements++
  }

  // Anything the dict did not carry is swept, line and all.
  for (const token of ALL_TOKENS) {
    if (!out.includes(token)) continue
    out = out.replace(new RegExp(`^[ \\t]*${escapeRegex(token)}[ \\t]*\\r?\\n?`, 'gm'), '')
    out = out.replace(new RegExp(escapeRegex(token), 'g'), '')
  }

  // Three or more blank lines collapse to one gap.
  out = out.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n')

  return { content: out, replacements }
}
