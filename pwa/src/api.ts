import {
	buildDueUrl,
	buildFamiliarUrl,
	buildQuizUrl,
	enrichUnavailableMessage,
	type Rating,
} from "./helpers";
import { addReviewOp, removeCardFromReviewQueue } from "./offline-review";

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
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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

export type SubmitResult =
	| { due: number; queued?: false }
	| { due: number; queued: true; queuedReason: "offline" | "server-error" };

export type SubmitFailureKind =
	| "network"
	| "auth"
	| "client"
	| "server-priority"
	| "server-error"
	| "offline-storage";

export class ReviewSubmitError extends Error {
	readonly kind: SubmitFailureKind;
	readonly status?: number;
	constructor(kind: SubmitFailureKind, message: string, status?: number) {
		super(message);
		this.name = "ReviewSubmitError";
		this.kind = kind;
		this.status = status;
	}
}

async function tryQueueOp(cardId: string, rating: Rating, scope: string): Promise<boolean> {
	try {
		await addReviewOp({ cardId, rating, createdAt: Date.now(), scope });
		return true;
	} catch {
		// IDB unavailable — op lost, caller must treat as failure
		return false;
	}
}

async function tryRegisterBackgroundSync(): Promise<void> {
	try {
		if ("serviceWorker" in navigator) {
			const reg = await navigator.serviceWorker.ready;
			if (reg && "sync" in reg) {
				await (
					reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }
				).sync.register("sync-reviews");
			}
		}
	} catch {
		// Background sync not supported — ignore
	}
}

export async function submitReview(
	cardId: string,
	rating: Rating,
	scope: string,
): Promise<SubmitResult> {
	let res: Response;
	try {
		res = await authFetch("/api/review/submit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cardId, rating }),
		});
	} catch (err) {
		if (err instanceof TypeError || !navigator.onLine) {
			const queued = await tryQueueOp(cardId, rating, scope);
			if (!queued) {
				throw new ReviewSubmitError("offline-storage", "无法离线保存，评分未提交", undefined);
			}
			await removeCardFromReviewQueue(scope, cardId);
			await tryRegisterBackgroundSync();
			return { due: Date.now() + 60_000, queued: true, queuedReason: "offline" };
		}
		throw err;
	}

	if (res.status >= 500 && res.status <= 599) {
		const queued = await tryQueueOp(cardId, rating, scope);
		if (!queued) {
			throw new ReviewSubmitError("offline-storage", "无法离线保存，评分未提交", undefined);
		}
		await removeCardFromReviewQueue(scope, cardId);
		await tryRegisterBackgroundSync();
		return { due: Date.now() + 60_000, queued: true, queuedReason: "server-error" };
	}

	if (res.status === 401 || res.status === 403) {
		throw new ReviewSubmitError("auth", "Authentication failed", res.status);
	}

	if (res.status === 400) {
		throw new ReviewSubmitError("client", "Invalid request", res.status);
	}

	if (res.status === 404 || res.status === 409) {
		throw new ReviewSubmitError("server-priority", "Card state changed on server", res.status);
	}

	if (!res.ok) {
		throw new ReviewSubmitError(
			"server-error",
			`Unexpected server response: ${res.status}`,
			res.status,
		);
	}

	const body = (await res.json()) as { due: number };
	return { due: body.due };
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
