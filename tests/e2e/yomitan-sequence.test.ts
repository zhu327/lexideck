import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// === version:6 helper (wrapped {result, error}) ===

interface AnkiResponse {
	result: unknown;
	error: string | null;
}

interface AnkiResult {
	status: number;
	headers: Headers;
	body: AnkiResponse;
}

async function anki(action: string, params: unknown = {}): Promise<AnkiResult> {
	const res = await SELF.fetch("http://localhost/ankiconnect", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action, version: 6, params }),
	});
	return { status: res.status, headers: res.headers, body: (await res.json()) as AnkiResponse };
}

// === version:2 helper (bare result — null on error) ===

async function ankiV2(action: string, params: unknown = {}): Promise<unknown> {
	const res = await SELF.fetch("http://localhost/ankiconnect", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action, version: 2, params }),
	});
	return await res.json();
}

// =============================================================================
// version:2 — real wire protocol (bare results, no {result, error} wrapper)
// =============================================================================

describe("Yomitan connection sequence (version:2 — real wire protocol)", () => {
	it("version returns 6 (server version, not client version)", async () => {
		const result = await ankiV2("version");
		expect(result).toBe(6);
	});

	it("deckNames includes Default", async () => {
		const result = await ankiV2("deckNames");
		expect(Array.isArray(result)).toBe(true);
		expect(result as string[]).toContain("Default");
	});

	it("modelNames includes Basic", async () => {
		const result = await ankiV2("modelNames");
		expect(Array.isArray(result)).toBe(true);
		expect(result as string[]).toContain("Basic");
	});

	it("modelFieldNames for Basic returns Front/Back", async () => {
		const result = await ankiV2("modelFieldNames", { modelName: "Basic" });
		expect(result).toEqual(["Front", "Back"]);
	});

	it("modelTemplates for Basic returns Card 1 with Front/Back", async () => {
		const result = (await ankiV2("modelTemplates", { modelName: "Basic" })) as Record<
			string,
			{ Front: string; Back: string }
		>;
		expect(result["Card 1"]).toBeDefined();
		expect(typeof result["Card 1"].Front).toBe("string");
		expect(typeof result["Card 1"].Back).toBe("string");
	});

	it("modelStyling for Basic returns a css object", async () => {
		const result = (await ankiV2("modelStyling", { modelName: "Basic" })) as Record<
			string,
			unknown
		>;
		expect(result).toHaveProperty("css");
		expect(typeof result.css).toBe("string");
	});

	it("apiReflect returns scopes and actions", async () => {
		const result = (await ankiV2("apiReflect", {})) as Record<string, unknown>;
		expect(result.scopes).toEqual(["actions"]);
		expect(Array.isArray(result.actions)).toBe(true);
		expect(result.actions).toContain("addNote");
		expect(result.actions).toContain("canAddNotesWithErrorDetail");
		expect(result.actions).toContain("notesInfo");
	});

	it("runs add -> find -> duplicate -> detail -> info -> cards -> browse sequence", async () => {
		const note = {
			deckName: "Default",
			modelName: "Basic",
			fields: { Front: "v2seq", Back: "背" },
		};

		// canAddNotes — fresh note is addable
		const canAdd = await ankiV2("canAddNotes", { notes: [note] });
		expect(canAdd).toEqual([true]);

		// addNote — returns numeric ankiId
		const ankiId = (await ankiV2("addNote", { note })) as number;
		expect(typeof ankiId).toBe("number");
		expect(ankiId).toBeGreaterThan(0);

		// findNotes — deck:Default includes the new note
		const found = (await ankiV2("findNotes", { query: "deck:Default" })) as number[];
		expect(found).toContain(ankiId);

		// canAddNotes again — now a duplicate
		const canAddAgain = await ankiV2("canAddNotes", { notes: [note] });
		expect(canAddAgain).toEqual([false]);

		// canAddNotesWithErrorDetail — duplicate with error detail
		const detail = (await ankiV2("canAddNotesWithErrorDetail", {
			notes: [note],
		})) as Array<{ canAdd: boolean; error: string | null }>;
		expect(detail).toHaveLength(1);
		expect(detail[0].canAdd).toBe(false);
		expect(typeof detail[0].error).toBe("string");

		// notesInfo — returns note info with fields and cards
		const info = (await ankiV2("notesInfo", { notes: [ankiId] })) as Array<{
			noteId: number;
			modelName: string;
			tags: string[];
			fields: Record<string, { value: string; order: number }>;
			cards: number[];
		}>;
		expect(info).toHaveLength(1);
		expect(info[0].noteId).toBe(ankiId);
		expect(info[0].modelName).toBe("Basic");
		expect(info[0].fields.Front.value).toBe("v2seq");
		expect(info[0].fields.Back.value).toBe("背");
		expect(Array.isArray(info[0].cards)).toBe(true);
		expect(info[0].cards.length).toBeGreaterThan(0);

		// findCards — returns card ids for the note (nid query)
		const cards = (await ankiV2("findCards", {
			query: `nid:${ankiId}`,
		})) as number[];
		expect(Array.isArray(cards)).toBe(true);
		expect(cards.length).toBeGreaterThan(0);

		// guiBrowse — returns same card ids (headless, delegates to findCards)
		const browse = (await ankiV2("guiBrowse", {
			query: `nid:${ankiId}`,
		})) as number[];
		expect(Array.isArray(browse)).toBe(true);
		expect(browse.sort()).toEqual(cards.sort());
	});
});

// =============================================================================
// Version 6 regression (wrapped {result, error})
// =============================================================================

describe("Version 6 regression (wrapped {result, error})", () => {
	it("version returns 6", async () => {
		const { body } = await anki("version");
		expect(body).toEqual({ result: 6, error: null });
	});

	it("deckNames contains Default", async () => {
		const { body } = await anki("deckNames");
		expect(body.result).toEqual(expect.arrayContaining(["Default"]));
	});

	it("modelNames contains Basic", async () => {
		const { body } = await anki("modelNames");
		expect(body.result).toEqual(expect.arrayContaining(["Basic"]));
	});

	it("modelFieldNames for Basic returns Front/Back", async () => {
		const { body } = await anki("modelFieldNames", { modelName: "Basic" });
		expect(body).toEqual({ result: ["Front", "Back"], error: null });
	});

	it("runs the add -> find -> duplicate sequence", async () => {
		const note = { deckName: "Default", modelName: "Basic", fields: { Front: "cat", Back: "猫" } };

		// A fresh note is addable.
		const canAdd = await anki("canAddNotes", { notes: [note] });
		expect(canAdd.body).toEqual({ result: [true], error: null });

		// Adding it returns a numeric ankiId.
		const add = await anki("addNote", { note });
		expect(add.body.error).toBeNull();
		expect(typeof add.body.result).toBe("number");
		const ankiId = add.body.result as number;

		// findNotes deck:Default includes the new anki_id.
		const found = await anki("findNotes", { query: "deck:Default" });
		expect(found.body.result as number[]).toContain(ankiId);

		// The same note is now reported as a duplicate.
		const canAddAgain = await anki("canAddNotes", { notes: [note] });
		expect(canAddAgain.body).toEqual({ result: [false], error: null });
	});

	it("POST / responses carry a permissive CORS header", async () => {
		const { headers } = await anki("version");
		expect(headers.get("access-control-allow-origin")).toBe("*");
	});

	it("OPTIONS / is a 204 preflight with CORS headers", async () => {
		const res = await SELF.fetch("http://localhost/", { method: "OPTIONS" });
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST,OPTIONS");
		expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
		expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
	});
});
