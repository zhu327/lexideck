import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface AnkiResponse {
	result: unknown;
	error: string | null;
}

interface AnkiResult {
	status: number;
	headers: Headers;
	body: AnkiResponse;
}

// Drive the global worker (DEV=1 bypasses auth -> local user) through the
// Ankiconnect protocol that Yomitan uses, exactly as a browser extension would.
async function anki(action: string, params: unknown = {}): Promise<AnkiResult> {
	const res = await SELF.fetch("http://localhost/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action, version: 6, params }),
	});
	return { status: res.status, headers: res.headers, body: (await res.json()) as AnkiResponse };
}

describe("Yomitan connection sequence (POST /)", () => {
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

		// Adding it returns a string noteId.
		const add = await anki("addNote", { note });
		expect(add.body.error).toBeNull();
		expect(typeof add.body.result).toBe("string");
		const noteId = add.body.result as string;

		// findNotes deck:Default includes the new noteId.
		const found = await anki("findNotes", { query: "deck:Default" });
		expect(found.body.result as string[]).toContain(noteId);

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
		expect(res.headers.get("access-control-allow-headers")).toContain("Cf-Access-Jwt-Assertion");
	});
});
