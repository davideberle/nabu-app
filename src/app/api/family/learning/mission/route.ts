import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, refuse, requireChildLearning } from "@/lib/family-learning-auth";
import { loadLearningContent } from "@/lib/family-learning-content-server";
import { applyMutation, ExposureUnsettledError, readChildView, type MutationContext } from "@/lib/family-learning-db";
import type { LearningOp } from "@/lib/family-learning-state";

/**
 * GET  /api/family/learning/mission  — the child's current view (marks the
 *      active scored item as shown, durably, before returning it).
 * PUT  /api/family/learning/mission  — one mutation:
 *      `{ op: LearningOp, expectedRevision: number, idempotencyKey: string,
 *         context: { erasureGeneration: number, visit: { id, startedAt } | null } }`
 *      `context` (R5-1) is the identity the client rendered against; a mismatch
 *      with the stored child (erased / recreated / replaced visit) is 409 stale.
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

/**
 * Content-free fingerprint of the current sign-in (R4-2): a truncated SHA-256
 * of the Auth.js session cookie value. It changes with every new sign-in and
 * is stable within one (the sliding refresh is disabled app-wide), so a
 * completed draft recovered in the browser is bound to the sign-in that
 * produced it. Nothing about the cookie or the account is revealed.
 */
function sessionFingerprint(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)(?:__Secure-|__Host-)?authjs\.session-token(?:\.0)?=([^;]+)/);
  if (!match) return undefined;
  return createHash("sha256").update(match[1]).digest("hex").slice(0, 16);
}

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
    return NextResponse.json({ view: { ...view, sessionFingerprint: sessionFingerprint(request) }, prepared: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ExposureUnsettledError) return refuse(503, "The task could not be saved as shown; try again");
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** R5-1: the rendered identity; strictly shaped, content-free. */
function readContext(value: unknown): MutationContext | null {
  if (!isPlainObject(value)) return null;
  const generation = value.erasureGeneration;
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) return null;
  const visit = value.visit;
  if (visit === null) return { erasureGeneration: generation, visit: null };
  if (!isPlainObject(visit) || typeof visit.id !== "string" || visit.id.length === 0 || visit.id.length > 40 || typeof visit.startedAt !== "string" || visit.startedAt.length === 0 || visit.startedAt.length > 64) return null;
  return { erasureGeneration: generation, visit: { id: visit.id, startedAt: visit.startedAt } };
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
  const context = readContext(body.context);
  if (!context) return refuse(400, "context is required: { erasureGeneration, visit: { id, startedAt } | null }");

  let outcome;
  try {
    outcome = await applyMutation(await getDb(), { child: guard.child, op, idempotencyKey, expectedRevision, context }, loaded);
  } catch (error) {
    if (error instanceof ExposureUnsettledError) return refuse(503, "The task could not be saved as shown; try again");
    throw error;
  }
  const fp = sessionFingerprint(request);
  const withFp = { ...outcome.view, sessionFingerprint: fp };
  switch (outcome.status) {
    case "applied":
    case "replayed":
      return NextResponse.json({ status: outcome.status, view: withFp, result: outcome.result }, { headers: NO_STORE });
    case "stale":
      return NextResponse.json({ status: "stale", view: withFp }, { status: 409, headers: NO_STORE });
    case "refused":
      return NextResponse.json({ status: "refused", code: outcome.code, message: outcome.message, view: withFp }, { status: 422, headers: NO_STORE });
  }
}
