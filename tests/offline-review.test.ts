/// <reference lib="dom" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewCardView } from "../pwa/src/api";

// ─── In-Memory IndexedDB Stub ─────────────────────────────────────

interface StubOptions {
	existingVersion?: number;
	existingStores?: string[];
}

function stubIndexedDbV2(options: StubOptions = {}) {
	const { existingVersion = 0, existingStores: initialStoreNames = [] } = options;

	const storeData = new Map<string, Map<unknown, Record<string, unknown>>>();
	const storeIndexes = new Map<string, Map<string, { keyPath: string; unique: boolean }>>();
	const storeMeta = new Map<string, { keyPath: string | string[]; autoIncrement: boolean }>();

	// Helper: extract key from item using keyPath
	function extractKey(item: Record<string, unknown>, keyPath: string | string[]): unknown {
		if (typeof keyPath === "string") return item[keyPath];
		return keyPath.map((k) => String(item[k])).join("::");
	}

	// Helper: filter items by IDBKeyRange-like query
	function matchesQuery(
		value: unknown,
		query: { lower?: unknown; upper?: unknown } | null,
	): boolean {
		if (!query) return true;
		if (query.lower !== undefined && (value as number) < (query.lower as number)) return false;
		if (query.upper !== undefined && (value as number) > (query.upper as number)) return false;
		return true;
	}

	// Helper: create a mock IDBRequest that resolves asynchronously
	function makeRequest(result: unknown) {
		const req: {
			result: unknown;
			error: unknown;
			onsuccess: (() => void) | null;
			onerror: (() => void) | null;
		} = {
			result: undefined,
			error: null,
			onsuccess: null,
			onerror: null,
		};
		queueMicrotask(() => {
			req.result = result;
			req.onsuccess?.();
		});
		return req;
	}

	function buildStoreRequest(name: string) {
		const data = storeData.get(name) ?? new Map();
		const meta = storeMeta.get(name) ?? { keyPath: "id", autoIncrement: false };

		return {
			put(item: Record<string, unknown>) {
				const key = extractKey(item, meta.keyPath);
				data.set(key, structuredClone(item));
				return makeRequest(key);
			},
			get(key: unknown) {
				const val = data.get(key);
				return makeRequest(val ? structuredClone(val) : undefined);
			},
			getAll() {
				return makeRequest(Array.from(data.values()).map((v) => structuredClone(v)));
			},
			delete(key: unknown) {
				data.delete(key);
				return makeRequest(undefined);
			},
			count(query?: { lower?: unknown; upper?: unknown } | null) {
				if (!query) return makeRequest(data.size);
				let c = 0;
				for (const k of data.keys()) {
					if (matchesQuery(k, query)) c++;
				}
				return makeRequest(c);
			},
			openCursor(range?: { lower?: unknown; upper?: unknown } | null, direction?: string) {
				let entries = Array.from(data.entries());
				if (range) {
					entries = entries.filter(([k]) => matchesQuery(k, range));
				}
				if (direction === "prev" || direction === "prevunique") {
					entries.reverse();
				}
				let idx = 0;
				const request: Record<string, unknown> = {
					result: null,
					onsuccess: null,
					onerror: null,
				};
				function fireNext() {
					queueMicrotask(() => {
						if (idx < entries.length) {
							const [key, value] = entries[idx++];
							request.result = {
								key,
								value: structuredClone(value),
								continue() {
									fireNext();
								},
							};
						} else {
							request.result = null;
						}
						(request.onsuccess as (() => void) | null)?.();
					});
				}
				// Start cursor iteration
				fireNext();
				return request;
			},
			index(indexName: string) {
				const indexDef = storeIndexes.get(name)?.get(indexName);
				if (!indexDef) throw new Error(`Index "${indexName}" not found on store "${name}"`);
				const idxKeyPath = indexDef.keyPath;
				// Build indexed entries sorted by index key
				const indexed = Array.from(data.values())
					.map((item) => ({ key: item[idxKeyPath], value: item }))
					.sort((a, b) => (a.key as number) - (b.key as number));

				return {
					getAll() {
						return makeRequest(indexed.map((e) => structuredClone(e.value)));
					},
					openCursor(range?: { lower?: unknown; upper?: unknown } | null, direction?: string) {
						let filtered = indexed;
						if (range) {
							filtered = filtered.filter((e) => matchesQuery(e.key, range));
						}
						if (direction === "prev" || direction === "prevunique") {
							filtered = filtered.reverse();
						}
						let idx = 0;
						const request: Record<string, unknown> = {
							result: null,
							onsuccess: null,
							onerror: null,
						};
						function fireNext() {
							queueMicrotask(() => {
								if (idx < filtered.length) {
									const entry = filtered[idx++];
									request.result = {
										key: entry.key,
										value: structuredClone(entry.value),
										continue() {
											fireNext();
										},
									};
								} else {
									request.result = null;
								}
								(request.onsuccess as (() => void) | null)?.();
							});
						}
						fireNext();
						return request;
					},
				};
			},
		};
	}

	const dbNames = new Set(initialStoreNames);
	// Initialize data for pre-existing stores
	for (const name of initialStoreNames) {
		if (!storeData.has(name)) {
			storeData.set(name, new Map());
		}
	}

	const db = {
		get objectStoreNames() {
			return {
				contains: (name: string) => dbNames.has(name),
				get length() {
					return dbNames.size;
				},
			};
		},
		createObjectStore(
			name: string,
			opts?: { keyPath?: string | string[]; autoIncrement?: boolean },
		) {
			dbNames.add(name);
			storeData.set(name, new Map());
			storeIndexes.set(name, new Map());
			storeMeta.set(name, {
				keyPath: opts?.keyPath ?? "id",
				autoIncrement: opts?.autoIncrement ?? false,
			});
			return {
				createIndex(idxName: string, keyPath: string, idxOpts?: { unique?: boolean }) {
					storeIndexes.get(name)?.set(idxName, {
						keyPath,
						unique: idxOpts?.unique ?? false,
					});
					return {};
				},
			};
		},
		deleteObjectStore(name: string) {
			dbNames.delete(name);
			storeData.delete(name);
			storeIndexes.delete(name);
			storeMeta.delete(name);
		},
		transaction(storeNamesArg: string | string[], _mode?: string) {
			const names = Array.isArray(storeNamesArg) ? storeNamesArg : [storeNamesArg];
			return {
				objectStore(name: string) {
					if (!names.includes(name)) {
						throw new Error(`Store "${name}" not in transaction scope`);
					}
					return buildStoreRequest(name);
				},
			};
		},
		close: vi.fn(),
	};

	vi.stubGlobal("indexedDB", {
		open(_name: string, version: number) {
			const req: {
				result: typeof db;
				error: unknown;
				onupgradeneeded: (() => void) | null;
				onsuccess: (() => void) | null;
				onerror: (() => void) | null;
			} = {
				result: db,
				error: null,
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
			};
			const needsUpgrade = version > existingVersion;
			queueMicrotask(() => {
				if (needsUpgrade) req.onupgradeneeded?.();
				req.onsuccess?.();
			});
			return req;
		},
	});

	return db;
}

// ─── Test Helpers ─────────────────────────────────────────────────

function makeCard(overrides: Partial<ReviewCardView> = {}): ReviewCardView {
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

describe("offline-review", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-29T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	// 1. IDB v2 schema
	it("opens with reviewOps and reviewQueues stores", async () => {
		const db = stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");
		// Trigger DB open by calling a function
		await mod.getPendingOps();
		expect(db.objectStoreNames.contains("reviewOps")).toBe(true);
		expect(db.objectStoreNames.contains("reviewQueues")).toBe(true);
	});

	// 2. Migration v1 → v2
	it("drops legacy reviews store and creates new stores on upgrade", async () => {
		const db = stubIndexedDbV2({ existingVersion: 1, existingStores: ["reviews"] });
		expect(db.objectStoreNames.contains("reviews")).toBe(true);

		const mod = await import("../pwa/src/offline-review");
		await mod.getPendingOps();

		expect(db.objectStoreNames.contains("reviews")).toBe(false);
		expect(db.objectStoreNames.contains("reviewOps")).toBe(true);
		expect(db.objectStoreNames.contains("reviewQueues")).toBe(true);
	});

	// 3. addReviewOp
	it("persists op with syncStatus pending and auto-generates clientOperationId", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const op = await mod.addReviewOp({
			cardId: "card-1",
			rating: 3,
			createdAt: Date.now(),
			scope: "all",
		});

		expect(op.clientOperationId).toBeTruthy();
		expect(typeof op.clientOperationId).toBe("string");
		expect(op.syncStatus).toBe("pending");
		expect(op.cardId).toBe("card-1");
		expect(op.rating).toBe(3);
		expect(op.scope).toBe("all");
	});

	// 4. getPendingOps
	it("returns only pending/syncing ops sorted by createdAt asc", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const now = Date.now();
		await mod.addReviewOp({ cardId: "c1", rating: 3, createdAt: now - 2000, scope: "all" });
		await mod.addReviewOp({ cardId: "c2", rating: 2, createdAt: now - 1000, scope: "all" });
		const op3 = await mod.addReviewOp({ cardId: "c3", rating: 4, createdAt: now, scope: "all" });
		await mod.markOpFailed(op3.clientOperationId, "test error");

		const pending = await mod.getPendingOps();
		expect(pending).toHaveLength(2);
		expect(pending[0].cardId).toBe("c1");
		expect(pending[1].cardId).toBe("c2");
		expect(pending[0].createdAt).toBeLessThan(pending[1].createdAt);
	});

	// 5. setOpSyncing
	it("updates status to syncing and op remains in getPendingOps", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const op = await mod.addReviewOp({
			cardId: "c1",
			rating: 3,
			createdAt: Date.now(),
			scope: "all",
		});
		await mod.setOpSyncing(op.clientOperationId);

		const pending = await mod.getPendingOps();
		expect(pending).toHaveLength(1);
		expect(pending[0].syncStatus).toBe("syncing");
	});

	// 6. deleteOp
	it("removes op so it no longer appears in getPendingOps", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const op = await mod.addReviewOp({
			cardId: "c1",
			rating: 3,
			createdAt: Date.now(),
			scope: "all",
		});
		await mod.deleteOp(op.clientOperationId);

		const pending = await mod.getPendingOps();
		expect(pending).toHaveLength(0);
	});

	// 7. markOpFailed
	it("sets failed + lastError and excludes from getPendingOps", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const op = await mod.addReviewOp({
			cardId: "c1",
			rating: 3,
			createdAt: Date.now(),
			scope: "all",
		});
		await mod.markOpFailed(op.clientOperationId, "network error");

		const pending = await mod.getPendingOps();
		expect(pending).toHaveLength(0);
	});

	// 8. countPendingOps
	it("returns count of pending/syncing ops", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const now = Date.now();
		await mod.addReviewOp({ cardId: "c1", rating: 3, createdAt: now, scope: "all" });
		await mod.addReviewOp({ cardId: "c2", rating: 2, createdAt: now, scope: "all" });

		const count = await mod.countPendingOps();
		expect(count).toBe(2);
	});

	// 9. saveReviewQueue + getReviewQueue
	it("stores queue and getReviewQueue returns it", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const cards = [makeCard()];
		await mod.saveReviewQueue({
			scope: "all",
			serviceDate: "2026-06-29",
			total: 1,
			cards,
		});

		const queue = await mod.getReviewQueue("all");
		expect(queue).not.toBeNull();
		expect(queue?.scope).toBe("all");
		expect(queue?.serviceDate).toBe("2026-06-29");
		expect(queue?.total).toBe(1);
		expect(queue?.cards).toHaveLength(1);
		expect(queue?.cachedAt).toBeGreaterThan(0);
	});

	// 10. saveReviewQueue overwrites
	it("second save replaces the first", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		await mod.saveReviewQueue({
			scope: "all",
			serviceDate: "2026-06-29",
			total: 1,
			cards: [makeCard()],
		});

		vi.advanceTimersByTime(1000);

		await mod.saveReviewQueue({
			scope: "all",
			serviceDate: "2026-06-29",
			total: 2,
			cards: [makeCard(), makeCard({ cardId: "card-2", noteId: "note-2" })],
		});

		const queue = await mod.getReviewQueue("all");
		expect(queue?.total).toBe(2);
		expect(queue?.cards).toHaveLength(2);
	});

	// 11. getReviewQueue returns null for unknown scope
	it("returns null for unknown scope", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const queue = await mod.getReviewQueue("deck:NonExistent");
		expect(queue).toBeNull();
	});

	// 12. appendReviewQueueCards
	it("appends cards to existing queue", async () => {
		stubIndexedDbV2();
		const mod = await import("../pwa/src/offline-review");

		const card1 = makeCard();
		await mod.saveReviewQueue({
			scope: "all",
			serviceDate: "2026-06-29",
			total: 5,
			cards: [card1],
		});

		const card2 = makeCard({ cardId: "card-2", noteId: "note-2" });
		await mod.appendReviewQueueCards("all", [card2], 5);

		const queue = await mod.getReviewQueue("all");
		expect(queue?.cards).toHaveLength(2);
		expect(queue?.total).toBe(5);
		expect(queue?.cards[1].cardId).toBe("card-2");
	});

	// 13. todayServiceDate
	it("returns YYYY-MM-DD format", async () => {
		const mod = await import("../pwa/src/offline-review");
		const result = mod.todayServiceDate();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	// 14. scopeForDeck
	it('null → "all", name → "deck:name"', async () => {
		const mod = await import("../pwa/src/offline-review");
		expect(mod.scopeForDeck(null)).toBe("all");
		expect(mod.scopeForDeck("MyDeck")).toBe("deck:MyDeck");
	});
});
