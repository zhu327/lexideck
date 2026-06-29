import { addNote, fetchDeckNames, fetchModelFields, fetchModelNames } from "./api";
import { errorMessage } from "./helpers";

export async function renderAdd(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<p class="hint">Add a new vocabulary card.</p>
		<form id="add-form" class="add-form">
			<label>
				Deck
				<select id="add-deck" name="deck"><option value="">Loading…</option></select>
			</label>
			<label>
				Model
				<select id="add-model" name="model"><option value="">Loading…</option></select>
			</label>
			<div id="add-fields"></div>
			<label>
				Tags
				<input id="add-tags" type="text" placeholder="comma-separated" />
			</label>
			<button id="add-submit" class="primary" type="submit">Add Note</button>
			<div id="add-msg" class="hint"></div>
		</form>
	`;

	const deckSelect = root.querySelector<HTMLSelectElement>("#add-deck");
	const modelSelect = root.querySelector<HTMLSelectElement>("#add-model");
	const fieldsDiv = root.querySelector<HTMLDivElement>("#add-fields");
	const tagsInput = root.querySelector<HTMLInputElement>("#add-tags");
	const msgDiv = root.querySelector<HTMLDivElement>("#add-msg");
	const form = root.querySelector<HTMLFormElement>("#add-form");

	if (!deckSelect || !modelSelect || !fieldsDiv || !tagsInput || !msgDiv || !form) return;

	// Load decks and models in parallel
	try {
		const [decks, models] = await Promise.all([fetchDeckNames(), fetchModelNames()]);
		deckSelect.innerHTML = "";
		for (const d of decks) {
			const opt = document.createElement("option");
			opt.value = d;
			opt.textContent = d;
			deckSelect.appendChild(opt);
		}
		modelSelect.innerHTML = "";
		for (const m of models) {
			const opt = document.createElement("option");
			opt.value = m;
			opt.textContent = m;
			modelSelect.appendChild(opt);
		}
	} catch (err) {
		msgDiv.textContent = `Failed to load options: ${errorMessage(err)}`;
		return;
	}

	// Build field inputs for the selected model
	async function rebuildFields(): Promise<void> {
		const modelName = modelSelect.value;
		if (!modelName) {
			fieldsDiv.innerHTML = "";
			return;
		}
		try {
			const fieldNames = await fetchModelFields(modelName);
			fieldsDiv.innerHTML = "";
			for (const name of fieldNames) {
				const label = document.createElement("label");
				label.textContent = name;
				if (name === "Back" || name === "Definition") {
					const textarea = document.createElement("textarea");
					textarea.name = `field:${name}`;
					textarea.rows = 3;
					label.appendChild(textarea);
				} else {
					const input = document.createElement("input");
					input.type = "text";
					input.name = `field:${name}`;
					label.appendChild(input);
				}
				fieldsDiv.appendChild(label);
			}
		} catch (err) {
			fieldsDiv.textContent = `Failed to load fields: ${errorMessage(err)}`;
		}
	}

	modelSelect.addEventListener("change", rebuildFields);
	await rebuildFields();

	// Submit handler
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		msgDiv.textContent = "";

		const fields: Record<string, string> = {};
		for (const el of fieldsDiv.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
			"input, textarea",
		)) {
			const key = el.name.replace(/^field:/, "");
			fields[key] = el.value;
		}

		const tags = tagsInput.value
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		try {
			const result = await addNote({
				deckName: deckSelect.value,
				modelName: modelSelect.value,
				fields,
				tags: tags.length > 0 ? tags : undefined,
			});
			msgDiv.textContent = `Added! (id: ${result.ankiId})`;
			// Clear field inputs
			for (const el of fieldsDiv.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
				"input, textarea",
			)) {
				el.value = "";
			}
			tagsInput.value = "";
		} catch (err) {
			const msg = errorMessage(err);
			msgDiv.textContent =
				msg === "duplicate" ? "Duplicate note — already exists." : `Error: ${msg}`;
		}
	});
}
