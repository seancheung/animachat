-- Self-contained fiction-writing projects. Chapters, embedded characters, and
-- their private assistant/character sessions never join the Library or Chats.
CREATE TABLE IF NOT EXISTS writings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  perspective TEXT NOT NULL DEFAULT 'third-limited',
  writing_style TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  chapters TEXT NOT NULL DEFAULT '[]',
  characters TEXT NOT NULL DEFAULT '[]',
  sessions TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_writings_name ON writings(LOWER(name), id);
CREATE INDEX IF NOT EXISTS idx_writings_updated ON writings(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_writings_created ON writings(created_at, id);
