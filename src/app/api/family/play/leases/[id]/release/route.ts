import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireChildGames } from "@/lib/family-games-auth";
import { endPlayLease } from "@/lib/family-play-db";
import { isValidLeaseId } from "@/lib/family-play";

/** POST /api/family/play/leases/:id/release — the child ends their own lease (leaving, switching profile, entering Edit). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authz = await requireChildGames(request);
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  if (!isValidLeaseId(id)) return refuse(400, "Invalid lease id");
  let reason = "released";
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === "string") reason = body.reason.slice(0, 60);
  } catch {
    /* reason optional */
  }
  const ended = await endPlayLease({ leaseId: id, personId: authz.child, reason });
  return NextResponse.json({ ok: true, ended }, { headers: NO_STORE });
}
