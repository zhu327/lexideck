import { Hono } from "hono";
import type { AuthUser } from "../auth/access";
import type { DbClient } from "../db/client";
import { createDueHandler } from "./routes/due";
import { createFamiliarHandler } from "./routes/familiar";
import { createQuizHandler } from "./routes/quiz";
import { createSubmitHandler } from "./routes/submit";

export interface ReviewDeps {
	db: DbClient;
}

export function createReviewApp(deps: ReviewDeps): Hono<{ Variables: { user: AuthUser } }> {
	const app = new Hono<{ Variables: { user: AuthUser } }>();
	app.get("/due", createDueHandler(deps));
	app.post("/submit", createSubmitHandler(deps));
	app.get("/quiz", createQuizHandler(deps));
	app.post("/familiar", createFamiliarHandler(deps));
	return app;
}
