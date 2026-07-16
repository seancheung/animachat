-- AnimaChat schema — 001, the initial layout.
--
-- Applied automatically on a FRESH postgres volume (this directory is mounted
-- into the container's /docker-entrypoint-initdb.d). On an existing database,
-- apply manually:
--
--   docker compose exec -T postgres psql -U animachat -d animachat -f - < migrations/001_init.sql
--
-- Every statement is IF NOT EXISTS, so re-running is always safe. The app
-- never runs DDL — future schema changes ship as numbered files here, applied
-- the same manual way (initdb only runs on empty volumes).
--
-- Conventions: timestamps are BIGINT ms epochs; booleans are INTEGER 0/1;
-- JSON documents are TEXT (queries cast ::jsonb where they reach inside).

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('anthropic','openai')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 128000,
  custom_body TEXT,
  input_price DOUBLE PRECISION,
  cache_read_price DOUBLE PRECISION,
  cache_write_price DOUBLE PRECISION,
  output_price DOUBLE PRECISION,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_asset TEXT,
  description TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '',
  example_dialogue TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL DEFAULT '',
  sprites TEXT NOT NULL DEFAULT '{}',
  sprite_sfx TEXT NOT NULL DEFAULT '{}',
  custom_expressions TEXT NOT NULL DEFAULT '[]',
  typing_sfx_asset TEXT,
  track_relationship INTEGER NOT NULL DEFAULT 1,
  aliveness TEXT NOT NULL DEFAULT '{}',
  idle_motion INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL DEFAULT '',
  artwork_asset TEXT,
  bgm_asset TEXT,
  ambient_asset TEXT,
  stage_style TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  setup TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL DEFAULT '',
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  artwork_asset TEXT,
  bgm_asset TEXT,
  ambient_asset TEXT,
  stage_style TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
-- a story owns its items: characters/scenes/locations/lorebooks are embedded
-- copies (JSON documents), never references into the library tables
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  secrets TEXT NOT NULL DEFAULT '[]',
  characters TEXT NOT NULL DEFAULT '[]',
  scenes TEXT NOT NULL DEFAULT '[]',
  locations TEXT NOT NULL DEFAULT '[]',
  lorebooks TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS lorebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  entries TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  mode TEXT NOT NULL DEFAULT 'casual',
  folder TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  story_id TEXT,
  scene_id TEXT,
  location_id TEXT,
  lorebook_ids TEXT NOT NULL DEFAULT '[]',
  character_ids TEXT NOT NULL DEFAULT '[]',
  persona_id TEXT,
  persona_character_id TEXT,
  story_snapshot TEXT,
  name_snapshots TEXT NOT NULL DEFAULT '{}',
  model_id TEXT,
  char_models TEXT NOT NULL DEFAULT '{}',
  language TEXT NOT NULL DEFAULT '',
  pov TEXT NOT NULL DEFAULT '',
  narrator_enabled INTEGER NOT NULL DEFAULT 0,
  play_as_narrator INTEGER NOT NULL DEFAULT 0,
  overrides TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','character','narrator','marker')),
  character_id TEXT,
  variants TEXT NOT NULL DEFAULT '[]',
  active_variant INTEGER NOT NULL DEFAULT 0,
  scene_event TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, position);
CREATE TABLE IF NOT EXISTS raw_outputs (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  variant_index INTEGER NOT NULL,
  raw TEXT NOT NULL,
  PRIMARY KEY (message_id, variant_index)
);
CREATE TABLE IF NOT EXISTS summaries (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  covered_position INTEGER NOT NULL DEFAULT -1,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  chat_id TEXT,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  affinity INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL,
  UNIQUE (character_id, persona_id)
);
CREATE TABLE IF NOT EXISTS char_relationships (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  other_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  affinity INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL,
  UNIQUE (character_id, other_id)
);
-- aliveness: a character's evolving inner state, per chat (memory pass output)
CREATE TABLE IF NOT EXISTS mind_states (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (character_id, chat_id)
);
-- aliveness: what a character has been up to between conversations, per chat
-- (regenerated on each qualifying return; created_at guards double-fires)
CREATE TABLE IF NOT EXISTS offscreen_notes (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (character_id, chat_id)
);
CREATE TABLE IF NOT EXISTS usage_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts BIGINT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  feature TEXT NOT NULL,
  chat_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
-- name sorts/cursors compare LOWER(name) (the Postgres spelling of COLLATE NOCASE)
CREATE INDEX IF NOT EXISTS idx_characters_name    ON characters(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_characters_updated ON characters(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_characters_created ON characters(created_at, id);
CREATE INDEX IF NOT EXISTS idx_personas_name      ON personas(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_personas_updated   ON personas(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_personas_created   ON personas(created_at, id);
CREATE INDEX IF NOT EXISTS idx_locations_name     ON locations(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_locations_updated  ON locations(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_locations_created  ON locations(created_at, id);
CREATE INDEX IF NOT EXISTS idx_scenes_name        ON scenes(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_scenes_updated     ON scenes(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_scenes_created     ON scenes(created_at, id);
CREATE INDEX IF NOT EXISTS idx_stories_name       ON stories(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_stories_updated    ON stories(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_stories_created    ON stories(created_at, id);
CREATE INDEX IF NOT EXISTS idx_lorebooks_name     ON lorebooks(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_lorebooks_updated  ON lorebooks(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_lorebooks_created  ON lorebooks(created_at, id);
CREATE INDEX IF NOT EXISTS idx_chats_updated      ON chats(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_facts_character    ON facts(character_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_ts           ON usage_log(ts);
