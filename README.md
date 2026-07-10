# ✦ AnimaChat

An AI-driven virtual character chat webapp with a visual-novel soul. Single-user, runs locally, provider-agnostic.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or the port Next picks), then:

1. **Settings** → add a provider (Anthropic or any OpenAI-compatible endpoint), add a model under it (with its context window size), and set it as the **global default model**.
2. **Library** → a starter cast is seeded on first run (Mira, Kael, the Moonlit Tavern, a two-scene story and a lorebook). Create your own — every editor has an **AI co-writer panel** that fills the form as you chat with it.
3. **Chats** → **+ New chat**, pick characters (several = group chat), a persona, optionally a story/scene/location and the narrator, and go.

All data lives in `./data` (SQLite + uploaded assets). `Settings → Backup` exports/restores the whole thing as one zip.

## Feature map

| Area | What you get |
|---|---|
| **AI providers** | Providers → models hierarchy; per-model custom request body (JSON deep-merge, e.g. `{"thinking":{"type":"disabled"}}`); per-task model map (chat / narrator / orchestrator / memory / assist / impersonate / title) with resolution: per-character → per-chat → per-task → global default |
| **Entities** | Characters (sprites, custom expressions, image prompt), personas, locations & scenes (16:9 art, BGM, ambient loop, image prompt), stories (ordered scenes), lorebooks (keyword-triggered) — all reusable, all import/exportable as zip bundles with assets |
| **VN stage** | 2:3 expression sprites chosen by an AI emotion tag per message (decoupled from availability: the true emotion is stored, sprites resolve at render time with neutral → placeholder fallback), speaker dimming, breathing idle, background art & crossfading BGM with location-over-scene precedence, typewriter blips (per-character override), fullscreen VN mode (space/enter to advance) |
| **Chat** | Streaming with inline tag parsing, in-place edits (no branching), regenerate-as-swipes, group chats with LLM turn orchestration + force-speaker, impersonate, per-chat language & POV (user-1st / all-3rd / VN-2nd) |
| **Narrator** | Optional per chat; auto or summoned; 2–4 suggested actions as buttons; advances story scenes via `<next-scene/>` — scene state is event-sourced from the timeline, so rewinds restore scene, art and BGM |
| **Memory** | Rolling summarization (background, chunked, tunable budget/share/threshold in Settings → Advanced), per-character extracted facts, persona↔character affinity tracking with a relationship card |
| **Organization** | Save states (rewind or fork), folders & tags, full-text search, auto titles, novel export (Markdown / EPUB), token usage dashboard by feature/model |

## Structured tags (AI output)

Chat prose carries three inline tags, parsed out of the stream and stored as message metadata: `<emo>name</emo>` (character emotion), `<options><o>…</o></options>` (narrator suggestions), `<next-scene/>` (story advance). Everything fails soft — a malformed tag renders as plain text and the chat keeps going.

## Development

- `SPEC.md` — the full product spec this app implements.
- `src/lib/` — db, store (all SQL), `ai/` (provider clients, tag parser, prompt builder, memory), bundle (import/export).
- `src/app/api/` — REST + SSE routes. `src/app/` + `src/components/` — UI.
- `npm run build` — production build; `npm run typecheck` — typecheck; `npm test` — vitest unit tests (tag parser, placeholders, JSON extraction).

No cloud, no telemetry, no accounts. Your keys stay in your local SQLite.
