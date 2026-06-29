import type { ActionCtx, ActionResult } from "../router";
import { findCardsAction } from "./findCards";

// guiBrowse: headless — returns the same result as findCards (no GUI window).
// Supports nid: and deck: tokens.
export async function guiBrowseAction(ctx: ActionCtx): Promise<ActionResult> {
	return findCardsAction(ctx);
}
