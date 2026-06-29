import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAnkiconnectApp } from "../src/ankiconnect/router";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";

function app() {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth()); // DEV=1 -> local user
	a.route("/", createAnkiconnectApp({ db: createDbClient(env.DB) }));
	return a;
}

async function post(action: string, params: unknown = {}, version = 6) {
	return app().fetch(
		new Request("http://localhost/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action, version, params }),
		}),
		env,
	);
}

describe("ankiconnect read actions", () => {
	it("version returns 6 (v6)", async () => {
		const res = await post("version");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ result: 6, error: null });
	});

	it("version returns bare 6 (v2)", async () => {
		const res = await post("version", {}, 2);
		expect(res.status).toBe(200);
		expect(await res.json()).toBe(6);
	});

	it("deckNames contains Default (v6)", async () => {
		const res = await post("deckNames");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { result: string[]; error: null };
		expect(body.error).toBeNull();
		expect(body.result).toEqual(expect.arrayContaining(["Default"]));
	});

	it("deckNames returns bare array (v2)", async () => {
		const res = await post("deckNames", {}, 2);
		expect(res.status).toBe(200);
		const body = (await res.json()) as string[];
		expect(body).toEqual(expect.arrayContaining(["Default"]));
	});

	it("modelNames contains Basic", async () => {
		const res = await post("modelNames");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { result: string[]; error: null };
		expect(body.error).toBeNull();
		expect(body.result).toEqual(expect.arrayContaining(["Basic"]));
	});

	it("modelFieldNames returns Front/Back for Basic", async () => {
		const res = await post("modelFieldNames", { modelName: "Basic" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ result: ["Front", "Back"], error: null });
	});

	it("modelTemplates returns Card 1 with Front/Back strings for Basic", async () => {
		const res = await post("modelTemplates", { modelName: "Basic" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result: Record<string, { Front: string; Back: string }>;
			error: null;
		};
		expect(body.error).toBeNull();
		expect(body.result["Card 1"]).toEqual({
			Front: expect.any(String),
			Back: expect.any(String),
		});
	});

	it("modelStyling returns {css} for Basic", async () => {
		const res = await post("modelStyling", { modelName: "Basic" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { result: { css: string }; error: string | null };
		expect(body.error).toBeNull();
		expect(body.result).toEqual({ css: expect.any(String) });
	});

	it("modelFieldNames returns model not found for unknown model", async () => {
		const res = await post("modelFieldNames", { modelName: "Nope" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ result: null, error: "model not found: Nope" });
	});

	it("unknown action returns unsupported action error (v6)", async () => {
		const res = await post("bogus");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ result: null, error: "unsupported action: bogus" });
	});

	it("unknown action returns bare null (v2)", async () => {
		const res = await post("bogus", {}, 2);
		expect(res.status).toBe(200);
		expect(await res.json()).toBeNull();
	});

	it("returns the contract shape on a malformed (non-JSON) body", async () => {
		const res = await app().fetch(
			new Request("http://localhost/", { method: "POST", body: "not json" }),
			env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ result: null, error: "internal error" });
	});
});
