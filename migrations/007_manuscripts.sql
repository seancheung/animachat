-- Self-contained manuscript projects. Chapters, embedded characters, and
-- their private assistant/character sessions never join the Library or Chats.
CREATE TABLE IF NOT EXISTS manuscripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  perspective TEXT NOT NULL DEFAULT 'third-limited',
  style TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  chapters TEXT NOT NULL DEFAULT '[]',
  characters TEXT NOT NULL DEFAULT '[]',
  sessions TEXT NOT NULL DEFAULT '[]',
  conversations TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manuscripts_name ON manuscripts(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_manuscripts_updated ON manuscripts(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_manuscripts_created ON manuscripts(created_at, id);
