import type { DbClient } from "../client";

export interface ModelRow {
	id: string;
	name: string;
	fieldNames: string[];
	templates: Record<string, { Front: string; Back: string }>;
	css: string;
}

export async function listModelNames(db: DbClient, userId: string): Promise<string[]> {
	const rows = await db.query<{ name: string }>(
		"SELECT name FROM models WHERE user_id = ? ORDER BY name",
		userId,
	);
	return rows.map((row) => row.name);
}

export async function getModel(
	db: DbClient,
	userId: string,
	modelName: string,
): Promise<ModelRow | null> {
	const row = await db.queryFirst<{
		id: string;
		name: string;
		field_names: string;
		templates: string;
		css: string;
	}>(
		"SELECT id, name, field_names, templates, css FROM models WHERE user_id = ? AND name = ?",
		userId,
		modelName,
	);
	if (!row) {
		return null;
	}
	return {
		id: row.id,
		name: row.name,
		fieldNames: JSON.parse(row.field_names) as string[],
		templates: JSON.parse(row.templates) as Record<string, { Front: string; Back: string }>,
		css: row.css,
	};
}
