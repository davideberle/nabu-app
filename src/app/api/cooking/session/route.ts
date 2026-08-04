import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardRuntimeWrite } from "@/lib/api-guards";
import {
  getCookingSessionForDate,
  saveCookingSession,
  validateSessionBody,
  withSessionCoherence,
} from "@/lib/cooking";

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

/**
 * POST /api/cooking/session — create or update a session.
 *
 * A session write is domain state (it feeds cook history and the derived
 * whole-meal review), so it needs either the canonical authorized household
 * session or the fail-closed trusted-runtime token that the Telegram
 * live-cooking runtime carries. Reads stay open like the other planner GETs.
 */
export async function POST(request: NextRequest) {
  const guard = await guardRuntimeWrite(request);
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Structural validation before persistence. A malformed body (a string
  // anchor, a related recipe with no id, a non-array method) used to be stored
  // verbatim and then made every later read of that row throw, so both GET
  // routes returned 500 forever. `validateSessionBody` returns the normalized
  // session to store — the caller's object never reaches the database, which is
  // also what strips the derived `coherence` a client may round-trip back.
  const validated = validateSessionBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    await saveCookingSession(validated.session);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save cooking session" },
      { status: 500 }
    );
  }
}
