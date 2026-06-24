import { Hono } from "hono";
import type { AuthUser } from "../auth/access";
import type { DbClient } from "../db/client";
import { addNoteAction } from "./actions/addNote";
import { canAddNotesAction } from "./actions/canAddNotes";
import { deckNamesAction } from "./actions/deckNames";
import { findNotesAction } from "./actions/findNotes";
import { modelFieldNamesAction } from "./actions/modelFieldNames";
import { modelNamesAction } from "./actions/modelNames";
import { modelStylingAction } from "./actions/modelStyling";
import { modelTemplatesAction } from "./actions/modelTemplates";
import { versionAction } from "./actions/version";

export interface AnkiDeps {
	db: DbClient;
}

export interface ActionCtx {
	db: DbClient;
	userId: string;
	params: Record<string, unknown>;
}

export interface ActionResult {
	result: unknown;
	error: string | null;
}

type ActionHandler = (ctx: ActionCtx) => Promise<ActionResult>;

const ACTIONS: Record<string, ActionHandler> = {
	version: versionAction,
	deckNames: deckNamesAction,
	modelNames: modelNamesAction,
	modelFieldNames: modelFieldNamesAction,
	modelTemplates: modelTemplatesAction,
	modelStyling: modelStylingAction,
	addNote: addNoteAction,
	canAddNotes: canAddNotesAction,
	findNotes: findNotesAction,
};

export function createAnkiconnectApp(deps: AnkiDeps): Hono<{ Variables: { user: AuthUser } }> {
	const app = new Hono<{ Variables: { user: AuthUser } }>();
	app.post("/", async (c) => {
		try {
			const body = await c.req.json();
			const action = String(body?.action);
			const handler = ACTIONS[action];
			if (!handler) {
				return c.json({ result: null, error: `unsupported action: ${action}` });
			}
			const userId = c.get("user")?.userId ?? "local";
			const r = await handler({ db: deps.db, userId, params: body.params ?? {} });
			return c.json(r);
		} catch {
			return c.json({ result: null, error: "internal error" });
		}
	});
	return app;
}
