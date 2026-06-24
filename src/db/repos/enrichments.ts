import type { Enrichment } from "../../llm/types";
import type { DbClient } from "../client";

export async function saveEnrichment(
	db: DbClient,
	userId: string,
	noteId: string,
	kind: string,
	content: Enrichment,
): Promise<void> {
	const id = crypto.randomUUID();
	const now = Date.now();
	await db.exec(
		"INSERT INTO enrichments (id, user_id, note_id, kind, content, created_at) " +
			"VALUES (?, ?, ?, ?, ?, ?) " +
			"ON CONFLICT(user_id, note_id, kind) DO UPDATE SET content = excluded.content, created_at = excluded.created_at",
		id,
		userId,
		noteId,
		kind,
		JSON.stringify(content),
		now,
	);
}

export async function getEnrichment(
	db: DbClient,
	userId: string,
	noteId: string,
	kind: string,
): Promise<Enrichment | null> {
	const row = await db.queryFirst<{ content: string }>(
		"SELECT content FROM enrichments WHERE user_id = ? AND note_id = ? AND kind = ?",
		userId,
		noteId,
		kind,
	);
	if (!row) {
		return null;
	}
	return JSON.parse(row.content) as Enrichment;
}
