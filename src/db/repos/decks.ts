import type { DbClient } from "../client";

export async function listDeckNames(db: DbClient, userId: string): Promise<string[]> {
	const rows = await db.query<{ name: string }>(
		"SELECT name FROM decks WHERE user_id = ? ORDER BY name",
		userId,
	);
	return rows.map((row) => row.name);
}
