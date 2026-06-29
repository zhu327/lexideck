/// <reference lib="dom" />

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pwa/src/api", () => ({
	fetchDue: vi.fn(),
}));

vi.mock("../pwa/src/offline-review", () => ({
	saveReviewQueue: vi.fn(),
	getReviewQueue: vi.fn(),
	appendReviewQueueCards: vi.fn(),
	todayServiceDate: vi.fn(() => "2026-06-29"),
	scopeForDeck: vi.fn((deck: string | null) => (deck ? `deck:${deck}` : "all")),
}));

// ─── Helpers ──────────────────────────────────────────────────────

function makeCard(overrides: Record<string, unknown> = {}) {
	return {
		cardId: "card-1",
		noteId: "note-1",
		deckName: "Default",
		modelName: "Basic",
		fields: { Front: "hello", Back: "world" },
		tags: [],
		state: 2,
		due: Date.now(),
		...overrides,
	};
}

// ─── Tests ────────────────────────────────────────────────────────

describe("review-session", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	// --- Scope computation ---

	it("createSession(null) → scope is 'all'", async () => {
		const { createSession } = await import("../pwa/src/review-session");
		const session = createSession(null);
		expect(session.scope).toBe("all");
	});

	it("createSession('Japanese') → scope is 'deck:Japanese'", async () => {
		const { createSession } = await import("../pwa/src/review-session");
		const session = createSession("Japanese");
		expect(session.scope).toBe("deck:Japanese");
	});

	// --- Initial state ---

	it("createSession → offlineCached is false", async () => {
		const { createSession } = await import("../pwa/src/review-session");
		const session = createSession(null);
		expect(session.offlineCached).toBe(false);
	});

	// --- Online success: loadInitialBatch ---

	it("loadInitialBatch: fetchDue succeeds → calls saveReviewQueue with correct args", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { saveReviewQueue } = await import("../pwa/src/offline-review");
		const { createSession, loadInitialBatch } = await import("../pwa/src/review-session");

		const cards = [makeCard(), makeCard({ cardId: "card-2", noteId: "note-2" })];
		vi.mocked(fetchDue).mockResolvedValue({ cards, total: 10 });
		vi.mocked(saveReviewQueue).mockResolvedValue(undefined);

		const session = createSession(null);
		await loadInitialBatch(session);

		expect(session.cards).toEqual(cards);
		expect(session.total).toBe(10);
		expect(session.offset).toBe(2);
		expect(session.offlineCached).toBe(false);

		expect(saveReviewQueue).toHaveBeenCalledOnce();
		expect(saveReviewQueue).toHaveBeenCalledWith({
			scope: "all",
			serviceDate: "2026-06-29",
			total: 10,
			cards,
		});
	});

	// --- Online success: loadNextBatch ---

	it("loadNextBatch: fetchDue succeeds → calls appendReviewQueueCards", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { appendReviewQueueCards } = await import("../pwa/src/offline-review");
		const { createSession, loadNextBatch } = await import("../pwa/src/review-session");

		const nextCards = [makeCard({ cardId: "card-3", noteId: "note-3" })];
		vi.mocked(fetchDue).mockResolvedValue({ cards: nextCards, total: 15 });
		vi.mocked(appendReviewQueueCards).mockResolvedValue(undefined);

		const session = createSession("Japanese");
		session.offset = 5;
		session.cards = [makeCard()];
		session.total = 15;

		const result = await loadNextBatch(session);

		expect(result).toEqual(nextCards);
		expect(session.cards).toEqual(nextCards);
		expect(session.total).toBe(15);
		expect(session.offset).toBe(6);

		expect(appendReviewQueueCards).toHaveBeenCalledOnce();
		expect(appendReviewQueueCards).toHaveBeenCalledWith("deck:Japanese", nextCards, 15);
	});

	// --- Offline fallback: loadInitialBatch with valid cache ---

	it("loadInitialBatch: fetchDue throws → cached queue with matching date → loads cache", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { getReviewQueue } = await import("../pwa/src/offline-review");
		const { createSession, loadInitialBatch } = await import("../pwa/src/review-session");

		const networkError = new TypeError("Failed to fetch");
		vi.mocked(fetchDue).mockRejectedValue(networkError);

		const cachedCards = [makeCard({ cardId: "cached-1" }), makeCard({ cardId: "cached-2" })];
		vi.mocked(getReviewQueue).mockResolvedValue({
			scope: "all",
			cachedAt: Date.now() - 60000,
			serviceDate: "2026-06-29",
			total: 5,
			cards: cachedCards,
		});

		const session = createSession(null);
		await loadInitialBatch(session);

		expect(session.cards).toEqual(cachedCards);
		expect(session.total).toBe(5);
		expect(session.offset).toBe(2);
		expect(session.offlineCached).toBe(true);
	});

	it("loadInitialBatch: HTTP auth error does not fallback to cached queue", async () => {
		vi.stubGlobal("navigator", { onLine: true });
		const { fetchDue } = await import("../pwa/src/api");
		const { getReviewQueue } = await import("../pwa/src/offline-review");
		const { createSession, loadInitialBatch } = await import("../pwa/src/review-session");

		vi.mocked(fetchDue).mockRejectedValue(new Error("HTTP 401 Unauthorized"));
		vi.mocked(getReviewQueue).mockResolvedValue({
			scope: "all",
			cachedAt: Date.now(),
			serviceDate: "2026-06-29",
			total: 1,
			cards: [makeCard()],
		});

		const session = createSession(null);
		await expect(loadInitialBatch(session)).rejects.toThrow("HTTP 401 Unauthorized");
		expect(getReviewQueue).not.toHaveBeenCalled();
		expect(session.offlineCached).toBe(false);
	});

	// --- Offline fallback: no cache → throws ---

	it("loadInitialBatch: fetchDue throws → no cache → throws original error", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { getReviewQueue } = await import("../pwa/src/offline-review");
		const { createSession, loadInitialBatch } = await import("../pwa/src/review-session");

		const networkError = new TypeError("Failed to fetch");
		vi.mocked(fetchDue).mockRejectedValue(networkError);
		vi.mocked(getReviewQueue).mockResolvedValue(null);

		const session = createSession(null);
		await expect(loadInitialBatch(session)).rejects.toThrow("Failed to fetch");
		expect(session.offlineCached).toBe(false);
	});

	// --- Offline fallback: stale cache → throws ---

	it("loadInitialBatch: fetchDue throws → cache with stale date → throws original error", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { getReviewQueue } = await import("../pwa/src/offline-review");
		const { createSession, loadInitialBatch } = await import("../pwa/src/review-session");

		const networkError = new Error("HTTP 503 Service Unavailable");
		vi.mocked(fetchDue).mockRejectedValue(networkError);

		vi.mocked(getReviewQueue).mockResolvedValue({
			scope: "all",
			cachedAt: Date.now() - 86400000,
			serviceDate: "2026-06-28", // yesterday
			total: 3,
			cards: [makeCard()],
		});

		const session = createSession(null);
		await expect(loadInitialBatch(session)).rejects.toThrow("HTTP 503 Service Unavailable");
		expect(session.offlineCached).toBe(false);
	});

	// --- loadNextBatch offline → returns null ---

	it("loadNextBatch: fetchDue throws → returns null", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { createSession, loadNextBatch } = await import("../pwa/src/review-session");

		vi.mocked(fetchDue).mockRejectedValue(new TypeError("Failed to fetch"));

		const session = createSession(null);
		session.offset = 5;
		session.cards = [makeCard()];

		const result = await loadNextBatch(session);
		expect(result).toBeNull();
	});

	// --- loadNextBatch with no more cards ---

	it("loadNextBatch: fetchDue returns empty cards → returns null, does NOT call appendReviewQueueCards", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { appendReviewQueueCards } = await import("../pwa/src/offline-review");
		const { createSession, loadNextBatch } = await import("../pwa/src/review-session");

		vi.mocked(fetchDue).mockResolvedValue({ cards: [], total: 5 });

		const session = createSession(null);
		session.offset = 5;

		const result = await loadNextBatch(session);
		expect(result).toBeNull();
		expect(appendReviewQueueCards).not.toHaveBeenCalled();
	});

	// --- loadInitialBatch with deck scope ---

	it("loadInitialBatch: with deck → scopeForDeck is used for saveReviewQueue", async () => {
		const { fetchDue } = await import("../pwa/src/api");
		const { saveReviewQueue } = await import("../pwa/src/offline-review");
		const { createSession, loadInitialBatch } = await import("../pwa/src/review-session");

		const cards = [makeCard()];
		vi.mocked(fetchDue).mockResolvedValue({ cards, total: 1 });
		vi.mocked(saveReviewQueue).mockResolvedValue(undefined);

		const session = createSession("Japanese");
		await loadInitialBatch(session);

		expect(saveReviewQueue).toHaveBeenCalledWith({
			scope: "deck:Japanese",
			serviceDate: "2026-06-29",
			total: 1,
			cards,
		});
	});
});
