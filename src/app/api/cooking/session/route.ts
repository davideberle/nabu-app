import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getCookingSessionForDate,
  saveCookingSession,
  withSessionCoherence,
} from "@/lib/cooking";
import type { CookingSession } from "@/lib/cooking";

/**
 * GET /api/cooking/session?date=YYYY-MM-DD
 *
 * Returns the stored session with one extra top-level property, `coherence`:
 * the derived whole-meal review (live-cooking DESIGN.md §3 rule 16). Every
 * existing session field keeps its shape and meaning, so clients that ignore
 * `coherence` are unaffected. The review is derived per request and never
 * persisted — POST strips it back out if a client returns it.
 */
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
    if (!session) return NextResponse.json(null);
    return NextResponse.json(await withSessionCoherence(session));
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
    const body = (await request.json()) as CookingSession & {
      coherence?: unknown;
    };
    if (!body.id || !body.date || !body.anchor) {
      return NextResponse.json(
        { error: "Invalid session data: id, date, and anchor are required" },
        { status: 400 }
      );
    }
    // The review GET adds is derived, never stored. A client that round-trips
    // a GET response must not persist it into the session row.
    const session: CookingSession = { ...body };
    delete (session as { coherence?: unknown }).coherence;
    await saveCookingSession(session);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save cooking session" },
      { status: 500 }
    );
  }
}
