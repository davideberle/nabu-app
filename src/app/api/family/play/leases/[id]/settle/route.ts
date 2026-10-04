import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireStudioSettlement } from "@/lib/family-games-auth";
import { settlePlayLease } from "@/lib/family-play-db";
import { isValidLeaseId } from "@/lib/family-play";

/**
 * POST /api/family/play/leases/:id/settle — the Game Studio meter reports the
 * measured consumption of one lease. Authenticated by the shared-secret
 * signature over the raw body, never by a browser session. Monotonic and
 * bounded; `end: true` closes the lease (GP-05/GP-07).
 * Body: `{ leaseId, consumedSeconds, end, endReason?, seq?, measuredAt? }` — `leaseId` must equal the URL id;
 * `measuredAt` (ms, the meter's own reading time) moves the measurement watermark, arrival time never does.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidLeaseId(id)) return refuse(400, "Invalid lease id");
  const authz = await requireStudioSettlement(request, id);
  if (!authz.ok) return authz.response;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(authz.rawBody) as Record<string, unknown>;
  } catch {
    return refuse(400, "Body must be JSON");
  }
  // The report names its lease too; a mismatch with the signed URL id is refused.
  if (body.leaseId !== id) return refuse(400, "leaseId in the report must match the lease URL");
  if (typeof body.consumedSeconds !== "number" || !Number.isFinite(body.consumedSeconds) || body.consumedSeconds < 0) return refuse(400, "consumedSeconds required");
  const end = body.end === true;
  const endReason = typeof body.endReason === "string" ? body.endReason.slice(0, 60) : null;
  const measuredAt = typeof body.measuredAt === "number" && Number.isFinite(body.measuredAt) ? body.measuredAt : null;
  const outcome = await settlePlayLease({ leaseId: id, consumedSeconds: body.consumedSeconds, end, endReason, measuredAt });
  if (!outcome.ok) return refuse(404, outcome.reason);
  return NextResponse.json(outcome, { headers: NO_STORE });
}
