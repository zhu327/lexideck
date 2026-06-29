import type { Enrichment, ReviewCardView } from "./api";
import { setHtml, setText } from "./dom";
import { renderFields } from "./fields";
import { formatInterval, RATING_LABELS, type Rating, stateClass, stateLabel } from "./helpers";

/**
 * Build the inner HTML for a review card area.
 */
export function buildCardHTML(): string {
	return `
		<div class="card-meta"></div>
		<div class="progress-indicator"></div>
		<div class="card-front">
			<span class="card-word"></span>
			<button id="tts-btn" class="secondary" type="button" title="Listen">🔊</button>
		</div>
		<button id="flip-btn" class="primary" type="button">Show Answer</button>
		<div id="back-wrap" hidden>
			<div class="card-back"></div>
			<div class="enrich-actions">
				<button id="enrich-btn" class="secondary" type="button">Enrich</button>
			</div>
			<div id="enrich-result"></div>
			<div class="ratings" id="ratings"></div>
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
		metaEl.innerHTML = `<span class="state-badge ${stateClass(card.state)}">${stateLabel(card.state)}</span>${card.deckName} · ${card.modelName}`;
	}
	const values = Object.values(card.fields);
	const front = values[0] ?? "";
	setHtml(area, ".card-word", front);
	const fieldKeys = Object.keys(card.fields);
	const frontKey = fieldKeys[0] ?? "";
	const backHtml = renderFields(card.fields, frontKey);
	const backEl = area.querySelector(".card-back");
	if (backEl instanceof HTMLElement) backEl.innerHTML = backHtml;
	const current = offset - cardsLength + index + 1;
	setText(area, ".progress-indicator", `${current} / ${total}`);
}

/**
 * Render the celebration page when all cards are reviewed.
 */
export function showCompletionPage(area: HTMLElement, total: number): void {
	area.innerHTML = `
		<div class="completion">
			<div class="emoji">🎉</div>
			<div class="message">今日完成 ${total} 张！</div>
			<button id="completion-home" class="primary" type="button">Back to Home</button>
		</div>
	`;
	const homeBtn = area.querySelector("#completion-home");
	if (homeBtn instanceof HTMLButtonElement) {
		homeBtn.addEventListener("click", () => {
			location.hash = "#review";
			location.reload();
		});
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
 */
export function renderRatings(container: Element | null, onSubmit: (rating: Rating) => void): void {
	const RATINGS: Rating[] = [1, 2, 3, 4];
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

/**
 * Disable all buttons in a container.
 */
export function disableButtons(container: Element | null): void {
	for (const btn of container?.querySelectorAll("button") ?? []) {
		if (btn instanceof HTMLButtonElement) btn.disabled = true;
	}
}

/**
 * Show interval feedback after submitting a rating.
 */
export function showIntervalFeedback(area: HTMLElement, due: number): void {
	area.innerHTML = `<div class="interval-feedback">Next: ${formatInterval(due)}</div>`;
}
