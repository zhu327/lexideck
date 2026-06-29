/// <reference lib="dom" />

import { deleteNote, downloadApkgExport, type NoteSearchResult, searchNotes } from "./api";
import { errorMessage } from "./helpers";

const PAGE_SIZE = 50;

export async function renderSearch(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<div class="search-export">
			<div>
				<div class="search-export-title">Export your collection</div>
				<div class="hint">Exports all notes as an Anki .apkg file. Review progress is not included.</div>
			</div>
			<button id="export-apkg-btn" type="button" class="secondary">Export .apkg</button>
		</div>
		<div id="export-apkg-status" class="hint"></div>
		<input id="search-input" type="search" placeholder="Search notes..." autocomplete="off" />
		<div id="search-status" class="hint"></div>
		<div id="search-results" class="card-area"></div>
		<button id="search-more" type="button" class="secondary" style="display:none;margin-top:0.5rem;width:100%;">Load more</button>
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

	const doSearch = async (append: boolean) => {
		const q = input.value.trim();
		if (!append) {
			loaded = 0;
			results.innerHTML = "";
		}
		status.textContent = "Searching…";
		moreBtn.style.display = "none";
		try {
			const res = await searchNotes(q, PAGE_SIZE, loaded);
			total = res.total;
			if (!append) results.innerHTML = "";
			if (res.notes.length === 0 && loaded === 0) {
				status.textContent = "No notes found";
				return;
			}
			for (const note of res.notes) {
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

	results.addEventListener("click", async (e) => {
		const target = e.target as HTMLButtonElement;
		if (!target.classList.contains("search-delete-btn")) return;

		const row = target.closest(".search-row") as HTMLElement | null;
		if (!row) return;

		const noteId = row.dataset.noteId;
		if (!noteId) return;

		if (!confirm("确定删除这条词条吗？")) return;

		target.disabled = true;
		try {
			await deleteNote(noteId);
			row.remove();
			total--;
			loaded--;
			status.textContent = `${loaded} of ${total}`;
		} catch (err) {
			alert(`删除失败: ${errorMessage(err)}`);
		} finally {
			target.disabled = false;
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

	const deleteBtn = document.createElement("button");
	deleteBtn.type = "button";
	deleteBtn.className = "search-delete-btn";
	deleteBtn.textContent = "×";
	deleteBtn.title = "Delete";

	row.appendChild(front);
	row.appendChild(meta);
	row.appendChild(deleteBtn);
	return row;
}
