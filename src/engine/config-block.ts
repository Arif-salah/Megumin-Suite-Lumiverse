import type { StoryConfig } from '../shared/types'
import { CONFIG_PREAMBLE, storyConfigFields } from './story-config-fields'

/**
 * A field whose value is its own named default (friction "normal", npc_disposition
 * "ordinary", narrator_presence "light") is the same as leaving it on Default: the
 * line is dropped. This folds those values back to "" so the UI shows Default
 * rather than Custom…
 */
export function normalizeStoryConfig(cfg: StoryConfig): StoryConfig {
  if (!cfg) return cfg
  for (const f of storyConfigFields) {
    if (!f.defaultAliases) continue
    const v = String(cfg[f.key] || '').trim().toLowerCase()
    if (v && f.defaultAliases.some((a) => a.toLowerCase() === v)) cfg[f.key] = ''
  }
  return cfg
}

export function countActiveConfigFields(cfg: StoryConfig): number {
  if (!cfg) return 0
  return storyConfigFields.filter((f) => cfg[f.key] && String(cfg[f.key]).trim() !== '').length
}

/**
 * Compiles the profile's storyConfig into the <config> block that replaces
 * [[config]]. Returns "" when the config is off or every field is empty, so the
 * token is stripped cleanly.
 */
export function buildConfigBlock(cfg: StoryConfig): string {
  if (!cfg || !cfg.enabled) return ''

  normalizeStoryConfig(cfg)
  const lines: string[] = []
  for (const f of storyConfigFields) {
    const raw = cfg[f.key]
    if (!raw || String(raw).trim() === '') continue
    // The asterisked note tells the model what the field governs. pov carries none —
    // the value already says everything it needs to.
    const note = f.aiNote ? ` *${f.aiNote}*` : ''
    lines.push(`- ${f.tag}: ${String(raw).trim()}${note}`)
  }

  if (lines.length === 0) return ''
  return `<config>\n${CONFIG_PREAMBLE}\n\n${lines.join('\n')}\n</config>`
}
