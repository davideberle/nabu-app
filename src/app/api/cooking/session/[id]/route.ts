import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { patchCookingSession, getCookingSession } from "@/lib/cooking";
import type { SessionPatch } from "@/lib/cooking";

// GET /api/cooking/session/:id
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
    return NextResponse.json(session);
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
