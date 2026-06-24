import { fetchDue, markFamiliar, type ReviewCardView } from "./api";
import { errorMessage } from "./helpers";

export async function renderFamiliar(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<p class="hint">Mark words you already know and they'll leave your review queue.</p>
		<div id="familiar-list" class="card-area">Loading…</div>
	`;

	const list = root.querySelector("#familiar-list");
	if (!(list instanceof HTMLElement)) return;

	try {
		const cards = await fetchDue();
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

function renderFamiliarRow(card: ReviewCardView): HTMLElement {
	const row = document.createElement("div");
	row.className = "familiar-row";

	const front = Object.values(card.fields)[0] ?? "";
	const text = document.createElement("span");
	text.className = "familiar-word";
	text.textContent = front;

	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "secondary";
	btn.textContent = "Mark familiar";
	btn.addEventListener("click", async () => {
		btn.disabled = true;
		btn.textContent = "Marking…";
		try {
			await markFamiliar(card.noteId);
			btn.textContent = "Marked";
		} catch (err) {
			btn.textContent = "Failed";
			btn.title = errorMessage(err);
			btn.disabled = false;
		}
	});

	row.appendChild(text);
	row.appendChild(btn);
	return row;
}
