import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { loadSqlJs } from "../../src/export/sqljs";

async function addNote(front: string, back: string): Promise<string> {
	const res = await SELF.fetch("http://localhost/api/notes", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			deckName: "Default",
			modelName: "Basic",
			fields: { Front: front, Back: back },
			tags: ["e2e-export"],
		}),
	});
	expect(res.status).toBe(200);
	const body = (await res.json()) as { noteId: string };
	return body.noteId;
}

async function inspectExportedNote(bytes: Uint8Array): Promise<{ guid: string; fields: string }> {
	const entries = unzipSync(bytes);
	const collection = entries["collection.anki2"];
	expect(collection).toBeDefined();
	const SQL = await loadSqlJs();
	const db = new SQL.Database(collection);
	try {
		const row = db.exec("SELECT guid, flds FROM notes")[0].values[0] as [string, string];
		return { guid: row[0], fields: row[1] };
	} finally {
		db.close();
	}
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM revlog").run();
	await env.DB.prepare("DELETE FROM cards").run();
	await env.DB.prepare("DELETE FROM notes").run();
});

describe("APKG export (full app)", () => {
	it("exports a created note from the mounted worker path", async () => {
		const noteId = await addNote("e2e export front", "e2e export back");
		const note = await env.DB.prepare("SELECT guid FROM notes WHERE id = ?")
			.bind(noteId)
			.first<{ guid: string }>();
		expect(note).not.toBeNull();

		const res = await SELF.fetch("http://localhost/api/export/apkg");
		const bytes = new Uint8Array(await res.arrayBuffer());

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("content-disposition")).toMatch(
			/^attachment; filename="anki-vocab-\d{4}-\d{2}-\d{2}\.apkg"$/,
		);
		expect(bytes.length).toBeGreaterThan(0);

		const exported = await inspectExportedNote(bytes);
		expect(exported.guid).toBe(note?.guid);
		expect(exported.fields).toBe("e2e export front\u001fe2e export back");
	});
});
