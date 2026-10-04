// ---------------------------------------------------------------------------
// Route guards for the approved-game library and paid play. Server-only.
//
//   requireChildGames(request) → the child from a verified `family-games`
//                                bearer plus the household session, or a
//                                refusal. Neither body nor query child ids
//                                are ever consulted (GP-08).
//   requireStudioSettlement()  → verifies the shared-secret signature on a
//                                settlement report from the Game Studio meter.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { ChildId } from "./family-assistant-turn";
import {
  SETTLEMENT_SIGNATURE_HEADER,
  SETTLEMENT_TIMESTAMP_HEADER,
  deriveGamesKey,
  derivePlayKey,
  readBearer,
  verifyChildGamesToken,
  verifySettlementSignature,
} from "./family-games-token";

export const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export function refuse(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

export type ChildGamesAuth = { ok: true; child: ChildId; jti: string } | { ok: false; response: NextResponse };

export async function requireChildGames(request: Request): Promise<ChildGamesAuth> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: refuse(401, "Unauthorized") };
  const key = deriveGamesKey();
  if (!key) return { ok: false, response: refuse(503, "Games are not configured on this server") };
  const bearer = readBearer(request.headers.get("authorization"));
  if (!bearer) return { ok: false, response: refuse(401, "Missing games credential") };
  const verified = verifyChildGamesToken(key, bearer, Math.floor(Date.now() / 1000));
  if (!verified.ok) {
    return { ok: false, response: refuse(401, verified.reason === "expired" ? "Games credential expired" : "Invalid games credential", { reason: verified.reason }) };
  }
  return { ok: true, child: verified.claims.sub, jti: verified.claims.jti };
}

export type SettlementAuth = { ok: true; rawBody: string } | { ok: false; response: NextResponse };

/** No session: the Game Studio meter is a server, authenticated by signature alone. */
export async function requireStudioSettlement(request: Request): Promise<SettlementAuth> {
  const key = derivePlayKey();
  if (!key) return { ok: false, response: refuse(503, "Play settlement is not configured on this server") };
  const rawBody = await request.text();
  if (rawBody.length > 4096) return { ok: false, response: refuse(413, "Settlement too large") };
  const verified = verifySettlementSignature(
    key,
    request.headers.get(SETTLEMENT_SIGNATURE_HEADER),
    request.headers.get(SETTLEMENT_TIMESTAMP_HEADER),
    rawBody,
    Math.floor(Date.now() / 1000),
  );
  if (!verified.ok) return { ok: false, response: refuse(401, "Invalid settlement signature", { reason: verified.reason }) };
  return { ok: true, rawBody };
}
