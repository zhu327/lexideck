import type { RevlogEntry } from "../../srs/types";
import type { DbClient } from "../client";

export async function countTodayReviewsByType(
	db: DbClient,
	userId: string,
	todayStart: number,
): Promise<{ newCount: number; reviewCount: number }> {
	const row = await db.queryFirst<Record<string, unknown>>(
		"SELECT " +
			"COALESCE(SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END), 0) AS new_count, " +
			"COALESCE(SUM(CASE WHEN state > 0 THEN 1 ELSE 0 END), 0) AS review_count " +
			"FROM revlog WHERE user_id = ? AND review_time >= ?",
		userId,
		todayStart,
	);
	return {
		newCount: Number(row?.new_count ?? 0),
		reviewCount: Number(row?.review_count ?? 0),
	};
}

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
