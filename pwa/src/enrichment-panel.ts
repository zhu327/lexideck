import { type Enrichment, enrichNote } from "./api";
import { displayEnrichment } from "./card-renderer";
import { errorMessage } from "./helpers";

/**
 * Wire up the enrich button click handler.
 * On click, calls the enrich API and displays the result.
 * Updates button text to "Refresh" after successful enrichment.
 * `onEnriched` is called with the fresh enrichment so callers can cache it.
 */
export function setupEnrichButton(
	enrichBtn: HTMLButtonElement,
	enrichResult: HTMLElement,
	noteId: string,
	onEnriched?: (enrichment: Enrichment) => void,
): void {
	enrichBtn.addEventListener("click", async () => {
		enrichBtn.disabled = true;
		enrichResult.textContent = "Loading…";
		try {
			const result = await enrichNote(noteId);
			if ("error" in result) {
				enrichResult.textContent = result.error;
			} else {
				displayEnrichment(enrichResult, result);
				enrichBtn.textContent = "Refresh";
				onEnriched?.(result);
			}
		} catch (err) {
			// Network-level failures must not leave the button stuck disabled.
			enrichResult.textContent = `Failed: ${errorMessage(err)}`;
		} finally {
			enrichBtn.disabled = false;
		}
	});
}
