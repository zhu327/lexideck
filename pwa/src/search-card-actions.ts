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

		// Row click (not on a button) → expand/collapse
		if (target.tagName !== "BUTTON") {
			const row = target.closest(".search-row") as HTMLElement | null;
			if (!row?.dataset.noteId) return;
			if (expandedNoteId === row.dataset.noteId) {
				collapseNote(results);
			} else {
				await expandNote(row, row.dataset.noteId, noteCache);
			}
			return;
		}

		const btn = target as HTMLButtonElement;
		e.stopPropagation();

		if (btn.classList.contains("search-known-btn")) {
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
		(btn.closest(".search-expanded") as HTMLElement | null);
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
		const otherSelector = `${container.classList.contains("search-row") ? ".search-expanded" : ".search-row"}[data-note-id="${noteId}"] .search-known-btn`;
		const otherBtn = results.querySelector(otherSelector) as HTMLButtonElement | null;
		if (otherBtn) applyKnownState(otherBtn, !isKnown);
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
	const card = btn.closest(".search-expanded") as HTMLElement | null;
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

async function expandNote(
	row: HTMLElement,
	noteId: string,
	noteCache: Map<string, NoteSearchResult>,
): Promise<void> {
	collapseNote(row.parentElement as HTMLElement);

	const note = noteCache.get(noteId);
	if (!note) return;

	const expandedDiv = document.createElement("div");
	expandedDiv.className = "search-expanded";
	expandedDiv.dataset.noteId = noteId;
	expandedDiv.innerHTML = '<div class="search-loading">Loading...</div>';
	row.parentNode?.insertBefore(expandedDiv, row.nextSibling);
	expandedNoteId = noteId;

	const frontKey = Object.keys(note.fields)[0] ?? "";
	const frontText = note.fields[frontKey] ?? "";
	const fieldsHtml = renderFields(note.fields, frontKey);

	expandedDiv.innerHTML = `
		<div class="search-expanded-content">
			<div class="search-expanded-header">
				<div class="search-expanded-front">${frontText}</div>
				<button type="button" class="search-tts-btn secondary" data-text="${escapeHtml(frontText)}" title="Listen">🔊</button>
			</div>
			<div class="search-expanded-fields">
				${fieldsHtml}
			</div>
			<div class="search-expanded-actions">
				<button type="button" class="search-known-btn ${note.known ? "known" : "secondary"}" data-known="${note.known}">
					${note.known ? "Unmark" : "Mark Known"}
				</button>
			</div>
			<div class="search-enrich-area">
				<div class="search-loading">Loading enrichment...</div>
			</div>
			<div class="search-enrich-actions">
				<button type="button" class="search-enrich-btn secondary">Enrich</button>
			</div>
		</div>
	`;

	const enrichArea = expandedDiv.querySelector(".search-enrich-area") as HTMLElement | null;

	try {
		const enrichment = await fetchEnrichment(noteId);
		if (enrichArea) {
			if (enrichment) {
				enrichArea.innerHTML = "";
				displayEnrichment(enrichArea, enrichment);
				const enrichBtn = expandedDiv.querySelector(
					".search-enrich-btn",
				) as HTMLButtonElement | null;
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

function collapseNote(results: HTMLElement): void {
	results.querySelector(".search-expanded")?.remove();
	expandedNoteId = null;
}
