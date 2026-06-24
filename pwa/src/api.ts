import { buildDueUrl, buildQuizUrl, enrichUnavailableMessage, type Rating } from "./helpers";

export interface ReviewCardView {
	cardId: string;
	noteId: string;
	deckName: string;
	modelName: string;
	fields: Record<string, string>;
	tags: string[];
	state: number;
	due: number;
}

export interface Enrichment {
	exampleSentence: string;
	extendedDefinition: string;
	mnemonic: string;
}

async function expectJson<T>(res: Response): Promise<T> {
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as T;
}

export async function fetchDue(deckName?: string | null, limit = 20): Promise<ReviewCardView[]> {
	const res = await fetch(`/api/review/due${buildDueUrl(deckName ?? null, limit)}`);
	return expectJson<ReviewCardView[]>(res);
}

export async function submitReview(cardId: string, rating: Rating): Promise<{ due: number }> {
	const res = await fetch("/api/review/submit", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ cardId, rating }),
	});
	return expectJson<{ due: number }>(res);
}

export async function fetchQuiz(deckName?: string | null, limit = 20): Promise<ReviewCardView[]> {
	const res = await fetch(`/api/review/quiz${buildQuizUrl(deckName ?? null, limit)}`);
	return expectJson<ReviewCardView[]>(res);
}

export async function markFamiliar(noteId: string): Promise<void> {
	const res = await fetch("/api/review/familiar", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ noteId }),
	});
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} ${res.statusText}`);
	}
}

export async function enrichNote(noteId: string): Promise<Enrichment | { error: string }> {
	const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/enrich`, {
		method: "POST",
	});
	if (!res.ok) {
		return { error: enrichUnavailableMessage(res.status) };
	}
	return (await res.json()) as Enrichment;
}
