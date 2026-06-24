import type { MiddlewareHandler } from "hono";
import type { JSONWebKeySet } from "jose";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";

export interface AuthUser {
	userId: string;
	email: string;
	sub: string;
}

export type JWKS = JSONWebKeySet;

export interface AccessVerifyOptions {
	teamDomain: string;
	aud: string;
	jwks?: JWKS;
}

export type VerifyFn = (token: string, env: Env) => Promise<AuthUser>;

const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRemoteJwks(teamDomain: string) {
	let keyset = remoteJwksCache.get(teamDomain);
	if (!keyset) {
		keyset = createRemoteJWKSet(
			new URL(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`),
		);
		remoteJwksCache.set(teamDomain, keyset);
	}
	return keyset;
}

export async function verifyAccessToken(
	token: string,
	opts: AccessVerifyOptions,
): Promise<AuthUser> {
	const keyset = opts.jwks ? createLocalJWKSet(opts.jwks) : getRemoteJwks(opts.teamDomain);
	const { payload } = await jwtVerify(token, keyset, {
		audience: opts.aud,
		issuer: `https://${opts.teamDomain}.cloudflareaccess.com`,
	});
	return {
		userId: "local",
		email: String(payload.email ?? ""),
		sub: String(payload.sub ?? ""),
	};
}

export function extractAccessToken(request: Request): string | null {
	const header = request.headers.get("Cf-Access-Jwt-Assertion");
	if (header) return header;
	const cookie = request.headers.get("Cookie");
	if (cookie) {
		const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
		if (match) return match[1];
	}
	return null;
}

export function accessAuthMiddleware(options?: {
	verify?: VerifyFn;
}): MiddlewareHandler<{ Bindings: Env; Variables: { user: AuthUser } }> {
	return async (c, next) => {
		if (c.env.DEV === "1") {
			c.set("user", { userId: "local", email: "dev@local", sub: "dev" });
			await next();
			return;
		}
		const token = extractAccessToken(c.req.raw);
		if (!token) {
			return c.json({ error: "unauthorized" }, 401);
		}
		const verify: VerifyFn =
			options?.verify ??
			((t, env) =>
				verifyAccessToken(t, {
					teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
					aud: env.CF_ACCESS_AUD,
				}));
		try {
			const user = await verify(token, c.env);
			c.set("user", user);
			await next();
		} catch {
			return c.json({ error: "unauthorized" }, 401);
		}
	};
}
