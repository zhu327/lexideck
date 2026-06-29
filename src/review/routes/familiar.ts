import type { Context } from "hono";
import type { AuthUser } from "../../auth/apiKey";
import type { DbClient } from "../../db/client";
import { listFamiliarNotes } from "../../db/repos/cards-review";
import { toggleNoteTag } from "../../db/repos/notes";

type ReviewEnv = { Variables: { user: AuthUser } };

function createToggleFamiliarHandler(deps: { db: DbClient }, add: boolean) {
	return async (c: Context<ReviewEnv>) => {
		const userId = c.get("user")?.userId ?? "local";
		const body = await c.req.json<{ noteId?: string }>();
		if (!body.noteId) {
			return c.json({ error: "noteId required" }, 400);
		}
		const ok = await toggleNoteTag(deps.db, userId, body.noteId, "known", add);
		if (!ok) {
			return c.json({ error: "not found" }, 404);
		}
		return c.json({ ok: true });
	};
}

export function createFamiliarHandler(deps: { db: DbClient }) {
	return createToggleFamiliarHandler(deps, true);
}

export function createFamiliarListHandler(deps: { db: DbClient }) {
	return async (c: Context<ReviewEnv>) => {
		const userId = c.get("user")?.userId ?? "local";
		const cards = await listFamiliarNotes(deps.db, userId);
		return c.json({ cards });
	};
}

export function createFamiliarUnmarkHandler(deps: { db: DbClient }) {
	return createToggleFamiliarHandler(deps, false);
}
