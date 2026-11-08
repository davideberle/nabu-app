// ---------------------------------------------------------------------------
// Step 2 B (2026-11-02): the home-map part of the child view — only when FAMILY_HOME_MAP enables it for this child.
// Read-only: built from the child's own mission state and served content; nothing is written, no schema change.
// ---------------------------------------------------------------------------

import type { LearningContent } from "./family-learning-content.ts";
import type { MissionState } from "./family-learning-state.ts";
import type { MissionView } from "./family-learning-mission.ts";
import type { HomeWorldInput } from "./family-home-map.ts";

export type HomeMapView = {
  input: Omit<HomeWorldInput, "seen" | "lastPlace">;
  /** Where the avatar stands in the running mission (run.position); null before a visit starts. */
  position: string | null;
  /** The running visit can be finished now (the look back is reached from the map). */
  canFinish: boolean;
  presentation: string | null;
};

type ViewPart = { visit: { id: string } | null; next: { visit: string | null; reason?: string | null }; mission: Pick<MissionView, "places" | "steps" | "position" | "canFinish" | "presentation"> | null };

/** The choices the child made in «decide» steps (step → viable option picked), across all mission runs. */
export function missionChoices(state: MissionState, content: LearningContent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of content.missions ?? []) {
    const run = state.missions?.[def.id];
    if (!run) continue;
    for (const step of def.steps) {
      if (step.kind !== "decide" || !step.decide) continue;
      const pick = run.steps?.[step.id]?.attempts?.find((a) => a.choice && step.decide!.options.find((o) => o.id === a.choice)?.viable);
      if (pick?.choice) out[step.id] = pick.choice;
    }
  }
  return out;
}

export function homeMapViewFor(state: MissionState, content: LearningContent, view: ViewPart): HomeMapView {
  const visits = state.visits.map((v) => ({ id: v.id as string, finishedAt: v.finishedAt }));
  const choices = missionChoices(state, content);
  const running = view.visit?.id ?? null;
  const nextVisit = !running && view.next.visit && !view.next.reason ? view.next.visit : null;
  const visitId = running ?? nextVisit;
  const def = visitId ? (content.missions ?? []).find((m) => m.visit === visitId) ?? null : null;
  let current: HomeWorldInput["current"] = null;
  if (visitId && def) {
    if (running && view.mission) {
      // A running mission: the places with work now are today's stations.
      const work = new Set(view.mission.steps.filter((s) => s.status === "available" || s.status === "active").map((s) => s.place));
      const places = view.mission.places.filter((p) => work.has(p.id)).map((p) => ({ id: p.id, label: p.label, kind: p.kind }));
      current = { visit: visitId, mission: def.id, places, start: view.mission.position };
    } else {
      // Not started yet: the visit begins where its mission begins.
      const start = def.map.places.find((p) => p.id === def.map.start) ?? def.map.places[0] ?? null;
      current = { visit: visitId, mission: def.id, places: start ? [{ id: start.id, label: start.label, kind: start.kind }] : [], start: null };
    }
  }
  return { input: { child: state.child, visits, choices, current, story: state.story }, position: running && view.mission ? view.mission.position : null, canFinish: !!(running && view.mission?.canFinish), presentation: def?.presentation ?? null };
}
