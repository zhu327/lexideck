import type { DbClient } from "../../db/client";
import { createCardsForNote } from "../../db/repos/cards-create";
import { getModel, type ModelRow } from "../../db/repos/models";
import { createNote, noteExistsByGuid } from "../../db/repos/notes";
import type { ActionCtx, ActionResult } from "../router";

interface NoteInput {
	deckName: string;
	modelName: string;
	fields: Record<string, string>;
	guid?: string;
}

export interface ResolvedNote {
	deckId: string;
	modelId: string;
	guid: string;
	model: ModelRow;
}

// Resolve the deck + model for an Anki note and compute its deterministic guid.
// Returns an error string when the deck or model cannot be found.
export async function resolveNote(
	db: DbClient,
	userId: string,
	note: NoteInput,
): Promise<ResolvedNote | { error: string }> {
	const deck = await db.queryFirst<{ id: string }>(
		"SELECT id FROM decks WHERE user_id = ? AND name = ?",
		userId,
		note.deckName,
	);
	if (!deck) {
		return { error: `deck not found: ${note.deckName}` };
	}
	const model = await getModel(db, userId, note.modelName);
	if (!model) {
		return { error: `model not found: ${note.modelName}` };
	}
	const firstField = note.fields[model.fieldNames[0] ?? ""] ?? "";
	const guid = note.guid ?? `${userId}:${deck.id}:${model.id}:${firstField}`;
	return { deckId: deck.id, modelId: model.id, guid, model };
}

function coerceFields(raw: unknown): Record<string, string> {
	return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
}

function coerceTags(raw: unknown): string[] {
	return Array.isArray(raw) ? raw.map((tag) => String(tag)) : [];
}

// addNote: create a note + card(s) in FSRS New state. Accepts (and ignores)
// audio/video/picture arrays — media is deferred. Rejects duplicates unless
// options.allowDuplicate is true.
export async function addNoteAction(ctx: ActionCtx): Promise<ActionResult> {
	const note = (ctx.params.note ?? {}) as Record<string, unknown>;
	const options = (ctx.params.options ?? {}) as { allowDuplicate?: boolean };
	const input: NoteInput = {
		deckName: String(note.deckName ?? ""),
		modelName: String(note.modelName ?? ""),
		fields: coerceFields(note.fields),
		guid: typeof note.guid === "string" ? note.guid : undefined,
	};

	const resolved = await resolveNote(ctx.db, ctx.userId, input);
	if ("error" in resolved) {
		return { result: null, error: resolved.error };
	}

	if (!options.allowDuplicate && (await noteExistsByGuid(ctx.db, ctx.userId, resolved.guid))) {
		return { result: null, error: "duplicate" };
	}

	const created = await createNote(ctx.db, ctx.userId, {
		deckId: resolved.deckId,
		modelId: resolved.modelId,
		fields: input.fields,
		tags: coerceTags(note.tags),
		guid: resolved.guid,
	});
	await createCardsForNote(ctx.db, ctx.userId, created, resolved.model.templates);
	return { result: created.id, error: null };
}
