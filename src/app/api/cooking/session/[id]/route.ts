import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  patchCookingSession,
  getCookingSession,
  withSessionCoherence,
} from "@/lib/cooking";
import type { SessionPatch } from "@/lib/cooking";

/**
 * GET /api/cooking/session/:id
 *
 * Returns the stored session with one extra top-level property, `coherence`:
 * the derived whole-meal review (live-cooking DESIGN.md §3 rule 16). All
 * existing session fields are unchanged, so current clients keep working. The
 * review is derived per request and never persisted.
 *
 * PATCH deliberately does not add it: a patch response reflects exactly what
 * was written, and the review is not part of the stored session.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await getCookingSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(await withSessionCoherence(session));
  } catch {
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 }
    );
  }
}

// PATCH /api/cooking/session/:id — apply partial updates
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const patch = (await request.json()) as SessionPatch;
    const updated = await patchCookingSession(id, patch);
    if (!updated) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update session";
    const status = err instanceof Error ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
