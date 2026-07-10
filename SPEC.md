# AnimaChat — Specification

An AI-driven virtual character chat webapp with a visual-novel presentation. Personal, single-user, runs locally.

## Foundation

- **Stack:** Next.js (React + Node), SQLite (server-side, local).
- **Auth:** none — single user.
- **AI layer:** provider-agnostic. Built-in support for the Anthropic API and any OpenAI-compatible API.
- **UI language:** English. AI output language is configurable (see [Language](#language)).

## Providers & models

- Models are grouped under providers. The user adds providers, then adds models under each provider.
- **Provider:** display name, type (`anthropic` | `openai-compatible`), base URL, API key.
- **Model:** model ID, display name, **context window size** (tokens, user-entered — the hard ceiling), optional **custom request body** (JSON) that is deep-merged into outgoing requests, user values winning over app defaults (e.g. `{"thinking":{"type":"disabled"}}`). Invalid JSON is flagged on save, not at chat time.
- API keys are managed in the in-app settings UI (stored in the database).
- **Per-task models:** a task→model map in settings — chat generation, narrator, group-chat orchestration, summarization & fact extraction, co-writing assistant, impersonate, title generation (future tasks slot in). Every task defaults to "inherit" the global default model.
- **Resolution order:** per-character model (group chats) → per-chat model → task's assigned model → global default.

## Entities

All world-building entities are reusable across chats.

**Image aspect ratios:** character sprites **2:3**, character avatars **1:1**, location/scene artwork **16:9**. Upload UI offers a crop tool targeting the ratio; images kept at other ratios are displayed with cover-fit.

### Character
- Name, avatar (image upload, **1:1**, or auto-generated initials/color placeholder), **description** (personality, background, mannerisms, anything else), greeting, example dialogue.
- **Image prompt:** a stored text-to-image prompt describing the neutral sprite (co-writable by the AI assistant; for use with external image generators).
- Avatars are used in the message list / character cards only — never on the VN stage.
- **Expression sprite set** (**2:3** portrait):
  - ~12 predefined common expressions: `neutral, happy, sad, angry, surprised, embarrassed, thoughtful, fearful, disgusted, smug, excited, tired`. Shown as labeled upload slots; all optional, `neutral` is the expected fallback.
  - **Custom expressions:** name + short description (the description teaches the AI when to use it).
  - Characters with no sprites use `sprite-placeholder.svg` (a `currentColor` silhouette, theme-tinted).
- Optional per-character typing-sound override.

### Persona
- Multiple user personas (name + description); chosen per chat. Characters respond according to the active persona.

### Location
- Reusable place description.
- Optional **artwork** (chat background, **16:9**), optional **BGM**, optional **ambient SFX loop** (rain, tavern chatter…) mixed under the BGM.
- **Image prompt:** stored text-to-image prompt for the background artwork (co-writable by the AI assistant).

### Scene
- A situation/setup; optionally references a location.
- Optional **artwork** (**16:9**), optional **BGM**, optional **ambient SFX loop**.
- **Image prompt:** stored text-to-image prompt for the background artwork (co-writable by the AI assistant).
- **Precedence:** if a scene references a location, the location's artwork/BGM is used; otherwise the scene's own. If the referenced location lacks an asset, fall back to the scene's own (location wins when present — the slot isn't forced).

### Story
- An ordered sequence of scenes.

### Lorebook (world info)
- Reusable, keyword-triggered knowledge entries (people, factions, history, rules of the world).
- Each entry: title, trigger keywords, content, and scan settings (e.g. how much recent context to scan).
- When a trigger keyword appears in recent chat context, the entry's content is injected into the prompt.
- Lorebooks are reusable entities; a chat (or a story/scene/character) can attach one or more.

### Chat
- **Chat modes** (chosen at creation, fixed afterwards):
  - **Story** — a story is required; optionally pick a starting scene from that story. In chat the user (and narrator) can switch between the story's scenes only; locations cannot be chosen or switched (they follow the scenes).
  - **Scene** — one scene is required and stays fixed; no scene or location switching.
  - **Location** — one location is required and stays fixed; no switching.
  - **Casual** — no story, scene, or location.
- Participants: one or more characters + one persona. **Character order** is set by the user at creation (drives `[char_N_name]` placeholders) and cannot be edited afterwards.
- Any number of lorebooks can be attached.
- Per-chat settings: model, language, POV, narrator on/off — all editable after creation (language/POV changes affect only new messages).

### Placeholder tags

Sheets (character/persona/location/scene/story/lorebook text fields) may contain placeholder tags, replaced with actual chat values at injection time (prompt assembly and greeting insertion):

- `[char_name]` — first character's name; `[char_N_name]` — Nth character (1-based; `[char_1_name]` = `[char_name]`)
- `[user_name]` / `[persona_name]` — active persona's name
- `[loc_name]`, `[scene_name]`, `[story_name]` — active location/scene/story names
- Case-insensitive. Unresolvable tags get a neutral fallback ("another character", "the current place", …) so the AI never sees broken brackets. Unknown bracketed text is left as-is.

## Chat experience

- **Streaming** responses (token-by-token).
- **Editing:** any message (user's or a character's) is editable **in place** — no branch created.
- **Regenerate:** creates **swipeable alternatives**; the selected one continues the conversation.
- **Long-term memory:** rolling conversation summaries + extracted-facts store per character, persisting across sessions.
  - **Structure:** a "verbatim window" of recent messages is always sent raw (default ~35% of the chat's context budget); older history is covered by the rolling summary. Prompt order: system/character/scene → rolling summary + facts → verbatim window.
  - **Trigger:** after each assistant response, a background check measures un-summarized history that has scrolled out of the verbatim window; past the chunk threshold a background job summarizes the chunk and merges it into the rolling summary (compacting the summary itself when it grows too large). Fact extraction runs on the same chunk in the same pass.
  - **Tunables** — in an "Advanced: memory & context" settings panel, global defaults with per-chat overrides; sensible defaults so none of it is mandatory:
    - **Context budget:** max tokens of assembled prompt per request. Default: min(cap e.g. 32k, model context window − output reserve). Separate from the model's window as a cost control.
    - **Verbatim window share:** % of the context budget kept as raw messages (default ~35%).
    - **Chunk threshold:** out-of-window tokens accumulated before a summarization pass (default ~3k).
    - Token counts are local estimates (providers tokenize differently); the output reserve absorbs the error.
  - **Safety valve:** if prompt assembly finds history that genuinely won't fit (huge paste, smaller-context model) before background jobs catch up, it summarizes synchronously that once.
  - **Invalidation:** in-place edits or save-state rewinds touching summarized ranges invalidate the affected coverage and queue re-summarization. Swipes alone trigger nothing.
  - Summarization/extraction calls are tagged `memory` in token tracking.
- **Group chats:** multiple characters; **auto-orchestrated turn-taking** (an LLM picks the next speaker) with manual override to force a specific character to speak.
- **Save states & rewind:** bookmark a moment in a chat (VN-style checkpoint); later "load" it, either truncating the chat back to that point or forking a copy from it.
- **Impersonate:** a button that has the AI draft the *user's* next reply in the active persona's voice; editable before sending.
- **Relationship/affinity tracking:** per character–persona pair, the AI maintains an evolving relationship state (affinity, trust, notes) that persists across chats and feeds prompts. Inspectable in the chat settings drawer and in the character editor. Can be **disabled per character** (global toggle: no updates, no prompt injection) and **reset** (deletes that character's relationship data with all personas).
- **Organization:** chat tags/folders, auto-generated chat titles, full-text search across all chats.
- Markdown rendering with styled action text.

### Message format (speech & actions)

Shared convention for AI and user:
- `*actions*` in asterisks → rendered italic, muted (stage-direction style). In chat messages single-asterisk means action, not emphasis.
- `"dialogue"` in quotes → normal, prominent text.
- Plain user text is treated as dialogue; input helpers (shortcut/toolbar) wrap selection in asterisks.
- Stored as plain text with the convention embedded; edits work on the raw text.

### Point of view

Configurable: global default + per-chat override. Conventions:
1. **User 1st person, characters 3rd** — user writes "I…", characters write about themselves by name.
2. **All 3rd person** — co-written novel style.
3. **2nd-person VN** — narrator/characters address the user as "you"; user writes 1st person.

Character and narrator prompts adapt; narrator's suggested actions are written in the user's POV so they can be sent as-is. Changing POV mid-chat affects only new messages.

## Narrator

Optional per chat (most useful with a story/scene attached).

- **Triggers:** auto — narrates when it would help (scene-setting, transitions, plot advancement); also summonable on demand via a button.
- **Suggested actions:** after narrating, offers 2–4 in-character choices rendered as buttons; clicking sends as the user's message (pre-formatted in the chat's convention/POV). Free-text input always remains available.
- **Scene progression:** in story mode, the narrator can advance the story to the next scene (via a structured scene-advance tag in its output); the user can also switch between the story's scenes manually. Other chat modes have no scene/location switching.
- **Scene state derives from the timeline:** every scene/location change — narrator-driven or manual — is recorded as an event anchored in the message history (metadata on the narrator message, or a marker entry for manual switches). The current scene is computed as the last scene-change event at or before the end of visible history. Rewinds, save-state loads, and forks therefore restore the correct scene (and its background/BGM) automatically; there is no free-floating "current scene" field to go stale. Editing a narrator message shows its scene-advance metadata alongside the text, where it can be kept, changed, or removed.

## Visual-novel presentation

- **Layout:** the default chat view is the VN stage on the **left** and the chat panel on the **right** (stacked vertically on narrow screens).
- **Stage:** the speaking character's sprite displayed large. With multiple characters, **all** participants' sprites are on stage; the current speaker is at full brightness, others dimmed.
- **Expression selection:** each character message carries an emotion tag chosen by the AI (see AI output structure). Resolution: exact match → `neutral` → placeholder sprite (avatars are never shown on stage). Tags are stored per message, so scrolling history and swiping alternatives replay expressions. The tag is user-correctable when editing a message.
- **Background:** active scene/location artwork (precedence rules above).
- **BGM:** active scene/location BGM (same precedence); loops, cross-fades on scene/location change. Volume slider + mute in chat UI (mute also covers typing SFX).
- **Typing SFX:** `sfx-typewriter.wav` plays during streaming (VN-style blip); global toggle, per-character override.
- **Sprite animation:** fade/slide transitions on expression change and character enter/leave; subtle idle motion (e.g. breathing bob) so the stage feels alive — the idle motion can be disabled per character.
- **Fullscreen VN mode:** toggle that hides app chrome — just background, stage, and a dialogue box at the bottom, advancing message-by-message on click like a real visual novel. Normal chat view remains the default.
- Character-immersive theming throughout.

## AI output structure

Chat content is prose; structure rides in small markers parsed out of the stream and stored as message metadata:

- **Character responses:** small prefix marker (e.g. `<emo>smug</emo>`) then pure prose. Parser consumes the marker early in the stream (sprite switches as the character "starts talking"), strips it, streams the rest. Missing/malformed marker → fall back to `neutral`, show full text.
- **Narrator turns:** narration prose + trailing `<options>…</options>` block (held back, rendered as buttons) + optional scene-advance tag.
- **Non-conversational calls** (speaker selection, memory extraction, co-writing form edits): proper structured output (tool calls / JSON schema).
- **Emotion tagging is decoupled from sprite availability:** the prompt always offers the full standard emotion vocabulary plus the character's custom expressions (with descriptions), and states that the tag is descriptive metadata — not a constraint on the writing. Messages store the character's true emotion even when no matching sprite exists; sprite resolution happens at display time (tag → `neutral` → placeholder), so later-uploaded sprites apply retroactively to old messages.

### Structured tags reference

All inline tags that may appear in AI chat output. The stream parser strips them from displayed text and stores their payload as message metadata. Anything not in this list is treated as plain text.

| Tag | Emitted by | Position | Purpose |
|---|---|---|---|
| `<emo>name</emo>` | Characters | Prefix (first tokens) | Emotion tag for the message; drives sprite expression. One per message. |
| `<options><o>text</o>…</options>` | Narrator | Trailing (end of message) | 2–4 suggested user actions, each in an `<o>` element, pre-written in the chat's POV/convention. Held back from display, rendered as buttons. |
| `<next-scene/>` | Narrator | Trailing | Advance the story to the next scene. Recorded as a scene-change event on the narrator message. |

Parser rules:
- Tags are parsed from the stream incrementally: prefix tags are consumed before display begins; trailing tags are held back once an opening `<options>`/`<next-scene` is detected at the tail.
- **Malformed or unknown tags:** fail soft. A broken `<emo>` → message falls back to `neutral` and full text is shown; a broken `<options>` block → its raw text is dropped or shown as prose, chat continues; never an error state.
- Tag names are English regardless of the chat language; only the payload (option text) follows the language setting.
- Stored metadata (emotion, options, scene event) is user-editable via message editing.
- Manual scene/location switches create marker entries directly — no tag involved.
- Future tags must be added to this list and follow the same prefix/trailing + fail-soft rules.

## AI assist (co-writing)

- Chat-style co-writing side panel in every editor (character/story/scene/location).
- Conversational side streams as prose; the assistant fills/updates form fields via tool calls as the discussion progresses.
- Follows the global language setting.

## Language

- Global default + per-chat override for the language the AI writes in (characters, narrator, suggested actions).
- Also applies to the AI co-writing assistant.
- App UI itself stays English.

## Token usage tracking

- Every AI call records input/output tokens, tagged with provider, model, and feature (chat, narrator, orchestrator, memory, co-writing assistant, future features).
- Usage dashboard in settings: breakdowns by provider/model/feature and totals over time.

## Import / export

- Character, location, scene, story, and lorebook can be exported; multiple items can be combined into a single **bundle**.
- Bundle = zip with a JSON manifest + all referenced assets (avatars, sprites, artwork, BGM).
- A story export can optionally pull in its referenced scenes/locations.
- Import restores everything, with duplicate handling.
- **Novel export:** export a chat as clean formatted prose (markdown / EPUB), narrator text included, reading like a book chapter.
- **Full backup/restore:** one-click export of the entire database + all assets as a single archive (distinct from entity bundles); restore from archive.

## Assets in repo

- `sprite-placeholder.svg` — default character sprite (currentColor silhouette).
- `sfx-typewriter.wav` — default typing SFX (16-bit mono PCM, 44.1 kHz).
