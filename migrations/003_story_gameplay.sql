-- Story-mode gameplay state — playthrough-scoped, nothing touches the library.

-- Story-local bonds: a playthrough cast member's evolving stance toward the player
-- and the other cast, kept inside one playthrough (a replay starts fresh; library
-- relationship tracking still never applies to embedded cast). Written by the
-- memory pass (each character's set replaced per pass), injected into that
-- character's prompts. character_id is the chat's cast id — in story mode that is
-- a snapshot-embedded id with no characters row, so deliberately no FK on it.
CREATE TABLE IF NOT EXISTS story_bonds (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  -- JSON array: [{"towards": name, "stance": short label, "note": one line}]
  bonds TEXT NOT NULL DEFAULT '[]',
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (chat_id, character_id)
);

-- The director's remembered read of the current scene's exit condition ('unmet' /
-- 'near' / 'met') — pacing state, not fiction: forks and regenerates just re-derive
-- it. Keyed to the scene it was read in, so a scene change invalidates it by
-- mismatch instead of needing a reset write.
CREATE TABLE IF NOT EXISTS director_reads (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  scene_id TEXT,
  exit_read TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
