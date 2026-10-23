import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveBridgeMintConfig } from "@/lib/family-assistant-bridge";
import { getDb } from "@/lib/db";
import { NO_STORE, refuse, requireChildLearning } from "@/lib/family-learning-auth";
import { loadLearningContent, loadVocabularyInventory } from "@/lib/family-learning-content-server";
import { applyMutation, ExposureUnsettledError, type MutationContext } from "@/lib/family-learning-db";
import { noktModeFromEnv } from "@/lib/family-learning-nokt";
import { askNoktBackend, noktReplyOrigin } from "@/lib/family-learning-nokt-turn";
import { resolveTimeZone } from "@/lib/family-learning-progress";

/**
 * POST /api/family/learning/nokt/turn — one Nokt turn (content v6, N7-03/N7-06).
 *   `{ step, part, purpose, entry, sessionId, turnId, text, via, expectedRevision, context, tz? }`
 *
 * 1. `tutor-dispatch` with his text: the server records his line and builds the request from what he can see (never the
 *    answer key); the request hash is stored with the dispatch.
 * 2. The request goes to the tutor backend (bridge URL + minted bridge token); the reply comes back with an `fcr1` receipt.
 * 3. The receipt is verified with the existing secret and bound to THIS dispatch (child, turn, request hash, exact bytes).
 * 4. `tutor-reply` applies the app's phases and guards; only a verified, accepted reply is shown as Nokt. A structured result
 *    must fit the talk and pass the N7-06 validator; prose never completes anything.
 *
 * Available only where Nokt's conversation is enabled (`noktModeFromEnv`: the isolated fictional stub in this build) and the
 * bridge is configured; otherwise 503. A cancelled request (he cancelled, closed Nokt or changed task) aborts the backend
 * call; the dispatch stays unanswered and nothing is shown. Transport replays are settled by the idempotency keys
 * (`<turnId>-d`, `<turnId>-r`); a second reply to the same turn is refused by the engine.
 */

const MAX_BODY_BYTES = 8 * 1024;
const TURN_ID = /^[A-Za-z0-9_-]{8,80}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** R5-1: the rendered identity, strictly shaped (same rule as the mission route). */
function readContext(value: unknown): MutationContext | null {
  if (!isPlainObject(value)) return null;
  const generation = value.erasureGeneration;
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) return null;
  const visit = value.visit;
  if (visit === null) return { erasureGeneration: generation, visit: null };
  if (!isPlainObject(visit) || typeof visit.id !== "string" || visit.id.length === 0 || visit.id.length > 40 || typeof visit.startedAt !== "string" || visit.startedAt.length === 0 || visit.startedAt.length > 64) return null;
  return { erasureGeneration: generation, visit: { id: visit.id, startedAt: visit.startedAt } };
}

export async function POST(request: Request) {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return guard.response;
  if (noktModeFromEnv(process.env) !== "fictional-stub") return refuse(503, "Nokt cannot talk right now");
  const bridge = resolveBridgeMintConfig();
  if (!bridge.ok) return refuse(503, "Nokt cannot talk right now");
  let content;
  let vocabulary;
  try {
    content = loadLearningContent();
    vocabulary = loadVocabularyInventory();
  } catch {
    return refuse(503, "Learning content is not available");
  }
  if (guard.child !== content.child) return refuse(404, "No mission is prepared for this child");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refuse(413, "Body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (!isPlainObject(body)) return refuse(400, "Body must be an object");
  const { step, part, purpose, entry, sessionId, turnId, text, via, expectedRevision } = body;
  if (typeof step !== "string" || typeof part !== "string" || typeof sessionId !== "string" || !sessionId || sessionId.length > 80 || typeof turnId !== "string" || !TURN_ID.test(turnId)) return refuse(400, "step, part, sessionId and turnId are required");
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) return refuse(400, "expectedRevision must be a non-negative integer");
  const context = readContext(body.context);
  if (!context) return refuse(400, "context is required");
  const timeZone = resolveTimeZone(body.tz);
  const db = await getDb();
  const tutor = { available: true, origin: "missing" as const };

  const respond = (outcome: Awaited<ReturnType<typeof applyMutation>>, extra: Record<string, unknown> = {}) => {
    switch (outcome.status) {
      case "applied":
      case "replayed":
        return NextResponse.json({ status: outcome.status, view: outcome.view, result: { ...outcome.result, ...extra } }, { headers: NO_STORE });
      case "stale":
        return NextResponse.json({ status: "stale", view: outcome.view }, { status: 409, headers: NO_STORE });
      case "refused":
        return NextResponse.json({ status: "refused", code: outcome.code, message: outcome.message, view: outcome.view }, { status: 422, headers: NO_STORE });
    }
  };

  try {
    // 1. Dispatch: his line, recorded before anything is asked; the server-built request and its hash come back.
    const dispatched = await applyMutation(db, { child: guard.child, op: { op: "mission", action: { a: "tutor-dispatch", step, part, purpose: purpose as "diagnostic", entry: entry as "manual", turnId, sessionId, text: text as string, via: via as "typed" } }, idempotencyKey: `${turnId}-d`, expectedRevision, context }, content, () => new Date(), { timeZone, vocabulary, tutor });
    if (dispatched.status !== "applied") return respond(dispatched);
    const result = dispatched.result as { request?: unknown; reqHash?: string };
    if (!result.request || !result.reqHash) return refuse(500, "Nokt turn could not be prepared");

    // 2. The backend hop; cancelled with his request.
    const answer = await askNoktBackend(bridge.config, { child: guard.child, turnId, request: result.request }, { signal: request.signal, jti: randomUUID() });
    if (!answer.ok && answer.reason === "cancelled") return refuse(499, "Cancelled");

    // 3. Origin: verified only when signed AND bound to this dispatch and these exact bytes.
    const reply = answer.ok ? answer.reply : "";
    const origin = answer.ok ? noktReplyOrigin(answer.receipt, bridge.config.secret, { child: guard.child, turnId, reqHash: result.reqHash, text: reply }) : "missing";

    // 4. The reply through the app's phases and guards.
    const replied = await applyMutation(db, { child: guard.child, op: { op: "mission", action: { a: "tutor-reply", step, turnId, reply } }, idempotencyKey: `${turnId}-r`, expectedRevision: dispatched.view.revision, context }, content, () => new Date(), { timeZone, vocabulary, tutor: { available: true, origin } });
    return respond(replied, answer.ok ? {} : { transport: answer.reason });
  } catch (error) {
    if (error instanceof ExposureUnsettledError) return refuse(503, "The task could not be saved as shown; try again");
    throw error;
  }
}
