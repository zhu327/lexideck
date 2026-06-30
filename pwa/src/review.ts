import { fetchEnrichment, ReviewSubmitError, submitReview } from "./api";
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
import { getSyncStatus, syncReviewOps } from "./review-sync";
import { speak, stopSpeaking } from "./tts";

// Module-level cleanup so re-entering renderReview (route change) cleans up stale bindings.
let activeCleanup: (() => void) | null = null;

export async function renderReview(root: HTMLElement): Promise<void> {
	const selectedDeck = localStorage.getItem("selectedDeck") || null;

	root.innerHTML = `
		<div class="review-page">
			<section class="page-hero review-hero" aria-labelledby="review-title">
				<div class="page-kicker">Daily Review</div>
				<h2 id="review-title">Review due cards</h2>
				<p class="hint">Flip each card, recall the answer, then rate your memory.</p>
			</section>
			<div id="sync-status" class="sync-status"></div>
			<div id="review-card" class="card-area">Loading…</div>
			<div id="load-more-wrap" hidden>
				<button id="load-more-btn" class="secondary" type="button">Load more reviews</button>
			</div>
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

		const syncStatusEl = root.querySelector("#sync-status");
		if (syncStatusEl instanceof HTMLElement) {
			const status = await getSyncStatus();
			renderSyncStatus(syncStatusEl, {
				...status,
				offline: session.offlineCached || !navigator.onLine,
			});
		}

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
			const result = await submitReview(card.cardId, rating, session.scope);
			if (result.queued) {
				showOfflineToast(area, result.queuedReason);
				const syncStatusEl = document.querySelector("#sync-status");
				if (syncStatusEl instanceof HTMLElement) {
					const status = await getSyncStatus();
					renderSyncStatus(syncStatusEl, { ...status, offline: !navigator.onLine });
				}
				await delay(600);
				await showCard(area, loadMoreWrap, session, index + 1);
			} else {
				showIntervalFeedback(area, result.due);
				await delay(800);
				await showCard(area, loadMoreWrap, session, index + 1);
			}
		} catch (err) {
			ratingSubmitted = false;
			if (err instanceof ReviewSubmitError) {
				if (ratingsEl instanceof HTMLElement) {
					if (err.kind === "server-priority") {
						ratingsEl.textContent = "Card state changed on server. Refreshing...";
						try {
							await loadInitialBatch(session);
							await showCard(area, loadMoreWrap, session, 0);
						} catch {
							ratingsEl.textContent = "Refresh failed. Please try again.";
						}
					} else {
						ratingsEl.textContent = err.message;
					}
				}
			} else {
				if (ratingsEl instanceof HTMLElement) {
					ratingsEl.textContent = `Submit failed: ${errorMessage(err)}`;
				}
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

function renderSyncStatus(
	el: HTMLElement,
	status: { pendingCount: number; offline: boolean; lastError?: string },
): void {
	if (status.lastError) {
		el.innerHTML = `<span class="sync-error">Sync failed — <button id="sync-retry-btn" class="link-btn" type="button">tap to retry</button></span>`;
		const retryBtn = el.querySelector("#sync-retry-btn");
		if (retryBtn instanceof HTMLButtonElement) {
			retryBtn.addEventListener("click", () => triggerSync(el));
		}
	} else if (status.offline) {
		el.textContent = "Offline — using cached cards";
	} else if (status.pendingCount > 0) {
		el.textContent = `${status.pendingCount} review${status.pendingCount > 1 ? "s" : ""} pending sync`;
	} else {
		el.textContent = "";
	}
}

async function triggerSync(statusEl: HTMLElement): Promise<void> {
	await syncReviewOps();
	const status = await getSyncStatus();
	renderSyncStatus(statusEl, { ...status, offline: !navigator.onLine });
}

function showOfflineToast(area: HTMLElement, reason?: string): void {
	const msg = reason === "server-error" ? "服务异常，已离线保存" : "已离线保存，联网后同步";
	area.innerHTML = `<div class="offline-toast">${msg}</div>`;
}
