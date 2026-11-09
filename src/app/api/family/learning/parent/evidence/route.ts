import { NextResponse } from "next/server";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { readParentEvidence } from "@/lib/family-learning-evidence-server";

/**
 * GET /api/family/learning/parent/evidence?child=santiago|isabel
 *
 * Every attempt, support event, exposure and work sample for one child, plus
 * the mission state and parent settings. Reads are protected like writes: the
 * exact owner identity from the server-side session (account rule of
 * 2026-09-29). The child id in the query selects *which child's* records the
 * parent inspects; it grants nothing, because only the owner guard reaches
 * this line.
 */
export async function GET(request: Request) {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  const child = new URL(request.url).searchParams.get("child");
  if (!isChildId(child)) return refuse(400, "child must be santiago or isabel");
  const evidence = await readParentEvidence(child);
  return NextResponse.json({ ...evidence, owner: parent.adminEmail }, { headers: NO_STORE });
}
