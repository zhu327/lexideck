import type { DbClient } from "../client";

/**
 * Generate a unique anki_id for a user-scoped table with a simple
 * retry-on-collision loop.  Single-user, single-threaded Workers
 * runtime makes collisions extremely rare, so the 100-attempt window
 * is ample.  Falls back to microsecond timestamp if needed.
 */
const ALLOWED_TABLES = new Set(["notes", "cards"]);

export async function generateAnkiId(
	db: DbClient,
	userId: string,
	table: "notes" | "cards",
): Promise<number> {
	if (!ALLOWED_TABLES.has(table)) {
		throw new Error(`generateAnkiId: unsupported table "${table}"`);
	}
	for (let attempt = 0; attempt < 100; attempt++) {
		const ankiId = Date.now() + attempt;
		const existing = await db.queryFirst<{ c: number }>(
			`SELECT 1 AS c FROM ${table} WHERE user_id = ? AND anki_id = ? LIMIT 1`,
			userId,
			ankiId,
		);
		if (!existing) {
			return ankiId;
		}
	}
	// Fallback: extremely unlikely, but use microsecond timestamp
	return Date.now() * 1000;
}
