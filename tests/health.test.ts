import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
	it("returns 200 with { ok: true, db: 'ok' } when D1 is reachable", async () => {
		const res = await SELF.fetch("http://localhost/api/health");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, db: "ok" });
	});
});
