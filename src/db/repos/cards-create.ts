import { initNewCard } from "../../srs/scheduler";
import type { CardRow } from "../../srs/types";
import type { DbClient } from "../client";
import { generateAnkiId } from "./anki-id";
import type { NoteRow } from "./notes";

// Create one New(0) card per template (ordered by template key index) for the
// given note, using FSRS initial scheduling state. Returns the created card ids.
export async function createCardsForNote(
	db: DbClient,
	userId: string,
	note: NoteRow,
	templates: Record<string, { Front: string; Back: string }>,
): Promise<string[]> {
	const ids: string[] = [];
	const keys = Object.keys(templates);
	for (let ord = 0; ord < keys.length; ord++) {
		const card: CardRow = initNewCard(new Date());
		card.id = crypto.randomUUID();
		card.noteId = note.id;
		card.user_id = userId;
		card.deck_id = note.deckId;
		card.template_ord = ord;
		card.ankiId = await generateAnkiId(db, userId, "cards");
		await db.exec(
			"INSERT INTO cards (id, user_id, note_id, deck_id, template_ord, due, stability, difficulty, " +
				"elapsed_days, scheduled_days, reps, lapses, state, last_review, anki_id, created_at) " +
				"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			card.id,
			userId,
			note.id,
			note.deckId,
			card.template_ord,
			card.due,
			card.stability,
			card.difficulty,
			card.elapsed_days,
			card.scheduled_days,
			card.reps,
			card.lapses,
			card.state,
			card.last_review,
			card.ankiId,
			card.created_at,
		);
		ids.push(card.id);
	}
	return ids;
}
