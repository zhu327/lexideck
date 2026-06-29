/// <reference lib="dom" />

import type { ReviewCardView } from "./api";
import type { Rating } from "./helpers";

export type ReviewScope = string; // "all" | `deck:${deckName}`

export interface CachedReviewQueue {
	scope: string;
	cachedAt: number;
	serviceDate: string; // YYYY-MM-DD
	total: number;
	cards: ReviewCardView[];
}

export interface QueuedReviewOp {
	clientOperationId: string;
	cardId: string;
	rating: Rating;
	createdAt: number;
	scope: string;
	syncStatus: "pending" | "syncing" | "failed";
	lastError?: string;
}

export const OFFLINE_DB_NAME = "anki-sync";
export const OFFLINE_DB_VERSION = 2;

// ── UUID Generation ────────────────────────────────────────────────

function generateId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	// Fallback: random hex string
	const hex = "0123456789abcdef";
	let id = "";
	for (let i = 0; i < 32; i++) {
		id += hex[Math.floor(Math.random() * 16)];
		if (i === 7 || i === 11 || i === 15 || i === 19) id += "-";
	}
	return id;
}

// ── Singleton DB Connection ────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = openDB();
	return dbPromise;
}

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB is not available"));
			return;
		}
		const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			// Drop legacy v1 reviews store if it exists. That store was only used by the
			// previous service-worker-only prototype and did not preserve auth/scope, so
			// it cannot be safely replayed into the v2 reviewOps log.
			if (db.objectStoreNames.contains("reviews")) {
				db.deleteObjectStore("reviews");
			}
			// Create reviewOps store
			if (!db.objectStoreNames.contains("reviewOps")) {
				const opStore = db.createObjectStore("reviewOps", {
					keyPath: "clientOperationId",
				});
				opStore.createIndex("createdAt", "createdAt", { unique: false });
			}
			// Create reviewQueues store
			if (!db.objectStoreNames.contains("reviewQueues")) {
				db.createObjectStore("reviewQueues", { keyPath: "scope" });
			}
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onclose = () => {
				dbPromise = null;
			};
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			resolve(db);
		};
		req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
	});
}

// ── IDB Transaction Helper ─────────────────────────────────────────

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IDB request failed"));
	});
}

// ── Op Log Functions ───────────────────────────────────────────────

export async function addReviewOp(
	op: Omit<QueuedReviewOp, "syncStatus" | "clientOperationId"> & {
		clientOperationId?: string;
	},
): Promise<QueuedReviewOp> {
	const db = await getDb();
	const full: QueuedReviewOp = {
		clientOperationId: op.clientOperationId ?? generateId(),
		cardId: op.cardId,
		rating: op.rating,
		createdAt: op.createdAt,
		scope: op.scope,
		syncStatus: "pending",
	};
	const tx = db.transaction("reviewOps", "readwrite");
	await idbRequest(tx.objectStore("reviewOps").put(full));
	return full;
}

export async function getPendingOps(): Promise<QueuedReviewOp[]> {
	const db = await getDb();
	const tx = db.transaction("reviewOps", "readonly");
	const store = tx.objectStore("reviewOps");
	const all: QueuedReviewOp[] = await idbRequest(store.getAll());
	return all
		.filter((op) => op.syncStatus === "pending" || op.syncStatus === "syncing")
		.sort((a, b) => a.createdAt - b.createdAt);
}

export async function setOpSyncing(clientOperationId: string): Promise<void> {
	const db = await getDb();
	const tx = db.transaction("reviewOps", "readwrite");
	const store = tx.objectStore("reviewOps");
	const op: QueuedReviewOp | undefined = await idbRequest(store.get(clientOperationId));
	if (!op) throw new Error(`Op ${clientOperationId} not found`);
	op.syncStatus = "syncing";
	await idbRequest(store.put(op));
}

export async function deleteOp(clientOperationId: string): Promise<void> {
	const db = await getDb();
	const tx = db.transaction("reviewOps", "readwrite");
	await idbRequest(tx.objectStore("reviewOps").delete(clientOperationId));
}

export async function markOpFailed(clientOperationId: string, error: string): Promise<void> {
	const db = await getDb();
	const tx = db.transaction("reviewOps", "readwrite");
	const store = tx.objectStore("reviewOps");
	const op: QueuedReviewOp | undefined = await idbRequest(store.get(clientOperationId));
	if (!op) throw new Error(`Op ${clientOperationId} not found`);
	op.syncStatus = "failed";
	op.lastError = error;
	await idbRequest(store.put(op));
}

export async function resetOpToPending(clientOperationId: string): Promise<void> {
	const db = await getDb();
	const tx = db.transaction("reviewOps", "readwrite");
	const store = tx.objectStore("reviewOps");
	const op: QueuedReviewOp | undefined = await idbRequest(store.get(clientOperationId));
	if (!op) throw new Error(`Op ${clientOperationId} not found`);
	op.syncStatus = "pending";
	await idbRequest(store.put(op));
}

export async function getAllOps(): Promise<QueuedReviewOp[]> {
	const db = await getDb();
	const tx = db.transaction("reviewOps", "readonly");
	const store = tx.objectStore("reviewOps");
	const all: QueuedReviewOp[] = await idbRequest(store.getAll());
	return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function countPendingOps(): Promise<number> {
	const ops = await getPendingOps();
	return ops.length;
}

// ── Queue Store Functions ──────────────────────────────────────────

export async function saveReviewQueue(queue: Omit<CachedReviewQueue, "cachedAt">): Promise<void> {
	const db = await getDb();
	const full: CachedReviewQueue = {
		...queue,
		cachedAt: Date.now(),
	};
	const tx = db.transaction("reviewQueues", "readwrite");
	await idbRequest(tx.objectStore("reviewQueues").put(full));
}

export async function getReviewQueue(scope: string): Promise<CachedReviewQueue | null> {
	const db = await getDb();
	const tx = db.transaction("reviewQueues", "readonly");
	const result: CachedReviewQueue | undefined = await idbRequest(
		tx.objectStore("reviewQueues").get(scope),
	);
	return result ?? null;
}

export async function appendReviewQueueCards(
	scope: string,
	cards: ReviewCardView[],
	total: number,
): Promise<void> {
	const existing = await getReviewQueue(scope);
	await saveReviewQueue({
		scope,
		serviceDate: existing?.serviceDate ?? todayServiceDate(),
		total,
		cards: existing ? [...existing.cards, ...cards] : cards,
	});
}

export async function removeCardFromReviewQueue(scope: string, cardId: string): Promise<void> {
	const existing = await getReviewQueue(scope);
	if (!existing) return;
	await saveReviewQueue({
		...existing,
		cards: existing.cards.filter((c) => c.cardId !== cardId),
	});
}

// ── Pure Helpers ───────────────────────────────────────────────────

export function todayServiceDate(now?: number): string {
	const d = new Date(now ?? Date.now());
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function scopeForDeck(deck: string | null): string {
	if (deck === null) return "all";
	return `deck:${deck}`;
}
