import type { Context } from "hono";
import type { AuthUser } from "../../auth/access";
import type { DbClient } from "../../db/client";

type ReviewEnv = { Variables: { user: AuthUser } };

function parseTags(raw: unknown): string[] {
	try {
		const v = JSON.parse(String(raw));
		return Array.isArray(v) ? (v as string[]) : [];
	} catch {
		return [];
	}
}

export function createFamiliarHandler(deps: { db: DbClient }) {
	return async (c: Context<ReviewEnv>) => {
		const userId = c.get("user")?.userId ?? "local";
		const body = await c.req.json<{ noteId?: string }>();
		if (!body.noteId) {
			return c.json({ error: "noteId required" }, 400);
		}
		const note = await deps.db.queryFirst<Record<string, unknown>>(
			"SELECT id, tags FROM notes WHERE user_id = ? AND id = ?",
			userId,
			body.noteId,
		);
		if (!note) {
			return c.json({ error: "not found" }, 404);
		}
		const tags = parseTags(note.tags);
		if (!tags.includes("known")) {
			tags.push("known");
		}
		await deps.db.exec(
			"UPDATE notes SET tags = ?, updated_at = ? WHERE user_id = ? AND id = ?",
			JSON.stringify(tags),
			Date.now(),
			userId,
			body.noteId,
		);
		return c.json({ ok: true });
	};
}
