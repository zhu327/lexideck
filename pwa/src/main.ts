import "./styles.css";
import { renderFamiliar } from "./familiar";
import { renderQuiz } from "./quiz";
import { renderReview } from "./review";

const app = document.getElementById("app");
if (!app) {
	throw new Error("#app element not found");
}

app.innerHTML = `
	<header>
		<h1>Anki Vocab</h1>
		<nav class="tabs">
			<a href="#review">Review</a>
			<a href="#quiz">Quiz</a>
			<a href="#familiar">Familiar</a>
		</nav>
	</header>
	<main id="screen"></main>
`;

const screen = document.getElementById("screen");
if (!screen) {
	throw new Error("#screen element not found");
}

function route(): void {
	const hash = window.location.hash.replace(/^#/, "") || "review";
	screen.innerHTML = "";
	switch (hash) {
		case "quiz":
			renderQuiz(screen);
			break;
		case "familiar":
			renderFamiliar(screen);
			break;
		default:
			renderReview(screen);
			break;
	}
}

window.addEventListener("hashchange", route);
route();

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {
			// Best-effort registration; ignore failures.
		});
	});
}
