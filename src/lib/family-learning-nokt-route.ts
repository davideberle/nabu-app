// ---------------------------------------------------------------------------
// Nokt turn routes — the shared server-side checks of `…/nokt/turn/dispatch` and `…/nokt/turn/reply`.
// **Server-only.** Same identity rule as the mission route (R5-1); same response shape, so the client adopts the view the
// same way. Available only where Nokt's conversation is enabled (`noktModeFromEnv`) and the bridge is configured.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { resolveBridgeMintConfig, type BridgeMintConfig } from "./family-assistant-bridge.ts";
import { getDb } from "./db.ts";
import { NO_STORE, refuse, requireChildLearning } from "./family-learning-auth.ts";
import { loadLearningContent, loadVocabularyInventory } from "./family-learning-content-server.ts";
import type { applyMutation, MutationContext } from "./family-learning-db.ts";
import { noktModeFromEnv } from "./family-learning-nokt.ts";
import { resolveTimeZone } from "./family-learning-progress.ts";

export const NOKT_TURN_ID = /^[A-Za-z0-9_-]{8,80}$/;
export const NOKT_TURN_MAX_BODY_BYTES = 8 * 1024;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** R5-1: the rendered identity, strictly shaped (same rule as the mission route). */
export function readTurnContext(value: unknown): MutationContext | null {
  if (!isPlainObject(value)) return null;
  const generation = value.erasureGeneration;
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) return null;
  const visit = value.visit;
  if (visit === null) return { erasureGeneration: generation, visit: null };
  if (!isPlainObject(visit) || typeof visit.id !== "string" || visit.id.length === 0 || visit.id.length > 40 || typeof visit.startedAt !== "string" || visit.startedAt.length === 0 || visit.startedAt.length > 64) return null;
  return { erasureGeneration: generation, visit: { id: visit.id, startedAt: visit.startedAt } };
}

export function mutationResponse(outcome: Awaited<ReturnType<typeof applyMutation>>, extra: Record<string, unknown> = {}) {
  switch (outcome.status) {
    case "applied":
    case "replayed":
      return NextResponse.json({ status: outcome.status, view: outcome.view, result: { ...outcome.result, ...extra } }, { headers: NO_STORE });
    case "stale":
      return NextResponse.json({ status: "stale", view: outcome.view }, { status: 409, headers: NO_STORE });
    case "refused":
      return NextResponse.json({ status: "refused", code: outcome.code, message: outcome.message, view: outcome.view }, { status: 422, headers: NO_STORE });
  }
}

export type NoktTurnPrereqs =
  | { ok: true; child: "santiago" | "isabel"; bridge: BridgeMintConfig; body: Record<string, unknown>; context: MutationContext; expectedRevision: number; timeZone: string; content: ReturnType<typeof loadLearningContent>; vocabulary: ReturnType<typeof loadVocabularyInventory>; db: Awaited<ReturnType<typeof getDb>> }
  | { ok: false; response: Response };

/** Authentication, the conversation gate, content and the common body fields — in this order, for both routes. */
export async function noktTurnPrereqs(request: Request): Promise<NoktTurnPrereqs> {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return { ok: false, response: guard.response };
  if (noktModeFromEnv(process.env) !== "fictional-stub") return { ok: false, response: refuse(503, "Nokt cannot talk right now") };
  const bridge = resolveBridgeMintConfig();
  if (!bridge.ok) return { ok: false, response: refuse(503, "Nokt cannot talk right now") };
  let content;
  let vocabulary;
  try {
    content = loadLearningContent();
    vocabulary = loadVocabularyInventory();
  } catch {
    return { ok: false, response: refuse(503, "Learning content is not available") };
  }
  if (guard.child !== content.child) return { ok: false, response: refuse(404, "No mission is prepared for this child") };
  const raw = await request.text();
  if (raw.length > NOKT_TURN_MAX_BODY_BYTES) return { ok: false, response: refuse(413, "Body too large") };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, response: refuse(400, "Body must be JSON") };
  }
  if (!isPlainObject(body)) return { ok: false, response: refuse(400, "Body must be an object") };
  const expectedRevision = body.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) return { ok: false, response: refuse(400, "expectedRevision must be a non-negative integer") };
  const context = readTurnContext(body.context);
  if (!context) return { ok: false, response: refuse(400, "context is required") };
  return { ok: true, child: guard.child, bridge: bridge.config, body, context, expectedRevision, timeZone: resolveTimeZone(body.tz), content, vocabulary, db: await getDb() };
}
