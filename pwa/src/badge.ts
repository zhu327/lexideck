import { fetchDue } from "./api";

/**
 * Badge + due-count state, shared between main.ts (badge refresh on route /
 * online events) and review.ts (updates the cache after loading/reviewing).
 * A short TTL cache plus in-flight request coalescing avoids the duplicate
 * `GET /api/review/due` calls that used to fire on every #review navigation.
 */

const CACHE_TTL_MS = 15_000;

interface BadgeNavigator extends Navigator {
	setAppBadge(count?: number): Promise<void>;
	clearAppBadge(): Promise<void>;
}

let cachedTotal: number | null = null;
let cachedAt = 0;
let inflight: Promise<number> | null = null;

function badgeNavigator(): BadgeNavigator | null {
	if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return null;
	return navigator as BadgeNavigator;
}

/** Set (or clear) the app icon badge. Best-effort; never throws. */
export async function setBadge(count: number): Promise<void> {
	const nav = badgeNavigator();
	if (!nav) return;
	try {
		if (count > 0) {
			await nav.setAppBadge(count);
		} else {
			await nav.clearAppBadge();
		}
	} catch {
		// Badge API rejected (unsupported platform, permission, etc.) — ignore.
	}
}

/** Record a known due-total (e.g. from a review session load). */
export function setCachedDueTotal(total: number): void {
	cachedTotal = total;
	cachedAt = Date.now();
}

/** Nudge the cached total (e.g. -1 after a successful review submit). */
export function adjustCachedDueTotal(delta: number): void {
	if (cachedTotal !== null) {
		cachedTotal = Math.max(0, cachedTotal + delta);
	}
}

/** Drop the cached total (e.g. after switching decks). */
export function invalidateDueTotalCache(): void {
	cachedTotal = null;
	cachedAt = 0;
}

async function loadDueTotal(deck: string | null): Promise<number> {
	if (cachedTotal !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
		return cachedTotal;
	}
	if (!inflight) {
		inflight = fetchDue(deck, 1)
			.then(({ total }) => {
				cachedTotal = total;
				cachedAt = Date.now();
				return total;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

/** Refresh the app badge with the current due count. Best-effort; never throws. */
export async function updateBadge(deck: string | null): Promise<void> {
	try {
		await setBadge(await loadDueTotal(deck));
	} catch {
		// Fetch failed (offline, auth, ...) — keep the previous badge.
	}
}
