# Megumin Suite for Lumiverse

A port of the Megumin Suite narrative engine from SillyTavern to Lumiverse's
[Spindle](https://docs.lumiverse.chat) extension framework.

**This build ships one slice: engine injection.** The profile you set in the panel is
compiled into a token dictionary and substituted into the prompt before every
generation. The side panel, Memory Core, Story Planner, image generation and NPC
Bank are not ported yet.

## Install

Lumiverse installs from a GitHub repo — Extensions panel, or
`POST /api/v1/spindle/install`. If `dist/` is absent it builds `src/` with
`bun build` during install, so committing `dist/` is optional.

To build locally you need [Bun](https://bun.sh):

```bash
bun install && bun run build
```

Typechecking works without Bun:

```bash
npm install && npx tsc --noEmit
```

## Permissions

| Permission | Why |
|---|---|
| `interceptor` | The whole point — rewriting the prompt before it reaches the model. |
| `generation` | Reserved for the utility generations (summaries, story plans, image prompts) that land in later slices. Nothing in this build calls it. |

Both degrade gracefully. Without `interceptor` the panel still edits the profile and
the extension logs a denial rather than failing a generation.

`interceptorTimeoutMs` is set to 20000. Substitution itself is sub-millisecond; the
headroom is for the retrieval work the Memory Core slice will add.

## How it works

```
spindle.json  ──▶  src/backend.ts   registerInterceptor → buildBaseDict → substituteTokens
                   src/frontend.ts  drawer tab → sendToBackend → profile patch
```

- **`src/engine/`** is pure and host-free. Every function takes the profile as an
  argument, so the same code builds the prompt for a live generation and the panel's
  preview. Nothing here imports `spindle`.
  - `database.ts` — the engine/personality/CoT prompt corpus, copied verbatim from
    the SillyTavern build.
  - `dict.ts` — `buildBaseDict()`, the `[[token]]` → text map.
  - `blocks.ts` — the tracker block registry and the `<Blocks>` envelope.
  - `config-block.ts` / `story-config-fields.ts` — the `<config>` block.
  - `substitute.ts` — running the dict over a message, and sweeping unfilled tokens.
- **`src/backend/profile-store.ts`** — persistence. One store, one rule:
  `chats/{chatId}.json` if it exists, otherwise `profile.json`.
- **`src/frontend/panel.ts`** — the drawer tab. Holds no engine knowledge; every
  edit round-trips through the backend and re-renders from what comes back.

## What changed from the SillyTavern build

| SillyTavern | Here |
|---|---|
| `CHAT_COMPLETION_PROMPT_READY` mutating a shared array in place | `spindle.registerInterceptor` returning a new array |
| `extension_settings` + `chat_metadata`, kept in step by a debounced writer | one store, `resolveProfile()` |
| `useMeguminEngine()` switching presets via the DOM dropdown, plus a 3.5s sleep | `spindle.generate.quiet({ connection_id })` — lands with the first utility slice |
| `activeXRequest` module flags + `messages.length = 0` + `___PS_DUMMY___` | deleted; utility calls pass their own messages directly |
| `localProfile` module global | profile passed as an argument everywhere |

## Unported tokens

Tokens owned by subsystems that haven't landed are **declared empty**, not omitted —
see `UNPORTED_TOKENS` in `dict.ts`. The substituter strips an empty token along with
the line it sits on, so a preset carrying `[[long-Memory]]` or `[[banlist]]` stays
clean until the subsystem that fills it arrives.
