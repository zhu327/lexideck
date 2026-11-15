import "./styles.css";
import { clearApiKey, fetchDeckNames, getApiKey, setApiKey } from "./api";
import { invalidateDueTotalCache, setBadge, updateBadge } from "./badge";
import { haptic } from "./haptics";
import { errorMessage } from "./helpers";
import { initInstall } from "./install";
import { cleanupReview, renderReview } from "./review";
import { getSyncStatus, PENDING_CHANGED_EVENT, syncReviewOps } from "./review-sync";
import { cleanupSearch, renderSearch } from "./search";
import { closeNoteSheet } from "./search-card-actions";
import { renderStats } from "./stats";
import { isAutoSpeakEnabled, setAutoSpeakEnabled } from "./tts";
import { dismissToast, showToast } from "./ui";

/* ── Setup Screen ─────────────────────────────────────── */

function renderSetup(app: HTMLElement): void {
	app.innerHTML = `
		<div class="setup-screen">
			<h1>Anki Vocab</h1>
			<p>Enter your API key to connect to your Anki backend. The key is stored only on this device.</p>
			<form id="setup-form" class="setup-card">
				<label for="api-key-input">API Key</label>
				<input id="api-key-input" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste your API key" />
				<button type="submit" id="setup-submit">Connect</button>
				<p id="setup-error" class="setup-error" role="alert" hidden></p>
			</form>
		</div>
	`;

	const form = document.getElementById("setup-form") as HTMLFormElement;
	const input = document.getElementById("api-key-input") as HTMLInputElement;
	const error = document.getElementById("setup-error") as HTMLParagraphElement;
	const submit = document.getElementById("setup-submit") as HTMLButtonElement;

	const showError = (message: string): void => {
		error.textContent = message;
		error.hidden = false;
	};

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const key = input.value.trim();
		if (!key) {
			showError("Paste the API key from your deployment first.");
			return;
		}

		submit.disabled = true;
		submit.textContent = "Connecting…";
		error.hidden = true;

		try {
			const res = await fetch("/api/health", {
				headers: { Authorization: `Bearer ${key}` },
			});
			if (res.status === 401 || res.status === 403) {
				showError("That API key was rejected. Check it and try again.");
				return;
			}
			if (!res.ok) {
				showError(`The server answered with HTTP ${res.status}. Try again in a moment.`);
				return;
			}
			setApiKey(key);
			bootApp(app);
		} catch (err) {
			showError(
				navigator.onLine
					? `Could not reach the server: ${errorMessage(err)}`
					: "You're offline. Connect to the internet and try again.",
			);
		} finally {
			submit.disabled = false;
			submit.textContent = "Connect";
		}
	});

	input.focus();
}

/* ── Boot ─────────────────────────────────────────────── */

const app = document.getElementById("app");
if (!app) throw new Error("#app element not found");

const ROUTE_TITLES: Record<string, string> = {
	review: "Review",
	search: "Search",
	stats: "Stats",
};

function bootApp(app: HTMLElement): void {
	app.innerHTML = `
	<header>
		<h1>Anki Vocab</h1>
		<div class="header-controls">
			<select id="deck-selector" aria-label="Filter by deck">
				<option value="">All Decks</option>
			</select>
			<button id="tts-toggle" class="icon-btn" type="button" aria-pressed="true" title="Auto-pronounce on flip">🔊</button>
			<button id="install-btn" class="secondary install-btn" type="button" hidden>Install</button>
			<button id="logout-btn" class="secondary" type="button" title="Disconnect this device">Log out</button>
		</div>
	</header>
	<div id="route-announcer" class="visually-hidden" aria-live="polite"></div>
	<main id="screen"></main>
	<nav class="tabs" id="main-nav" aria-label="Main">
		<a href="#review" aria-current="page">
			<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg></span>
			Review
			<span class="tab-badge" id="sync-badge" hidden></span>
		</a>
		<a href="#search">
			<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>
			Search
		</a>
		<a href="#stats">
			<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg></span>
			Stats
		</a>
	</nav>
`;

	const screen = document.getElementById("screen");
	if (!screen) {
		throw new Error("Required elements not found");
	}

	const selectedDeck = (): string | null => localStorage.getItem("selectedDeck") || null;

	/* ── Sticky header elevation ──────────────────────────── */

	let headerScrolled = false;
	const syncHeaderElevation = (): void => {
		const scrolled = window.scrollY > 4;
		if (scrolled === headerScrolled) return;
		headerScrolled = scrolled;
		document.body.classList.toggle("is-scrolled", scrolled);
	};
	window.addEventListener("scroll", syncHeaderElevation, { passive: true });
	syncHeaderElevation();

	/* ── Offline queue sync ───────────────────────────────── */

	const syncBadge = document.getElementById("sync-badge");
	let syncing = false;

	async function refreshPendingBadge(): Promise<void> {
		if (!(syncBadge instanceof HTMLElement)) return;
		try {
			const { pendingCount } = await getSyncStatus();
			syncBadge.textContent = pendingCount > 9 ? "9+" : String(pendingCount);
			syncBadge.hidden = pendingCount === 0;
		} catch {
			// IndexedDB unavailable — there is no queue to show.
		}
	}

	async function runSync(
		reason: "startup" | "route" | "online" | "background" | "message",
	): Promise<void> {
		if (syncing) return;
		syncing = true;
		try {
			const result = await syncReviewOps();
			if (result.stoppedReason === "auth") {
				showToast({
					key: "sync-auth",
					tone: "error",
					duration: null,
					message: "Sync paused — your API key was rejected.",
					action: {
						label: "Log out",
						onClick: () => {
							clearApiKey();
							location.reload();
						},
					},
				});
			} else if (result.synced > 0) {
				const label = `Synced ${result.synced} review${result.synced === 1 ? "" : "s"}`;
				if (reason === "online") {
					showToast({ key: "connectivity", tone: "success", message: label });
				} else if (reason === "background" || reason === "message") {
					showToast({ tone: "success", message: label });
				}
			} else if (reason === "online") {
				// Nothing queued (or the flush stalled) — drop the lingering toast
				// instead of leaving "syncing…" on screen forever.
				dismissToast("connectivity");
			}
		} catch {
			// Offline storage unavailable; nothing to flush.
		} finally {
			syncing = false;
			await refreshPendingBadge();
		}
	}

	/* ── Connectivity ─────────────────────────────────────── */

	let wasOffline = !navigator.onLine;
	const OFFLINE_TOAST_KEY = "connectivity";

	function handleOffline(): void {
		wasOffline = true;
		showToast({
			key: OFFLINE_TOAST_KEY,
			tone: "warning",
			duration: null,
			message: "Offline — reviews are saved on this device.",
		});
	}

	function handleOnline(): void {
		if (!wasOffline) {
			void runSync("route");
			return;
		}
		wasOffline = false;
		showToast({
			key: OFFLINE_TOAST_KEY,
			tone: "success",
			duration: null,
			message: "Back online — syncing…",
		});
		void runSync("online");
	}

	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);
	window.addEventListener(PENDING_CHANGED_EVENT, () => {
		void refreshPendingBadge();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		void refreshPendingBadge();
		if (navigator.onLine) void runSync("background");
	});
	if (wasOffline) handleOffline();

	/* ── Badge API — show pending review count ────────────── */

	updateBadge(selectedDeck()).catch(() => {});
	void runSync("startup");
	void refreshPendingBadge();
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

	/* ── Auto-pronounce toggle ────────────────────────────── */

	const ttsToggle = document.getElementById("tts-toggle");
	if (ttsToggle instanceof HTMLButtonElement) {
		const syncToggle = (): void => {
			const enabled = isAutoSpeakEnabled();
			ttsToggle.textContent = enabled ? "🔊" : "🔇";
			ttsToggle.setAttribute("aria-pressed", String(enabled));
			ttsToggle.title = enabled ? "Auto-pronounce on flip: on" : "Auto-pronounce on flip: off";
		};
		syncToggle();
		ttsToggle.addEventListener("click", () => {
			const next = !isAutoSpeakEnabled();
			setAutoSpeakEnabled(next);
			syncToggle();
			haptic(8);
			showToast({
				message: next ? "Auto-pronounce on" : "Auto-pronounce off",
				duration: 1600,
			});
		});
	}

	/* ── Install prompt ───────────────────────────────────── */

	const installBtn = document.getElementById("install-btn");
	if (installBtn instanceof HTMLButtonElement) {
		initInstall(installBtn);
	}

	/* ── Logout ───────────────────────────────────────────── */

	const logoutBtn = document.getElementById("logout-btn");
	if (logoutBtn instanceof HTMLButtonElement) {
		logoutBtn.addEventListener("click", () => {
			clearApiKey();
			dismissToast(OFFLINE_TOAST_KEY);
			location.reload();
		});
	}

	/* ── Service worker messages ──────────────────────────── */

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.addEventListener("message", (event) => {
			const data = event.data as { type?: string; count?: number } | null;
			if (!data?.type) return;
			if (data.type === "trigger-sync") {
				void runSync("message");
			} else if (data.type === "trigger-badge-refresh") {
				// The SW cannot attach the auth header itself; refresh from the page.
				updateBadge(selectedDeck()).catch(() => {});
			} else if (data.type === "due-count" && typeof data.count === "number") {
				setBadge(data.count).catch(() => {});
			}
		});
	}

	/* ── Routing ──────────────────────────────────────────── */

	const announcer = document.getElementById("route-announcer");

	const announce = (text: string): void => {
		if (announcer) announcer.textContent = text;
	};

	const route = (): void => {
		const hash = window.location.hash.replace(/^#/, "") || "review";
		const title = ROUTE_TITLES[hash] ?? ROUTE_TITLES.review;

		// Highlight active tab and expose the state to assistive tech.
		const nav = document.getElementById("main-nav");
		if (nav) {
			for (const link of nav.querySelectorAll("a")) {
				const linkHash = link.getAttribute("href")?.replace(/^#/, "") || "";
				const active = linkHash === hash;
				link.classList.toggle("active", active);
				if (active) link.setAttribute("aria-current", "page");
				else link.removeAttribute("aria-current");
			}
		}

		// Tear down per-screen keyboard bindings before switching screens so stale
		// shortcuts can't submit ratings or steal "/" from other tabs.
		cleanupReview();
		cleanupSearch();
		// Dismiss an open search sheet so it can't outlive its screen.
		closeNoteSheet();
		document.title = `${title} · Anki Vocab`;
		announce(`${title} screen`);

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

		// After a route change, if the page is a review page, refresh the badge
		// and flush any reviews queued while offline.
		if (hash === "review" || !hash) {
			void runSync("route");
			updateBadge(selectedDeck()).catch(() => {});
		}
	};

	window.addEventListener("hashchange", route);
	route();
} // end bootApp

// Show setup screen if no API key is stored, otherwise boot the app.
if (!getApiKey()) {
	renderSetup(app);
} else {
	bootApp(app);
}

/* ── Service Worker Registration ──────────────────────── */

if ("serviceWorker" in navigator) {
	let updateWorker: ServiceWorker | null = null;
	let reloadOnControllerChange = false;

	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (!reloadOnControllerChange) return;
		reloadOnControllerChange = false;
		window.location.reload();
	});

	/** Offer an explicit reload instead of swapping bundles under the user. */
	const promptForUpdate = (worker: ServiceWorker | null): void => {
		if (!worker || !navigator.serviceWorker.controller) return;
		updateWorker = worker;
		showToast({
			key: "sw-update",
			tone: "info",
			duration: null,
			message: "A new version is ready.",
			action: {
				label: "Reload",
				onClick: () => {
					reloadOnControllerChange = true;
					updateWorker?.postMessage({ type: "SKIP_WAITING" });
				},
			},
		});
	};

	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("/sw.js")
			.then((registration) => {
				// A worker may already be waiting (installed while the app was closed).
				if (registration.waiting) promptForUpdate(registration.waiting);

				registration.addEventListener("updatefound", () => {
					const newWorker = registration.installing;
					if (!newWorker) return;
					newWorker.addEventListener("statechange", () => {
						if (newWorker.state === "installed") promptForUpdate(newWorker);
					});
				});

				const registerBackgroundWork = (): void => {
					registration.active?.postMessage({ type: "REGISTER_SYNC" });
					registration.active?.postMessage({ type: "REGISTER_PERIODIC_SYNC" });
				};
				if (registration.active) {
					registerBackgroundWork();
				} else {
					navigator.serviceWorker.ready.then(registerBackgroundWork).catch(() => {});
				}

				// Look for a new deploy when the app returns to the foreground.
				let lastUpdateCheck = Date.now();
				document.addEventListener("visibilitychange", () => {
					if (document.visibilityState !== "visible") return;
					if (Date.now() - lastUpdateCheck < 15 * 60_000) return;
					lastUpdateCheck = Date.now();
					registration.update().catch(() => {});
				});
			})
			.catch(() => {
				// Best-effort registration; ignore failures.
			});
	});
}
