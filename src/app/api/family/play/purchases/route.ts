import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireChildGames } from "@/lib/family-games-auth";
import { purchasePlayBlock } from "@/lib/family-play-db";
import { isValidIdempotencyKey } from "@/lib/family-play";

/**
 * POST /api/family/play/purchases
 * Body: `{ idempotencyKey }` — one block (3 coins → 15 active minutes) for the
 * child named by the verified bearer. The debit and the grant are one
 * transaction; a retry with the same key replays the committed purchase and
 * never charges twice; insufficient funds commit nothing (GP-02).
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
    const outcome = await purchasePlayBlock({ personId: authz.child, idempotencyKey: key, purchaseId: randomUUID(), redemptionId: randomUUID() });
    if (outcome.ok) return NextResponse.json({ ...outcome, child: authz.child }, { status: outcome.replayed ? 200 : 201, headers: NO_STORE });
    if (outcome.reason === "insufficient-funds") return NextResponse.json({ error: "Not enough coins", ...outcome, child: authz.child }, { status: 409, headers: NO_STORE });
    // `conflict`: the identical key committed concurrently — the second pass replays it.
  }
  return refuse(409, "Purchase conflict — please try again");
}
