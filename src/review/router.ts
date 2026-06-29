import { Hono } from "hono";
import type { AuthUser } from "../auth/apiKey";
import type { DbClient } from "../db/client";
import type { Env } from "../env";
import { createDueHandler } from "./routes/due";
import {
	createFamiliarHandler,
	createFamiliarListHandler,
	createFamiliarUnmarkHandler,
} from "./routes/familiar";
import { createQuizHandler } from "./routes/quiz";
import { createSubmitHandler } from "./routes/submit";

export interface ReviewDeps {
	db: DbClient;
}

export function createReviewApp(
	deps: ReviewDeps,
): Hono<{ Bindings: Env; Variables: { user: AuthUser } }> {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	app.get("/due", createDueHandler(deps));
	app.post("/submit", createSubmitHandler(deps));
	app.get("/quiz", createQuizHandler(deps));
	app.post("/familiar", createFamiliarHandler(deps));
	app.get("/familiar", createFamiliarListHandler(deps));
	app.post("/familiar/unmark", createFamiliarUnmarkHandler(deps));
	return app;
}
