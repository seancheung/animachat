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

## Suggested models per task

Two tiers cover everything: a **creative** model for the prose you'll actually read, and a cheap **utility** model for the background plumbing. Set the creative model as the global default, then map the utility tasks in `Settings → Models per task`.

| Task | Tier | Why |
|---|---|---|
| Chat generation | Creative | The star — character voice and prose quality live here |
| Narrator | Creative | Same class as chat; sharing the chat model works well |
| Co-writing assistant | Creative | Or drop to utility to save cost |
| Summarization & memory | Utility | Reliable JSON extraction matters more than prose |
| Group-chat orchestration | Utility | Tiny JSON decisions, called before every auto turn — keep it fast & cheap |
| Impersonate | Utility | Drafts 1–3 sentences in your voice |
| Title generation | Utility | Six words |

Picks per provider (as of July 2026 — lineups move fast, check your provider's docs; context window in parentheses, enter it when adding the model):

| Tier | Anthropic | OpenAI | Google | DeepSeek | xAI (Grok) |
|---|---|---|---|---|---|
| **Creative** | Claude Sonnet 5 — `claude-sonnet-5` (1M) | GPT-5.6 Terra — `gpt-5.6-terra` (1M) | Gemini 3.1 Pro — `gemini-3.1-pro-preview` (1M) | DeepSeek V4 Pro — `deepseek-v4-pro` (1M) | Grok 4.5 — `grok-4.5` (500K) |
| **Utility** | Claude Haiku 4.5 — `claude-haiku-4-5` (200K) | GPT-5.6 Luna — `gpt-5.6-luna` (1M) | Gemini 3.5 Flash — `gemini-3.5-flash` (1M) | DeepSeek V4 Flash — `deepseek-v4-flash` (1M) | Grok 4.3 — `grok-4.3` (1M) |

Splurge picks for chat if cost is no object: Claude Opus 4.8 (`claude-opus-4-8`) or GPT-5.6 Sol (`gpt-5.6-sol`). DeepSeek is the budget king — V4 Flash costs a fraction of the others and holds up fine as a utility model.

### Thinking / reasoning models

Short version: **turn reasoning off (or to its minimum) for every task.** Roleplay prose doesn't benefit from chain-of-thought, and it actively hurts here:

- Reasoning happens before the first visible token, so replies stall exactly where the VN stage is most sensitive — the `<emo>` tag arrives first and switches the sprite as the character "starts talking".
- AnimaChat streams only regular text deltas; reasoning tokens are never shown but are billed as output **and count against the per-reply output budget**, so a long think can eat the room the reply needed.
- The group-chat orchestrator fires before every auto turn — a reasoning model there adds seconds of dead air to every reply for a one-word JSON decision.

Disable it with the model's **custom request body** (deep-merged into every request, your values win):

| Provider | What to do |
|---|---|
| Anthropic | Claude Sonnet 5 thinks by default — add `{"thinking":{"type":"disabled"}}` to the model. Claude Opus 4.8 and Haiku 4.5 don't think unless asked; no config needed. (Don't use the old `budget_tokens` form — current Claude models reject it.) |
| OpenAI / Google / xAI | `{"reasoning_effort":"low"}` — use the lowest value the model accepts (some take `"minimal"` or `"none"`); exact field names vary, check the provider's docs |
| DeepSeek | Stick to the chat models in the table above and skip the reasoner variants |

If a reasoning model does slip through, nothing breaks — the app simply ignores reasoning output — but you'll wait longer and pay for tokens you never see.

Provider setup (`Settings → Add provider`):

| Provider | Type | Base URL |
|---|---|---|
| Anthropic | Anthropic | `https://api.anthropic.com` (or leave empty) |
| OpenAI | OpenAI-compatible | `https://api.openai.com/v1` |
| Google | OpenAI-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek | OpenAI-compatible | `https://api.deepseek.com/v1` |
| xAI | OpenAI-compatible | `https://api.x.ai/v1` |

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
