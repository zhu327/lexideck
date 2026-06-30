import "./styles.css";
import { fetchDeckNames, fetchDue, getApiKey, setApiKey } from "./api";
import { renderReview } from "./review";
import { syncReviewOps } from "./review-sync";
import { renderSearch } from "./search";
import { renderStats } from "./stats";

/* ── Setup Screen ─────────────────────────────────────── */

function renderSetup(app: HTMLElement): void {
	app.innerHTML = `
		<div class="setup-screen">
			<h1>Anki Vocab</h1>
			<p>Enter your API key to connect to your Anki backend.</p>
			<form id="setup-form" class="setup-card">
				<label for="api-key-input">API Key</label>
				<input id="api-key-input" type="password" autocomplete="off" placeholder="Paste your API key" />
				<button type="submit" id="setup-submit">Connect</button>
				<p id="setup-error" class="setup-error" hidden></p>
			</form>
		</div>
	`;

	const form = document.getElementById("setup-form") as HTMLFormElement;
	const input = document.getElementById("api-key-input") as HTMLInputElement;
	const error = document.getElementById("setup-error") as HTMLParagraphElement;
	const submit = document.getElementById("setup-submit") as HTMLButtonElement;

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const key = input.value.trim();
		if (!key) return;

		submit.disabled = true;
		submit.textContent = "Connecting…";
		error.hidden = true;

		try {
			const res = await fetch("/api/health", {
				headers: { Authorization: `Bearer ${key}` },
			});
			if (!res.ok) throw new Error("Invalid API key");
			setApiKey(key);
			bootApp();
		} catch {
			error.textContent = "Invalid API key. Please try again.";
			error.hidden = false;
			submit.disabled = false;
			submit.textContent = "Connect";
		}
	});

	input.focus();
}

/* ── Boot ─────────────────────────────────────────────── */

const app = document.getElementById("app");
if (!app) throw new Error("#app element not found");

function bootApp(): void {
	app.innerHTML = `
	<header>
		<h1>Anki Vocab</h1>
		<div class="header-controls">
			<select id="deck-selector">
				<option value="">All Decks</option>
			</select>
		</div>
	</header>
	<div id="offline-indicator" class="offline-indicator">You're offline — changes will sync when reconnected</div>
	<main id="screen"></main>
	<nav class="tabs" id="main-nav">
		<a href="#review">
			<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg></span>
			Review
		</a>
		<a href="#search">
			<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>
			Search
		</a>
		<a href="#stats">
			<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg></span>
			Stats
		</a>
	</nav>
`;

	const screen = document.getElementById("screen");
	const offlineIndicator = document.getElementById("offline-indicator");

	if (!screen || !offlineIndicator) {
		throw new Error("Required elements not found");
	}

	/* ── Offline Detection ────────────────────────────────── */

	function updateOnlineStatus(): void {
		const online = navigator.onLine;
		if (online) {
			offlineIndicator.classList.remove("visible");
			syncReviewOps().catch(() => {});
		} else {
			offlineIndicator.classList.add("visible");
		}
	}

	window.addEventListener("online", updateOnlineStatus);
	window.addEventListener("offline", updateOnlineStatus);
	updateOnlineStatus();

	/* ── Badge API — show pending review count ────────────── */

	async function updateBadge(): Promise<void> {
		if (!("setAppBadge" in navigator)) return;
		try {
			const deck = localStorage.getItem("selectedDeck") || null;
			const { total } = await fetchDue(deck, 1, 0);
			if (total > 0) {
				await (navigator as Navigator & { setAppBadge: (c: number) => Promise<void> }).setAppBadge(
					total,
				);
			} else {
				await (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
			}
		} catch {
			// Badge API unavailable or fetch failed — ignore
		}
	}

	// Update badge on load and after reviews
	updateBadge().catch(() => {});
	syncReviewOps().catch(() => {});
	window.addEventListener("hashchange", () => {
		if (window.location.hash === "#review" || !window.location.hash) {
			updateBadge().catch(() => {});
		}
	});

	/* ── Deck Selector ────────────────────────────────────── */

	const deckSelector = document.getElementById("deck-selector") as HTMLSelectElement | null;
	if (deckSelector) {
		const saved = localStorage.getItem("selectedDeck") || "";
		fetchDeckNames()
			.then((decks) => {
				for (const deck of decks) {
					const opt = document.createElement("option");
					opt.value = deck;
					opt.textContent = deck;
					deckSelector.appendChild(opt);
				}
				deckSelector.value = saved;
			})
			.catch(() => {
				// Deck list unavailable; selector stays on "All Decks"
			});

		deckSelector.addEventListener("change", () => {
			const val = deckSelector.value;
			if (val) {
				localStorage.setItem("selectedDeck", val);
			} else {
				localStorage.removeItem("selectedDeck");
			}
			route();
		});
	}

	/* ── Routing ──────────────────────────────────────────── */

	function route(): void {
		const hash = window.location.hash.replace(/^#/, "") || "review";

		// Highlight active tab
		const nav = document.getElementById("main-nav");
		if (nav) {
			for (const link of nav.querySelectorAll("a")) {
				const linkHash = link.getAttribute("href")?.replace(/^#/, "") || "";
				link.classList.toggle("active", linkHash === hash);
			}
		}

		screen.innerHTML = "";
		switch (hash) {
			case "search":
				renderSearch(screen);
				break;
			case "stats":
				renderStats(screen);
				break;
			default:
				renderReview(screen);
				break;
		}

		// After a route change, if the page is a review page, update badge
		if (hash === "review" || !hash) {
			syncReviewOps().catch(() => {});
			updateBadge().catch(() => {});
		}
	}

	window.addEventListener("hashchange", route);
	route();
} // end bootApp

// Show setup screen if no API key is stored, otherwise boot the app.
if (!getApiKey()) {
	renderSetup(app);
} else {
	bootApp();
}

/* ── Service Worker Registration ──────────────────────── */

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("/sw.js")
			.then((registration) => {
				// Listen for updates
				registration.addEventListener("updatefound", () => {
					const newWorker = registration.installing;
					if (!newWorker) return;

					newWorker.addEventListener("statechange", () => {
						if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
							// New version available — could show update prompt
							// For now, silently update on next navigation
							newWorker.postMessage({ type: "SKIP_WAITING" });
						}
					});
				});

				// Register background sync for review submissions
				if (registration.active) {
					registration.active.postMessage({ type: "REGISTER_SYNC" });
					registration.active.postMessage({ type: "REGISTER_PERIODIC_SYNC" });
				}

				// Listen for messages from service worker
				navigator.serviceWorker.addEventListener("message", (event) => {
					if (event.data?.type === "trigger-sync") {
						syncReviewOps().catch(() => {});
					}
					if (event.data?.type === "due-count" && typeof event.data.count === "number") {
						if ("setAppBadge" in navigator) {
							const n = navigator as Navigator & {
								setAppBadge: (c: number) => Promise<void>;
								clearAppBadge: () => Promise<void>;
							};
							if (event.data.count > 0) {
								n.setAppBadge(event.data.count).catch(() => {});
							} else {
								n.clearAppBadge().catch(() => {});
							}
						}
					}
				});
			})
			.catch(() => {
				// Best-effort registration; ignore failures.
			});
	});
}
