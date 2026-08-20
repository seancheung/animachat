-- Chapters are now attached explicitly to assistant sessions and conversations.
-- The project-level setting only chooses how those attachments are represented.
ALTER TABLE manuscripts
  DROP CONSTRAINT IF EXISTS manuscripts_assistant_chapter_context_check;

UPDATE manuscripts
SET assistant_chapter_context = 'summary'
WHERE assistant_chapter_context = 'none';

ALTER TABLE manuscripts
  ALTER COLUMN assistant_chapter_context SET DEFAULT 'summary';

ALTER TABLE manuscripts
  ADD CONSTRAINT manuscripts_assistant_chapter_context_check
  CHECK (assistant_chapter_context IN ('summary', 'full'));
