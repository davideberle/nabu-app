// ---------------------------------------------------------------------------
// Route guards for the learning cockpit (DESIGN §7.6, account rule settled by
// David on 2026-09-29). Server-only.
//
//   requireChildLearning(request)  → the child from a verified learning
//                                    credential, or a refusal response.
//   requireParentOwner()           → the exact authenticated owner identity
//                                    (info@davideberle.com) from the NextAuth
//                                    session, or a refusal response.
//
// Account rule: `assistant@davideberle.com` (the shared child device) sees
// child views only; `info@davideberle.com` sees child views and the parent
// learning views. Parent access is the authenticated owner session itself —
// there is no unlock, cookie, challenge, one-time code or re-authentication
// step, and none is honoured if a stale one is presented. Anonymous callers,
// the assistant account, any other account, child learning credentials and
// bridge tokens never reach a parent page or API. The session ends by normal
// NextAuth expiry or sign-out.
//
// Neither guard reads a child id or an identity from the body or the query.
// Parent *reads* go through the same guard as writes.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { evaluateParentLearningAccess } from "./access";
import type { ChildId } from "./family-assistant-turn";
import { deriveLearningKey, readBearer, verifyChildLearningToken } from "./family-learning-token";

/** Every learning response carries child or family data; never cache it. */
export const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export function refuse(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

export type ChildLearningAuth = { ok: true; child: ChildId; jti: string } | { ok: false; response: NextResponse };

/**
 * A learning route is reachable by an authenticated household session (the
 * shared child device's assistant account or the owner) that presents a
 * learning bearer. The session proves "someone in the household"; the bearer
 * proves "for exactly this child", because the mint route bound it
 * server-side. Both are required. A bearer with any other audience (e.g. the
 * bridge token) fails verification.
 */
export async function requireChildLearning(request: Request): Promise<ChildLearningAuth> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: refuse(401, "Unauthorized") };
  const key = deriveLearningKey();
  if (!key) return { ok: false, response: refuse(503, "Learning is not configured on this server") };
  const bearer = readBearer(request.headers.get("authorization"));
  if (!bearer) return { ok: false, response: refuse(401, "Missing learning credential") };
  const verified = verifyChildLearningToken(key, bearer, Math.floor(Date.now() / 1000));
  if (!verified.ok) {
    return { ok: false, response: refuse(401, verified.reason === "expired" ? "Learning credential expired" : "Invalid learning credential", { reason: verified.reason }) };
  }
  return { ok: true, child: verified.claims.sub, jti: verified.claims.jti };
}

export type ParentAuth = { ok: true; adminEmail: string } | { ok: false; response: NextResponse; state: "unauthenticated" | "forbidden" };

/**
 * The exact owner identity from the server-side session — decided by
 * `evaluateParentLearningAccess` (one definition, shared with the tests), so a
 * forged or client-supplied identity has no path in. Nothing else (cookies,
 * headers, bearers) is consulted.
 */
export async function requireParentOwner(): Promise<ParentAuth> {
  const session = await auth();
  const decision = evaluateParentLearningAccess(session);
  if (!decision.allowed) {
    return {
      ok: false,
      state: decision.status === 401 ? "unauthenticated" : "forbidden",
      response: refuse(decision.status, decision.error),
    };
  }
  return { ok: true, adminEmail: decision.adminEmail };
}
