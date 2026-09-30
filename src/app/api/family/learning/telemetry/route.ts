import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, refuse, requireChildLearning } from "@/lib/family-learning-auth";
import { loadLearningContent } from "@/lib/family-learning-content-server";
import { recordTelemetry } from "@/lib/family-learning-db";

/**
 * POST /api/family/learning/telemetry — one bounded batch of task telemetry
 * from the mission workspace (approved redesign 2026-09-29, F6/R3):
 *   `{ batchId, visitId, visitStartedAt, erasureGeneration, events: [{ t, kind, stage?, detail? }] }`
 * Idempotent by batch id. `visitStartedAt` and `erasureGeneration` are the
 * values of the server view the events belong to; the store checks both
 * inside its write transaction, so an old batch never attaches to a later
 * visit instance and nothing survives erasure (P1/P2). Events are reduced to
 * the closed privacy schema (P4): enumerated kinds/stages/ops/controls and
 * bounded integers only — never a key stream, free text, audio, replay or an
 * attention score. The child comes from the verified learning credential
 * only; the batch is deleted with the child's records.
 */
const MAX_BODY_BYTES = 32 * 1024;
const BATCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function POST(request: Request) {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return guard.response;
  let loaded;
  try {
    loaded = loadLearningContent();
  } catch {
    return refuse(503, "Learning content is not available");
  }
  if (guard.child !== loaded.child) return refuse(404, "No mission is prepared for this child");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refuse(413, "Body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return refuse(400, "Body must be an object");
  const record = body as Record<string, unknown>;
  if (typeof record.batchId !== "string" || !BATCH_PATTERN.test(record.batchId)) return refuse(400, "batchId is required");
  if (typeof record.visitId !== "string" || !/^v[1-4]$/.test(record.visitId)) return refuse(400, "visitId is required");
  if (typeof record.visitStartedAt !== "string" || record.visitStartedAt.length > 40) return refuse(400, "visitStartedAt is required");
  if (typeof record.erasureGeneration !== "number" || !Number.isInteger(record.erasureGeneration) || record.erasureGeneration < 0) return refuse(400, "erasureGeneration is required");
  if (!Array.isArray(record.events)) return refuse(400, "events must be a list");
  const result = await recordTelemetry(await getDb(), guard.child, loaded.contentId, { batchId: record.batchId, visitId: record.visitId, visitStartedAt: record.visitStartedAt, erasureGeneration: record.erasureGeneration, events: record.events });
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
}
