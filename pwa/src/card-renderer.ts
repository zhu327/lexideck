import type { Enrichment, ReviewCardView } from "./api";
import { escapeHtml, setHtml } from "./dom";
import { renderFields } from "./fields";
import { formatInterval, RATING_LABELS, type Rating, stateClass, stateLabel } from "./helpers";

/**
 * Build the inner HTML for a review card area.
 */
export function buildCardHTML(): string {
	return `
		<div class="card-meta"></div>
		<div class="progress-indicator">
			<span class="progress-count"></span>
			<span class="progress-track" aria-hidden="true"><span class="progress-fill"></span></span>
		</div>
		<div class="card-front" id="card-front" data-flippable="true">
			<span class="card-word" aria-live="polite"></span>
			<button id="tts-btn" class="secondary" type="button" title="Listen" aria-label="Listen to pronunciation">🔊</button>
			<span class="card-hints" aria-hidden="true"><kbd>Space</kbd> or tap to flip</span>
		</div>
		<button id="flip-btn" class="primary" type="button">Show Answer</button>
		<div id="back-wrap" hidden>
			<div class="card-back"></div>
			<div class="enrich-actions">
				<button id="enrich-btn" class="secondary" type="button">Enrich</button>
			</div>
			<div id="enrich-result"></div>
			<div class="ratings" id="ratings" role="group" aria-label="Rate your recall" tabindex="-1"></div>
			<div class="swipe-hint" aria-hidden="true">swipe left = Again · swipe right = Good</div>
			<button id="edit-btn" class="secondary" type="button">Edit</button>
		</div>
	`;
}

/**
 * Populate DOM elements with card data after buildCardHTML.
 */
export function renderCardFields(
	area: HTMLElement,
	card: ReviewCardView,
	index: number,
	offset: number,
	cardsLength: number,
	total: number,
): void {
	const metaEl = area.querySelector(".card-meta");
	if (metaEl) {
		metaEl.innerHTML = `<span class="state-badge ${stateClass(card.state)}">${stateLabel(
			card.state,
		)}</span>${escapeHtml(card.deckName)} · ${escapeHtml(card.modelName)}`;
	}
	const values = Object.values(card.fields);
	const front = values[0] ?? "";
	setHtml(area, ".card-word", front);
	const fieldKeys = Object.keys(card.fields);
	const frontKey = fieldKeys[0] ?? "";
	setHtml(area, ".card-back", renderFields(card.fields, frontKey));
	const current = offset - cardsLength + index + 1;
	const progress = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
	const countEl = area.querySelector(".progress-count");
	if (countEl instanceof HTMLElement) countEl.textContent = `${current} / ${total}`;
	const fillEl = area.querySelector(".progress-fill");
	if (fillEl instanceof HTMLElement) fillEl.style.width = `${progress}%`;
}

/**
 * Render the celebration page when all cards are reviewed.
 * `onDone` is invoked when the user acknowledges — it should re-render the
 * review screen (no full page reload).
 */
export function showCompletionPage(area: HTMLElement, total: number, onDone: () => void): void {
	area.innerHTML = `
		<div class="completion" role="status">
			<div class="emoji" aria-hidden="true">🎉</div>
			<div class="message">今日完成 ${total} 张！</div>
			<p class="hint completion-hint">Great work — come back tomorrow for the next batch.</p>
			<button id="completion-home" class="primary" type="button">Done</button>
		</div>
	`;
	const homeBtn = area.querySelector("#completion-home");
	if (homeBtn instanceof HTMLButtonElement) {
		homeBtn.addEventListener("click", onDone);
	}
}

/**
 * Render enrichment data into the given element.
 */
export function displayEnrichment(el: HTMLElement, e: Enrichment): void {
	el.innerHTML = "";
	const parts: Array<[string, string, string]> = [
		["核心义", e.coreMeaning, "enrich-core"],
		["义项地图", e.meaningMap, ""],
		["用法提醒", e.usageNotes, ""],
		["记忆钩子", e.memoryHooks, ""],
		["自测", e.reviewPrompt, "enrich-prompt"],
	];
	for (const [label, text, modifier] of parts) {
		const section = document.createElement("div");
		section.className = modifier ? `enrich-section ${modifier}` : "enrich-section";
		const labelEl = document.createElement("div");
		labelEl.className = "enrich-label";
		labelEl.textContent = label;
		const textEl = document.createElement("div");
		textEl.className = "enrich-text";
		textEl.textContent = text;
		section.appendChild(labelEl);
		section.appendChild(textEl);
		el.appendChild(section);
	}
}

/**
 * Render rating buttons into the container.
 * Each button carries its keyboard shortcut number so the interaction is
 * discoverable without memorising the mapping.
 */
export function renderRatings(container: Element | null, onSubmit: (rating: Rating) => void): void {
	const RATINGS: Rating[] = [1, 2, 3, 4];
	if (!(container instanceof HTMLElement)) return;
	container.innerHTML = "";
	for (const rating of RATINGS) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.dataset.rating = String(rating);
		btn.setAttribute("aria-keyshortcuts", String(rating));
		const label = document.createElement("span");
		label.className = "rating-label";
		label.textContent = RATING_LABELS[rating];
		const key = document.createElement("span");
		key.className = "rating-key";
		key.setAttribute("aria-hidden", "true");
		key.textContent = String(rating);
		btn.appendChild(label);
		btn.appendChild(key);
		btn.addEventListener("click", () => onSubmit(rating));
		container.appendChild(btn);
	}
}

/**
 * Disable all buttons in a container.
 */
export function disableButtons(container: Element | null): void {
	for (const btn of container?.querySelectorAll("button") ?? []) {
		if (btn instanceof HTMLButtonElement) btn.disabled = true;
	}
}

/**
 * Show the next interval without clearing the card. The chip is appended to
 * the card so the answer stays on screen during the (short) advance delay.
 */
export function showIntervalFeedback(area: HTMLElement, due: number): void {
	area.querySelector(".interval-chip")?.remove();
	const chip = document.createElement("div");
	chip.className = "interval-chip";
	chip.setAttribute("role", "status");
	chip.textContent = `Next in ${formatInterval(due)}`;
	area.appendChild(chip);
}
