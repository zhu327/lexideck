import type { Context } from "hono";
import type { AuthUser } from "../../auth/access";
import type { DbClient } from "../../db/client";
import { listRandomCards } from "../../db/repos/cards-review";

type ReviewEnv = { Variables: { user: AuthUser } };

export function createQuizHandler(deps: { db: DbClient }) {
	return async (c: Context<ReviewEnv>) => {
		const userId = c.get("user")?.userId ?? "local";
		const deckName = c.req.query("deck") || undefined;
		const limit = Number(c.req.query("limit") ?? 10);
		const cards = await listRandomCards(deps.db, userId, { deckName, limit });
		return c.json({ cards });
	};
}
