import type { CardRow } from "../../srs/types";
import type { DbClient, SqlBinding } from "../client";
import { parseJsonColumn } from "./json";

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

export interface FamiliarRow {
	noteId: string;
	front: string;
	known: boolean;
}

function mapRow(row: Record<string, unknown>): ReviewCardView {
	return {
		cardId: String(row.card_id),
		noteId: String(row.note_id),
		deckName: String(row.deck_name),
		modelName: String(row.model_name),
		fields: parseJsonColumn<Record<string, string>>(row.fields, {}),
		tags: parseJsonColumn<string[]>(row.tags, []),
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

/** Shared JOINs for card-count queries (no models needed). */
const CARD_COUNT_JOINS =
	"FROM cards c JOIN notes n ON n.id = c.note_id JOIN decks d ON d.id = c.deck_id ";

/** Shared base WHERE fragment: user_id param + known-tag exclusion. Append deck filter as needed. */
const CARD_BASE_WHERE =
	"c.user_id = ? AND NOT EXISTS (SELECT 1 FROM json_each(n.tags) WHERE json_each.value = 'known')";

export async function listDueCards(
	db: DbClient,
	userId: string,
	opts: {
		deckName?: string;
		limit: number;
		now: number;
		offset?: number;
		newPerDay?: number;
		reviewsPerDay?: number;
	},
): Promise<ReviewCardView[]> {
	const baseWhere = [CARD_BASE_WHERE];
	const params: SqlBinding[] = [userId];
	if (opts.deckName) {
		baseWhere.push("d.name = ?");
		params.push(opts.deckName);
	}
	const whereStr = baseWhere.join(" AND ");

	const hasLimits = opts.newPerDay !== undefined || opts.reviewsPerDay !== undefined;
	if (hasLimits) {
		const newLimit = opts.newPerDay ?? Number.MAX_SAFE_INTEGER;
		const reviewLimit = opts.reviewsPerDay ?? Number.MAX_SAFE_INTEGER;
		const reviewParams: SqlBinding[] = [...params, opts.now];

		const sql =
			`SELECT * FROM (${SELECT_COLUMNS}WHERE ${whereStr} AND c.state = 0 ORDER BY c.due ASC LIMIT ?) ` +
			`UNION ALL ` +
			`SELECT * FROM (${SELECT_COLUMNS}WHERE ${whereStr} AND c.state > 0 AND c.due <= ? ORDER BY c.due ASC LIMIT ?) ` +
			`ORDER BY due ASC LIMIT ? OFFSET ?`;

		const allParams: SqlBinding[] = [
			...params,
			newLimit,
			...reviewParams,
			reviewLimit,
			opts.limit,
			opts.offset ?? 0,
		];
		const rows = await db.query<Record<string, unknown>>(sql, ...allParams);
		return rows.map(mapRow);
	}

	const sql = `${SELECT_COLUMNS}WHERE ${whereStr} AND (c.state = 0 OR c.due <= ?) ORDER BY c.due ASC LIMIT ? OFFSET ?`;
	const rows = await db.query<Record<string, unknown>>(
		sql,
		...params,
		opts.now,
		opts.limit,
		opts.offset ?? 0,
	);
	return rows.map(mapRow);
}

export async function countDueCards(
	db: DbClient,
	userId: string,
	opts: { deckName?: string; now: number; newPerDay?: number; reviewsPerDay?: number },
): Promise<number> {
	const where = [CARD_BASE_WHERE, "(c.state = 0 OR c.due <= ?)"];
	const params: SqlBinding[] = [userId, opts.now];
	if (opts.deckName) {
		where.push("d.name = ?");
		params.push(opts.deckName);
	}
	const whereStr = where.join(" AND ");

	const [newRow, reviewRow] = await Promise.all([
		db.queryFirst<{ count: number }>(
			`SELECT COUNT(*) as count ${CARD_COUNT_JOINS}WHERE ${whereStr} AND c.state = 0`,
			...params,
		),
		db.queryFirst<{ count: number }>(
			`SELECT COUNT(*) as count ${CARD_COUNT_JOINS}WHERE ${whereStr} AND c.state > 0`,
			...params,
		),
	]);

	const newCount = newRow?.count ?? 0;
	const reviewCount = reviewRow?.count ?? 0;
	const capNew = Math.min(newCount, opts.newPerDay ?? Number.MAX_SAFE_INTEGER);
	const capReview = Math.min(reviewCount, opts.reviewsPerDay ?? Number.MAX_SAFE_INTEGER);
	return capNew + capReview;
}

export async function listRandomCards(
	db: DbClient,
	userId: string,
	opts: { deckName?: string; limit: number },
): Promise<ReviewCardView[]> {
	const where = [CARD_BASE_WHERE];
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

function mapCardRow(row: Record<string, unknown>): CardRow {
	return {
		id: String(row.id),
		noteId: String(row.note_id),
		user_id: String(row.user_id),
		deck_id: String(row.deck_id),
		template_ord: Number(row.template_ord),
		ankiId: row.anki_id == null ? null : Number(row.anki_id),
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

export async function listFamiliarNotes(
	db: DbClient,
	userId: string,
	opts?: { limit?: number; offset?: number },
): Promise<FamiliarRow[]> {
	const sql =
		"SELECT n.id, n.fields, " +
		"EXISTS (SELECT 1 FROM json_each(n.tags) WHERE json_each.value = 'known') AS known " +
		"FROM notes n WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ? OFFSET ?";
	const rows = await db.query<Record<string, unknown>>(
		sql,
		userId,
		opts?.limit ?? 100,
		opts?.offset ?? 0,
	);
	return rows.map((row) => {
		const fields = parseJsonColumn<Record<string, string>>(row.fields, {});
		const firstKey = Object.keys(fields)[0];
		return {
			noteId: String(row.id),
			front: firstKey ? String(fields[firstKey]) : "",
			known: row.known === 1,
		};
	});
}

export async function getCardForReview(
	db: DbClient,
	userId: string,
	cardId: string,
): Promise<CardRow | null> {
	const row = await db.queryFirst<Record<string, unknown>>(
		"SELECT id, note_id, user_id, deck_id, template_ord, due, stability, difficulty, " +
			"elapsed_days, scheduled_days, reps, lapses, state, last_review, anki_id, created_at " +
			"FROM cards WHERE user_id = ? AND id = ?",
		userId,
		cardId,
	);
	return row ? mapCardRow(row) : null;
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
