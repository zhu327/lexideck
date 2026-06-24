import { noteExistsByGuid } from "../../db/repos/notes";
import type { ActionCtx, ActionResult } from "../router";
import { resolveNote } from "./addNote";

// canAddNotes: per-note boolean indicating whether the note can be added (i.e.
// is not a duplicate, or allowDuplicate is set). Defensive: an unresolvable
// deck/model yields false for that entry rather than throwing.
export async function canAddNotesAction(ctx: ActionCtx): Promise<ActionResult> {
	const notes = Array.isArray(ctx.params.notes) ? ctx.params.notes : [];
	const results: boolean[] = [];
	for (const raw of notes) {
		const note = (raw ?? {}) as Record<string, unknown>;
		const fields =
			note.fields && typeof note.fields === "object" ? (note.fields as Record<string, string>) : {};
		const resolved = await resolveNote(ctx.db, ctx.userId, {
			deckName: String(note.deckName ?? ""),
			modelName: String(note.modelName ?? ""),
			fields,
			guid: typeof note.guid === "string" ? note.guid : undefined,
		});
		if ("error" in resolved) {
			results.push(false);
			continue;
		}
		const allowDuplicate = Boolean(
			(note.options as { allowDuplicate?: boolean } | undefined)?.allowDuplicate,
		);
		const exists = await noteExistsByGuid(ctx.db, ctx.userId, resolved.guid);
		results.push(exists ? allowDuplicate : true);
	}
	return { result: results, error: null };
}
