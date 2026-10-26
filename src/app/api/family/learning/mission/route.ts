import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, refuse, requireChildLearning } from "@/lib/family-learning-auth";
import { loadLearningContentFor, loadVocabularyInventoryFor } from "@/lib/family-learning-content-server";
import type { ChildId } from "@/lib/family-assistant-turn";
import { applyMutation, ExposureUnsettledError, readChildView, type MutationContext } from "@/lib/family-learning-db";
import { resolveTimeZone } from "@/lib/family-learning-progress";
import type { LearningOp } from "@/lib/family-learning-state";
import { resolveBridgeMintConfig, verifyBridgeReceipt } from "@/lib/family-assistant-bridge";
import { verifiedReceiptFromClaims } from "@/lib/family-learning-trust";

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
 * The child is taken from the verified learning credential only, and so is the CONTENT: each child is served her/his own
 * reviewed content line (Santiago the expedition, Isabel «Old Lilas kleine Werkstatt», 2026-10-26). A child without
 * served content gets the honest empty state and every mutation is refused (family-assistant DESIGN §7.6).
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

/** The child's own content: `null` = none prepared for this child, `"failed"` = the served file does not reconcile (503). */
function content(child: ChildId) {
  try {
    return loadLearningContentFor(child);
  } catch {
    return "failed" as const;
  }
}

/** The reviewed vocabulary inventory; a file that does not reconcile is a 503 like mis-keyed content. */
function vocabulary(child: ChildId): { ok: true; inventory: ReturnType<typeof loadVocabularyInventoryFor> } | { ok: false } {
  try {
    const inventory = loadVocabularyInventoryFor(child);
    // Santiago's content always has its inventory; Isabel's workshop has none (null is her honest value, not a failure).
    return child === "santiago" && !inventory ? { ok: false } : { ok: true, inventory };
  } catch {
    return { ok: false };
  }
}

/**
 * Learner time zone for the progress strip's Monday–Sunday week (follow-on M2):
 * `?tz=` on GET, `tz` in the PUT body. Only a valid IANA zone is honoured; anything
 * else falls back to the household default. Never a client clock.
 */
function timeZoneOf(value: unknown): string {
  return resolveTimeZone(value);
}

export async function GET(request: Request) {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return guard.response;
  const loaded = content(guard.child);
  if (loaded === "failed") return refuse(503, "Learning content is not available");
  if (!loaded || guard.child !== loaded.child) {
    return NextResponse.json({ view: null, prepared: false, child: guard.child }, { headers: NO_STORE });
  }
  const vocab = vocabulary(guard.child);
  if (!vocab.ok) return refuse(503, "Learning vocabulary inventory is not available");
  try {
    const view = await readChildView(await getDb(), guard.child, loaded, new Date(), { timeZone: timeZoneOf(new URL(request.url).searchParams.get("tz")), vocabulary: vocab.inventory });
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
  const loaded = content(guard.child);
  if (loaded === "failed") return refuse(503, "Learning content is not available");
  if (!loaded || guard.child !== loaded.child) return refuse(404, "No mission is prepared for this child");

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
  // Bridge response receipts (repair round 2, IV5-03; round 3, R2-01/R2-02): the client carries the bridge's receipt as it
  // came; the server verifies it with the shared secret and hands the state machine ONLY verified claims, or an explicit
  // INVALID marker when a receipt was present but failed (distinct from absent: the reply is then withheld and recorded as
  // receipt-invalid), or nothing when none came. A caller-supplied claims object is never trusted. The reply text is passed
  // through EXACTLY (no normalisation, no slicing); an overlong reply is refused explicitly.
  // ONE boundary for every reply-carrying op (assessment reset §7, R4-01): reasoning-reply, review-log-semantic and the
  // free-question tutor_reply (its receipt travels in the support payload and is moved here before the state sees it).
  const tutorReply = op.op === "support" && op.kind === "tutor_reply";
  if (op.op === "reasoning-reply" || op.op === "review-log-semantic" || tutorReply) {
    const carrier = tutorReply ? ((op.payload && typeof op.payload === "object" ? op.payload : {}) as Record<string, unknown>) : (op as { receipt?: unknown });
    const raw = carrier.receipt;
    delete carrier.receipt;
    delete (op as { receipt?: unknown }).receipt;
    const text = tutorReply ? (carrier as Record<string, unknown>).text : (op as { text?: unknown }).text;
    if (text !== undefined && typeof text !== "string") return refuse(400, "text must be a string");
    if (typeof text === "string" && text.length > 4000) return refuse(422, `Reply too long (${text.length} > 4000 characters); it is refused, never truncated`);
    if (raw !== undefined) {
      const configured = resolveBridgeMintConfig();
      if (!configured.ok) return refuse(503, "The family assistant bridge is not configured");
      const verified = typeof raw === "string" ? verifyBridgeReceipt(raw, configured.config.secret) : ({ ok: false, reason: "not-a-string" } as const);
      (op as { receipt?: unknown }).receipt = verified.ok ? verifiedReceiptFromClaims(verified.claims) : { invalid: verified.reason };
    }
  }
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
  const vocab = vocabulary(guard.child);
  if (!vocab.ok) return refuse(503, "Learning vocabulary inventory is not available");

  let outcome;
  try {
    outcome = await applyMutation(await getDb(), { child: guard.child, op, idempotencyKey, expectedRevision, context }, loaded, () => new Date(), { timeZone: timeZoneOf(body.tz), vocabulary: vocab.inventory });
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
