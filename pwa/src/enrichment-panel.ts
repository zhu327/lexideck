import { enrichNote } from "./api";
import { displayEnrichment } from "./card-renderer";

/**
 * Wire up the enrich button click handler.
 * On click, calls the enrich API and displays the result.
 * Updates button text to "Refresh" after successful enrichment.
 */
export function setupEnrichButton(
	enrichBtn: HTMLButtonElement,
	enrichResult: HTMLElement,
	noteId: string,
): void {
	enrichBtn.addEventListener("click", async () => {
		enrichBtn.disabled = true;
		enrichResult.textContent = "Loading…";
		const result = await enrichNote(noteId);
		if ("error" in result) {
			enrichResult.textContent = result.error;
		} else {
			displayEnrichment(enrichResult, result);
			enrichBtn.textContent = "Refresh";
		}
		enrichBtn.disabled = false;
	});
}
