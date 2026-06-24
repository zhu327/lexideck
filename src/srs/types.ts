// FSRS Rating values (matches ts-fsrs Rating enum, excluding Manual=0).
// Again=1, Hard=2, Good=3, Easy=4.
export type Rating = 1 | 2 | 3 | 4;

// Persisted representation of a card row (D1 schema). All FSRS numeric fields
// are stored as numbers; due/last_review are epoch milliseconds.
export interface CardRow {
	id: string;
	noteId: string;
	user_id: string;
	deck_id: string;
	template_ord: number;
	due: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	reps: number;
	lapses: number;
	state: number;
	last_review: number | null;
	created_at: number;
}

// A single review log entry derived from an FSRS ReviewLog.
export interface RevlogEntry {
	cardId: string;
	rating: Rating;
	state: number;
	due: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	review_time: number;
}
