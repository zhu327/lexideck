import type { Context } from "hono";
import type { AuthUser } from "../../auth/access";
import type { DbClient } from "../../db/client";
import { listDueCards } from "../../db/repos/cards-review";

type ReviewEnv = { Variables: { user: AuthUser } };

export function createDueHandler(deps: { db: DbClient }) {
	return async (c: Context<ReviewEnv>) => {
		const userId = c.get("user")?.userId ?? "local";
		const deckName = c.req.query("deck") || undefined;
		const limit = Number(c.req.query("limit") ?? 20);
		const cards = await listDueCards(deps.db, userId, {
			deckName,
			limit,
			now: Date.now(),
		});
		return c.json({ cards });
	};
}
