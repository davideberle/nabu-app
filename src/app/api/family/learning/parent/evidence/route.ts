import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { loadLearningContent, loadVocabularyInventory } from "@/lib/family-learning-content-server";
import { readEvidence } from "@/lib/family-learning-db";
import { delayedCheckInfo, visitLabel, visitOrdinal } from "@/lib/family-learning-summary";
import type { VocabularyInventory } from "@/lib/family-learning-vocabulary";
import type { VisitId } from "@/lib/family-learning-content";

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
  let content: ReturnType<typeof loadLearningContent> | undefined;
  try {
    content = loadLearningContent();
    contentId = content.contentId;
    prepared = content.child === child;
    counts = { version: content.contentVersion, math: content.math.items.length, language: content.language.segments.length, typingLessons: content.typing.lessons.length, typingCourse: content.typing.course?.lessons.length ?? 0, typingLabels: content.typing.labelTasks.length };
  } catch {
    /* evidence remains readable even if content fails to load */
  }
  let inventory: VocabularyInventory | null = null;
  try {
    inventory = prepared ? loadVocabularyInventory() : null;
  } catch {
    /* the ledger is derived; evidence stays readable without it (the bundle says vocabulary: null) */
  }
  const bundle = await readEvidence(await getDb(), child, contentId, undefined, prepared ? content : undefined, inventory);
  // The delayed-check date is explained from the stored anchor with the server
  // clock; the client never computes or simulates it.
  const delayedCheck = prepared && content && bundle.state ? delayedCheckInfo(bundle.state, content, new Date()) : null;
  // Learner-facing visit labels (follow-on M1): computed here from the state + served content so the parent
  // cockpit shows "Besuch 3" for the observation chapter exactly like the child sees it; ids stay stable.
  const visits = prepared && content && bundle.state
    ? content.visits.map((v) => ({ id: v.id as VisitId, ordinal: visitOrdinal(bundle.state!, v.id), label: visitLabel(bundle.state!, content!, v.id), retired: v.id === "v3" && !bundle.state!.visits.some((r) => r.id === "v3") }))
    : [];
  return NextResponse.json({ ...bundle, prepared, contentCounts: counts, owner: parent.adminEmail, delayedCheck, visits }, { headers: NO_STORE });
}
