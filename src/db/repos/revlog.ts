import type { RevlogEntry } from "../../srs/types";
import type { DbClient } from "../client";

export async function insertRevlog(
	db: DbClient,
	userId: string,
	entry: RevlogEntry,
): Promise<void> {
	await db.exec(
		"INSERT INTO revlog (id, user_id, card_id, rating, state, due, stability, difficulty, " +
			"elapsed_days, scheduled_days, review_time, created_at) " +
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		crypto.randomUUID(),
		userId,
		entry.cardId,
		entry.rating,
		entry.state,
		entry.due,
		entry.stability,
		entry.difficulty,
		entry.elapsed_days,
		entry.scheduled_days,
		entry.review_time,
		Date.now(),
	);
}
