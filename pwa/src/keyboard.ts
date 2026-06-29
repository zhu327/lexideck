export type KeyBinding = { key: string; handler: () => void };

/**
 * Register keyboard shortcuts. Returns a cleanup function that removes all
 * listeners. Events from <input>, <textarea>, and contenteditable targets
 * are ignored so shortcuts don't interfere with text entry.
 */
type DocLike = {
	addEventListener(type: string, listener: (e: unknown) => void): void;
	removeEventListener(type: string, listener: (e: unknown) => void): void;
};

export function registerShortcuts(bindings: KeyBinding[]): () => void {
	const doc = (globalThis as unknown as { document: DocLike }).document;

	function onKeydown(event: unknown) {
		const ev = event as { key?: string; target?: unknown; preventDefault(): void };
		const target = ev.target as { tagName?: string; isContentEditable?: boolean } | null;
		if (target) {
			const tag = target.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
				return;
			}
		}
		for (const binding of bindings) {
			if (ev.key === binding.key) {
				ev.preventDefault();
				binding.handler();
				return;
			}
		}
	}

	doc.addEventListener("keydown", onKeydown);
	return () => {
		doc.removeEventListener("keydown", onKeydown);
	};
}
