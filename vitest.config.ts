import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	// Read migrations in Node (the config runs in Node), then expose them to the
	// worker isolate via a test-only binding so the setup file can apply them.
	const migrationsPath = path.join(import.meta.dirname, "migrations");
	const migrations = await readD1Migrations(migrationsPath);

	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.toml" },
				miniflare: { bindings: { TEST_MIGRATIONS: migrations, DEV: "1" } },
			}),
		],
		test: {
			globals: true,
			setupFiles: ["./tests/setup.ts"],
		},
	};
});
