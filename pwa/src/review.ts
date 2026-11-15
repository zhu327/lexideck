import { fetchEnrichment, ReviewSubmitError, submitReview } from "./api";
import { adjustCachedDueTotal, setCachedDueTotal } from "./badge";
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
import { clampDragOffset, resolveSwipe, swipeIntent } from "./gestures";
import { haptic } from "./haptics";
import { errorMessage, type Rating } from "./helpers";
import { registerShortcuts } from "./keyboard";
import {
	batchErrorMessage,
	createSession,
	loadInitialBatch,
	loadNextBatch,
	type ReviewSession,
} from "./review-session";
import { getSyncStatus, PENDING_CHANGED_EVENT, syncReviewOps } from "./review-sync";
import { speak, speakIfEnabled, stopSpeaking } from "./tts";
import { showToast } from "./ui";

// Module-level cleanup so re-entering renderReview (route change) cleans up stale bindings.
let activeCleanup: (() => void) | null = null;
// Aborts pointer listeners that belong to the card currently on screen.
let cardGestureAbort: AbortController | null = null;

/**
 * Remove any keyboard bindings and speech left over from an active review
 * screen. Called when navigating away from #review (see main.ts route()).
 */
export function cleanupReview(): void {
	if (activeCleanup) {
		activeCleanup();
		activeCleanup = null;
	}
	cardGestureAbort?.abort();
	cardGestureAbort = null;
	stopSpeaking();
}

export async function renderReview(root: HTMLElement): Promise<void> {
	const selectedDeck = localStorage.getItem("selectedDeck") || null;

	root.innerHTML = `
		<div class="review-page">
			<section class="page-hero review-hero" aria-labelledby="review-title">
				<div class="page-kicker">Daily Review</div>
				<h2 id="review-title">Review due cards</h2>
				<p class="hint">Flip each card, recall the answer, then rate your memory.</p>
				<span id="review-due" class="due-chip" hidden></span>
			</section>
			<div id="sync-status" class="sync-status" role="status" aria-live="polite"></div>
			<div id="review-card" class="card-area">
				<div class="card-skeleton" aria-hidden="true">
					<div class="skeleton-line skeleton-line-sm"></div>
					<div class="skeleton-line skeleton-line-word"></div>
					<div class="skeleton-line skeleton-line-cta"></div>
				</div>
				<span class="visually-hidden">Loading cards…</span>
			</div>
			<div id="load-more-wrap" hidden>
				<button id="load-more-btn" class="secondary" type="button">Load more reviews</button>
			</div>
		</div>
	`;

	const cardArea = root.querySelector("#review-card");
	const loadMoreWrap = root.querySelector("#load-more-wrap");
	if (!(cardArea instanceof HTMLElement) || !(loadMoreWrap instanceof HTMLElement)) return;

	// Cleanup any bindings from a previous renderReview call (or a stale route)
	cleanupReview();

	const session = createSession(selectedDeck);
	session.onComplete = () => {
		renderReview(root);
	};

	try {
		await loadInitialBatch(session);
		setCachedDueTotal(session.total);

		const dueChip = root.querySelector("#review-due");
		if (dueChip instanceof HTMLElement) {
			const count = session.total;
			dueChip.hidden = false;
			dueChip.dataset.state = count > 0 ? "due" : "clear";
			dueChip.textContent = count > 0 ? `${count} due` : "All clear";
		}

		const syncStatusEl = root.querySelector("#sync-status");
		if (syncStatusEl instanceof HTMLElement) {
			const status = await getSyncStatus();
			renderSyncStatus(syncStatusEl, {
				...status,
				offline: session.offlineCached || !navigator.onLine,
			});
		}

		if (session.cards.length === 0) {
			showEmptyState(cardArea);
			return;
		}

		await showCard(cardArea, loadMoreWrap, session, 0);
	} catch (err) {
		showErrorState(cardArea, errorMessage(err), () => {
			renderReview(root);
		});
	}
}

/** Network/API failure with a retry affordance. */
function showErrorState(area: HTMLElement, message: string, onRetry: () => void): void {
	const block = document.createElement("div");
	block.className = "state-block";
	block.setAttribute("role", "status");
	block.innerHTML = `
		<div class="state-icon" aria-hidden="true">📡</div>
		<div class="state-title">Couldn't load cards</div>
		<p class="state-hint"></p>
		<button id="review-retry-btn" class="secondary" type="button">Try again</button>
	`;
	const hint = block.querySelector(".state-hint");
	if (hint instanceof HTMLElement) hint.textContent = message;
	const retryBtn = block.querySelector("#review-retry-btn");
	if (retryBtn instanceof HTMLButtonElement) {
		retryBtn.addEventListener("click", onRetry);
	}
	area.innerHTML = "";
	area.appendChild(block);
}

/** All-caught-up state with a route out (instead of a dead end). */
function showEmptyState(area: HTMLElement): void {
	area.innerHTML = `
		<div class="state-block" role="status">
			<div class="state-icon" aria-hidden="true">✅</div>
			<div class="state-title">All caught up</div>
			<p class="state-hint">No cards are due right now. Come back later or browse your deck.</p>
			<button id="empty-browse-btn" class="primary" type="button">Browse your deck</button>
		</div>
	`;
	const browseBtn = area.querySelector("#empty-browse-btn");
	if (browseBtn instanceof HTMLButtonElement) {
		browseBtn.addEventListener("click", () => {
			window.location.hash = "#search";
		});
	}
}

/** True when the user is selecting text (so a click is not a flip/rating). */
function hasTextSelection(): boolean {
	if (typeof window === "undefined" || typeof window.getSelection !== "function") return false;
	return Boolean(window.getSelection()?.toString().trim());
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
	// Drop the previous card's pointer listeners so a swipe can only ever rate
	// the card currently on screen.
	cardGestureAbort?.abort();
	const gestureAbort = new AbortController();
	cardGestureAbort = gestureAbort;
	stopSpeaking();

	// Returning to the top of the page when the next card appears keeps the
	// thumb on the flip/rating controls after reading a long card on mobile.
	if (typeof window !== "undefined" && window.scrollY > 80) {
		const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
		window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
	}

	if (index >= session.cards.length) {
		// End of current batch — try loading more
		try {
			const nextCards = await loadNextBatch(session);
			if (nextCards === null) {
				showCompletionPage(area, session.total, session.onComplete ?? (() => {}));
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
	// Read the front lazily so edits to session.cards[index] are picked up
	// by TTS and the flip action.
	const currentFront = (): string => {
		const current = session.cards[index] ?? card;
		return Object.values(current.fields)[0] ?? "";
	};

	// Build card DOM
	area.innerHTML = buildCardHTML();
	area.classList.add("card-enter");
	setTimeout(() => area.classList.remove("card-enter"), 260);
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
				haptic([8, 40, 8]);
				// Keep the card on screen and confirm via the global snackbar instead
				// of blanking the card area with a transient message.
				showToast({
					key: "queued-review",
					tone: "warning",
					message:
						result.queuedReason === "server-error"
							? "Server unavailable — review saved offline."
							: "Saved offline — will sync when you're back online.",
				});
				if (typeof window !== "undefined") {
					window.dispatchEvent(new Event(PENDING_CHANGED_EVENT));
				}
				const syncStatusEl = document.querySelector("#sync-status");
				if (syncStatusEl instanceof HTMLElement) {
					const status = await getSyncStatus();
					renderSyncStatus(syncStatusEl, { ...status, offline: !navigator.onLine });
				}
				await delay(200);
				await showCard(area, loadMoreWrap, session, index + 1);
			} else {
				adjustCachedDueTotal(-1);
				showIntervalFeedback(area, result.due);
				await delay(420);
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
		haptic(8);
		if (backWrap instanceof HTMLElement) backWrap.hidden = false;
		if (flipBtn instanceof HTMLButtonElement) flipBtn.hidden = true;
		const frontEl = area.querySelector("#card-front");
		if (frontEl instanceof HTMLElement) frontEl.dataset.flippable = "false";
		area.classList.add("flipping");
		setTimeout(() => area.classList.remove("flipping"), 300);
		speakIfEnabled(currentFront());
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

		// Move focus onto the answer region so screen readers announce the back
		// side and the rating shortcut numbers are the next tab stops.
		if (backWrap instanceof HTMLElement) {
			backWrap.setAttribute("tabindex", "-1");
			backWrap.focus({ preventScroll: true });
		}

		// Auto-load enrichment — cached per note for this session to avoid
		// re-fetching the same note on every flip.
		const cached = session.enrichmentCache.get(card.noteId);
		if (cached !== undefined) {
			if (cached && enrichResult instanceof HTMLElement) {
				displayEnrichment(enrichResult, cached);
				if (enrichBtn instanceof HTMLButtonElement) enrichBtn.textContent = "Refresh";
			}
			return;
		}
		// Reserve the enrichment block with a skeleton so the rating row does not
		// jump under the user's thumb when the answer arrives.
		if (enrichResult instanceof HTMLElement) {
			enrichResult.innerHTML = `
				<div class="enrich-skeleton" aria-hidden="true">
					<div class="skeleton-line"></div>
					<div class="skeleton-line"></div>
					<div class="skeleton-line skeleton-line-short"></div>
				</div>
			`;
		}
		const fetched = await fetchEnrichment(card.noteId);
		session.enrichmentCache.set(card.noteId, fetched);
		if (fetched) {
			if (enrichResult instanceof HTMLElement) {
				displayEnrichment(enrichResult, fetched);
			}
			if (enrichBtn instanceof HTMLButtonElement) {
				enrichBtn.textContent = "Refresh";
			}
		} else if (enrichResult instanceof HTMLElement) {
			enrichResult.innerHTML =
				'<div class="enrich-empty">No enrichment yet — tap Enrich to generate one.</div>';
		}
	}

	if (ttsBtn instanceof HTMLButtonElement) {
		ttsBtn.addEventListener("click", () => speak(currentFront()));
	}

	if (flipBtn instanceof HTMLButtonElement) {
		flipBtn.addEventListener("click", doFlip);
	}

	// Tap anywhere on the word to reveal the answer (the whole card is the
	// target, matching how people expect a paper flashcard to behave).
	const cardFront = area.querySelector("#card-front");
	if (cardFront instanceof HTMLElement) {
		cardFront.addEventListener("click", (event) => {
			const target = event.target as Element | null;
			if (target?.closest("button, a, input, textarea, select")) return;
			if (hasTextSelection()) return; // copying the word must not flip the card
			void doFlip();
		});
	}

	/* ── Swipe to rate ──────────────────────────────────── */
	// Left = Again, right = Good. Horizontal-only so vertical scrolling still
	// works; the drag offset is painted as a subtle card translation.
	let dragStart: { x: number; y: number; pointerId: number } | null = null;

	const resetDrag = (): void => {
		dragStart = null;
		area.classList.remove("swiping", "swipe-left", "swipe-right");
		area.style.removeProperty("--swipe-x");
	};

	const onPointerDown = (event: PointerEvent): void => {
		if (!flipped || ratingSubmitted) return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		const target = event.target as Element | null;
		if (target?.closest("button, a, input, textarea, select")) return;
		dragStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
		try {
			area.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture is an enhancement; dragging still works without it.
		}
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (!dragStart || event.pointerId !== dragStart.pointerId) return;
		const dx = event.clientX - dragStart.x;
		const intent = swipeIntent(dx);
		if (intent === null) {
			area.classList.remove("swiping", "swipe-left", "swipe-right");
			area.style.removeProperty("--swipe-x");
			return;
		}
		area.classList.add("swiping");
		area.classList.toggle("swipe-right", intent === "right");
		area.classList.toggle("swipe-left", intent === "left");
		area.style.setProperty("--swipe-x", `${clampDragOffset(dx)}px`);
	};

	const onPointerUp = (event: PointerEvent): void => {
		if (!dragStart || event.pointerId !== dragStart.pointerId) return;
		const dx = event.clientX - dragStart.x;
		const dy = event.clientY - dragStart.y;
		resetDrag();
		if (!flipped || ratingSubmitted) return;
		if (hasTextSelection()) return; // selecting text must not rate the card
		const rating = resolveSwipe({ dx, dy });
		if (rating === null) return;
		haptic(12);
		void submitRating(rating);
	};

	const gestureOptions = { signal: gestureAbort.signal };
	area.addEventListener("pointerdown", onPointerDown, gestureOptions);
	area.addEventListener("pointermove", onPointerMove, gestureOptions);
	area.addEventListener("pointerup", onPointerUp, gestureOptions);
	area.addEventListener("pointercancel", resetDrag, gestureOptions);

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
				const updatedKeys = Object.keys(newFields);
				setHtml(area, ".card-word", newFields[updatedKeys[0] ?? ""] ?? "");
				setHtml(area, ".card-back", renderFields(newFields, updatedKeys[0] ?? ""));
			});
		});
	}

	if (enrichBtn instanceof HTMLButtonElement && enrichResult instanceof HTMLElement) {
		setupEnrichButton(enrichBtn, enrichResult, card.noteId, (enrichment) => {
			session.enrichmentCache.set(card.noteId, enrichment);
		});
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
