import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

// Permissive CORS for Yomitan cross-origin browser calls. The API is auth-
// protected, so a wildcard origin is safe. OPTIONS preflights are answered
// directly (before auth) with 204 + CORS headers; all other responses get the
// headers appended after downstream handlers run.
const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, Cf-Access-Jwt-Assertion",
};

export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		if (c.req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		await next();
		for (const [key, value] of Object.entries(CORS_HEADERS)) {
			c.res.headers.set(key, value);
		}
	};
}
