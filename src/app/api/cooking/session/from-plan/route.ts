import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardRuntimeWrite } from "@/lib/api-guards";
import { createSessionFromPlan } from "@/lib/cooking";
import { todayInZurich } from "@/lib/date";

// POST /api/cooking/session/from-plan
// Creates a cooking session from a day's planned meal (if one exists).
// Body: { date?: string } — defaults to today.
//
// This persists a session row, so it carries the same gate as the other
// session writes: authorized household session or trusted-runtime token.
export async function POST(request: NextRequest) {
  const guard = await guardRuntimeWrite(request);
  if (guard.response) return guard.response;

  try {
    const body = await request.json().catch(() => ({}));
    const date: string =
      (body as { date?: string }).date ||
      todayInZurich();

    const session = await createSessionFromPlan(date);
    if (!session) {
      return NextResponse.json(
        { error: "No planned meal found for this date" },
        { status: 404 }
      );
    }

    return NextResponse.json(session, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create session from plan" },
      { status: 500 }
    );
  }
}
