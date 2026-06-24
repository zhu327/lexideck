import type { DbClient, SqlBinding } from "../client";
import { parseJsonColumn } from "./json";

export interface NoteRow {
	id: string;
	userId: string;
	deckId: string;
	modelId: string;
	fields: Record<string, string>;
	tags: string[];
	guid: string;
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
	await db.exec(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at) " +
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		id,
		userId,
		input.deckId,
		input.modelId,
		JSON.stringify(input.fields),
		JSON.stringify(input.tags),
		input.guid,
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
		createdAt: now,
		updatedAt: now,
	};
}

export async function getNoteById(
	db: DbClient,
	userId: string,
	noteId: string,
): Promise<NoteRow | null> {
	const row = await db.queryFirst<NoteDbRow>(
		"SELECT id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at " +
			"FROM notes WHERE user_id = ? AND id = ?",
		userId,
		noteId,
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
// 'val'`. Malformed tokens or unknown decks yield an empty result (no crash).
export async function findNotesByQuery(
	db: DbClient,
	userId: string,
	query: string,
): Promise<string[]> {
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return [];
	}
	const conditions: string[] = [];
	const params: SqlBinding[] = [userId];
	for (const token of tokens) {
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
			conditions.push("json_extract(fields, ?) = ?");
			params.push(`$.${key}`, val);
		} else {
			return [];
		}
	}
	if (conditions.length === 0) {
		return [];
	}
	const sql = `SELECT id FROM notes WHERE user_id = ? AND ${conditions.join(" AND ")}`;
	const rows = await db.query<{ id: string }>(sql, ...params);
	return rows.map((row) => row.id);
}
