import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, refuse, requireChildLearning } from "@/lib/family-learning-auth";
import { loadLearningContent } from "@/lib/family-learning-content-server";
import { applyMutation, ExposureUnsettledError, readChildView } from "@/lib/family-learning-db";
import type { LearningOp } from "@/lib/family-learning-state";

/**
 * GET  /api/family/learning/mission  — the child's current view (marks the
 *      active scored item as shown, durably, before returning it).
 * PUT  /api/family/learning/mission  — one mutation:
 *      `{ op: LearningOp, expectedRevision: number, idempotencyKey: string }`
 *      200 `{ status: "applied" | "replayed", view, result }`
 *      409 `{ status: "stale", view }`          — rendered revision is old
 *      422 `{ status: "refused", code, message, view }` — rule refused the op
 *
 * The child is taken from the verified learning credential only. Isabel has
 * no prepared content in this build: her view is an honest empty state and
 * every mutation is refused (family-assistant DESIGN §7.6).
 */

const MAX_BODY_BYTES = 16 * 1024;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function content() {
  try {
    return loadLearningContent();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return guard.response;
  const loaded = content();
  if (!loaded) return refuse(503, "Learning content is not available");
  if (guard.child !== loaded.child) {
    return NextResponse.json({ view: null, prepared: false, child: guard.child }, { headers: NO_STORE });
  }
  try {
    const view = await readChildView(await getDb(), guard.child, loaded);
    return NextResponse.json({ view, prepared: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ExposureUnsettledError) return refuse(503, "The task could not be saved as shown; try again");
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural check only — the state machine validates the op semantically. */
function readOp(value: unknown): LearningOp | null {
  if (!isPlainObject(value) || typeof value.op !== "string" || value.op.length > 40) return null;
  return value as LearningOp;
}

export async function PUT(request: Request) {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return guard.response;
  const loaded = content();
  if (!loaded) return refuse(503, "Learning content is not available");
  if (guard.child !== loaded.child) return refuse(404, "No mission is prepared for this child");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refuse(413, "Body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (!isPlainObject(body)) return refuse(400, "Body must be an object");
  const op = readOp(body.op);
  if (!op) return refuse(400, "op is required");
  const expectedRevision = body.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return refuse(400, "expectedRevision must be a non-negative integer");
  }
  const idempotencyKey = body.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    return refuse(400, "idempotencyKey is required");
  }

  let outcome;
  try {
    outcome = await applyMutation(await getDb(), { child: guard.child, op, idempotencyKey, expectedRevision }, loaded);
  } catch (error) {
    if (error instanceof ExposureUnsettledError) return refuse(503, "The task could not be saved as shown; try again");
    throw error;
  }
  switch (outcome.status) {
    case "applied":
    case "replayed":
      return NextResponse.json({ status: outcome.status, view: outcome.view, result: outcome.result }, { headers: NO_STORE });
    case "stale":
      return NextResponse.json({ status: "stale", view: outcome.view }, { status: 409, headers: NO_STORE });
    case "refused":
      return NextResponse.json({ status: "refused", code: outcome.code, message: outcome.message, view: outcome.view }, { status: 422, headers: NO_STORE });
  }
}
