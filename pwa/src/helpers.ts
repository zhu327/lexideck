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
 * Returns ""-prefixed query. Optional offset for pagination.
 */
export function buildDueUrl(deckName: string | null, limit: number, offset?: number): string {
	const params: string[] = [];
	if (deckName !== null) {
		params.push(`deck=${encodeURIComponent(deckName)}`);
	}
	params.push(`limit=${limit}`);
	if (offset !== undefined && offset > 0) {
		params.push(`offset=${offset}`);
	}
	return `?${params.join("&")}`;
}

/**
 * Build the query string for `GET /api/review/quiz`.
 */
export function buildQuizUrl(deckName: string | null, limit: number): string {
	return buildDueUrl(deckName, limit);
}

/**
 * Build the query string for `GET /api/review/familiar`. Optional deck filter.
 */
export function buildFamiliarUrl(deckName?: string | null): string {
	return deckName ? `?deck=${encodeURIComponent(deckName)}` : "";
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

/**
 * Format a due timestamp into a human-readable interval string.
 */
export function formatInterval(nextDue: number, now?: number): string {
	const diff = nextDue - (now ?? Date.now());
	if (diff <= 0) return "now";
	if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
	if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
	if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
	if (diff < 2_592_000_000) return `${Math.round(diff / 86_400_000)}d`;
	return `${(diff / 2_592_000_000).toFixed(1)}mo`;
}

export const STATE_LABELS: Record<number, string> = {
	0: "New",
	1: "Learning",
	2: "Review",
	3: "Relearning",
};

export function stateLabel(state: number): string {
	return STATE_LABELS[state] ?? "Unknown";
}

export function stateClass(state: number): string {
	const labels: Record<number, string> = {
		0: "state-new",
		1: "state-learning",
		2: "state-review",
		3: "state-relearning",
	};
	return labels[state] ?? "state-unknown";
}
