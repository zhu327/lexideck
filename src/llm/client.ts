import type { Env } from "../env";
import { buildEnrichmentPrompt } from "./prompts";
import type { Enrichment, LlmConfig, NoteInput } from "./types";
import { LlmNotConfiguredError, LlmRequestError } from "./types";

export function readLlmConfig(
	env: Pick<Env, "LLM_API_KEY" | "LLM_BASE_URL" | "LLM_MODEL">,
): LlmConfig | null {
	const apiKey = env.LLM_API_KEY;
	const baseUrl = env.LLM_BASE_URL;
	const model = env.LLM_MODEL;
	if (!apiKey || !baseUrl || !model) {
		return null;
	}
	return { apiKey, baseUrl, model };
}

export async function enrichNote(
	note: NoteInput,
	config: LlmConfig | null,
	fetchImpl: typeof fetch = fetch,
): Promise<Enrichment> {
	if (!config) {
		throw new LlmNotConfiguredError();
	}
	const { system, user } = buildEnrichmentPrompt(note);
	const url = `${config.baseUrl}/chat/completions`;
	const body = {
		model: config.model,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		temperature: 0.7,
	};
	const res = await fetchImpl(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new LlmRequestError(res.status);
	}
	const data = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
	};
	const content = data.choices?.[0]?.message?.content;
	if (typeof content !== "string") {
		throw new Error("LLM response is missing choices[0].message.content");
	}
	const stripped = stripFences(content);
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripped);
	} catch (error) {
		throw new Error(`Failed to parse LLM JSON content: ${(error as Error).message}`);
	}
	const obj = parsed as Record<string, unknown>;
	const { exampleSentence, extendedDefinition, mnemonic } = obj;
	if (
		typeof exampleSentence !== "string" ||
		typeof extendedDefinition !== "string" ||
		typeof mnemonic !== "string"
	) {
		throw new Error(
			"LLM JSON is missing required keys: exampleSentence, extendedDefinition, mnemonic",
		);
	}
	return { exampleSentence, extendedDefinition, mnemonic };
}

function stripFences(content: string): string {
	const trimmed = content.trim();
	const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
	return match ? match[1] : trimmed;
}
