/// <reference lib="dom" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitResult } from "../pwa/src/api";
import type { QueuedReviewOp } from "../pwa/src/offline-review";

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
			count() {
				return makeRequest(data.size);
			},
			createIndex() {
				return {};
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

// ─── Tests ────────────────────────────────────────────────────────

describe("submitReview", () => {
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

	// ── Enqueue scenarios ──────────────────────────────────────────

	it("1. fetch throws TypeError with navigator.onLine=true → queued with reason offline", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Load failed");
			}),
		);

		const { submitReview } = await import("../pwa/src/api");
		const result: SubmitResult = await submitReview("card-1", 3, "all");

		expect(result).toEqual({
			due: Date.now() + 60_000,
			queued: true,
			queuedReason: "offline",
		});

		// Op persisted in IDB
		const { getPendingOps } = await import("../pwa/src/offline-review");
		const ops = await getPendingOps();
		expect(ops).toHaveLength(1);
		expect(ops[0].cardId).toBe("card-1");
	});

	it("2. fetch throws TypeError with navigator.onLine=false → enqueued", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: false });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Load failed");
			}),
		);

		const { submitReview } = await import("../pwa/src/api");
		const result = await submitReview("card-1", 3, "all");

		expect(result).toEqual({
			due: Date.now() + 60_000,
			queued: true,
			queuedReason: "offline",
		});
	});

	it("3. fetch returns 503 → enqueued with reason server-error", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 503, statusText: "Service Unavailable" })),
		);

		const { submitReview } = await import("../pwa/src/api");
		const result = await submitReview("card-1", 3, "all");

		expect(result).toEqual({
			due: Date.now() + 60_000,
			queued: true,
			queuedReason: "server-error",
		});

		const { getPendingOps } = await import("../pwa/src/offline-review");
		const ops = await getPendingOps();
		expect(ops).toHaveLength(1);
	});

	it("throws offline-storage when IndexedDB cannot save queued review", async () => {
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal("indexedDB", {
			open() {
				const req: {
					result: unknown;
					error: unknown;
					onupgradeneeded: (() => void) | null;
					onsuccess: (() => void) | null;
					onerror: (() => void) | null;
				} = {
					result: null,
					error: new Error("IDB unavailable"),
					onupgradeneeded: null,
					onsuccess: null,
					onerror: null,
				};
				queueMicrotask(() => req.onerror?.());
				return req;
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Load failed");
			}),
		);

		const { submitReview, ReviewSubmitError } = await import("../pwa/src/api");

		try {
			await submitReview("card-1", 3, "all");
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as InstanceType<typeof ReviewSubmitError>;
			expect(err).toBeInstanceOf(ReviewSubmitError);
			expect(err.kind).toBe("offline-storage");
		}
	});

	it("removes queued card from cached review queue after offline save", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Load failed");
			}),
		);

		const { submitReview } = await import("../pwa/src/api");
		const { getReviewQueue, saveReviewQueue } = await import("../pwa/src/offline-review");
		await saveReviewQueue({
			scope: "all",
			serviceDate: "2026-06-29",
			total: 2,
			cards: [
				{
					cardId: "card-1",
					noteId: "note-1",
					deckName: "Default",
					modelName: "Basic",
					fields: { Front: "hello", Back: "world" },
					tags: [],
					state: 2,
					due: Date.now(),
				},
				{
					cardId: "card-2",
					noteId: "note-2",
					deckName: "Default",
					modelName: "Basic",
					fields: { Front: "bye", Back: "world" },
					tags: [],
					state: 2,
					due: Date.now(),
				},
			],
		});

		await submitReview("card-1", 3, "all");

		const queue = await getReviewQueue("all");
		expect(queue?.cards.map((c) => c.cardId)).toEqual(["card-2"]);
	});

	it("registers background sync after offline save when supported", async () => {
		stubIndexedDbV2();
		const register = vi.fn(async () => undefined);
		vi.stubGlobal("navigator", {
			onLine: true,
			serviceWorker: {
				ready: Promise.resolve({ sync: { register } }),
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Load failed");
			}),
		);

		const { submitReview } = await import("../pwa/src/api");
		await submitReview("card-1", 3, "all");

		expect(register).toHaveBeenCalledWith("sync-reviews");
	});

	// ── Non-enqueue scenarios ──────────────────────────────────────

	it("4. fetch returns 401 → throws ReviewSubmitError auth, no op", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 401 })),
		);

		const { submitReview, ReviewSubmitError } = await import("../pwa/src/api");
		await expect(submitReview("card-1", 3, "all")).rejects.toThrow(ReviewSubmitError);

		try {
			await submitReview("card-1", 3, "all");
		} catch (e) {
			const err = e as InstanceType<typeof ReviewSubmitError>;
			expect(err.kind).toBe("auth");
			expect(err.status).toBe(401);
		}

		const { getPendingOps } = await import("../pwa/src/offline-review");
		const ops = await getPendingOps();
		expect(ops).toHaveLength(0);
	});

	it("5. fetch returns 400 → throws ReviewSubmitError client, no op", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 400 })),
		);

		const { submitReview, ReviewSubmitError } = await import("../pwa/src/api");

		try {
			await submitReview("card-1", 3, "all");
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as InstanceType<typeof ReviewSubmitError>;
			expect(err).toBeInstanceOf(ReviewSubmitError);
			expect(err.kind).toBe("client");
			expect(err.status).toBe(400);
		}

		const { getPendingOps } = await import("../pwa/src/offline-review");
		const ops = await getPendingOps();
		expect(ops).toHaveLength(0);
	});

	it("6. fetch returns 404 → throws ReviewSubmitError server-priority, no op", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 404 })),
		);

		const { submitReview, ReviewSubmitError } = await import("../pwa/src/api");

		try {
			await submitReview("card-1", 3, "all");
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as InstanceType<typeof ReviewSubmitError>;
			expect(err).toBeInstanceOf(ReviewSubmitError);
			expect(err.kind).toBe("server-priority");
			expect(err.status).toBe(404);
		}

		const { getPendingOps } = await import("../pwa/src/offline-review");
		const ops = await getPendingOps();
		expect(ops).toHaveLength(0);
	});

	it("7. fetch returns 409 → throws ReviewSubmitError server-priority, no op", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 409 })),
		);

		const { submitReview, ReviewSubmitError } = await import("../pwa/src/api");

		try {
			await submitReview("card-1", 3, "all");
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as InstanceType<typeof ReviewSubmitError>;
			expect(err).toBeInstanceOf(ReviewSubmitError);
			expect(err.kind).toBe("server-priority");
			expect(err.status).toBe(409);
		}
	});

	// ── Happy path ─────────────────────────────────────────────────

	it("8. fetch returns 200 with due → returns due", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ due: 123456 }), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
			),
		);

		const { submitReview } = await import("../pwa/src/api");
		const result = await submitReview("card-1", 3, "all");

		expect(result).toEqual({ due: 123456 });
	});

	// ── Op shape verification ──────────────────────────────────────

	it("9. enqueued op has correct shape", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Load failed");
			}),
		);

		const { submitReview } = await import("../pwa/src/api");
		await submitReview("card-1", 3, "deck:MyDeck");

		const { getPendingOps } = await import("../pwa/src/offline-review");
		const ops = await getPendingOps();
		expect(ops).toHaveLength(1);
		const op: QueuedReviewOp = ops[0];
		expect(op.clientOperationId).toBeTruthy();
		expect(typeof op.clientOperationId).toBe("string");
		expect(op.clientOperationId.length).toBeGreaterThan(0);
		expect(op.cardId).toBe("card-1");
		expect(op.rating).toBe(3);
		expect(op.scope).toBe("deck:MyDeck");
		expect(op.syncStatus).toBe("pending");
		expect(op.createdAt).toBe(Date.now());
	});

	// ── Regression: authFetch adds Authorization ───────────────────

	it("10. authFetch adds Authorization: Bearer <key> when key is set", async () => {
		stubIndexedDbV2();
		vi.stubGlobal("navigator", { onLine: true });

		const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () =>
				new Response(JSON.stringify({ due: 100 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { submitReview, setApiKey } = await import("../pwa/src/api");
		setApiKey("test-key-123");
		await submitReview("card-1", 3, "all");

		expect(fetchMock).toHaveBeenCalledOnce();
		const [, init] = fetchMock.mock.calls[0];
		const headers = init?.headers as Headers;
		expect(headers.get("Authorization")).toBe("Bearer test-key-123");
	});
});
