import { type Enrichment, enrichNote, fetchDue, type ReviewCardView, submitReview } from "./api";
import { setText } from "./dom";
import { errorMessage, RATING_LABELS, type Rating } from "./helpers";

const RATINGS: Rating[] = [1, 2, 3, 4];

export async function renderReview(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<p class="hint">Review due cards. Flip to reveal, then rate your recall.</p>
		<div id="review-card" class="card-area">Loading…</div>
	`;

	const cardArea = root.querySelector("#review-card");
	if (!(cardArea instanceof HTMLElement)) return;

	try {
		const cards = await fetchDue();
		if (cards.length === 0) {
			cardArea.textContent = "No cards due. Nice!";
			return;
		}
		await showCard(cardArea, cards, 0);
	} catch (err) {
		cardArea.textContent = `Failed to load: ${errorMessage(err)}`;
	}
}

async function showCard(area: HTMLElement, cards: ReviewCardView[], index: number): Promise<void> {
	if (index >= cards.length) {
		area.textContent = "All reviews done. Nice!";
		return;
	}
	const card = cards[index];
	const values = Object.values(card.fields);
	const front = values[0] ?? "";
	const back = values.slice(1).join("\n\n");

	area.innerHTML = `
		<div class="card-meta"></div>
		<div class="card-front"></div>
		<button id="flip-btn" class="primary" type="button">Show Answer</button>
		<div id="back-wrap" hidden>
			<div class="card-back"></div>
			<div class="ratings" id="ratings"></div>
		</div>
		<button id="enrich-btn" class="secondary" type="button">Enrich</button>
		<div id="enrich-result" class="enrich-text"></div>
	`;

	setText(area, ".card-meta", `${card.deckName} · ${card.modelName}`);
	setText(area, ".card-front", front);
	setText(area, ".card-back", back);

	const flipBtn = area.querySelector("#flip-btn");
	const backWrap = area.querySelector("#back-wrap");
	const ratingsEl = area.querySelector("#ratings");
	const enrichBtn = area.querySelector("#enrich-btn");
	const enrichResult = area.querySelector("#enrich-result");

	if (flipBtn instanceof HTMLButtonElement) {
		flipBtn.addEventListener("click", () => {
			if (backWrap instanceof HTMLElement) backWrap.hidden = false;
			flipBtn.hidden = true;
			renderRatings(ratingsEl, async (rating) => {
				disableButtons(ratingsEl);
				try {
					await submitReview(card.cardId, rating);
					await showCard(area, cards, index + 1);
				} catch (err) {
					if (ratingsEl instanceof HTMLElement) {
						ratingsEl.textContent = `Submit failed: ${errorMessage(err)}`;
					}
				}
			});
		});
	}

	if (enrichBtn instanceof HTMLButtonElement) {
		enrichBtn.addEventListener("click", async () => {
			enrichBtn.disabled = true;
			setText(area, "#enrich-result", "Loading…");
			const result = await enrichNote(card.noteId);
			if (enrichResult instanceof HTMLElement) {
				if ("error" in result) {
					enrichResult.textContent = result.error;
				} else {
					displayEnrichment(enrichResult, result);
				}
			}
			enrichBtn.disabled = false;
		});
	}
}

function renderRatings(container: Element | null, onSubmit: (rating: Rating) => void): void {
	if (!(container instanceof HTMLElement)) return;
	container.innerHTML = "";
	for (const rating of RATINGS) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.textContent = RATING_LABELS[rating];
		btn.addEventListener("click", () => onSubmit(rating));
		container.appendChild(btn);
	}
}

function disableButtons(container: Element | null): void {
	for (const btn of container?.querySelectorAll("button") ?? []) {
		if (btn instanceof HTMLButtonElement) btn.disabled = true;
	}
}

function displayEnrichment(el: HTMLElement, e: Enrichment): void {
	el.innerHTML = "";
	const parts: Array<[string, string]> = [
		["Example", e.exampleSentence],
		["Definition", e.extendedDefinition],
		["Mnemonic", e.mnemonic],
	];
	for (const [label, text] of parts) {
		const labelEl = document.createElement("div");
		labelEl.className = "enrich-label";
		labelEl.textContent = label;
		const textEl = document.createElement("div");
		textEl.className = "enrich-text";
		textEl.textContent = text;
		el.appendChild(labelEl);
		el.appendChild(textEl);
	}
}
