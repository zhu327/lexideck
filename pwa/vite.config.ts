import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const pwaDir = fileURLToPath(new URL(".", import.meta.url));

function listFiles(dir: string, base = ""): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = `${base}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...listFiles(join(dir, entry.name), rel));
		} else if (entry.isFile()) {
			out.push(rel);
		}
	}
	return out;
}

/**
 * Post-build step: inject the full asset manifest into sw.js so the service
 * worker precaches every build artifact (including content-hashed bundles),
 * then derive the cache version from the final sw.js content hash.
 *
 * This fixes "first visit → immediately offline" (previously only / and icons
 * were precached, hashed bundles were not) and removes manual cache-version
 * bookkeeping: any change to assets changes the manifest, which changes the
 * SW content, which produces a new cache name (old caches purge on activate).
 */
function swPrecachePlugin(): Plugin {
	return {
		name: "lexideck-sw-precache",
		apply: "build",
		closeBundle() {
			const outDir = join(pwaDir, "..", "dist", "pwa");
			const urls = ["/", ...listFiles(outDir).filter((u) => u !== "/sw.js")];
			const swPath = join(outDir, "sw.js");
			let sw = readFileSync(swPath, "utf8");
			sw = sw.replace(
				"const PRECACHE_URLS = [];",
				`const PRECACHE_URLS = ${JSON.stringify(urls)};`,
			);
			const version = createHash("sha256").update(sw).digest("hex").slice(0, 12);
			sw = sw.replace(
				'const CACHE_NAME = "anki-vocab-__SW_CACHE_VERSION__";',
				`const CACHE_NAME = "anki-vocab-${version}";`,
			);
			writeFileSync(swPath, sw);
			console.log(`[sw-precache] ${urls.length} URLs precached → cache anki-vocab-${version}`);
		},
	};
}

export default defineConfig({
	build: {
		outDir: "../dist/pwa",
		emptyOutDir: true,
	},
	plugins: [swPrecachePlugin()],
});
