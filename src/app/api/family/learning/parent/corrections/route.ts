import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { loadLearningContentFor } from "@/lib/family-learning-content-server";
import { annotateDisplayError, correctAttempt } from "@/lib/family-learning-db";

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
  const { child, attemptId, evidence, note, items, displayError } = body as Record<string, unknown>;
  if (!isChildId(child)) return refuse(400, "child must be santiago or isabel");
  // Nov 8: `{ child, displayError: { visit, steps: string[], observation } }`: a task whose screen was broken (see annotateDisplayError).
  if (displayError !== undefined) {
    const { visit, steps, observation } = (displayError ?? {}) as Record<string, unknown>;
    if (typeof visit !== "string" || !Array.isArray(steps) || steps.length === 0 || steps.length > 10 || !steps.every((x) => typeof x === "string")) return refuse(400, "displayError needs a visit and its steps");
    if (typeof observation !== "string" || !observation.trim() || observation.trim().length > 300) return refuse(400, "displayError needs the parent's observation (at most 300 characters)");
    let content;
    try {
      content = loadLearningContentFor(child);
    } catch {
      return refuse(503, "Learning content is not available");
    }
    const mission = content?.missions?.find((m) => m.visit === visit);
    if (!content || !mission) return refuse(404, "No such visit for this child");
    const chosen = (steps as string[]).map((id) => mission.steps.find((s) => s.id === id));
    if (chosen.some((s) => !s || !s.objective)) return refuse(400, "steps must be tasks of this visit");
    try {
      const out = await annotateDisplayError(await getDb(), { child, contentId: content.contentId, missionId: mission.id, visitId: visit, steps: chosen.map((s) => ({ step: s!.id, objective: s!.objective! })), observation: observation.trim(), adminEmail: parent.adminEmail });
      return NextResponse.json({ displayError: true, ...out }, { headers: NO_STORE });
    } catch (error) {
      return refuse(400, error instanceof Error ? error.message : "Invalid annotation");
    }
  }
  // Nov 8: a note on a whole task («I helped here»): one correction per answer of that task, each still shown beside the original.
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 40) return refuse(400, "items must be 1–40 answers");
    if (typeof note !== "string" || !note.trim()) return refuse(400, "A whole-task note needs a note");
    const parsed: { attemptId: string; evidence: string | null }[] = [];
    for (const item of items as unknown[]) {
      const r = (item ?? {}) as Record<string, unknown>;
      if (typeof r.attemptId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(r.attemptId)) return refuse(400, "attemptId is required");
      if (r.evidence !== null && typeof r.evidence !== "string") return refuse(400, "evidence must be a string or null");
      parsed.push({ attemptId: r.attemptId, evidence: r.evidence as string | null });
    }
    const db = await getDb();
    let corrected = 0;
    try {
      for (const it of parsed) if (await correctAttempt(db, { child, attemptId: it.attemptId, evidence: it.evidence, note: note.trim(), adminEmail: parent.adminEmail })) corrected += 1;
    } catch (error) {
      return refuse(400, error instanceof Error ? error.message : "Invalid correction");
    }
    if (corrected === 0) return refuse(404, "No such attempts for this child");
    return NextResponse.json({ corrected, of: parsed.length }, { headers: NO_STORE });
  }
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
