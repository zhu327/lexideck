/* ───────────────────────────────────────────────────────
   Anki Vocab — Service Worker
   Linear dark-canvas PWA · offline-first architecture
   ─────────────────────────────────────────────────────── */

const CACHE_NAME = "anki-vocab-v4";
const RUNTIME_CACHE = "anki-vocab-runtime";
const SYNC_STORE = "anki-sync";
const SYNC_TAG_REVIEWS = "sync-reviews";
const PERIODIC_TAG_CHECK = "periodic-check";

/* ── App Shell (pre-cached on install) ────────────────── */

const APP_SHELL = [
	"/",
	"/index.html",
	"/manifest.webmanifest",
	"/offline.html",
	"/icon.svg",
	"/icon-192.png",
	"/icon-512.png",
];

/* ── Cached API paths (GET requests only) ─────────────── */

const CACHED_API_PATHS = [
	"/api/review/due",
	"/api/review/familiar",
	"/api/review/quiz",
	"/api/stats/summary",
	"/api/notes/search",
	"/api/decks",
	"/api/models",
];

/* ═══════════════════════════════════════════════════════
   Install — pre-cache app shell
   ═══════════════════════════════════════════════════════ */

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			try {
				await cache.addAll(APP_SHELL);
			} catch (err) {
				// Individual asset failures are non-fatal; cache what we can.
				console.warn("[sw] install: some assets not cached", err);
			}
			self.skipWaiting();
		})(),
	);
});

/* ═══════════════════════════════════════════════════════
   Activate — purge old caches, claim clients
   ═══════════════════════════════════════════════════════ */

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			const keep = [CACHE_NAME, RUNTIME_CACHE];
			await Promise.all(keys.filter((key) => !keep.includes(key)).map((key) => caches.delete(key)));
			await clients.claim();
		})(),
	);
});

/* ═══════════════════════════════════════════════════════
   Fetch — intelligent caching per request type
   ═══════════════════════════════════════════════════════ */

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);

	// Only handle same-origin requests
	if (url.origin !== self.location.origin) return;

	// API GET requests — network-first, cache fallback
	if (url.pathname.startsWith("/api/")) {
		if (shouldCacheApiPath(url.pathname)) {
			event.respondWith(networkFirstWithCache(request));
		} else {
			// Other API calls: network-only
			event.respondWith(fetch(request).catch(() => offlineResponse()));
		}
		return;
	}

	// Navigation — network-first, offline fallback
	if (request.mode === "navigate") {
		event.respondWith(navigationStrategy(request));
		return;
	}

	// Static assets — stale-while-revalidate
	event.respondWith(staleWhileRevalidate(request));
});

/* ── Strategies ───────────────────────────────────────── */

async function navigationStrategy(request) {
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		// Try cache
		const cached = await caches.match(request);
		if (cached) return cached;

		// Offline fallback page
		const offline = await caches.match("/offline.html");
		if (offline) return offline;

		return new Response("You're offline. Connect to the internet to continue.", {
			status: 503,
			statusText: "Service Unavailable",
			headers: { "Content-Type": "text/plain" },
		});
	}
}

async function staleWhileRevalidate(request) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);

	const fetchPromise = fetch(request)
		.then((response) => {
			if (response.ok) {
				cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => cached);

	return cached ?? fetchPromise;
}

async function networkFirstWithCache(request) {
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(RUNTIME_CACHE);
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cached = await caches.match(request);
		if (cached) {
			// Add header to indicate stale data
			const headers = new Headers(cached.headers);
			headers.set("X-Served-From", "cache");
			return new Response(cached.body, {
				status: cached.status,
				statusText: cached.statusText,
				headers,
			});
		}
		return offlineResponse();
	}
}

function shouldCacheApiPath(pathname) {
	return CACHED_API_PATHS.some((p) => pathname.startsWith(p));
}

function offlineResponse() {
	return new Response(JSON.stringify({ error: "offline", message: "You are currently offline." }), {
		status: 503,
		statusText: "Offline",
		headers: { "Content-Type": "application/json", "X-Served-From": "sw-offline" },
	});
}

/* ═══════════════════════════════════════════════════════
   Background Sync — review submissions
   ═══════════════════════════════════════════════════════ */

self.addEventListener("sync", (event) => {
	if (event.tag === SYNC_TAG_REVIEWS) {
		event.waitUntil(processReviewQueue());
	}
});

async function processReviewQueue() {
	const db = await openSyncDB();
	if (!db) return;

	const tx = db.transaction("reviews", "readonly");
	const store = tx.objectStore("reviews");
	const items = await promiseRequest(store.getAll());

	if (!items || items.length === 0) return;

	for (const item of items) {
		try {
			const res = await fetch("/api/review/submit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cardId: item.cardId, rating: item.rating }),
			});

			if (res.ok) {
				const delTx = db.transaction("reviews", "readwrite");
				const delStore = delTx.objectStore("reviews");
				await promiseRequest(delStore.delete(item.id));
			}
			// If failed, keep in queue; will retry on next sync
		} catch {
			// Network error — keep in queue
		}
	}

	db.close();
}

/* ═══════════════════════════════════════════════════════
   Periodic Sync — background badge update
   ═══════════════════════════════════════════════════════ */

self.addEventListener("periodicsync", (event) => {
	if (event.tag === PERIODIC_TAG_CHECK) {
		event.waitUntil(updateAppBadge());
	}
});

async function updateAppBadge() {
	try {
		const res = await fetch("/api/review/due?limit=0");
		if (res.ok) {
			const data = await res.json();
			const count = data?.total ?? 0;

			// Broadcast to all clients
			const allClients = await clients.matchAll({ type: "window" });
			for (const client of allClients) {
				client.postMessage({ type: "due-count", count });
			}
		}
	} catch {
		// Silently fail; will retry on next periodic sync
	}
}

/* ═══════════════════════════════════════════════════════
   Message Handlers
   ═══════════════════════════════════════════════════════ */

self.addEventListener("message", (event) => {
	const msg = event.data;
	if (!msg?.type) return;

	switch (msg.type) {
		case "SKIP_WAITING":
			self.skipWaiting();
			break;
		case "REGISTER_SYNC":
			if ("sync" in self.registration) {
				self.registration.sync.register(SYNC_TAG_REVIEWS).catch(() => {
					// Background sync not supported
				});
			}
			break;
		case "REGISTER_PERIODIC_SYNC":
			if ("periodicSync" in self.registration) {
				self.registration.periodicSync
					.register(PERIODIC_TAG_CHECK, { minInterval: 60 * 60 * 1000 }) // 1 hour min
					.catch(() => {
						// Periodic sync not supported/permitted
					});
			}
			break;
		case "UPDATE_BADGE":
			if (msg.count !== undefined) {
				updateAppBadge();
			}
			break;
	}
});

/* ── IndexedDB Helpers ────────────────────────────────── */

function openSyncDB() {
	return new Promise((resolve) => {
		const req = indexedDB.open(SYNC_STORE, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains("reviews")) {
				const store = db.createObjectStore("reviews", {
					keyPath: "id",
					autoIncrement: true,
				});
				store.createIndex("timestamp", "timestamp", { unique: false });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => resolve(null);
	});
}

function promiseRequest(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
