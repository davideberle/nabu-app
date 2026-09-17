import { NextResponse } from "next/server";
import { guardNewPlaysRoute } from "@/lib/api-guards";
import { ackActions, type NewPlayActionAckResult } from "@/lib/music-new-plays";

export const runtime = "nodejs";

function isAckResult(entry: unknown): entry is NewPlayActionAckResult {
  if (typeof entry !== "object" || entry === null) return false;
  const value = entry as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.ok !== "boolean") return false;
  for (const key of ["message", "code", "eventId"]) {
    const field = value[key];
    if (field !== undefined && field !== null && typeof field !== "string") return false;
  }
  return true;
}

/**
 * POST /api/music/new-plays/actions/ack
 * Body: { results: [{ id, ok, message?, code?, eventId? }] }
 *
 * The home runtime reports what it did with each queued action. Idempotent:
 * only rows still `pending` change, so a re-sent acknowledgement is a no-op.
 * The visible outcome (feedback, library, profile) still arrives only with
 * the next mirror push.
 */
export async function POST(request: Request) {
  const guard = await guardNewPlaysRoute(request, "ack");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) {
    return NextResponse.json({ error: "results must be an array" }, { status: 400 });
  }
  const valid = results.filter(isAckResult);
  if (valid.length !== results.length) {
    return NextResponse.json(
      { error: "each result needs a string id and a boolean ok" },
      { status: 400 },
    );
  }

  try {
    const updated = await ackActions(valid);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to acknowledge actions" },
      { status: 500 },
    );
  }
}
