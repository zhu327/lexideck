ALTER TABLE notes ADD COLUMN anki_id INTEGER;
ALTER TABLE cards ADD COLUMN anki_id INTEGER;

-- Backfill anki_id deterministically. Using created_at directly would collide
-- when multiple rows for the same user were created in the same millisecond.
-- Add a per-user sequence offset based on ROW_NUMBER so every row gets a
-- unique anki_id while staying close to its original timestamp.
-- SQLite 3.25+ (D1) supports window functions.
UPDATE notes
SET anki_id = (
	SELECT created_at + rnum
	FROM (
		SELECT
			id,
			ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) - 1 AS rnum
		FROM notes
	) numbered
	WHERE numbered.id = notes.id
)
WHERE anki_id IS NULL;

UPDATE cards
SET anki_id = (
	SELECT created_at + rnum
	FROM (
		SELECT
			id,
			ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) - 1 AS rnum
		FROM cards
	) numbered
	WHERE numbered.id = cards.id
)
WHERE anki_id IS NULL;

CREATE UNIQUE INDEX idx_notes_user_anki_id ON notes(user_id, anki_id);
CREATE UNIQUE INDEX idx_cards_user_anki_id ON cards(user_id, anki_id);
