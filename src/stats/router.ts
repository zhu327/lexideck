import { Hono } from "hono";
import type { AuthUser } from "../auth/apiKey";
import type { DbClient } from "../db/client";
import { getStatsSummary } from "../db/repos/stats";
import type { Env } from "../env";
import { parseTzOffset } from "../utils/timezone";

export interface StatsDeps {
	db: DbClient;
}

export function createStatsApp(
	deps: StatsDeps,
): Hono<{ Bindings: Env; Variables: { user: AuthUser } }> {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

	app.get("/summary", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const tzOffset = parseTzOffset(c.env.TIMEZONE);
		const summary = await getStatsSummary(deps.db, userId, Date.now(), tzOffset);
		return c.json(summary);
	});

	return app;
}
