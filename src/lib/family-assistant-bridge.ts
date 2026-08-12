// Server-side minting of the child-scoped Family Assistant bridge credential.
//
// ## The credential boundary, stated plainly
//
// The OpenClaw Gateway's operator bearer grants owner scope over the whole
// household — every agent, every session, config mutation, exec approvals. It
// lives on the Mac mini and nowhere else. It is NOT in this repository, NOT in
// a Vercel environment variable, and NOT reachable from a browser.
//
// What this module mints instead is a much smaller thing: a short-lived,
// HMAC-signed token whose subject is exactly one child agent and whose session
// is exactly one surface. Everything it can express is fixed at mint time. A
// stolen one buys a few minutes of one child's conversation on a tailnet-only
// listener, and nothing else.
//
// Family Assistant DESIGN §7 authorizes exactly this split: "Vercel may mint a
// short-lived signed token whose subject is `santiago` or `isabel`, but neither
// Vercel nor the browser receives the shared Gateway bearer credential."
//
// ## Fail closed
//
// The shared secret comes from runtime configuration only. When it is missing,
// blank, or under the length floor, `resolveBridgeMintConfig` reports "not
// configured" and the session route returns 503 — it never falls back to an
// unsigned token, a default secret, or a direct Gateway call.
//
// ## Interoperability
//
// The verifying half lives in
// `projects/family-assistant/openclaw-plugin/src/bridge/token.ts`. Both sides
// assert the same golden vector (`CHILD_BRIDGE_TOKEN_GOLDEN_VECTOR` here and
// there), so a drift in claim serialization fails a test in whichever
// repository caused it rather than 401ing a child at runtime.
//
// This module must stay server-only: it imports `node:crypto` and reads the
// secret, so importing it from a client component is a build error by design.

import { createHmac } from "node:crypto";
import {
  CHILD_SESSION_SUFFIX_PATTERN,
  isChildId,
  readBridgeOrigin,
  type ChildId,
  // Explicit .ts extension: this module is loaded directly by `node --test`,
  // whose ESM resolver does not add extensions.
} from "./family-assistant-turn.ts";

/** Runtime config key holding the secret shared with the Mac mini bridge. */
export const BRIDGE_TOKEN_SECRET_ENV = "FAMILY_BRIDGE_TOKEN_SECRET";

/** Runtime config key holding the tailnet URL of the bridge. */
export const BRIDGE_URL_ENV = "FAMILY_ASSISTANT_BRIDGE_URL";

/** Token construction id. There is no negotiable algorithm field, by design. */
export const BRIDGE_TOKEN_PREFIX = "fct1";

export const BRIDGE_TOKEN_ISSUER = "companion-app";
export const BRIDGE_TOKEN_AUDIENCE = "family-child-bridge";

/**
 * Shortest usable shared secret.
 *
 * A shorter value is treated as *not configured*, so a truncated or
 * placeholder environment variable can never become a working signing key.
 */
export const BRIDGE_SECRET_MIN_CHARS = 32;

/** Lifetime requested for a minted token. The bridge clamps anything longer. */
export const BRIDGE_TOKEN_TTL_SECONDS = 600;

/** Ceiling the bridge enforces on `exp - iat`. Mirrored here for the tests. */
export const BRIDGE_TOKEN_MAX_TTL_SECONDS = 900;

/** Accepted `jti` shape. Bounded so a token id cannot pad an audit line. */
export const BRIDGE_TOKEN_JTI_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The complete, closed claim set, in canonical serialization order. */
export const BRIDGE_TOKEN_CLAIMS = ["v", "iss", "aud", "sub", "sid", "iat", "exp", "jti"] as const;

export type BridgeTokenClaims = {
  v: 1;
  iss: typeof BRIDGE_TOKEN_ISSUER;
  aud: typeof BRIDGE_TOKEN_AUDIENCE;
  sub: ChildId;
  sid: string;
  iat: number;
  exp: number;
  jti: string;
};

export type BridgeMintConfig = { secret: string; bridgeUrl: string };

export type BridgeMintConfigResolution =
  | { ok: true; config: BridgeMintConfig }
  | { ok: false; reason: "no-secret" | "no-url" | "bad-url" };

function normalizeSecret(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length >= BRIDGE_SECRET_MIN_CHARS ? trimmed : null;
}

/**
 * Resolves the bridge configuration from runtime env, or the reason it cannot.
 *
 * The URL is validated here rather than at fetch time, so a typo surfaces as a
 * clear 503 with a server-side reason instead of a browser-side network error a
 * child would see as "the assistant is broken".
 *
 * `readBridgeOrigin` is what refuses `http://` to a tailnet host: a token minted
 * against a plaintext non-loopback origin would be handed to the iPad and then
 * sent in clear. Refusing at mint time means that misconfiguration can never
 * produce a working credential at all.
 */
export function resolveBridgeMintConfig(
  env: Record<string, string | undefined> = process.env,
): BridgeMintConfigResolution {
  const secret = normalizeSecret(env[BRIDGE_TOKEN_SECRET_ENV]);
  if (!secret) return { ok: false, reason: "no-secret" };
  const rawUrl = env[BRIDGE_URL_ENV]?.trim();
  if (!rawUrl) return { ok: false, reason: "no-url" };
  const bridgeUrl = readBridgeOrigin(rawUrl);
  if (!bridgeUrl) return { ok: false, reason: "bad-url" };
  return { ok: true, config: { secret, bridgeUrl } };
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Canonical claim serialization: declared order, no whitespace. */
export function serializeBridgeClaims(claims: BridgeTokenClaims): string {
  return `{${BRIDGE_TOKEN_CLAIMS.map(
    (claim) => `${JSON.stringify(claim)}:${JSON.stringify(claims[claim])}`,
  ).join(",")}}`;
}

export class BridgeTokenMintError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "BridgeTokenMintError";
    this.reason = reason;
  }
}

export type MintBridgeTokenInput = {
  secret: string;
  childId: string;
  sessionSuffix: string;
  jti: string;
  issuedAtSeconds: number;
  ttlSeconds?: number;
};

/**
 * Mints one child-scoped bridge token.
 *
 * The caller chooses only the subject, the surface session and the id. Issuer,
 * audience, version and construction are fixed here, and the TTL is clamped
 * rather than trusted — a bug in a caller cannot produce a long-lived child
 * credential.
 */
export function mintBridgeToken(input: MintBridgeTokenInput): { token: string; claims: BridgeTokenClaims } {
  const secret = normalizeSecret(input.secret);
  if (!secret) {
    throw new BridgeTokenMintError(
      "no-secret",
      `bridge token refused: the shared secret must be at least ${BRIDGE_SECRET_MIN_CHARS} characters`,
    );
  }
  if (!isChildId(input.childId)) {
    throw new BridgeTokenMintError("bad-subject", "bridge token refused: subject must be santiago or isabel");
  }
  const sid = input.sessionSuffix.trim();
  if (!CHILD_SESSION_SUFFIX_PATTERN.test(sid)) {
    throw new BridgeTokenMintError(
      "bad-session",
      "bridge token refused: sessionSuffix must be 1-64 chars of [A-Za-z0-9._-]",
    );
  }
  if (!BRIDGE_TOKEN_JTI_PATTERN.test(input.jti)) {
    throw new BridgeTokenMintError("bad-jti", "bridge token refused: jti has an unsupported shape");
  }
  const iat = Math.floor(input.issuedAtSeconds);
  if (!Number.isSafeInteger(iat) || iat <= 0) {
    throw new BridgeTokenMintError("bad-iat", "bridge token refused: issuedAtSeconds must be a positive integer");
  }
  const ttl = Math.max(1, Math.min(Math.floor(input.ttlSeconds ?? BRIDGE_TOKEN_TTL_SECONDS), BRIDGE_TOKEN_MAX_TTL_SECONDS));

  const claims: BridgeTokenClaims = {
    v: 1,
    iss: BRIDGE_TOKEN_ISSUER,
    aud: BRIDGE_TOKEN_AUDIENCE,
    sub: input.childId,
    sid,
    iat,
    exp: iat + ttl,
    jti: input.jti,
  };
  const payload = base64url(Buffer.from(serializeBridgeClaims(claims), "utf8"));
  const signingInput = `${BRIDGE_TOKEN_PREFIX}.${payload}`;
  const signature = base64url(createHmac("sha256", secret).update(signingInput).digest());
  return { token: `${signingInput}.${signature}`, claims };
}

/**
 * Interoperability fixture, asserted identically by the bridge.
 *
 * The secret here is a test constant and authorizes nothing.
 */
export const CHILD_BRIDGE_TOKEN_GOLDEN_VECTOR = {
  secret: "family-child-bridge-golden-vector-secret-0001",
  childId: "santiago",
  sessionSuffix: "ipad",
  jti: "golden-0001",
  issuedAtSeconds: 1_770_000_000,
  ttlSeconds: 600,
  serializedClaims:
    '{"v":1,"iss":"companion-app","aud":"family-child-bridge","sub":"santiago","sid":"ipad","iat":1770000000,"exp":1770000600,"jti":"golden-0001"}',
  token:
    "fct1.eyJ2IjoxLCJpc3MiOiJjb21wYW5pb24tYXBwIiwiYXVkIjoiZmFtaWx5LWNoaWxkLWJyaWRnZSIsInN1YiI6InNhbnRpYWdvIiwic2lkIjoiaXBhZCIsImlhdCI6MTc3MDAwMDAwMCwiZXhwIjoxNzcwMDAwNjAwLCJqdGkiOiJnb2xkZW4tMDAwMSJ9.ST0qb3Bqjai4ZAV0V0tplcyYMiBseiv0_GMjf-l2Zfk",
} as const;

/** Shape returned by `POST /api/family/assistant/session`. */
export type ChildBridgeSession = {
  child: ChildId;
  sessionSuffix: string;
  token: string;
  /** Epoch milliseconds. The client re-mints shortly before this. */
  expiresAt: number;
  /** Absolute origin of the tailnet bridge. */
  bridgeUrl: string;
};

/**
 * Builds the session payload the iPad receives.
 *
 * Note what is absent and must stay absent: the shared secret, the Gateway URL,
 * the Gateway bearer, the agent's model, and any workspace path. The browser
 * gets a subject, a session name, a minutes-long token and a URL.
 */
export function buildChildBridgeSession(params: {
  config: BridgeMintConfig;
  childId: string;
  sessionSuffix: string;
  jti: string;
  nowMs: number;
}): ChildBridgeSession {
  const { token, claims } = mintBridgeToken({
    secret: params.config.secret,
    childId: params.childId,
    sessionSuffix: params.sessionSuffix,
    jti: params.jti,
    issuedAtSeconds: Math.floor(params.nowMs / 1000),
    ttlSeconds: BRIDGE_TOKEN_TTL_SECONDS,
  });
  return {
    child: claims.sub,
    sessionSuffix: claims.sid,
    token,
    expiresAt: claims.exp * 1000,
    bridgeUrl: params.config.bridgeUrl,
  };
}
