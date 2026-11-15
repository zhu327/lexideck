/// <reference lib="dom" />

/**
 * Best-effort tactile feedback. Silently no-ops on platforms without the
 * Vibration API (iOS Safari) or when the user rejected it.
 */
export function haptic(pattern: number | number[] = 8): void {
	if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
	try {
		navigator.vibrate(pattern);
	} catch {
		// Ignore — vibration is decorative.
	}
}
