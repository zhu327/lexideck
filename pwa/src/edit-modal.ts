import { type ReviewCardView, updateNote } from "./api";
import { errorMessage } from "./helpers";

export function openEditModal(
	card: ReviewCardView,
	onSaved: (newFields: Record<string, string>) => void,
): void {
	const overlay = document.createElement("div");
	overlay.className = "edit-modal";

	const content = document.createElement("div");
	content.className = "edit-modal-content";

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
		group.appendChild(textarea);
		textareas.set(name, textarea);

		content.appendChild(group);
	}

	const errorEl = document.createElement("div");
	errorEl.style.color = "#dc2626";
	errorEl.style.fontSize = "0.85rem";
	errorEl.style.marginTop = "0.5rem";
	content.appendChild(errorEl);

	const actions = document.createElement("div");
	actions.className = "edit-actions";

	const cancelBtn = document.createElement("button");
	cancelBtn.type = "button";
	cancelBtn.textContent = "Cancel";
	cancelBtn.addEventListener("click", () => overlay.remove());

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "primary";
	saveBtn.textContent = "Save";
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
			overlay.remove();
		} catch (err) {
			errorEl.textContent = errorMessage(err);
			saveBtn.disabled = false;
			cancelBtn.disabled = false;
		}
	});

	actions.appendChild(cancelBtn);
	actions.appendChild(saveBtn);
	content.appendChild(actions);
	overlay.appendChild(content);

	// Close on overlay click (outside modal content)
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) overlay.remove();
	});

	document.body.appendChild(overlay);
}
