/// <reference lib="dom" />

import { haptic } from "./haptics";
import { showToast } from "./ui";

/**
 * Install prompt handling.
 *
 * - Chromium: capture `beforeinstallprompt` and offer an in-app "Install"
 *   button (the native mini-infobar is suppressed by preventDefault).
 * - iOS Safari: no prompt API exists, so the button explains the Share →
 *   "Add to Home Screen" flow instead.
 * - Once installed (or dismissed) the button disappears so the header stays
 *   uncluttered.
 */

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "install-prompt-dismissed-at";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let dismissedAt = 0;
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
}

function readDismissedAt(): number {
	try {
		const raw = localStorage.getItem(DISMISSED_KEY);
		return raw ? Number.parseInt(raw, 10) || 0 : 0;
	} catch {
		return 0;
	}
}

function markDismissed(): void {
	dismissedAt = Date.now();
	try {
		localStorage.setItem(DISMISSED_KEY, String(dismissedAt));
	} catch {
		// Storage unavailable — keep the in-memory value.
	}
}

function recentlyDismissed(now = Date.now()): boolean {
	const at = dismissedAt || readDismissedAt();
	return at > 0 && now - at < DISMISS_TTL_MS;
}

/** True when running as an installed app (standalone window or iOS web app). */
export function isStandaloneDisplay(): boolean {
	if (typeof window === "undefined") return false;
	const mql = window.matchMedia?.("(display-mode: standalone)");
	const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
	return Boolean(mql?.matches || iosStandalone);
}

export function isIosDevice(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isIosSafari(): boolean {
	if (!isIosDevice()) return false;
	const ua = navigator.userAgent;
	// Chrome/Firefox/Edge/Opera on iOS all include "Safari" in their UA.
	return /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(ua);
}

function canOfferInstall(): boolean {
	if (isStandaloneDisplay()) return false;
	if (recentlyDismissed()) return false;
	return deferredPrompt !== null || isIosSafari();
}

async function promptInstall(): Promise<void> {
	const prompt = deferredPrompt;
	if (prompt) {
		haptic(8);
		try {
			await prompt.prompt();
			const choice = await prompt.userChoice;
			deferredPrompt = null;
			if (choice?.outcome === "accepted") {
				showToast({ message: "Installing…", tone: "success" });
			} else {
				markDismissed();
			}
		} catch {
			markDismissed();
		}
		notify();
		return;
	}

	showToast({
		key: "install-help",
		duration: 8000,
		tone: "info",
		message: 'Install: tap the Share icon, then "Add to Home Screen".',
	});
}

if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (event) => {
		// Suppress Chromium's mini-infobar so the in-app button is the entry point.
		event.preventDefault();
		deferredPrompt = event as BeforeInstallPromptEvent;
		notify();
	});
	window.addEventListener("appinstalled", () => {
		deferredPrompt = null;
		try {
			localStorage.removeItem(DISMISSED_KEY);
		} catch {
			// Ignore.
		}
		notify();
		showToast({ message: "Installed — launch it from your home screen.", tone: "success" });
	});
}

/**
 * Wire an install button. Safe to call on every boot; it returns a cleanup
 * function that detaches the listener.
 */
export function initInstall(button: HTMLButtonElement): () => void {
	const sync = (): void => {
		button.hidden = !canOfferInstall();
	};
	const onClick = (): void => {
		void promptInstall();
	};
	listeners.add(sync);
	button.addEventListener("click", onClick);
	sync();
	return () => {
		listeners.delete(sync);
		button.removeEventListener("click", onClick);
	};
}
