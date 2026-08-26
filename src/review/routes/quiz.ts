import type { Context } from "hono";
import type { DbClient } from "../../db/client";
import { listRandomCards } from "../../db/repos/cards-review";
import type { Env } from "../../env";
import { parseLimit } from "./due";

type ReviewEnv = { Bindings: Env };

export function createQuizHandler(deps: { db: DbClient }) {
	return async (c: Context<ReviewEnv>) => {
		const userId = "local";
		const deckName = c.req.query("deck") || undefined;
		const limit = parseLimit(c.req.query("limit"), 10);
		const cards = await listRandomCards(deps.db, userId, { deckName, limit });
		return c.json({ cards });
	};
}
