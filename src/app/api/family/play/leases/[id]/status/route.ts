import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireStudioSettlement } from "@/lib/family-games-auth";
import { getLeaseStatus, recordLeaseActivation } from "@/lib/family-play-db";
import { isValidLeaseId } from "@/lib/family-play";

/**
 * GET /api/family/play/leases/:id/status — the authoritative lease state for
 * the Game Studio meter, authenticated by the shared-secret signature bound
 * to this lease id (empty body). The adapter calls it before it activates a
 * lease credential it has never seen, and when a lease resumes after a long
 * gap, so an old issued-but-unused credential or a lease Family has since
 * ended/replaced can never start or displace play (GP-03/GP-08).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidLeaseId(id)) return refuse(400, "Invalid lease id");
  const authz = await requireStudioSettlement(request, id);
  if (!authz.ok) return authz.response;
  await recordLeaseActivation(id);
  const status = await getLeaseStatus(id);
  if (!status) return refuse(404, "not-found");
  return NextResponse.json(status, { headers: NO_STORE });
}
