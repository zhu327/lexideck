import type { Context } from "hono";
import type { AuthUser } from "../../auth/apiKey";
import type { DbClient } from "../../db/client";
import { getCardForReview, updateCardAfterReview } from "../../db/repos/cards-review";
import { insertRevlog } from "../../db/repos/revlog";
import { scheduleReview } from "../../srs/scheduler";
import type { Rating } from "../../srs/types";

type ReviewEnv = { Variables: { user: AuthUser } };

const VALID_RATINGS = new Set<number>([1, 2, 3, 4]);

export function createSubmitHandler(deps: { db: DbClient }) {
	return async (c: Context<ReviewEnv>) => {
		const userId = c.get("user")?.userId ?? "local";
		const body = await c.req.json<{ cardId?: string; rating?: number }>();
		const rating = body.rating;
		if (!body.cardId || typeof rating !== "number" || !VALID_RATINGS.has(rating)) {
			return c.json({ error: "cardId and rating (1-4) required" }, 400);
		}
		const row = await getCardForReview(deps.db, userId, body.cardId);
		if (!row) {
			return c.json({ error: "not found" }, 404);
		}
		const { next, revlog } = scheduleReview(row, rating as Rating, new Date());
		// NOTE: non-atomic for MVP — updateCard and insertRevlog are separate
		// statements; a failure between them can leave card/revlog out of sync.
		await updateCardAfterReview(deps.db, userId, body.cardId, next);
		await insertRevlog(deps.db, userId, revlog);
		return c.json({ due: next.due });
	};
}
