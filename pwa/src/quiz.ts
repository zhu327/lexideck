import { fetchQuiz, type ReviewCardView } from "./api";
import { errorMessage } from "./helpers";

export async function renderQuiz(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<p class="hint">Random quiz. Reveal the answer, then move on.</p>
		<div id="quiz-area" class="card-area">Loading…</div>
	`;

	const area = root.querySelector("#quiz-area");
	if (!(area instanceof HTMLElement)) return;

	try {
		const cards = await fetchQuiz();
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
	if (index >= cards.length) {
		area.textContent = "Quiz complete.";
		return;
	}
	const card = cards[index];
	const values = Object.values(card.fields);
	const front = values[0] ?? "";
	const back = values.slice(1).join("\n\n");

	area.innerHTML = `
		<div class="card-front"></div>
		<button id="reveal-btn" class="primary" type="button">Reveal Answer</button>
		<div id="back-wrap" hidden><div class="card-back"></div></div>
		<button id="next-btn" class="secondary" type="button" hidden>Next</button>
	`;

	setText(area, ".card-front", front);
	setText(area, ".card-back", back);

	const revealBtn = area.querySelector("#reveal-btn");
	const backWrap = area.querySelector("#back-wrap");
	const nextBtn = area.querySelector("#next-btn");

	if (revealBtn instanceof HTMLButtonElement) {
		revealBtn.addEventListener("click", () => {
			if (backWrap instanceof HTMLElement) backWrap.hidden = false;
			revealBtn.hidden = true;
			if (nextBtn instanceof HTMLButtonElement) nextBtn.hidden = false;
		});
	}
	if (nextBtn instanceof HTMLButtonElement) {
		nextBtn.addEventListener("click", () => showQuizCard(area, cards, index + 1));
	}
}

function setText(scope: HTMLElement, selector: string, text: string): void {
	const el = scope.querySelector(selector);
	if (el instanceof HTMLElement) el.textContent = text;
}
