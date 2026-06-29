import type { DbClient } from "../client";
import { todayStartMs } from "../../utils/timezone";

export interface StatsSummary {
	todayReviews: number;
	totalCards: number;
	newCards: number;
	learningCards: number;
	reviewCards: number;
	streak: number;
	todayRetention: number | null;
}

export async function getStatsSummary(
	db: DbClient,
	userId: string,
	now: number,
	tzOffsetHours = 8,
): Promise<StatsSummary> {
	const todayStart = todayStartMs(now, tzOffsetHours);

	// Today's reviews + retention
	const todayRow = await db.queryFirst<{ cnt: number; good: number }>(
		"SELECT COUNT(*) AS cnt, " +
			"COALESCE(SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END), 0) AS good " +
			"FROM revlog WHERE user_id = ? AND review_time >= ?",
		userId,
		todayStart,
	);
	const todayReviews = Number(todayRow?.cnt ?? 0);
	const todayRetention = todayReviews > 0 ? Number(todayRow?.good ?? 0) / todayReviews : null;

	// Card state counts
	const cardRow = await db.queryFirst<{
		total: number;
		new_cnt: number;
		learn: number;
		review: number;
	}>(
		"SELECT COUNT(*) AS total, " +
			"COALESCE(SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END), 0) AS new_cnt, " +
			"COALESCE(SUM(CASE WHEN state = 1 THEN 1 ELSE 0 END), 0) AS learn, " +
			"COALESCE(SUM(CASE WHEN state = 2 THEN 1 ELSE 0 END), 0) AS review " +
			"FROM cards WHERE user_id = ?",
		userId,
	);

	// Streak: count consecutive days backwards from today with at least one review.
	// Group by local day: shift review_time by tz offset before dividing by day length.
	const tzMs = tzOffsetHours * 3_600_000;
	const streakDays = await db.query<{ day: number }>(
		"SELECT DISTINCT CAST(((review_time + ?) / 86400000) AS INTEGER) AS day " +
			"FROM revlog WHERE user_id = ? AND review_time >= ? " +
			"ORDER BY day DESC",
		tzMs,
		userId,
		todayStart - 365 * 86_400_000,
	);

	const todayDay = Math.floor((todayStart + tzMs) / 86_400_000);
	let streak = 0;
	for (const row of streakDays) {
		const expected = todayDay - streak;
		if (row.day === expected) {
			streak++;
		} else {
			break;
		}
	}

	return {
		todayReviews,
		totalCards: Number(cardRow?.total ?? 0),
		newCards: Number(cardRow?.new_cnt ?? 0),
		learningCards: Number(cardRow?.learn ?? 0),
		reviewCards: Number(cardRow?.review ?? 0),
		streak,
		todayRetention,
	};
}
