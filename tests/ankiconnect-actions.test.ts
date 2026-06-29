import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createAnkiconnectApp } from "../src/ankiconnect/router";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";

function app() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth());
	a.route("/", createAnkiconnectApp({ db: createDbClient(env.DB) }));
	return a;
}

async function post(action: string, params: unknown = {}, version = 6) {
	return app().fetch(
		new Request("http://localhost/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action, version, params }),
		}),
		env,
	);
}

function note(fields: Record<string, string>, extra: Record<string, unknown> = {}) {
	return { deckName: "Default", modelName: "Basic", fields, tags: [], ...extra };
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM cards").run();
	await env.DB.prepare("DELETE FROM notes").run();
});

describe("ankiconnect new actions", () => {
	describe("canAddNotesWithErrorDetail", () => {
		it("returns canAdd:true for a fresh note", async () => {
			const res = await post("canAddNotesWithErrorDetail", {
				notes: [note({ Front: "fresh", Back: "f" })],
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<{ canAdd: boolean; error: string | null }>;
				error: string | null;
			};
			expect(body.error).toBeNull();
			expect(body.result).toHaveLength(1);
			expect(body.result[0]).toEqual({ canAdd: true, error: null });
		});

		it("returns canAdd:false with duplicate error for an existing note", async () => {
			await post("addNote", { note: note({ Front: "dup", Back: "d" }) });
			const res = await post("canAddNotesWithErrorDetail", {
				notes: [note({ Front: "dup", Back: "d" })],
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<{ canAdd: boolean; error: string | null }>;
				error: string | null;
			};
			expect(body.error).toBeNull();
			expect(body.result).toHaveLength(1);
			expect(body.result[0].canAdd).toBe(false);
			expect(body.result[0].error).toBe("cannot create note because it is a duplicate");
		});

		it("returns canAdd:false with deck not found for unknown deck", async () => {
			const res = await post("canAddNotesWithErrorDetail", {
				notes: [
					{
						deckName: "Nope",
						modelName: "Basic",
						fields: { Front: "x", Back: "y" },
					},
				],
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<{ canAdd: boolean; error: string | null }>;
				error: string | null;
			};
			expect(body.result).toHaveLength(1);
			expect(body.result[0].canAdd).toBe(false);
			expect(body.result[0].error).toContain("deck not found");
		});

		it("returns canAdd:false with model not found for unknown model", async () => {
			const res = await post("canAddNotesWithErrorDetail", {
				notes: [
					{
						deckName: "Default",
						modelName: "Nope",
						fields: { Front: "x", Back: "y" },
					},
				],
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<{ canAdd: boolean; error: string | null }>;
				error: string | null;
			};
			expect(body.result).toHaveLength(1);
			expect(body.result[0].canAdd).toBe(false);
			expect(body.result[0].error).toContain("model not found");
		});

		it("returns mixed results for multiple notes", async () => {
			await post("addNote", { note: note({ Front: "exists", Back: "e" }) });
			const res = await post("canAddNotesWithErrorDetail", {
				notes: [note({ Front: "fresh", Back: "f" }), note({ Front: "exists", Back: "e" })],
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<{ canAdd: boolean; error: string | null }>;
				error: string | null;
			};
			expect(body.result).toHaveLength(2);
			expect(body.result[0]).toEqual({ canAdd: true, error: null });
			expect(body.result[1]).toEqual({
				canAdd: false,
				error: "cannot create note because it is a duplicate",
			});
		});
	});

	describe("apiReflect", () => {
		it("returns scopes and actions arrays", async () => {
			const res = await post("apiReflect");
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: { scopes: string[]; actions: string[] };
				error: string | null;
			};
			expect(body.error).toBeNull();
			expect(body.result.scopes).toEqual(["actions"]);
			expect(Array.isArray(body.result.actions)).toBe(true);
			expect(body.result.actions.length).toBeGreaterThan(0);
		});

		it("includes all supported action names", async () => {
			const res = await post("apiReflect");
			const body = (await res.json()) as {
				result: { actions: string[] };
			};
			const actions = body.result.actions;
			expect(actions).toContain("version");
			expect(actions).toContain("deckNames");
			expect(actions).toContain("modelNames");
			expect(actions).toContain("modelFieldNames");
			expect(actions).toContain("modelTemplates");
			expect(actions).toContain("modelStyling");
			expect(actions).toContain("addNote");
			expect(actions).toContain("canAddNotes");
			expect(actions).toContain("canAddNotesWithErrorDetail");
			expect(actions).toContain("findNotes");
			expect(actions).toContain("notesInfo");
			expect(actions).toContain("findCards");
			expect(actions).toContain("guiBrowse");
		});
	});

	describe("notesInfo", () => {
		it("returns note info for a valid anki note id", async () => {
			const add = await post("addNote", { note: note({ Front: "hello", Back: "world" }) });
			const ankiId = ((await add.json()) as { result: number }).result;

			const res = await post("notesInfo", { notes: [ankiId] });
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<{
					noteId: number;
					modelName: string;
					tags: string[];
					fields: Record<string, { value: string; order: number }>;
					cards: number[];
				}>;
				error: string | null;
			};
			expect(body.error).toBeNull();
			expect(body.result).toHaveLength(1);
			const info = body.result[0];
			expect(info.noteId).toBe(ankiId);
			expect(info.modelName).toBe("Basic");
			expect(info.tags).toEqual([]);
			expect(info.fields).toHaveProperty("Front");
			expect(info.fields).toHaveProperty("Back");
			expect(info.fields.Front.value).toBe("hello");
			expect(info.fields.Front.order).toBe(0);
			expect(info.fields.Back.value).toBe("world");
			expect(info.fields.Back.order).toBe(1);
			expect(Array.isArray(info.cards)).toBe(true);
			expect(info.cards.length).toBeGreaterThan(0);
		});

		it("returns null for a nonexistent anki note id", async () => {
			const res = await post("notesInfo", { notes: [999999999] });
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<unknown>;
				error: string | null;
			};
			expect(body.error).toBeNull();
			expect(body.result).toHaveLength(1);
			expect(body.result[0]).toBeNull();
		});

		it("returns mixed results for valid and invalid ids", async () => {
			const add = await post("addNote", { note: note({ Front: "a", Back: "b" }) });
			const ankiId = ((await add.json()) as { result: number }).result;

			const res = await post("notesInfo", { notes: [ankiId, 999999999] });
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				result: Array<unknown>;
				error: string | null;
			};
			expect(body.result).toHaveLength(2);
			expect(body.result[0]).not.toBeNull();
			expect(body.result[1]).toBeNull();
		});
	});

	describe("findCards", () => {
		it("returns card anki_ids for nid:<ankiNoteId>", async () => {
			const add = await post("addNote", { note: note({ Front: "card-test", Back: "ct" }) });
			const ankiId = ((await add.json()) as { result: number }).result;

			const res = await post("findCards", { query: `nid:${ankiId}` });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(Array.isArray(body.result)).toBe(true);
			expect(body.result.length).toBeGreaterThan(0);
			// All returned ids should be numbers
			for (const id of body.result) {
				expect(typeof id).toBe("number");
			}
		});

		it("returns card anki_ids for deck:Default", async () => {
			await post("addNote", { note: note({ Front: "deck-test", Back: "dt" }) });

			const res = await post("findCards", { query: "deck:Default" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(Array.isArray(body.result)).toBe(true);
			expect(body.result.length).toBeGreaterThan(0);
		});

		it("returns empty array for nonexistent nid", async () => {
			const res = await post("findCards", { query: "nid:999999999" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(body.result).toEqual([]);
		});

		it("returns empty array for nonexistent deck", async () => {
			const res = await post("findCards", { query: "deck:Nope" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(body.result).toEqual([]);
		});

		it("returns empty array for malformed query", async () => {
			const res = await post("findCards", { query: "gibberish" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(body.result).toEqual([]);
		});
	});

	describe("guiBrowse", () => {
		it("returns same result as findCards for nid: query", async () => {
			const add = await post("addNote", { note: note({ Front: "gui-test", Back: "gt" }) });
			const ankiId = ((await add.json()) as { result: number }).result;

			const [findRes, browseRes] = await Promise.all([
				post("findCards", { query: `nid:${ankiId}` }),
				post("guiBrowse", { query: `nid:${ankiId}` }),
			]);

			const findBody = (await findRes.json()) as { result: number[] };
			const browseBody = (await browseRes.json()) as { result: number[] };
			expect(browseBody.result).toEqual(findBody.result);
		});

		it("returns same result as findCards for deck: query", async () => {
			await post("addNote", { note: note({ Front: "gui-deck", Back: "gd" }) });

			const [findRes, browseRes] = await Promise.all([
				post("findCards", { query: "deck:Default" }),
				post("guiBrowse", { query: "deck:Default" }),
			]);

			const findBody = (await findRes.json()) as { result: number[] };
			const browseBody = (await browseRes.json()) as { result: number[] };
			expect(browseBody.result).toEqual(findBody.result);
		});
	});

	describe("findNotes query improvements", () => {
		it("supports quoted tokens (Yomitan format): 'deck:Default' 'front:cat'", async () => {
			const add = await post("addNote", { note: note({ Front: "cat", Back: "猫" }) });
			const ankiId = ((await add.json()) as { result: number }).result;

			const res = await post("findNotes", {
				query: '"deck:Default" "front:cat"',
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(body.result).toContain(ankiId);
		});

		it("resolves field key case-insensitively (front -> Front)", async () => {
			const add = await post("addNote", { note: note({ Front: "dog", Back: "犬" }) });
			const ankiId = ((await add.json()) as { result: number }).result;

			const res = await post("findNotes", { query: "front:dog" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(body.result).toContain(ankiId);
		});

		it("returns number[] (not string[])", async () => {
			await post("addNote", { note: note({ Front: "type-test", Back: "tt" }) });

			const res = await post("findNotes", { query: "deck:Default" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(Array.isArray(body.result)).toBe(true);
			if (body.result.length > 0) {
				expect(typeof body.result[0]).toBe("number");
			}
		});

		it("returns empty array for nonexistent deck", async () => {
			const res = await post("findNotes", { query: "deck:Nope" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { result: number[]; error: string | null };
			expect(body.error).toBeNull();
			expect(body.result).toEqual([]);
		});
	});
});
