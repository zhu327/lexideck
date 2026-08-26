import { Hono } from "hono";
import type { DbClient } from "../db/client";
import { getDailyActivity, getStatsSummary } from "../db/repos/stats";
import type { Env } from "../env";
import { parseTzOffset } from "../utils/timezone";

export interface StatsDeps {
	db: DbClient;
}

export function createStatsApp(deps: StatsDeps): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();

	app.get("/summary", async (c) => {
		const userId = "local";
		const tzOffset = parseTzOffset(c.env.TIMEZONE);
		const summary = await getStatsSummary(deps.db, userId, Date.now(), tzOffset);
		return c.json(summary);
	});

	app.get("/activity", async (c) => {
		const userId = "local";
		const tzOffset = parseTzOffset(c.env.TIMEZONE);
		const rawDays = Number(c.req.query("days") ?? 365);
		const days = Number.isFinite(rawDays) ? Math.min(Math.max(Math.trunc(rawDays), 1), 365) : 365;
		const activity = await getDailyActivity(deps.db, userId, Date.now(), tzOffset, days);
		return c.json(activity);
	});

	return app;
}
