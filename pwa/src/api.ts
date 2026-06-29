import {
	buildDueUrl,
	buildFamiliarUrl,
	buildQuizUrl,
	enrichUnavailableMessage,
	type Rating,
} from "./helpers";

/* ── API Key Management ────────────────────────────────── */

const API_KEY_STORAGE = "anki-api-key";

export function getApiKey(): string | null {
	return localStorage.getItem(API_KEY_STORAGE);
}

export function setApiKey(key: string): void {
	localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearApiKey(): void {
	localStorage.removeItem(API_KEY_STORAGE);
}

/** Authenticated fetch — adds Bearer token from localStorage. */
async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const key = getApiKey();
	const headers = new Headers(init?.headers);
	if (key) {
		headers.set("Authorization", `Bearer ${key}`);
	}
	return fetch(input, { ...init, headers });
}

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

export interface FamiliarCard {
	noteId: string;
	front: string;
	known: boolean;
}

export interface Enrichment {
	coreMeaning: string;
	meaningMap: string;
	usageNotes: string;
	memoryHooks: string;
	reviewPrompt: string;
}

async function expectOk(res: Response): Promise<void> {
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} ${res.statusText}`);
	}
}

async function expectJson<T>(res: Response): Promise<T> {
	await expectOk(res);
	return (await res.json()) as T;
}

export interface ApkgDownload {
	blob: Blob;
	filename: string;
}

function parseContentDispositionFilename(header: string | null): string | null {
	if (!header) return null;
	const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
	if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].trim());
	const quotedMatch = /filename="([^"]+)"/i.exec(header);
	if (quotedMatch?.[1]) return quotedMatch[1];
	const plainMatch = /filename=([^;]+)/i.exec(header);
	return plainMatch?.[1]?.trim() ?? null;
}

async function exportErrorMessage(res: Response): Promise<string> {
	try {
		const body = (await res.clone().json()) as { error?: unknown };
		if (typeof body.error === "string" && body.error.trim()) return body.error;
	} catch {
		// Fall through to the HTTP status below.
	}
	return `HTTP ${res.status} ${res.statusText}`.trim();
}

export async function downloadApkgExport(): Promise<ApkgDownload> {
	const res = await authFetch("/api/export/apkg");
	if (!res.ok) {
		throw new Error(await exportErrorMessage(res));
	}
	return {
		blob: await res.blob(),
		filename:
			parseContentDispositionFilename(res.headers.get("Content-Disposition")) ??
			"anki-vocab-export.apkg",
	};
}

export async function fetchDue(
	deckName?: string | null,
	limit = 50,
	offset?: number,
): Promise<{ cards: ReviewCardView[]; total: number }> {
	const res = await authFetch(`/api/review/due${buildDueUrl(deckName ?? null, limit, offset)}`);
	const body = await expectJson<{ cards: ReviewCardView[]; total?: number }>(res);
	return { cards: body.cards, total: body.total ?? body.cards.length };
}

export async function submitReview(cardId: string, rating: Rating): Promise<{ due: number }> {
	try {
		const res = await authFetch("/api/review/submit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cardId, rating }),
		});
		return expectJson<{ due: number }>(res);
	} catch (err) {
		// Queue for background sync when offline
		if (!navigator.onLine) {
			await queueOfflineReview(cardId, rating);
			// Return a placeholder — the review will be synced later
			return { due: Date.now() + 60000 };
		}
		throw err;
	}
}

/* ── Offline Review Queue ─────────────────────────────── */

interface QueuedReview {
	id?: number;
	cardId: string;
	rating: number;
	timestamp: number;
}

function openSyncDB(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		const req = indexedDB.open("anki-sync", 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains("reviews")) {
				const store = db.createObjectStore("reviews", {
					keyPath: "id",
					autoIncrement: true,
				});
				store.createIndex("timestamp", "timestamp", { unique: false });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => resolve(null);
	});
}

/** Store a review submission for later syncing when offline. */
export async function queueOfflineReview(cardId: string, rating: number): Promise<void> {
	const db = await openSyncDB();
	if (!db) return;

	const item: QueuedReview = {
		cardId,
		rating,
		timestamp: Date.now(),
	};

	const tx = db.transaction("reviews", "readwrite");
	const store = tx.objectStore("reviews");
	store.add(item);

	// Register a background sync to process the queue
	try {
		const reg = await navigator.serviceWorker?.ready;
		if (reg && "sync" in reg) {
			await (
				reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }
			).sync.register("sync-reviews");
		}
	} catch {
		// Background sync not supported
	}

	db.close();
}

/** Process queued review submissions when back online. */
export async function processReviewQueue(): Promise<number> {
	const db = await openSyncDB();
	if (!db) return 0;

	const tx = db.transaction("reviews", "readonly");
	const store = tx.objectStore("reviews");
	const items: QueuedReview[] = await new Promise((resolve) => {
		const req = store.getAll();
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => resolve([]);
	});

	let synced = 0;
	for (const item of items) {
		try {
			const res = await authFetch("/api/review/submit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cardId: item.cardId, rating: item.rating }),
			});
			if (res.ok && item.id !== undefined) {
				const delTx = db.transaction("reviews", "readwrite");
				const delStore = delTx.objectStore("reviews");
				delStore.delete(item.id);
				synced++;
			}
		} catch {
			// Still offline — keep in queue
		}
	}

	db.close();
	return synced;
}

export async function fetchQuiz(deckName?: string | null, limit = 20): Promise<ReviewCardView[]> {
	const res = await authFetch(`/api/review/quiz${buildQuizUrl(deckName ?? null, limit)}`);
	const body = await expectJson<{ cards: ReviewCardView[] }>(res);
	return body.cards;
}

export async function markFamiliar(noteId: string): Promise<void> {
	const res = await authFetch("/api/review/familiar", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ noteId }),
	});
	await expectOk(res);
}

export async function fetchFamiliarList(deckName?: string | null): Promise<FamiliarCard[]> {
	const res = await authFetch(`/api/review/familiar${buildFamiliarUrl(deckName)}`);
	const body = await expectJson<{ cards: FamiliarCard[] }>(res);
	return body.cards;
}

export async function unmarkFamiliar(noteId: string): Promise<void> {
	const res = await authFetch("/api/review/familiar/unmark", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ noteId }),
	});
	await expectOk(res);
}

export async function addNote(req: {
	deckName: string;
	modelName: string;
	fields: Record<string, string>;
	tags?: string[];
}): Promise<{ ankiId: number; noteId: string }> {
	const res = await authFetch("/api/notes", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(req),
	});
	if (res.status === 409) {
		throw new Error("duplicate");
	}
	return expectJson<{ ankiId: number; noteId: string }>(res);
}

export async function fetchDeckNames(): Promise<string[]> {
	const res = await authFetch("/api/decks");
	const body = await expectJson<{ decks: string[] }>(res);
	return body.decks;
}

export async function fetchModelNames(): Promise<string[]> {
	const res = await authFetch("/api/models");
	const body = await expectJson<{ models: string[] }>(res);
	return body.models;
}

export async function fetchModelFields(modelName: string): Promise<string[]> {
	const res = await authFetch(`/api/models/${encodeURIComponent(modelName)}/fields`);
	const body = await expectJson<{ fields: string[] }>(res);
	return body.fields;
}

export interface NoteSearchResult {
	noteId: string;
	fields: Record<string, string>;
	deckName: string;
	tags: string[];
}

export async function searchNotes(
	query: string,
	limit?: number,
	offset?: number,
): Promise<{ notes: NoteSearchResult[]; total: number }> {
	const params = new URLSearchParams();
	if (query) params.set("q", query);
	if (limit !== undefined) params.set("limit", String(limit));
	if (offset !== undefined) params.set("offset", String(offset));
	const res = await authFetch(`/api/notes/search?${params.toString()}`);
	return expectJson<{ notes: NoteSearchResult[]; total: number }>(res);
}

export async function deleteNote(noteId: string): Promise<void> {
	const res = await authFetch(`/api/notes/${encodeURIComponent(noteId)}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		throw new Error(res.status === 404 ? "not found" : "delete failed");
	}
}

export async function enrichNote(noteId: string): Promise<Enrichment | { error: string }> {
	const res = await authFetch(`/api/notes/${encodeURIComponent(noteId)}/enrich`, {
		method: "POST",
	});
	if (!res.ok) {
		return { error: enrichUnavailableMessage(res.status) };
	}
	return (await res.json()) as Enrichment;
}

export async function updateNote(
	noteId: string,
	fields: Record<string, string>,
	tags?: string[],
): Promise<void> {
	const res = await authFetch(`/api/notes/${encodeURIComponent(noteId)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ fields, tags }),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
}

export async function fetchEnrichment(noteId: string): Promise<Enrichment | null> {
	const res = await authFetch(`/api/notes/${encodeURIComponent(noteId)}/enrich`);
	if (res.status === 404) return null;
	if (!res.ok) return null;
	return (await res.json()) as Enrichment;
}

export interface StatsSummary {
	todayReviews: number;
	totalCards: number;
	newCards: number;
	learningCards: number;
	reviewCards: number;
	streak: number;
	todayRetention: number | null;
}

export async function fetchStats(): Promise<StatsSummary> {
	const res = await authFetch("/api/stats/summary");
	return expectJson<StatsSummary>(res);
}
