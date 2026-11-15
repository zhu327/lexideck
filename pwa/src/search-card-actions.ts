/// <reference lib="dom" />

import {
	deleteNote,
	enrichNote,
	fetchEnrichment,
	markFamiliar,
	type NoteSearchResult,
	unmarkFamiliar,
} from "./api";
import { displayEnrichment } from "./card-renderer";
import { escapeHtml, sanitizeFieldHtml } from "./dom";
import { renderFields } from "./fields";
import { errorMessage } from "./helpers";
import { speak } from "./tts";
import { showToast } from "./ui";

let expandedNoteId: string | null = null;
let sheetKeyHandler: ((event: KeyboardEvent) => void) | null = null;
let sheetOpener: HTMLElement | null = null;

/** Cancel the "tap again to delete" armed state for a delete button. */
const pendingDeleteResets = new WeakMap<HTMLButtonElement, () => void>();

export interface AttachCardActionsOptions {
	/** Called after a note is successfully deleted from the server and DOM. */
	onDeleted?: () => void;
}

export function attachCardActions(
	results: HTMLElement,
	noteCache: Map<string, NoteSearchResult>,
	options: AttachCardActionsOptions = {},
): () => void {
	const { onDeleted } = options;

	const onClick = async (e: Event) => {
		const target = e.target as HTMLElement;

		// Row click (not on a button) → open/close the detail sheet
		if (target.tagName !== "BUTTON") {
			const row = target.closest(".search-row") as HTMLElement | null;
			if (!row?.dataset.noteId) return;
			if (expandedNoteId === row.dataset.noteId) {
				closeNoteSheet();
			} else {
				await openNoteSheet(results, row.dataset.noteId, noteCache, onClick);
			}
			return;
		}

		const btn = target as HTMLButtonElement;
		e.stopPropagation();

		if (btn.classList.contains("search-front")) {
			const row = btn.closest(".search-row") as HTMLElement | null;
			const noteId = row?.dataset.noteId;
			if (!noteId) return;
			if (expandedNoteId === noteId) closeNoteSheet();
			else await openNoteSheet(results, noteId, noteCache, onClick);
		} else if (btn.classList.contains("search-sheet-close")) {
			closeNoteSheet();
		} else if (btn.classList.contains("search-sheet-prev")) {
			await navigateSheet(results, noteCache, -1, onClick);
		} else if (btn.classList.contains("search-sheet-next")) {
			await navigateSheet(results, noteCache, 1, onClick);
		} else if (btn.classList.contains("search-known-btn")) {
			await handleKnown(btn, results, noteCache);
		} else if (btn.classList.contains("search-delete-btn")) {
			await handleDelete(btn, noteCache, onDeleted);
		} else if (btn.classList.contains("search-tts-btn")) {
			const text = btn.dataset.text;
			if (text) speak(text);
		} else if (btn.classList.contains("search-enrich-btn")) {
			await handleEnrich(btn);
		}
	};

	results.addEventListener("click", onClick);

	// Rows are keyboard-activatable: Enter/Space opens the detail sheet.
	const onKeyDown = (event: Event): void => {
		const key = (event as KeyboardEvent).key;
		if (key !== "Enter" && key !== " ") return;
		const target = event.target as HTMLElement | null;
		if (!target || target.tagName === "BUTTON") return;
		const row = target.closest(".search-row") as HTMLElement | null;
		if (!row?.dataset.noteId) return;
		event.preventDefault();
		void openNoteSheet(results, row.dataset.noteId, noteCache, onClick);
	};
	results.addEventListener("keydown", onKeyDown);

	return () => {
		results.removeEventListener("click", onClick);
		results.removeEventListener("keydown", onKeyDown);
	};
}

/* ── Handler helpers ─────────────────────────────────── */

async function handleKnown(
	btn: HTMLButtonElement,
	results: HTMLElement,
	noteCache: Map<string, NoteSearchResult>,
): Promise<void> {
	const container =
		(btn.closest(".search-row") as HTMLElement | null) ??
		(btn.closest(".search-expanded") as HTMLElement | null) ??
		(btn.closest(".search-sheet") as HTMLElement | null);
	if (!container) return;
	const noteId = container.dataset.noteId;
	if (!noteId) return;

	const isKnown = btn.dataset.known === "true";

	// Optimistic: flip the visual state immediately, roll back if the API fails.
	applyKnownState(btn, !isKnown);
	btn.disabled = true;

	try {
		if (isKnown) {
			await unmarkFamiliar(noteId);
		} else {
			await markFamiliar(noteId);
		}
		const cached = noteCache.get(noteId);
		if (cached) cached.known = !isKnown;

		// Sync the other button (row ↔ sheet)
		const rowBtn = results.querySelector(
			`.search-row[data-note-id="${noteId}"] .search-known-btn`,
		) as HTMLButtonElement | null;
		const sheetBtn = document.body.querySelector(
			`.search-sheet[data-note-id="${noteId}"] .search-known-btn`,
		) as HTMLButtonElement | null;
		for (const otherBtn of [rowBtn, sheetBtn]) {
			if (otherBtn && otherBtn !== btn) applyKnownState(otherBtn, !isKnown);
		}
	} catch (err) {
		applyKnownState(btn, isKnown);
		showToast({ tone: "error", message: `Couldn't update: ${errorMessage(err)}` });
	} finally {
		btn.disabled = false;
	}
}

async function handleDelete(
	btn: HTMLButtonElement,
	noteCache: Map<string, NoteSearchResult>,
	onDeleted?: () => void,
): Promise<void> {
	const row = btn.closest(".search-row") as HTMLElement | null;
	if (!row) return;
	const noteId = row.dataset.noteId;
	if (!noteId) return;

	// Two-step confirmation instead of a blocking window.confirm(): the first
	// tap arms the button for ~3s, the second deletes.
	if (btn.dataset.confirm !== "true") {
		const reset = (): void => {
			pendingDeleteResets.delete(btn);
			delete btn.dataset.confirm;
			btn.classList.remove("confirming");
			btn.textContent = "×";
			btn.title = "Delete";
			btn.setAttribute("aria-label", "Delete note");
		};
		pendingDeleteResets.set(btn, reset);
		btn.dataset.confirm = "true";
		btn.classList.add("confirming");
		btn.textContent = "Delete?";
		btn.title = "Tap again to delete";
		btn.setAttribute("aria-label", "Confirm delete");
		setTimeout(reset, 3200);
		return;
	}

	pendingDeleteResets.get(btn)?.();
	btn.disabled = true;
	try {
		await deleteNote(noteId);
		row.remove();
		noteCache.delete(noteId);
		if (expandedNoteId === noteId) closeNoteSheet();
		onDeleted?.();
		showToast({ tone: "success", message: "Note deleted." });
	} catch (err) {
		btn.disabled = false;
		showToast({ tone: "error", message: `Delete failed: ${errorMessage(err)}` });
	}
}

async function handleEnrich(btn: HTMLButtonElement): Promise<void> {
	const card =
		(btn.closest(".search-expanded") as HTMLElement | null) ??
		(btn.closest(".search-sheet") as HTMLElement | null);
	if (!card) return;
	const noteId = card.dataset.noteId;
	if (!noteId) return;

	const enrichArea = card.querySelector(".search-enrich-area") as HTMLElement | null;
	if (!enrichArea) return;

	btn.disabled = true;
	btn.textContent = "Enriching…";

	try {
		const result = await enrichNote(noteId);
		if ("error" in result) {
			enrichArea.innerHTML = `<div class="search-enrich-error">${escapeHtml(result.error)}</div>`;
		} else {
			enrichArea.innerHTML = "";
			displayEnrichment(enrichArea, result);
		}
		btn.textContent = "Refresh";
	} catch (err) {
		enrichArea.innerHTML = `<div class="search-enrich-error">Failed: ${escapeHtml(
			errorMessage(err),
		)}</div>`;
		btn.textContent = "Retry";
	} finally {
		btn.disabled = false;
	}
}

/* ── Known state helpers ─────────────────────────────── */

function applyKnownState(btn: HTMLButtonElement, known: boolean): void {
	btn.textContent = known ? "Unmark" : "Mark Known";
	btn.dataset.known = String(known);
	btn.setAttribute("aria-pressed", String(known));
	btn.classList.toggle("known", known);
	btn.classList.toggle("secondary", !known);
}

/* ── Expand / collapse ───────────────────────────────── */

async function openNoteSheet(
	results: HTMLElement,
	noteId: string,
	noteCache: Map<string, NoteSearchResult>,
	onClick: (e: Event) => Promise<void>,
): Promise<void> {
	// Remember which row opened the sheet so focus can be restored on close.
	const opener =
		(results.querySelector(`.search-row[data-note-id="${noteId}"]`) as HTMLElement | null) ??
		sheetOpener;
	closeNoteSheet();
	sheetOpener = opener;

	const note = noteCache.get(noteId);
	if (!note) return;

	const noteIds = visibleNoteIds(results, noteCache);
	const index = noteIds.indexOf(noteId);
	const backdrop = document.createElement("div");
	backdrop.className = "search-sheet-backdrop";
	const sheet = document.createElement("section");
	sheet.className = "search-sheet";
	sheet.dataset.noteId = noteId;
	sheet.setAttribute("role", "dialog");
	sheet.setAttribute("aria-modal", "true");
	sheet.addEventListener("click", onClick);

	const frontKey = Object.keys(note.fields)[0] ?? "";
	const frontText = note.fields[frontKey] ?? "";
	const fieldsHtml = renderFields(note.fields, frontKey);

	const header = document.createElement("div");
	header.className = "search-sheet-header";
	const grabber = document.createElement("div");
	grabber.className = "search-sheet-grabber";
	grabber.setAttribute("aria-hidden", "true");
	const nav = document.createElement("div");
	nav.className = "search-sheet-nav";
	nav.setAttribute("aria-label", "Navigate search results");
	header.appendChild(grabber);
	header.appendChild(nav);
	const prevBtn = document.createElement("button");
	prevBtn.type = "button";
	prevBtn.className = "search-sheet-prev secondary";
	prevBtn.textContent = "‹ Prev";
	prevBtn.disabled = index <= 0;

	const position = document.createElement("span");
	position.className = "search-sheet-position";
	position.textContent = `${index + 1} / ${noteIds.length}`;

	const nextBtn = document.createElement("button");
	nextBtn.type = "button";
	nextBtn.className = "search-sheet-next secondary";
	nextBtn.textContent = "Next ›";
	nextBtn.disabled = index < 0 || index >= noteIds.length - 1;

	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.className = "search-sheet-close secondary";
	closeBtn.textContent = "×";

	nav.appendChild(prevBtn);
	nav.appendChild(position);
	nav.appendChild(nextBtn);
	nav.appendChild(closeBtn);

	const content = document.createElement("div");
	content.className = "search-expanded-content search-sheet-content";
	content.innerHTML = `
		<div class="search-expanded-header">
			<div class="search-expanded-front">${sanitizeFieldHtml(frontText)}</div>
			<button type="button" class="search-tts-btn secondary" data-text="${escapeHtml(frontText)}" title="Listen" aria-label="Listen to pronunciation">🔊</button>
		</div>
		<div class="search-expanded-fields">
			${fieldsHtml}
		</div>
		<div class="search-enrich-actions">
			<button type="button" class="search-known-btn ${note.known ? "known" : "secondary"}" data-known="${note.known}">${note.known ? "Unmark" : "Mark Known"}</button>
			<button type="button" class="search-enrich-btn secondary">Enrich</button>
		</div>
		<div class="search-enrich-area">
			<div class="search-loading">Loading enrichment...</div>
		</div>
	`;

	sheet.appendChild(header);
	sheet.appendChild(content);
	backdrop.appendChild(sheet);
	document.body.appendChild(backdrop);
	expandedNoteId = noteId;

	// Tap the dimmed area to dismiss (parity with native sheets).
	backdrop.addEventListener("click", (event) => {
		if (event.target === backdrop) closeNoteSheet();
	});

	// Drag the header down to dismiss.
	let dragStartY: number | null = null;
	let dragPointerId: number | null = null;
	const resetDragStyles = (): void => {
		sheet.style.transition = "";
		sheet.style.transform = "";
		sheet.style.opacity = "";
	};
	const onHeaderPointerDown = (event: PointerEvent): void => {
		if ((event.target as Element | null)?.closest("button")) return;
		dragStartY = event.clientY;
		dragPointerId = event.pointerId;
		sheet.style.transition = "none";
		try {
			header.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture is an enhancement only.
		}
	};
	const onHeaderPointerMove = (event: PointerEvent): void => {
		if (dragStartY === null || event.pointerId !== dragPointerId) return;
		const dy = Math.max(0, event.clientY - dragStartY);
		sheet.style.transform = `translateY(${dy}px)`;
		sheet.style.opacity = String(Math.max(0.35, 1 - dy / 480));
	};
	const onHeaderPointerEnd = (event: PointerEvent): void => {
		if (dragStartY === null || event.pointerId !== dragPointerId) return;
		const dy = Math.max(0, event.clientY - dragStartY);
		dragStartY = null;
		dragPointerId = null;
		resetDragStyles();
		if (dy > 96) closeNoteSheet();
	};
	header.addEventListener("pointerdown", onHeaderPointerDown);
	header.addEventListener("pointermove", onHeaderPointerMove);
	header.addEventListener("pointerup", onHeaderPointerEnd);
	header.addEventListener("pointercancel", onHeaderPointerEnd);

	// Escape closes, Tab stays inside the dialog.
	sheetKeyHandler = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			closeNoteSheet();
			return;
		}
		if (event.key !== "Tab") return;
		const focusables = [
			...sheet.querySelectorAll<HTMLElement>(
				"button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
			),
		];
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	document.addEventListener("keydown", sheetKeyHandler, true);
	closeBtn.focus({ preventScroll: true });

	const enrichArea = sheet.querySelector(".search-enrich-area") as HTMLElement | null;

	try {
		const enrichment = await fetchEnrichment(noteId);
		if (enrichArea) {
			if (enrichment) {
				enrichArea.innerHTML = "";
				displayEnrichment(enrichArea, enrichment);
				const enrichBtn = sheet.querySelector(".search-enrich-btn") as HTMLButtonElement | null;
				if (enrichBtn) enrichBtn.textContent = "Refresh";
			} else {
				enrichArea.innerHTML = '<div class="search-not-enriched">Not enriched yet</div>';
			}
		}
	} catch (err) {
		if (enrichArea) {
			enrichArea.innerHTML = `<div class="search-enrich-error">Failed to load: ${escapeHtml(
				errorMessage(err),
			)}</div>`;
		}
	}
}

async function navigateSheet(
	results: HTMLElement,
	noteCache: Map<string, NoteSearchResult>,
	direction: -1 | 1,
	onClick: (e: Event) => Promise<void>,
): Promise<void> {
	if (!expandedNoteId) return;
	const noteIds = visibleNoteIds(results, noteCache);
	const nextId = noteIds[noteIds.indexOf(expandedNoteId) + direction];
	if (nextId) await openNoteSheet(results, nextId, noteCache, onClick);
}

function visibleNoteIds(results: HTMLElement, noteCache: Map<string, NoteSearchResult>): string[] {
	return Array.from(results.querySelectorAll<HTMLElement>(".search-row"))
		.map((row) => row.dataset.noteId)
		.filter((noteId): noteId is string => Boolean(noteId && noteCache.has(noteId)));
}

/**
 * Close the detail sheet (if open) and restore focus to the row that opened
 * it. Safe to call on route changes — it only touches sheet-owned nodes.
 */
export function closeNoteSheet(): void {
	const wasOpen = expandedNoteId !== null;
	document.querySelector(".search-expanded")?.remove();
	document.body.querySelector(".search-sheet-backdrop")?.remove();
	expandedNoteId = null;
	if (sheetKeyHandler) {
		document.removeEventListener("keydown", sheetKeyHandler, true);
		sheetKeyHandler = null;
	}
	const opener = sheetOpener;
	sheetOpener = null;
	if (wasOpen && opener?.isConnected) opener.focus({ preventScroll: true });
}
