/// <reference lib="dom" />

import { downloadApkgExport, type NoteSearchResult, searchNotes } from "./api";
import { errorMessage } from "./helpers";
import { attachCardActions } from "./search-card-actions";

const PAGE_SIZE = 50;

// Cache of search results for expansion (lifecycle tied to renderSearch)
const noteCache = new Map<string, NoteSearchResult>();

export async function renderSearch(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<div class="search-page">
			<section class="search-hero" aria-labelledby="search-title">
				<div class="search-kicker">Library</div>
				<h2 id="search-title">Search your notes</h2>
				<p class="hint">Find vocabulary, review metadata, and open a card for fields, audio, and enrichment.</p>
			</section>

			<section class="search-export" aria-label="Export collection">
				<div>
					<div class="search-export-title">Export your collection</div>
					<div class="hint">Exports all notes as an Anki .apkg file. Review progress is not included.</div>
				</div>
				<button id="export-apkg-btn" type="button" class="secondary">Export .apkg</button>
			</section>
			<div id="export-apkg-status" class="hint search-export-status"></div>

			<section class="search-panel" aria-label="Search notes">
				<label class="search-input-label" for="search-input">Search notes</label>
				<input id="search-input" type="search" placeholder="Search notes..." autocomplete="off" />
				<div id="search-status" class="hint search-status"></div>
				<div id="search-results" class="card-area search-results-card"></div>
				<button id="search-more" type="button" class="secondary search-more-btn" style="display:none;">Load more</button>
			</section>
		</div>
	`;

	const input = root.querySelector<HTMLInputElement>("#search-input");
	const status = root.querySelector<HTMLElement>("#search-status");
	const results = root.querySelector<HTMLElement>("#search-results");
	const moreBtn = root.querySelector<HTMLButtonElement>("#search-more");
	const exportBtn = root.querySelector<HTMLButtonElement>("#export-apkg-btn");
	const exportStatus = root.querySelector<HTMLElement>("#export-apkg-status");
	if (!input || !status || !results || !moreBtn || !exportBtn || !exportStatus) return;

	let loaded = 0;
	let total = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// Attach card-action handlers to the results container
	attachCardActions(results, noteCache, {
		onDeleted() {
			total--;
			loaded--;
			status.textContent = `${loaded} of ${total}`;
		},
	});

	const doSearch = async (append: boolean) => {
		const q = input.value.trim();
		if (!append) {
			loaded = 0;
			results.innerHTML = "";
			noteCache.clear();
		}
		status.textContent = "Searching…";
		moreBtn.style.display = "none";
		try {
			const res = await searchNotes(q, PAGE_SIZE, loaded);
			total = res.total;
			if (res.notes.length === 0 && loaded === 0) {
				status.textContent = "No notes found";
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
			status.textContent = `Failed: ${errorMessage(err)}`;
		}
	};

	input.addEventListener("input", () => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => doSearch(false), 300);
	});

	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			clearTimeout(debounceTimer);
			doSearch(false);
		}
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

	// Initial load — show all notes
	doSearch(false);
}

function renderNoteRow(note: NoteSearchResult): HTMLElement {
	const row = document.createElement("div");
	row.className = "search-row";
	row.dataset.noteId = note.noteId;

	const firstField = Object.values(note.fields)[0] ?? "";
	const front = document.createElement("span");
	front.className = "search-front";
	front.innerHTML = firstField;

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

	const deleteBtn = document.createElement("button");
	deleteBtn.type = "button";
	deleteBtn.className = "search-delete-btn";
	deleteBtn.textContent = "×";
	deleteBtn.title = "Delete";

	row.appendChild(front);
	row.appendChild(meta);
	row.appendChild(knownBtn);
	row.appendChild(deleteBtn);
	return row;
}
