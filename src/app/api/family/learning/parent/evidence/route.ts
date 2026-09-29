import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { loadLearningContent } from "@/lib/family-learning-content-server";
import { readEvidence } from "@/lib/family-learning-db";

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
  let contentId = "santiago-expedition";
  let prepared = false;
  let counts: Record<string, number> | null = null;
  try {
    const content = loadLearningContent();
    contentId = content.contentId;
    prepared = content.child === child;
    counts = { math: content.math.items.length, language: content.language.segments.length, typingLessons: content.typing.lessons.length, typingLabels: content.typing.labelTasks.length };
  } catch {
    /* evidence remains readable even if content fails to load */
  }
  const bundle = await readEvidence(await getDb(), child, contentId);
  return NextResponse.json({ ...bundle, prepared, contentCounts: counts, owner: parent.adminEmail }, { headers: NO_STORE });
}
