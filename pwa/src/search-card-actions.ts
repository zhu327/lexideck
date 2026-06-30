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
import { escapeHtml } from "./dom";
import { renderFields } from "./fields";
import { errorMessage } from "./helpers";
import { speak } from "./tts";

let expandedNoteId: string | null = null;

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
				collapseNote(results);
			} else {
				await openNoteSheet(results, row.dataset.noteId, noteCache, onClick);
			}
			return;
		}

		const btn = target as HTMLButtonElement;
		e.stopPropagation();

		if (btn.classList.contains("search-sheet-close")) {
			collapseNote(results);
		} else if (btn.classList.contains("search-sheet-prev")) {
			await navigateSheet(results, noteCache, -1, onClick);
		} else if (btn.classList.contains("search-sheet-next")) {
			await navigateSheet(results, noteCache, 1, onClick);
		} else if (btn.classList.contains("search-known-btn")) {
			await handleKnown(btn, results, noteCache);
		} else if (btn.classList.contains("search-delete-btn")) {
			await handleDelete(btn, results, noteCache, onDeleted);
		} else if (btn.classList.contains("search-tts-btn")) {
			const text = btn.dataset.text;
			if (text) speak(text);
		} else if (btn.classList.contains("search-enrich-btn")) {
			await handleEnrich(btn);
		}
	};

	results.addEventListener("click", onClick);
	return () => results.removeEventListener("click", onClick);
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
	const originalText = btn.textContent;
	const originalClass = btn.className;

	btn.disabled = true;
	btn.textContent = isKnown ? "Unmarking…" : "Marking…";

	try {
		if (isKnown) {
			await unmarkFamiliar(noteId);
		} else {
			await markFamiliar(noteId);
		}
		applyKnownState(btn, !isKnown);
		const cached = noteCache.get(noteId);
		if (cached) cached.known = !isKnown;

		// Sync the other button (row ↔ expanded card)
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
		btn.textContent = originalText ?? "";
		btn.className = originalClass;
		alert(`Failed to update: ${errorMessage(err)}`);
	} finally {
		btn.disabled = false;
	}
}

async function handleDelete(
	btn: HTMLButtonElement,
	results: HTMLElement,
	noteCache: Map<string, NoteSearchResult>,
	onDeleted?: () => void,
): Promise<void> {
	const row = btn.closest(".search-row") as HTMLElement | null;
	if (!row) return;
	const noteId = row.dataset.noteId;
	if (!noteId) return;

	if (!confirm("确定删除这条词条吗？")) return;

	btn.disabled = true;
	try {
		await deleteNote(noteId);
		row.remove();
		noteCache.delete(noteId);
		if (expandedNoteId === noteId) collapseNote(results);
		onDeleted?.();
	} catch (err) {
		alert(`删除失败: ${errorMessage(err)}`);
	} finally {
		btn.disabled = false;
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
			enrichArea.innerHTML = `<div class="search-enrich-error">${result.error}</div>`;
		} else {
			enrichArea.innerHTML = "";
			displayEnrichment(enrichArea, result);
		}
		btn.textContent = "Refresh";
	} catch (err) {
		enrichArea.innerHTML = `<div class="search-enrich-error">Failed: ${errorMessage(err)}</div>`;
		btn.textContent = "Retry";
	} finally {
		btn.disabled = false;
	}
}

/* ── Known state helpers ─────────────────────────────── */

function applyKnownState(btn: HTMLButtonElement, known: boolean): void {
	btn.textContent = known ? "Unmark" : "Mark Known";
	btn.dataset.known = String(known);
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
	collapseNote(results);

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
			<div class="search-expanded-front">${frontText}</div>
			<button type="button" class="search-tts-btn secondary" data-text="${escapeHtml(frontText)}" title="Listen">🔊</button>
		</div>
		<div class="search-expanded-fields">
			${fieldsHtml}
		</div>
		<div class="search-enrich-actions">
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
			enrichArea.innerHTML = `<div class="search-enrich-error">Failed to load: ${errorMessage(err)}</div>`;
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

function collapseNote(results: HTMLElement): void {
	results.querySelector(".search-expanded")?.remove();
	document.body.querySelector(".search-sheet-backdrop")?.remove();
	expandedNoteId = null;
}
