import type { ActionCtx, ActionResult } from "../router";
import { checkNoteAddable } from "./canAddNotesWithErrorDetail";

// canAddNotes: per-note boolean indicating whether the note can be added (i.e.
// is not a duplicate, or allowDuplicate is set). Defensive: an unresolvable
// deck/model yields false for that entry rather than throwing.
export async function canAddNotesAction(ctx: ActionCtx): Promise<ActionResult> {
	const results = await checkNoteAddable(ctx);
	const notes = Array.isArray(ctx.params.notes) ? ctx.params.notes : [];
	const booleans = results.map((r, i) => {
		if (r.canAdd) return true;
		if (r.error !== "duplicate") return false;
		// duplicate — respect allowDuplicate option
		const raw = (notes[i] ?? {}) as Record<string, unknown>;
		return Boolean((raw.options as { allowDuplicate?: boolean } | undefined)?.allowDuplicate);
	});
	return { result: booleans, error: null };
}
