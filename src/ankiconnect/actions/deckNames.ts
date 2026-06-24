import { listDeckNames } from "../../db/repos/decks";
import type { ActionCtx, ActionResult } from "../router";

export async function deckNamesAction(ctx: ActionCtx): Promise<ActionResult> {
	const result = await listDeckNames(ctx.db, ctx.userId);
	return { result, error: null };
}
