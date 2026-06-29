import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
import { createDbClient } from "../src/db/client";
import type { Env } from "../src/env";
import { createLlmApp, type LlmDeps } from "../src/llm/router";
import type { Enrichment } from "../src/llm/types";

const NOTE_ID = "note-cache-1";
const UNKNOWN_NOTE_ID = "note-does-not-exist";
const DECK = "deck-default-local";
const MODEL = "model-basic-local";
const FIELDS: Record<string, string> = { Front: "dog", Back: "狗" };

const FIXED_ENRICHMENT: Enrichment = {
	coreMeaning: "dog 的核心义是狗这种动物",
	meaningMap: "• noun：狗；犬科动物",
	usageNotes: "• dog 通常是可数名词：a dog / dogs",
	memoryHooks: "想到忠诚、陪伴人的动物形象",
	reviewPrompt: "看到 dog 时，先说出它是不是可数名词？",
};

function app(enrich?: LlmDeps["enrich"]) {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth());
	a.route("/api", createLlmApp({ db: createDbClient(env.DB), enrich }));
	return a;
}

const configuredEnv: Env = {
	...env,
	LLM_API_KEY: "k",
	LLM_BASE_URL: "http://x",
	LLM_MODEL: "m",
};

function stubEnrich(result: Enrichment): NonNullable<LlmDeps["enrich"]> {
	return async () => result;
}

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM enrichments").run();
	await env.DB.prepare("DELETE FROM notes").run();
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO notes (id, user_id, deck_id, model_id, fields, tags, guid, created_at, updated_at) " +
			"VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(NOTE_ID, DECK, MODEL, JSON.stringify(FIELDS), JSON.stringify([]), NOTE_ID, now, now)
		.run();
});

describe("GET /api/notes/:id/enrich", () => {
	it("returns 404 for a note without cached enrichment", async () => {
		const res = await app().fetch(new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`), env);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not found" });
	});

	it("returns 404 for a nonexistent note", async () => {
		const res = await app().fetch(
			new Request(`http://localhost/api/notes/${UNKNOWN_NOTE_ID}/enrich`),
			env,
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "note not found" });
	});

	it("returns cached enrichment after POST", async () => {
		// First POST to create enrichment
		const postRes = await app(stubEnrich(FIXED_ENRICHMENT)).fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`, { method: "POST" }),
			configuredEnv,
		);
		expect(postRes.status).toBe(200);

		// Then GET should return the cached data
		const getRes = await app().fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`),
			env,
		);
		expect(getRes.status).toBe(200);
		const body = (await getRes.json()) as Enrichment;
		expect(body).toEqual(FIXED_ENRICHMENT);
		expect(body.coreMeaning).toBe(FIXED_ENRICHMENT.coreMeaning);
		expect(body.meaningMap).toBe(FIXED_ENRICHMENT.meaningMap);
		expect(body.usageNotes).toBe(FIXED_ENRICHMENT.usageNotes);
		expect(body.memoryHooks).toBe(FIXED_ENRICHMENT.memoryHooks);
		expect(body.reviewPrompt).toBe(FIXED_ENRICHMENT.reviewPrompt);
	});
});
