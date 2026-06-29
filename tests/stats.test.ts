import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";
import { createStatsApp } from "../src/stats/router";

const DECK = "deck-default-local";
const MODEL = "model-basic-local";

function makeApp() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth());
	a.route("/api/stats", createStatsApp({ db: createDbClient(env.DB) }));
	return a;
}

async function seedNote(id: string) {
	const fields = JSON.stringify({ Front: id, Back: id });
	const tags = JSON.stringify([]);
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at) " +
			"VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(id, DECK, MODEL, fields, tags, id, now, now)
		.run();
}

async function seedCard(id: string, noteId: string, state: number) {
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO cards (id, user_id, note_id, deck_id, template_ord, due, stability, difficulty, " +
			"elapsed_days, scheduled_days, reps, lapses, state, last_review, created_at) " +
			"VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(id, noteId, DECK, 0, now, 0, 0, 0, 0, 0, 0, state, null, now)
		.run();
}

async function seedRevlog(id: string, cardId: string, rating: number, reviewTime: number) {
	await env.DB.prepare(
		"INSERT INTO revlog (id, user_id, card_id, rating, state, due, stability, difficulty, " +
			"elapsed_days, scheduled_days, review_time, created_at) " +
			"VALUES (?, 'local', ?, ?, 0, ?, 1, 5, 0, 0, ?, ?)",
	)
		.bind(id, cardId, rating, reviewTime, reviewTime, reviewTime)
		.run();
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM revlog").run();
	await env.DB.prepare("DELETE FROM cards").run();
	await env.DB.prepare("DELETE FROM notes").run();
});

describe("stats API", () => {
	it("returns zeroes and null retention when no reviews exist", async () => {
		await seedNote("note-s1");
		await seedCard("card-s1", "note-s1", 0);

		const res = await makeApp().fetch(new Request("http://localhost/api/stats/summary"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			todayReviews: number;
			totalCards: number;
			newCards: number;
			learningCards: number;
			reviewCards: number;
			streak: number;
			todayRetention: number | null;
		};
		expect(body.todayReviews).toBe(0);
		expect(body.streak).toBe(0);
		expect(body.todayRetention).toBeNull();
		expect(body.totalCards).toBe(1);
		expect(body.newCards).toBe(1);
	});

	it("returns correct counts with seeded revlog entries", async () => {
		await seedNote("note-s2");
		await seedCard("card-s2", "note-s2", 0);
		const now = Date.now();

		await seedRevlog("rev-s2-1", "card-s2", 3, now);
		await seedRevlog("rev-s2-2", "card-s2", 3, now + 1000);
		await seedRevlog("rev-s2-3", "card-s2", 1, now + 2000);

		const res = await makeApp().fetch(new Request("http://localhost/api/stats/summary"), env);
		const body = (await res.json()) as { todayReviews: number; todayRetention: number | null };
		expect(body.todayReviews).toBe(3);
		// 2 out of 3 have rating >= 2
		expect(body.todayRetention).toBeCloseTo(2 / 3, 5);
	});

	it("counts streak for 3 consecutive days", async () => {
		await seedNote("note-s3");
		await seedCard("card-s3", "note-s3", 2);
		const now = Date.now();
		const todayStart = now - (now % 86_400_000);

		// Today
		await seedRevlog("rev-s3-today", "card-s3", 3, todayStart + 1000);
		// Yesterday
		await seedRevlog("rev-s3-yesterday", "card-s3", 3, todayStart - 86_400_000 + 1000);
		// Day before yesterday
		await seedRevlog("rev-s3-2days", "card-s3", 3, todayStart - 2 * 86_400_000 + 1000);

		const res = await makeApp().fetch(new Request("http://localhost/api/stats/summary"), env);
		const body = (await res.json()) as { streak: number };
		expect(body.streak).toBe(3);
	});

	it("calculates retention: 4 reviews [1,3,3,4] -> 0.75", async () => {
		await seedNote("note-s4");
		await seedCard("card-s4", "note-s4", 0);
		const now = Date.now();
		const ratings = [1, 3, 3, 4];
		for (let i = 0; i < ratings.length; i++) {
			await seedRevlog(`rev-s4-${i}`, "card-s4", ratings[i], now + i * 1000);
		}

		const res = await makeApp().fetch(new Request("http://localhost/api/stats/summary"), env);
		const body = (await res.json()) as { todayRetention: number | null; todayReviews: number };
		expect(body.todayReviews).toBe(4);
		expect(body.todayRetention).toBeCloseTo(0.75, 5);
	});

	it("card state counts match seeded data", async () => {
		// 2 new, 1 learning, 2 review
		for (let i = 0; i < 2; i++) {
			await seedNote(`note-new-${i}`);
			await seedCard(`card-new-${i}`, `note-new-${i}`, 0);
		}
		await seedNote("note-learn");
		await seedCard("card-learn", "note-learn", 1);
		for (let i = 0; i < 2; i++) {
			await seedNote(`note-rev-${i}`);
			await seedCard(`card-rev-${i}`, `note-rev-${i}`, 2);
		}

		const res = await makeApp().fetch(new Request("http://localhost/api/stats/summary"), env);
		const body = (await res.json()) as {
			totalCards: number;
			newCards: number;
			learningCards: number;
			reviewCards: number;
		};
		expect(body.totalCards).toBe(5);
		expect(body.newCards).toBe(2);
		expect(body.learningCards).toBe(1);
		expect(body.reviewCards).toBe(2);
	});
});
