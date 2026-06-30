import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";
import { createNotesApp } from "../src/notes/router";

const DECK = "deck-default-local";
const MODEL = "model-basic-local";

function makeApp() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth());
	a.route("/api", createNotesApp({ db: createDbClient(env.DB) }));
	return a;
}

async function seedNote(
	id: string,
	opts: { fields?: Record<string, string>; tags?: string[]; deckId?: string } = {},
) {
	const fields = JSON.stringify(opts.fields ?? { Front: "Hello", Back: "World" });
	const tags = JSON.stringify(opts.tags ?? []);
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at) " +
			"VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(id, opts.deckId ?? DECK, MODEL, fields, tags, id, now, now)
		.run();
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM cards").run();
	await env.DB.prepare("DELETE FROM notes").run();
});

describe("notes search API", () => {
	it("GET /api/notes/search with matching query returns matching notes", async () => {
		await seedNote("note-cat", { fields: { Front: "cat", Back: "猫" } });
		await seedNote("note-dog", { fields: { Front: "dog", Back: "犬" } });

		const res = await makeApp().fetch(new Request("http://localhost/api/notes/search?q=cat"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			notes: Array<{ noteId: string; fields: Record<string, string>; deckName: string }>;
			total: number;
		};
		expect(body.total).toBe(1);
		expect(body.notes).toHaveLength(1);
		expect(body.notes[0].noteId).toBe("note-cat");
		expect(body.notes[0].fields.Front).toBe("cat");
		expect(body.notes[0].deckName).toBe("Default");
	});

	it("GET /api/notes/search with no match returns empty", async () => {
		await seedNote("note-cat", { fields: { Front: "cat", Back: "猫" } });

		const res = await makeApp().fetch(new Request("http://localhost/api/notes/search?q=xyz"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { notes: unknown[]; total: number };
		expect(body.total).toBe(0);
		expect(body.notes).toHaveLength(0);
	});

	it("GET /api/notes/search with empty query returns all notes", async () => {
		await seedNote("note-a", { fields: { Front: "A", Back: "AA" } });
		await seedNote("note-b", { fields: { Front: "B", Back: "BB" } });
		await seedNote("note-c", { fields: { Front: "C", Back: "CC" } });

		const res = await makeApp().fetch(new Request("http://localhost/api/notes/search"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { notes: unknown[]; total: number };
		expect(body.total).toBe(3);
		expect(body.notes).toHaveLength(3);
	});

	it("GET /api/notes/search limit/offset paginates correctly", async () => {
		for (let i = 0; i < 5; i++) {
			await seedNote(`note-page-${i}`, {
				fields: { Front: `word-${i}`, Back: `B${i}` },
			});
		}

		const res1 = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?limit=2&offset=0"),
			env,
		);
		expect(res1.status).toBe(200);
		const body1 = (await res1.json()) as {
			notes: Array<{ noteId: string }>;
			total: number;
		};
		expect(body1.total).toBe(5);
		expect(body1.notes).toHaveLength(2);

		const res2 = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?limit=2&offset=2"),
			env,
		);
		const body2 = (await res2.json()) as { notes: Array<{ noteId: string }> };
		expect(body2.notes).toHaveLength(2);
		// Ensure no overlap with first page
		const page1Ids = body1.notes.map((n) => n.noteId);
		const page2Ids = body2.notes.map((n) => n.noteId);
		for (const id of page2Ids) {
			expect(page1Ids).not.toContain(id);
		}

		const res3 = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?limit=2&offset=4"),
			env,
		);
		const body3 = (await res3.json()) as { notes: Array<{ noteId: string }> };
		expect(body3.notes).toHaveLength(1);
	});

	it("GET /api/notes/search total count is accurate with query", async () => {
		for (let i = 0; i < 7; i++) {
			await seedNote(`note-match-${i}`, {
				fields: { Front: `apple-${i}`, Back: `B${i}` },
			});
		}
		await seedNote("note-nomatch", { fields: { Front: "banana", Back: "B" } });

		const res = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?q=apple&limit=3"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { notes: unknown[]; total: number };
		expect(body.notes).toHaveLength(3);
		expect(body.total).toBe(7);
	});

	it("GET /api/notes/search searches across field values (Back field)", async () => {
		await seedNote("note-jp", { fields: { Front: "cat", Back: "猫" } });
		await seedNote("note-en", { fields: { Front: "dog", Back: "犬" } });

		const res = await makeApp().fetch(new Request("http://localhost/api/notes/search?q=猫"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { notes: Array<{ noteId: string }>; total: number };
		expect(body.total).toBe(1);
		expect(body.notes[0].noteId).toBe("note-jp");
	});

	it("GET /api/notes/search returns known: false for note without known tag", async () => {
		await seedNote("note-unknown", { fields: { Front: "apple", Back: "苹果" } });

		const res = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?q=apple"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			notes: Array<{ noteId: string; known: boolean }>;
		};
		expect(body.notes).toHaveLength(1);
		expect(body.notes[0].known).toBe(false);
	});

	it("GET /api/notes/search returns known: true for note with known tag", async () => {
		await seedNote("note-known", {
			fields: { Front: "banana", Back: "香蕉" },
			tags: ["known"],
		});

		const res = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?q=banana"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			notes: Array<{ noteId: string; known: boolean }>;
		};
		expect(body.notes).toHaveLength(1);
		expect(body.notes[0].known).toBe(true);
	});

	it("GET /api/notes/search known state changes after mark/unmark familiar", async () => {
		await seedNote("note-toggle", { fields: { Front: "cherry", Back: "樱桃" } });

		// Initially not known
		const res1 = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?q=cherry"),
			env,
		);
		const body1 = (await res1.json()) as {
			notes: Array<{ known: boolean }>;
		};
		expect(body1.notes[0].known).toBe(false);

		// Mark familiar via review API — directly update tags like the familiar route does
		await env.DB.prepare("UPDATE notes SET tags = ? WHERE id = 'note-toggle'")
			.bind(JSON.stringify(["known"]))
			.run();

		const res2 = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?q=cherry"),
			env,
		);
		const body2 = (await res2.json()) as {
			notes: Array<{ known: boolean }>;
		};
		expect(body2.notes[0].known).toBe(true);

		// Unmark familiar — remove the known tag
		await env.DB.prepare("UPDATE notes SET tags = ? WHERE id = 'note-toggle'")
			.bind(JSON.stringify([]))
			.run();

		const res3 = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?q=cherry"),
			env,
		);
		const body3 = (await res3.json()) as {
			notes: Array<{ known: boolean }>;
		};
		expect(body3.notes[0].known).toBe(false);
	});

	it("GET /api/notes/search returns tags", async () => {
		await seedNote("note-tagged", {
			fields: { Front: "hello", Back: "你好" },
			tags: ["known", "hsk1"],
		});

		const res = await makeApp().fetch(
			new Request("http://localhost/api/notes/search?q=hello"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			notes: Array<{ tags: string[] }>;
		};
		expect(body.notes[0].tags).toEqual(["known", "hsk1"]);
	});
});
