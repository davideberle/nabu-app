import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSessionFromPlan } from "@/lib/cooking";

// POST /api/cooking/session/from-plan
// Creates a cooking session from a day's planned meal (if one exists).
// Body: { date?: string } — defaults to today.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const date: string =
      (body as { date?: string }).date ||
      new Date().toISOString().split("T")[0];

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
