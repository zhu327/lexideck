import { Hono } from "hono";
import type { AuthUser } from "../auth/access";
import type { DbClient } from "../db/client";
import { saveEnrichment } from "../db/repos/enrichments";
import { getNoteById } from "../db/repos/notes";
import type { Env } from "../env";
import { enrichNote, readLlmConfig } from "./client";
import type { Enrichment, LlmConfig, NoteInput } from "./types";
import { LlmRequestError } from "./types";

export interface LlmDeps {
	db: DbClient;
	enrich?: (note: NoteInput, config: LlmConfig) => Promise<Enrichment>;
}

export function createLlmApp(
	deps: LlmDeps,
): Hono<{ Bindings: Env; Variables: { user: AuthUser } }> {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

	app.post("/notes/:id/enrich", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const noteId = c.req.param("id");

		const note = await getNoteById(deps.db, userId, noteId);
		if (!note) {
			return c.json({ error: "note not found" }, 404);
		}

		const config = readLlmConfig(c.env);
		if (!config) {
			return c.json({ error: "llm not configured" }, 503);
		}

		const word = note.fields.Front ?? note.fields.Word ?? Object.values(note.fields)[0] ?? "";
		const fields = note.fields;

		const enrichFn = deps.enrich ?? enrichNote;
		try {
			const result = await enrichFn({ word, fields }, config);
			await saveEnrichment(deps.db, userId, noteId, "default", result);
			return c.json(result);
		} catch (e) {
			if (e instanceof LlmRequestError) {
				return c.json({ error: "llm upstream error" }, 502);
			}
			return c.json({ error: e instanceof Error ? e.message : "error" }, 500);
		}
	});

	return app;
}
