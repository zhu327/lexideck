import { getModel } from "../../db/repos/models";
import type { ActionCtx, ActionResult } from "../router";

export async function modelStylingAction(ctx: ActionCtx): Promise<ActionResult> {
	const modelName = String(ctx.params.modelName ?? "");
	const model = await getModel(ctx.db, ctx.userId, modelName);
	if (!model) {
		return { result: null, error: `model not found: ${modelName}` };
	}
	return { result: { css: model.css }, error: null };
}
