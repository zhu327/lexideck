/// <reference lib="dom" />

/**
 * Lightweight toast/snackbar layer for the PWA.
 *
 * Replaces ad-hoc inline banners (offline indicator, sync errors, update
 * hints) with one consistent, screen-reader announced surface that sits above
 * the tab bar and never covers the review card's sticky rating row.
 */

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastAction {
	label: string;
	onClick: () => void;
}

export interface ToastOptions {
	message: string;
	tone?: ToastTone;
	/** Stable key: showing another toast with the same key replaces it. */
	key?: string;
	/** Auto-dismiss delay in ms. `null` keeps the toast until dismissed. */
	duration?: number | null;
	action?: ToastAction;
}

export interface ToastHandle {
	dismiss(): void;
}

const DEFAULT_DURATION = 3200;
const MAX_VISIBLE = 3;

interface ToastEntry {
	el: HTMLElement;
	timer: ReturnType<typeof setTimeout> | null;
}

const toasts = new Map<string, ToastEntry>();
let regionEl: HTMLElement | null = null;
let autoKey = 0;

function toastRegion(): HTMLElement | null {
	if (typeof document === "undefined" || !document.body) return null;
	if (regionEl?.isConnected) return regionEl;
	let el = document.getElementById("toast-region");
	if (!el) {
		el = document.createElement("div");
		el.id = "toast-region";
		el.className = "toast-region";
		el.setAttribute("aria-live", "polite");
		document.body.appendChild(el);
	}
	regionEl = el;
	return el;
}

/** Remove a toast by key. No-op when the key is unknown. */
export function dismissToast(key: string): void {
	const entry = toasts.get(key);
	if (!entry) return;
	if (entry.timer !== null) clearTimeout(entry.timer);
	entry.el.remove();
	toasts.delete(key);
}

/**
 * Show a toast. Returns a handle so callers can dismiss it early.
 */
export function showToast(options: ToastOptions): ToastHandle {
	const key = options.key ?? `toast-auto-${++autoKey}`;
	const dismiss = (): void => dismissToast(key);

	const host = toastRegion();
	if (!host) return { dismiss };

	// Replace an existing toast with the same key instead of stacking dupes.
	dismissToast(key);
	while (toasts.size >= MAX_VISIBLE) {
		const oldest = toasts.keys().next().value;
		if (oldest === undefined) break;
		dismissToast(oldest);
	}

	const tone = options.tone ?? "info";
	const el = document.createElement("div");
	el.className = `toast toast-${tone}`;
	el.dataset.toastKey = key;
	el.setAttribute("role", tone === "error" ? "alert" : "status");

	const message = document.createElement("span");
	message.className = "toast-message";
	message.textContent = options.message;
	el.appendChild(message);

	const action = options.action;
	if (action) {
		const actionBtn = document.createElement("button");
		actionBtn.type = "button";
		actionBtn.className = "toast-action";
		actionBtn.textContent = action.label;
		actionBtn.addEventListener("click", () => {
			dismiss();
			action.onClick();
		});
		el.appendChild(actionBtn);
	}

	const duration = options.duration === undefined ? DEFAULT_DURATION : options.duration;
	if (duration === null) {
		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.className = "toast-close";
		closeBtn.setAttribute("aria-label", "Dismiss notification");
		closeBtn.textContent = "×";
		closeBtn.addEventListener("click", dismiss);
		el.appendChild(closeBtn);
	}

	host.appendChild(el);

	const entry: ToastEntry = { el, timer: null };
	toasts.set(key, entry);
	if (duration !== null) {
		entry.timer = setTimeout(dismiss, duration);
	}
	return { dismiss };
}
