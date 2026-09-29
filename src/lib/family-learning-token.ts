// ---------------------------------------------------------------------------
// Server-signed credentials for the learning cockpit (DESIGN §7.6).
//
// One token kind, one audience:
//
//   - child learning credential  — aud `family-learning`, sub = one child.
//     Minted by POST /api/family/learning/session from an authenticated
//     household session; every child learning route verifies it and takes the
//     child *only* from `sub`. Body/query child ids are ignored. The existing
//     bridge token (`aud family-child-bridge`, a different key and format) is
//     refused here by construction. Parent access carries no token at all: it
//     is the owner's NextAuth session (account rule of 2026-09-29).
//
// The signing key is derived from `AUTH_SECRET` (already configured for
// NextAuth in every environment) with HKDF and a fixed label, so no new secret
// has to be provisioned and a leaked learning key cannot be turned back into
// the NextAuth secret. Fail closed: a missing or short `AUTH_SECRET` means no
// token can be minted or verified.
//
// Server-only: imports `node:crypto`.
// ---------------------------------------------------------------------------

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isChildId, type ChildId } from "./family-assistant-turn.ts";

export const LEARNING_TOKEN_PREFIX = "flt1";
export const LEARNING_CHILD_AUDIENCE = "family-learning";
export const LEARNING_TOKEN_ISSUER = "companion-app";
export const CHILD_LEARNING_TTL_SECONDS = 15 * 60;
/** Audiences that once existed as candidate step-up tokens; refused if ever presented. */
export const RETIRED_AUDIENCES: readonly string[] = ["family-learning-parent", "family-learning-challenge"];
export const MIN_AUTH_SECRET_CHARS = 32;

export type ChildLearningClaims = {
  v: 1;
  iss: typeof LEARNING_TOKEN_ISSUER;
  aud: typeof LEARNING_CHILD_AUDIENCE;
  sub: ChildId;
  iat: number;
  exp: number;
  jti: string;
};

type Claims = ChildLearningClaims;

const CHILD_CLAIM_ORDER = ["v", "iss", "aud", "sub", "iat", "exp", "jti"] as const;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Derive the learning signing key from the configured NextAuth secret, or null. */
export function deriveLearningKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret || secret.length < MIN_AUTH_SECRET_CHARS) return null;
  return Buffer.from(hkdfSync("sha256", secret, "family-learning", "companion-app/family-learning/v1", 32));
}

function serialize(claims: Claims): string {
  const order: readonly string[] = CHILD_CLAIM_ORDER;
  const record = claims as unknown as Record<string, unknown>;
  return `{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(record[k])}`).join(",")}}`;
}

function sign(key: Buffer, payload: string): string {
  return base64url(createHmac("sha256", key).update(payload).digest());
}

export function mintToken(key: Buffer, claims: Claims): string {
  const payload = serialize(claims);
  return `${LEARNING_TOKEN_PREFIX}.${base64url(payload)}.${sign(key, payload)}`;
}

export type VerifyFailure =
  | "malformed"
  | "bad-signature"
  | "bad-audience"
  | "bad-issuer"
  | "expired"
  | "not-yet-valid"
  | "bad-subject";

export type VerifyResult<T extends Claims> = { ok: true; claims: T } | { ok: false; reason: VerifyFailure };

function verify(key: Buffer, token: string, audience: string, nowSeconds: number): VerifyResult<Claims> {
  if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== LEARNING_TOKEN_PREFIX) return { ok: false, reason: "malformed" };
  const payloadBytes = fromBase64url(parts[1]);
  const sigBytes = fromBase64url(parts[2]);
  if (!payloadBytes || !sigBytes) return { ok: false, reason: "malformed" };
  const payload = payloadBytes.toString("utf8");
  const expected = Buffer.from(sign(key, payload).replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (expected.length !== sigBytes.length || !timingSafeEqual(expected, sigBytes)) return { ok: false, reason: "bad-signature" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "malformed" };
  const claims = parsed as Record<string, unknown>;
  if (claims.v !== 1) return { ok: false, reason: "malformed" };
  if (claims.iss !== LEARNING_TOKEN_ISSUER) return { ok: false, reason: "bad-issuer" };
  if (claims.aud !== audience) return { ok: false, reason: "bad-audience" };
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number") return { ok: false, reason: "malformed" };
  if (claims.iat > nowSeconds + 60) return { ok: false, reason: "not-yet-valid" };
  if (claims.exp <= nowSeconds) return { ok: false, reason: "expired" };
  if (serialize(claims as unknown as Claims) !== payload) return { ok: false, reason: "malformed" };
  return { ok: true, claims: claims as unknown as Claims };
}

export function mintChildLearningToken(key: Buffer, child: ChildId, jti: string, nowSeconds: number): { token: string; expiresAt: number } {
  const claims: ChildLearningClaims = {
    v: 1,
    iss: LEARNING_TOKEN_ISSUER,
    aud: LEARNING_CHILD_AUDIENCE,
    sub: child,
    iat: nowSeconds,
    exp: nowSeconds + CHILD_LEARNING_TTL_SECONDS,
    jti,
  };
  return { token: mintToken(key, claims), expiresAt: claims.exp * 1000 };
}

export function verifyChildLearningToken(key: Buffer, token: string, nowSeconds: number): VerifyResult<ChildLearningClaims> {
  const result = verify(key, token, LEARNING_CHILD_AUDIENCE, nowSeconds);
  if (!result.ok) return result;
  const claims = result.claims as ChildLearningClaims;
  if (!isChildId(claims.sub) || typeof claims.jti !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(claims.jti)) {
    return { ok: false, reason: "bad-subject" };
  }
  return { ok: true, claims };
}

/** Reads `Authorization: Bearer <token>`; anything else is null. */
export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
