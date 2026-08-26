import "./styles.css";
import { fetchDeckNames } from "./api";
import { invalidateDueTotalCache, setBadge, updateBadge } from "./badge";
import { cleanupReview, renderReview } from "./review";
import { syncReviewOps } from "./review-sync";
import { renderSearch } from "./search";
import { renderStats } from "./stats";

/* ── Boot ─────────────────────────────────────────────── */

const app = document.getElementById("app");
if (!app) throw new Error("#app element not found");

function bootApp(app: HTMLElement): void {
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

	const updateOnlineStatus = (): void => {
		const online = navigator.onLine;
		if (online) {
			offlineIndicator.classList.remove("visible");
			syncReviewOps().catch(() => {});
		} else {
			offlineIndicator.classList.add("visible");
		}
	};

	window.addEventListener("online", updateOnlineStatus);
	window.addEventListener("offline", updateOnlineStatus);
	updateOnlineStatus();

	/* ── Badge API — show pending review count ────────────── */

	const selectedDeck = (): string | null => localStorage.getItem("selectedDeck") || null;

	// Update badge on load and after reviews. updateBadge() reuses the
	// cached due-total written by the review session, so this no longer
	// fires a duplicate `GET /api/review/due` next to renderReview().
	updateBadge(selectedDeck()).catch(() => {});
	syncReviewOps().catch(() => {});
	window.addEventListener("hashchange", () => {
		if (window.location.hash === "#review" || !window.location.hash) {
			updateBadge(selectedDeck()).catch(() => {});
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
			invalidateDueTotalCache();
			route();
		});
	}

	/* ── Routing ──────────────────────────────────────────── */

	const route = (): void => {
		const hash = window.location.hash.replace(/^#/, "") || "review";

		// Highlight active tab
		const nav = document.getElementById("main-nav");
		if (nav) {
			for (const link of nav.querySelectorAll("a")) {
				const linkHash = link.getAttribute("href")?.replace(/^#/, "") || "";
				link.classList.toggle("active", linkHash === hash);
			}
		}

		// Tear down review-screen keyboard bindings before switching screens so
		// stale shortcuts can't submit ratings from other tabs.
		cleanupReview();

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
			updateBadge(selectedDeck()).catch(() => {});
		}
	};

	window.addEventListener("hashchange", route);
	route();
} // end bootApp

// Cloudflare Access 负责身份认证，PWA 无需再登录/登出，直接启动应用。
bootApp(app);

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
					if (event.data?.type === "trigger-badge-refresh") {
						// SW 无法直接刷新徽标，从页面刷新。
						updateBadge(localStorage.getItem("selectedDeck") || null).catch(() => {});
					}
					if (event.data?.type === "due-count" && typeof event.data.count === "number") {
						setBadge(event.data.count).catch(() => {});
					}
				});
			})
			.catch(() => {
				// Best-effort registration; ignore failures.
			});
	});
}
