/// <reference lib="dom" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── In-Memory Stubs ──────────────────────────────────────────────

class MemoryStorage {
	private readonly values = new Map<string, string>();
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
}

interface StubOptions {
	existingVersion?: number;
	existingStores?: string[];
}

function stubIndexedDbV2(options: StubOptions = {}) {
	const { existingVersion = 0, existingStores: initialStoreNames = [] } = options;

	const storeData = new Map<string, Map<unknown, Record<string, unknown>>>();
	const storeIndexes = new Map<string, Map<string, { keyPath: string; unique: boolean }>>();
	const storeMeta = new Map<string, { keyPath: string | string[]; autoIncrement: boolean }>();

	function extractKey(item: Record<string, unknown>, keyPath: string | string[]): unknown {
		if (typeof keyPath === "string") return item[keyPath];
		return keyPath.map((k) => String(item[k])).join("::");
	}

	function matchesQuery(
		value: unknown,
		query: { lower?: unknown; upper?: unknown } | null,
	): boolean {
		if (!query) return true;
		if (query.lower !== undefined && (value as number) < (query.lower as number)) return false;
		if (query.upper !== undefined && (value as number) > (query.upper as number)) return false;
		return true;
	}

	function makeRequest(result: unknown) {
		const req: {
			result: unknown;
			error: unknown;
			onsuccess: (() => void) | null;
			onerror: (() => void) | null;
		} = { result: undefined, error: null, onsuccess: null, onerror: null };
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
			index(indexName: string) {
				const indexDef = storeIndexes.get(name)?.get(indexName);
				if (!indexDef) throw new Error(`Index "${indexName}" not found on store "${name}"`);
				const idxKeyPath = indexDef.keyPath;
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
	for (const name of initialStoreNames) {
		if (!storeData.has(name)) storeData.set(name, new Map());
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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function errorResponse(status: number, statusText = ""): Response {
	return new Response(null, { status, statusText });
}

// ─── Tests ────────────────────────────────────────────────────────

describe("offline review integration flow", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-29T00:00:00Z"));
		vi.stubGlobal("localStorage", new MemoryStorage());
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	// 1. Full online → offline → sync flow
	it("full online → offline → sync flow", async () => {
		stubIndexedDbV2();

		// Mutable navigator so we can toggle onLine mid-test
		const nav = { onLine: true };
		vi.stubGlobal("navigator", nav);

		const cards = [makeCard(), makeCard({ cardId: "card-2", noteId: "note-2" })];
		const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async (input: RequestInfo | URL) => {
				const url = String(input);
				// GET /api/review/due → return due cards
				if (url.includes("/api/review/due")) {
					return jsonResponse({ cards, total: 10 });
				}
				// POST /api/review/submit → success
				if (url.includes("/api/review/submit")) {
					return jsonResponse({ due: Date.now() + 60_000 });
				}
				throw new Error(`Unexpected fetch: ${url}`);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		// ── Online: load initial batch ───────────────────────
		const session = await import("../pwa/src/review-session");
		const offlineReview = await import("../pwa/src/offline-review");
		const api = await import("../pwa/src/api");

		const s1 = session.createSession(null);
		await session.loadInitialBatch(s1);

		expect(s1.cards).toHaveLength(2);
		expect(s1.total).toBe(10);
		expect(s1.offlineCached).toBe(false);

		// Verify queue is cached in IDB
		const queue = await offlineReview.getReviewQueue("all");
		expect(queue).not.toBeNull();
		expect(queue?.cards).toHaveLength(2);
		expect(queue?.serviceDate).toBe("2026-06-29");

		// ── Go offline ───────────────────────────────────────
		nav.onLine = false;
		fetchMock.mockImplementation(async () => {
			throw new TypeError("Failed to fetch");
		});

		// Restart session → loads from cache
		const s2 = session.createSession(null);
		await session.loadInitialBatch(s2);

		expect(s2.cards).toHaveLength(2);
		expect(s2.offlineCached).toBe(true);

		// Submit 3 ratings offline
		for (let i = 0; i < 3; i++) {
			const result = await api.submitReview(`card-${i + 10}`, 3, "all");
			expect(result.queued).toBe(true);
		}

		// Verify 3 ops in IDB
		const pendingOps = await offlineReview.getPendingOps();
		expect(pendingOps).toHaveLength(3);

		// ── Go online and sync ───────────────────────────────
		nav.onLine = true;
		fetchMock.mockImplementation(async () => jsonResponse({ due: Date.now() + 60_000 }));

		const sync = await import("../pwa/src/review-sync");
		const syncResult = await sync.syncReviewOps();

		expect(syncResult.synced).toBe(3);
		expect(syncResult.remaining).toBe(0);
		expect(syncResult.stoppedReason).toBeUndefined();

		// Verify all ops deleted
		const afterSync = await offlineReview.getPendingOps();
		expect(afterSync).toHaveLength(0);

		const status = await sync.getSyncStatus();
		expect(status.pendingCount).toBe(0);
	});

	// 2. Partial sync (network failure mid-way)
	it("partial sync: network failure stops after first op", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });

		const offlineReview = await import("../pwa/src/offline-review");

		// Seed 3 pending ops in IDB
		const now = Date.now();
		await offlineReview.addReviewOp({
			cardId: "c1",
			rating: 3,
			createdAt: now - 3000,
			scope: "all",
		});
		await offlineReview.addReviewOp({
			cardId: "c2",
			rating: 2,
			createdAt: now - 2000,
			scope: "all",
		});
		await offlineReview.addReviewOp({
			cardId: "c3",
			rating: 4,
			createdAt: now - 1000,
			scope: "all",
		});

		// First call returns 200, second throws TypeError (network)
		const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
		fetchMock.mockResolvedValueOnce(jsonResponse({ due: 100 }));
		fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		vi.stubGlobal("fetch", fetchMock);

		const sync = await import("../pwa/src/review-sync");
		const result = await sync.syncReviewOps();

		expect(result.synced).toBe(1);
		expect(result.stoppedReason).toBe("network");

		// 2 ops still pending (the second was set to syncing but never deleted,
		// and the third was never touched)
		const remaining = await offlineReview.getPendingOps();
		expect(remaining.length).toBe(2);
	});

	// 3. Stale cache rejection
	it("stale cache: loadInitialBatch throws when cache serviceDate is yesterday", async () => {
		stubIndexedDbV2();

		const nav = { onLine: false };
		vi.stubGlobal("navigator", nav);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);

		const offlineReview = await import("../pwa/src/offline-review");
		const session = await import("../pwa/src/review-session");

		// Pre-populate IDB with a cache from yesterday
		await offlineReview.saveReviewQueue({
			scope: "all",
			serviceDate: "2026-06-28", // yesterday
			total: 5,
			cards: [makeCard()],
		});

		const s = session.createSession(null);
		await expect(session.loadInitialBatch(s)).rejects.toThrow();
		expect(s.offlineCached).toBe(false);
	});

	// 4. Error differentiation in flow
	it("error differentiation: 401 not enqueued, TypeError enqueued", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });

		const offlineReview = await import("../pwa/src/offline-review");

		// ── Submit 1: fetch returns 401 → auth error, NOT enqueued ──
		const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
		vi.stubGlobal("fetch", fetchMock);

		const api = await import("../pwa/src/api");

		fetchMock.mockResolvedValueOnce(errorResponse(401));
		await expect(api.submitReview("card-auth", 3, "all")).rejects.toThrow(api.ReviewSubmitError);

		try {
			fetchMock.mockResolvedValueOnce(errorResponse(401));
			await api.submitReview("card-auth", 3, "all");
		} catch (e) {
			const err = e as InstanceType<typeof api.ReviewSubmitError>;
			expect(err.kind).toBe("auth");
		}

		// ── Submit 2: fetch throws TypeError → enqueued ──
		fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		const result = await api.submitReview("card-network", 3, "all");
		expect(result.queued).toBe(true);

		// Only the network failure op is in IDB
		const ops = await offlineReview.getPendingOps();
		expect(ops).toHaveLength(1);
		expect(ops[0].cardId).toBe("card-network");
	});

	// 5. Server-priority refresh (409)
	it("server-priority: 409 response throws ReviewSubmitError and does NOT enqueue", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => errorResponse(409)),
		);

		const api = await import("../pwa/src/api");
		const offlineReview = await import("../pwa/src/offline-review");

		try {
			await api.submitReview("card-conflict", 3, "all");
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as InstanceType<typeof api.ReviewSubmitError>;
			expect(err).toBeInstanceOf(api.ReviewSubmitError);
			expect(err.kind).toBe("server-priority");
			expect(err.status).toBe(409);
		}

		const ops = await offlineReview.getPendingOps();
		expect(ops).toHaveLength(0);
	});
});
