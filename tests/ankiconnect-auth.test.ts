import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAnkiconnectApp } from "../src/ankiconnect/router";
import type { AuthUser } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";

function makeApp() {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	app.route("/", createAnkiconnectApp({ db: createDbClient(env.DB) }));
	return app;
}

function prodEnv(apiKey?: string): Env {
	return { ...env, DEV: undefined, ANKICONNECT_API_KEY: apiKey };
}

function request(body: Record<string, unknown>) {
	return new Request("http://localhost/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("ankiconnect key auth", () => {
	it("returns 401 when no key is provided and apiKey is set", async () => {
		const app = makeApp();
		const res = await app.fetch(request({ action: "version", version: 2 }), prodEnv("secret"));
		expect(res.status).toBe(401);
	});

	it("returns 401 when wrong key is provided", async () => {
		const app = makeApp();
		const res = await app.fetch(
			request({ action: "version", version: 2, key: "wrong" }),
			prodEnv("secret"),
		);
		expect(res.status).toBe(401);
	});

	it("dispatches normally when correct key is provided", async () => {
		const app = makeApp();
		const res = await app.fetch(
			request({ action: "version", version: 2, key: "secret" }),
			prodEnv("secret"),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toBe(6);
	});

	it("returns 401 when ANKICONNECT_API_KEY is unset (fail closed)", async () => {
		const app = makeApp();
		const res = await app.fetch(
			request({ action: "version", version: 2, key: "anything" }),
			prodEnv(undefined),
		);
		expect(res.status).toBe(401);
	});

	it("bypasses key check when DEV=1", async () => {
		const app = makeApp();
		const res = await app.fetch(request({ action: "version", version: 2 }), { ...env, DEV: "1" });
		expect(res.status).toBe(200);
		expect(await res.json()).toBe(6);
	});

	it("with DEV=1 falls through to userId local", async () => {
		const app = makeApp();
		const res = await app.fetch(request({ action: "version", version: 6 }), { ...env, DEV: "1" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ result: 6, error: null });
	});
});
