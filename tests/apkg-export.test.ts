import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ExportSnapshot } from "../src/db/repos/export";
import { ApkgExportError, buildApkgFilename, generateApkg } from "../src/export/apkg";
import { loadSqlJs } from "../src/export/sqljs";

function sampleSnapshot(): ExportSnapshot {
	return {
		notes: [
			{
				id: "note-alpha",
				deckId: "deck-default",
				deckName: "Default",
				modelId: "model-basic",
				model: {
					id: "model-basic",
					name: "Basic",
					fieldNames: ["Front", "Back"],
					templates: { "Card 1": { Front: "{{Front}}", Back: "{{Back}}" } },
					css: ".card { font-family: sans-serif; }",
				},
				fields: { Front: "apple", Back: "a fruit" },
				tags: ["fruit", "food"],
				guid: "stable-guid-alpha",
				ankiId: 12345,
				createdAt: 1_700_000_000,
				updatedAt: 1_700_000_500_000,
			},
			{
				id: "note-beta",
				deckId: "deck-japanese",
				deckName: "Japanese",
				modelId: "model-clozeish",
				model: {
					id: "model-clozeish",
					name: "Japanese Basic",
					fieldNames: ["Expression", "Meaning"],
					templates: {
						Recognition: { Front: "{{Expression}}", Back: "{{Meaning}}" },
					},
					css: ".card { color: blue; }",
				},
				fields: { Expression: "猫", Meaning: "cat" },
				tags: ["jp"],
				guid: "stable-guid-beta",
				ankiId: null,
				createdAt: 1_700_001_000,
				updatedAt: 1_700_001_500_000,
			},
		],
	};
}

async function openCollection(bytes: Uint8Array) {
	const entries = unzipSync(bytes);
	const collection = entries["collection.anki2"];
	expect(collection).toBeDefined();
	const SQL = await loadSqlJs();
	return { db: new SQL.Database(collection), entries };
}

describe("buildApkgFilename", () => {
	it("uses the UTC date in the APKG filename", () => {
		expect(buildApkgFilename(new Date("2026-06-29T12:00:00Z"))).toBe("anki-vocab-2026-06-29.apkg");
	});
});

describe("generateApkg", () => {
	it("rejects empty snapshots with a typed export error", async () => {
		await expect(generateApkg({ notes: [] })).rejects.toMatchObject({
			code: "empty_export",
		});

		try {
			await generateApkg({ notes: [] });
		} catch (error) {
			expect(error).toBeInstanceOf(ApkgExportError);
			expect((error as ApkgExportError).message).toMatch(/no notes/i);
		}
	});

	it("creates a non-empty APKG ZIP with collection and media entries", async () => {
		const result = await generateApkg(sampleSnapshot(), new Date("2026-06-29T12:00:00Z"));

		expect(result.filename).toBe("anki-vocab-2026-06-29.apkg");
		expect(result.noteCount).toBe(2);
		expect(result.bytes.length).toBeGreaterThan(0);

		const entries = unzipSync(result.bytes);
		expect(entries["collection.anki2"]?.length).toBeGreaterThan(0);
		expect(strFromU8(entries.media)).toBe("{}");
	});

	it("writes notes with original guid, fields, tags, and model id", async () => {
		const result = await generateApkg(sampleSnapshot());
		const { db } = await openCollection(result.bytes);

		const rows = db.exec("SELECT guid, mid, mod, flds, tags FROM notes ORDER BY guid")[0].values;

		expect(rows).toEqual([
			[
				"stable-guid-alpha",
				expect.any(Number),
				1_700_000_500,
				"apple\u001fa fruit",
				" fruit food ",
			],
			["stable-guid-beta", expect.any(Number), 1_700_001_500, "猫\u001fcat", " jp "],
		]);
		expect(rows[0][1]).not.toBe(rows[1][1]);
	});

	it("writes deterministic new cards without revlog or scheduling progress", async () => {
		const snapshot = sampleSnapshot();
		const first = await openCollection((await generateApkg(snapshot)).bytes);
		const second = await openCollection((await generateApkg(snapshot)).bytes);

		const noteSql = "SELECT id, guid, mid FROM notes ORDER BY guid";
		const firstNotes = first.db.exec(noteSql)[0].values;
		const secondNotes = second.db.exec(noteSql)[0].values;
		const cardSql =
			"SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odue, odid FROM cards ORDER BY nid, ord";
		const firstCards = first.db.exec(cardSql)[0].values;
		const secondCards = second.db.exec(cardSql)[0].values;

		expect(firstNotes).toEqual(secondNotes);
		expect(firstNotes).toHaveLength(2);
		expect(firstCards).toEqual(secondCards);
		expect(firstCards).toHaveLength(2);
		for (const row of firstCards) {
			expect(row.slice(3)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		}
		expect(first.db.exec("SELECT COUNT(*) FROM revlog")[0].values[0][0]).toBe(0);
	});

	it("represents multiple decks and models in collection metadata", async () => {
		const result = await generateApkg(sampleSnapshot());
		const { db } = await openCollection(result.bytes);

		const [decksJson, modelsJson] = db.exec("SELECT decks, models FROM col")[0].values[0] as [
			string,
			string,
		];
		const decks = Object.values(JSON.parse(decksJson) as Record<string, { name: string }>);
		const models = Object.values(JSON.parse(modelsJson) as Record<string, { name: string }>);

		expect(decks.map((deck) => deck.name).sort()).toEqual(["Default", "Japanese"]);
		expect(models.map((model) => model.name).sort()).toEqual(["Basic", "Japanese Basic"]);
	});

	it("writes Anki-compatible collection, deck config, and deck metadata", async () => {
		const result = await generateApkg(sampleSnapshot(), new Date("2026-06-29T12:00:00Z"));
		const { db } = await openCollection(result.bytes);

		const [confJson, dconfJson, decksJson] = db.exec("SELECT conf, dconf, decks FROM col")[0]
			.values[0] as [string, string, string];
		const conf = JSON.parse(confJson) as Record<string, unknown>;
		const dconf = JSON.parse(dconfJson) as Record<string, Record<string, unknown>>;
		const decks = Object.values(JSON.parse(decksJson) as Record<string, Record<string, unknown>>);

		expect(conf).toMatchObject({
			newSpread: 0,
			rev: expect.objectContaining({ bury: true }),
			new: expect.objectContaining({ bury: true }),
		});
		expect(conf.nextPos).toEqual(expect.any(Number));
		expect(dconf["1"]).toMatchObject({
			id: 1,
			name: "Default",
			new: expect.objectContaining({ delays: [1, 10], perDay: 20 }),
			rev: expect.objectContaining({ perDay: 200, ease4: 1.3 }),
			lapse: expect.objectContaining({ delays: [10], leechFails: 8 }),
		});
		expect(decks).not.toHaveLength(0);
		for (const deck of decks) {
			expect(deck).toMatchObject({
				conf: 1,
				dyn: 0,
				extendNew: 10,
				extendRev: 50,
			});
			expect(deck).not.toHaveProperty("extendedNew");
			expect(deck).not.toHaveProperty("extendedRev");
		}
	});

	it("points current collection deck settings at an exported deck", async () => {
		const result = await generateApkg(sampleSnapshot(), new Date("2026-06-29T12:00:00Z"));
		const { db } = await openCollection(result.bytes);

		const [confJson, decksJson] = db.exec("SELECT conf, decks FROM col")[0].values[0] as [
			string,
			string,
		];
		const conf = JSON.parse(confJson) as { activeDecks: number[]; curDeck: number };
		const decks = JSON.parse(decksJson) as Record<string, unknown>;

		expect(decks[String(conf.curDeck)]).toBeDefined();
		expect(conf.activeDecks).toEqual([conf.curDeck]);
	});

	it("rejects exports over the note-count budget before package generation", async () => {
		const sourceNote = sampleSnapshot().notes[0];
		const notes = Array.from({ length: 10_001 }, (_, index) => ({
			...sourceNote,
			id: `note-${index}`,
			guid: `guid-${index}`,
		}));

		await expect(generateApkg({ notes })).rejects.toMatchObject({
			code: "export_too_large",
			message: expect.stringMatching(/too large/i),
		});
	});

	it("computes csum as Anki's SHA1 of the HTML/sound-stripped first field", async () => {
		const basicModel = sampleSnapshot().notes[0].model;
		const snapshot: ExportSnapshot = {
			notes: [
				{
					id: "n-html",
					deckId: "deck-default",
					deckName: "Default",
					modelId: "model-basic",
					model: basicModel,
					fields: { Front: "<b>apple</b>", Back: "a fruit" },
					tags: [],
					guid: "g-html",
					ankiId: null,
					createdAt: 1_700_000_000,
					updatedAt: 1_700_000_500_000,
				},
				{
					id: "n-sound",
					deckId: "deck-default",
					deckName: "Default",
					modelId: "model-basic",
					model: basicModel,
					fields: { Front: "cat[sound:meow.mp3]", Back: "feline" },
					tags: [],
					guid: "g-sound",
					ankiId: null,
					createdAt: 1_700_001_000,
					updatedAt: 1_700_001_500_000,
				},
			],
		};

		const result = await generateApkg(snapshot);
		const { db } = await openCollection(result.bytes);

		const htmlCsum = db.exec("SELECT csum FROM notes WHERE guid = 'g-html'")[0].values[0][0];
		const soundCsum = db.exec("SELECT csum FROM notes WHERE guid = 'g-sound'")[0].values[0][0];

		// "<b>apple</b>" stripped -> "apple" -> int(sha1("apple").hexdigest()[:8], 16)
		expect(htmlCsum).toBe(3_502_124_484);
		// "cat[sound:meow.mp3]" stripped -> "cat" -> int(sha1("cat").hexdigest()[:8], 16)
		expect(soundCsum).toBe(2_644_024_973);
	});
});
