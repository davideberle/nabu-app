import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getCookingSessionForDate,
  saveCookingSession,
} from "@/lib/cooking";
import type { CookingSession } from "@/lib/cooking";

// GET /api/cooking/session?date=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json(
      { error: "Missing date query param" },
      { status: 400 }
    );
  }
  try {
    const session = await getCookingSessionForDate(date);
    return NextResponse.json(session);
  } catch {
    return NextResponse.json(
      { error: "Failed to load cooking session" },
      { status: 500 }
    );
  }
}

// POST /api/cooking/session — create or update a session
export async function POST(request: NextRequest) {
  try {
    const session = (await request.json()) as CookingSession;
    if (!session.id || !session.date || !session.anchor) {
      return NextResponse.json(
        { error: "Invalid session data: id, date, and anchor are required" },
        { status: 400 }
      );
    }
    await saveCookingSession(session);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save cooking session" },
      { status: 500 }
    );
  }
}
