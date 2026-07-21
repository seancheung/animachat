-- The director's beat read joins the exit read: an enumerable pacing token
-- ('carry' / 'escalate' / 'settle' / 'close') that the next character prompt maps to
-- an app-authored PACING line — the director selects among our sentences, it never
-- writes one. Pacing state, never fiction: forks and regenerates re-derive it, and
-- junk output simply clears it (a stale beat is worse than none).
ALTER TABLE director_reads ADD COLUMN IF NOT EXISTS beat TEXT;
