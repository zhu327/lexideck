/// <reference lib="dom" />

import { downloadApkgExport, type NoteSearchResult, searchNotes } from "./api";
import { escapeHtml, sanitizeFieldHtml } from "./dom";
import { errorMessage } from "./helpers";
import { attachCardActions } from "./search-card-actions";

const PAGE_SIZE = 50;

// Cache of search results for expansion (lifecycle tied to renderSearch)
const noteCache = new Map<string, NoteSearchResult>();

// Document-level shortcut teardown (route changes re-render the screen).
let detachShortcuts: (() => void) | null = null;

export function cleanupSearch(): void {
	detachShortcuts?.();
	detachShortcuts = null;
}

function stateBlock(icon: string, title: string, hint: string): string {
	return `
		<div class="state-block" role="status">
			<div class="state-icon" aria-hidden="true">${icon}</div>
			<div class="state-title">${escapeHtml(title)}</div>
			<p class="state-hint">${escapeHtml(hint)}</p>
		</div>
	`;
}

function skeletonRows(count = 5): string {
	return Array.from({ length: count })
		.map(
			() => `
			<div class="search-row-skeleton" aria-hidden="true">
				<span class="skeleton-line skeleton-line-sm"></span>
				<span class="skeleton-line"></span>
			</div>`,
		)
		.join("");
}

export async function renderSearch(root: HTMLElement): Promise<void> {
	cleanupSearch();

	root.innerHTML = `
		<div class="search-page">
			<section class="search-hero" aria-labelledby="search-title">
				<div class="search-kicker">Library</div>
				<h2 id="search-title">Search your notes</h2>
				<p class="hint">Find vocabulary, review metadata, and open a card for fields, audio, and enrichment.</p>
			</section>

			<section class="search-panel" aria-label="Search notes">
				<label class="search-input-label" for="search-input">Search notes</label>
				<div class="search-input-wrap">
					<input id="search-input" type="search" placeholder="Search notes..." autocomplete="off" enterkeyhint="search" spellcheck="false" aria-describedby="search-status" aria-keyshortcuts="/" />
					<button id="search-clear" class="search-clear" type="button" aria-label="Clear search" hidden>×</button>
				</div>
				<div id="search-status" class="hint search-status" role="status" aria-live="polite"></div>
				<div id="search-results" class="card-area search-results-card"></div>
				<button id="search-more" type="button" class="secondary search-more-btn" style="display:none;">Load more</button>
			</section>

			<details class="search-export">
				<summary>Export collection</summary>
				<div class="search-export-body">
					<p class="hint">Exports all notes as an Anki .apkg file. Review progress is not included.</p>
					<button id="export-apkg-btn" type="button" class="secondary">Export .apkg</button>
					<div id="export-apkg-status" class="hint search-export-status"></div>
				</div>
			</details>
		</div>
	`;

	const input = root.querySelector<HTMLInputElement>("#search-input");
	const status = root.querySelector<HTMLElement>("#search-status");
	const results = root.querySelector<HTMLElement>("#search-results");
	const moreBtn = root.querySelector<HTMLButtonElement>("#search-more");
	const exportBtn = root.querySelector<HTMLButtonElement>("#export-apkg-btn");
	const exportStatus = root.querySelector<HTMLElement>("#export-apkg-status");
	const clearBtn = root.querySelector<HTMLButtonElement>("#search-clear");
	if (!input || !status || !results || !moreBtn || !exportBtn || !exportStatus) return;

	let loaded = 0;
	let total = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	// Sequence guard: debounce + Enter can overlap slow responses; only the
	// most recent request may mutate the DOM.
	let requestSeq = 0;

	const syncClearButton = (): void => {
		if (clearBtn) clearBtn.hidden = input.value.length === 0;
	};

	// Attach card-action handlers to the results container
	attachCardActions(results, noteCache, {
		onDeleted() {
			total = Math.max(0, total - 1);
			loaded = Math.max(0, loaded - 1);
			status.textContent = `${loaded} of ${total}`;
		},
	});

	const doSearch = async (append: boolean) => {
		const seq = ++requestSeq;
		const q = input.value.trim();
		if (!append) {
			loaded = 0;
			noteCache.clear();
			// Skeleton rows keep the layout stable while the query is in flight.
			results.innerHTML = skeletonRows();
		}
		status.textContent = "Searching…";
		moreBtn.style.display = "none";
		try {
			const res = await searchNotes(q, PAGE_SIZE, loaded);
			if (seq !== requestSeq) return; // superseded by a newer search
			total = res.total;
			if (!append) results.innerHTML = "";
			if (res.notes.length === 0 && loaded === 0) {
				status.textContent = "";
				results.innerHTML = stateBlock(
					"🔍",
					"No notes found",
					q
						? `Nothing matches “${q}”.`
						: "Your collection is empty. Add cards with the Yomitan extension.",
				);
				return;
			}
			for (const note of res.notes) {
				noteCache.set(note.noteId, note);
				results.appendChild(renderNoteRow(note));
			}
			loaded += res.notes.length;
			status.textContent = `${loaded} of ${total}`;
			if (loaded < total) {
				moreBtn.style.display = "block";
			}
		} catch (err) {
			if (seq !== requestSeq) return;
			status.textContent = "";
			results.innerHTML = stateBlock("📡", "Search failed", errorMessage(err));
		}
	};

	input.addEventListener("input", () => {
		syncClearButton();
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => doSearch(false), 300);
	});

	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			clearTimeout(debounceTimer);
			doSearch(false);
		}
	});

	clearBtn?.addEventListener("click", () => {
		input.value = "";
		syncClearButton();
		input.focus();
		clearTimeout(debounceTimer);
		doSearch(false);
	});

	moreBtn.addEventListener("click", () => {
		doSearch(true);
	});

	exportBtn.addEventListener("click", async () => {
		exportBtn.disabled = true;
		exportBtn.textContent = "Exporting…";
		exportStatus.textContent = "Exporting all notes…";
		try {
			const download = await downloadApkgExport();
			const url = URL.createObjectURL(download.blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = download.filename;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 0);
			exportStatus.textContent = "Export ready.";
		} catch (err) {
			exportStatus.textContent = `Couldn't export right now: ${errorMessage(err)}`;
		} finally {
			exportBtn.disabled = false;
			exportBtn.textContent = "Export .apkg";
		}
	});

	// "/" focuses the search field (common list-view convention).
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest("input, textarea, [contenteditable='true']")) return;
		event.preventDefault();
		input.focus();
	};
	document.addEventListener("keydown", onKeyDown);
	detachShortcuts = () => document.removeEventListener("keydown", onKeyDown);

	// Initial load — show all notes
	doSearch(false);
}

function renderNoteRow(note: NoteSearchResult): HTMLElement {
	const row = document.createElement("div");
	row.className = "search-row";
	row.dataset.noteId = note.noteId;

	const firstField = Object.values(note.fields)[0] ?? "";
	// The front text is a real button: the row also contains Mark Known and
	// Delete, so making the row itself a button would nest interactive controls.
	const front = document.createElement("button");
	front.type = "button";
	front.className = "search-front";
	front.innerHTML = sanitizeFieldHtml(firstField);
	front.setAttribute("aria-label", `Open note: ${front.textContent ?? ""}`.trim());

	const meta = document.createElement("span");
	meta.className = "search-meta";
	const parts: string[] = [note.deckName];
	if (note.tags.length > 0) {
		parts.push(note.tags.join(", "));
	}
	meta.textContent = parts.join(" · ");

	const knownBtn = document.createElement("button");
	knownBtn.type = "button";
	knownBtn.className = `search-known-btn ${note.known ? "known" : "secondary"}`;
	knownBtn.textContent = note.known ? "Unmark" : "Mark Known";
	knownBtn.dataset.known = String(note.known);
	knownBtn.setAttribute("aria-pressed", String(note.known));

	const deleteBtn = document.createElement("button");
	deleteBtn.type = "button";
	deleteBtn.className = "search-delete-btn";
	deleteBtn.textContent = "×";
	deleteBtn.title = "Delete";
	deleteBtn.setAttribute("aria-label", "Delete note");

	row.appendChild(front);
	row.appendChild(meta);
	row.appendChild(knownBtn);
	row.appendChild(deleteBtn);
	return row;
}
