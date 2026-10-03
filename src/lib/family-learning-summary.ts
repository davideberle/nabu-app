// ---------------------------------------------------------------------------
// Evidence-bound visit summary, scene model, delayed-check explanation and
// parent review (approved redesign 2026-09-29: F2/W4, F3a/V1, F4/C2, F6/R3).
//
// Everything here is pure and deterministic over the saved mission state and
// the reviewed content. Nothing is inferred that the records do not carry:
//  - praise cites an actual record (attempt id / sample / burst), never
//    persistence, concentration, listening or finger technique;
//  - the next recommendation branches on success vs. support vs. difficulty
//    vs. missing data, not on whether an attempt merely exists;
//  - the parent review separates learning claims from UX hypotheses, names
//    telemetry missingness explicitly and never calls page time attention.
// ---------------------------------------------------------------------------

import type { LearningContent, ScoredMathItemId, VisitId } from "./family-learning-content.ts";
import { mathItem } from "./family-learning-content.ts";
import type { MathAttempt, MissionState, TypingBurst, VisitRecord } from "./family-learning-state.ts";
import type { LessonFeedback } from "./family-learning-feedback.ts";

// ---------------------------------------------------------------------------
// Delayed check
// ---------------------------------------------------------------------------

export type DelayAnchor = { kind: "teaching" | "visit1-completion"; at: string } | null;

/** Anchor for the delayed check with its provenance (never a silent fallback). */
export function delayAnchorInfo(state: MissionState): DelayAnchor {
  if (state.teachingFirstAt) return { kind: "teaching", at: state.teachingFirstAt };
  const v1 = state.visits.find((v) => v.id === "v1" && v.finishedAt);
  return v1?.finishedAt ? { kind: "visit1-completion", at: v1.finishedAt } : null;
}

export function delayAnchor(state: MissionState): string | null {
  return delayAnchorInfo(state)?.at ?? null;
}

export type DelayedCheckInfo = {
  visit: "v3";
  /**
   * Since 2026-09-30 the pilot's delayed check is RETIRED: `retired` (never offered, no date),
   * `running` (a v3 that was in flight before the retirement resumes to completion) or `done`
   * (a historical completed v3). The former `open` / `waiting` / `no-anchor` statuses no longer occur;
   * they remain in the type so stored JSON from before the retirement still type-checks.
   */
  status: "done" | "running" | "retired" | "open" | "waiting" | "no-anchor";
  availableAt: string | null;
  anchor: DelayAnchor;
  minDays: number;
  /** Child-facing explanation (German). */
  childText: string;
  /** Parent-facing rationale (German). */
  parentText: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-CH", { day: "numeric", month: "long" });
}

/** The date David retired the pilot's delayed-check visit (DESIGN §7.6, September 30 follow-on). */
export const DELAYED_CHECK_RETIRED_ON = "2026-09-30";

/**
 * Explains the retired delayed check honestly. The content (`v3`, `EQ-DELAY`) stays readable for
 * historical records; nothing here computes or shows an opening date any more, and `now` is
 * unused (kept for signature stability). Historical work (a finished or still-running v3) keeps
 * its meaning.
 */
export function delayedCheckInfo(state: MissionState, content: LearningContent, now: Date): DelayedCheckInfo | null {
  void now;
  const def = content.visits.find((v) => v.id === "v3");
  if (!def) return null;
  const minDays = def.minDaysAfterTeaching ?? 6;
  const anchor = delayAnchorInfo(state);
  const record = state.visits.find((v) => v.id === "v3") ?? null;
  const anchorText = anchor?.kind === "teaching" ? "seit der Erklärung im ersten Besuch" : anchor?.kind === "visit1-completion" ? "seit dem Ende des ersten Besuchs (es gab keine Erklärung, deshalb zählt der Besuch)" : "kein Anker";
  if (record?.finishedAt) {
    return { visit: "v3", status: "done", availableAt: null, anchor, minDays, childText: "Der späte Check von früher ist geschafft.", parentText: `Der späte Check (EQ-DELAY, historischer Besuch v3) wurde am ${formatDate(record.finishedAt)} durchgeführt, vor seiner Zurückziehung am 30. September 2026. Anker damals: ${anchorText}. Die Aufzeichnung bleibt unverändert.` };
  }
  if (record) {
    return { visit: "v3", status: "running", availableAt: null, anchor, minDays, childText: "Deine angefangene Aufgabe von früher wartet auf dich.", parentText: `Der späte Check (EQ-DELAY, Besuch v3) war am 30. September 2026 bereits angefangen (seit ${formatDate(record.startedAt)}) und kann zu Ende gebracht werden; danach wird er nicht mehr angeboten.` };
  }
  return {
    visit: "v3",
    status: "retired",
    availableAt: null,
    anchor,
    minDays,
    childText: "",
    parentText: `Der späte Check (EQ-DELAY, 32 ÷ 4, Besuch v3 der Pilot-Inhalte) wurde am 30. September 2026 zurückgezogen: er wird nicht mehr angeboten, hat keinen Termin und ist keine ausstehende Arbeit. Der Inhalt bleibt unter seiner stabilen Kennung lesbar. Eine spätere Abruf-Aufgabe mit Abstand wäre eine neue, separat geprüfte Aktivität — nie dieser Besuch und nie eine Aufgabe am selben Tag.`,
  };
}

// ---------------------------------------------------------------------------
// Learner-facing visit numbering (follow-on, 2026-09-30)
// ---------------------------------------------------------------------------

/**
 * The number the child and the parent see for a visit. Internal ids stay
 * stable (`v4` is the observation chapter); the learner-facing sequence is
 * v1 → 1, v2 → 2, v4 → 3. The retired `v3` has no number unless this child
 * actually has a v3 record (started before the retirement): then it keeps 3
 * and the chapter is 4, so nothing historical is renumbered.
 */
export function visitOrdinal(state: MissionState, id: VisitId): number | null {
  const hasV3Record = state.visits.some((v) => v.id === "v3");
  switch (id) {
    case "v1": return 1;
    case "v2": return 2;
    case "v3": return hasV3Record ? 3 : null;
    case "v4": return hasV3Record ? 4 : 3;
  }
}

/** The subtitle of a visit as reviewed in the content (the part after the em-dash), or the id. */
export function visitSubtitle(content: LearningContent, id: VisitId): string {
  const title = content.visits.find((v) => v.id === id)?.title ?? null;
  if (!title) return id;
  const parts = title.split(" — ");
  return parts.length > 1 ? parts.slice(1).join(" — ") : title;
}

/** "Besuch 3 — Die Beobachtungsstation" for `v4`; the retired check without a record is labelled as such. */
export function visitLabel(state: MissionState, content: LearningContent, id: VisitId): string {
  const ordinal = visitOrdinal(state, id);
  const subtitle = visitSubtitle(content, id);
  if (ordinal === null) return `${subtitle} (zurückgezogen)`;
  return `Besuch ${ordinal} — ${subtitle}`;
}

// ---------------------------------------------------------------------------
// Scene model — what the durable state looks like, for both surfaces
// ---------------------------------------------------------------------------

export type SceneModel = {
  location: string | null;
  /** Base construction stage, derived from durable records only. */
  base: "none" | "tent" | "hut" | "hut-garden";
  name: string | null;
  stores: { key: string; count: number }[];
  /** Garden beds from EQ-RETURN (4 beds) and the station beds from EQ-STATION (5 beds, six each, leftovers shown). */
  beds: { id: string; filled: number; capacity: number | null }[];
  leftovers: number;
  station: { theme: string | null; spot: string | null; built: boolean; lamp: boolean };
  pagesSaved: number;
};

export function buildSceneModel(state: MissionState, content: LearningContent): SceneModel {
  const v1Done = state.visits.some((v) => v.id === "v1" && v.finishedAt);
  const ret = state.math["EQ-RETURN"];
  const garden = ret && ret.outcome !== "pending" && ret.outcome !== "stopped";
  const station = state.station;
  const stationItem = state.math["EQ-STATION"];
  const stationBedsDone = stationItem && (stationItem.outcome === "correct" || stationItem.outcome === "taught");
  const beds: SceneModel["beds"] = [];
  if (garden && ret) {
    const per = ret.allocation ?? 0;
    for (let i = 0; i < 4; i += 1) beds.push({ id: `garden-${i + 1}`, filled: per, capacity: null });
  }
  let leftovers = 0;
  if (stationBedsDone && stationItem) {
    const def = content.math.items.find((m) => m.id === "EQ-STATION");
    const per = def?.perGroup ?? 6;
    for (let i = 0; i < (def?.groups ?? 5); i += 1) beds.push({ id: `station-${i + 1}`, filled: per, capacity: per });
    leftovers = stationItem.remainderResult?.remaining ?? def?.answers?.remaining ?? 0;
  }
  return {
    location: state.base.locationId,
    base: !state.base.name ? "none" : !v1Done ? "tent" : garden ? "hut-garden" : "hut",
    name: state.base.name,
    stores: Object.entries(state.base.supplies).filter(([, n]) => n > 0).map(([key, count]) => ({ key, count })),
    beds,
    leftovers,
    station: { theme: station?.theme ?? null, spot: station?.spot ?? null, built: station?.built ?? false, lamp: station?.lampLit ?? false },
    pagesSaved: state.pages.length,
  };
}

// ---------------------------------------------------------------------------
// Visit summary — one success, one practice focus, one next step, the artifact
// ---------------------------------------------------------------------------

export type SummaryLine = { text: string; basis: string };
export type RecommendationBranch = "success-easy" | "success" | "supported" | "struggling" | "missing-data";

export type VisitSummary = {
  visit: VisitId;
  title: string;
  success: SummaryLine | null;
  practiced: SummaryLine | null;
  next: SummaryLine & { branch: RecommendationBranch };
  artifact: { kind: "page" | "station" | "revision" | "none"; text: string };
};

function visitRecord(state: MissionState, visitId: VisitId): VisitRecord | null {
  return state.visits.find((v) => v.id === visitId) ?? null;
}

/** Whether a record belongs to the visit: by its visit id when recorded, else by the visit's time window (historical records). */
function belongsTo(visit: VisitRecord, record: { visit?: VisitId; at: string }): boolean {
  if (record.visit) return record.visit === visit.id;
  const end = visit.finishedAt ?? "9999";
  return record.at >= visit.startedAt && record.at <= end;
}

function attemptsInVisit(state: MissionState, visit: VisitRecord): { id: ScoredMathItemId; attempt: MathAttempt }[] {
  const out: { id: ScoredMathItemId; attempt: MathAttempt }[] = [];
  for (const [id, item] of Object.entries(state.math)) {
    if (!item) continue;
    for (const a of item.attempts) if (belongsTo(visit, a)) out.push({ id: id as ScoredMathItemId, attempt: a });
  }
  return out;
}

function burstsInVisit(state: MissionState, visit: VisitRecord): TypingBurst[] {
  const end = visit.finishedAt ?? "9999";
  return (state.typing.course?.bursts ?? []).filter((b) => b.at >= visit.startedAt && b.at <= end);
}

function unitPhrase(content: LearningContent, id: ScoredMathItemId, item: MathAttempt): string {
  const def = mathItem(content, id);
  if (def.kind === "remainder" && item.remainder) return `${def.quantity} ${def.unit.plural} auf ${def.groups} ${def.group.plural} — ${item.remainder.used} gepflanzt, ${item.remainder.remaining} übrig`;
  return `${def.quantity} ${def.unit.plural} gerecht auf ${def.groups} ${def.group.plural} verteilt`;
}

export function recommendNext(state: MissionState, content: LearningContent, visitId: VisitId): VisitSummary["next"] {
  const visit = visitRecord(state, visitId);
  if (!visit) return { branch: "missing-data", text: "Noch kein Besuch — wir beginnen mit der Basis.", basis: "no visit record" };
  const attempts = attemptsInVisit(state, visit);
  const bursts = burstsInVisit(state, visit);
  const langRecords = Object.values(state.language).flatMap((seg) => (seg ? seg.records : [])).filter((r) => belongsTo(visit, r));
  if (attempts.length === 0 && bursts.length === 0 && langRecords.length === 0) {
    return { branch: "missing-data", text: "Wir wissen noch nicht genug — nächstes Mal starten wir mit einer kurzen Aufgabe und schauen dann weiter.", basis: "no attempts, bursts or language records in this visit" };
  }
  const substantive = attempts.filter((a) => a.attempt.correct !== null);
  const anyTaughtOrStopped = Object.values(state.math).some((m) => m && (m.outcome === "taught" || m.outcome === "stopped") && m.shownVisit === visit.id);
  const lowBursts = bursts.filter((b) => b.accuracy < (content.typing.course?.progression.minAccuracy ?? 0.9) || b.comfort === "hard");
  if (anyTaughtOrStopped || substantive.filter((a) => a.attempt.correct === false).length >= 2 || (bursts.length > 0 && lowBursts.length === bursts.length)) {
    const focus = anyTaughtOrStopped ? "dieselbe Art Aufgabe, aber kleiner — mit den Beeten zum Legen" : lowBursts.length ? `noch einmal die Tasten ${lowBursts[0].lessonId.replace("TYPE-CH-COURSE-", "Lektion ")} in einem kurzen Durchgang` : "eine kleinere Aufgabe zum gleichen Thema";
    return { branch: "struggling", text: `Nächstes Mal: ${focus}. Stoppen ist immer erlaubt.`, basis: anyTaughtOrStopped ? "an item was taught or stopped in this visit" : "two incorrect substantive attempts or all typing bursts below the threshold" };
  }
  const independent = substantive.filter((a) => a.attempt.evidence === "independent");
  const supported = substantive.filter((a) => a.attempt.evidence === "supported" || a.attempt.evidence === "answer_exposed");
  if (independent.length > 0 && supported.length === 0 && visit.reflection === "easy") {
    return { branch: "success-easy", text: "Nächstes Mal: eine grössere Aufgabe mit Rest — und beim Tippen die nächsten Tasten.", basis: `${independent.length} independent correct attempt(s), no support, reflection "easy"` };
  }
  if (independent.length > 0 && supported.length === 0) {
    return { branch: "success", text: "Nächstes Mal: dieselbe Art Aufgabe in einer neuen Situation.", basis: `${independent.length} independent correct attempt(s), no support` };
  }
  return { branch: "supported", text: "Nächstes Mal: dieselbe Aufgabe noch einmal, zuerst ohne Hilfe probieren — die Hilfe bleibt da.", basis: supported.length ? `${supported.length} correct attempt(s) used support or an exposed answer` : "no independent math evidence in this visit" };
}

export function buildVisitSummary(state: MissionState, content: LearningContent, visitId: VisitId): VisitSummary {
  const visit = visitRecord(state, visitId);
  const title = content.visits.some((v) => v.id === visitId) ? visitLabel(state, content, visitId) : visitId;
  const next = recommendNext(state, content, visitId);
  if (!visit) return { visit: visitId, title, success: null, practiced: null, next, artifact: { kind: "none", text: "Noch nichts erstellt." } };
  const end = visit.finishedAt ?? "9999";
  const inVisit = (at: string) => at >= visit.startedAt && at <= end;
  const attempts = attemptsInVisit(state, visit);
  const bursts = burstsInVisit(state, visit);
  const minAccuracy = content.typing.course?.progression.minAccuracy ?? 0.9;
  const revision = state.logRevisions.find((r) => r.visit === visitId && inVisit(r.at)) ?? null;
  const transfer = (state.transfers ?? []).find((r) => r.visit === visitId && inVisit(r.at)) ?? null;
  const page = [...state.pages].reverse().find((p) => p.visit === visitId && inVisit(p.at)) ?? null;
  const langRecords = Object.entries(state.language).flatMap(([id, seg]) => (seg ? seg.records.map((r) => ({ id, r })) : [])).filter((x) => belongsTo(visit, x.r));

  // --- success: the strongest actual record, in a fixed order
  let success: SummaryLine | null = null;
  const independent = attempts.find((a) => a.attempt.evidence === "independent");
  const supportedCorrect = attempts.find((a) => a.attempt.correct === true && (a.attempt.evidence === "supported" || a.attempt.evidence === "answer_exposed"));
  const taught = Object.entries(state.math).find(([, m]) => m && m.outcome === "taught" && m.shownVisit === visit.id);
  const phrase = langRecords.find((x) => x.r.evidence === "production" && x.r.correct === true);
  const goodBurst = bursts.find((b) => b.accuracy >= minAccuracy);
  if (independent) success = { text: `Du hast ${unitPhrase(content, independent.id, independent.attempt)} — ohne Hilfe, beim ersten Versuch.`, basis: `attempt ${independent.id}#${independent.attempt.no} independent` };
  else if (supportedCorrect) success = { text: `Du hast ${unitPhrase(content, supportedCorrect.id, supportedCorrect.attempt)} — mit Hilfe gelöst.`, basis: `attempt ${supportedCorrect.id}#${supportedCorrect.attempt.no} ${supportedCorrect.attempt.evidence}` };
  else if (taught) success = { text: "Wir haben die Aufgabe mit dem Rest zusammen gelöst.", basis: `${taught[0]} taught` };
  else if (phrase) success = { text: `Du hast das Team auf Spanisch um etwas gebeten: „${phrase.r.response}“.`, basis: `${phrase.id}/${phrase.r.stepId} production correct (${phrase.r.support.length ? "with " + phrase.r.support.join(", ") : "no help"})` };
  else if (goodBurst) success = { text: `Beim Tippen hast du ${Math.round(goodBurst.accuracy * 100)} % der Zeichen richtig getroffen (${goodBurst.lessonId.replace("TYPE-CH-COURSE-", "Lektion ")}).`, basis: `burst ${goodBurst.lessonId} accuracy ${goodBurst.accuracy.toFixed(2)}` };
  else if (transfer && transfer.outcome === "clean" && (transfer.assessed ?? 0) > 0 && transfer.modality === "typed") success = { text: transfer.helpExposed ? `Dein neuer Satz hatte an ${transfer.assessed} geprüften ${transfer.assessed === 1 ? "Stelle" : "Stellen"} das Leerzeichen richtig — nach der Hilfe von vorhin.` : `Dein neuer Satz hatte an ${transfer.assessed} geprüften ${transfer.assessed === 1 ? "Stelle" : "Stellen"} das Leerzeichen richtig — ganz ohne Hilfe.`, basis: `transfer ${transfer.id} clean, ${transfer.assessed} assessed (${transfer.helpExposed ? "revision help shown earlier" : "no help"})` };
  else if (revision && revision.outcome === "revised") success = { text: "Du hast die Leerzeichen in deinem Satz selbst eingesetzt.", basis: `log revision resolved ${revision.resolved}/${revision.flagged.length}` };
  else if (page) success = { text: "Du hast eine Seite ins Logbuch geschrieben.", basis: "expedition page saved" };

  // --- practiced: the first actual difficulty, in a fixed order
  let practiced: SummaryLine | null = null;
  const incorrect = attempts.find((a) => a.attempt.correct === false);
  const unscored = attempts.find((a) => a.attempt.correct === null);
  const lowBurst = bursts.find((b) => b.accuracy < minAccuracy || b.comfort === "hard");
  const langWrong = langRecords.find((x) => x.r.correct === false || (x.r.evidence === "production" && x.r.correct === null));
  if (incorrect) practiced = { text: incorrect.id === "EQ-STATION" ? "Geübt: erst die vollen Beete rechnen, dann den Rest." : "Geübt: gerecht teilen — noch einmal genau nachzählen.", basis: `attempt ${incorrect.id}#${incorrect.attempt.no} incorrect` };
  else if (lowBurst) practiced = { text: `Geübt: die Tasten aus ${lowBurst.lessonId.replace("TYPE-CH-COURSE-", "Lektion ")} — langsam und genau${lowBurst.comfort === "hard" ? ", das war anstrengend" : ""}.`, basis: `burst ${lowBurst.lessonId} accuracy ${lowBurst.accuracy.toFixed(2)} comfort ${lowBurst.comfort}` };
  else if (revision && (revision.outcome === "partial" || revision.outcome === "unchanged")) practiced = { text: `Geübt: Leerzeichen zwischen den Wörtern (${revision.resolved} von ${revision.flagged.length} Stellen).`, basis: `log revision ${revision.outcome}` };
  else if (transfer && transfer.outcome === "flagged") practiced = { text: `Geübt: Leerzeichen im neuen Satz (${transfer.flagged.length} ${transfer.flagged.length === 1 ? "Stelle" : "Stellen"} fehlten noch).`, basis: `transfer ${transfer.id} flagged ${transfer.flagged.length}` };
  else if (langWrong) practiced = { text: "Geübt: das richtige Wort für die Lieferung.", basis: `${langWrong.id}/${langWrong.r.stepId} ${langWrong.r.correct === false ? "incorrect" : "unscored"}` };
  else if (unscored) practiced = { text: "Geübt: die Antwort klar sagen oder tippen.", basis: `attempt ${unscored.id}#${unscored.attempt.no} unscored (${unscored.attempt.uncertainty ?? "?"})` };
  else if (visit.skippedStages.length) practiced = { text: `Heute ausgelassen: ${visit.skippedStages.map((s) => s.stage).join(", ")}.`, basis: "skipped stages" };

  // --- artifact
  let artifact: VisitSummary["artifact"] = { kind: "none", text: "Heute ist keine Seite entstanden." };
  if (revision && revision.revised) artifact = { kind: "revision", text: revision.revised };
  else if (page) artifact = { kind: "page", text: page.modality === "spoken" ? `${page.text} (gesprochen, dann gespeichert)` : page.text };
  else if (state.station?.built && state.station.builtAt && inVisit(state.station.builtAt)) artifact = { kind: "station", text: `Die Station steht${state.station.lampLit ? " und die Lampe brennt" : ""}.` };

  return { visit: visitId, title, success, practiced, next, artifact };
}

// ---------------------------------------------------------------------------
// Parent review — learning and UX separated, missingness explicit
// ---------------------------------------------------------------------------

export type TelemetryEvent = { t: number; kind: string; stage?: string | null; detail?: Record<string, unknown> };

export type TelemetrySummary = {
  /** Any telemetry rows exist for the visit (server-owned feedback counts). */
  supported: boolean;
  batches: number;
  events: number;
  /**
   * R5-2: whether the CLIENT's UX observations reached the server at all. The
   * server-owned feedback batch proves nothing about client activity; when no
   * UX event was delivered, every UX metric below is null (unknown), never 0.
   */
  uxObserved: boolean;
  uxEvents: number;
  feedbackEvents: number;
  /** Seconds with input activity under the idle rule; never called attention. null = not observed. */
  foregroundActiveSeconds: number | null;
  idleRuleSeconds: number;
  hiddenIntervals: number | null;
  saveFailures: number | null;
  retries: number | null;
  corrections: number | null;
  hints: number | null;
  pauses: number | null;
  byStage: Record<string, { enters: number; activeSeconds: number }>;
  /** Stages of the visit with no UX observation at all (skipped or not delivered); null when nothing was observed. */
  unobservedStages: string[] | null;
};

export const IDLE_RULE_SECONDS = 60;

/** Summarise a child's telemetry batches; absent telemetry stays explicitly absent. */
export function summariseTelemetry(events: TelemetryEvent[] | null, batches = 0, visitStages: string[] | null = null): TelemetrySummary {
  const feedbackEvents = events ? events.filter((e) => e.kind === "feedback").length : 0;
  const uxEvents = events ? events.length - feedbackEvents : 0;
  const uxObserved = uxEvents > 0;
  const summary: TelemetrySummary = { supported: events !== null, batches: events === null ? 0 : batches, events: events?.length ?? 0, uxObserved, uxEvents, feedbackEvents, foregroundActiveSeconds: null, idleRuleSeconds: IDLE_RULE_SECONDS, hiddenIntervals: null, saveFailures: null, retries: null, corrections: null, hints: null, pauses: null, byStage: {}, unobservedStages: null };
  if (!events || !uxObserved) return summary;
  summary.hiddenIntervals = 0;
  summary.saveFailures = 0;
  summary.retries = 0;
  summary.corrections = 0;
  summary.hints = 0;
  summary.pauses = 0;
  let active = 0;
  for (const e of events) {
    if (e.kind === "active-interval") {
      const seconds = typeof e.detail?.seconds === "number" ? Math.max(0, Math.min(e.detail.seconds, 3600)) : 0;
      active += seconds;
      const stage = e.stage ?? "?";
      summary.byStage[stage] = summary.byStage[stage] ?? { enters: 0, activeSeconds: 0 };
      summary.byStage[stage].activeSeconds += seconds;
    } else if (e.kind === "stage-enter") {
      const stage = e.stage ?? "?";
      summary.byStage[stage] = summary.byStage[stage] ?? { enters: 0, activeSeconds: 0 };
      summary.byStage[stage].enters += 1;
    } else if (e.kind === "hidden") summary.hiddenIntervals += 1;
    else if (e.kind === "save-failure") summary.saveFailures += 1;
    else if (e.kind === "retry") summary.retries += 1;
    else if (e.kind === "correction") summary.corrections += 1;
    else if (e.kind === "hint") summary.hints += 1;
    else if (e.kind === "pause") summary.pauses += 1;
  }
  summary.foregroundActiveSeconds = active;
  if (visitStages) summary.unobservedStages = visitStages.filter((s) => !summary.byStage[s]);
  return summary;
}

/**
 * Version of the derivation rules used for a stored review. 3 = round-3
 * assessment of transfer evidence (R4-3); 4 = client UX observations are
 * reported as unknown when none were delivered (R5-2). A stored review whose
 * version differs is re-derived on read where the served content allows it.
 */
/**
 * 5 = world-first 2026-10-03: the review carries the lesson-by-lesson feedback the child saw
 * (`learning.lessons`), so parent evidence and the child report are the same derivation.
 */
export const REVIEW_VERSION = 5;
/** The review version in which the LEARNING classification rules last changed; older stored learning credit is obsolete. */
export const LEARNING_RULES_VERSION = 3;

export type ParentReview = {
  identity: { child: string; missionId: string; contentVersion: number; visit: VisitId; startedAt: string; finishedAt: string | null; completionId: string; reviewVersion?: number; derivedAt?: string };
  historical: boolean;
  /** Earlier derivations of the same completion, kept for provenance when a review was refreshed (newest last, bounded). */
  previousReviews?: { reviewVersion: number; derivedAt: string | null; objectives: ParentReview["learning"]["objectives"]; whatHappened: string[] }[];
  learning: {
    whatHappened: string[];
    objectives: { taskId: string; version: number; objective: string; outcome: string; evidence: string; support: string[]; uncertainty: string | null }[];
    teachNext: { text: string; why: string; uncertainty: string };
    childSummary: VisitSummary;
    /** The per-lesson feedback exactly as the child's report shows it (world-first 2026-10-03); absent on older stored reviews. */
    lessons?: LessonFeedback[];
  };
  experience: {
    hypotheses: { observation: string; alternatives: string[]; suggestion: string }[];
    telemetry: TelemetrySummary;
    /** What the child actually said (difficulty, enjoyment, clarity); explicitly skipped, left open and not-offered dimensions stay distinct. */
    childFeedback: { difficulty: string | null; enjoyment: string | null; clarity: string | null; skipped: string[]; unanswered: string[]; notOffered: string[] };
    missing: string[];
  };
  recommendation: VisitSummary["next"];
};

export function completionIdentity(state: MissionState, visit: VisitRecord): string {
  return `${state.child}/${state.missionId}/${visit.id}/${visit.startedAt}`;
}

export function buildParentReview(state: MissionState, content: LearningContent, visitId: VisitId, telemetry: TelemetryEvent[] | null, options: { historical: boolean; contentVersion?: number; telemetryBatches?: number; derivedAt?: string; lessons?: LessonFeedback[] }): ParentReview {
  const visit = visitRecord(state, visitId);
  const summary = buildVisitSummary(state, content, visitId);
  const tele = summariseTelemetry(telemetry, options.telemetryBatches ?? 0, content.visits.find((v) => v.id === visitId)?.stages ?? null);
  const missing: string[] = [];
  if (!visit) {
    return {
      identity: { child: state.child, missionId: state.missionId, contentVersion: options.contentVersion ?? state.contentVersion, visit: visitId, startedAt: "", finishedAt: null, completionId: `${state.child}/${state.missionId}/${visitId}/none`, reviewVersion: REVIEW_VERSION, derivedAt: options.derivedAt ?? new Date().toISOString() },
      historical: options.historical,
      learning: { whatHappened: ["Kein Besuch aufgezeichnet."], objectives: [], teachNext: { text: "Mit der Basis beginnen.", why: "Es gibt keine Aufzeichnung.", uncertainty: "Keine Daten." }, childSummary: summary },
      experience: { hypotheses: [], telemetry: tele, childFeedback: { difficulty: null, enjoyment: null, clarity: null, skipped: [], unanswered: [], notOffered: ["enjoyment", "clarity"] }, missing: ["Kein Besuch, keine Telemetrie."] },
      recommendation: summary.next,
    };
  }
  const end = visit.finishedAt ?? "9999";
  const inVisit = (at: string) => at >= visit.startedAt && at <= end;
  const objectives: ParentReview["learning"]["objectives"] = [];
  const whatHappened: string[] = [];
  for (const [id, item] of Object.entries(state.math)) {
    if (!item) continue;
    for (const a of item.attempts.filter((x) => belongsTo(visit, x))) {
      const def = mathItem(content, id as ScoredMathItemId);
      objectives.push({ taskId: id, version: def.version, objective: def.kind === "remainder" ? "equal-sharing-with-remainder" : "equal-sharing", outcome: a.correct === null ? "unscored" : a.correct ? "correct" : "incorrect", evidence: a.evidence, support: a.support, uncertainty: a.uncertainty });
    }
    if (item.attempts.some((x) => belongsTo(visit, x))) {
      const last = item.attempts.filter((x) => belongsTo(visit, x)).pop()!;
      whatHappened.push(`${id}: ${item.attempts.filter((x) => belongsTo(visit, x)).length} Versuch(e), zuletzt ${last.correct === null ? "unbewertet" : last.correct ? "richtig" : "falsch"} (${last.evidence}${last.support.length ? ", Hilfe: " + last.support.join(", ") : ""}).`);
    }
  }
  for (const [id, seg] of Object.entries(state.language)) {
    if (!seg) continue;
    for (const r of seg.records.filter((x) => belongsTo(visit, x))) {
      objectives.push({ taskId: `${id}/${r.stepId}`, version: 1, objective: `language-${r.evidence}`, outcome: r.correct === null ? "unscored" : r.correct ? "correct" : "incorrect", evidence: r.correct === null ? "unscored" : !r.correct ? "incorrect" : r.support.length ? "supported" : "independent", support: r.support, uncertainty: r.uncertainty ?? null });
    }
    const prods = seg.records.filter((x) => belongsTo(visit, x) && x.evidence === "production");
    if (prods.length) whatHappened.push(`${id}: ${prods.length} Produktion(en); Formen: ${prods.map((p) => `„${p.response}“ (${p.correct === true ? "richtig" : p.correct === false ? "falsch" : "unbewertet"}${p.support.length ? ", " + p.support.join("/") : ""})`).join("; ")}. Eine Wortergänzung ist keine Satzproduktion; „La planta necesita agua“ ist eine andere Konstruktion als „Necesitamos …“.`);
  }
  const bursts = burstsInVisit(state, visit);
  if (bursts.length) whatHappened.push(`Tippen: ${bursts.length} Durchgang/Durchgänge (${bursts.map((b) => `${b.lessonId.replace("TYPE-CH-COURSE-", "L")} ${Math.round(b.accuracy * 100)} % ${b.comfort}`).join(", ")}); Genauigkeit des fertigen Texts, keine Aussage über Fingertechnik.`);
  const revision = state.logRevisions.find((r) => r.visit === visitId && inVisit(r.at));
  if (revision) whatHappened.push(`Logbuch-Überarbeitung: ${revision.outcome} (${revision.resolved}/${revision.flagged.length} Leerzeichen-Stellen), Original erhalten, Modalität ${revision.modality}.`);
  for (const t of (state.transfers ?? []).filter((r) => r.visit === visitId && inVisit(r.at))) {
    // Legacy records (before round 3) have no assessed count: never credited, shown as unknown.
    const legacy = t.assessed === undefined && t.outcome !== "skipped";
    const unassessable = legacy || t.outcome === "unassessable";
    const outcome = t.outcome === "skipped" ? "skipped" : unassessable ? "unscored" : t.outcome === "clean" ? "correct" : "incorrect";
    const evidence = t.outcome === "skipped" || unassessable || t.modality === "spoken" ? "unscored" : t.outcome === "flagged" ? "incorrect" : t.helpExposed ? "supported" : "independent";
    const uncertainty = legacy ? "Aufzeichnung vor dem 30.09.2026 (Runde 3): keine Zählung der geprüften Stellen — nicht bewertet" : t.modality === "spoken" ? "gesprochen: Leerzeichen stammen aus der Transkription" : unassessable ? "keine der drei geprüften Leerzeichen-Stellen kommt im Satz vor — nichts zu bewerten (kein Erfolg, kein Fehler)" : "nur die drei geprüften Leerzeichen-Fälle; keine Aussage über Rechtschreibung oder andere Stellen";
    objectives.push({ taskId: t.id, version: t.version, objective: "writing-spacing-transfer", outcome, evidence, support: t.helpExposed ? ["revision-help"] : [], uncertainty });
    whatHappened.push(
      t.outcome === "skipped"
        ? "Neuer Satz (Transfer): übersprungen."
        : unassessable
          ? `Neuer Satz (Transfer, ${t.id}): keine geprüfte Leerzeichen-Stelle im Satz — nicht bewertet; Hilfe vorher gezeigt: ${t.helpExposed ? "ja" : "nein"}; Modalität ${t.modality}.`
          : `Neuer Satz (Transfer, ${t.id}): ${t.assessed} geprüfte ${t.assessed === 1 ? "Stelle" : "Stellen"}, davon ${t.flagged.length === 0 ? "alle richtig" : `${t.flagged.length} ohne Leerzeichen`}; Hilfe vorher gezeigt: ${t.helpExposed ? "ja" : "nein"}; Modalität ${t.modality}.`,
    );
  }
  const spokenPages = state.pages.filter((p) => p.visit === visitId && inVisit(p.at) && p.modality === "spoken");
  if (spokenPages.length) whatHappened.push(`Logbuchseite gesprochen (${spokenPages.length}): Rechtschreibung und Leerzeichen stammen aus der Transkription, nicht vom Kind.`);
  if (state.typing.alignment && inVisit(state.typing.alignment.checkedAt)) whatHappened.push(`Tastatur-Check: ${state.typing.alignment.result === "match" ? "Eingabequelle passt zur bestätigten Tastatur" : "Eingabequelle passt NICHT — Übungen blieben gesperrt"}.`);
  if (visit.reflection) whatHappened.push(`Selbsteinschätzung: ${visit.reflection}.`);
  if (whatHappened.length === 0) whatHappened.push("Keine bewerteten Aufzeichnungen in diesem Besuch.");

  const next = summary.next;
  const teachNext = {
    text: next.text,
    why: next.basis,
    uncertainty: options.historical ? "Historischer Besuch: nachträglich aus den gespeicherten Aufzeichnungen erstellt, ohne Telemetrie. Unbeobachtete Hilfe von Erwachsenen ist nicht ausgeschlossen." : "Unbeobachtete Hilfe von Erwachsenen ist nicht ausgeschlossen; eine richtige Antwort ist kein Beleg für Beherrschung.",
  };

  const hypotheses: ParentReview["experience"]["hypotheses"] = [];
  if (tele.supported && !tele.uxObserved) {
    // R5-2: only the server-owned feedback arrived; nothing is known about the client's activity.
    missing.push("Bedienungs-Daten: nicht erfasst — vom Gerät kam keine Beobachtung an (nur die Antworten des Kindes sind gespeichert). Aktive Zeit, Fenster-Wechsel, Pausen, Speicherfehler und Wiederholungen sind unbekannt, nicht null.");
  } else if (tele.supported) {
    missing.push(`Bedienungs-Daten aus ${tele.batches} übermittelten Paket(en); nicht angekommene Pakete fehlen ohne Hinweis.${tele.unobservedStages?.length ? ` Ohne Beobachtung: ${tele.unobservedStages.join(", ")} (übersprungen oder nicht übermittelt).` : ""}`);
  }
  if (tele.supported && tele.uxObserved && tele.saveFailures !== null && tele.retries !== null && tele.hiddenIntervals !== null) {
    if (tele.saveFailures > 0) hypotheses.push({ observation: `${tele.saveFailures} fehlgeschlagene Speicherung(en).`, alternatives: ["Netz/Server langsam", "Tab-Wechsel während des Speicherns"], suggestion: "Speichern-Status länger sichtbar lassen; Wiederholen-Knopf prüfen." });
    if (tele.retries > 3) hypotheses.push({ observation: `${tele.retries} Wiederholungen.`, alternatives: ["Unklare Beschriftung", "langsame Antwort", "Ausprobieren"], suggestion: "Beschriftung der betroffenen Kontrolle prüfen." });
    if (tele.hiddenIntervals > 0) hypotheses.push({ observation: `${tele.hiddenIntervals} Mal war der Tab im Hintergrund.`, alternatives: ["Pause", "Gespräch mit Eltern", "Ablenkung"], suggestion: "Keine — Hintergrundzeit wird nicht als Aufmerksamkeit gezählt." });
  } else {
    missing.push("Keine Telemetrie für diesen Besuch: Zeiten, Wiederholungen und Speicherfehler sind unbekannt.");
  }
  if (!state.typing.alignment) missing.push("Kein Tastatur-Check aufgezeichnet.");
  if (bursts.length === 0) missing.push("Keine Tipp-Durchgänge in diesem Besuch.");
  const fb = visit.feedback ?? null;
  const childFeedback = {
    difficulty: visit.reflection,
    enjoyment: fb?.answers.enjoyment ?? null,
    clarity: fb?.answers.clarity ?? null,
    skipped: fb?.skipped ?? [],
    unanswered: fb?.unanswered ?? [],
    notOffered: fb ? ["difficulty", "enjoyment", "clarity"].filter((d) => !fb.offered.includes(d)) : ["enjoyment", "clarity"],
  };
  if (!visit.reflection) missing.push(fb?.skipped.includes("difficulty") ? "Schwierigkeit: vom Kind bewusst nicht gesagt." : fb?.unanswered?.includes("difficulty") ? "Schwierigkeit: offen gelassen." : "Keine Selbsteinschätzung (Schwierigkeit).");
  if (!fb) missing.push("Spass und Klarheit wurden in diesem Besuch nicht abgefragt (Inhalte ohne Feedback-Dimensionen).");
  else {
    const sk = fb.skipped.filter((d) => d !== "difficulty");
    const un = (fb.unanswered ?? []).filter((d) => d !== "difficulty");
    if (sk.length) missing.push(`Vom Kind bewusst nicht gesagt: ${sk.join(", ")}.`);
    if (un.length) missing.push(`Offen gelassen: ${un.join(", ")}.`);
  }

  return {
    identity: { child: state.child, missionId: state.missionId, contentVersion: options.contentVersion ?? state.contentVersion, visit: visitId, startedAt: visit.startedAt, finishedAt: visit.finishedAt, completionId: completionIdentity(state, visit), reviewVersion: REVIEW_VERSION, derivedAt: options.derivedAt ?? new Date().toISOString() },
    historical: options.historical,
    learning: { whatHappened, objectives, teachNext, childSummary: summary, lessons: options.lessons ?? [] },
    experience: { hypotheses, telemetry: tele, childFeedback, missing },
    recommendation: next,
  };
}
