import { describe, expect, it } from "vitest";
import { cardToRow, rowToCard } from "../src/srs/mapping";
import { initNewCard, scheduleReview } from "../src/srs/scheduler";
import type { CardRow } from "../src/srs/types";

const now = new Date("2026-01-01T00:00:00Z");

function makeRow(overrides: Partial<CardRow> = {}): CardRow {
	return {
		id: "c1",
		noteId: "n1",
		user_id: "u1",
		deck_id: "d1",
		template_ord: 0,
		due: now.getTime(),
		stability: 2.3065,
		difficulty: 2.11810397,
		elapsed_days: 3,
		scheduled_days: 2,
		reps: 5,
		lapses: 1,
		state: 2,
		last_review: now.getTime(),
		created_at: now.getTime(),
		...overrides,
	};
}

describe("initNewCard", () => {
	it("creates a New(0) card with due≈now and reps 0", () => {
		const row = initNewCard(now);
		expect(row.state).toBe(0);
		expect(row.reps).toBe(0);
		expect(row.lapses).toBe(0);
		expect(Math.abs(row.due - now.getTime())).toBeLessThan(1000);
		expect(row.last_review).toBeNull();
		expect(row.id).toBe("");
	});
});

describe("scheduleReview", () => {
	it("transitions a New card with Good(3) to Review(2), reps=1, future due", () => {
		const seed = initNewCard(now);
		const { next } = scheduleReview(seed, 3, now);
		expect(next.state).toBe(2);
		expect(next.reps).toBe(1);
		expect(next.due).toBeGreaterThan(now.getTime());
	});

	it("keeps a New card in Learning(1) when rated Again(1)", () => {
		const seed = initNewCard(now);
		const { next } = scheduleReview(seed, 1, now);
		expect(next.state).toBe(1);
	});

	it("increments lapses when a Review card is rated Again(1)", () => {
		// Build a review card: New -> Good graduates to Review.
		const review = scheduleReview(initNewCard(now), 3, now).next;
		expect(review.state).toBe(2);

		const before = review.lapses;
		const { next } = scheduleReview(review, 1, new Date(review.due));
		expect(next.lapses).toBe(before + 1);
		// Due should be near-now (short relearning step, same day).
		expect(next.due).toBeLessThanOrEqual(review.due + 86400000);
	});

	it("records a revlog entry tied to the source card", () => {
		const seed = initNewCard(now);
		const { revlog } = scheduleReview(seed, 3, now);
		expect(revlog.cardId).toBe(seed.id);
		expect(revlog.rating).toBe(3);
		expect(revlog.review_time).toBe(now.getTime());
		expect(revlog.state).toBe(0); // pre-review state (New) captured in the log
		expect(typeof revlog.due).toBe("number");
		expect(typeof revlog.stability).toBe("number");
		expect(typeof revlog.scheduled_days).toBe("number");
	});
});

describe("rowToCard / cardToRow round-trip", () => {
	it("preserves FSRS numeric fields and state", () => {
		const row = makeRow();
		const back = cardToRow(rowToCard(row, now), row);
		expect(back.stability).toBe(row.stability);
		expect(back.difficulty).toBe(row.difficulty);
		expect(back.reps).toBe(row.reps);
		expect(back.lapses).toBe(row.lapses);
		expect(back.state).toBe(row.state);
		expect(back.elapsed_days).toBe(row.elapsed_days);
		expect(back.scheduled_days).toBe(row.scheduled_days);
		expect(back.due).toBe(row.due);
		expect(back.last_review).toBe(row.last_review);
	});

	it("preserves identity fields from the base row", () => {
		const row = makeRow({
			id: "id-7",
			noteId: "note-7",
			user_id: "user-7",
			deck_id: "deck-7",
			template_ord: 3,
			created_at: 999,
		});
		const back = cardToRow(rowToCard(row, now), row);
		expect(back.id).toBe("id-7");
		expect(back.noteId).toBe("note-7");
		expect(back.user_id).toBe("user-7");
		expect(back.deck_id).toBe("deck-7");
		expect(back.template_ord).toBe(3);
		expect(back.created_at).toBe(999);
	});

	it("round-trips a null last_review", () => {
		const row = makeRow({ last_review: null, state: 0, reps: 0 });
		const back = cardToRow(rowToCard(row, now), row);
		expect(back.last_review).toBeNull();
	});
});
