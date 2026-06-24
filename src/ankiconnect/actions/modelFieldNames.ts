import { getModel } from "../../db/repos/models";
import type { ActionCtx, ActionResult } from "../router";

export async function modelFieldNamesAction(ctx: ActionCtx): Promise<ActionResult> {
	const modelName = String(ctx.params.modelName ?? "");
	const model = await getModel(ctx.db, ctx.userId, modelName);
	if (!model) {
		return { result: null, error: `model not found: ${modelName}` };
	}
	return { result: model.fieldNames, error: null };
}
