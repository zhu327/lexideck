import { parseJsonColumn } from "../../db/repos/json";
import { getNoteByAnkiId } from "../../db/repos/notes";
import type { ActionCtx, ActionResult } from "../router";

// notesInfo: given a list of anki note ids, returns an array of note info
// objects with fields, tags, model name, and card anki ids. Nonexistent ids
// produce null entries.
export async function notesInfoAction(ctx: ActionCtx): Promise<ActionResult> {
	const rawIds = Array.isArray(ctx.params.notes) ? ctx.params.notes : [];
	const noteIds = rawIds.map((id: unknown) => Number(id)).filter((id: number) => !Number.isNaN(id));

	const results: unknown[] = [];

	for (const ankiId of noteIds) {
		const note = await getNoteByAnkiId(ctx.db, ctx.userId, ankiId);
		if (!note) {
			results.push(null);
			continue;
		}

		// Look up model by id
		const modelRow = await ctx.db.queryFirst<{
			id: string;
			name: string;
			field_names: string;
			templates: string;
			css: string;
		}>(
			"SELECT id, name, field_names, templates, css FROM models WHERE user_id = ? AND id = ?",
			ctx.userId,
			note.modelId,
		);

		if (!modelRow) {
			results.push(null);
			continue;
		}

		const fieldNames = parseJsonColumn<string[]>(modelRow.field_names, []);

		// Get card anki_ids for this note
		const cards = await ctx.db.query<{ anki_id: number }>(
			"SELECT anki_id FROM cards WHERE user_id = ? AND note_id = ?",
			ctx.userId,
			note.id,
		);

		// Build fields object with value and order
		const fields: Record<string, { value: string; order: number }> = {};
		for (let i = 0; i < fieldNames.length; i++) {
			const fieldName = fieldNames[i];
			fields[fieldName] = {
				value: note.fields[fieldName] ?? "",
				order: i,
			};
		}

		results.push({
			noteId: note.ankiId,
			modelName: modelRow.name,
			tags: note.tags,
			fields,
			cards: cards.map((c) => c.anki_id),
		});
	}

	return { result: results, error: null };
}
