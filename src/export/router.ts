import { Hono } from "hono";
import type { AuthUser } from "../auth/apiKey";
import type { DbClient } from "../db/client";
import { getExportSnapshot } from "../db/repos/export";
import type { Env } from "../env";
import { ApkgExportError, generateApkg } from "./apkg";

export interface ExportDeps {
	db: DbClient;
}

export function createExportApp(
	deps: ExportDeps,
): Hono<{ Bindings: Env; Variables: { user: AuthUser } }> {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

	app.get("/apkg", async (c) => {
		const userId = c.get("user")?.userId ?? "local";
		try {
			const snapshot = await getExportSnapshot(deps.db, userId);
			const result = await generateApkg(snapshot);
			const bytes = new Uint8Array(result.bytes);
			return c.body(bytes, 200, {
				"Content-Type": "application/octet-stream",
				"Content-Disposition": `attachment; filename="${result.filename}"`,
			});
		} catch (error) {
			console.error("[export] error:", error);
			if (error instanceof ApkgExportError) {
				if (error.code === "empty_export") {
					return c.json({ error: "no notes to export" }, 400);
				}
				if (error.code === "export_too_large") {
					return c.json({ error: "export too large" }, 413);
				}
			}
			return c.json({ error: "failed to generate export" }, 500);
		}
	});

	return app;
}
