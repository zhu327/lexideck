import type { NoteInput } from "./types";

export function buildEnrichmentPrompt(note: NoteInput): { system: string; user: string } {
	const system =
		"You are a vocabulary enrichment assistant. Return STRICT JSON only, with keys: exampleSentence, extendedDefinition, mnemonic. No markdown fences, no extra text.";
	const user = JSON.stringify({ word: note.word, fields: note.fields });
	return { system, user };
}
