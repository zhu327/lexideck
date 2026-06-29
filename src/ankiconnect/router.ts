import { Hono } from "hono";
import type { AuthUser } from "../auth/apiKey";
import type { DbClient } from "../db/client";
import type { Env } from "../env";
import { addNoteAction } from "./actions/addNote";
import { apiReflectAction } from "./actions/apiReflect";
import { canAddNotesAction } from "./actions/canAddNotes";
import { canAddNotesWithErrorDetailAction } from "./actions/canAddNotesWithErrorDetail";
import { deckNamesAction } from "./actions/deckNames";
import { findCardsAction } from "./actions/findCards";
import { findNotesAction } from "./actions/findNotes";
import { guiBrowseAction } from "./actions/guiBrowse";
import { modelFieldNamesAction } from "./actions/modelFieldNames";
import { modelNamesAction } from "./actions/modelNames";
import { modelStylingAction } from "./actions/modelStyling";
import { modelTemplatesAction } from "./actions/modelTemplates";
import { notesInfoAction } from "./actions/notesInfo";
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
	canAddNotesWithErrorDetail: canAddNotesWithErrorDetailAction,
	findNotes: findNotesAction,
	notesInfo: notesInfoAction,
	findCards: findCardsAction,
	guiBrowse: guiBrowseAction,
	apiReflect: apiReflectAction,
};

export function createAnkiconnectApp(
	deps: AnkiDeps,
): Hono<{ Bindings: Env; Variables: { user: AuthUser } }> {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	app.post("/", async (c) => {
		let version = 6; // default for error path
		try {
			const body = await c.req.json();

			// apiKey auth (Yomitan sends key in body)
			if (c.env.DEV !== "1") {
				const apiKey = c.env.ANKICONNECT_API_KEY;
				if (!apiKey || body?.key !== apiKey) {
					return c.json({ error: "unauthorized" }, 401);
				}
			}

			const action = String(body?.action);
			version = Number(body?.version ?? 6);
			const handler = ACTIONS[action];
			if (!handler) {
				const r: ActionResult = { result: null, error: `unsupported action: ${action}` };
				return version <= 4 ? c.json(r.error ? null : r.result) : c.json(r);
			}
			const userId = c.get("user")?.userId ?? "local";
			const r = await handler({ db: deps.db, userId, params: body.params ?? {} });
			return version <= 4 ? c.json(r.error ? null : r.result) : c.json(r);
		} catch (e) {
			console.error("ankiconnect dispatch error", e);
			return version <= 4 ? c.json(null) : c.json({ result: null, error: "internal error" });
		}
	});
	return app;
}
