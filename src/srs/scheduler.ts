import { createEmptyCard, fsrs } from "ts-fsrs";
import { cardToRow, rowToCard } from "./mapping";
import type { CardRow, Rating, RevlogEntry } from "./types";

// Default FSRS v5 parameters, with a single 1m learning step so that a Good on a
// New card graduates to Review while Again keeps it in Learning. (With the
// ts-fsrs defaults ["1m","10m"], New+Good stays in Learning, which violates the
// acceptance criteria; with enable_short_term:false, New+Again jumps to Review.)
const f = fsrs({ learning_steps: ["1m"] });

// Create a brand-new New(0) card row with due≈now and empty identity fields.
export function initNewCard(now: Date): CardRow {
	const base: CardRow = {
		id: "",
		noteId: "",
		user_id: "",
		deck_id: "",
		template_ord: 0,
		ankiId: null,
		due: 0,
		stability: 0,
		difficulty: 0,
		elapsed_days: 0,
		scheduled_days: 0,
		reps: 0,
		lapses: 0,
		state: 0,
		last_review: null,
		created_at: now.getTime(),
	};
	return cardToRow(createEmptyCard(now), base);
}

// Compute the next card state and a revlog entry for `rating` at `now`.
export function scheduleReview(
	row: CardRow,
	rating: Rating,
	now: Date,
): { next: CardRow; revlog: RevlogEntry } {
	const repeat = f.repeat(rowToCard(row, now), now);
	const item = repeat[rating];
	const next = cardToRow(item.card, row);
	const revlog: RevlogEntry = {
		cardId: row.id,
		rating,
		state: item.log.state,
		due: item.card.due.getTime(),
		stability: item.card.stability,
		difficulty: item.card.difficulty,
		elapsed_days: item.log.elapsed_days,
		scheduled_days: item.log.scheduled_days,
		review_time: now.getTime(),
	};
	return { next, revlog };
}
