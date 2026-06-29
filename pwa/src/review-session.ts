import { fetchDue, type ReviewCardView } from "./api";
import { errorMessage } from "./helpers";

const BATCH_LIMIT = 50;

export interface ReviewSession {
	offset: number;
	cards: ReviewCardView[];
	total: number;
	cleanupKeys: (() => void) | null;
	deck: string | null;
}

/**
 * Create an initial empty review session for the given deck.
 */
export function createSession(deck: string | null): ReviewSession {
	return {
		offset: 0,
		cards: [],
		total: 0,
		cleanupKeys: null,
		deck,
	};
}

/**
 * Fetch the initial batch of due cards into the session.
 */
export async function loadInitialBatch(session: ReviewSession): Promise<void> {
	const { cards, total } = await fetchDue(session.deck, BATCH_LIMIT, session.offset);
	session.cards = cards;
	session.total = total;
	session.offset += cards.length;
}

/**
 * Load the next batch of cards when the current batch is exhausted.
 * Returns the new cards loaded, or null if no more cards.
 */
export async function loadNextBatch(session: ReviewSession): Promise<ReviewCardView[] | null> {
	const { cards: nextCards, total: nextTotal } = await fetchDue(
		session.deck,
		BATCH_LIMIT,
		session.offset,
	);
	session.total = nextTotal;
	if (nextCards.length === 0) {
		return null;
	}
	session.cards = nextCards;
	session.offset += nextCards.length;
	return nextCards;
}

/**
 * Extract error message from a caught value, prefixed with context.
 */
export function batchErrorMessage(err: unknown, prefix: string): string {
	return `${prefix}: ${errorMessage(err)}`;
}
