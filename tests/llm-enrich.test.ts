import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthUser, apiKeyAuth } from "../src/auth/apiKey";
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
	coreMeaning: "cat 的核心义是猫这种动物",
	meaningMap: "• noun：猫；猫科动物",
	usageNotes: "• cat 通常是可数名词：a cat / cats",
	memoryHooks: "想到独立、敏捷的小动物形象",
	reviewPrompt: "看到 cat 时，先说出它是不是可数名词？",
};

// Mount the LLM app behind the auth middleware exactly like a real caller.
function app(enrich?: LlmDeps["enrich"]) {
	const a = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	a.use("*", apiKeyAuth());
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

function captureEnrich(): {
	calls: Parameters<NonNullable<LlmDeps["enrich"]>>[];
	enrich: NonNullable<LlmDeps["enrich"]>;
} {
	const calls: Parameters<NonNullable<LlmDeps["enrich"]>>[] = [];
	return {
		calls,
		enrich: async (...args) => {
			calls.push(args);
			return FIXED_ENRICHMENT;
		},
	};
}

function failingEnrich(): NonNullable<LlmDeps["enrich"]> {
	return async () => {
		throw new LlmRequestError(500);
	};
}

async function enrichmentRowCount(noteId: string): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COUNT(*) as n FROM enrichments WHERE user_id = 'local' AND note_id = ? AND kind = 'dictionary-v2'",
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
		const noLlmEnv: Env = {
			...env,
			LLM_API_KEY: undefined,
			LLM_BASE_URL: undefined,
			LLM_MODEL: undefined,
		};
		const res = await app().fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`, { method: "POST" }),
			noLlmEnv,
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

		const stored = await getEnrichment(createDbClient(env.DB), "local", NOTE_ID, "dictionary-v2");
		expect(stored).toEqual(FIXED_ENRICHMENT);
	});

	it("passes front and back dictionary fields to the enrichment provider", async () => {
		const captured = captureEnrich();
		const res = await app(captured.enrich).fetch(
			new Request(`http://localhost/api/notes/${NOTE_ID}/enrich`, { method: "POST" }),
			configuredEnv,
		);

		expect(res.status).toBe(200);
		expect(captured.calls).toHaveLength(1);
		expect(captured.calls[0][0]).toEqual({
			word: "cat",
			front: "cat",
			back: "猫",
			fields: FIELDS,
		});
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
			coreMeaning: "first-core",
			meaningMap: "first-map",
			usageNotes: "first-usage",
			memoryHooks: "first-hooks",
			reviewPrompt: "first-prompt",
		};
		const second: Enrichment = {
			coreMeaning: "second-core",
			meaningMap: "second-map",
			usageNotes: "second-usage",
			memoryHooks: "second-hooks",
			reviewPrompt: "second-prompt",
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

		const stored = await getEnrichment(createDbClient(env.DB), "local", NOTE_ID, "dictionary-v2");
		expect(stored).toEqual(second);
	});
});
