import { NextResponse } from "next/server";
import { guardNewPlaysRoute } from "@/lib/api-guards";
import {
  enqueueAction,
  listActions,
  validateActionRequest,
  type NewPlayActionStatus,
} from "@/lib/music-new-plays";

export const runtime = "nodejs";

const VALID_STATUSES: NewPlayActionStatus[] = ["pending", "applied", "failed"];

/**
 * POST /api/music/new-plays/actions
 * Body: { playId, action, context? }
 *
 * Queue a typed action for the home runtime. Nothing is applied here: the
 * request sits in the outbox until `projects/sonos-music` pulls it, applies
 * it, and acknowledges the outcome. 202 on queue, 400 on an invalid request,
 * 409 when the same action is already pending for this play + context.
 */
export async function POST(request: Request) {
  const guard = await guardNewPlaysRoute(request, "enqueue");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateActionRequest(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  try {
    const result = await enqueueAction(validated.value, "companion-app");
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, action: result.action }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to queue action" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/music/new-plays/actions?status=pending
 *
 * The outbox the home runtime consumes. Defaults to `pending`; `status=all`
 * returns the most recent rows in any status for auditing.
 */
export async function GET(request: Request) {
  const guard = await guardNewPlaysRoute(request, "outbox-get");
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const statusParam = (url.searchParams.get("status") || "pending").trim().toLowerCase();
  let status: NewPlayActionStatus | null;
  if (statusParam === "all") {
    status = null;
  } else if (VALID_STATUSES.includes(statusParam as NewPlayActionStatus)) {
    status = statusParam as NewPlayActionStatus;
  } else {
    return NextResponse.json(
      { error: `status must be one of ${[...VALID_STATUSES, "all"].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const actions = await listActions(status);
    return NextResponse.json({ actions });
  } catch (error) {
    return NextResponse.json(
      { actions: [], error: error instanceof Error ? error.message : "Failed to load actions" },
      { status: 502 },
    );
  }
}
