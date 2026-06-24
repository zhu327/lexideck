import type { CardRow } from "../../srs/types";
import type { DbClient, SqlBinding } from "../client";

export interface ReviewCardView {
	cardId: string;
	noteId: string;
	deckName: string;
	modelName: string;
	fields: Record<string, string>;
	tags: string[];
	state: number;
	due: number;
}

function toFields(raw: unknown): Record<string, string> {
	try {
		const v = JSON.parse(String(raw));
		return v && typeof v === "object" ? (v as Record<string, string>) : {};
	} catch {
		return {};
	}
}

function toTags(raw: unknown): string[] {
	try {
		const v = JSON.parse(String(raw));
		return Array.isArray(v) ? (v as string[]) : [];
	} catch {
		return [];
	}
}

function mapRow(row: Record<string, unknown>): ReviewCardView {
	return {
		cardId: String(row.card_id),
		noteId: String(row.note_id),
		deckName: String(row.deck_name),
		modelName: String(row.model_name),
		fields: toFields(row.fields),
		tags: toTags(row.tags),
		state: Number(row.state),
		due: Number(row.due),
	};
}

const SELECT_COLUMNS =
	"SELECT c.id AS card_id, c.note_id, c.state, c.due, d.name AS deck_name, " +
	"m.name AS model_name, n.fields, n.tags " +
	"FROM cards c " +
	"JOIN notes n ON n.id = c.note_id " +
	"JOIN decks d ON d.id = c.deck_id " +
	"JOIN models m ON m.id = n.model_id ";

export async function listDueCards(
	db: DbClient,
	userId: string,
	opts: { deckName?: string; limit: number; now: number },
): Promise<ReviewCardView[]> {
	const where = ["c.user_id = ?", "(c.state = 0 OR c.due <= ?)"];
	const params: SqlBinding[] = [userId, opts.now];
	if (opts.deckName) {
		where.push("d.name = ?");
		params.push(opts.deckName);
	}
	const sql = `${SELECT_COLUMNS}WHERE ${where.join(" AND ")} ORDER BY c.due ASC LIMIT ?`;
	params.push(opts.limit);
	const rows = await db.query<Record<string, unknown>>(sql, ...params);
	return rows.map(mapRow);
}

export async function listRandomCards(
	db: DbClient,
	userId: string,
	opts: { deckName?: string; limit: number },
): Promise<ReviewCardView[]> {
	const where = ["c.user_id = ?"];
	const params: SqlBinding[] = [userId];
	if (opts.deckName) {
		where.push("d.name = ?");
		params.push(opts.deckName);
	}
	const sql = `${SELECT_COLUMNS}WHERE ${where.join(" AND ")} ORDER BY RANDOM() LIMIT ?`;
	params.push(opts.limit);
	const rows = await db.query<Record<string, unknown>>(sql, ...params);
	return rows.map(mapRow);
}

export async function getCardForReview(
	db: DbClient,
	userId: string,
	cardId: string,
): Promise<CardRow | null> {
	const row = await db.queryFirst<Record<string, unknown>>(
		"SELECT id, note_id, user_id, deck_id, template_ord, due, stability, difficulty, " +
			"elapsed_days, scheduled_days, reps, lapses, state, last_review, created_at " +
			"FROM cards WHERE user_id = ? AND id = ?",
		userId,
		cardId,
	);
	if (!row) return null;
	return {
		id: String(row.id),
		noteId: String(row.note_id),
		user_id: String(row.user_id),
		deck_id: String(row.deck_id),
		template_ord: Number(row.template_ord),
		due: Number(row.due),
		stability: Number(row.stability),
		difficulty: Number(row.difficulty),
		elapsed_days: Number(row.elapsed_days),
		scheduled_days: Number(row.scheduled_days),
		reps: Number(row.reps),
		lapses: Number(row.lapses),
		state: Number(row.state),
		last_review: row.last_review == null ? null : Number(row.last_review),
		created_at: Number(row.created_at),
	};
}

export async function updateCardAfterReview(
	db: DbClient,
	userId: string,
	cardId: string,
	next: CardRow,
): Promise<void> {
	await db.exec(
		"UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, " +
			"scheduled_days = ?, reps = ?, lapses = ?, state = ?, last_review = ? " +
			"WHERE user_id = ? AND id = ?",
		next.due,
		next.stability,
		next.difficulty,
		next.elapsed_days,
		next.scheduled_days,
		next.reps,
		next.lapses,
		next.state,
		next.last_review,
		userId,
		cardId,
	);
}
