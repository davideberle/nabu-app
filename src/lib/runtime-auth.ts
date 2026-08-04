// Trusted-runtime authorization for domain mutations that a non-browser
// runtime must also be able to perform (Telegram live-cooking writes and
// recipe-image maintenance).
//
// Kitchen DESIGN.md §"Phase 4C — Kitchen closeout" decides the policy: a
// mutation is accepted from *either* the canonical authorized household
// Companion App session *or* one fail-closed trusted-runtime bearer token.
// This module owns only the decision; `./access.ts` still owns the session
// half of it, so there is exactly one place that says what an authorized
// household session is.
//
// Three properties this module exists to guarantee:
//
// 1. Fail closed. The token comes from runtime config only. When the server
//    has no configured token, *no* bearer credential can authorize anything —
//    a request carrying one falls back to the ordinary session rules.
// 2. No length or content leak. Comparison runs over SHA-256 digests with
//    `timingSafeEqual`, so it is constant-time and length-independent.
// 3. Nothing here reads or logs the token value. Callers pass the raw
//    Authorization header; the token never appears in a response or an error.

import { createHash, timingSafeEqual } from "node:crypto";
import {
  evaluatePlannerWriteAccess,
  type PlannerWriteSession,
  // Explicit .ts extension: this module is loaded directly by `node --test`,
  // whose ESM resolver does not add extensions.
} from "./access.ts";

/** Runtime config key holding the trusted-runtime bearer token. */
export const TRUSTED_RUNTIME_TOKEN_ENV = "TRUSTED_RUNTIME_TOKEN";

/**
 * Shortest value accepted as a configured token. A truncated, placeholder, or
 * accidentally-blank environment value must not become a working credential,
 * so anything shorter is treated as "not configured" — which fails closed.
 */
export const MIN_TRUSTED_RUNTIME_TOKEN_LENGTH = 20;

export type RuntimeWriteAccess =
  | { allowed: true; via: "session" | "trusted-runtime" }
  | { allowed: false; status: 401 | 403; error: "Unauthorized" | "Forbidden" };

/**
 * The configured server-side token, or null when the server has none.
 *
 * Returning null is the fail-closed state: `evaluateRuntimeWriteAccess` then
 * has nothing to match against and every bearer credential is ignored.
 */
export function getTrustedRuntimeToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return normalizeConfiguredToken(env[TRUSTED_RUNTIME_TOKEN_ENV]);
}

/**
 * A configured value is only a usable credential once it survives trimming and
 * the minimum-length floor. Applied to every source — environment or explicit
 * override — so no path can enable a blank or placeholder token.
 */
function normalizeConfiguredToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length >= MIN_TRUSTED_RUNTIME_TOKEN_LENGTH ? trimmed : null;
}

/**
 * The credential from an `Authorization: Bearer <token>` header, or null.
 * The scheme is matched case-insensitively; the token itself is not touched
 * beyond trimming surrounding whitespace.
 */
export function extractBearerToken(
  header: string | null | undefined,
): string | null {
  if (typeof header !== "string") return null;
  const match = header.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Constant-time credential comparison.
 *
 * Both sides are hashed first so the buffers are always 32 bytes: that keeps
 * `timingSafeEqual` from throwing on a length mismatch *and* stops the
 * comparison from revealing the configured token's length.
 */
export function tokensMatch(
  presented: string | null | undefined,
  configured: string | null | undefined,
): boolean {
  if (!presented || !configured) return false;
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Canonical decision for a mutation that both the browser and a trusted local
 * runtime may perform.
 *
 * - a valid trusted-runtime bearer token succeeds outright;
 * - otherwise the ordinary session rules apply, so anonymous requests get 401
 *   and tracker-only (shared iPad) accounts get 403;
 * - an invalid or unmatched bearer token grants nothing on its own — it simply
 *   leaves the session rules to decide, which is what makes a missing server
 *   token safe.
 */
export function evaluateRuntimeWriteAccess(
  session: PlannerWriteSession,
  authorizationHeader: string | null | undefined,
  options: { token?: string | null; env?: Record<string, string | undefined> } = {},
): RuntimeWriteAccess {
  const configured = normalizeConfiguredToken(
    options.token !== undefined ? options.token : getTrustedRuntimeToken(options.env),
  );

  if (configured && tokensMatch(extractBearerToken(authorizationHeader), configured)) {
    return { allowed: true, via: "trusted-runtime" };
  }

  const sessionAccess = evaluatePlannerWriteAccess(session);
  return sessionAccess.allowed ? { allowed: true, via: "session" } : sessionAccess;
}
