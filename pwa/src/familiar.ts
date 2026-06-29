import { type FamiliarCard, fetchFamiliarList, markFamiliar, unmarkFamiliar } from "./api";
import { errorMessage } from "./helpers";

export async function renderFamiliar(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<p class="hint">Mark words you already know and they'll leave your review queue.</p>
		<div id="familiar-list" class="card-area">Loading…</div>
	`;

	const list = root.querySelector("#familiar-list");
	if (!(list instanceof HTMLElement)) return;

	try {
		const selectedDeck = localStorage.getItem("selectedDeck") || null;
		const cards = await fetchFamiliarList(selectedDeck);
		if (cards.length === 0) {
			list.textContent = "No notes available.";
			return;
		}
		list.innerHTML = "";
		for (const card of cards) {
			list.appendChild(renderFamiliarRow(card));
		}
	} catch (err) {
		list.textContent = `Failed to load: ${errorMessage(err)}`;
	}
}

function renderFamiliarRow(card: FamiliarCard): HTMLElement {
	const row = document.createElement("div");
	row.className = "familiar-row";

	const text = document.createElement("span");
	text.className = "familiar-word";
	text.innerHTML = card.front;

	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "secondary";

	let currentHandler: (() => void) | null = null;

	function bindButton(
		label: string,
		pendingLabel: string,
		action: () => Promise<void>,
		next: () => void,
	) {
		btn.textContent = label;
		btn.disabled = false;
		btn.title = "";
		if (currentHandler) {
			btn.removeEventListener("click", currentHandler);
		}
		currentHandler = async () => {
			btn.disabled = true;
			btn.textContent = pendingLabel;
			try {
				await action();
				next();
			} catch (err) {
				btn.textContent = "Failed";
				btn.title = errorMessage(err);
				btn.disabled = false;
			}
		};
		btn.addEventListener("click", currentHandler);
	}

	function bindMark() {
		bindButton("Mark familiar", "Marking…", () => markFamiliar(card.noteId), bindUnmark);
	}

	function bindUnmark() {
		bindButton("Unmark", "Unmarking…", () => unmarkFamiliar(card.noteId), bindMark);
	}

	if (card.known) {
		bindUnmark();
	} else {
		bindMark();
	}

	row.appendChild(text);
	row.appendChild(btn);
	return row;
}
