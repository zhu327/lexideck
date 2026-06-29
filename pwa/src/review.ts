import { fetchEnrichment, submitReview } from "./api";
import {
	buildCardHTML,
	disableButtons,
	displayEnrichment,
	renderCardFields,
	renderRatings,
	showCompletionPage,
	showIntervalFeedback,
} from "./card-renderer";
import { setHtml } from "./dom";
import { openEditModal } from "./edit-modal";
import { setupEnrichButton } from "./enrichment-panel";
import { renderFields } from "./fields";
import { errorMessage, type Rating } from "./helpers";
import { registerShortcuts } from "./keyboard";
import {
	batchErrorMessage,
	createSession,
	loadInitialBatch,
	loadNextBatch,
	type ReviewSession,
} from "./review-session";
import { speak, stopSpeaking } from "./tts";

// Module-level cleanup so re-entering renderReview (route change) cleans up stale bindings.
let activeCleanup: (() => void) | null = null;

export async function renderReview(root: HTMLElement): Promise<void> {
	const selectedDeck = localStorage.getItem("selectedDeck") || null;

	root.innerHTML = `
		<p class="hint">Review due cards. Flip to reveal, then rate your recall.</p>
		<div id="review-card" class="card-area">Loading…</div>
		<div id="load-more-wrap" hidden>
			<button id="load-more-btn" class="secondary" type="button">Load more reviews</button>
		</div>
	`;

	const cardArea = root.querySelector("#review-card");
	const loadMoreWrap = root.querySelector("#load-more-wrap");
	if (!(cardArea instanceof HTMLElement) || !(loadMoreWrap instanceof HTMLElement)) return;

	// Cleanup any bindings from a previous renderReview call
	if (activeCleanup) {
		activeCleanup();
		activeCleanup = null;
	}
	stopSpeaking();

	const session = createSession(selectedDeck);

	try {
		await loadInitialBatch(session);

		if (session.cards.length === 0) {
			cardArea.textContent = "No cards due. Nice!";
			return;
		}

		await showCard(cardArea, loadMoreWrap, session, 0);
	} catch (err) {
		cardArea.textContent = `Failed to load: ${errorMessage(err)}`;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showCard(
	area: HTMLElement,
	loadMoreWrap: HTMLElement,
	session: ReviewSession,
	index: number,
): Promise<void> {
	// Cleanup previous keyboard bindings before rendering new card
	if (session.cleanupKeys) {
		session.cleanupKeys();
		session.cleanupKeys = null;
	}
	stopSpeaking();

	if (index >= session.cards.length) {
		// End of current batch — try loading more
		try {
			const nextCards = await loadNextBatch(session);
			if (nextCards === null) {
				showCompletionPage(area, session.total);
				loadMoreWrap.hidden = true;
				return;
			}
			index = 0;
		} catch (err) {
			area.textContent = batchErrorMessage(err, "Failed to load more");
			loadMoreWrap.hidden = true;
			return;
		}
	}

	const card = session.cards[index];
	const values = Object.values(card.fields);
	const front = values[0] ?? "";

	// Build card DOM
	area.innerHTML = buildCardHTML();
	renderCardFields(area, card, index, session.offset, session.cards.length, session.total);

	const ttsBtn = area.querySelector("#tts-btn");
	const flipBtn = area.querySelector("#flip-btn");
	const backWrap = area.querySelector("#back-wrap");
	const ratingsEl = area.querySelector("#ratings");
	const editBtn = area.querySelector("#edit-btn");
	const enrichBtn = area.querySelector("#enrich-btn");
	const enrichResult = area.querySelector("#enrich-result");

	let flipped = false;
	let ratingSubmitted = false;

	async function submitRating(rating: Rating) {
		if (ratingSubmitted) return;
		ratingSubmitted = true;
		disableButtons(ratingsEl);
		try {
			const { due } = await submitReview(card.cardId, rating);
			showIntervalFeedback(area, due);
			await delay(800);
			await showCard(area, loadMoreWrap, session, index + 1);
		} catch (err) {
			ratingSubmitted = false;
			if (ratingsEl instanceof HTMLElement) {
				ratingsEl.textContent = `Submit failed: ${errorMessage(err)}`;
			}
		}
	}

	// Helper to flip the card
	async function doFlip() {
		if (flipped) return;
		flipped = true;
		if (backWrap instanceof HTMLElement) backWrap.hidden = false;
		if (flipBtn instanceof HTMLButtonElement) flipBtn.hidden = true;
		area.classList.add("flipping");
		setTimeout(() => area.classList.remove("flipping"), 300);
		speak(front);
		// Cleanup front-side bindings, register rating shortcuts
		if (session.cleanupKeys) {
			session.cleanupKeys();
			session.cleanupKeys = null;
		}
		session.cleanupKeys = registerShortcuts([
			{ key: "1", handler: () => submitRating(1) },
			{ key: "2", handler: () => submitRating(2) },
			{ key: "3", handler: () => submitRating(3) },
			{ key: "4", handler: () => submitRating(4) },
		]);
		activeCleanup = session.cleanupKeys;
		renderRatings(ratingsEl, submitRating);

		// Auto-load cached enrichment
		const cached = await fetchEnrichment(card.noteId);
		if (cached) {
			if (enrichResult instanceof HTMLElement) {
				displayEnrichment(enrichResult, cached);
			}
			if (enrichBtn instanceof HTMLButtonElement) {
				enrichBtn.textContent = "Refresh";
			}
		}
	}

	if (ttsBtn instanceof HTMLButtonElement) {
		ttsBtn.addEventListener("click", () => speak(front));
	}

	if (flipBtn instanceof HTMLButtonElement) {
		flipBtn.addEventListener("click", doFlip);
	}

	// Register front-side keyboard shortcuts: Space/Enter to flip
	session.cleanupKeys = registerShortcuts([
		{ key: " ", handler: doFlip },
		{ key: "Enter", handler: doFlip },
	]);
	activeCleanup = session.cleanupKeys;

	if (editBtn instanceof HTMLButtonElement) {
		editBtn.addEventListener("click", () => {
			openEditModal(card, (newFields) => {
				session.cards[index] = { ...card, fields: newFields };
				// Re-render card display with updated fields
				const updatedValues = Object.values(newFields);
				const updatedKeys = Object.keys(newFields);
				setHtml(area, ".card-word", updatedValues[0] ?? "");
				const backEl2 = area.querySelector(".card-back");
				if (backEl2 instanceof HTMLElement)
					backEl2.innerHTML = renderFields(newFields, updatedKeys[0] ?? "");
			});
		});
	}

	if (enrichBtn instanceof HTMLButtonElement && enrichResult instanceof HTMLElement) {
		setupEnrichButton(enrichBtn, enrichResult, card.noteId);
	}

	// Show "Load more" at end of batch
	loadMoreWrap.hidden = index < session.cards.length - 1;

	const loadMoreBtn = loadMoreWrap.querySelector("#load-more-btn");
	if (loadMoreBtn instanceof HTMLButtonElement) {
		loadMoreBtn.replaceWith(loadMoreBtn.cloneNode(true));
		const newBtn = loadMoreWrap.querySelector("#load-more-btn");
		if (newBtn instanceof HTMLButtonElement) {
			newBtn.addEventListener("click", async () => {
				newBtn.disabled = true;
				newBtn.textContent = "Loading…";
				try {
					await showCard(area, loadMoreWrap, session, session.cards.length);
				} catch (err) {
					area.textContent = `Failed to load: ${errorMessage(err)}`;
				}
				newBtn.disabled = false;
				newBtn.textContent = "Load more reviews";
			});
		}
	}
}
