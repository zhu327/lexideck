import type { DbClient } from "../client";
import { parseJsonColumn } from "./json";

export interface ExportModelSnapshot {
	id: string;
	name: string;
	fieldNames: string[];
	templates: Record<string, { Front: string; Back: string }>;
	css: string;
}

export interface ExportNoteSnapshot {
	id: string;
	deckId: string;
	deckName: string;
	modelId: string;
	model: ExportModelSnapshot;
	fields: Record<string, string>;
	tags: string[];
	guid: string;
	ankiId: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface ExportSnapshot {
	notes: ExportNoteSnapshot[];
}

interface ExportSnapshotRow {
	id: string;
	deck_id: string;
	deck_name: string;
	model_id: string;
	model_name: string;
	model_field_names: string;
	model_templates: string;
	model_css: string;
	fields: string;
	tags: string;
	guid: string;
	anki_id: number | null;
	created_at: number;
	updated_at: number;
}

export async function getExportSnapshot(db: DbClient, userId: string): Promise<ExportSnapshot> {
	const rows = await db.query<ExportSnapshotRow>(
		"SELECT " +
			"n.id, n.deck_id, d.name AS deck_name, n.model_id, " +
			"m.name AS model_name, m.field_names AS model_field_names, " +
			"m.templates AS model_templates, m.css AS model_css, " +
			"n.fields, n.tags, n.guid, n.anki_id, n.created_at, n.updated_at " +
			"FROM notes n " +
			"JOIN decks d ON d.id = n.deck_id AND d.user_id = n.user_id " +
			"JOIN models m ON m.id = n.model_id AND m.user_id = n.user_id " +
			"WHERE n.user_id = ? " +
			"ORDER BY d.name ASC, n.created_at ASC, n.id ASC",
		userId,
	);

	return {
		notes: rows.map((row) => ({
			id: row.id,
			deckId: row.deck_id,
			deckName: row.deck_name,
			modelId: row.model_id,
			model: {
				id: row.model_id,
				name: row.model_name,
				fieldNames: parseJsonColumn<string[]>(row.model_field_names, []),
				templates: parseJsonColumn<Record<string, { Front: string; Back: string }>>(
					row.model_templates,
					{},
				),
				css: row.model_css,
			},
			fields: parseJsonColumn<Record<string, string>>(row.fields, {}),
			tags: parseJsonColumn<string[]>(row.tags, []),
			guid: row.guid,
			ankiId: row.anki_id ?? null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		})),
	};
}
