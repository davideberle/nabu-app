import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getSessionById,
  updateSessionStep,
  updateSessionTonight,
  updateSessionFeedback,
  completeSession,
} from "@/lib/cooking";
import type { CookingFeedback, TonightPlan } from "@/lib/cooking";

/**
 * GET /api/cooking/session/:id
 * Returns a single cooking session by id.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionById(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(session);
}

/**
 * PATCH /api/cooking/session/:id
 * Partial update for a live cooking session.
 *
 * Accepted body fields (apply one at a time):
 *   { currentStep: number }
 *   { status: "completed" }
 *   { tonight: TonightPlan | null }
 *   { feedback: CookingFeedback }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSessionById(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await request.json();

  if (body.status === "completed") {
    await completeSession(id);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.currentStep === "number") {
    await updateSessionStep(id, body.currentStep);
    return NextResponse.json({ ok: true });
  }

  if ("tonight" in body) {
    await updateSessionTonight(id, (body.tonight as TonightPlan) ?? null);
    return NextResponse.json({ ok: true });
  }

  if ("feedback" in body && body.feedback) {
    const fb = body.feedback as CookingFeedback;
    await updateSessionFeedback(id, {
      verdict: fb.verdict,
      wouldCookAgain: fb.wouldCookAgain,
      ...(fb.notes ? { notes: fb.notes } : {}),
      ...(fb.keepForNextTime?.length
        ? { keepForNextTime: fb.keepForNextTime }
        : {}),
      ...(fb.changeNextTime?.length
        ? { changeNextTime: fb.changeNextTime }
        : {}),
      capturedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Provide currentStep, status, tonight, or feedback" },
    { status: 400 }
  );
}
