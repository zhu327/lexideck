import { Hono } from "hono";
import { coerceFields, resolveNote } from "../ankiconnect/actions/addNote";
import type { AuthUser } from "../auth/apiKey";
import type { DbClient } from "../db/client";
import { createCardsForNote } from "../db/repos/cards-create";
import { listDeckNames } from "../db/repos/decks";
import { getModel, listModelNames } from "../db/repos/models";
import {
	createNote,
	deleteNote,
	getNoteById,
	noteExistsByGuid,
	searchNotes,
	updateNoteFields,
} from "../db/repos/notes";
import type { Env } from "../env";

export interface NotesDeps {
	db: DbClient;
}

export function createNotesApp(
	deps: NotesDeps,
): Hono<{ Bindings: Env; Variables: { user: AuthUser } }> {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

	// POST /notes — create a note + cards
	app.post("/notes", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		let body: Record<string, unknown>;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "deckName and modelName required" }, 400);
		}

		const deckName = String(body.deckName ?? "");
		const modelName = String(body.modelName ?? "");
		if (!deckName || !modelName) {
			return c.json({ error: "deckName and modelName required" }, 400);
		}

		const fields = coerceFields(body.fields);
		const tags = Array.isArray(body.tags)
			? (body.tags as unknown[]).map((t: unknown) => String(t))
			: [];

		const resolved = await resolveNote(deps.db, userId, { deckName, modelName, fields });
		if ("error" in resolved) {
			if (resolved.error.startsWith("deck not found")) {
				return c.json({ error: "deck not found" }, 404);
			}
			if (resolved.error.startsWith("model not found")) {
				return c.json({ error: "model not found" }, 404);
			}
			return c.json({ error: resolved.error }, 400);
		}

		if (await noteExistsByGuid(deps.db, userId, resolved.guid)) {
			return c.json({ error: "duplicate" }, 409);
		}

		const created = await createNote(deps.db, userId, {
			deckId: resolved.deckId,
			modelId: resolved.modelId,
			fields,
			tags,
			guid: resolved.guid,
		});
		await createCardsForNote(deps.db, userId, created, resolved.model.templates);
		return c.json({ ankiId: created.ankiId, noteId: created.id });
	});

	// GET /notes/search — search notes
	app.get("/notes/search", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const query = c.req.query("q") || undefined;
		const limit = Number(c.req.query("limit")) || undefined;
		const offset = Number(c.req.query("offset")) || undefined;
		const result = await searchNotes(deps.db, userId, { query, limit, offset });
		return c.json(result);
	});

	// PUT /notes/:id — update note fields/tags
	app.put("/notes/:id", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const noteId = c.req.param("id");

		const note = await getNoteById(deps.db, userId, noteId);
		if (!note) return c.json({ error: "not found" }, 404);

		let body: { fields: Record<string, string>; tags?: string[] };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "fields required" }, 400);
		}
		if (!body.fields || typeof body.fields !== "object") {
			return c.json({ error: "fields required" }, 400);
		}

		await updateNoteFields(deps.db, userId, noteId, body.fields, body.tags);
		return c.json({ ok: true });
	});

	// GET /decks — list deck names
	app.get("/decks", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const decks = await listDeckNames(deps.db, userId);
		return c.json({ decks });
	});

	// GET /models — list model names
	app.get("/models", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const models = await listModelNames(deps.db, userId);
		return c.json({ models });
	});

	// GET /models/:name/fields — list field names for a model
	app.get("/models/:name/fields", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const modelName = c.req.param("name");
		const model = await getModel(deps.db, userId, modelName);
		if (!model) {
			return c.json({ error: "model not found" }, 404);
		}
		return c.json({ fields: model.fieldNames });
	});

	// DELETE /notes/:id — delete a note and all associated data
	app.delete("/notes/:id", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		const noteId = c.req.param("id");
		const deleted = await deleteNote(deps.db, userId, noteId);
		if (!deleted) return c.json({ error: "not found" }, 404);
		return c.json({ ok: true });
	});

	return app;
}
