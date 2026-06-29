import { noteExistsByGuid } from "../../db/repos/notes";
import type { ActionCtx, ActionResult } from "../router";
import { coerceFields, resolveNote } from "./addNote";

/** Check whether each note in the input can be added (resolves deck/model, checks duplicates). */
export async function checkNoteAddable(
	ctx: ActionCtx,
): Promise<Array<{ canAdd: boolean; error: string | null }>> {
	const notes = Array.isArray(ctx.params.notes) ? ctx.params.notes : [];
	const results: Array<{ canAdd: boolean; error: string | null }> = [];

	for (const raw of notes) {
		const note = (raw ?? {}) as Record<string, unknown>;
		const resolved = await resolveNote(ctx.db, ctx.userId, {
			deckName: String(note.deckName ?? ""),
			modelName: String(note.modelName ?? ""),
			fields: coerceFields(note.fields),
			guid: typeof note.guid === "string" ? note.guid : undefined,
		});

		if ("error" in resolved) {
			results.push({ canAdd: false, error: resolved.error });
			continue;
		}

		const exists = await noteExistsByGuid(ctx.db, ctx.userId, resolved.guid);
		if (exists) {
			results.push({ canAdd: false, error: "duplicate" });
			continue;
		}

		results.push({ canAdd: true, error: null });
	}

	return results;
}

// canAddNotesWithErrorDetail: per-note result with canAdd boolean and error
// detail. Returns "cannot create note because it is a duplicate" for duplicates,
// and "deck not found: X" / "model not found: X" for unresolvable deck/model.
export async function canAddNotesWithErrorDetailAction(ctx: ActionCtx): Promise<ActionResult> {
	const results = await checkNoteAddable(ctx);
	// Map internal "duplicate" error to the AnkiConnect-standard message
	const mapped = results.map((r) =>
		r.error === "duplicate"
			? { canAdd: false, error: "cannot create note because it is a duplicate" }
			: r,
	);
	return { result: mapped, error: null };
}
