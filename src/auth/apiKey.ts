import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";

export interface AuthUser {
	userId: string;
	email: string;
	sub: string;
}

/**
 * API key auth middleware. Validates `Authorization: Bearer <key>` against
 * `ANKICONNECT_API_KEY`. In DEV mode (`DEV=1`) auth is bypassed.
 */
export function apiKeyAuth(): MiddlewareHandler<{
	Bindings: Env;
	Variables: { user: AuthUser };
}> {
	return async (c, next) => {
		if (c.env.DEV === "1") {
			c.set("user", { userId: "local", email: "dev@local", sub: "dev" });
			await next();
			return;
		}
		const apiKey = c.env.ANKICONNECT_API_KEY;
		if (!apiKey) {
			return c.json({ error: "unauthorized" }, 401);
		}
		const authHeader = c.req.header("Authorization");
		if (!authHeader?.startsWith("Bearer ") || authHeader.slice(7) !== apiKey) {
			return c.json({ error: "unauthorized" }, 401);
		}
		c.set("user", { userId: "local", email: "api-key-user", sub: "api-key" });
		await next();
	};
}
