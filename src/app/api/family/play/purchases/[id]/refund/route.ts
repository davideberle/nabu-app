import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { NO_STORE, refuse } from "@/lib/family-games-auth";
import { refundPlayPurchase } from "@/lib/family-play-db";

/**
 * POST /api/family/play/purchases/:id/refund — parent-only compensation
 * (GP-07): refunds one committed block exactly once. Body: `{ reason }`.
 * Middleware already refuses tracker-only sessions on this admin-only route.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return refuse(401, "Unauthorized");
  if (!isAdminEmail(session.user.email)) return refuse(403, "Forbidden");
  const { id } = await context.params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(id)) return refuse(400, "Invalid purchase id");
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* reason optional */
  }
  const reason = typeof body === "object" && body !== null && typeof (body as { reason?: unknown }).reason === "string" ? (body as { reason: string }).reason.slice(0, 200) : "parent refund";
  const outcome = await refundPlayPurchase({ purchaseId: id, reason });
  if (!outcome.ok) return refuse(outcome.reason === "not-found" ? 404 : 409, outcome.reason);
  return NextResponse.json(outcome, { headers: NO_STORE });
}
