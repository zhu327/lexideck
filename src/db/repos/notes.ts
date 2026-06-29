import type { DbClient, SqlBinding } from "../client";
import { generateAnkiId } from "./anki-id";
import { parseJsonColumn } from "./json";

export interface NoteRow {
	id: string;
	userId: string;
	deckId: string;
	modelId: string;
	fields: Record<string, string>;
	tags: string[];
	guid: string;
	ankiId: number | null;
	createdAt: number;
	updatedAt: number;
}

interface NoteDbRow {
	id: string;
	user_id: string;
	deck_id: string;
	model_id: string;
	fields: string;
	tags: string;
	guid: string;
	anki_id: number | null;
	created_at: number;
	updated_at: number;
}

function mapRow(row: NoteDbRow): NoteRow {
	return {
		id: row.id,
		userId: row.user_id,
		deckId: row.deck_id,
		modelId: row.model_id,
		fields: parseJsonColumn<Record<string, string>>(row.fields, {}),
		tags: parseJsonColumn<string[]>(row.tags, []),
		guid: row.guid,
		ankiId: row.anki_id ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createNote(
	db: DbClient,
	userId: string,
	input: {
		deckId: string;
		modelId: string;
		fields: Record<string, string>;
		tags: string[];
		guid: string;
	},
): Promise<NoteRow> {
	const id = crypto.randomUUID();
	const now = Date.now();
	const ankiId = await generateAnkiId(db, userId, "notes");
	await db.exec(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, anki_id, created_at, updated_at) " +
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		id,
		userId,
		input.deckId,
		input.modelId,
		JSON.stringify(input.fields),
		JSON.stringify(input.tags),
		input.guid,
		ankiId,
		now,
		now,
	);
	return {
		id,
		userId,
		deckId: input.deckId,
		modelId: input.modelId,
		fields: input.fields,
		tags: input.tags,
		guid: input.guid,
		ankiId,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Delete a note and all associated data (cards, revlog, enrichments).
 * Returns true if the note existed and was deleted.
 */
export async function deleteNote(
	db: DbClient,
	userId: string,
	noteId: string,
): Promise<boolean> {
	const note = await db.queryFirst(
		"SELECT 1 FROM notes WHERE user_id = ? AND id = ?",
		userId,
		noteId,
	);
	if (!note) return false;

	// Delete associated revlog via cards
	await db.exec(
		"DELETE FROM revlog WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE user_id = ? AND note_id = ?)",
		userId,
		userId,
		noteId,
	);
	// Delete associated cards
	await db.exec(
		"DELETE FROM cards WHERE user_id = ? AND note_id = ?",
		userId,
		noteId,
	);
	// Delete associated enrichments
	await db.exec(
		"DELETE FROM enrichments WHERE user_id = ? AND note_id = ?",
		userId,
		noteId,
	);
	// Delete the note itself
	await db.exec(
		"DELETE FROM notes WHERE user_id = ? AND id = ?",
		userId,
		noteId,
	);
	return true;
}

export async function updateNoteFields(
	db: DbClient,
	userId: string,
	noteId: string,
	fields: Record<string, string>,
	tags?: string[],
): Promise<void> {
	const now = Date.now();
	if (tags !== undefined) {
		await db.exec(
			"UPDATE notes SET fields = ?, tags = ?, updated_at = ? WHERE user_id = ? AND id = ?",
			JSON.stringify(fields),
			JSON.stringify(tags),
			now,
			userId,
			noteId,
		);
	} else {
		await db.exec(
			"UPDATE notes SET fields = ?, updated_at = ? WHERE user_id = ? AND id = ?",
			JSON.stringify(fields),
			now,
			userId,
			noteId,
		);
	}
}

/**
 * Add or remove a single tag on a note. `add=true` adds the tag (idempotent),
 * `add=false` removes it (idempotent). Returns true if the note exists.
 */
export async function toggleNoteTag(
	db: DbClient,
	userId: string,
	noteId: string,
	tag: string,
	add: boolean,
): Promise<boolean> {
	const note = await db.queryFirst<{ tags: string }>(
		"SELECT tags FROM notes WHERE user_id = ? AND id = ?",
		userId,
		noteId,
	);
	if (!note) return false;
	const tags = parseJsonColumn<string[]>(note.tags, []);
	const has = tags.includes(tag);
	if (add === has) return true; // no-op
	const next = add ? [...tags, tag] : tags.filter((t) => t !== tag);
	await db.exec(
		"UPDATE notes SET tags = ?, updated_at = ? WHERE user_id = ? AND id = ?",
		JSON.stringify(next),
		Date.now(),
		userId,
		noteId,
	);
	return true;
}

const NOTE_SELECT =
	"SELECT id, user_id, deck_id, model_id, fields, tags, guid, anki_id, created_at, updated_at FROM notes";

export async function getNoteById(
	db: DbClient,
	userId: string,
	noteId: string,
): Promise<NoteRow | null> {
	const row = await db.queryFirst<NoteDbRow>(
		`${NOTE_SELECT} WHERE user_id = ? AND id = ?`,
		userId,
		noteId,
	);
	return row ? mapRow(row) : null;
}

export async function getNoteByAnkiId(
	db: DbClient,
	userId: string,
	ankiId: number,
): Promise<NoteRow | null> {
	const row = await db.queryFirst<NoteDbRow>(
		`${NOTE_SELECT} WHERE user_id = ? AND anki_id = ?`,
		userId,
		ankiId,
	);
	return row ? mapRow(row) : null;
}

export async function noteExistsByGuid(
	db: DbClient,
	userId: string,
	guid: string,
): Promise<boolean> {
	const row = await db.queryFirst(
		"SELECT 1 FROM notes WHERE user_id = ? AND guid = ? LIMIT 1",
		userId,
		guid,
	);
	return row !== null;
}

// Minimal Anki-style query parser. Supports space-separated `key:value` tokens
// combined with AND, scoped by user_id. `deck:X` resolves the deck name to an
// id; any other `Field:val` token matches `json_extract(fields, '$.Field') =
// 'val'`. Field keys are matched case-insensitively against model field names.
// Tokens may be surrounded by double-quotes (Yomitan format).
// Malformed tokens or unknown decks yield an empty result (no crash).
export async function findNotesByQuery(
	db: DbClient,
	userId: string,
	query: string,
): Promise<number[]> {
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return [];
	}

	// Build case-insensitive field name map from all user models
	const modelRows = await db.query<{ field_names: string }>(
		"SELECT field_names FROM models WHERE user_id = ?",
		userId,
	);
	const fieldNameMap = new Map<string, string>();
	for (const row of modelRows) {
		const names = parseJsonColumn<string[]>(row.field_names, []);
		for (const name of names) {
			const lower = name.toLowerCase();
			if (!fieldNameMap.has(lower)) {
				fieldNameMap.set(lower, name);
			}
		}
	}

	const conditions: string[] = [];
	const params: SqlBinding[] = [userId];
	for (const rawToken of tokens) {
		// Strip surrounding double-quotes (Yomitan sends quoted tokens)
		const token = rawToken.replace(/^"(.*)"$/, "$1");

		const match = token.match(/^([^:]+):(.*)$/);
		if (!match) {
			return [];
		}
		const key = match[1];
		const val = match[2];
		if (key === "deck") {
			const deck = await db.queryFirst<{ id: string }>(
				"SELECT id FROM decks WHERE user_id = ? AND name = ?",
				userId,
				val,
			);
			if (!deck) {
				return [];
			}
			conditions.push("deck_id = ?");
			params.push(deck.id);
		} else if (/^[A-Za-z0-9_]+$/.test(key)) {
			// Resolve field key case-insensitively against model field names
			const actualField = fieldNameMap.get(key.toLowerCase()) ?? key;
			conditions.push("json_extract(fields, ?) = ?");
			params.push(`$.${actualField}`, val);
		} else {
			return [];
		}
	}
	if (conditions.length === 0) {
		return [];
	}
	const sql = `SELECT anki_id FROM notes WHERE user_id = ? AND ${conditions.join(" AND ")}`;
	const rows = await db.query<{ anki_id: number }>(sql, ...params);
	return rows.map((row) => row.anki_id);
}

export interface NoteSearchResult {
	noteId: string;
	fields: Record<string, string>;
	deckName: string;
	tags: string[];
}

export async function searchNotes(
	db: DbClient,
	userId: string,
	opts: { query?: string; limit?: number; offset?: number },
): Promise<{ notes: NoteSearchResult[]; total: number }> {
	const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
	const offset = Math.max(0, opts.offset ?? 0);
	const trimmed = opts.query?.trim() || "";

	const whereClause = trimmed ? "WHERE n.user_id = ? AND n.fields LIKE ?" : "WHERE n.user_id = ?";
	const baseParams: SqlBinding[] = trimmed
		? [userId, `%${trimmed.replace(/[%_\\]/g, "\\$&")}%`]
		: [userId];

	const countRow = await db.queryFirst<{ cnt: number }>(
		`SELECT COUNT(*) as cnt FROM notes n ${whereClause}`,
		...baseParams,
	);
	const total = countRow?.cnt ?? 0;

	const rows = await db.query<{
		id: string;
		fields: string;
		deck_name: string;
		tags: string;
	}>(
		`SELECT n.id, n.fields, d.name as deck_name, n.tags ` +
			`FROM notes n JOIN decks d ON d.id = n.deck_id ` +
			`${whereClause} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
		...baseParams,
		limit,
		offset,
	);

	const notes: NoteSearchResult[] = rows.map((row) => ({
		noteId: row.id,
		fields: parseJsonColumn<Record<string, string>>(row.fields, {}),
		deckName: row.deck_name,
		tags: parseJsonColumn<string[]>(row.tags, []),
	}));

	return { notes, total };
}
