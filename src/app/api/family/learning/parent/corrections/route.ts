import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { correctAttempt } from "@/lib/family-learning-db";

/**
 * POST /api/family/learning/parent/corrections
 * `{ child, attemptId, evidence?: EvidenceCategory | null, note?: string | null }`
 *
 * A parent correction annotates one attempt. The child's recorded answer and
 * evidence category stay untouched and visible; the correction is displayed
 * beside them and audited (family-assistant DESIGN §7.6 "corrections do not
 * masquerade as child attempts").
 */
export async function POST(request: Request) {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (typeof body !== "object" || body === null) return refuse(400, "Body must be an object");
  const { child, attemptId, evidence, note } = body as Record<string, unknown>;
  if (!isChildId(child)) return refuse(400, "child must be santiago or isabel");
  if (typeof attemptId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(attemptId)) return refuse(400, "attemptId is required");
  const evidenceValue = evidence === undefined || evidence === null ? null : typeof evidence === "string" ? evidence : undefined;
  const noteValue = note === undefined || note === null ? null : typeof note === "string" ? note.trim() : undefined;
  if (evidenceValue === undefined || noteValue === undefined) return refuse(400, "evidence and note must be strings or null");
  if (evidenceValue === null && !noteValue) return refuse(400, "A correction needs an evidence category or a note");
  let updated: boolean;
  try {
    updated = await correctAttempt(await getDb(), { child, attemptId, evidence: evidenceValue, note: noteValue, adminEmail: parent.adminEmail });
  } catch (error) {
    return refuse(400, error instanceof Error ? error.message : "Invalid correction");
  }
  if (!updated) return refuse(404, "No such attempt for this child");
  return NextResponse.json({ corrected: true }, { headers: NO_STORE });
}
