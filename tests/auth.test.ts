import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthUser } from "../src/auth/apiKey";
import { apiKeyAuth } from "../src/auth/apiKey";
import type { Env } from "../src/env";

function makeApp() {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	app.use("*", apiKeyAuth());
	app.get("/whoami", (c) => c.json({ user: c.get("user") }));
	return app;
}

function prodEnv(overrides: Partial<Env> = {}): Env {
	return { ...env, DEV: undefined, ANKICONNECT_API_KEY: "test-secret", ...overrides };
}

describe("apiKeyAuth", () => {
	it("bypasses auth and sets a local user when DEV=1", async () => {
		const app = makeApp();

		const res = await app.fetch(new Request("http://localhost/whoami"), { ...env, DEV: "1" });

		expect(res.status).toBe(200);
		expect(((await res.json()) as { user: AuthUser }).user).toEqual({
			userId: "local",
			email: "dev@local",
			sub: "dev",
		});
	});

	it("returns 401 when ANKICONNECT_API_KEY is unset (fail closed)", async () => {
		const app = makeApp();

		const res = await app.fetch(
			new Request("http://localhost/whoami"),
			prodEnv({ ANKICONNECT_API_KEY: undefined }),
		);

		expect(res.status).toBe(401);
	});

	it("returns 401 when no Authorization header is present", async () => {
		const app = makeApp();

		const res = await app.fetch(new Request("http://localhost/whoami"), prodEnv());

		expect(res.status).toBe(401);
	});

	it("returns 401 when Authorization header has wrong scheme", async () => {
		const app = makeApp();

		const res = await app.fetch(
			new Request("http://localhost/whoami", {
				headers: { Authorization: "Basic test-secret" },
			}),
			prodEnv(),
		);

		expect(res.status).toBe(401);
	});

	it("returns 401 when Bearer token is wrong", async () => {
		const app = makeApp();

		const res = await app.fetch(
			new Request("http://localhost/whoami", {
				headers: { Authorization: "Bearer wrong-key" },
			}),
			prodEnv(),
		);

		expect(res.status).toBe(401);
	});

	it("accepts a valid Bearer token and sets the user", async () => {
		const app = makeApp();

		const res = await app.fetch(
			new Request("http://localhost/whoami", {
				headers: { Authorization: "Bearer test-secret" },
			}),
			prodEnv(),
		);

		expect(res.status).toBe(200);
		expect(((await res.json()) as { user: AuthUser }).user).toEqual({
			userId: "local",
			email: "api-key-user",
			sub: "api-key",
		});
	});
});
