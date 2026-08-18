-- Replace the structured-assistant chapter attachment toggle with a three-state
-- context mode. Chapter summaries themselves live inside the chapters JSON.
ALTER TABLE manuscripts
  ADD COLUMN IF NOT EXISTS assistant_chapter_context TEXT NOT NULL DEFAULT 'none';

ALTER TABLE manuscripts
  DROP COLUMN IF EXISTS assistant_include_active_chapter;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'manuscripts_assistant_chapter_context_check'
      AND conrelid = 'manuscripts'::regclass
  ) THEN
    ALTER TABLE manuscripts
      ADD CONSTRAINT manuscripts_assistant_chapter_context_check
      CHECK (assistant_chapter_context IN ('none', 'summary', 'full'));
  END IF;
END $$;
