import { describe, expect, it } from "vitest";
import { enrichNote, readLlmConfig } from "../src/llm/client";
import {
	type LlmConfig,
	LlmNotConfiguredError,
	LlmRequestError,
	type NoteInput,
} from "../src/llm/types";

const API_KEY = "test-key";
const BASE_URL = "https://api.example.com/v1";
const MODEL = "gpt-test";
const FULL_CONFIG: LlmConfig = { apiKey: API_KEY, baseUrl: BASE_URL, model: MODEL };
const NOTE: NoteInput = {
	word: "ephemeral",
	front: "ephemeral",
	back: "lasting for a very short time 短暂的",
	fields: { Front: "ephemeral", Back: "lasting for a very short time 短暂的" },
};

type FakeResponse = {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
};

function createFakeFetch(response: FakeResponse) {
	const calls: { input: string; init?: RequestInit }[] = [];
	const fetchImpl = (async (input: string, init?: RequestInit) => {
		calls.push({ input, init });
		return response;
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

function okResponse(content: string): FakeResponse {
	return {
		ok: true,
		status: 200,
		json: async () => ({ choices: [{ message: { content } }] }),
	};
}

describe("readLlmConfig", () => {
	it("returns null when LLM_API_KEY is missing", () => {
		expect(readLlmConfig({ LLM_BASE_URL: BASE_URL, LLM_MODEL: MODEL })).toBeNull();
	});

	it("returns null when LLM_BASE_URL is empty", () => {
		expect(readLlmConfig({ LLM_API_KEY: API_KEY, LLM_BASE_URL: "", LLM_MODEL: MODEL })).toBeNull();
	});

	it("returns null when LLM_MODEL is missing", () => {
		expect(readLlmConfig({ LLM_API_KEY: API_KEY, LLM_BASE_URL: BASE_URL })).toBeNull();
	});

	it("returns a config when all three values are present", () => {
		expect(
			readLlmConfig({
				LLM_API_KEY: API_KEY,
				LLM_BASE_URL: BASE_URL,
				LLM_MODEL: MODEL,
			}),
		).toEqual(FULL_CONFIG);
	});
});

describe("enrichNote", () => {
	it("throws LlmNotConfiguredError when config is null", async () => {
		await expect(enrichNote(NOTE, null)).rejects.toBeInstanceOf(LlmNotConfiguredError);
	});

	it("returns enrichment and sends a well-formed chat completion request", async () => {
		const content = JSON.stringify({
			coreMeaning: "core",
			meaningMap: "map",
			usageNotes: "usage",
			memoryHooks: "hooks",
			reviewPrompt: "prompt",
		});
		const { fetchImpl, calls } = createFakeFetch(okResponse(content));

		const result = await enrichNote(NOTE, FULL_CONFIG, fetchImpl);

		expect(result).toEqual({
			coreMeaning: "core",
			meaningMap: "map",
			usageNotes: "usage",
			memoryHooks: "hooks",
			reviewPrompt: "prompt",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].input).toBe(`${BASE_URL}/chat/completions`);
		expect(calls[0].init?.method).toBe("POST");
		const headers = new Headers(calls[0].init?.headers);
		expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
		expect(headers.get("Content-Type")).toBe("application/json");
		const body = JSON.parse(calls[0].init?.body as string) as {
			model: string;
			messages: { role: string; content: string }[];
		};
		expect(body.model).toBe(MODEL);
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[0].content).toContain("Oxford Intermediate");
		expect(body.messages[0].content).toContain("coreMeaning");
		expect(body.messages[1].role).toBe("user");
		expect(body.messages[1].content).toBe(
			JSON.stringify({
				word: NOTE.word,
				front: NOTE.front,
				back: NOTE.back,
				fields: NOTE.fields,
			}),
		);
	});

	it("throws LlmRequestError with the status on a non-2xx response", async () => {
		const { fetchImpl } = createFakeFetch({ ok: false, status: 500, json: async () => ({}) });
		const promise = enrichNote(NOTE, FULL_CONFIG, fetchImpl);
		await expect(promise).rejects.toBeInstanceOf(LlmRequestError);
		await expect(promise).rejects.toMatchObject({ status: 500 });
	});

	it("parses content wrapped in ```json fences", async () => {
		const json = JSON.stringify({
			coreMeaning: "core",
			meaningMap: "map",
			usageNotes: "usage",
			memoryHooks: "hooks",
			reviewPrompt: "prompt",
		});
		const fenced = `\`\`\`json\n${json}\n\`\`\``;
		const { fetchImpl } = createFakeFetch(okResponse(fenced));
		const result = await enrichNote(NOTE, FULL_CONFIG, fetchImpl);
		expect(result).toEqual({
			coreMeaning: "core",
			meaningMap: "map",
			usageNotes: "usage",
			memoryHooks: "hooks",
			reviewPrompt: "prompt",
		});
	});

	it("throws on malformed JSON content", async () => {
		const { fetchImpl } = createFakeFetch(okResponse("{not valid json"));
		await expect(enrichNote(NOTE, FULL_CONFIG, fetchImpl)).rejects.toThrow(/Failed to parse/i);
	});

	it("throws when required keys are missing from the JSON", async () => {
		const { fetchImpl } = createFakeFetch(okResponse(JSON.stringify({ exampleSentence: "e" })));
		await expect(enrichNote(NOTE, FULL_CONFIG, fetchImpl)).rejects.toThrow(
			/missing required keys/i,
		);
	});
});
