import { fetchQuiz, type ReviewCardView } from "./api";
import { setHtml } from "./dom";
import { renderFields } from "./fields";
import { errorMessage } from "./helpers";
import { registerShortcuts } from "./keyboard";
import { speak, stopSpeaking } from "./tts";

// Module-level cleanup so re-entering renderQuiz (route change) cleans up stale bindings.
let activeCleanup: (() => void) | null = null;

export async function renderQuiz(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<p class="hint">Random quiz. Reveal the answer, then move on.</p>
		<div id="quiz-area" class="card-area">Loading…</div>
	`;

	const area = root.querySelector("#quiz-area");
	if (!(area instanceof HTMLElement)) return;

	// Cleanup any bindings from a previous renderQuiz call
	if (activeCleanup) {
		activeCleanup();
		activeCleanup = null;
	}
	stopSpeaking();

	try {
		const selectedDeck = localStorage.getItem("selectedDeck") || null;
		const cards = await fetchQuiz(selectedDeck);
		if (cards.length === 0) {
			area.textContent = "No cards available for quiz.";
			return;
		}
		showQuizCard(area, cards, 0);
	} catch (err) {
		area.textContent = `Failed to load: ${errorMessage(err)}`;
	}
}

function showQuizCard(area: HTMLElement, cards: ReviewCardView[], index: number): void {
	// Cleanup previous keyboard bindings
	if (activeCleanup) {
		activeCleanup();
		activeCleanup = null;
	}
	stopSpeaking();

	if (index >= cards.length) {
		area.textContent = "Quiz complete.";
		return;
	}
	const card = cards[index];
	const values = Object.values(card.fields);
	const front = values[0] ?? "";
	const fieldKeys = Object.keys(card.fields);
	const frontKey = fieldKeys[0] ?? "";
	const backHtml = renderFields(card.fields, frontKey);

	area.innerHTML = `
		<div class="card-front">
			<span class="card-word"></span>
			<button id="tts-btn" class="secondary" type="button" title="Listen">🔊</button>
		</div>
		<button id="reveal-btn" class="primary" type="button">Reveal Answer</button>
		<div id="back-wrap" hidden><div class="card-back"></div></div>
		<button id="next-btn" class="secondary" type="button" hidden>Next</button>
	`;

	setHtml(area, ".card-word", front);
	const backEl = area.querySelector(".card-back");
	if (backEl instanceof HTMLElement) backEl.innerHTML = backHtml;

	const ttsBtn = area.querySelector("#tts-btn");
	const revealBtn = area.querySelector("#reveal-btn");
	const backWrap = area.querySelector("#back-wrap");
	const nextBtn = area.querySelector("#next-btn");

	function goNext() {
		showQuizCard(area, cards, index + 1);
	}

	let revealed = false;

	function doReveal() {
		if (revealed) return;
		revealed = true;
		if (backWrap instanceof HTMLElement) backWrap.hidden = false;
		if (revealBtn instanceof HTMLButtonElement) revealBtn.hidden = true;
		if (nextBtn instanceof HTMLButtonElement) nextBtn.hidden = false;
		speak(front);
		// Cleanup front-side bindings, register next-card shortcut
		if (activeCleanup) {
			activeCleanup();
			activeCleanup = null;
		}
		activeCleanup = registerShortcuts([
			{ key: "n", handler: goNext },
			{ key: "N", handler: goNext },
			{ key: "ArrowRight", handler: goNext },
		]);
	}

	if (ttsBtn instanceof HTMLButtonElement) {
		ttsBtn.addEventListener("click", () => speak(front));
	}

	if (revealBtn instanceof HTMLButtonElement) {
		revealBtn.addEventListener("click", doReveal);
	}
	if (nextBtn instanceof HTMLButtonElement) {
		nextBtn.addEventListener("click", goNext);
	}

	// Register front-side keyboard shortcut: Space/Enter to reveal
	activeCleanup = registerShortcuts([
		{ key: " ", handler: doReveal },
		{ key: "Enter", handler: doReveal },
	]);
}
