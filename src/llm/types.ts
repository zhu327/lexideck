export interface NoteInput {
	word: string;
	fields: Record<string, string>;
}

export interface Enrichment {
	exampleSentence: string;
	extendedDefinition: string;
	mnemonic: string;
}

export interface LlmConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
}

export class LlmNotConfiguredError extends Error {
	constructor(message = "LLM is not configured") {
		super(message);
		this.name = "LlmNotConfiguredError";
	}
}

export class LlmRequestError extends Error {
	status: number;

	constructor(status: number, message = `LLM request failed with status ${status}`) {
		super(message);
		this.name = "LlmRequestError";
		this.status = status;
	}
}
