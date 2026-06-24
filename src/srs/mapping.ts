import type { Card, State } from "ts-fsrs";
import type { CardRow } from "./types";

// Convert a persisted CardRow into an FSRS Card. `now` is accepted to match the
// scheduling API surface but is not needed: due/last_review are absolute ms.
export function rowToCard(row: CardRow, _now: Date): Card {
	return {
		due: new Date(row.due),
		stability: row.stability,
		difficulty: row.difficulty,
		elapsed_days: row.elapsed_days,
		scheduled_days: row.scheduled_days,
		reps: row.reps,
		lapses: row.lapses,
		state: row.state as State,
		last_review: row.last_review ? new Date(row.last_review) : undefined,
		// CardRow does not persist learning_steps; default to 0 (recomputed by the
		// scheduler from the configured learning/relearning steps).
		learning_steps: 0,
	};
}

// Convert an FSRS Card back into a CardRow, carrying identity fields from `base`.
export function cardToRow(card: Card, base: CardRow): CardRow {
	return {
		...base,
		due: card.due.getTime(),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsed_days: card.elapsed_days,
		scheduled_days: card.scheduled_days,
		reps: card.reps,
		lapses: card.lapses,
		state: card.state,
		last_review: card.last_review ? card.last_review.getTime() : null,
	};
}
