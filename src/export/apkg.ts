import { strToU8, zipSync } from "fflate";
import type { ExportModelSnapshot, ExportSnapshot } from "../db/repos/export";
import { loadSqlJs, type SqlJsDatabase } from "./sqljs";

type ApkgExportErrorCode = "empty_export" | "export_too_large" | "generation_failed";

const MAX_EXPORT_NOTES = 10_000;
const MAX_EXPORT_FIELD_BYTES = 20_000_000;

export class ApkgExportError extends Error {
	readonly code: ApkgExportErrorCode;

	constructor(code: ApkgExportErrorCode, message: string) {
		super(message);
		this.name = "ApkgExportError";
		this.code = code;
	}
}

export interface ApkgExportResult {
	bytes: Uint8Array;
	filename: string;
	noteCount: number;
}

interface AnkiDeckMetadata {
	id: number;
	name: string;
	mod: number;
	usn: number;
	lrnToday: [number, number];
	revToday: [number, number];
	newToday: [number, number];
	timeToday: [number, number];
	collapsed: boolean;
	browserCollapsed: boolean;
	desc: string;
	dyn: number;
	conf: number;
	extendNew: number;
	extendRev: number;
}

interface AnkiModelMetadata {
	id: number;
	name: string;
	type: number;
	mod: number;
	usn: number;
	sortf: number;
	flds: Array<{
		name: string;
		ord: number;
		sticky: boolean;
		rtl: boolean;
		font: string;
		size: number;
	}>;
	tmpls: Array<{
		name: string;
		ord: number;
		qfmt: string;
		afmt: string;
		did: null;
		bqfmt: string;
		bafmt: string;
	}>;
	css: string;
	latexPre: string;
	latexPost: string;
	req: Array<[number, string, number[]]>;
}

export function buildApkgFilename(now = new Date()): string {
	return `anki-vocab-${now.toISOString().slice(0, 10)}.apkg`;
}

export async function generateApkg(
	snapshot: ExportSnapshot,
	now = new Date(),
): Promise<ApkgExportResult> {
	if (snapshot.notes.length === 0) {
		throw new ApkgExportError("empty_export", "No notes available to export.");
	}
	validateExportBudget(snapshot);

	let db: SqlJsDatabase | undefined;
	try {
		const SQL = await loadSqlJs();
		db = new SQL.Database();
		createSchema(db);
		await writeCollection(db, snapshot, Math.floor(now.getTime() / 1000));
		const collectionBytes = db.export();
		const bytes = zipSync({
			"collection.anki2": collectionBytes,
			media: strToU8("{}"),
		});

		return {
			bytes,
			filename: buildApkgFilename(now),
			noteCount: snapshot.notes.length,
		};
	} catch (error) {
		if (error instanceof ApkgExportError) {
			throw error;
		}
		throw new ApkgExportError(
			"generation_failed",
			`Failed to generate Anki package: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		db?.close();
	}
}

function validateExportBudget(snapshot: ExportSnapshot): void {
	if (snapshot.notes.length > MAX_EXPORT_NOTES) {
		throw new ApkgExportError(
			"export_too_large",
			`Export is too large: maximum ${MAX_EXPORT_NOTES} notes are supported.`,
		);
	}

	const encoder = new TextEncoder();
	let fieldBytes = 0;
	for (const note of snapshot.notes) {
		for (const name of note.model.fieldNames) {
			fieldBytes += encoder.encode(note.fields[name] ?? "").length;
		}
		if (fieldBytes > MAX_EXPORT_FIELD_BYTES) {
			throw new ApkgExportError(
				"export_too_large",
				`Export is too large: serialized note fields must stay under ${MAX_EXPORT_FIELD_BYTES} bytes.`,
			);
		}
	}
}

function createSchema(db: SqlJsDatabase): void {
	db.run(`
		CREATE TABLE col (
			id integer primary key,
			crt integer not null,
			mod integer not null,
			scm integer not null,
			ver integer not null,
			dty integer not null,
			usn integer not null,
			ls integer not null,
			conf text not null,
			models text not null,
			decks text not null,
			dconf text not null,
			tags text not null
		)
	`);
	db.run(`
		CREATE TABLE notes (
			id integer primary key,
			guid text not null,
			mid integer not null,
			mod integer not null,
			usn integer not null,
			tags text not null,
			flds text not null,
			sfld text not null,
			csum integer not null,
			flags integer not null,
			data text not null
		)
	`);
	db.run(`
		CREATE TABLE cards (
			id integer primary key,
			nid integer not null,
			did integer not null,
			ord integer not null,
			mod integer not null,
			usn integer not null,
			type integer not null,
			queue integer not null,
			due integer not null,
			ivl integer not null,
			factor integer not null,
			reps integer not null,
			lapses integer not null,
			left integer not null,
			odue integer not null,
			odid integer not null,
			flags integer not null,
			data text not null
		)
	`);
	db.run(`
		CREATE TABLE revlog (
			id integer primary key,
			cid integer not null,
			usn integer not null,
			ease integer not null,
			ivl integer not null,
			lastIvl integer not null,
			factor integer not null,
			time integer not null,
			type integer not null
		)
	`);
	db.run(`
		CREATE TABLE graves (
			usn integer not null,
			oid integer not null,
			type integer not null
		)
	`);
}

async function writeCollection(
	db: SqlJsDatabase,
	snapshot: ExportSnapshot,
	nowSeconds: number,
): Promise<void> {
	const decks = buildDecks(snapshot, nowSeconds);
	const models = buildModels(snapshot, nowSeconds);
	const currentDeckId = Number(Object.keys(decks)[0]);
	const conf = buildCollectionConfig(snapshot.notes.length, currentDeckId);
	const dconf = buildDeckConfig(nowSeconds);

	db.run("INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
		1,
		nowSeconds,
		nowSeconds,
		nowSeconds * 1000,
		11,
		0,
		0,
		0,
		JSON.stringify(conf),
		JSON.stringify(models),
		JSON.stringify(decks),
		JSON.stringify(dconf),
		JSON.stringify({}),
	]);

	for (const note of snapshot.notes) {
		const modelId = stableId(`model:${note.modelId}`);
		const deckId = stableId(`deck:${note.deckId}`);
		const noteId = note.ankiId && note.ankiId > 0 ? note.ankiId : stableId(`note:${note.id}`);
		const fieldValues = note.model.fieldNames.map((name) => note.fields[name] ?? "");
		const fields = fieldValues.join("\u001f");
		const sortField = fieldValues[0] ?? "";
		const tags = formatTags(note.tags);
		const modified = Math.floor(note.updatedAt / 1000);

		const csum = await checksum(sortField);
		db.run("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
			noteId,
			note.guid,
			modelId,
			modified,
			-1,
			tags,
			fields,
			sortField,
			csum,
			0,
			"",
		]);

		const templates = Object.keys(note.model.templates);
		for (let ord = 0; ord < templates.length; ord++) {
			db.run("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
				stableId(`card:${note.id}:${ord}`),
				noteId,
				deckId,
				ord,
				modified,
				-1,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				"",
			]);
		}
	}
}

function buildCollectionConfig(noteCount: number, currentDeckId: number): Record<string, unknown> {
	return {
		nextPos: noteCount + 1,
		estTimes: true,
		activeDecks: [currentDeckId],
		sortType: "noteFld",
		timeLim: 0,
		sortBackwards: false,
		addToCur: true,
		curDeck: currentDeckId,
		newBury: true,
		newSpread: 0,
		dueCounts: true,
		curModel: null,
		collapseTime: 1200,
		new: { bury: true, delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500 },
		rev: { bury: true, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200 },
		lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
	};
}

function buildDeckConfig(nowSeconds: number): Record<string, unknown> {
	return {
		"1": {
			id: 1,
			name: "Default",
			mod: nowSeconds,
			usn: -1,
			maxTaken: 60,
			autoplay: true,
			timer: 0,
			replayq: true,
			new: {
				delays: [1, 10],
				ints: [1, 4, 7],
				initialFactor: 2500,
				bury: true,
				order: 1,
				perDay: 20,
			},
			rev: { bury: true, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200 },
			lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
		},
	};
}

function buildDecks(
	snapshot: ExportSnapshot,
	nowSeconds: number,
): Record<string, AnkiDeckMetadata> {
	const decks: Record<string, AnkiDeckMetadata> = {};
	for (const note of snapshot.notes) {
		const id = stableId(`deck:${note.deckId}`);
		decks[id] ??= {
			id,
			name: note.deckName,
			mod: nowSeconds,
			usn: -1,
			lrnToday: [0, 0],
			revToday: [0, 0],
			newToday: [0, 0],
			timeToday: [0, 0],
			collapsed: false,
			browserCollapsed: false,
			desc: "",
			dyn: 0,
			conf: 1,
			extendNew: 10,
			extendRev: 50,
		};
	}
	return decks;
}

function buildModels(
	snapshot: ExportSnapshot,
	nowSeconds: number,
): Record<string, AnkiModelMetadata> {
	const models: Record<string, AnkiModelMetadata> = {};
	for (const note of snapshot.notes) {
		const id = stableId(`model:${note.modelId}`);
		models[id] ??= buildModel(id, note.model, nowSeconds);
	}
	return models;
}

function buildModel(id: number, model: ExportModelSnapshot, nowSeconds: number): AnkiModelMetadata {
	const templates = Object.entries(model.templates);
	return {
		id,
		name: model.name,
		type: 0,
		mod: nowSeconds,
		usn: -1,
		sortf: 0,
		flds: model.fieldNames.map((name, ord) => ({
			name,
			ord,
			sticky: false,
			rtl: false,
			font: "Arial",
			size: 20,
		})),
		tmpls: templates.map(([name, template], ord) => ({
			name,
			ord,
			qfmt: template.Front,
			afmt: template.Back,
			did: null,
			bqfmt: "",
			bafmt: "",
		})),
		css: model.css,
		latexPre: "\\documentclass[12pt]{article}",
		latexPost: "\\end{document}",
		req: templates.map((_, ord) => [ord, "any", [0]]),
	};
}

function formatTags(tags: string[]): string {
	if (tags.length === 0) {
		return "";
	}
	return ` ${tags.map((tag) => tag.replaceAll(/\s+/g, "_")).join(" ")} `;
}

function stableId(value: string): number {
	return 1_000_000_000_000 + (hash53(value) % 8_000_000_000_000);
}

function hash53(value: string): number {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < value.length; i++) {
		const ch = value.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

async function checksum(value: string): Promise<number> {
	// Anki stores the first 8 hex digits of SHA-1 of the first field as an int,
	// used for duplicate detection. HTML tags and [sound:...] media refs are
	// stripped first so visually-identical fields share a checksum.
	const stripped = stripHTMLMedia(value);
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-1", new TextEncoder().encode(stripped)),
	);
	return new DataView(digest.buffer).getUint32(0);
}

function stripHTMLMedia(value: string): string {
	return value.replace(/\[sound:[^\]]*\]/gi, "").replace(/<[^>]+>/g, "");
}
