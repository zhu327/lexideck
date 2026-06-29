import { fetchDue, type ReviewCardView } from "./api";
import { errorMessage } from "./helpers";
import {
	appendReviewQueueCards,
	getReviewQueue,
	saveReviewQueue,
	scopeForDeck,
	todayServiceDate,
} from "./offline-review";

const BATCH_LIMIT = 50;

export interface ReviewSession {
	offset: number;
	cards: ReviewCardView[];
	total: number;
	cleanupKeys: (() => void) | null;
	deck: string | null;
	scope: string;
	offlineCached: boolean;
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
		scope: scopeForDeck(deck),
		offlineCached: false,
	};
}

/**
 * Determine if an error is a network-level failure (offline, fetch TypeError, timeout).
 * HTTP business errors (401, 400, etc.) are NOT network errors.
 */
function isNetworkError(err: unknown): boolean {
	if (err instanceof TypeError) return true;
	if (!navigator.onLine) return true;
	// Check for HTTP error messages (business errors)
	if (err instanceof Error && err.message.startsWith("HTTP ")) return false;
	return false;
}

/**
 * Fetch the initial batch of due cards into the session.
 * On network failure, falls back to a cached queue for today.
 * Cache-write failure is non-fatal (best-effort).
 */
export async function loadInitialBatch(session: ReviewSession): Promise<void> {
	let fetchResult: { cards: ReviewCardView[]; total: number };
	try {
		fetchResult = await fetchDue(session.deck, BATCH_LIMIT, session.offset);
	} catch (err) {
		// Only fallback on network-level errors, not business errors
		if (!isNetworkError(err)) throw err;

		// Network failure — try cached queue
		const cached = await getReviewQueue(session.scope);
		if (cached && cached.serviceDate === todayServiceDate()) {
			session.cards = cached.cards;
			session.total = cached.total;
			session.offset = cached.cards.length;
			session.offlineCached = true;
			return;
		}
		throw err;
	}
	// Network succeeded — update session, then best-effort cache write
	session.cards = fetchResult.cards;
	session.total = fetchResult.total;
	session.offset += fetchResult.cards.length;
	try {
		await saveReviewQueue({
			scope: session.scope,
			serviceDate: todayServiceDate(),
			total: fetchResult.total,
			cards: fetchResult.cards,
		});
	} catch {
		// Cache write failure is non-fatal
	}
}

/**
 * Load the next batch of cards when the current batch is exhausted.
 * Returns the new cards loaded, or null if no more cards.
 */
export async function loadNextBatch(session: ReviewSession): Promise<ReviewCardView[] | null> {
	try {
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
		await appendReviewQueueCards(session.scope, nextCards, nextTotal);
		return nextCards;
	} catch {
		return null;
	}
}

/**
 * Extract error message from a caught value, prefixed with context.
 */
export function batchErrorMessage(err: unknown, prefix: string): string {
	return `${prefix}: ${errorMessage(err)}`;
}
