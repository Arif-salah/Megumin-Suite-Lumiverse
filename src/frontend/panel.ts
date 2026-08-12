import type { BackendToFrontend, EngineOption, FrontendToBackend, PanelState } from '../shared/protocol'
import type { MeguminProfile } from '../shared/types'

/**
 * The engine panel: a drawer tab that edits the profile the interceptor reads.
 *
 * It is deliberately thin. It holds no engine knowledge and no defaults — the
 * option lists arrive from the backend, and every edit is a patch sent back and
 * re-rendered from the state the backend returns. That means the panel can never
 * show a profile the engine isn't using, which was the single largest source of
 * "the setting didn't apply" reports in the SillyTavern build.
 */

type Ctx = any

const PANEL_CSS = `
.mg-panel { padding: 16px; color: var(--lumiverse-text); font-size: 13px; }
.mg-panel h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.mg-scope { display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
  padding: 8px 10px; border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius); background: var(--lumiverse-fill-subtle); }
.mg-scope-label { font-size: 12px; color: var(--lumiverse-text-muted); flex: 1; }
.mg-section { margin-bottom: 18px; padding-bottom: 18px;
  border-bottom: 1px solid var(--lumiverse-border); }
.mg-section:last-child { border-bottom: none; }
.mg-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.mg-row > label { flex: 0 0 120px; color: var(--lumiverse-text-muted); font-size: 12px; }
.mg-row > select, .mg-row > input[type="text"] { flex: 1; min-width: 0;
  padding: 5px 8px; border-radius: var(--lumiverse-radius);
  border: 1px solid var(--lumiverse-border); background: var(--lumiverse-fill);
  color: var(--lumiverse-text); font-size: 12px; }
.mg-hint { color: var(--lumiverse-text-dim); font-size: 11px; margin: 0 0 10px; line-height: 1.5; }
.mg-checks { display: flex; flex-wrap: wrap; gap: 6px; }
.mg-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
  border: 1px solid var(--lumiverse-border); border-radius: 999px;
  background: var(--lumiverse-fill); cursor: pointer; font-size: 12px;
  transition: var(--lumiverse-transition-fast); user-select: none; }
.mg-chip:hover { border-color: var(--lumiverse-border-hover); }
.mg-chip[data-on="true"] { background: var(--lumiverse-accent);
  color: var(--lumiverse-accent-fg); border-color: var(--lumiverse-accent); }
.mg-actions { display: flex; gap: 8px; }
.mg-btn { padding: 6px 12px; border-radius: var(--lumiverse-radius);
  border: 1px solid var(--lumiverse-border); background: var(--lumiverse-fill);
  color: var(--lumiverse-text); cursor: pointer; font-size: 12px; }
.mg-btn:hover { border-color: var(--lumiverse-border-hover); }
.mg-preview { margin-top: 10px; max-height: 320px; overflow: auto;
  background: var(--lumiverse-fill-subtle); border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius); padding: 10px;
  font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap;
  word-break: break-word; }
.mg-preview b { color: var(--lumiverse-accent); }
`

export function mountPanel(ctx: Ctx) {
  ctx.dom.addStyle(PANEL_CSS)

  const tab = ctx.ui.registerDrawerTab({
    id: 'engine',
    title: 'Megumin Engine',
    shortName: 'Engine',
    description: 'Narrative engine, personality, thinking and tracker blocks',
    keywords: ['megumin', 'engine', 'prompt', 'narrative', 'roleplay', 'cot'],
    headerTitle: 'Engine',
  })

  const root = document.createElement('div')
  root.className = 'mg-panel'
  root.textContent = 'Loading…'
  tab.root.appendChild(root)

  let state: PanelState | null = null

  const send = (msg: FrontendToBackend) => ctx.sendToBackend(msg)
  const patch = (p: Partial<MeguminProfile>) =>
    send({ type: 'profile:patch', patch: p, scope: state?.chatId ? 'chat' : 'global' })

  const unsub = ctx.onBackendMessage((payload: BackendToFrontend) => {
    if (payload?.type === 'panel:state') {
      state = payload.state
      render()
    } else if (payload?.type === 'preview:result') {
      renderPreview(payload.dict)
    } else if (payload?.type === 'error') {
      ctx.toast?.error?.(`Megumin: ${payload.message}`)
    }
  })

  // The panel can be opened before the backend has anything to say, and the chat
  // can change while it is open — both are just "ask again".
  tab.onActivate(() => send({ type: 'panel:get' }))
  const unsubChat = ctx.events.on('CHAT_SWITCHED', () => send({ type: 'panel:get' }))
  send({ type: 'panel:get' })

  // ── rendering ──────────────────────────────────────────────────────────────

  function el(tag: string, cls?: string, text?: string): HTMLElement {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }

  function selectRow(
    label: string,
    options: EngineOption[],
    value: string,
    onChange: (v: string) => void,
  ): HTMLElement {
    const row = el('div', 'mg-row')
    row.appendChild(el('label', undefined, label))
    const sel = document.createElement('select')
    for (const o of options) {
      const opt = document.createElement('option')
      opt.value = o.id
      opt.textContent = o.label + (o.recommended ? ' ★' : '')
      sel.appendChild(opt)
    }
    sel.value = value
    sel.addEventListener('change', () => onChange(sel.value))
    row.appendChild(sel)
    return row
  }

  function textRow(
    label: string,
    value: string,
    placeholder: string,
    onCommit: (v: string) => void,
  ): HTMLElement {
    const row = el('div', 'mg-row')
    row.appendChild(el('label', undefined, label))
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.placeholder = placeholder
    // Commit on blur rather than on input: every patch is a disk write and a
    // full re-render, and re-rendering under the cursor would steal focus.
    input.addEventListener('blur', () => {
      if (input.value !== value) onCommit(input.value)
    })
    row.appendChild(input)
    return row
  }

  function chips(
    options: EngineOption[],
    selected: string[],
    onToggle: (id: string, on: boolean) => void,
  ): HTMLElement {
    const wrap = el('div', 'mg-checks')
    for (const o of options) {
      const on = selected.includes(o.id)
      const chip = el('span', 'mg-chip', o.label)
      chip.dataset.on = String(on)
      chip.addEventListener('click', () => onToggle(o.id, !on))
      wrap.appendChild(chip)
    }
    return wrap
  }

  function section(title: string, hint?: string): HTMLElement {
    const s = el('div', 'mg-section')
    s.appendChild(el('h3', undefined, title))
    if (hint) s.appendChild(el('p', 'mg-hint', hint))
    return s
  }

  function render() {
    if (!state) return
    const p = state.profile
    root.textContent = ''

    // Scope banner — which profile the edits below are actually landing in.
    const scope = el('div', 'mg-scope')
    scope.appendChild(
      el(
        'span',
        'mg-scope-label',
        state.chatId
          ? state.chatScoped
            ? 'Editing this chat’s own settings.'
            : 'This chat inherits your global settings. Editing forks it.'
          : 'No chat open — editing your global settings.',
      ),
    )
    if (state.chatId && state.chatScoped) {
      const reset = el('button', 'mg-btn', 'Inherit global')
      reset.addEventListener('click', () => send({ type: 'profile:reset', scope: 'chat' }))
      scope.appendChild(reset)
    }
    root.appendChild(scope)

    // Engine
    const engine = section('Engine', 'The prompt family the whole story runs on.')
    engine.appendChild(selectRow('Engine', state.options.modes, p.mode, (v) => patch({ mode: v })))
    engine.appendChild(
      selectRow('Personality', state.options.personalities, p.personality, (v) =>
        patch({ personality: v }),
      ),
    )
    engine.appendChild(
      textRow('Narration style', p.aiRule, 'e.g. dry, observant, never sentimental', (v) =>
        patch({ aiRule: v }),
      ),
    )
    root.appendChild(engine)

    // Thinking
    const thinking = section('Thinking', 'The chain-of-thought framework wrapped around the reply.')
    thinking.appendChild(
      selectRow('Framework', state.options.models, p.model, (v) => patch({ model: v })),
    )
    thinking.appendChild(
      chips(
        [
          { id: 'cotEnabled', label: 'Thinking on' },
          { id: 'thinkingV2', label: 'Nested <think>' },
        ],
        [p.cotEnabled ? 'cotEnabled' : '', p.thinkingV2 ? 'thinkingV2' : ''].filter(Boolean),
        (id, on) => patch({ [id]: on } as Partial<MeguminProfile>),
      ),
    )
    root.appendChild(thinking)

    // Output
    const output = section('Output', 'Language and pronouns are stated to the model outright.')
    output.appendChild(
      textRow('Language', p.userLanguage, 'blank = English', (v) => patch({ userLanguage: v })),
    )
    output.appendChild(
      selectRow(
        'Pronouns',
        [
          { id: '', label: 'Unstated' },
          { id: 'male', label: 'He / him' },
          { id: 'female', label: 'She / her' },
        ],
        p.userPronouns,
        (v) => patch({ userPronouns: v as MeguminProfile['userPronouns'] }),
      ),
    )
    root.appendChild(output)

    // Add-ons and blocks
    const extras = section(
      'Add-ons',
      'Extra rule sets appended to the engine prompt.',
    )
    extras.appendChild(
      chips(state.options.addons, p.addons, (id, on) =>
        patch({ addons: on ? [...p.addons, id] : p.addons.filter((a) => a !== id) }),
      ),
    )
    root.appendChild(extras)

    const blocks = section(
      'Blocks',
      'What the model is asked to emit at the end of a reply, inside one <Blocks> section.',
    )
    blocks.appendChild(
      chips(state.options.blocks, p.blocks, (id, on) =>
        patch({ blocks: on ? [...p.blocks, id] : p.blocks.filter((b) => b !== id) }),
      ),
    )
    root.appendChild(blocks)

    // Preview
    const preview = section(
      'Assembled prompt',
      'Exactly what the interceptor will substitute into the preset on the next generation.',
    )
    const actions = el('div', 'mg-actions')
    const previewBtn = el('button', 'mg-btn', 'Build preview')
    previewBtn.addEventListener('click', () => send({ type: 'preview:get' }))
    actions.appendChild(previewBtn)
    preview.appendChild(actions)
    const out = el('div', 'mg-preview')
    out.id = 'mg-preview-out'
    out.style.display = 'none'
    preview.appendChild(out)
    root.appendChild(preview)
  }

  function renderPreview(dict: Record<string, string>) {
    const out = root.querySelector('#mg-preview-out') as HTMLElement | null
    if (!out) return
    out.textContent = ''
    out.style.display = 'block'

    const filled = Object.entries(dict).filter(([, v]) => v && v.trim() !== '')
    if (!filled.length) {
      out.textContent = 'Every token resolved empty — nothing would be injected.'
      return
    }
    for (const [token, value] of filled) {
      const head = document.createElement('b')
      head.textContent = `${token}\n`
      out.appendChild(head)
      out.appendChild(document.createTextNode(`${value}\n\n`))
    }
  }

  return () => {
    unsub()
    unsubChat()
    tab.destroy()
  }
}
