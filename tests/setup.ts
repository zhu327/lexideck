import type { D1Migration } from "cloudflare:test";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Env as AppEnv } from "../src/env";

// Make the test runtime's `env` (typed as the global `Cloudflare.Env`) aware of
// the wrangler bindings (via AppEnv) plus the test-only migrations binding.
declare global {
	namespace Cloudflare {
		interface Env extends AppEnv {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}

// Setup files run outside per-test-file storage isolation and may run multiple
// times. `applyD1Migrations()` only applies migrations not already recorded, so
// this is safe to call here.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
