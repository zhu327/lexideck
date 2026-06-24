import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, accessAuthMiddleware } from "../src/auth/access";
import { createDbClient } from "../src/db/client";
import { getEnrichment } from "../src/db/repos/enrichments";
import type { Env } from "../src/env";
import { createLlmApp, type LlmDeps } from "../src/llm/router";
import { type Enrichment, LlmRequestError } from "../src/llm/types";

const NOTE_ID = "note-enrich-1";
const UNKNOWN_NOTE_ID = "note-does-not-exist";
const DECK = "deck-default-local";
const MODEL = "model-basic-local";
const FIELDS: Record<string, string> = { Front: "cat", Back: "猫" };

const FIXED_ENRICHMENT: Enrichment = {
	exampleSentence: "The cat purred on the windowsill.",
	extendedDefinition: "A small domesticated carnivorous mammal kept as a pet.",
	mnemonic: "CAT: Cuddly And Tiny",
};

// Mount the LLM app behind the auth middleware exactly like a real caller.
function app(enrich?: LlmDeps["enrich"]) {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", accessAuthMiddleware());
	a.route("/api", createLlmApp({ db: createDbClient(env.DB), enrich }));
	return a;
}

// A configured env supplies all three LLM_* keys so readLlmConfig returns a config.
const configuredEnv: Env = {
	...env,
	LLM_API_KEY: "k",
	LLM_BASE_URL: "http://x",
	LLM_MODEL: "m",
};

function stubEnrich(result: Enrichment): NonNullable<LlmDeps["enrich"]> {
	return async () => result;
}

function failingEnrich(): NonNullable<LlmDeps["enrich"]> {
	return async () => {
		throw new LlmRequestError(500);
	};
}

async function enrichmentRowCount(noteId: string): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COUNT(*) as n FROM enrichments WHERE user_id = 'local' AND note_id = ? AND kind = 'default'",
	)
		.bind(noteId)
		.first<{ n: number }>();
	return row?.n ?? 0;
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

describe("POST /api/notes/:id/enrich", () => {
	it("returns 503 when LLM is not configured", async () => {
		const res = await app().fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`, { method: "POST" }),
			env,
		);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "llm not configured" });
	});

	it("returns 404 for an unknown note (checked before config)", async () => {
		const res = await app().fetch(
			new Request(`http://localhost/api/notes/${UNKNOWN_NOTE_ID}/enrich`, { method: "POST" }),
			env,
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "note not found" });
	});

	it("returns 200 with the Enrichment and persists it when configured", async () => {
		const res = await app(stubEnrich(FIXED_ENRICHMENT)).fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`, { method: "POST" }),
			configuredEnv,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(FIXED_ENRICHMENT);

		const stored = await getEnrichment(createDbClient(env.DB), "local", NOTE_ID, "default");
		expect(stored).toEqual(FIXED_ENRICHMENT);
	});

	it("returns 502 on LLM upstream error", async () => {
		const res = await app(failingEnrich()).fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`, { method: "POST" }),
			configuredEnv,
		);
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: "llm upstream error" });
	});

	it("returns 500 with a generic message (no internal details) on a non-LLM error", async () => {
		const throwingEnrich: NonNullable<LlmDeps["enrich"]> = async () => {
			throw new Error("internal raw fragment");
		};
		const res = await app(throwingEnrich).fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`, { method: "POST" }),
			configuredEnv,
		);
		expect(res.status).toBe(500);
		const text = await res.text();
		expect(text).not.toContain("internal raw fragment");
		expect(JSON.parse(text)).toEqual({ error: "enrichment failed" });
	});

	it("upserts on re-enrich: one row, latest content wins", async () => {
		const first: Enrichment = {
			exampleSentence: "first-e",
			extendedDefinition: "first-d",
			mnemonic: "first-m",
		};
		const second: Enrichment = {
			exampleSentence: "second-e",
			extendedDefinition: "second-d",
			mnemonic: "second-m",
		};
		let call = 0;
		const stub: NonNullable<LlmDeps["enrich"]> = async () => (call++ === 0 ? first : second);

		const url = `http://localhost/api/notes/${NOTE_ID}/enrich`;
		const res1 = await app(stub).fetch(new Request(url, { method: "POST" }), configuredEnv);
		expect(res1.status).toBe(200);
		expect(await res1.json()).toEqual(first);

		const res2 = await app(stub).fetch(new Request(url, { method: "POST" }), configuredEnv);
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual(second);

		expect(await enrichmentRowCount(NOTE_ID)).toBe(1);

		const stored = await getEnrichment(createDbClient(env.DB), "local", NOTE_ID, "default");
		expect(stored).toEqual(second);
	});
});
