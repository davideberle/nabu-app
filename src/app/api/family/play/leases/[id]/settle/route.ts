import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireStudioSettlement } from "@/lib/family-games-auth";
import { settlePlayLease } from "@/lib/family-play-db";
import { isValidLeaseId } from "@/lib/family-play";

/**
 * POST /api/family/play/leases/:id/settle — the Game Studio meter reports the
 * measured consumption of one lease. Authenticated by the shared-secret
 * signature over the raw body, never by a browser session. Monotonic and
 * bounded; `end: true` closes the lease (GP-05/GP-07).
 * Body: `{ consumedSeconds, end, endReason? }`
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authz = await requireStudioSettlement(request);
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  if (!isValidLeaseId(id)) return refuse(400, "Invalid lease id");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(authz.rawBody) as Record<string, unknown>;
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (typeof body.consumedSeconds !== "number" || !Number.isFinite(body.consumedSeconds) || body.consumedSeconds < 0) return refuse(400, "consumedSeconds required");
  const end = body.end === true;
  const endReason = typeof body.endReason === "string" ? body.endReason.slice(0, 60) : null;
  const outcome = await settlePlayLease({ leaseId: id, consumedSeconds: body.consumedSeconds, end, endReason });
  if (!outcome.ok) return refuse(outcome.reason === "not-found" ? 404 : 410, outcome.reason);
  return NextResponse.json(outcome, { headers: NO_STORE });
}
