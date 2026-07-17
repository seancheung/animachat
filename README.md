# ✦ AnimaChat

An AI-driven virtual character chat webapp with a visual-novel soul. Provider-agnostic; single-user today, gradually migrating to a multi-user online platform.

## Quick start

Postgres and MinIO run in Docker; the app runs on your machine.

```bash
docker compose up -d     # postgres + minio (+ one-shot bucket/user setup)
npm install
npm run dev
```

A fresh Postgres volume picks up the schema automatically (`migrations/` is mounted into the container's init directory). Later schema changes ship as new numbered files there and are applied manually:

```bash
docker compose exec -T postgres psql -U animachat -d animachat -f - < migrations/00X_whatever.sql
```

Open http://localhost:3000 (or the port Next picks), then:

1. **Settings** → add a provider (Anthropic or any OpenAI-compatible endpoint), add a model under it (with its context window size), and set it as the **global default model**.
2. **Library** → starter characters and places come pre-seeded on a fresh install (Mira, Kael, the Moonlit Tavern — `migrations/100_seed.sql`; delete it before the first `docker compose up` to start empty). Create your own — every editor has an **AI co-writer panel** that fills the form as you chat with it.
3. **Stories** → a story is a self-contained work: its cast, scenes, places and lore live *inside* it (embedded copies — the library stays a parts bin you copy from). A starter story is seeded; the story page's co-writer can author a whole story in one conversation, or extract one from an attached novel. Hit **Play** to start a playthrough (play as a cast member or a persona); finished and running playthroughs are listed right there.
4. **Chats** → **+ New chat** for **Casual** (pure chat — text the characters like real people online, in a messenger view: no narration, no roleplay conventions) or **Immersive** (roleplay on the VN stage — optional scene or location, optional narrator, or a narrator-only text adventure) chats.

Data lives in the docker volumes: the database in **Postgres** (`DATABASE_URL`, default `postgres://animachat:animachat@localhost:5432/animachat`), uploaded assets in the **MinIO** bucket (`S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, defaults matching the compose file). Uploads go from the browser straight to the bucket via presigned URLs — set `S3_PUBLIC_ENDPOINT` to the MinIO address your browser can reach if it differs from the server's view (LAN/docker deploys). The **Settings transfer** panel moves the system configuration (providers, models, keys, preferences) between instances as one JSON file; library content and stories travel as export bundles.

To run the app itself in Docker too: `docker compose --profile app up -d --build`.

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
| Novel rewrite (export) | Creative | Rewrites a chat into book prose on export — read-quality matters |

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
| **Entities** | Library: characters (sprites, custom expressions, image prompt), personas, locations & scenes (16:9 art, BGM, ambient loop, image prompt, per-place stage & chat-panel coloring with a global toggle), lorebooks (keyword-triggered) — reusable across chats. **Stories** are their own top-level section: each story *owns* embedded copies of its cast, scenes (with per-scene casts, contracts, offstage pressures & authored branching), locations and lorebooks, plus secrets — edited on a full story page with a whole-document co-writer; copy items in from the library or out to it (snapshots, never live links). Everything import/exportable as zip bundles with assets |
| **VN stage** | 2:3 expression sprites chosen by an AI emotion tag per message (decoupled from availability: the true emotion is stored, sprites resolve at render time with neutral → placeholder fallback), speaker dimming, breathing idle, background art & crossfading BGM with location-over-scene precedence, paced typewriter reveal in the dialogue box (adjustable chars/sec, Stop to skip; the side panel shows text as it streams) with blips (per-character override), two switchable chat layouts — side panel or VN dialogue box (click/space to advance, wheel for backlog) |
| **Chat** | Three modes — **casual** (pure chat: texting the characters like real people in a messenger view — no narrator, no POV, no `*actions*`/emotion tags; the convention is enforced mechanically, stripping stray roleplay markup from replies before storage), **immersive** (roleplay on the VN stage — optional scene/location, optional narrator, play-as-narrator where you write the narration), **playthrough** (a self-contained snapshot run of a story, started from the Stories page where playthroughs are also listed; play as a cast member). Streaming with inline tag parsing, in-place edits (no branching), regenerate-as-swipes on the newest message (frozen to the pick once the chat moves on; branch from earlier points by forking), group chats with LLM turn orchestration + force-speaker, impersonate, per-chat language & POV (user-1st / all-3rd / VN-2nd; immersive & story) |
| **Narrator** | Optional (required in playthroughs, where it directs); speaks first; auto or summoned; 2–4 suggested actions as buttons; advances scenes via `<next-scene/>` — at an authored branch point, a targeted `<next-scene>Scene Name</next-scene>` picks the road, so a story can have multiple endings — stages the cast via `<enter>`/`<leave>`, reveals secrets via `<reveal>`, concludes via `<the-end/>` — all event-sourced from the timeline, so forks restore scene, presence, art and BGM (and replay the other road) |
| **Memory** | Rolling summarization (background, chunked, tunable budget/share/threshold in Settings → Advanced), per-character extracted facts, persona↔character affinity tracking with a relationship card |
| **Organization** | Fork any message into a new chat (non-destructive save states), folders & tags, full-text search, auto titles, novel export (Markdown / EPUB — plain transcript, or an AI rewrite into book prose), token usage & cost dashboard by feature/model (enter per-model $/Mtok prices, incl. cache read/write — applied retroactively to logged usage) |

## Structured tags (AI output)

Chat prose carries seven inline tags, parsed out of the stream and stored as message metadata: `<emo>name</emo>` (character emotion), `<options><o>…</o></options>` (narrator suggestions), `<next-scene/>` (story advance; `<next-scene>Scene Name</next-scene>` picks the road at a branch point), `<enter>Name</enter>`/`<leave>Name</leave>` (stage presence), `<reveal>Title</reveal>` (a story secret established as truth), `<the-end/>` (playthrough conclusion). Everything fails soft — a malformed tag renders as plain text and the chat keeps going. Casual chats carry no tags at all (`<mention>` excepted): their prompts offer no tag vocabulary, and strays are stripped at the boundary.

## Development

- `SPEC.md` — the full product spec this app implements.
- `src/lib/` — db, store (all SQL), `ai/` (provider clients, tag parser, prompt builder, memory), bundle (import/export).
- `src/app/api/` — REST + SSE routes. `src/app/` + `src/components/` — UI.
- `npm run build` — production build; `npm run typecheck` — typecheck; `npm test` — vitest unit tests (tag parser, placeholders, JSON extraction).

No cloud, no telemetry, no accounts. Your keys stay in your local Postgres.
