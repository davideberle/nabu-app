// ---------------------------------------------------------------------------
// The release key (David, 2026-11-09): lets the release job read the learning
// records and run the narration recording server to server, without an owner
// browser session. It opens exactly the routes in RELEASE_KEY_ROUTES, by
// `Authorization: Bearer` only; there is no CORS and no other way to present it.
//
// `FAMILY_RELEASE_TOKEN` unset (or too short to be a real key) → the key does
// not exist and these routes are owner-session only, exactly as before.
// To revoke: delete the variable in Vercel and redeploy.
// ---------------------------------------------------------------------------

import { createHash, timingSafeEqual } from "node:crypto";
import { readBearer } from "./family-learning-token.ts";

export const RELEASE_TOKEN_ENV = "FAMILY_RELEASE_TOKEN";

/** The only routes the key opens: route id → method + path. */
export const RELEASE_KEY_ROUTES = {
  "records-snapshot": { method: "GET", path: "/api/family/learning/parent/release-snapshot" },
  "narration-recording": { method: "POST", path: "/api/family/learning/parent/narration" },
} as const;
export type ReleaseKeyRoute = keyof typeof RELEASE_KEY_ROUTES;

const MIN_TOKEN_LENGTH = 32;
export const RELEASE_KEY_LIMIT = 12;
export const RELEASE_KEY_WINDOW_MS = 60_000;

type Env = Record<string, string | undefined>;
type OwnerOutcome = { ok: true } | { ok: false; status: number; error: string };
export type ReleaseKeyOutcome = { ok: true; via: "owner" | "release-key" } | { ok: false; status: number; error: string; ownerRefused?: true };

function configuredToken(env: Env): string | null {
  const value = (env[RELEASE_TOKEN_ENV] ?? "").trim();
  return value.length >= MIN_TOKEN_LENGTH ? value : null;
}

/** Constant-time: both sides are hashed first, so neither the content nor the length of the key can be timed. */
export function releaseTokenMatches(presented: string, configured: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(configured));
}

// Per route and per server instance: a brake on guessing and on a runaway job, not a global quota.
const uses = new Map<ReleaseKeyRoute, number[]>();
export function resetReleaseKeyLimit(): void {
  uses.clear();
}
function overLimit(route: ReleaseKeyRoute, now: number): boolean {
  const recent = (uses.get(route) ?? []).filter((at) => now - at < RELEASE_KEY_WINDOW_MS);
  const over = recent.length >= RELEASE_KEY_LIMIT;
  if (!over) recent.push(now);
  uses.set(route, recent);
  return over;
}

/**
 * The guard of the two key routes. A request without a bearer, or any request while the key is unset, goes to the owner guard
 * unchanged. A presented bearer is decided here alone: a wrong key is refused even if an owner session came with it.
 * The audit line names the route, the time and the result, never the token.
 */
export async function guardWithReleaseKey(input: { authorization: string | null; route: ReleaseKeyRoute; owner: () => Promise<OwnerOutcome>; env?: Env; now?: () => number; log?: (line: string) => void }): Promise<ReleaseKeyOutcome> {
  const env = input.env ?? process.env;
  const configured = configuredToken(env);
  const presented = readBearer(input.authorization);
  if (!configured || !presented) {
    const owner = await input.owner();
    return owner.ok ? { ok: true, via: "owner" } : { ok: false, status: owner.status, error: owner.error, ownerRefused: true };
  }
  const now = (input.now ?? Date.now)();
  const audit = (result: string) => (input.log ?? console.info)(`[family/learning/release-key] route=${input.route} at=${new Date(now).toISOString()} result=${result}`);
  if (overLimit(input.route, now)) {
    audit("rate-limited");
    return { ok: false, status: 429, error: "Too many requests" };
  }
  if (!releaseTokenMatches(presented, configured)) {
    audit("refused");
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  audit("allowed");
  return { ok: true, via: "release-key" };
}
