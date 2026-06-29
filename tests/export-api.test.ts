import { env } from "cloudflare:workers";
import { unzipSync } from "fflate";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";
import { createExportApp } from "../src/export/router";
import { loadSqlJs } from "../src/export/sqljs";

function makeApp(testEnv: Env = env) {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	app.use("/api/*", apiKeyAuth());
	app.route("/api/export", createExportApp({ db: createDbClient(testEnv.DB) }));
	return app;
}

async function insertNote(input: {
	id: string;
	front: string;
	back: string;
	guid: string;
	tags?: string[];
}): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, anki_id, created_at, updated_at) " +
			"VALUES (?, 'local', 'deck-default-local', 'model-basic-local', ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			input.id,
			JSON.stringify({ Front: input.front, Back: input.back }),
			JSON.stringify(input.tags ?? []),
			input.guid,
			123_456,
			1_700_000_000,
			1_700_000_500_000,
		)
		.run();
}

async function exportedNotes(bytes: Uint8Array): Promise<Array<[string, string]>> {
	const entries = unzipSync(bytes);
	const collection = entries["collection.anki2"];
	expect(collection).toBeDefined();
	const SQL = await loadSqlJs();
	const db = new SQL.Database(collection);
	try {
		return db.exec("SELECT guid, flds FROM notes ORDER BY guid")[0].values as Array<
			[string, string]
		>;
	} finally {
		db.close();
	}
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM revlog").run();
	await env.DB.prepare("DELETE FROM cards").run();
	await env.DB.prepare("DELETE FROM notes").run();
});

describe("APKG export API", () => {
	it("rejects requests without a bearer API key using the existing auth status", async () => {
		const testEnv = { ...env, DEV: "0", ANKICONNECT_API_KEY: "test-key" };
		const app = makeApp(testEnv);

		const res = await app.fetch(new Request("http://localhost/api/export/apkg"), testEnv);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "unauthorized" });
	});

	it("returns an APKG file download for an authorized user with notes", async () => {
		await insertNote({
			id: "export-api-note",
			front: "export front",
			back: "export back",
			guid: "export-api-guid",
			tags: ["export"],
		});

		const res = await makeApp().fetch(new Request("http://localhost/api/export/apkg"), env);
		const bytes = new Uint8Array(await res.arrayBuffer());

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("content-disposition")).toMatch(
			/^attachment; filename="anki-vocab-\d{4}-\d{2}-\d{2}\.apkg"$/,
		);
		expect(bytes.length).toBeGreaterThan(0);

		await expect(exportedNotes(bytes)).resolves.toEqual([
			["export-api-guid", "export front\u001fexport back"],
		]);
	});

	it("returns a friendly JSON error instead of a binary file when there are no notes", async () => {
		const res = await makeApp().fetch(new Request("http://localhost/api/export/apkg"), env);

		expect(res.status).toBe(400);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("content-disposition")).toBeNull();
		expect(await res.json()).toEqual({ error: "no notes to export" });
	});

	it("maps oversized exports to a 413 JSON response", async () => {
		const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
		app.use("/api/*", async (c, next) => {
			c.set("user", { userId: "local", email: "test@local", sub: "test" });
			await next();
		});
		app.route(
			"/api/export",
			createExportApp({
				db: {
					query: async () =>
						Array.from({ length: 10_001 }, (_, index) => ({
							id: `note-${index}`,
							deck_id: "deck-default-local",
							deck_name: "Default",
							model_id: "model-basic-local",
							model_name: "Basic",
							model_field_names: JSON.stringify(["Front", "Back"]),
							model_templates: JSON.stringify({
								"Card 1": { Front: "{{Front}}", Back: "{{Back}}" },
							}),
							model_css: "",
							fields: JSON.stringify({ Front: `front ${index}`, Back: "back" }),
							tags: JSON.stringify([]),
							guid: `guid-${index}`,
							anki_id: null,
							created_at: 1_700_000_000,
							updated_at: 1_700_000_500_000,
						})),
				} as never,
			}),
		);

		const res = await app.fetch(new Request("http://localhost/api/export/apkg"), env);

		expect(res.status).toBe(413);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("content-disposition")).toBeNull();
		expect(await res.json()).toEqual({ error: "export too large" });
	});
});
