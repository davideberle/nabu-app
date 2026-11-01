import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireChildGames } from "@/lib/family-games-auth";
import { purchasePlayBlock } from "@/lib/family-play-db";
import { isValidIdempotencyKey } from "@/lib/family-play";

/**
 * POST /api/family/play/chess-purchases
 * Body: `{ idempotencyKey }` — one chess block (1 coin → 15 active minutes of
 * digital chess only, November 1, 2026) for the child named by the verified
 * bearer, from the permanent wallet; no activity requirement. Same contract
 * as the Studio block route beside it: debit and grant are one transaction, a
 * retry with the same key replays without a second charge, insufficient funds
 * commit nothing. A separate path (not a body flag) so a server without the
 * chess price answers 404 instead of selling a 3-coin Studio block.
 */
export async function POST(request: Request) {
  const authz = await requireChildGames(request);
  if (!authz.ok) return authz.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  const key = typeof body === "object" && body !== null ? (body as { idempotencyKey?: unknown }).idempotencyKey : undefined;
  if (!isValidIdempotencyKey(key)) return refuse(400, "idempotencyKey required");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await purchasePlayBlock({ personId: authz.child, idempotencyKey: key, purchaseId: randomUUID(), redemptionId: randomUUID(), budgetKind: "chess" });
    if (outcome.ok) return NextResponse.json({ ...outcome, child: authz.child }, { status: outcome.replayed ? 200 : 201, headers: NO_STORE });
    if (outcome.reason === "insufficient-funds") return NextResponse.json({ error: "Not enough coins", ...outcome, child: authz.child }, { status: 409, headers: NO_STORE });
    // `conflict`: the identical key committed concurrently — the second pass replays it.
  }
  return refuse(409, "Purchase conflict — please try again");
}
