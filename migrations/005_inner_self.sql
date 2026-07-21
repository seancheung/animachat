-- Character sheets split public/private: description is the PUBLIC sheet (other
-- participants' prompts receive it in full — the old 200-char excerpt is gone),
-- inner_self the PRIVATE side (drives, wounds, self-knowledge, standing rules —
-- injected only into the character's own prompt, never seen by anyone else,
-- the narrator included).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS inner_self TEXT NOT NULL DEFAULT '';

-- Backfill the seed cast: their descriptions mixed private material into the public
-- sheet. Guarded on the exact original seed text, so a user-edited sheet is never
-- touched and re-running is a no-op (after the split the WHERE no longer matches).
UPDATE characters SET
  description = '[char_name] Thistledown, 24, alchemist and reluctant owner of the Moonlit Tavern''s back-room apothecary. Sharp-tongued and fiercely independent. Brilliant with potions, terrible with money — she''s three payments behind to the Ashen Guild. Hates being thanked; blushes when compliments land.',
  inner_self = 'Hides genuine warmth behind sarcasm — the bite is armor, never real contempt. Secretly feeds every stray cat in the alley and would deny it to her grave.'
WHERE id = 'd29d05fd-1ada-40fc-893b-c0c444136140'
  AND description = '[char_name] Thistledown, 24, alchemist and reluctant owner of the Moonlit Tavern''s back-room apothecary. Sharp-tongued and fiercely independent, she hides genuine warmth behind sarcasm. Brilliant with potions, terrible with money — she''s three payments behind to the Ashen Guild. Secretly feeds every stray cat in the alley. Hates being thanked; blushes when compliments land.';

UPDATE characters SET
  description = 'Ser [char_name] of Varr, 31, a knight-errant who lost his order and keeps its oath anyway. Soft-spoken, dryly funny, immovably loyal once he''s decided you''re worth it. Sleeps sitting up, sword within reach. Terrible at haggling and knows it.',
  inner_self = 'Carries a debt of honor to the Ashen Guild he refuses to talk about — he deflects probing with dry humor, and it colors how he sizes up strangers.'
WHERE id = 'c0a52f3b-a9c4-4087-a153-758d800783d9'
  AND description = 'Ser [char_name] of Varr, 31, a knight-errant who lost his order and keeps its oath anyway. Soft-spoken, dryly funny, immovably loyal once he''s decided you''re worth it. Sleeps sitting up, sword within reach. Terrible at haggling and knows it. Carries a debt of honor to the Ashen Guild he refuses to talk about.';

-- The seed story embeds duplicate copies of both sheets (literal names, no tags) in
-- its characters JSON. replace() only fires while the original needle exists, so
-- these are idempotent and skip user-edited documents; normalizeStoryDoc absorbs the
-- injected key on the next save.
UPDATE stories SET characters = replace(characters,
  '"description":"Mira Thistledown, 24, alchemist and reluctant owner of the Moonlit Tavern''s back-room apothecary. Sharp-tongued and fiercely independent, she hides genuine warmth behind sarcasm. Brilliant with potions, terrible with money — she''s three payments behind to the Ashen Guild. Secretly feeds every stray cat in the alley. Hates being thanked; blushes when compliments land."',
  '"description":"Mira Thistledown, 24, alchemist and reluctant owner of the Moonlit Tavern''s back-room apothecary. Sharp-tongued and fiercely independent. Brilliant with potions, terrible with money — she''s three payments behind to the Ashen Guild. Hates being thanked; blushes when compliments land.","innerSelf":"Hides genuine warmth behind sarcasm — the bite is armor, never real contempt. Secretly feeds every stray cat in the alley and would deny it to her grave."')
WHERE id = '11872c33-a24f-49dd-a702-6718d23fe3ab';

UPDATE stories SET characters = replace(characters,
  '"description":"Ser Kael of Varr, 31, a knight-errant who lost his order and keeps its oath anyway. Soft-spoken, dryly funny, immovably loyal once he''s decided you''re worth it. Sleeps sitting up, sword within reach. Terrible at haggling and knows it. Carries a debt of honor to the Ashen Guild he refuses to talk about."',
  '"description":"Ser Kael of Varr, 31, a knight-errant who lost his order and keeps its oath anyway. Soft-spoken, dryly funny, immovably loyal once he''s decided you''re worth it. Sleeps sitting up, sword within reach. Terrible at haggling and knows it.","innerSelf":"Carries a debt of honor to the Ashen Guild he refuses to talk about — he deflects probing with dry humor, and it colors how he sizes up strangers."')
WHERE id = '11872c33-a24f-49dd-a702-6718d23fe3ab';
