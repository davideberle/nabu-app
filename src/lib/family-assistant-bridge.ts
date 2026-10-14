// Non-AI media session minting. The fcm1/family-child-media wire cannot
// authorize the retired child-turn bridge. Historical reply receipt verification
// below is retained solely to validate already stored learning evidence.

import { createHmac, timingSafeEqual } from "node:crypto";
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
export const BRIDGE_TOKEN_PREFIX = "fcm1";

export const BRIDGE_TOKEN_ISSUER = "companion-app";
export const BRIDGE_TOKEN_AUDIENCE = "family-child-media";

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
  sessionSuffix: "listening",
  jti: "golden-0001",
  issuedAtSeconds: 1_770_000_000,
  ttlSeconds: 600,
  serializedClaims:
    '{"v":1,"iss":"companion-app","aud":"family-child-media","sub":"santiago","sid":"listening","iat":1770000000,"exp":1770000600,"jti":"golden-0001"}',
  token:
    "fcm1.eyJ2IjoxLCJpc3MiOiJjb21wYW5pb24tYXBwIiwiYXVkIjoiZmFtaWx5LWNoaWxkLW1lZGlhIiwic3ViIjoic2FudGlhZ28iLCJzaWQiOiJsaXN0ZW5pbmciLCJpYXQiOjE3NzAwMDAwMDAsImV4cCI6MTc3MDAwMDYwMCwianRpIjoiZ29sZGVuLTAwMDEifQ.4c1mcB73KOqJWSyNhs8o7DeZHofzsJ5nnFRgLMI6Vfo",
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

// ---------------------------------------------------------------------------
// Bridge response receipts (repair round 2, IV5-03)
//
// The browser is the only party that talks to the bridge, so a reply it posts
// back to the learning routes could be authored by the browser itself. The
// bridge therefore signs every child-turn reply with the SAME shared secret it
// already verifies session tokens with (no new secret, no new privilege):
//
//   fcr1.<payload>.<sig>   payload = base64url(canonical JSON of the claims)
//                          sig     = base64url(HMAC-SHA256(secret, "fcr1.<payload>"))
//   claims (declared order): v=1, iss="family-child-bridge", sub=<child>, sid=<session suffix>,
//                            key=<the request's idempotencyKey>, req=sha256hex(message),
//                            res=sha256hex(text blocks joined by "\n\n"), iat=<epoch seconds>
//
// This module only VERIFIES; nothing here can mint a receipt. The learning
// state machine then checks the binding (key = its turn id, req = its stored
// dispatch hash, res = the posted text, sub = the authenticated child). Until
// the bridge signs (a separately authorized bridge change + LaunchAgent
// restart), replies arrive without a receipt and are treated as UNVERIFIED
// origin: shown, recorded, never authority for a learning verdict.
// ---------------------------------------------------------------------------

export const BRIDGE_RECEIPT_PREFIX = "fcr1";
export const BRIDGE_RECEIPT_ISSUER = "family-child-bridge";
export const BRIDGE_RECEIPT_CLAIMS = ["v", "iss", "sub", "sid", "key", "req", "res", "iat"] as const;
/** Receipt v2 (repair round 5, R4-06): the same claims plus the AUTHENTICATED run metadata the executor reported — `mdl` = "<provider>/<model>" or "unknown", `run` = the run id or "unknown". Never a configured default. */
export const BRIDGE_RECEIPT_CLAIMS_V2 = ["v", "iss", "sub", "sid", "key", "req", "res", "iat", "mdl", "run"] as const;
export const BRIDGE_RECEIPT_UNKNOWN = "unknown";
/** A receipt older than this is not accepted (the learning turn is minutes, never hours). */
export const BRIDGE_RECEIPT_MAX_AGE_SECONDS = 15 * 60;

export type BridgeReceiptClaims = { v: 1; iss: string; sub: ChildId; sid: string; key: string; req: string; res: string; iat: number } | { v: 2; iss: string; sub: ChildId; sid: string; key: string; req: string; res: string; iat: number; mdl: string; run: string };

export type BridgeReceiptVerification =
  | { ok: true; claims: BridgeReceiptClaims }
  | { ok: false; reason: "malformed" | "bad-signature" | "bad-claims" | "expired" | "future" };

/** Canonical claim serialization: declared order, no whitespace (the bridge must serialize identically). */
export function serializeBridgeReceiptClaims(claims: BridgeReceiptClaims): string {
  const keys: readonly string[] = claims.v === 2 ? BRIDGE_RECEIPT_CLAIMS_V2 : BRIDGE_RECEIPT_CLAIMS;
  const record = claims as unknown as Record<string, unknown>;
  return `{${keys.map((claim) => `${JSON.stringify(claim)}:${JSON.stringify(record[claim])}`).join(",")}}`;
}

/** The authenticated run metadata of a verified receipt, or null when the receipt (v1) carries none. "unknown" values are kept as reported. */
export function receiptProvenance(claims: BridgeReceiptClaims): { model: string; runId: string } | null {
  return claims.v === 2 ? { model: claims.mdl, runId: claims.run } : null;
}

function decodeBase64url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
}

/** Verify a receipt's signature and claim shape. Pure apart from the clock. The caller checks the binding. */
export function verifyBridgeReceipt(receipt: unknown, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): BridgeReceiptVerification {
  if (typeof receipt !== "string" || receipt.length > 2048) return { ok: false, reason: "malformed" };
  const parts = receipt.split(".");
  if (parts.length !== 3 || parts[0] !== BRIDGE_RECEIPT_PREFIX || !parts[1] || !parts[2]) return { ok: false, reason: "malformed" };
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = base64url(createHmac("sha256", secret).update(signingInput).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  const raw = decodeBase64url(parts[1]);
  if (!raw) return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "bad-claims" };
  const c = parsed as Record<string, unknown>;
  if ((c.v !== 1 && c.v !== 2) || c.iss !== BRIDGE_RECEIPT_ISSUER || !isChildId(c.sub) || typeof c.sid !== "string" || !CHILD_SESSION_SUFFIX_PATTERN.test(c.sid)) return { ok: false, reason: "bad-claims" };
  if (typeof c.key !== "string" || !c.key || c.key.length > 128 || typeof c.req !== "string" || !/^[0-9a-f]{64}$/.test(c.req) || typeof c.res !== "string" || !/^[0-9a-f]{64}$/.test(c.res)) return { ok: false, reason: "bad-claims" };
  if (typeof c.iat !== "number" || !Number.isInteger(c.iat)) return { ok: false, reason: "bad-claims" };
  let claims: BridgeReceiptClaims;
  if (c.v === 2) {
    if (typeof c.mdl !== "string" || !c.mdl || c.mdl.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(c.mdl) || typeof c.run !== "string" || !c.run || c.run.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(c.run)) return { ok: false, reason: "bad-claims" };
    claims = { v: 2, iss: BRIDGE_RECEIPT_ISSUER, sub: c.sub, sid: c.sid, key: c.key, req: c.req, res: c.res, iat: c.iat, mdl: c.mdl, run: c.run };
  } else claims = { v: 1, iss: BRIDGE_RECEIPT_ISSUER, sub: c.sub, sid: c.sid, key: c.key, req: c.req, res: c.res, iat: c.iat };
  // The serialization must round-trip exactly: a receipt with extra or reordered claims is not the bridge's.
  if (serializeBridgeReceiptClaims(claims) !== raw.toString("utf8")) return { ok: false, reason: "bad-claims" };
  if (claims.iat > nowSeconds + 60) return { ok: false, reason: "future" };
  if (nowSeconds - claims.iat > BRIDGE_RECEIPT_MAX_AGE_SECONDS) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
