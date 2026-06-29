import { Hono } from "hono";
import type { AuthUser } from "../auth/apiKey";
import type { DbClient } from "../db/client";
import { getEnrichment, saveEnrichment } from "../db/repos/enrichments";
import { getNoteById } from "../db/repos/notes";
import type { Env } from "../env";
import { enrichNote, readLlmConfig } from "./client";
import type { Enrichment, LlmConfig, NoteInput } from "./types";
import { LlmRequestError } from "./types";

const ENRICHMENT_KIND = "dictionary-v2";

export interface LlmDeps {
	db: DbClient;
	enrich?: (note: NoteInput, config: LlmConfig) => Promise<Enrichment>;
}

export function createLlmApp(
	deps: LlmDeps,
): Hono<{ Bindings: Env; Variables: { user: AuthUser } }> {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

	app.get("/notes/:id/enrich", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const noteId = c.req.param("id");

		const note = await getNoteById(deps.db, userId, noteId);
		if (!note) {
			return c.json({ error: "note not found" }, 404);
		}

		const cached = await getEnrichment(deps.db, userId, noteId, ENRICHMENT_KIND);
		if (!cached) {
			return c.json({ error: "not found" }, 404);
		}

		return c.json(cached);
	});

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

		const fields = note.fields;
		const front = fields.Front ?? fields.Word ?? Object.values(fields)[0] ?? "";
		const back = fields.Back ?? fields.Definition ?? Object.values(fields).slice(1).join("\n\n");
		const word = front;

		const enrichFn = deps.enrich ?? enrichNote;
		try {
			const result = await enrichFn({ word, front, back, fields }, config);
			await saveEnrichment(deps.db, userId, noteId, ENRICHMENT_KIND, result);
			return c.json(result);
		} catch (e) {
			if (e instanceof LlmRequestError) {
				return c.json({ error: "llm upstream error" }, 502);
			}
			return c.json({ error: "enrichment failed" }, 500);
		}
	});

	return app;
}
