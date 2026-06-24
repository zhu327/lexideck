import { listModelNames } from "../../db/repos/models";
import type { ActionCtx, ActionResult } from "../router";

export async function modelNamesAction(ctx: ActionCtx): Promise<ActionResult> {
	const result = await listModelNames(ctx.db, ctx.userId);
	return { result, error: null };
}
