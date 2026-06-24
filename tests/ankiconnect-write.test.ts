import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createAnkiconnectApp } from "../src/ankiconnect/router";
import { type AuthUser, accessAuthMiddleware } from "../src/auth/access";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";

// Mount the ankiconnect sub-app behind the auth middleware exactly like a real
// caller. DEV=1 -> auth bypass -> local user (userId "local").
function app() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", accessAuthMiddleware());
	a.route("/", createAnkiconnectApp({ db: createDbClient(env.DB) }));
	return a;
}

async function post(action: string, params: unknown = {}) {
	return app().fetch(
		new Request("http://localhost/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action, version: 6, params }),
		}),
		env,
	);
}

// A Basic note targeting the seeded Default deck / Basic model.
function note(fields: Record<string, string>, extra: Record<string, unknown> = {}) {
	return { deckName: "Default", modelName: "Basic", fields, tags: [], ...extra };
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM cards").run();
	await env.DB.prepare("DELETE FROM notes").run();
});

describe("ankiconnect write actions", () => {
	it("addNote creates a note and a New(0) card with due≈now", async () => {
		const t0 = Date.now();
		const res = await post("addNote", { note: note({ Front: "cat", Back: "猫" }) });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { result: string | null; error: string | null };
		expect(body.error).toBeNull();
		expect(typeof body.result).toBe("string");
		const noteId = body.result as string;

		const card = await env.DB.prepare("SELECT state, due FROM cards WHERE note_id = ?")
			.bind(noteId)
			.first<{ state: number; due: number }>();
		expect(card).not.toBeNull();
		expect(card?.state).toBe(0);
		expect(Math.abs((card?.due ?? 0) - t0)).toBeLessThan(60_000);
	});

	it("addNote with audio/video/picture arrays still succeeds with no error", async () => {
		const res = await post("addNote", {
			note: note(
				{ Front: "with-media", Back: "x" },
				{
					audio: [{ url: "https://example.com/a.mp3", filename: "a.mp3", fields: ["Front"] }],
					video: [{ url: "https://example.com/v.mp4", filename: "v.mp4" }],
					picture: [{ url: "https://example.com/p.png", filename: "p.png", fields: ["Back"] }],
				},
			),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { result: string | null; error: string | null };
		expect(body.error).toBeNull();
		expect(typeof body.result).toBe("string");
	});

	it("addNote unknown deck returns error containing 'deck'", async () => {
		const res = await post("addNote", {
			note: { deckName: "Nope", modelName: "Basic", fields: { Front: "x", Back: "y" } },
		});
		const body = (await res.json()) as { result: null; error: string };
		expect(body.result).toBeNull();
		expect(body.error).toContain("deck");
	});

	it("addNote unknown model returns error containing 'model'", async () => {
		const res = await post("addNote", {
			note: { deckName: "Default", modelName: "Nope", fields: { Front: "x", Back: "y" } },
		});
		const body = (await res.json()) as { result: null; error: string };
		expect(body.result).toBeNull();
		expect(body.error).toContain("model");
	});

	it("addNote duplicate (default allowDuplicate:false) is rejected; allowDuplicate:true succeeds", async () => {
		const first = await post("addNote", { note: note({ Front: "dup", Back: "d" }) });
		const firstBody = (await first.json()) as { result: string | null; error: string | null };
		expect(firstBody.error).toBeNull();
		expect(typeof firstBody.result).toBe("string");

		const dup = await post("addNote", { note: note({ Front: "dup", Back: "d" }) });
		expect(await dup.json()).toEqual({ result: null, error: "duplicate" });

		const allow = await post("addNote", {
			note: note({ Front: "dup", Back: "d" }),
			options: { allowDuplicate: true },
		});
		const allowBody = (await allow.json()) as { result: string | null; error: string | null };
		expect(allowBody.error).toBeNull();
		expect(typeof allowBody.result).toBe("string");
	});

	it("canAddNotes returns [true, false] for one new and one duplicate note", async () => {
		await post("addNote", { note: note({ Front: "exists", Back: "e" }) });
		const res = await post("canAddNotes", {
			notes: [note({ Front: "fresh", Back: "f" }), note({ Front: "exists", Back: "e" })],
		});
		const body = (await res.json()) as { result: boolean[]; error: string | null };
		expect(body.error).toBeNull();
		expect(body.result).toEqual([true, false]);
	});

	it("canAddNotes result length matches input length", async () => {
		const res = await post("canAddNotes", {
			notes: [note({ Front: "a", Back: "a" }), note({ Front: "b", Back: "b" })],
		});
		const body = (await res.json()) as { result: boolean[] };
		expect(body.result).toHaveLength(2);
	});

	it("findNotes deck:Default includes the added noteId", async () => {
		const add = await post("addNote", { note: note({ Front: "cat", Back: "猫" }) });
		const noteId = ((await add.json()) as { result: string }).result;

		const res = await post("findNotes", { query: "deck:Default" });
		const body = (await res.json()) as { result: string[] };
		expect(body.result).toContain(noteId);
	});

	it("findNotes Front:cat includes the added noteId", async () => {
		const add = await post("addNote", { note: note({ Front: "cat", Back: "猫" }) });
		const noteId = ((await add.json()) as { result: string }).result;

		const res = await post("findNotes", { query: "Front:cat" });
		const body = (await res.json()) as { result: string[] };
		expect(body.result).toContain(noteId);
	});

	it("findNotes Front:nope returns an empty array", async () => {
		await post("addNote", { note: note({ Front: "cat", Back: "猫" }) });
		const res = await post("findNotes", { query: "Front:nope" });
		const body = (await res.json()) as { result: string[] };
		expect(body.result).toEqual([]);
	});

	it("findNotes with a malformed query returns an empty array", async () => {
		await post("addNote", { note: note({ Front: "cat", Back: "猫" }) });
		const res = await post("findNotes", { query: "gibberish" });
		const body = (await res.json()) as { result: string[] };
		expect(body.result).toEqual([]);
	});
});
