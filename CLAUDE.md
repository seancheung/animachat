@AGENTS.md

# AnimaChat

AI-driven virtual character chat webapp with a visual-novel presentation. Single-user, local, no auth. **`SPEC.md` is the product source of truth** — keep it updated when behavior changes by agreement with the user.

## Commands

- `npm run dev` — dev server (port 3000 is often taken by another app; Next falls back to 3001)
- `npm run build` / `npm run typecheck` / `npm test` (vitest; tests live next to sources as `src/**/*.test.ts`)
- Data lives in `./data` (SQLite + content-addressed assets), gitignored. `ANIMACHAT_DATA_DIR` env relocates the whole data dir (db + uploaded assets) — use it plus `PORT=… npm start` to run an isolated instance for API testing without touching the user's running dev server or data. (`ANIMACHAT_DB_PATH` overrides only the db file and leaves assets shared — insufficient for tests that upload or delete files.)
- For end-to-end tests without an API key: run a mock OpenAI-compatible server and register it as a provider with baseUrl `http://localhost:<port>/v1` (pattern: respond to `/chat/completions`, keyed off the system prompt).

## Architecture

- `src/lib/db.ts` — schema (no migration system: on schema changes, delete `./data` and let it recreate — the user has agreed local data is disposable)
- `src/lib/store.ts` — ALL SQL + row↔object marshalling (camelCase objects, snake_case columns, JSON-string columns)
- `src/lib/types.ts` — shared types, `EMOTIONS`, `AI_TASKS`, defaults
- `src/lib/ai/` — `client.ts` (raw-fetch Anthropic + OpenAI-compatible clients, SSE, per-task model resolution, usage logging), `tags.ts` (streaming tag parser), `prompts.ts` (context assembly), `memory.ts` (rolling summarization), `placeholders.ts` (`[char_name]`-style substitution)
- `src/app/api/` — REST + SSE routes; entity CRUD via `src/lib/entityRoutes.ts` factory
- `src/components/` — UI; chat page at `src/app/chat/[id]/page.tsx`
- `src/components/ui/` — vendored [retuned-ui](../retuned-ui) components (shadcn-style: we own the code; `"use client"` added for Next). Theme tokens in `src/app/theme.css` (dark-first amber; `base-*` surfaces, `content-*` text ladder, `primary-*` accent). App-level primitives (Modal/Field/Row/EmptyState) in `src/components/app.tsx`; `confirmDialog()` (promise-based window.confirm replacement, outlet in layout) in `src/components/confirm.tsx`; class merging via `cn` from `src/utils/cn.ts`.
- `src/lib/seed.ts` — starter cast, runs once via `src/instrumentation.ts` when the library is empty

## Core invariants (violating these breaks features)

- **Stage state is event-sourced**: never store current scene, on-stage presence, or the ended flag as mutable fields. All derive from stage events on narrator messages, folded over the timeline (`computeStage`), so forks restore them. There is no manual scene switching — the narrator alone directs, via tags.
- **Structured tags in AI chat output**: `<emo>name</emo>` (prefix); `<options><o>…</o></options>`, `<next-scene/>`, `<the-end/>` (trailing); `<enter>Name</enter>`/`<leave>Name</leave>` (inline, narrator staging). Parsed out of the stream by `TagStreamParser`, stored as message metadata, always fail-soft. New tags: add to the parser, the SPEC table, and the prompt instructions.
- **Playthroughs (story-mode chats) are self-contained**: creation snapshots the whole story bundle into `chat.storySnapshot`; they never read the library afterwards. Prompt/stage code must resolve characters/scenes/locations/lorebooks through the snapshot (`chatScene`/`chatLocation`, `buildContext`), and the asset prune must count snapshot refs.
- **Library integrity**: deleting a location ← scene, or character/scene/location/lorebook ← story, is blocked server-side (409 naming the referencers, via `libraryReferences`). Stories delete freely; casual/immersive chat refs are fail-soft (name fallback from `chat.nameSnapshots`).
- **Emotion tagging is decoupled from sprite availability**: models always tag from the full vocabulary; sprite resolution (tag → neutral → placeholder) happens at render time only.
- **Only the newest message holds variants (swipes)**: regeneration is latest-message-only; `appendMessage` freezes the previous tail to its active variant, so never bypass it. Edits modify the active variant in place. Edits that touch summarized ranges must call `invalidateSummary`. Going back in time is a **fork at a message** (new chat copying the timeline up to it) — never destructive truncation.
- **Chat modes** (`casual`/`immersive`/`story`) are fixed at creation and enforced server-side. Everything except the model (and title/folder/tags/overrides) is frozen at creation; the narrator is forced on in story mode and, when enabled, always speaks first (client fires the opening narrator turn).
- **Presence gates speaking**: in playthroughs the orchestrator, @mentions, force-speaker, and the VN stage all operate on `ctx.present` (on-stage cast), never the full roster.
- **Character order in a chat is fixed at creation** — it drives `[charN_name]` placeholder resolution (story mode: cast order minus the played character).
- **Model resolution order**: per-character (group chats) → per-chat → per-task (`taskModels`) → global default.
- **Asset & location/scene precedence**: location assets win over scene assets when present, falling back per-asset.

## Gotchas

- `better-sqlite3` must stay in `serverExternalPackages` (next.config.ts).
- Don't render toggle buttons inside a `<label>` — label click re-dispatch double-fires them. `Field` in `components/app.tsx` is deliberately a `<div>`.
- The vendored ui components compose classes with plain `cva` (no tailwind-merge), so a width/size override passed via `className` may lose to the component's own class — wrap in a sized container instead (see the volume `Slider` in the chat toolbar).
- The user runs their own dev server on this repo — don't kill processes on port 3000, and don't run a second `next dev` (Next refuses); use `npm start` on another port with `ANIMACHAT_DB_PATH` instead.
- The DB connection is cached in `globalThis` — schema changes take effect after the user restarts their dev server (with `./data` deleted).
