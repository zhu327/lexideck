import { getNoteByAnkiId } from "../../db/repos/notes";
import type { ActionCtx, ActionResult } from "../router";

// findCards: returns card anki_ids matching a query. Supports:
//   nid:<ankiNoteId>  — cards belonging to the note with that anki_id
//   deck:<deckName>   — cards in the named deck
// Tokens are AND-combined. Unknown decks/notes yield empty result.
export async function findCardsAction(ctx: ActionCtx): Promise<ActionResult> {
	const query = typeof ctx.params.query === "string" ? ctx.params.query : "";
	const tokens = query.trim().split(/\s+/).filter(Boolean);

	if (tokens.length === 0) {
		return { result: [], error: null };
	}

	const conditions: string[] = ["user_id = ?"];
	const params: (string | number)[] = [ctx.userId];

	for (const rawToken of tokens) {
		// Strip surrounding double-quotes (Yomitan format)
		const token = rawToken.replace(/^"(.*)"$/, "$1");

		const match = token.match(/^([^:]+):(.*)$/);
		if (!match) {
			return { result: [], error: null };
		}
		const key = match[1];
		const val = match[2];

		if (key === "nid") {
			const ankiId = Number(val);
			if (Number.isNaN(ankiId)) {
				return { result: [], error: null };
			}
			const note = await getNoteByAnkiId(ctx.db, ctx.userId, ankiId);
			if (!note) {
				return { result: [], error: null };
			}
			conditions.push("note_id = ?");
			params.push(note.id);
		} else if (key === "deck") {
			const deck = await ctx.db.queryFirst<{ id: string }>(
				"SELECT id FROM decks WHERE user_id = ? AND name = ?",
				ctx.userId,
				val,
			);
			if (!deck) {
				return { result: [], error: null };
			}
			conditions.push("deck_id = ?");
			params.push(deck.id);
		} else {
			return { result: [], error: null };
		}
	}

	const sql = `SELECT anki_id FROM cards WHERE ${conditions.join(" AND ")}`;
	const rows = await ctx.db.query<{ anki_id: number }>(sql, ...params);
	return { result: rows.map((row) => row.anki_id), error: null };
}
