import { findNotesByQuery } from "../../db/repos/notes";
import type { ActionCtx, ActionResult } from "../router";

// findNotes: minimal query parser (deck:X or Field:val tokens, AND-combined).
// Returns matching note ids; malformed/unknown queries return [] without error.
export async function findNotesAction(ctx: ActionCtx): Promise<ActionResult> {
	const query = typeof ctx.params.query === "string" ? ctx.params.query : "";
	const result = await findNotesByQuery(ctx.db, ctx.userId, query);
	return { result, error: null };
}
