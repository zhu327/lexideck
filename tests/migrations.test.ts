import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
	it("creates all expected tables", async () => {
		const result = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' " +
				"AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name",
		).all<{ name: string }>();

		const names = (result.results ?? []).map((row) => row.name);
		expect(names).toEqual(
			expect.arrayContaining(["cards", "decks", "enrichments", "models", "notes", "revlog"]),
		);
	});

	it("applies migration 0003: adds anki_id column and unique index", async () => {
		// Check anki_id column exists on notes
		const notesCols = await env.DB.prepare("PRAGMA table_info(notes)").all<{
			name: string;
			type: string;
			notnull: number;
		}>();
		const notesAnkiId = (notesCols.results ?? []).find((c) => c.name === "anki_id");
		expect(notesAnkiId).toBeDefined();
		expect(notesAnkiId?.type).toBe("INTEGER");

		// Check anki_id column exists on cards
		const cardsCols = await env.DB.prepare("PRAGMA table_info(cards)").all<{
			name: string;
			type: string;
			notnull: number;
		}>();
		const cardsAnkiId = (cardsCols.results ?? []).find((c) => c.name === "anki_id");
		expect(cardsAnkiId).toBeDefined();
		expect(cardsAnkiId?.type).toBe("INTEGER");

		// Check unique index exists on notes
		const notesIdx = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notes' " +
				"AND name = 'idx_notes_user_anki_id'",
		).first<{ name: string }>();
		expect(notesIdx).not.toBeNull();

		// Check unique index exists on cards
		const cardsIdx = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cards' " +
				"AND name = 'idx_cards_user_anki_id'",
		).first<{ name: string }>();
		expect(cardsIdx).not.toBeNull();

		// Check backfill: existing rows have anki_id set and no per-user duplicates.
		const noteRows = await env.DB.prepare(
			"SELECT user_id, anki_id, COUNT(*) AS cnt FROM notes GROUP BY user_id, anki_id HAVING cnt > 1 OR anki_id IS NULL",
		).first<{ user_id: string; anki_id: number; cnt: number }>();
		expect(noteRows).toBeNull();

		const cardRows = await env.DB.prepare(
			"SELECT user_id, anki_id, COUNT(*) AS cnt FROM cards GROUP BY user_id, anki_id HAVING cnt > 1 OR anki_id IS NULL",
		).first<{ user_id: string; anki_id: number; cnt: number }>();
		expect(cardRows).toBeNull();

		// Backfilled ids should be close to created_at (timestamp-based) and not null.
		const noteRow = await env.DB.prepare("SELECT anki_id, created_at FROM notes LIMIT 1").first<{
			anki_id: number;
			created_at: number;
		}>();
		if (noteRow) {
			expect(noteRow.anki_id).not.toBeNull();
			expect(noteRow.anki_id).toBeGreaterThanOrEqual(noteRow.created_at);
		}
	});

	it("seeds the Default deck for user local", async () => {
		const deck = await env.DB.prepare(
			"SELECT id, name, user_id FROM decks WHERE user_id = 'local' AND name = 'Default'",
		).first<{ id: string; name: string; user_id: string }>();

		expect(deck).not.toBeNull();
		expect(deck?.id).toBe("deck-default-local");
		expect(deck?.name).toBe("Default");
	});

	it("backfill handles notes with the same created_at without collision", async () => {
		const now = Date.now();
		await env.DB.prepare(
			"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at) " +
				"VALUES (?, 'local', 'deck-default-local', 'model-basic-local', ?, ?, ?, ?, ?)",
		)
			.bind(
				"note-dup-1",
				JSON.stringify({ Front: "A", Back: "a" }),
				JSON.stringify([]),
				"guid-dup-1",
				now,
				now,
			)
			.run();
		await env.DB.prepare(
			"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at) " +
				"VALUES (?, 'local', 'deck-default-local', 'model-basic-local', ?, ?, ?, ?, ?)",
		)
			.bind(
				"note-dup-2",
				JSON.stringify({ Front: "B", Back: "b" }),
				JSON.stringify([]),
				"guid-dup-2",
				now,
				now,
			)
			.run();

		// Re-run the backfill logic (idempotent because WHERE anki_id IS NULL).
		await env.DB.prepare(
			"UPDATE notes " +
				"SET anki_id = (" +
				"SELECT created_at + rnum FROM (" +
				"SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) - 1 AS rnum FROM notes" +
				") numbered WHERE numbered.id = notes.id" +
				") " +
				"WHERE anki_id IS NULL",
		).run();

		const rows = await env.DB.prepare(
			"SELECT id, anki_id FROM notes WHERE id IN ('note-dup-1', 'note-dup-2') ORDER BY id",
		).all<{ id: string; anki_id: number }>();
		const results = rows.results ?? [];
		expect(results).toHaveLength(2);
		expect(results[0].anki_id).not.toBe(results[1].anki_id);

		// Cleanup so other tests are not affected.
		await env.DB.prepare("DELETE FROM notes WHERE id IN ('note-dup-1', 'note-dup-2')").run();
	});

	it("seeds the Basic model with Front/Back fields and one template", async () => {
		const model = await env.DB.prepare(
			"SELECT id, name, field_names, templates, css, user_id FROM models " +
				"WHERE user_id = 'local' AND name = 'Basic'",
		).first<{
			id: string;
			name: string;
			field_names: string;
			templates: string;
			css: string;
			user_id: string;
		}>();

		expect(model).not.toBeNull();
		expect(model?.id).toBe("model-basic-local");
		expect(JSON.parse(model?.field_names ?? "[]")).toEqual(["Front", "Back"]);
		expect(JSON.parse(model?.templates ?? "{}")).toEqual({
			"Card 1": { Front: "{{Front}}", Back: "{{Back}}" },
		});
		expect(model?.css).toBe("");
	});
});
