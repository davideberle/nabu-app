import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { loadLearningContent, loadVocabularyInventory } from "@/lib/family-learning-content-server";
import { readEvidence, readTelemetryEvents } from "@/lib/family-learning-db";
import { delayedCheckInfo, summariseTelemetry, visitLabel, visitOrdinal } from "@/lib/family-learning-summary";
import type { VocabularyInventory } from "@/lib/family-learning-vocabulary";
import type { VisitId } from "@/lib/family-learning-content";
import { missionEvidence, planningInput } from "@/lib/family-learning-mission";
import { noktModeFromEnv } from "@/lib/family-learning-nokt";
import { noktTalkEvidence } from "@/lib/family-learning-nokt-talk";

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
  // Visit 6 (content v5): the next-visit planning input — the child's verbatim interest answers, open retrieval items and the
  // typing calibration, derived from the same state (nothing stored separately).
  const planning = prepared && content && bundle.state && content.reflection.nextInterest ? planningInput(bundle.state, content) : null;
  // Visit 7 (content v6, V7-D14): per scene mission, observed answers, help, tutor judgments, missing evidence and later checks — apart.
  const missions = [];
  if (prepared && content && bundle.state) {
    // Content v7: the map mission (Visit 8) has the same parent view.
    for (const m of (content.missions ?? []).filter((x) => x.presentation === "scene" || x.presentation === "map")) {
      const ev = missionEvidence(bundle.state, content, m.visit as VisitId, noktModeFromEnv(process.env));
      if (!ev) continue;
      // Per-step foreground activity from the EXISTING telemetry batches (no extra collection): what was on screen while input happened.
      const events = await readTelemetryEvents(await getDb(), child, m.visit);
      const t = summariseTelemetry(events, 0, null);
      missions.push({ ...ev, time: { observed: t.uxObserved, byStep: t.byStep ?? {}, idleRuleSeconds: t.idleRuleSeconds, hiddenIntervals: t.hiddenIntervals } });
    }
  }
  // Content v7: Nokt's conversations outside the task talk (Home, welcome, visit, writing, look back) with provenance — never an assessment.
  const noktTalks = prepared && content && bundle.state ? noktTalkEvidence(bundle.state, content) : [];
  return NextResponse.json({ ...bundle, prepared, contentCounts: counts, owner: parent.adminEmail, delayedCheck, visits, planningInput: planning, missionEvidence: missions, noktMode: noktModeFromEnv(process.env), noktTalks }, { headers: NO_STORE });
}
