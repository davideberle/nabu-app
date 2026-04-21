import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getTodaySession,
  updateSessionStep,
  completeSession,
} from "@/lib/cooking";

/**
 * GET /api/cooking?date=2026-04-21
 * Returns today's cooking session (or null).
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  const session = await getTodaySession(date);
  return NextResponse.json({ session });
}

/**
 * PATCH /api/cooking
 * Body: { id, currentStep } or { id, status: "completed" }
 * Updates step pointer or marks session completed.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (body.status === "completed") {
    await completeSession(body.id);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.currentStep === "number") {
    await updateSessionStep(body.id, body.currentStep);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Provide currentStep (number) or status: 'completed'" },
    { status: 400 }
  );
}
