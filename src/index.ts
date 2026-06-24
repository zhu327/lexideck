import { Hono } from "hono";
import type { AuthUser } from "./auth/access";
import { accessAuthMiddleware } from "./auth/access";
import { createDbClient } from "./db/client";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

app.use("*", accessAuthMiddleware());

app.get("/api/health", async (c) => {
	const db = createDbClient(c.env.DB);
	await db.queryFirst("SELECT 1");
	return c.json({ ok: true, db: "ok" });
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return app.fetch(request, env, ctx);
	},
};
