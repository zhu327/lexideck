import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";
import { createReviewApp } from "../src/review/router";

const DECK = "deck-default-local";
const MODEL = "model-basic-local";

// Mount the review app behind the auth middleware exactly like a real caller.
function makeApp() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth());
	a.route("/api/review", createReviewApp({ db: createDbClient(env.DB) }));
	return a;
}

async function seedNote(
	id: string,
	opts: { fields?: Record<string, string>; tags?: string[] } = {},
) {
	const fields = JSON.stringify(opts.fields ?? { Front: "Hello", Back: "World" });
	const tags = JSON.stringify(opts.tags ?? []);
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at) " +
			"VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(id, DECK, MODEL, fields, tags, id, now, now)
		.run();
}

interface SeedCardOpts {
	due?: number;
	state?: number;
	reps?: number;
	lapses?: number;
	stability?: number;
	difficulty?: number;
	elapsed_days?: number;
	scheduled_days?: number;
	last_review?: number | null;
}

async function seedCard(id: string, noteId: string, opts: SeedCardOpts = {}) {
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO cards (id, user_id, note_id, deck_id, template_ord, due, stability, difficulty, " +
			"elapsed_days, scheduled_days, reps, lapses, state, last_review, created_at) " +
			"VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			id,
			noteId,
			DECK,
			0,
			opts.due ?? now,
			opts.stability ?? 0,
			opts.difficulty ?? 0,
			opts.elapsed_days ?? 0,
			opts.scheduled_days ?? 0,
			opts.reps ?? 0,
			opts.lapses ?? 0,
			opts.state ?? 0,
			opts.last_review ?? null,
			now,
		)
		.run();
}

function postJson(url: string, body: unknown): Request {
	return new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM revlog").run();
	await env.DB.prepare("DELETE FROM cards").run();
	await env.DB.prepare("DELETE FROM notes").run();
});

describe("review API", () => {
	it("GET /api/review/due returns a seeded New card with Front/Back fields", async () => {
		await seedNote("note-due", { fields: { Front: "Hello", Back: "World" } });
		await seedCard("card-due", "note-due", { state: 0, due: Date.now() });

		const res = await makeApp().fetch(new Request("http://localhost/api/review/due"), env);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			cards: Array<{ cardId: string; noteId: string; fields: Record<string, string> }>;
		};
		expect(body.cards).toHaveLength(1);
		expect(body.cards[0].cardId).toBe("card-due");
		expect(body.cards[0].noteId).toBe("note-due");
		expect(body.cards[0].fields.Front).toBe("Hello");
		expect(body.cards[0].fields.Back).toBe("World");
	});

	it("POST /api/review/submit rating 3 returns a future due and writes a revlog row", async () => {
		await seedNote("note-submit", { fields: { Front: "Q", Back: "A" } });
		await seedCard("card-submit", "note-submit", { state: 0, due: Date.now() });
		const t0 = Date.now();

		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/submit", { cardId: "card-submit", rating: 3 }),
			env,
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { due: number };
		expect(body.due).toBeGreaterThan(t0);

		const log = await env.DB.prepare("SELECT id FROM revlog WHERE card_id = ?")
			.bind("card-submit")
			.first();
		expect(log).not.toBeNull();
	});

	it("does not return a card in GET /api/review/due after a Good review", async () => {
		await seedNote("note-after", { fields: { Front: "Q2", Back: "A2" } });
		await seedCard("card-after", "note-after", { state: 0, due: Date.now() });

		const submit = await makeApp().fetch(
			postJson("http://localhost/api/review/submit", { cardId: "card-after", rating: 3 }),
			env,
		);
		expect(submit.status).toBe(200);

		const res = await makeApp().fetch(new Request("http://localhost/api/review/due"), env);
		const body = (await res.json()) as { cards: Array<{ cardId: string }> };
		expect(body.cards.map((c) => c.cardId)).not.toContain("card-after");
	});

	it("POST /api/review/submit rating 1 on a due Review card lapses and reschedules due near now", async () => {
		await seedNote("note-lapse", { fields: { Front: "Q3", Back: "A3" } });
		const now = Date.now();
		await seedCard("card-lapse", "note-lapse", {
			state: 2,
			due: now,
			reps: 1,
			lapses: 0,
			stability: 5,
			difficulty: 5,
			elapsed_days: 1,
			scheduled_days: 1,
			last_review: now - 86_400_000,
		});
		const t0 = Date.now();

		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/submit", { cardId: "card-lapse", rating: 1 }),
			env,
		);

		expect(res.status).toBe(200);
		const card = await env.DB.prepare("SELECT lapses, due FROM cards WHERE id = ?")
			.bind("card-lapse")
			.first<{ lapses: number; due: number }>();
		expect(card?.lapses).toBe(1);
		expect(card?.due).toBeGreaterThan(t0);
		expect(card?.due ?? 0).toBeLessThanOrEqual(t0 + 3_600_000);
	});

	it("POST /api/review/submit with unknown cardId returns 404", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/submit", { cardId: "nope", rating: 3 }),
			env,
		);
		expect(res.status).toBe(404);
	});

	it("GET /api/review/due?limit=abc returns 200 with an array (no 500)", async () => {
		const res = await makeApp().fetch(
			new Request("http://localhost/api/review/due?limit=abc"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[] };
		expect(Array.isArray(body.cards)).toBe(true);
	});

	it("GET /api/review/due?limit=-1 returns 200 with an array (no 500)", async () => {
		const res = await makeApp().fetch(new Request("http://localhost/api/review/due?limit=-1"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[] };
		expect(Array.isArray(body.cards)).toBe(true);
	});

	it("GET /api/review/quiz returns up to limit cards", async () => {
		await seedNote("note-q1", { fields: { Front: "1", Back: "1b" } });
		await seedNote("note-q2", { fields: { Front: "2", Back: "2b" } });
		await seedNote("note-q3", { fields: { Front: "3", Back: "3b" } });
		await seedCard("card-q1", "note-q1", { state: 0, due: Date.now() });
		await seedCard("card-q2", "note-q2", { state: 0, due: Date.now() });
		await seedCard("card-q3", "note-q3", { state: 0, due: Date.now() });

		const res = await makeApp().fetch(new Request("http://localhost/api/review/quiz?limit=2"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: Array<{ cardId: string }> };
		expect(body.cards).toHaveLength(2);
	});

	it("POST /api/review/familiar marks a note known and returns ok", async () => {
		await seedNote("note-fam", { fields: { Front: "F", Back: "B" }, tags: [] });
		await seedCard("card-fam", "note-fam", { state: 0, due: Date.now() });

		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/familiar", { noteId: "note-fam" }),
			env,
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

		const note = await env.DB.prepare("SELECT tags FROM notes WHERE id = ?")
			.bind("note-fam")
			.first<{ tags: string }>();
		expect(JSON.parse(note?.tags ?? "[]")).toContain("known");
	});

	it("POST /api/review/familiar removes the note's card from the due queue", async () => {
		await seedNote("note-fam-due", { fields: { Front: "FD", Back: "BD" }, tags: [] });
		await seedCard("card-fam-due", "note-fam-due", { state: 0, due: Date.now() });

		const before = await makeApp().fetch(new Request("http://localhost/api/review/due"), env);
		const beforeBody = (await before.json()) as { cards: Array<{ cardId: string }> };
		expect(beforeBody.cards.map((c) => c.cardId)).toContain("card-fam-due");

		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/familiar", { noteId: "note-fam-due" }),
			env,
		);
		expect(res.status).toBe(200);

		const after = await makeApp().fetch(new Request("http://localhost/api/review/due"), env);
		const afterBody = (await after.json()) as { cards: Array<{ cardId: string }> };
		expect(afterBody.cards.map((c) => c.cardId)).not.toContain("card-fam-due");
	});

	it("POST /api/review/familiar with unknown noteId returns 404", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/familiar", { noteId: "nope" }),
			env,
		);
		expect(res.status).toBe(404);
	});

	it("GET /api/review/familiar lists all notes with known flag", async () => {
		await seedNote("note-a", { fields: { Front: "A", Back: "AB" }, tags: ["known"] });
		await seedNote("note-b", { fields: { Front: "B", Back: "BB" }, tags: [] });

		const res = await makeApp().fetch(new Request("http://localhost/api/review/familiar"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			cards: Array<{ noteId: string; front: string; known: boolean }>;
		};
		expect(body.cards).toHaveLength(2);
		const noteA = body.cards.find((c) => c.noteId === "note-a");
		const noteB = body.cards.find((c) => c.noteId === "note-b");
		expect(noteA?.known).toBe(true);
		expect(noteB?.known).toBe(false);
	});

	it("POST /api/review/familiar then GET /familiar shows note as known", async () => {
		await seedNote("note-fam2", { fields: { Front: "F2", Back: "B2" }, tags: [] });

		await makeApp().fetch(
			postJson("http://localhost/api/review/familiar", { noteId: "note-fam2" }),
			env,
		);

		const res = await makeApp().fetch(new Request("http://localhost/api/review/familiar"), env);
		const body = (await res.json()) as { cards: Array<{ noteId: string; known: boolean }> };
		const note = body.cards.find((c) => c.noteId === "note-fam2");
		expect(note?.known).toBe(true);
	});

	it("POST /api/review/familiar/unmark removes known tag", async () => {
		await seedNote("note-unmark", { fields: { Front: "U", Back: "UB" }, tags: ["known"] });

		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/familiar/unmark", { noteId: "note-unmark" }),
			env,
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

		const note = await env.DB.prepare("SELECT tags FROM notes WHERE id = ?")
			.bind("note-unmark")
			.first<{ tags: string }>();
		expect(JSON.parse(note?.tags ?? "[]")).not.toContain("known");
	});

	it("POST /api/review/familiar/unmark on already-unmarked note is idempotent", async () => {
		await seedNote("note-noknown", { fields: { Front: "N", Back: "NB" }, tags: [] });

		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/familiar/unmark", { noteId: "note-noknown" }),
			env,
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
	});

	it("POST /api/review/familiar/unmark with unknown noteId returns 404", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/familiar/unmark", { noteId: "nope" }),
			env,
		);
		expect(res.status).toBe(404);
	});

	it("GET /api/review/due?limit=5&offset=5 returns second page", async () => {
		const now = Date.now();
		for (let i = 0; i < 12; i++) {
			const ni = `note-due-off-${i}`;
			const ci = `card-due-off-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		const res = await makeApp().fetch(
			new Request("http://localhost/api/review/due?limit=5&offset=5"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: Array<{ fields: Record<string, string> }> };
		expect(body.cards).toHaveLength(5);
		// Should be cards 6-10 (ordered by due ASC)
		expect(body.cards[0].fields.Front).toBe("5");
	});

	it("GET /api/review/due defaults to limit 50 (no query)", async () => {
		const res = await makeApp().fetch(new Request("http://localhost/api/review/due"), env);
		expect(res.status).toBe(200);
		// parseLimit without explicit limit returns the default which is now 50.
		// No assertion on card count — just verify no error.
		const body = (await res.json()) as { cards: unknown[] };
		expect(Array.isArray(body.cards)).toBe(true);
	});

	it("GET /api/review/due?limit=250 clamps to 200", async () => {
		const now = Date.now();
		for (let i = 0; i < 250; i++) {
			const ni = `note-clamp-${i}`;
			const ci = `card-clamp-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		const highLimitEnv = Object.assign(Object.create(Object.getPrototypeOf(env)), env, {
			NEW_CARDS_PER_DAY: "300",
			REVIEWS_PER_DAY: "300",
		}) as typeof env;
		const res = await makeApp().fetch(
			new Request("http://localhost/api/review/due?limit=250"),
			highLimitEnv,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[] };
		expect(body.cards).toHaveLength(200);
	});

	it("daily limit: 30 new cards with default newPerDay=20 returns only 20", async () => {
		const now = Date.now();
		for (let i = 0; i < 30; i++) {
			const ni = `note-newlim-${i}`;
			const ci = `card-newlim-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		const res = await makeApp().fetch(new Request("http://localhost/api/review/due?limit=50"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[] };
		expect(body.cards).toHaveLength(20);
	});

	it("daily limit: after reviewing 10 new cards today, only 10 more returned", async () => {
		const now = Date.now();
		for (let i = 0; i < 30; i++) {
			const ni = `note-partial-${i}`;
			const ci = `card-partial-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		// Seed 10 revlog entries for today with state=0 (new card reviews)
		for (let i = 0; i < 10; i++) {
			await env.DB.prepare(
				"INSERT INTO revlog (id, user_id, card_id, rating, state, due, stability, difficulty, " +
					"elapsed_days, scheduled_days, review_time, created_at) " +
					"VALUES (?, 'local', ?, 3, 0, ?, 1, 5, 0, 0, ?, ?)",
			)
				.bind(`revlog-partial-${i}`, `card-partial-${i}`, now + i, now, now)
				.run();
		}

		const res = await makeApp().fetch(new Request("http://localhost/api/review/due?limit=50"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[] };
		expect(body.cards).toHaveLength(10);
	});

	it("daily limit: 150 due review cards with reviewsPerDay=100 returns only 100", async () => {
		const now = Date.now();
		for (let i = 0; i < 150; i++) {
			const ni = `note-revlim-${i}`;
			const ci = `card-revlim-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, {
				state: 2,
				due: now - 1000 + i,
				reps: 1,
				stability: 5,
				difficulty: 5,
			});
		}

		const res = await makeApp().fetch(
			new Request("http://localhost/api/review/due?limit=200"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[] };
		expect(body.cards).toHaveLength(100);
	});

	it("GET /api/review/due returns total count of due cards", async () => {
		const now = Date.now();
		for (let i = 0; i < 5; i++) {
			const ni = `note-total-${i}`;
			const ci = `card-total-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		const res = await makeApp().fetch(new Request("http://localhost/api/review/due?limit=3"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[]; total: number };
		expect(body.cards).toHaveLength(3);
		expect(body.total).toBe(5);
	});

	it("GET /api/review/due?deck=Nonexistent returns empty cards and total 0", async () => {
		const res = await makeApp().fetch(
			new Request("http://localhost/api/review/due?deck=Nonexistent"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[]; total: number };
		expect(body.cards).toHaveLength(0);
		expect(body.total).toBe(0);
	});

	it("GET /api/review/due total decreases after marking a card familiar", async () => {
		const now = Date.now();
		for (let i = 0; i < 3; i++) {
			const ni = `note-fam-total-${i}`;
			const ci = `card-fam-total-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		const before = await makeApp().fetch(new Request("http://localhost/api/review/due"), env);
		const beforeBody = (await before.json()) as { cards: unknown[]; total: number };
		expect(beforeBody.total).toBe(3);

		await makeApp().fetch(
			postJson("http://localhost/api/review/familiar", { noteId: "note-fam-total-0" }),
			env,
		);

		const after = await makeApp().fetch(new Request("http://localhost/api/review/due"), env);
		const afterBody = (await after.json()) as { cards: unknown[]; total: number };
		expect(afterBody.total).toBe(2);
	});

	it("daily limit: custom env NEW_CARDS_PER_DAY=5 limits new cards to 5", async () => {
		const now = Date.now();
		for (let i = 0; i < 10; i++) {
			const ni = `note-custom-${i}`;
			const ci = `card-custom-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		const customEnv = Object.assign(Object.create(Object.getPrototypeOf(env)), env, {
			NEW_CARDS_PER_DAY: "5",
		}) as typeof env;
		const res = await makeApp().fetch(
			new Request("http://localhost/api/review/due?limit=50"),
			customEnv,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[] };
		expect(body.cards).toHaveLength(5);
	});

	it("daily limit: total is capped by remaining daily limit", async () => {
		const now = Date.now();
		for (let i = 0; i < 10; i++) {
			const ni = `note-total-limit-${i}`;
			const ci = `card-total-limit-${i}`;
			await seedNote(ni, { fields: { Front: String(i), Back: `B${i}` } });
			await seedCard(ci, ni, { state: 0, due: now + i });
		}

		const customEnv = Object.assign(Object.create(Object.getPrototypeOf(env)), env, {
			NEW_CARDS_PER_DAY: "5",
		}) as typeof env;
		const res = await makeApp().fetch(
			new Request("http://localhost/api/review/due?limit=50"),
			customEnv,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { cards: unknown[]; total: number };
		expect(body.cards).toHaveLength(5);
		expect(body.total).toBe(5);
	});
});
