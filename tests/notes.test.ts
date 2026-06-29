import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";
import { createNotesApp } from "../src/notes/router";

// Mount the notes app behind the auth middleware exactly like a real caller.
function makeApp() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth());
	a.route("/api", createNotesApp({ db: createDbClient(env.DB) }));
	return a;
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

describe("notes API", () => {
	it("POST /api/notes with valid body returns 200 with ankiId and noteId", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/notes", {
				deckName: "Default",
				modelName: "Basic",
				fields: { Front: "apple", Back: "a fruit" },
				tags: ["fruit"],
			}),
			env,
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { ankiId: number; noteId: string };
		expect(typeof body.ankiId).toBe("number");
		expect(typeof body.noteId).toBe("string");

		// Verify note was created in DB
		const note = await env.DB.prepare("SELECT id, fields, tags FROM notes WHERE id = ?")
			.bind(body.noteId)
			.first<{ id: string; fields: string; tags: string }>();
		expect(note).not.toBeNull();
		if (!note) throw new Error("note should exist");
		expect(JSON.parse(note.fields)).toEqual({ Front: "apple", Back: "a fruit" });
		expect(JSON.parse(note.tags)).toEqual(["fruit"]);

		// Verify card was created
		const card = await env.DB.prepare("SELECT id FROM cards WHERE note_id = ?")
			.bind(body.noteId)
			.first();
		expect(card).not.toBeNull();
	});

	it("POST /api/notes duplicate returns 409", async () => {
		const body = {
			deckName: "Default",
			modelName: "Basic",
			fields: { Front: "banana", Back: "a yellow fruit" },
		};

		const res1 = await makeApp().fetch(postJson("http://localhost/api/notes", body), env);
		expect(res1.status).toBe(200);

		const res2 = await makeApp().fetch(postJson("http://localhost/api/notes", body), env);
		expect(res2.status).toBe(409);
		const err = (await res2.json()) as { error: string };
		expect(err.error).toBe("duplicate");
	});

	it("POST /api/notes with missing deck returns 404", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/notes", {
				deckName: "NonExistent",
				modelName: "Basic",
				fields: { Front: "x", Back: "y" },
			}),
			env,
		);
		expect(res.status).toBe(404);
		const err = (await res.json()) as { error: string };
		expect(err.error).toBe("deck not found");
	});

	it("POST /api/notes with missing modelName returns 400", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/notes", {
				deckName: "Default",
				fields: { Front: "x", Back: "y" },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const err = (await res.json()) as { error: string };
		expect(err.error).toBe("deckName and modelName required");
	});

	it("POST /api/notes with missing model returns 404", async () => {
		const res = await makeApp().fetch(
			postJson("http://localhost/api/notes", {
				deckName: "Default",
				modelName: "NonExistent",
				fields: { Front: "x", Back: "y" },
			}),
			env,
		);
		expect(res.status).toBe(404);
		const err = (await res.json()) as { error: string };
		expect(err.error).toBe("model not found");
	});

	it("GET /api/decks returns list of deck names", async () => {
		const res = await makeApp().fetch(new Request("http://localhost/api/decks"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { decks: string[] };
		expect(body.decks).toContain("Default");
	});

	it("GET /api/models returns list of model names", async () => {
		const res = await makeApp().fetch(new Request("http://localhost/api/models"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { models: string[] };
		expect(body.models).toContain("Basic");
	});

	it("GET /api/models/:name/fields returns field names for a model", async () => {
		const res = await makeApp().fetch(new Request("http://localhost/api/models/Basic/fields"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { fields: string[] };
		expect(body.fields).toEqual(["Front", "Back"]);
	});

	it("GET /api/models/:name/fields for unknown model returns 404", async () => {
		const res = await makeApp().fetch(new Request("http://localhost/api/models/Nope/fields"), env);
		expect(res.status).toBe(404);
	});
});
