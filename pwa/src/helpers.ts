// Pure helpers (no DOM) — imported by tests/pwa-helpers.test.ts, so this
// module IS covered by the root `tsc --noEmit` (lib: es2022, no DOM). Keep it
// free of any browser/Worker globals.

export type Rating = 1 | 2 | 3 | 4;

export const RATING_LABELS: Record<Rating, string> = {
	1: "Again",
	2: "Hard",
	3: "Good",
	4: "Easy",
};

/**
 * Build the query string for `GET /api/review/due`.
 * Returns ""-prefixed query: "?limit=20" or "?deck=<enc>&limit=20".
 */
export function buildDueUrl(deckName: string | null, limit: number): string {
	return buildReviewQuery(deckName, limit);
}

/**
 * Build the query string for `GET /api/review/quiz`. Same shape as due.
 */
export function buildQuizUrl(deckName: string | null, limit: number): string {
	return buildReviewQuery(deckName, limit);
}

function buildReviewQuery(deckName: string | null, limit: number): string {
	if (deckName === null) {
		return `?limit=${limit}`;
	}
	return `?deck=${encodeURIComponent(deckName)}&limit=${limit}`;
}

/**
 * Human message for a failed `/api/notes/:id/enrich` request. HTTP 503 means
 * the LLM backing the enrichment endpoint is not configured; anything else is
 * a generic transient/unknown failure.
 */
export function enrichUnavailableMessage(status: number): string {
	if (status === 503) {
		return "LLM not configured";
	}
	return `Enrichment unavailable (status ${status})`;
}

/**
 * Extract a human-readable message from an unknown thrown value. Fetch and
 * JSON errors are Error instances; non-Error throws are stringified.
 */
export function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}
