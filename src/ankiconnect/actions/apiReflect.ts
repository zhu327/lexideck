import type { ActionCtx, ActionResult } from "../router";

// apiReflect: returns the list of supported actions and scopes so that AnkiConnect
// clients can discover capabilities.
export async function apiReflectAction(_ctx: ActionCtx): Promise<ActionResult> {
	return {
		result: {
			scopes: ["actions"],
			actions: [
				"version",
				"deckNames",
				"modelNames",
				"modelFieldNames",
				"modelTemplates",
				"modelStyling",
				"addNote",
				"canAddNotes",
				"canAddNotesWithErrorDetail",
				"findNotes",
				"notesInfo",
				"findCards",
				"guiBrowse",
			],
		},
		error: null,
	};
}
