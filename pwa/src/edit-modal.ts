import { type ReviewCardView, updateNote } from "./api";
import { errorMessage } from "./helpers";

/**
 * Card field editor. Behaves like a proper dialog: traps focus, closes on
 * Escape / backdrop click, and returns focus to the button that opened it.
 */
export function openEditModal(
	card: ReviewCardView,
	onSaved: (newFields: Record<string, string>) => void,
): void {
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

	const overlay = document.createElement("div");
	overlay.className = "edit-modal";

	const content = document.createElement("div");
	content.className = "edit-modal-content";
	content.setAttribute("role", "dialog");
	content.setAttribute("aria-modal", "true");
	content.setAttribute("aria-label", "Edit card");

	const title = document.createElement("h3");
	title.textContent = "Edit Card";
	title.style.margin = "0 0 1rem";
	content.appendChild(title);

	const fieldNames = Object.keys(card.fields);
	const textareas: Map<string, HTMLTextAreaElement> = new Map();

	for (const name of fieldNames) {
		const group = document.createElement("div");
		group.className = "edit-field-group";

		const label = document.createElement("div");
		label.className = "edit-field-label";
		label.textContent = name;
		group.appendChild(label);

		const textarea = document.createElement("textarea");
		textarea.value = card.fields[name] ?? "";
		textarea.setAttribute("aria-label", name);
		group.appendChild(textarea);
		textareas.set(name, textarea);

		content.appendChild(group);
	}

	const errorEl = document.createElement("div");
	errorEl.className = "edit-modal-error";
	errorEl.setAttribute("role", "alert");
	content.appendChild(errorEl);

	const actions = document.createElement("div");
	actions.className = "edit-actions";

	const cancelBtn = document.createElement("button");
	cancelBtn.type = "button";
	cancelBtn.textContent = "Cancel";

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "primary";
	saveBtn.textContent = "Save";

	actions.appendChild(cancelBtn);
	actions.appendChild(saveBtn);
	content.appendChild(actions);
	overlay.appendChild(content);

	const close = (): void => {
		document.removeEventListener("keydown", onKeyDown, true);
		overlay.remove();
		if (opener?.isConnected) opener.focus({ preventScroll: true });
	};

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			return;
		}
		if (event.key !== "Tab") return;
		const focusables = [
			...content.querySelectorAll<HTMLElement>("textarea, button:not([disabled])"),
		];
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	cancelBtn.addEventListener("click", close);
	document.addEventListener("keydown", onKeyDown, true);

	saveBtn.addEventListener("click", async () => {
		const newFields: Record<string, string> = {};
		for (const [name, ta] of textareas) {
			newFields[name] = ta.value;
		}
		saveBtn.disabled = true;
		cancelBtn.disabled = true;
		errorEl.textContent = "";
		try {
			await updateNote(card.noteId, newFields);
			onSaved(newFields);
			close();
		} catch (err) {
			errorEl.textContent = errorMessage(err);
			saveBtn.disabled = false;
			cancelBtn.disabled = false;
			saveBtn.focus();
		}
	});

	// Close on overlay click (outside modal content)
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) close();
	});

	document.body.appendChild(overlay);
	const firstTextarea = textareas.values().next().value;
	if (firstTextarea) firstTextarea.focus();
}
