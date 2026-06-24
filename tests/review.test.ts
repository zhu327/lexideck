import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, accessAuthMiddleware } from "../src/auth/access";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";
import { createReviewApp } from "../src/review/router";

const DECK = "deck-default-local";
const MODEL = "model-basic-local";

// Mount the review app behind the auth middleware exactly like a real caller.
function makeApp() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", accessAuthMiddleware());
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

	it("POST /api/review/familiar with unknown noteId returns 404", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/review/familiar", { noteId: "nope" }),
			env,
		);
		expect(res.status).toBe(404);
	});
});
