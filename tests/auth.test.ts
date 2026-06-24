import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import type { JSONWebKeySet } from "jose";
import { exportJWK, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser, VerifyFn } from "../src/auth/access";
import { accessAuthMiddleware, extractAccessToken, verifyAccessToken } from "../src/auth/access";
import type { Env } from "../src/env";

const TEAM_DOMAIN = "team";
const AUD = "aud-123";
const ISSUER = `https://${TEAM_DOMAIN}.cloudflareaccess.com`;

let privateKey: CryptoKey;
let jwks: JSONWebKeySet;

async function signToken(opts: { exp?: string; aud?: string; iss?: string }): Promise<string> {
	return new SignJWT({ email: "u@e.com", sub: "abc" })
		.setProtectedHeader({ alg: "RS256", kid: "test" })
		.setIssuer(opts.iss ?? ISSUER)
		.setAudience(opts.aud ?? AUD)
		.setExpirationTime(opts.exp ?? "1h")
		.sign(privateKey);
}

function tamperSignature(token: string): string {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("not a compact JWS");
	const sig = parts[2];
	const flipped = sig.length ? sig.replace(/^./, (ch) => (ch === "A" ? "B" : "A")) : "A";
	return `${parts[0]}.${parts[1]}.${flipped}`;
}

beforeAll(async () => {
	const pair = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	privateKey = pair.privateKey;
	const publicJwk = await exportJWK(pair.publicKey);
	jwks = {
		keys: [{ ...publicJwk, kid: "test", kty: "RSA", alg: "RS256", use: "sig" }],
	};
});

describe("verifyAccessToken", () => {
	it("resolves the local user for a valid token against injected JWKS", async () => {
		const token = await signToken({});

		const user = await verifyAccessToken(token, {
			teamDomain: TEAM_DOMAIN,
			aud: AUD,
			jwks,
		});

		expect(user).toEqual({ userId: "local", email: "u@e.com", sub: "abc" });
	});

	it("rejects a token with the wrong audience", async () => {
		const token = await signToken({ aud: "wrong-aud" });

		await expect(
			verifyAccessToken(token, { teamDomain: TEAM_DOMAIN, aud: AUD, jwks }),
		).rejects.toThrow();
	});

	it("rejects an expired token", async () => {
		const token = await signToken({ exp: "-1s" });

		await expect(
			verifyAccessToken(token, { teamDomain: TEAM_DOMAIN, aud: AUD, jwks }),
		).rejects.toThrow();
	});

	it("rejects a token with a tampered signature", async () => {
		const token = tamperSignature(await signToken({}));

		await expect(
			verifyAccessToken(token, { teamDomain: TEAM_DOMAIN, aud: AUD, jwks }),
		).rejects.toThrow();
	});
});

describe("extractAccessToken", () => {
	it("prefers the Cf-Access-Jwt-Assertion header", () => {
		const req = new Request("http://localhost/", {
			headers: {
				"Cf-Access-Jwt-Assertion": "header-token",
				Cookie: "CF_Authorization=cookie-token",
			},
		});

		expect(extractAccessToken(req)).toBe("header-token");
	});

	it("falls back to the CF_Authorization cookie", () => {
		const req = new Request("http://localhost/", {
			headers: { Cookie: "CF_Authorization=cookie-token; other=v" },
		});

		expect(extractAccessToken(req)).toBe("cookie-token");
	});

	it("returns null when no token is present", () => {
		const req = new Request("http://localhost/");

		expect(extractAccessToken(req)).toBeNull();
	});
});

function makeApp(verify?: VerifyFn) {
	const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
	app.use("*", accessAuthMiddleware(verify ? { verify } : {}));
	app.get("/whoami", (c) => c.json({ user: c.get("user") }));
	return app;
}

const FIXED_USER: AuthUser = { userId: "local", email: "fixed@e.com", sub: "fixed-sub" };
const fixedVerify: VerifyFn = async () => FIXED_USER;

function prodEnv(): Env {
	return { ...env, DEV: undefined };
}

describe("accessAuthMiddleware", () => {
	it("bypasses auth and sets a local user when DEV=1", async () => {
		const app = makeApp();

		const res = await app.fetch(new Request("http://localhost/whoami"), { ...env, DEV: "1" });

		expect(res.status).toBe(200);
		expect(((await res.json()) as { user: AuthUser }).user).toEqual({
			userId: "local",
			email: "dev@local",
			sub: "dev",
		});
	});

	it("returns 401 when DEV is unset and no token is present", async () => {
		const app = makeApp();

		const res = await app.fetch(new Request("http://localhost/whoami"), prodEnv());

		expect(res.status).toBe(401);
	});

	it("accepts a valid token in the Cf-Access-Jwt-Assertion header", async () => {
		const app = makeApp(fixedVerify);

		const res = await app.fetch(
			new Request("http://localhost/whoami", {
				headers: { "Cf-Access-Jwt-Assertion": "any-token" },
			}),
			prodEnv(),
		);

		expect(res.status).toBe(200);
		expect(((await res.json()) as { user: AuthUser }).user).toEqual(FIXED_USER);
	});

	it("accepts a valid token via the CF_Authorization cookie fallback", async () => {
		const app = makeApp(fixedVerify);

		const res = await app.fetch(
			new Request("http://localhost/whoami", {
				headers: { Cookie: "CF_Authorization=cookie-token" },
			}),
			prodEnv(),
		);

		expect(res.status).toBe(200);
		expect(((await res.json()) as { user: AuthUser }).user).toEqual(FIXED_USER);
	});

	it("returns 401 when the injected verify throws", async () => {
		const app = makeApp(async () => {
			throw new Error("nope");
		});

		const res = await app.fetch(
			new Request("http://localhost/whoami", {
				headers: { "Cf-Access-Jwt-Assertion": "bad-token" },
			}),
			prodEnv(),
		);

		expect(res.status).toBe(401);
	});
});

describe("global app auth (DEV bypass)", () => {
	it("keeps GET /api/health reachable via the DEV bypass", async () => {
		const res = await SELF.fetch("http://localhost/api/health");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, db: "ok" });
	});
});
