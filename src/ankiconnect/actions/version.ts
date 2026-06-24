import type { ActionResult } from "../router";

export async function versionAction(): Promise<ActionResult> {
	return { result: 6, error: null };
}
