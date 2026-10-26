import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { loadLearningContentFor } from "@/lib/family-learning-content-server";
import { recordParentObservation } from "@/lib/family-learning-db";

/**
 * POST /api/family/learning/parent/observation
 * `{ child, visit, step, task, status: "done" | "with-help" | "not-tried", note?: string | null }`
 *
 * Isabel Visit 1 (I1-07): the parent records what happened in a real-world task of the child's content (the craft, the
 * explanation of a material choice, the search for wooden things). Only the exact owner identity reaches this line; the
 * step and task must be a real-world (`craft`) task of the CHILD'S OWN served content. The entry is the parent's
 * observation — never a child attempt, never an app or AI assessment — and is audited.
 */
const STATUSES = ["done", "with-help", "not-tried"] as const;

export async function POST(request: Request) {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return refuse(400, "Body must be an object");
  const { child, visit, step, task, status, note } = body as Record<string, unknown>;
  if (!isChildId(child)) return refuse(400, "child must be santiago or isabel");
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return refuse(400, "status must be done, with-help or not-tried");
  const noteValue = note === undefined || note === null ? null : typeof note === "string" && note.trim().length <= 300 ? note.trim() || null : undefined;
  if (noteValue === undefined) return refuse(400, "note must be a string of at most 300 characters or null");
  let content;
  try {
    content = loadLearningContentFor(child);
  } catch {
    return refuse(503, "Learning content is not available");
  }
  if (!content || content.child !== child) return refuse(404, "No content is prepared for this child");
  const mission = (content.missions ?? []).find((m) => m.visit === visit);
  const def = mission?.steps.find((s) => s.id === step && s.kind === "craft");
  if (!mission || !def || !def.craft?.tasks.some((t) => t.id === task)) return refuse(400, "step and task must name a real-world task of this child's visit");
  const saved = await recordParentObservation(await getDb(), { child, missionId: content.contentId, visitId: String(visit), step: def.id, task: String(task), status: status as (typeof STATUSES)[number], note: noteValue, adminEmail: parent.adminEmail });
  return NextResponse.json({ recorded: true, ...saved }, { headers: NO_STORE });
}
