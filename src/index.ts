import { Hono } from "hono";
import { createAnkiconnectApp } from "./ankiconnect/router";
import { type AuthUser, accessAuthMiddleware } from "./auth/access";
import { corsMiddleware } from "./cors";
import { createDbClient } from "./db/client";
import type { Env } from "./env";
import { createLlmApp } from "./llm/router";
import { createReviewApp } from "./review/router";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };

// Build the Hono app with all sub-apps mounted. `env.DB` is a stable D1 binding
// for the lifetime of the isolate, so creating the db clients once per isolate
// (when env is first available) is correct and efficient. The health handler
// builds its own per-request client from `c.env.DB` (harmless).
function buildApp(env: Env): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.use("*", corsMiddleware());
	app.use("*", accessAuthMiddleware());

	app.get("/api/health", async (c) => {
		const db = createDbClient(c.env.DB);
		await db.queryFirst("SELECT 1");
		return c.json({ ok: true, db: "ok" });
	});

	app.route("/api/review", createReviewApp({ db: createDbClient(env.DB) }));
	app.route("/api", createLlmApp({ db: createDbClient(env.DB) }));
	app.route("/", createAnkiconnectApp({ db: createDbClient(env.DB) }));

	return app;
}

// The env bindings are not available at module scope. Build the app lazily on
// the first request and cache it; `env.DB` is stable across requests in the
// same isolate, so the cached app's db clients remain valid.
let cachedApp: Hono<AppEnv> | null = null;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (!cachedApp) {
			cachedApp = buildApp(env);
		}
		return cachedApp.fetch(request, env, ctx);
	},
};
