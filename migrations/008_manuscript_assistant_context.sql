-- Persist the structured manuscript assistants' shared chapter-context preference.
ALTER TABLE manuscripts
  ADD COLUMN IF NOT EXISTS assistant_include_active_chapter BOOLEAN NOT NULL DEFAULT FALSE;
