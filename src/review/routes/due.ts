import type { Context } from "hono";
import type { AuthUser } from "../../auth/apiKey";
import type { DbClient } from "../../db/client";
import { countDueCards, listDueCards } from "../../db/repos/cards-review";
import { countTodayReviewsByType } from "../../db/repos/revlog";
import { parseTzOffset, todayStartMs } from "../../utils/timezone";
import type { Env } from "../../env";

type ReviewEnv = { Bindings: Env; Variables: { user: AuthUser } };

export function parseLimit(raw: string | undefined, def: number): number {
	const n = Number(raw ?? def);
	return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 200) : def;
}

export function parseOffset(raw: string | undefined): number {
	const n = Number(raw ?? 0);
	return Number.isFinite(n) ? Math.max(Math.trunc(n), 0) : 0;
}

export function createDueHandler(deps: { db: DbClient }) {
	return async (c: Context<ReviewEnv>) => {
		const userId = c.get("user")?.userId ?? "local";
		const deckName = c.req.query("deck") || undefined;
		const limit = parseLimit(c.req.query("limit"), 50);
		const offset = parseOffset(c.req.query("offset"));
		const now = Date.now();

		const newPerDay = Number(c.env.NEW_CARDS_PER_DAY ?? 20);
		const reviewsPerDay = Number(c.env.REVIEWS_PER_DAY ?? 100);
		const tzOffset = parseTzOffset(c.env.TIMEZONE);
		const todayStart = todayStartMs(now, tzOffset);
		const todayCounts = await countTodayReviewsByType(deps.db, userId, todayStart);
		const remainingNew = Math.max(0, newPerDay - todayCounts.newCount);
		const remainingReviews = Math.max(0, reviewsPerDay - todayCounts.reviewCount);

		const cards = await listDueCards(deps.db, userId, {
			deckName,
			limit,
			offset,
			now,
			newPerDay: remainingNew,
			reviewsPerDay: remainingReviews,
		});
		const total = await countDueCards(deps.db, userId, {
			deckName,
			now,
			newPerDay: remainingNew,
			reviewsPerDay: remainingReviews,
		});
		return c.json({ cards, total });
	};
}
