const CACHE = "anki-vocab-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(APP_SHELL);
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// API calls always go to network for fresh data; do not cache.
	if (url.pathname.startsWith("/api/")) {
		event.respondWith(fetch(request).catch(() => Response.error()));
		return;
	}

	// Cache-first for navigation & static assets, with network fallback.
	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(request);
			if (cached) return cached;
			try {
				const response = await fetch(request);
				if (response.ok) await cache.put(request, response.clone());
				return response;
			} catch {
				const fallback = await cache.match("/");
				return fallback ?? Response.error();
			}
		})(),
	);
});
