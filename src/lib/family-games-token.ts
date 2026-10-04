// ---------------------------------------------------------------------------
// Server-signed credentials for the approved-game library and paid play
// (Family DESIGN "Game Studio entitlements", Game Studio DESIGN G1/G2).
//
// Two credentials, two trust boundaries:
//
//   1. child games bearer — aud `family-games`, sub = one child. Minted by
//      POST /api/family/games/session from an authenticated household session
//      and verified by every Family play route on this server. Key: HKDF of
//      AUTH_SECRET with its own label (same construction as the learning
//      credential; different label → different key).
//
//   2. Studio play credential — aud `family-play`, sub = child, plus the game,
//      the lease and the mode. Handed to the browser so it can present it to
//      the Game Studio child adapter on the Mac mini, which verifies it with the
//      shared `FAMILY_GAMES_TOKEN_SECRET` (the same split as the assistant
//      bridge secret). It never carries an owner identity or any API scope
//      beyond its one lease. Settlement reports from the adapter back to this
//      server are signed with the same shared secret.
//
// Server-only: imports `node:crypto`.
// ---------------------------------------------------------------------------

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isChildId, type ChildId } from "./family-assistant-turn.ts";
import { GAME_ID_PATTERN, LEASE_ID_PATTERN, isPlayMode, type PlayMode } from "./family-play.ts";

export const GAMES_TOKEN_PREFIX = "fgt1";
export const GAMES_TOKEN_ISSUER = "companion-app";
export const GAMES_CHILD_AUDIENCE = "family-games";
export const PLAY_CREDENTIAL_AUDIENCE = "family-play";
export const CHILD_GAMES_TTL_SECONDS = 15 * 60;
export const PLAY_CREDENTIAL_TTL_SECONDS = 20 * 60;
export const MIN_SECRET_CHARS = 32;
export const GAMES_SECRET_ENV = "FAMILY_GAMES_TOKEN_SECRET";
export const GAMES_URL_ENV = "FAMILY_GAMES_STUDIO_URL";
export const SETTLEMENT_SIGNATURE_HEADER = "x-family-play-signature";
export const SETTLEMENT_TIMESTAMP_HEADER = "x-family-play-timestamp";
export const SETTLEMENT_MAX_SKEW_SECONDS = 5 * 60;

export type ChildGamesClaims = {
  v: 1;
  iss: typeof GAMES_TOKEN_ISSUER;
  aud: typeof GAMES_CHILD_AUDIENCE;
  sub: ChildId;
  iat: number;
  exp: number;
  jti: string;
};

/** Scope of a Studio credential: a game lease, or the child's library/editor. */
export type PlayCredentialScope = "lease" | "library";

export type PlayCredentialClaims = {
  v: 1;
  iss: typeof GAMES_TOKEN_ISSUER;
  aud: typeof PLAY_CREDENTIAL_AUDIENCE;
  sub: ChildId;
  scope: PlayCredentialScope;
  /** Stable game id for a lease credential; "*" for the library scope. */
  gid: string;
  /** Lease id for a lease credential; "-" for the library scope. */
  lid: string;
  mode: PlayMode;
  /** Whether the lease consumes allowance and how much it may consume at most. */
  metered: boolean;
  budget: number;
  iat: number;
  exp: number;
  jti: string;
};

const CHILD_ORDER = ["v", "iss", "aud", "sub", "iat", "exp", "jti"] as const;
const PLAY_ORDER = ["v", "iss", "aud", "sub", "scope", "gid", "lid", "mode", "metered", "budget", "iat", "exp", "jti"] as const;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function serialize(order: readonly string[], claims: Record<string, unknown>): string {
  return `{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(claims[k])}`).join(",")}}`;
}

function sign(key: Buffer, payload: string): string {
  return base64url(createHmac("sha256", key).update(payload).digest());
}

/** Key for the child games bearer: HKDF of AUTH_SECRET under the games label. */
export function deriveGamesKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_CHARS) return null;
  return Buffer.from(hkdfSync("sha256", secret, "family-games", "companion-app/family-games/v1", 32));
}

/** Key for Studio credentials and settlement signatures: HKDF of the shared secret. */
export function derivePlayKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = env[GAMES_SECRET_ENV]?.trim();
  if (!secret || secret.length < MIN_SECRET_CHARS) return null;
  return deriveSharedPlayKey(secret);
}

/** Exported so the Game Studio adapter test vector and this side agree byte for byte. */
export function deriveSharedPlayKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "family-play", "family/game-play/v1", 32));
}

export type StudioConfig = { ok: true; key: Buffer; studioUrl: string } | { ok: false; reason: "missing-secret" | "missing-url" | "insecure-url" };

/** The Studio URL must be https (a tailnet Serve origin); loopback http is allowed for local verification only. */
export function resolveStudioConfig(env: Record<string, string | undefined> = process.env): StudioConfig {
  const key = derivePlayKey(env);
  if (!key) return { ok: false, reason: "missing-secret" };
  const raw = env[GAMES_URL_ENV]?.trim();
  if (!raw) return { ok: false, reason: "missing-url" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "missing-url" };
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !loopback) return { ok: false, reason: "insecure-url" };
  return { ok: true, key, studioUrl: url.origin + url.pathname.replace(/\/+$/, "") };
}

function mint(key: Buffer, order: readonly string[], claims: Record<string, unknown>): string {
  const payload = serialize(order, claims);
  return `${GAMES_TOKEN_PREFIX}.${base64url(payload)}.${sign(key, payload)}`;
}

export type VerifyFailure = "malformed" | "bad-signature" | "bad-audience" | "bad-issuer" | "expired" | "not-yet-valid" | "bad-subject";
export type VerifyResult<T> = { ok: true; claims: T } | { ok: false; reason: VerifyFailure };

function verify(key: Buffer, token: string, audience: string, order: readonly string[], nowSeconds: number): VerifyResult<Record<string, unknown>> {
  if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== GAMES_TOKEN_PREFIX) return { ok: false, reason: "malformed" };
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
  if (claims.iss !== GAMES_TOKEN_ISSUER) return { ok: false, reason: "bad-issuer" };
  if (claims.aud !== audience) return { ok: false, reason: "bad-audience" };
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number") return { ok: false, reason: "malformed" };
  if (claims.iat > nowSeconds + 60) return { ok: false, reason: "not-yet-valid" };
  if (claims.exp <= nowSeconds) return { ok: false, reason: "expired" };
  if (serialize(order, claims) !== payload) return { ok: false, reason: "malformed" };
  return { ok: true, claims };
}

const JTI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function mintChildGamesToken(key: Buffer, child: ChildId, jti: string, nowSeconds: number): { token: string; expiresAt: number } {
  const claims: ChildGamesClaims = { v: 1, iss: GAMES_TOKEN_ISSUER, aud: GAMES_CHILD_AUDIENCE, sub: child, iat: nowSeconds, exp: nowSeconds + CHILD_GAMES_TTL_SECONDS, jti };
  return { token: mint(key, CHILD_ORDER, claims), expiresAt: claims.exp * 1000 };
}

export function verifyChildGamesToken(key: Buffer, token: string, nowSeconds: number): VerifyResult<ChildGamesClaims> {
  const result = verify(key, token, GAMES_CHILD_AUDIENCE, CHILD_ORDER, nowSeconds);
  if (!result.ok) return result;
  const c = result.claims;
  if (!isChildId(c.sub) || typeof c.jti !== "string" || !JTI.test(c.jti)) return { ok: false, reason: "bad-subject" };
  return { ok: true, claims: c as unknown as ChildGamesClaims };
}

export function mintPlayCredential(
  key: Buffer,
  input: { child: ChildId; scope: PlayCredentialScope; gameId: string; leaseId: string; mode: PlayMode; metered: boolean; budgetSeconds: number; jti: string; nowSeconds: number; ttlSeconds?: number },
): { token: string; expiresAt: number } {
  const claims: PlayCredentialClaims = {
    v: 1,
    iss: GAMES_TOKEN_ISSUER,
    aud: PLAY_CREDENTIAL_AUDIENCE,
    sub: input.child,
    scope: input.scope,
    gid: input.scope === "library" ? "*" : input.gameId,
    lid: input.scope === "library" ? "-" : input.leaseId,
    mode: input.mode,
    metered: input.metered,
    budget: Math.max(0, Math.floor(input.budgetSeconds)),
    iat: input.nowSeconds,
    exp: input.nowSeconds + (input.ttlSeconds ?? PLAY_CREDENTIAL_TTL_SECONDS),
    jti: input.jti,
  };
  return { token: mint(key, PLAY_ORDER, claims as unknown as Record<string, unknown>), expiresAt: claims.exp * 1000 };
}

export function verifyPlayCredential(key: Buffer, token: string, nowSeconds: number): VerifyResult<PlayCredentialClaims> {
  const result = verify(key, token, PLAY_CREDENTIAL_AUDIENCE, PLAY_ORDER, nowSeconds);
  if (!result.ok) return result;
  const c = result.claims;
  const scopeOk = c.scope === "lease" || c.scope === "library";
  const gidOk = c.scope === "library" ? c.gid === "*" : typeof c.gid === "string" && GAME_ID_PATTERN.test(c.gid);
  const lidOk = c.scope === "library" ? c.lid === "-" : typeof c.lid === "string" && LEASE_ID_PATTERN.test(c.lid);
  if (!isChildId(c.sub) || !scopeOk || !gidOk || !lidOk || !isPlayMode(c.mode) || typeof c.metered !== "boolean" || typeof c.budget !== "number" || typeof c.jti !== "string" || !JTI.test(c.jti)) {
    return { ok: false, reason: "bad-subject" };
  }
  return { ok: true, claims: c as unknown as PlayCredentialClaims };
}

/** Reads `Authorization: Bearer <token>`; anything else is null. */
export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Studio → Family request signatures (settlement reports and lease status
// reads): shared-secret HMAC over `${timestamp}.${leaseId}.${rawBody}`. The
// lease id in the signed string binds a report to exactly one lease URL, so a
// captured report cannot be retargeted; the timestamp bounds replay.
// ---------------------------------------------------------------------------

export function signSettlement(key: Buffer, timestampSeconds: number, leaseId: string, rawBody: string): string {
  return `v2=${createHmac("sha256", key).update(`${timestampSeconds}.${leaseId}.${rawBody}`).digest("hex")}`;
}

export type SettlementVerify = { ok: true } | { ok: false; reason: "missing" | "bad-timestamp" | "skew" | "bad-signature" };

export function verifySettlementSignature(key: Buffer, signatureHeader: string | null, timestampHeader: string | null, leaseId: string, rawBody: string, nowSeconds: number): SettlementVerify {
  if (!signatureHeader || !timestampHeader) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(timestampHeader)) return { ok: false, reason: "bad-timestamp" };
  const ts = Number(timestampHeader);
  if (Math.abs(nowSeconds - ts) > SETTLEMENT_MAX_SKEW_SECONDS) return { ok: false, reason: "skew" };
  const expected = Buffer.from(signSettlement(key, ts, leaseId, rawBody));
  const given = Buffer.from(signatureHeader);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad-signature" };
  return { ok: true };
}
