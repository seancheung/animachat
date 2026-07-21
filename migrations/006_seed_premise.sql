-- The seed story's premise was a jacket-blurb teaser ("What starts as X turns
-- into Y… and the secret sleeping under the Moonlit Tavern") — future-arc
-- marketing that even advertises a secret's existence, modeling exactly the
-- style the co-writer steering forbids (the premise is the situation as play
-- opens, spoiler-free; the form state teaches by example). Rewritten as pure
-- situation. Guarded on the exact original text so a user-edited premise is
-- never touched and re-running is a no-op.
UPDATE stories SET
  description = 'Mira owes the Ashen Guild more than money, and the collectors arrive at dawn. Her help-wanted notice hangs by the tavern door: one hired stranger, one night to find a way out — while a knight-errant nurses an untouched ale in the corner and the cellar door stays locked. Tone: warm low-fantasy adventure with humor and heart.'
WHERE id = '11872c33-a24f-49dd-a702-6718d23fe3ab'
  AND description = 'Mira owes the Ashen Guild more than money, and the collectors arrive at dawn. What starts as a simple help-wanted notice turns into a night of bad decisions, worse alchemy, and the secret sleeping under the Moonlit Tavern. Tone: warm low-fantasy adventure with humor and heart.';
