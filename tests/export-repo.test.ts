import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient } from "../src/db/client";
import { getExportSnapshot } from "../src/db/repos/export";

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM notes").run();
	await env.DB.prepare("DELETE FROM decks WHERE id LIKE 'export-%'").run();
	await env.DB.prepare("DELETE FROM models WHERE id LIKE 'export-%'").run();
});

async function insertDeck(id: string, userId: string, name: string): Promise<void> {
	await env.DB.prepare("INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
		.bind(id, userId, name, 1_000)
		.run();
}

async function insertModel(id: string, userId: string, name: string): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO models (id, user_id, name, field_names, templates, css, type, created_at) " +
			"VALUES (?, ?, ?, ?, ?, ?, 'standard', ?)",
	)
		.bind(
			id,
			userId,
			name,
			JSON.stringify(["Front", "Back"]),
			JSON.stringify({ "Card 1": { Front: "{{Front}}", Back: "{{Back}}" } }),
			".card { color: red; }",
			1_000,
		)
		.run();
}

async function insertNote(input: {
	id: string;
	userId: string;
	deckId: string;
	modelId: string;
	front: string;
	back: string;
	tags?: string[];
	guid?: string;
	ankiId?: number | null;
	createdAt?: number;
	updatedAt?: number;
}): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, anki_id, created_at, updated_at) " +
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			input.id,
			input.userId,
			input.deckId,
			input.modelId,
			JSON.stringify({ Front: input.front, Back: input.back }),
			JSON.stringify(input.tags ?? []),
			input.guid ?? `${input.id}-guid`,
			input.ankiId ?? null,
			input.createdAt ?? 2_000,
			input.updatedAt ?? 3_000,
		)
		.run();
}

describe("getExportSnapshot", () => {
	it("returns one seeded note with parsed fields/tags and joined deck/model metadata", async () => {
		await insertNote({
			id: "export-note-one",
			userId: "local",
			deckId: "deck-default-local",
			modelId: "model-basic-local",
			front: "apple",
			back: "a fruit",
			tags: ["fruit", "food"],
			guid: "stable-guid-one",
			ankiId: 42,
			createdAt: 10,
			updatedAt: 20,
		});

		const snapshot = await getExportSnapshot(createDbClient(env.DB), "local");

		expect(snapshot.notes).toEqual([
			{
				id: "export-note-one",
				deckId: "deck-default-local",
				deckName: "Default",
				modelId: "model-basic-local",
				model: {
					id: "model-basic-local",
					name: "Basic",
					fieldNames: ["Front", "Back"],
					templates: { "Card 1": { Front: "{{Front}}", Back: "{{Back}}" } },
					css: "",
				},
				fields: { Front: "apple", Back: "a fruit" },
				tags: ["fruit", "food"],
				guid: "stable-guid-one",
				ankiId: 42,
				createdAt: 10,
				updatedAt: 20,
			},
		]);
	});

	it("returns multiple notes in deterministic deck, created time, note id order", async () => {
		await insertDeck("export-deck-beta", "local", "Beta");
		await insertDeck("export-deck-alpha", "local", "Alpha");
		await insertModel("export-model-basic", "local", "Export Basic");
		await insertNote({
			id: "export-note-beta-earlier",
			userId: "local",
			deckId: "export-deck-beta",
			modelId: "export-model-basic",
			front: "beta earlier",
			back: "b",
			createdAt: 10,
		});
		await insertNote({
			id: "export-note-alpha-later",
			userId: "local",
			deckId: "export-deck-alpha",
			modelId: "export-model-basic",
			front: "alpha later",
			back: "a",
			createdAt: 20,
		});
		await insertNote({
			id: "export-note-alpha-a",
			userId: "local",
			deckId: "export-deck-alpha",
			modelId: "export-model-basic",
			front: "alpha a",
			back: "a",
			createdAt: 10,
		});
		await insertNote({
			id: "export-note-alpha-b",
			userId: "local",
			deckId: "export-deck-alpha",
			modelId: "export-model-basic",
			front: "alpha b",
			back: "a",
			createdAt: 10,
		});

		const snapshot = await getExportSnapshot(createDbClient(env.DB), "local");

		expect(snapshot.notes.map((note) => note.id)).toEqual([
			"export-note-alpha-a",
			"export-note-alpha-b",
			"export-note-alpha-later",
			"export-note-beta-earlier",
		]);
	});

	it("does not return another user's notes when extra rows are inserted manually", async () => {
		await insertDeck("export-deck-other", "other-user", "Other Default");
		await insertModel("export-model-other", "other-user", "Other Basic");
		await insertNote({
			id: "export-note-local",
			userId: "local",
			deckId: "deck-default-local",
			modelId: "model-basic-local",
			front: "local note",
			back: "local",
		});
		await insertNote({
			id: "export-note-other",
			userId: "other-user",
			deckId: "export-deck-other",
			modelId: "export-model-other",
			front: "other note",
			back: "other",
		});

		const snapshot = await getExportSnapshot(createDbClient(env.DB), "local");

		expect(snapshot.notes.map((note) => note.id)).toEqual(["export-note-local"]);
	});

	it("returns an empty note list when there are no notes for the user", async () => {
		const snapshot = await getExportSnapshot(createDbClient(env.DB), "user-without-notes");

		expect(snapshot).toEqual({ notes: [] });
	});
});
