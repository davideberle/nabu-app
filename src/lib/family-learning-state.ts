// ---------------------------------------------------------------------------
// Family Assistant learning cockpit — mission state machine.
//
// Pure and deterministic: every transition takes the current state, the
// reviewed content, the parent settings, a clock and an id source, and returns
// the next state plus the rows to persist. Nothing here touches the network,
// the database or React, so `node --test` covers the teaching, scoring and
// exposure rules directly (family-assistant/learning/CONTRACT.md).
//
// Authority never comes from this module's inputs: the child identity is bound
// by the caller from the verified learning credential, and the answer keys are
// read from the server-side content only. Views built for the browser strip
// the keys (`buildChildView`).
//
// Content version 2 (approved redesign, 2026-09-29) is handled ADDITIVELY:
// a saved version-1 mission is upgraded in memory by `upgradeMissionState`
// (missing records get compatible defaults, nothing is reset, reclassified or
// renumbered), the visit-4 chapter, the remainder item, the Spanish request,
// the Swiss-German typing course with its input-alignment check, the spacing
// revision and the visit summary are new stages/ops, and the delayed check
// keeps its real clock and anchor provenance.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import {
  hasLanguageSegment,
  hasMathItem,
  isLanguageSegmentId,
  isScoredMathItemId,
  languageSegment,
  mathItem,
  typingCourseForLayout,
  typingLessonForLayout,
  type KeyboardLayoutId,
  type LanguageSegment,
  type LanguageSegmentId,
  type LanguageStep,
  type LearningContent,
  type MathItem,
  type MathItemId,
  type ScoredMathItemId,
  type StageId,
  type TypingCourseLesson,
  type VisitId,
} from "./family-learning-content.ts";
import { buildSceneModel, buildVisitSummary, delayAnchor, delayedCheckInfo, visitLabel, visitOrdinal, type DelayedCheckInfo, type SceneModel, type VisitSummary } from "./family-learning-summary.ts";
import { buildProgress, type ProgressStrip, type ProgressSources } from "./family-learning-progress.ts";
import { buildVocabularyLedger, childVocabularyCue, type VocabularyInventory, type ChildVocabularyCue } from "./family-learning-vocabulary.ts";
import { alignTyping, alignedLessonMetrics, TYPING_METRIC_VERSION, type AlignedLineMetrics } from "./family-learning-typing-metrics.ts";
import { assessSpacing, evaluateRevision, flagSpacing, markSpacing, suggestSpacing, type SpacingFlag } from "./family-learning-writing.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type EvidenceCategory = "independent" | "supported" | "answer_exposed" | "incorrect" | "unscored";
export type ExposureKind = "none" | "shown" | "answer_revealed";
export type MathPhase = "answer" | "clarify" | "represent" | "example" | "teach-or-stop" | "done";
export type AnswerModality = "typed" | "counters" | "spoken" | "word-choice";

export type SupportKind =
  | "read_aloud"
  | "gloss"
  | "counters"
  | "representation"
  | "clarification"
  | "example"
  | "tutor_question"
  | "tutor_reply"
  | "direct_teaching"
  | "step_down"
  | "word_choice";

/** Support kinds that make a correct answer `supported` rather than independent. */
const ANSWER_RELEVANT_SUPPORT: readonly SupportKind[] = [
  "counters",
  "representation",
  "clarification",
  "example",
  "tutor_question",
  "tutor_reply",
  "step_down",
  "word_choice",
];

export type MathAttempt = {
  no: number;
  /** Visit the attempt was made in (absent on historical records; the time window is used then). */
  visit?: VisitId;
  answer: number | null;
  /** Remainder items: the two requested numbers as answered. */
  remainder?: { used: number | null; remaining: number | null } | null;
  raw: string;
  modality: AnswerModality;
  correct: boolean | null;
  evidence: EvidenceCategory;
  support: SupportKind[];
  exposureBefore: ExposureKind;
  fresh: boolean;
  uncertainty: string | null;
  teachingMove: string | null;
  teachingReason: string | null;
  at: string;
};

export type MathItemState = {
  shownAt: string | null;
  shownVisit: VisitId | null;
  exposure: ExposureKind;
  phase: MathPhase;
  attempts: MathAttempt[];
  /**
   * Every answer-relevant support kind ever recorded for this item. Cumulative
   * and never cleared: an uncertain transcript, a reload, a cancelled tutor
   * turn or a later attempt cannot make earlier help disappear (CONTRACT rule 1).
   */
  supportGiven: SupportKind[];
  /** The child's accepted allocation, once the item is resolved. */
  allocation: number | null;
  /** Remainder items: the accepted (used, remaining) pair once resolved. */
  remainderResult?: { used: number; remaining: number } | null;
  resolvedAt: string | null;
  outcome: "pending" | "correct" | "taught" | "stopped";
};

export type LanguageStepRecord = {
  stepId: string;
  evidence: "recognition" | "production" | "completion" | "listen";
  correct: boolean | null;
  uncertainty?: string | null;
  response: string;
  modality: AnswerModality | "listen";
  support: ("gloss" | "audio" | "word-choice" | "tutor" | "retry" | "feedback")[];
  /** Visit the record was made in (absent on historical records). */
  visit?: VisitId;
  /** Theme-dependent sentence variant actually shown (round 2). */
  variant?: string;
  at: string;
};

/** Durable help recorded for a language segment, written before the help is shown. */
export type LanguageHelp = { gloss: string[]; audio: string[]; wordChoice: string[]; tutor: number };

export type LanguageSegmentState = {
  stepIndex: number;
  records: LanguageStepRecord[];
  help: LanguageHelp;
  done: boolean;
  skipped: "time" | "child" | null;
};

export type ProductionKind = "independent" | "copying" | "repetition" | "glossed";

export type TypingLineMetrics = { expectedChars: number; typedChars: number; correctChars: number; extraChars: number; omittedChars: number; substitutedChars?: number; metricVersion?: 1 | 2 };

export type TypingLessonRecord = {
  lessonId: string;
  layout: KeyboardLayoutId;
  /** Per line, in lesson order — insertions on one line never cancel omissions on another. */
  lines: TypingLineMetrics[];
  expectedChars: number;
  typedChars: number;
  correctChars: number;
  extraChars: number;
  omittedChars: number;
  substitutedChars?: number;
  /** Σ max(expected_i, typed_i): the denominator of the accuracy ratio. */
  denominator: number;
  /** Absent on historical (positional, version-1) records. */
  metricVersion?: 1 | 2;
  seconds: number;
  at: string;
};

export type TypingLabelRecord = {
  taskId: string;
  target: string;
  typed: string;
  expectedChars: number;
  typedChars: number;
  correctChars: number;
  extraChars: number;
  omittedChars: number;
  substitutedChars?: number;
  metricVersion?: 1 | 2;
  seconds: number;
  at: string;
};

export type TypingComfort = "easy" | "ok" | "hard";

/** One short course burst (redesign F1/T2–T4): metric version 2, comfort self-rated. */
export type TypingBurst = {
  lessonId: string;
  visit: VisitId;
  /** Number of lesson lines typed (a "smaller" burst types a prefix); undefined = all lines (records before 2026-09-30). */
  lineCount?: number;
  lines: AlignedLineMetrics[];
  expectedChars: number;
  typedChars: number;
  correctChars: number;
  extraChars: number;
  omittedChars: number;
  substitutedChars: number;
  denominator: number;
  accuracy: number;
  comfort: TypingComfort;
  metricVersion: 2;
  seconds: number;
  at: string;
};

export type TypingCourseDecision = { lessonId: string; action: "start" | "repeat" | "smaller" | "advance" | "stop"; reason: string; at: string };

export type TypingCourseState = {
  layout: KeyboardLayoutId;
  /** Index of the current lesson in the course. */
  lessonIndex: number;
  bursts: TypingBurst[];
  decision: TypingCourseDecision | null;
  /** Lessons whose progression criteria were met. */
  completed: string[];
};

export type TypingAlignment = {
  layout: KeyboardLayoutId;
  checkedAt: string;
  result: "match" | "mismatch";
  observed: { id: string; expected: string; got: string }[];
  /** Which layout the observed characters match, if any (parent-readable). */
  matchesLayout: KeyboardLayoutId | null;
};

export type StationState = {
  theme: string | null;
  chosenAt: string | null;
  spot: string | null;
  built: boolean;
  builtAt: string | null;
  lampLit: boolean;
};

export type LogRevision = {
  visit: VisitId;
  original: string;
  revised: string | null;
  flagged: SpacingFlag[];
  resolved: number;
  outcome: "revised" | "partial" | "unchanged" | "skipped" | "no-flags";
  modality: "typed" | "spoken";
  helpShown: boolean;
  at: string;
};

export type ExpeditionPage = {
  visit: VisitId;
  /** How the page text was entered (absent on pages saved before 2026-09-30 round 3). */
  modality?: "typed" | "spoken";
  title: string;
  baseName: string;
  locationId: string | null;
  supplies: Record<string, number>;
  explanation: string | null;
  text: string;
  at: string;
};

export type VisitRecord = {
  id: VisitId;
  startedAt: string;
  finishedAt: string | null;
  stageIndex: number;
  skippedStages: { stage: StageId; reason: "time" | "child" }[];
  /** Difficulty self-assessment (content reflection option id). */
  reflection: string | null;
  /** Optional child feedback (round 2, R2-5): answered dimensions, explicitly skipped dimensions; absent when the content offered none. */
  feedback?: VisitFeedback;
};

/** Explicitly skipped ("Lieber nicht sagen") is distinct from left open (unanswered); both are distinct from not offered by the content. */
export type VisitFeedback = { answers: Record<string, string>; skipped: string[]; unanswered?: string[]; offered: string[] };

/** The fresh writing-transfer check (round 2, R2-3): a NEW sentence after the revision. */
export type TransferRecord = {
  id: string;
  version: number;
  visit: VisitId;
  text: string | null;
  modality: "typed" | "spoken";
  flagged: SpacingFlag[];
  /** Reviewed boundaries that actually occur in the sentence (correct + flagged); 0 = unassessable (R3-1). Absent on records written before 2026-09-30 round 3. */
  assessed?: number;
  outcome: "clean" | "flagged" | "unassessable" | "skipped";
  /** Whether the spacing help (revision) had been shown earlier in the same visit. */
  helpExposed: boolean;
  /** The revision record this transfer follows, if any. */
  linkedRevisionAt: string | null;
  at: string;
};

export type MissionState = {
  missionId: string;
  contentVersion: number;
  child: ChildId;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Set once by the additive upgrade to content version 2 (historical reviews are dated before it). */
  upgradedAt?: string | null;
  base: { name: string | null; locationId: string | null; supplies: Record<string, number> };
  pages: ExpeditionPage[];
  visits: VisitRecord[];
  currentVisit: VisitId | null;
  math: Partial<Record<ScoredMathItemId, MathItemState>>;
  modelShownAt: string | null;
  /** The remainder teaching example (EQ-STATION-MODEL) shown once. */
  stationModelShownAt?: string | null;
  /** First teaching move in visit 1 — the anchor for the delayed check. */
  teachingFirstAt: string | null;
  explanations: { visit: VisitId; text: string; modality: AnswerModality; taskId?: string | null; at: string }[];
  language: Partial<Record<LanguageSegmentId, LanguageSegmentState>>;
  typing: {
    lessons: TypingLessonRecord[];
    labels: TypingLabelRecord[];
    skipped: { visit: VisitId; reason: "time" | "child" }[];
    course?: TypingCourseState | null;
    alignment?: TypingAlignment | null;
  };
  station?: StationState;
  logRevisions: LogRevision[];
  transfers?: TransferRecord[];
};

export type ParentSettings = {
  keyboardLayout: KeyboardLayoutId | null;
  missionTitle: string | null;
  missionHook: string | null;
  languageVarietyEn: string | null;
  languageVarietyEs: string | null;
};

export const EMPTY_PARENT_SETTINGS: ParentSettings = {
  keyboardLayout: null,
  missionTitle: null,
  missionHook: null,
  languageVarietyEn: null,
  languageVarietyEs: null,
};

const SCORED_IDS: readonly ScoredMathItemId[] = ["EQ-ENTRY", "EQ-FRESH", "EQ-RETURN", "EQ-DELAY", "EQ-STATION"];

function emptyMathState(): MathItemState {
  return {
    shownAt: null,
    shownVisit: null,
    exposure: "none",
    phase: "answer",
    attempts: [],
    supportGiven: [],
    allocation: null,
    remainderResult: null,
    resolvedAt: null,
    outcome: "pending",
  };
}

function emptyLanguageState(): LanguageSegmentState {
  return { stepIndex: 0, records: [], help: { gloss: [], audio: [], wordChoice: [], tutor: 0 }, done: false, skipped: null };
}

function emptyStation(): StationState {
  return { theme: null, chosenAt: null, spot: null, built: false, builtAt: null, lampLit: false };
}

export function newMissionState(content: LearningContent, child: ChildId, nowIso: string): MissionState {
  const math: MissionState["math"] = {};
  for (const id of SCORED_IDS) if (hasMathItem(content, id)) math[id] = emptyMathState();
  const language: MissionState["language"] = {};
  for (const segment of content.language.segments) language[segment.id] = emptyLanguageState();
  return {
    missionId: content.contentId,
    contentVersion: content.contentVersion,
    child,
    revision: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    upgradedAt: null,
    base: { name: null, locationId: null, supplies: {} },
    pages: [],
    visits: [],
    currentVisit: null,
    math,
    modelShownAt: null,
    stationModelShownAt: null,
    teachingFirstAt: null,
    explanations: [],
    language,
    typing: { lessons: [], labels: [], skipped: [], course: null, alignment: null },
    station: emptyStation(),
    logRevisions: [],
    transfers: [],
  };
}

/**
 * Additive, idempotent upgrade of a saved mission to the given content
 * version: missing math/language records, the station, the typing course
 * slot, the alignment slot and the revision list get compatible defaults;
 * nothing existing is changed, renumbered or reclassified. In-flight visits
 * keep their stage index because the version-1 visit stage lists are
 * unchanged in version 2. Running it twice yields the same state.
 */
export function upgradeMissionState(input: MissionState, content: LearningContent, nowIso: string): { state: MissionState; changed: boolean } {
  let changed = false;
  const state = clone(input);
  for (const id of SCORED_IDS) {
    if (hasMathItem(content, id) && !state.math[id]) {
      state.math[id] = emptyMathState();
      changed = true;
    }
  }
  for (const segment of content.language.segments) {
    if (!state.language[segment.id]) {
      state.language[segment.id] = emptyLanguageState();
      changed = true;
    }
  }
  if (!state.station) {
    state.station = emptyStation();
    changed = true;
  }
  if (!Array.isArray(state.logRevisions)) {
    state.logRevisions = [];
    changed = true;
  }
  if (!Array.isArray(state.transfers)) {
    state.transfers = [];
    changed = true;
  }
  // Records written before round 3 (2026-09-30) lack `assessed`: recompute it from the stored text so a sentence
  // without any reviewed boundary is shown as unassessable instead of keeping a false "clean" credit.
  for (const t of state.transfers) {
    if (t.assessed === undefined && typeof t.text === "string") {
      const a = assessSpacing(t.text, content.writing?.spacing.joins ?? []);
      t.assessed = a.assessed;
      if (!a.assessable && t.outcome === "clean") t.outcome = "unassessable";
      changed = true;
    }
  }
  if (state.typing.course === undefined) {
    state.typing.course = null;
    changed = true;
  }
  if (state.typing.alignment === undefined) {
    state.typing.alignment = null;
    changed = true;
  }
  if (state.stationModelShownAt === undefined) {
    state.stationModelShownAt = null;
    changed = true;
  }
  // Only ever upgrade: under a lower served content version (cap / rollback) the
  // saved shape is kept as is, so returning to the newer content resumes exactly.
  if (state.contentVersion < content.contentVersion) {
    state.contentVersion = content.contentVersion;
    state.upgradedAt = nowIso;
    changed = true;
  }
  if (state.upgradedAt === undefined) {
    state.upgradedAt = null;
    changed = true;
  }
  return { state, changed };
}

function mathState(state: MissionState, id: ScoredMathItemId): MathItemState {
  const item = state.math[id];
  if (!item) throw new LearningOpError("not-available", `item ${id} is not part of this mission`);
  return item;
}

function languageState(state: MissionState, id: LanguageSegmentId): LanguageSegmentState {
  const seg = state.language[id];
  if (!seg) throw new LearningOpError("not-available", `segment ${id} is not part of this mission`);
  return seg;
}

// ---------------------------------------------------------------------------
// Rows to persist (derived, append-only)
// ---------------------------------------------------------------------------

export type AttemptRow = {
  id: string;
  visitId: VisitId;
  taskId: string;
  taskVersion: number;
  objective: string;
  attemptNo: number;
  answer: unknown;
  correct: boolean | null;
  evidence: EvidenceCategory;
  support: string[];
  exposureBefore: string;
  stimulusLanguage: string;
  responseLanguage: string | null;
  modality: string;
  uncertainty: string | null;
  teachingMove: string | null;
  teachingReason: string | null;
  secondsSinceTeaching: number | null;
  at: string;
};

export type ExposureRow = { taskId: string; taskVersion: number; kind: "shown" | "example_shown" | "answer_revealed"; source: string; at: string };
export type SupportRow = { id: string; visitId: VisitId; taskId: string | null; kind: SupportKind; payload: unknown; at: string };
export type SampleRow = {
  id: string;
  visitId: VisitId;
  taskId: string | null;
  kind: "explanation" | "expedition_log" | "expedition_log_revision" | "writing_transfer" | "typed_label" | "language_response" | "typing_practice" | "typing_burst";
  language: string | null;
  modality: string;
  text: string;
  metrics: unknown;
  at: string;
};

export type Records = { attempts: AttemptRow[]; exposures: ExposureRow[]; supports: SupportRow[]; samples: SampleRow[] };

function emptyRecords(): Records {
  return { attempts: [], exposures: [], supports: [], samples: [] };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type LearningOp =
  | { op: "start-visit" }
  | { op: "resume-base" }
  | { op: "name-base"; name: string }
  | { op: "place-base"; locationId: string }
  | { op: "support"; taskId: string | null; kind: SupportKind; payload?: unknown }
  | { op: "answer-math"; itemId: ScoredMathItemId; answer: number | null; raw: string; modality: AnswerModality; uncertain?: boolean }
  | { op: "answer-remainder"; itemId: ScoredMathItemId; used: number | null; remaining: number | null; raw: string; modality: AnswerModality; uncertain?: boolean }
  | { op: "request-teaching"; itemId: ScoredMathItemId }
  | { op: "stop-item"; itemId: ScoredMathItemId }
  | { op: "continue-item"; itemId: ScoredMathItemId }
  | { op: "explain"; text: string; modality: AnswerModality }
  | { op: "language-step"; segmentId: LanguageSegmentId; stepId: string; response: string; modality: AnswerModality | "listen"; transcriptConfirmed?: boolean }
  | { op: "typing-lesson"; lessonId: string; lines: string[]; seconds: number }
  | { op: "language-continue"; segmentId: LanguageSegmentId; stepId: string }
  | { op: "typing-label"; taskId: string; typed: string; seconds: number }
  | { op: "typing-check"; observed: string[] }
  | { op: "typing-burst"; lessonId: string; lines: string[]; seconds: number; comfort: TypingComfort }
  | { op: "typing-course-continue" }
  | { op: "choose-station"; theme: string }
  | { op: "build-station"; spot: string }
  | { op: "revise-log"; text: string }
  | { op: "summary-seen" }
  | { op: "skip-stage"; stage: StageId; reason: "time" | "child" }
  | { op: "save-log"; text: string; modality?: "typed" | "spoken" }
  | { op: "reflect"; optionId: string | null; difficultySkipped?: boolean; feedback?: { enjoyment?: string | null; clarity?: string | null } }
  | { op: "write-transfer"; text: string; modality?: "typed" | "spoken" };

export type OpEnv = { content: LearningContent; settings: ParentSettings; now: () => Date; newId: () => string };

export class LearningOpError extends Error {
  readonly code: "invalid" | "not-allowed" | "not-available" | "stale" | "copied-text";
  constructor(code: "invalid" | "not-allowed" | "not-available" | "stale" | "copied-text", message: string) {
    super(message);
    this.code = code;
  }
}

export type OpResult = { state: MissionState; records: Records; result: Record<string, unknown>; finishedVisit?: VisitId | null };

const ISO = (d: Date) => d.toISOString();
const MAX_NAME_CHARS = 40;
const MAX_TEXT_CHARS = 600;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function visitDef(content: LearningContent, id: VisitId) {
  const def = content.visits.find((v) => v.id === id);
  if (!def) throw new LearningOpError("invalid", `unknown visit ${id}`);
  return def;
}

/** Like visitDef but tolerant: a visit the served content does not know (e.g. under a content cap / rollback) yields undefined. */
function findVisitDef(content: LearningContent, id: VisitId) {
  return content.visits.find((v) => v.id === id);
}

/** True when the running visit exists in the state but not in the served content (parked, never touched). */
export function runningVisitUnavailable(state: MissionState, content: LearningContent): boolean {
  const running = state.visits.find((v) => v.finishedAt === null);
  return !!running && !findVisitDef(content, running.id);
}

function currentVisit(state: MissionState): VisitRecord {
  const visit = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null);
  if (!visit) throw new LearningOpError("not-allowed", "no visit is running");
  return visit;
}

export function currentStage(state: MissionState, content: LearningContent): StageId | null {
  if (!state.currentVisit) return null;
  const visit = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null);
  if (!visit) return null;
  const def = findVisitDef(content, visit.id);
  return def?.stages[visit.stageIndex] ?? null;
}

function requireStage(state: MissionState, content: LearningContent, stage: StageId) {
  const active = currentStage(state, content);
  if (active !== stage) {
    throw new LearningOpError("not-allowed", `stage ${stage} is not active (current: ${active ?? "none"})`);
  }
}

function advance(state: MissionState, content: LearningContent) {
  const visit = currentVisit(state);
  visit.stageIndex += 1;
  const def = visitDef(content, visit.id);
  // Stages that can no longer apply are skipped honestly, never faked.
  while (visit.stageIndex < def.stages.length) {
    const stage = def.stages[visit.stageIndex];
    if (stage === "restore" && !state.base.name) {
      visit.stageIndex += 1;
      continue;
    }
    break;
  }
}

/**
 * Next visit the child may start, or the reason none can start yet.
 * Progression (DESIGN §7.6 "September 30 follow-on"): v1, v2, then the
 * observation-station chapter v4 immediately (shown as Visit 3). The pilot's
 * delayed-check visit `v3` was retired by David on 2026-09-30: it is never
 * offered from a fresh, two-visit or completed state and never waits with a
 * date. Existing work is never rewritten: a v3 that was RUNNING before the
 * retirement resumes to completion (a running visit always takes precedence),
 * and a FINISHED v3 stays recorded and counted. Under the content cap (no v4
 * in the served content) nothing further is offered — honestly, not v3.
 * `now` is kept for signature stability; availability is no longer time-bound.
 */
export function nextVisitAvailability(
  state: MissionState,
  content: LearningContent,
  now: Date,
): { visit: VisitId; availableAt: null } | { visit: VisitId | null; availableAt: string | null; reason: string } {
  void now;
  const running = state.visits.find((v) => v.finishedAt === null);
  // A running visit the served content does not define (content cap /
  // rollback) is parked: nothing else is offered and nothing is changed.
  if (running && !findVisitDef(content, running.id)) return { visit: null, availableAt: null, reason: "chapter-unavailable" };
  if (running) return { visit: running.id, availableAt: null };
  const finished = state.visits.filter((v) => v.finishedAt !== null).map((v) => v.id);
  if (!finished.includes("v1")) return { visit: "v1", availableAt: null };
  if (!finished.includes("v2")) return { visit: "v2", availableAt: null };
  const hasV4 = content.visits.some((v) => v.id === "v4");
  if (hasV4 && !finished.includes("v4")) return { visit: "v4", availableAt: null };
  if (!hasV4) return { visit: null, availableAt: null, reason: "no-further-visit-served" };
  return { visit: null, availableAt: null, reason: "all-visits-done" };
}

/** The retired delayed-check visit id (kept readable for historical records; never offered). */
export const RETIRED_VISIT_IDS: readonly VisitId[] = ["v3"];

function scoredItemForStage(stage: StageId | null): ScoredMathItemId | null {
  return stage && (SCORED_IDS as readonly string[]).includes(stage) ? (stage as ScoredMathItemId) : null;
}

/**
 * Durable "shown" exposure for the active scored item. Called by the server
 * before the item is rendered; idempotent. Returns the rows to write and
 * whether the state changed.
 */
export function ensureItemShown(state: MissionState, content: LearningContent, now: Date): { state: MissionState; records: Records; changed: boolean } {
  const stage = currentStage(state, content);
  const itemId = scoredItemForStage(stage);
  if (!itemId) return { state, records: emptyRecords(), changed: false };
  const item = state.math[itemId];
  if (!item || item.shownAt) return { state, records: emptyRecords(), changed: false };
  const next = clone(state);
  const nowIso = ISO(now);
  const nextItem = next.math[itemId]!;
  nextItem.shownAt = nowIso;
  nextItem.shownVisit = next.currentVisit;
  nextItem.exposure = "shown";
  const def = mathItem(content, itemId);
  const records = emptyRecords();
  records.exposures.push({ taskId: itemId, taskVersion: def.version, kind: "shown", source: "render", at: nowIso });
  return { state: next, records, changed: true };
}

export { delayAnchor };

function secondsSince(from: string | null, now: Date): number | null {
  if (!from) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 1000));
}

function noteTeaching(state: MissionState, nowIso: string) {
  if (!state.teachingFirstAt && state.currentVisit === "v1") state.teachingFirstAt = nowIso;
}

/** Deterministic classification of a tutor reply against one item's answer(s). */
export function tutorReplyRevealsAnswer(reply: string, item: MathItem): boolean {
  const answers = item.kind === "remainder" && item.answers ? [String(item.answers.used), String(item.answers.remaining)] : [String(item.answer)];
  const tokens = reply.toLowerCase().match(/\d+|[a-zäöüß]+/g) ?? [];
  // A standalone occurrence of an answer number anywhere in the reply is a
  // positive exposure signal. Combined phrasings ("je 6", "6 each",
  // "6 Pakete") are covered by the same token match.
  return tokens.some((t) => answers.includes(t));
}

function evidenceFor(item: MathItemState, correct: boolean | null, fresh: boolean): EvidenceCategory {
  if (correct === null) return "unscored";
  if (!correct) return "incorrect";
  if (item.exposure === "answer_revealed") return "answer_exposed";
  const substantive = item.attempts.filter((a) => a.correct !== null).length;
  const supported = item.supportGiven.some((k) => ANSWER_RELEVANT_SUPPORT.includes(k));
  if (substantive > 0 || supported || !fresh) return "supported";
  return "independent";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[.,!?;:¡¿"'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Positional typing accuracy — the historical (metric version 1) comparator,
 * kept only so old records keep their meaning. New records use the
 * alignment-aware metrics (`family-learning-typing-metrics.ts`).
 */
export function typingAccuracy(expected: string, typed: string): { expectedChars: number; typedChars: number; correctChars: number; extraChars: number } {
  const e = Array.from(expected);
  const t = Array.from(typed);
  let correct = 0;
  for (let i = 0; i < e.length; i += 1) if (t[i] === e[i]) correct += 1;
  return { expectedChars: e.length, typedChars: t.length, correctChars: correct, extraChars: Math.max(0, t.length - e.length) };
}

export function accuracyRatio(m: { expectedChars: number; typedChars: number; correctChars: number; denominator?: number }): number {
  const denominator = m.denominator ?? Math.max(m.expectedChars, m.typedChars);
  return denominator ? m.correctChars / denominator : 0;
}

/** Per-line metrics for a lesson (alignment-aware, metric version 2); aggregates keep insertions and omissions separate. */
export function lessonMetrics(expectedLines: string[], typedLines: string[]): Omit<TypingLessonRecord, "lessonId" | "layout" | "seconds" | "at"> {
  const m = alignedLessonMetrics(expectedLines, typedLines);
  return {
    lines: m.lines,
    expectedChars: m.expectedChars,
    typedChars: m.typedChars,
    correctChars: m.correctChars,
    extraChars: m.extraChars,
    omittedChars: m.omittedChars,
    substitutedChars: m.substitutedChars,
    denominator: m.denominator,
    metricVersion: TYPING_METRIC_VERSION,
  };
}

/**
 * Deterministic production scoring against the reviewed rubric lists:
 *  - accepted phrase → correct phrase production;
 *  - lexical completion (bare target word) → correct completion, not phrase;
 *  - keyword present but matching neither → unscored, pending clarification;
 *  - a distractor and no keyword → incorrect;
 *  - anything else → unscored (unclear), never asserted as inability.
 */
export function scoreProduction(
  step: Extract<LanguageStep, { kind: "produce" }>,
  response: string,
): { correct: boolean | null; completion: "phrase" | "lexical" | null; uncertainty: string | null } {
  const norm = normalizeText(response);
  const tokens = norm.split(" ");
  const has = (list: string[]) => list.some((entry) => norm === normalizeText(entry));
  const contains = (list: string[]) => list.some((entry) => tokens.includes(normalizeText(entry)));
  if (has(step.accepted)) return { correct: true, completion: "phrase", uncertainty: null };
  if (has(step.lexical)) return { correct: true, completion: "lexical", uncertainty: null };
  if (contains(step.keywords)) return { correct: null, completion: null, uncertainty: "noncanonical-pending-clarification" };
  if (contains(step.distractors)) return { correct: false, completion: null, uncertainty: null };
  return { correct: null, completion: null, uncertainty: "unclear-pending-clarification" };
}

function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new LearningOpError("invalid", `${label} must be text`);
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new LearningOpError("invalid", `${label} must not be empty`);
  if (trimmed.length > max) throw new LearningOpError("invalid", `${label} is too long`);
  return trimmed;
}

function findStep(segment: LanguageSegment, stepId: string): { step: LanguageStep; index: number } {
  const index = segment.steps.findIndex((s) => s.id === stepId);
  if (index < 0) throw new LearningOpError("invalid", `unknown step ${stepId}`);
  return { step: segment.steps[index], index };
}

/** The scored item an explanation refers to: the last item shown and resolved in this visit. */
function explainTarget(state: MissionState, visit: VisitId): ScoredMathItemId | null {
  const running = state.visits.find((v) => v.id === visit);
  if (!running) return null;
  let best: { id: ScoredMathItemId; at: string } | null = null;
  for (const [id, item] of Object.entries(state.math)) {
    if (!item || !item.resolvedAt || item.shownVisit !== visit) continue;
    if (!best || item.resolvedAt > best.at) best = { id: id as ScoredMathItemId, at: item.resolvedAt };
  }
  return best?.id ?? (visit === "v1" ? "EQ-FRESH" : null);
}

/** The course lesson the child is on, or null when no course applies. */
export function currentCourseLesson(state: MissionState, content: LearningContent, settings: ParentSettings): TypingCourseLesson | null {
  const course = typingCourseForLayout(content, settings.keyboardLayout);
  if (!course) return null;
  const index = state.typing.course && state.typing.course.layout === course.layout ? state.typing.course.lessonIndex : 0;
  return course.lessons[Math.min(index, course.lessons.length - 1)] ?? null;
}

/** Whether positional practice is genuinely available: layout confirmed AND the input source matched it on this device. */
export function practiceAvailability(state: MissionState, content: LearningContent, settings: ParentSettings): { available: boolean; reason: "layout-unconfirmed" | "alignment-unchecked" | "alignment-mismatch" | "no-course-for-layout" | null } {
  if (!settings.keyboardLayout) return { available: false, reason: "layout-unconfirmed" };
  const alignment = state.typing.alignment ?? null;
  if (!alignment || alignment.layout !== settings.keyboardLayout) return { available: false, reason: "alignment-unchecked" };
  if (alignment.result !== "match") return { available: false, reason: "alignment-mismatch" };
  if (!typingCourseForLayout(content, settings.keyboardLayout)) return { available: false, reason: "no-course-for-layout" };
  return { available: true, reason: null };
}

/**
 * Progression decision after a burst (redesign F1/T3): advance only when at
 * least `minBursts` bursts on this lesson reached `minAccuracy` and none of
 * those was rated "hard"; a low-accuracy or uncomfortable burst offers the
 * same lesson again (or a smaller burst after two of them); missing evidence
 * is not failure. Thresholds are the content's tunable parameters.
 */
export function decideProgression(course: TypingCourseState, lesson: TypingCourseLesson, lessonCount: number, progression: { minBursts: number; minAccuracy: number }, nowIso: string): TypingCourseDecision {
  const onLesson = course.bursts.filter((b) => b.lessonId === lesson.id);
  // Only full-length bursts count towards promotion; shortened bursts are practice.
  const good = onLesson.filter((b) => b.accuracy >= progression.minAccuracy && b.comfort !== "hard" && (b.lineCount === undefined || b.lineCount >= lesson.lines.length));
  const recentBad = onLesson.slice(-2).filter((b) => b.accuracy < progression.minAccuracy || b.comfort === "hard");
  if (good.length >= progression.minBursts) {
    const last = course.lessonIndex >= lessonCount - 1;
    return { lessonId: lesson.id, action: last ? "stop" : "advance", reason: `${good.length} bursts ≥ ${Math.round(progression.minAccuracy * 100)} % and not hard${last ? "; last lesson of the course" : ""}`, at: nowIso };
  }
  if (recentBad.length >= 2) return { lessonId: lesson.id, action: "smaller", reason: "two bursts in a row below the threshold or rated hard — a shorter burst or a stop", at: nowIso };
  if (onLesson.length && (onLesson[onLesson.length - 1].accuracy < progression.minAccuracy || onLesson[onLesson.length - 1].comfort === "hard")) {
    return { lessonId: lesson.id, action: "repeat", reason: "last burst below the threshold or rated hard — same keys again, no promotion", at: nowIso };
  }
  return { lessonId: lesson.id, action: "repeat", reason: `${good.length} of ${progression.minBursts} good bursts — one more on the same keys`, at: nowIso };
}

/**
 * Apply one operation. Throws `LearningOpError` for anything the current
 * state, stage or settings do not permit; never mutates its input.
 */
export function applyLearningOp(input: MissionState, op: LearningOp, env: OpEnv): OpResult {
  const { content } = env;
  const now = env.now();
  const nowIso = ISO(now);
  const state = clone(input);
  const records = emptyRecords();
  let result: Record<string, unknown> = {};
  let finishedVisit: VisitId | null = null;

  switch (op.op) {
    case "start-visit": {
      const availability = nextVisitAvailability(state, content, now);
      if (!availability.visit) {
        throw new LearningOpError("not-available", availability.availableAt ? `next visit opens ${availability.availableAt}` : availability.reason);
      }
      if (availability.availableAt === null && state.visits.some((v) => v.id === availability.visit && v.finishedAt === null)) {
        // Already running — idempotent resume.
        result = { visit: availability.visit, resumed: true };
        break;
      }
      state.visits.push({ id: availability.visit, startedAt: nowIso, finishedAt: null, stageIndex: 0, skippedStages: [], reflection: null });
      state.currentVisit = availability.visit;
      // `restore` is only meaningful when a base exists.
      const def = visitDef(content, availability.visit);
      if (def.stages[0] === "restore" && !state.base.name) currentVisit(state).stageIndex = 1;
      result = { visit: availability.visit, resumed: false };
      break;
    }

    case "resume-base": {
      requireStage(state, content, "restore");
      advance(state, content);
      break;
    }

    case "name-base": {
      requireStage(state, content, "name-base");
      state.base.name = boundedText(op.name, MAX_NAME_CHARS, "base name");
      advance(state, content);
      break;
    }

    case "place-base": {
      requireStage(state, content, "place-base");
      if (!content.locations.some((l) => l.id === op.locationId)) throw new LearningOpError("invalid", "unknown location");
      state.base.locationId = op.locationId;
      advance(state, content);
      break;
    }

    case "choose-station": {
      requireStage(state, content, "station-choice");
      const themes = content.station?.themes ?? [];
      if (op.theme !== "none" && !themes.some((t) => t.id === op.theme)) throw new LearningOpError("invalid", "unknown station theme");
      state.station = { ...(state.station ?? emptyStation()), theme: op.theme, chosenAt: nowIso };
      advance(state, content);
      result = { theme: op.theme };
      break;
    }

    case "build-station": {
      requireStage(state, content, "station-build");
      const spots = content.station?.spots ?? [];
      if (!spots.some((s) => s.id === op.spot)) throw new LearningOpError("invalid", "unknown station spot");
      const station = state.station ?? emptyStation();
      // The lamp is lit only if the Spanish request actually supplied one (durable supply).
      const lamp = (state.base.supplies["lámpara"] ?? 0) > 0;
      state.station = { ...station, spot: op.spot, built: true, builtAt: nowIso, lampLit: lamp };
      advance(state, content);
      result = { spot: op.spot, lampLit: lamp };
      break;
    }

    case "support": {
      const visit = currentVisit(state);
      const stage = currentStage(state, content);
      const activeItem = scoredItemForStage(stage);
      // The target is the task the client was helping with when the help was
      // requested. It may have advanced meanwhile (another tab, a late tutor
      // reply): the event is still recorded against the ORIGINAL task, so a
      // reply that reveals an answer is bound to that item, never lost.
      const target = op.taskId ?? activeItem ?? (isLanguageSegmentId(stage) ? stage : null);
      const targetItem = target !== null && isScoredMathItemId(target) && state.math[target] ? target : null;
      // Language task ids come from the view as "<segment>/<step>" (the tutor
      // context) or as the bare segment id (gloss, audio, word list). Both bind
      // to the segment's durable help ledger; the step is kept on the event.
      const segmentPart = target !== null ? target.split("/")[0] : null;
      const stepPart = target !== null && target.includes("/") ? target.slice(target.indexOf("/") + 1) : null;
      const targetSegment = isLanguageSegmentId(segmentPart) && state.language[segmentPart] ? segmentPart : null;
      if (target !== null && targetItem === null && targetSegment === null) {
        throw new LearningOpError("invalid", "support must name a known task");
      }
      if (targetSegment && stepPart !== null && !languageSegment(content, targetSegment).steps.some((s) => s.id === stepPart)) {
        throw new LearningOpError("invalid", "support must name a known step");
      }
      let payload: unknown = op.payload ?? null;
      const payloadRecord = (op.payload && typeof op.payload === "object" ? op.payload : {}) as Record<string, unknown>;
      if (targetItem) {
        const item = mathState(state, targetItem);
        if (ANSWER_RELEVANT_SUPPORT.includes(op.kind) && !item.supportGiven.includes(op.kind)) item.supportGiven.push(op.kind);
        if (op.kind === "tutor_reply") {
          const text = typeof payloadRecord.text === "string" ? payloadRecord.text : "";
          const revealed = tutorReplyRevealsAnswer(text, mathItem(content, targetItem));
          const classified = text.trim().length > 0;
          if (revealed && item.exposure !== "answer_revealed") {
            item.exposure = "answer_revealed";
            records.exposures.push({ taskId: targetItem, taskVersion: mathItem(content, targetItem).version, kind: "answer_revealed", source: "tutor_reply", at: nowIso });
          }
          payload = { ...payloadRecord, text: text.slice(0, 2000), revealed, classification: classified ? (revealed ? "answer_revealed" : "supported") : "unclassified" };
        }
        if (op.kind === "clarification" || op.kind === "representation" || op.kind === "example" || op.kind === "direct_teaching" || op.kind === "step_down") {
          noteTeaching(state, nowIso);
        }
      }
      if (targetSegment) {
        const help = languageState(state, targetSegment).help;
        const word = typeof payloadRecord.word === "string" ? payloadRecord.word.slice(0, 40) : null;
        const text = typeof payloadRecord.text === "string" ? payloadRecord.text.slice(0, 200) : null;
        if (op.kind === "gloss" && word && !help.gloss.includes(word)) help.gloss.push(word);
        if (op.kind === "read_aloud") help.audio.push(text ?? "sentence");
        if (op.kind === "word_choice") help.wordChoice.push(text ?? "opened");
        if (op.kind === "tutor_question" || op.kind === "tutor_reply") help.tutor += 1;
        if (op.kind === "tutor_reply") {
          payload = { ...payloadRecord, text: (text ?? "").slice(0, 2000), classification: "supported" };
        }
      }
      records.supports.push({ id: env.newId(), visitId: visit.id, taskId: target ?? stage, kind: op.kind, payload, at: nowIso });
      result = { recorded: op.kind, taskId: target ?? stage };
      break;
    }

    case "answer-math":
    case "answer-remainder": {
      requireStage(state, content, op.itemId);
      const def = mathItem(content, op.itemId);
      const item = mathState(state, op.itemId);
      const remainderItem = def.kind === "remainder";
      if (remainderItem !== (op.op === "answer-remainder")) throw new LearningOpError("invalid", remainderItem ? "this item asks for two numbers (used and remaining)" : "this item asks for one number");
      if (item.outcome !== "pending") throw new LearningOpError("not-allowed", "item already resolved");
      if (item.phase !== "answer" && item.phase !== "represent" && item.phase !== "clarify") {
        throw new LearningOpError("not-allowed", `item is in phase ${item.phase}`);
      }
      let uncertain: boolean;
      let answer: number | null = null;
      let remainder: MathAttempt["remainder"] = null;
      let correct: boolean | null;
      let partial: Record<string, unknown> = {};
      if (op.op === "answer-remainder") {
        uncertain = op.uncertain === true || op.used === null || op.remaining === null || !Number.isInteger(op.used) || !Number.isInteger(op.remaining);
        remainder = { used: uncertain ? null : op.used, remaining: uncertain ? null : op.remaining };
        const expected = def.answers!;
        const usedCorrect = remainder.used === expected.used;
        const remainingCorrect = remainder.remaining === expected.remaining;
        correct = uncertain ? null : usedCorrect && remainingCorrect;
        answer = remainder.used;
        partial = uncertain ? {} : { usedCorrect, remainingCorrect };
      } else {
        uncertain = op.uncertain === true || op.answer === null || !Number.isInteger(op.answer);
        answer = uncertain ? null : (op.answer as number);
        correct = answer === null ? null : answer === def.answer;
      }
      if (op.modality === "counters" && !item.supportGiven.includes("counters")) item.supportGiven.push("counters");
      const fresh = item.attempts.every((a) => a.correct === null) && item.exposure !== "answer_revealed" && (item.shownVisit === null || item.shownVisit === state.currentVisit);
      const evidence = evidenceFor(item, correct, fresh);
      const substantiveBefore = item.attempts.filter((a) => a.correct !== null).length;
      const attempt: MathAttempt = {
        no: item.attempts.length + 1,
        visit: state.currentVisit as VisitId,
        answer,
        remainder,
        raw: boundedText(op.raw || String(answer ?? ""), 80, "answer"),
        modality: op.modality,
        correct,
        evidence,
        support: [...item.supportGiven],
        exposureBefore: item.exposure,
        fresh,
        uncertainty: uncertain ? "transcript" : null,
        teachingMove: null,
        teachingReason: null,
        at: nowIso,
      };
      if (attempt.support.includes("counters") && attempt.evidence === "independent") attempt.evidence = "supported";

      let feedback: MathPhase;
      if (correct === true) {
        item.outcome = "correct";
        item.phase = "done";
        item.allocation = answer;
        if (remainder && remainder.used !== null && remainder.remaining !== null) item.remainderResult = { used: remainder.used, remaining: remainder.remaining };
        item.resolvedAt = nowIso;
        feedback = "done";
      } else if (correct === null) {
        feedback = item.phase; // stays where it was; nothing substantive happened
      } else {
        // CONTRACT rule 4: first incorrect → one clarification; second → a
        // representation (or the model example) with direct teaching already
        // on offer; a third unsuccessful attempt ends the loop — only "teach"
        // or "stop" remain.
        const substantive = substantiveBefore + 1;
        if (substantive > content.math.rules.maxSubstantiveAttempts) {
          item.phase = "teach-or-stop";
          attempt.teachingMove = "offer-direct-teaching";
          attempt.teachingReason = "attempts-exhausted-after-representation";
          feedback = "teach-or-stop";
        } else if (substantive === 1 && content.math.rules.clarifyAfterFirstIncorrect) {
          item.phase = "clarify";
          attempt.teachingMove = "clarification";
          attempt.teachingReason = "first-incorrect";
          feedback = "clarify";
          noteTeaching(state, nowIso);
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "clarification", payload: { auto: true, ...partial }, at: nowIso });
          if (!item.supportGiven.includes("clarification")) item.supportGiven.push("clarification");
        } else {
          feedback = "represent";
        }
      }
      // A clarified second attempt that is still wrong: representation or the
      // model example before the last try (rule 4).
      if (correct === false && feedback === "represent") {
        noteTeaching(state, nowIso);
        const modelId: MathItemId | null = op.itemId === "EQ-ENTRY" ? "EQ-MODEL" : op.itemId === "EQ-STATION" && hasMathItem(content, "EQ-STATION-MODEL") ? "EQ-STATION-MODEL" : null;
        if (modelId) {
          item.phase = "example";
          attempt.teachingMove = "model-example";
          attempt.teachingReason = "second-incorrect";
          const shownKey = modelId === "EQ-MODEL" ? "modelShownAt" : "stationModelShownAt";
          if (!state[shownKey]) {
            state[shownKey] = nowIso;
            records.exposures.push({ taskId: modelId, taskVersion: mathItem(content, modelId).version, kind: "example_shown", source: "teaching", at: nowIso });
          }
          if (!item.supportGiven.includes("example")) item.supportGiven.push("example");
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "example", payload: { model: modelId }, at: nowIso });
        } else {
          item.phase = "represent";
          attempt.teachingMove = "representation";
          attempt.teachingReason = "second-incorrect";
          if (!item.supportGiven.includes("representation")) item.supportGiven.push("representation");
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "representation", payload: { counters: true }, at: nowIso });
        }
        feedback = item.phase;
      }
      item.attempts.push(attempt);
      records.attempts.push({
        id: env.newId(),
        visitId: state.currentVisit as VisitId,
        taskId: op.itemId,
        taskVersion: def.version,
        objective: remainderItem ? "equal-sharing-with-remainder" : content.math.objective,
        attemptNo: attempt.no,
        answer: remainder ? { value: answer, used: remainder.used, remaining: remainder.remaining, raw: attempt.raw } : { value: answer, raw: attempt.raw },
        correct,
        evidence: attempt.evidence,
        support: attempt.support,
        exposureBefore: attempt.exposureBefore,
        stimulusLanguage: "de",
        responseLanguage: null,
        modality: op.modality,
        uncertainty: attempt.uncertainty,
        teachingMove: attempt.teachingMove,
        teachingReason: attempt.teachingReason,
        secondsSinceTeaching: op.itemId === "EQ-DELAY" || op.itemId === "EQ-RETURN" ? secondsSince(delayAnchor(state), now) : null,
        at: nowIso,
      });
      if (correct === true) {
        const gained = remainderItem && def.answers ? def.answers.used : def.quantity;
        state.base.supplies[def.unit.plural] = (state.base.supplies[def.unit.plural] ?? 0) + gained;
        advance(state, content);
      }
      result = { feedback, correct, evidence: attempt.evidence, attemptNo: attempt.no, ...partial };
      break;
    }

    case "continue-item": {
      // After the model example: back to answering (the example stays hidden
      // for the fresh item by construction — it belongs to the model only).
      requireStage(state, content, op.itemId);
      const item = mathState(state, op.itemId);
      if (item.phase === "example" || item.phase === "clarify") item.phase = "answer";
      result = { phase: item.phase };
      break;
    }

    case "request-teaching": {
      requireStage(state, content, op.itemId);
      const def = mathItem(content, op.itemId);
      const item = mathState(state, op.itemId);
      const substantive = item.attempts.filter((a) => a.correct !== null).length;
      if (item.phase !== "teach-or-stop" && !(substantive >= content.math.rules.maxSubstantiveAttempts && (item.phase === "represent" || item.phase === "example" || item.phase === "answer"))) {
        throw new LearningOpError("not-allowed", "direct teaching is offered only after two unsuccessful attempts");
      }
      noteTeaching(state, nowIso);
      item.exposure = "answer_revealed";
      item.outcome = "taught";
      item.phase = "done";
      item.allocation = def.answer;
      if (def.kind === "remainder" && def.answers) item.remainderResult = { ...def.answers };
      item.resolvedAt = nowIso;
      records.exposures.push({ taskId: op.itemId, taskVersion: def.version, kind: "answer_revealed", source: "direct_teaching", at: nowIso });
      records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "direct_teaching", payload: def.kind === "remainder" ? { answers: def.answers } : { answer: def.answer }, at: nowIso });
      const gained = def.kind === "remainder" && def.answers ? def.answers.used : def.quantity;
      state.base.supplies[def.unit.plural] = (state.base.supplies[def.unit.plural] ?? 0) + gained;
      advance(state, content);
      result = def.kind === "remainder" ? { taught: true, answers: def.answers } : { taught: true, answer: def.answer };
      break;
    }

    case "stop-item": {
      requireStage(state, content, op.itemId);
      const item = mathState(state, op.itemId);
      if (item.outcome !== "pending") throw new LearningOpError("not-allowed", "item already resolved");
      item.outcome = "stopped";
      item.phase = "done";
      item.resolvedAt = nowIso;
      records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "step_down", payload: { stopped: true }, at: nowIso });
      advance(state, content);
      result = { stopped: true };
      break;
    }

    case "explain": {
      requireStage(state, content, "explain");
      const text = boundedText(op.text, MAX_TEXT_CHARS, "explanation");
      const visit = state.currentVisit as VisitId;
      const taskId = explainTarget(state, visit);
      state.explanations.push({ visit, text, modality: op.modality, taskId, at: nowIso });
      records.samples.push({ id: env.newId(), visitId: visit, taskId, kind: "explanation", language: "de", modality: op.modality, text, metrics: null, at: nowIso });
      advance(state, content);
      break;
    }

    case "language-step": {
      requireStage(state, content, op.segmentId);
      const segment = languageSegment(content, op.segmentId);
      const seg = languageState(state, op.segmentId);
      const { step, index } = findStep(segment, op.stepId);
      if (index !== seg.stepIndex) throw new LearningOpError("not-allowed", `step ${op.stepId} is not the current step`);
      // Support is derived from the durable per-segment help ledger, never from
      // client flags: help that was recorded (and therefore shown) counts.
      const help = seg.help;
      const support: ("gloss" | "audio" | "word-choice" | "tutor" | "retry" | "feedback")[] = [];
      if (help.gloss.length > 0) support.push("gloss");
      if (help.audio.length > 0) support.push("audio");
      // One recognition-support rule (follow-on 2026-09-30, shared with the vocabulary ledger): for a pick-supply step the
      // labelled supply buttons ARE the task, so the button modality is not help; only an opened word list (durable
      // per-segment ledger) is. For a produce step, button-selected text stays help — copying, never independent production.
      if (help.wordChoice.length > 0 || (op.modality === "word-choice" && step.kind !== "pick-supply")) support.push("word-choice");
      if (help.tutor > 0) support.push("tutor");
      if (op.modality === "spoken" && op.transcriptConfirmed !== true) {
        throw new LearningOpError("invalid", "a spoken response must be confirmed by the child before it is scored");
      }
      // Durable prior attempts and feedback count as support (CONTRACT rule 3):
      // a retry of this step, or any earlier incorrect step in the segment
      // (its feedback showed the gloss), is never a fresh independent check.
      const priorOnStep = seg.records.filter((r) => r.stepId === step.id);
      const priorIncorrect = seg.records.some((r) => r.correct === false);
      if (priorOnStep.length > 0) support.push("retry");
      else if (priorIncorrect) support.push("feedback");
      let correct: boolean | null = null;
      let evidence: LanguageStepRecord["evidence"] = "listen";
      let response = "";
      let productionKind: ProductionKind | null = null;
      let uncertainty: string | null = op.modality === "spoken" ? "transcript-confirmed-by-child" : null;
      if (step.kind === "listen-read") {
        evidence = "listen";
        response = help.audio.length > 0 ? "listened" : "read";
      } else if (step.kind === "pick-supply") {
        evidence = "recognition";
        response = boundedText(op.response, 40, "choice");
        if (!step.options.includes(response)) throw new LearningOpError("invalid", "choice is not one of the options");
        correct = response === step.answer;
      } else {
        evidence = "production";
        response = boundedText(op.response, 200, "response");
        const previous = priorOnStep.length ? priorOnStep[priorOnStep.length - 1] : null;
        if (previous && previous.correct === null && normalizeText(previous.response) === normalizeText(response)) {
          throw new LearningOpError("not-allowed", "same-answer: say it once more with the sentence start, or continue without scoring");
        }
        const scored = scoreProduction(step, response);
        correct = scored.correct;
        if (scored.uncertainty) uncertainty = scored.uncertainty;
        if (scored.completion === "lexical") evidence = "completion";
        productionKind = support.includes("word-choice") ? "copying" : support.includes("audio") ? "repetition" : support.length > 0 ? "glossed" : "independent";
      }
      const variant = step.kind === "pick-supply" && step.variants ? (state.station?.theme ?? "none") : undefined;
      const record: LanguageStepRecord = { stepId: step.id, evidence, correct, uncertainty, response, modality: op.modality, support, visit: state.currentVisit as VisitId, ...(variant ? { variant } : {}), at: nowIso };
      seg.records.push(record);
      const attemptEvidence: EvidenceCategory =
        correct === null ? "unscored" : !correct ? "incorrect" : support.length > 0 ? "supported" : "independent";
      records.attempts.push({
        id: env.newId(),
        visitId: state.currentVisit as VisitId,
        taskId: `${segment.id}/${step.id}`,
        taskVersion: segment.version,
        objective: `language-${segment.language}-${evidence}`,
        attemptNo: seg.records.filter((r) => r.stepId === step.id).length,
        answer: productionKind ? { response, productionKind } : { response },
        correct,
        evidence: attemptEvidence,
        support,
        exposureBefore: "shown",
        stimulusLanguage: segment.language,
        responseLanguage: step.kind === "produce" ? segment.language : null,
        modality: op.modality,
        uncertainty,
        teachingMove: null,
        teachingReason: null,
        secondsSinceTeaching: null,
        at: nowIso,
      });
      if (step.kind === "produce") {
        records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: `${segment.id}/${step.id}`, kind: "language_response", language: segment.language, modality: op.modality, text: response, metrics: { correct, support, productionKind }, at: nowIso });
      }
      if (step.kind === "pick-supply" && correct) {
        state.base.supplies[step.answer] = (state.base.supplies[step.answer] ?? 0) + 1;
      }
      // Recognition and production each get one recorded try; an incorrect
      // pick shows the gloss and lets the child try once more.
      // An unscored or incorrect production keeps the step open for one more
      // try with visible feedback; afterwards only the explicit
      // `language-continue` op (child's choice, evidence stays as recorded)
      // moves on. Recognition picks get two tries, then move on.
      const tries = seg.records.filter((r) => r.stepId === step.id).length;
      if (step.kind === "listen-read" || correct === true || (step.kind === "pick-supply" && tries >= 2)) seg.stepIndex += 1;
      if (seg.stepIndex >= segment.steps.length) {
        seg.done = true;
        advance(state, content);
      }
      result = { correct, evidence, stepIndex: seg.stepIndex, done: seg.done };
      break;
    }

    case "language-continue": {
      requireStage(state, content, op.segmentId);
      const segment = languageSegment(content, op.segmentId);
      const seg = languageState(state, op.segmentId);
      const { step, index } = findStep(segment, op.stepId);
      if (index !== seg.stepIndex) throw new LearningOpError("not-allowed", `step ${op.stepId} is not the current step`);
      const last = seg.records.filter((r) => r.stepId === step.id).pop() ?? null;
      if (!last || last.correct === true) throw new LearningOpError("not-allowed", "continue is offered only after an unscored or incorrect response");
      records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: `${segment.id}/${step.id}`, kind: "step_down", payload: { continuedWithoutScore: true, lastEvidence: last.correct === null ? "unscored" : "incorrect" }, at: nowIso });
      seg.stepIndex += 1;
      if (seg.stepIndex >= segment.steps.length) {
        seg.done = true;
        advance(state, content);
      }
      result = { continued: true, stepIndex: seg.stepIndex, done: seg.done };
      break;
    }

    case "typing-lesson": {
      requireStage(state, content, "typing");
      const lesson = typingLessonForLayout(content, env.settings.keyboardLayout);
      if (!lesson || lesson.id !== op.lessonId) {
        throw new LearningOpError("not-available", "positional drills are unavailable until the parent confirms the keyboard layout");
      }
      // The client sends what was typed per line; the server computes every
      // metric itself, so totals cannot be miscounted or asserted.
      if (!Array.isArray(op.lines) || op.lines.length !== lesson.lines.length || op.lines.some((l) => typeof l !== "string" || Array.from(l).length > 120)) {
        throw new LearningOpError("invalid", "typing lines must match the lesson");
      }
      const rec: TypingLessonRecord = { lessonId: lesson.id, layout: lesson.layout, ...lessonMetrics(lesson.lines, op.lines), seconds: Math.max(0, Math.round(op.seconds)), at: nowIso };
      state.typing.lessons.push(rec);
      records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: lesson.id, kind: "typing_practice", language: null, modality: "typed", text: lesson.lines.join(" / "), metrics: rec, at: nowIso });
      result = { accuracy: accuracyRatio(rec) };
      break;
    }

    case "typing-label": {
      requireStage(state, content, "typing");
      const task = content.typing.labelTasks.find((t) => t.id === op.taskId && t.visit === state.currentVisit);
      if (!task) throw new LearningOpError("invalid", "unknown label task for this visit");
      const target = task.targetFrom === "baseName" ? state.base.name ?? "" : task.target ?? "";
      if (!target) throw new LearningOpError("not-allowed", "no label target yet");
      const typed = typeof op.typed === "string" ? op.typed.slice(0, 80) : "";
      const { ops: _ops, ...metrics } = alignTyping(target, typed);
      const rec: TypingLabelRecord = { taskId: task.id, target, typed, ...metrics, seconds: Math.max(0, Math.round(op.seconds)), at: nowIso };
      state.typing.labels.push(rec);
      records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: task.id, kind: "typed_label", language: "de", modality: "typed", text: typed, metrics: rec, at: nowIso });
      advance(state, content);
      result = { accuracy: accuracyRatio(metrics) };
      break;
    }

    case "typing-check": {
      // Non-assessed setup check on the actual device (redesign F1/T1). The
      // parent confirmed the PHYSICAL layout in the settings; this compares
      // what the computer's input source wrote for the distinguishing keys.
      requireStage(state, content, "typing-course");
      const layout = env.settings.keyboardLayout;
      if (!layout) throw new LearningOpError("not-available", "the parent has not confirmed the physical keyboard layout");
      const course = content.typing.course;
      if (!course) throw new LearningOpError("not-available", "no alignment check in this content");
      const keys = course.alignmentCheck.keys;
      if (!Array.isArray(op.observed) || op.observed.length !== keys.length || op.observed.some((c) => typeof c !== "string" || Array.from(c).length !== 1)) {
        throw new LearningOpError("invalid", `observed must hold exactly ${keys.length} single characters`);
      }
      const observed = keys.map((key, i) => ({ id: key.id, expected: key.expected[layout], got: op.observed[i] }));
      const result_ = observed.every((o) => o.expected === o.got) ? "match" : "mismatch";
      const layouts = content.typing.layouts.map((l) => l.id);
      const matchesLayout = layouts.find((l) => keys.every((key, i) => key.expected[l] === op.observed[i])) ?? null;
      state.typing.alignment = { layout, checkedAt: nowIso, result: result_, observed, matchesLayout };
      if (result_ === "match") {
        const availableCourse = typingCourseForLayout(content, layout);
        if (availableCourse && (!state.typing.course || state.typing.course.layout !== layout)) {
          // A course record is bound to its layout; a layout change starts a
          // separate record — progression never transfers between layouts.
          state.typing.course = { layout, lessonIndex: 0, bursts: [], decision: { lessonId: availableCourse.lessons[0].id, action: "start", reason: "input alignment confirmed on this device", at: nowIso }, completed: [] };
        }
      }
      result = { result: result_, matchesLayout };
      break;
    }

    case "typing-burst": {
      requireStage(state, content, "typing-course");
      const availability = practiceAvailability(state, content, env.settings);
      if (!availability.available) throw new LearningOpError("not-available", `positional practice is unavailable: ${availability.reason}`);
      const course = typingCourseForLayout(content, env.settings.keyboardLayout)!;
      const lesson = currentCourseLesson(state, content, env.settings);
      if (!lesson || lesson.id !== op.lessonId) throw new LearningOpError("not-allowed", `the current lesson is ${lesson?.id ?? "none"}`);
      if (!Array.isArray(op.lines) || op.lines.length < 1 || op.lines.length > lesson.lines.length || op.lines.some((l) => typeof l !== "string" || Array.from(l).length > 120)) {
        throw new LearningOpError("invalid", "typing lines must be a non-empty prefix of the lesson");
      }
      // A shorter burst (a prefix of the lines) is only offered after a "smaller" decision; it is practice, never promotion evidence.
      const shortened = op.lines.length < lesson.lines.length;
      if (shortened && state.typing.course?.decision?.action !== "smaller") throw new LearningOpError("not-allowed", "a shorter burst is only offered after a smaller decision");
      if (op.comfort !== "easy" && op.comfort !== "ok" && op.comfort !== "hard") throw new LearningOpError("invalid", "comfort must be easy, ok or hard");
      const metrics = alignedLessonMetrics(lesson.lines.slice(0, op.lines.length), op.lines);
      const burst: TypingBurst = { lessonId: lesson.id, visit: state.currentVisit as VisitId, lineCount: op.lines.length, ...metrics, comfort: op.comfort, seconds: Math.max(0, Math.round(op.seconds)), at: nowIso };
      const courseState = state.typing.course!;
      courseState.bursts.push(burst);
      const decision = decideProgression(courseState, lesson, course.lessons.length, course.progression, nowIso);
      courseState.decision = decision;
      if ((decision.action === "advance" || decision.action === "stop") && !courseState.completed.includes(lesson.id)) courseState.completed.push(lesson.id);
      if (decision.action === "advance") courseState.lessonIndex = Math.min(courseState.lessonIndex + 1, course.lessons.length - 1);
      records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: lesson.id, kind: "typing_burst", language: null, modality: "typed", text: lesson.lines.slice(0, op.lines.length).join(" / "), metrics: burst, at: nowIso });
      result = { accuracy: burst.accuracy, decision: decision.action, reason: decision.reason, nextLessonId: course.lessons[courseState.lessonIndex]?.id ?? null };
      break;
    }

    case "typing-course-continue": {
      requireStage(state, content, "typing-course");
      const visit = currentVisit(state);
      const inVisit = (state.typing.course?.bursts ?? []).some((b) => b.at >= visit.startedAt);
      if (!inVisit) {
        // Moving on without practice is recorded as a skip, never as practice.
        visit.skippedStages.push({ stage: "typing-course", reason: "child" });
        state.typing.skipped.push({ visit: visit.id, reason: "child" });
      }
      advance(state, content);
      result = { practiced: inVisit };
      break;
    }

    case "skip-stage": {
      const visit = currentVisit(state);
      const stage = currentStage(state, content);
      if (stage !== op.stage) throw new LearningOpError("not-allowed", "stage is not active");
      const optional: StageId[] = ["LANG-EN-WATER", "LANG-ES-AGUA", "LANG-ES-STATION", "typing", "typing-course", "explain", "log-revise", "log-transfer"];
      if (!optional.includes(op.stage)) throw new LearningOpError("not-allowed", "only optional segments can be skipped");
      visit.skippedStages.push({ stage: op.stage, reason: op.reason });
      if (op.stage === "typing" || op.stage === "typing-course") state.typing.skipped.push({ visit: visit.id, reason: op.reason });
      if (isLanguageSegmentId(op.stage)) languageState(state, op.stage).skipped = op.reason;
      if (op.stage === "log-revise") {
        const page = [...state.pages].reverse().find((p) => p.visit === visit.id) ?? null;
        if (page) {
          const flags = flagSpacing(page.text, content.writing?.spacing.joins ?? []);
          state.logRevisions.push({ visit: visit.id, original: page.text, revised: null, flagged: flags, resolved: 0, outcome: "skipped", modality: "typed", helpShown: flags.length > 0, at: nowIso });
        }
      }
      if (op.stage === "log-transfer" && content.writing?.transfer) {
        const t = content.writing.transfer;
        const revision = [...state.logRevisions].reverse().find((r) => r.visit === visit.id) ?? null;
        (state.transfers ??= []).push({ id: t.id, version: t.version, visit: visit.id, text: null, modality: "typed", flagged: [], assessed: 0, outcome: "skipped", helpExposed: !!revision?.helpShown, linkedRevisionAt: revision?.at ?? null, at: nowIso });
      }
      advance(state, content);
      break;
    }

    case "save-log": {
      requireStage(state, content, "log");
      if (!state.base.name) throw new LearningOpError("not-allowed", "name the base first");
      const text = boundedText(op.text, MAX_TEXT_CHARS, "log");
      const visit = state.currentVisit as VisitId;
      const explanation = [...state.explanations].reverse().find((e) => e.visit === visit)?.text ?? null;
      const page: ExpeditionPage = {
        visit,
        modality: op.modality === "spoken" ? "spoken" : "typed",
        title: `${visitDef(content, visit).title}`,
        baseName: state.base.name,
        locationId: state.base.locationId,
        supplies: { ...state.base.supplies },
        explanation,
        text,
        at: nowIso,
      };
      state.pages.push(page);
      records.samples.push({ id: env.newId(), visitId: visit, taskId: null, kind: "expedition_log", language: "de", modality: op.modality ?? "typed", text, metrics: { supplies: page.supplies }, at: nowIso });
      advance(state, content);
      break;
    }

    case "revise-log": {
      requireStage(state, content, "log-revise");
      const visit = state.currentVisit as VisitId;
      const page = [...state.pages].reverse().find((p) => p.visit === visit) ?? null;
      if (!page) throw new LearningOpError("not-allowed", "no page to revise in this visit");
      const original = page.text;
      const flags = flagSpacing(original, content.writing?.spacing.joins ?? []);
      const revised = boundedText(op.text, MAX_TEXT_CHARS, "revision");
      const evaluated = evaluateRevision(original, revised, flags);
      const pageSample = [...state.pages].filter((p) => p.visit === visit).length;
      const revision: LogRevision = { visit, original, revised, flagged: flags, resolved: evaluated.resolved, outcome: evaluated.outcome === "no-flags" ? "no-flags" : evaluated.outcome, modality: "typed", helpShown: flags.length > 0, at: nowIso };
      state.logRevisions.push(revision);
      records.samples.push({
        id: env.newId(),
        visitId: visit,
        taskId: null,
        kind: "expedition_log_revision",
        language: "de",
        modality: "typed",
        text: revised,
        metrics: { original, flagged: flags.length, resolved: evaluated.resolved, outcome: revision.outcome, rules: flags.map((f) => f.rule), originalPageIndex: pageSample, spellingJudged: false },
        at: nowIso,
      });
      advance(state, content);
      result = { outcome: revision.outcome, resolved: evaluated.resolved, total: evaluated.total };
      break;
    }

    case "summary-seen": {
      requireStage(state, content, "summary");
      advance(state, content);
      break;
    }

    case "write-transfer": {
      requireStage(state, content, "log-transfer");
      const t = content.writing?.transfer;
      if (!t) throw new LearningOpError("not-available", "no transfer check in this content");
      const visit = state.currentVisit as VisitId;
      const text = boundedText(op.text, MAX_TEXT_CHARS, "transfer sentence");
      const joins = content.writing?.spacing.joins ?? [];
      const assessment = assessSpacing(text, joins);
      const flags = assessment.flags;
      const revision = [...state.logRevisions].reverse().find((r) => r.visit === visit) ?? null;
      // Copies are not a new sentence (R3-2): the original page, the saved revision, and the correction that
      // was actually SHOWN (the suggestion, with or without the marker bars) — also when the revision was skipped.
      const page = [...state.pages].reverse().find((p) => p.visit === visit) ?? null;
      const norm = (s: string) => s.replace(/\|/g, " ").replace(/[.!?]+\s*$/u, "").replace(/\s+/g, " ").trim().toLowerCase();
      const shown: string[] = [];
      if (page) {
        shown.push(page.text);
        const pageFlags = flagSpacing(page.text, joins);
        if (revision || pageFlags.length > 0) shown.push(suggestSpacing(page.text, pageFlags), markSpacing(page.text, pageFlags));
      }
      if (revision?.revised) shown.push(revision.revised);
      if (shown.some((s) => norm(s) === norm(text))) throw new LearningOpError("copied-text", "write a NEW sentence: this is the page or the correction that was shown");
      const modality = op.modality === "spoken" ? "spoken" : "typed";
      const outcome: TransferRecord["outcome"] = !assessment.assessable ? "unassessable" : flags.length > 0 ? "flagged" : "clean";
      const record: TransferRecord = { id: t.id, version: t.version, visit, text, modality, flagged: flags, assessed: assessment.assessed, outcome, helpExposed: !!revision?.helpShown, linkedRevisionAt: revision?.at ?? null, at: nowIso };
      (state.transfers ??= []).push(record);
      // Evidence (R3-1): only a sentence with at least one reviewed boundary can be assessed. Clean with assessed
      // boundaries → limited correct evidence (supported when help was shown earlier, else independent); flagged →
      // incorrect; no reviewed boundary → unscored (unknown); spoken → unscored (spacing comes from transcription).
      const unassessable = !assessment.assessable;
      const evidence: EvidenceCategory = modality === "spoken" || unassessable ? "unscored" : flags.length > 0 ? "incorrect" : record.helpExposed ? "supported" : "independent";
      const correct = modality === "spoken" || unassessable ? null : flags.length === 0;
      const uncertainty = modality === "spoken" ? "spoken text: spacing comes from transcription, not the child" : unassessable ? "no reviewed spacing boundary in the sentence: nothing to assess" : null;
      records.attempts.push({
        id: env.newId(), visitId: visit, taskId: t.id, taskVersion: t.version, objective: "writing-spacing-transfer",
        attemptNo: (state.transfers ?? []).filter((x) => x.visit === visit).length, answer: { assessed: assessment.assessed, correct: assessment.correct, flags: flags.length, rules: flags.map((f) => f.rule) },
        correct, evidence, support: record.helpExposed ? ["revision-help"] : [], exposureBefore: record.helpExposed ? "revision-help-shown" : "none",
        stimulusLanguage: "de", responseLanguage: "de", modality, uncertainty, teachingMove: null, teachingReason: null, secondsSinceTeaching: null, at: nowIso,
      });
      records.samples.push({ id: env.newId(), visitId: visit, taskId: t.id, kind: "writing_transfer", language: "de", modality, text, metrics: { assessed: assessment.assessed, correct: assessment.correct, flagged: flags.length, rules: flags.map((f) => f.rule), outcome: record.outcome, helpExposed: record.helpExposed, linkedRevisionAt: record.linkedRevisionAt, spellingJudged: false }, at: nowIso });
      advance(state, content);
      result = { outcome: record.outcome, flags: flags.length, assessed: assessment.assessed };
      break;
    }

    case "reflect": {
      requireStage(state, content, "reflect");
      const difficultyOptional = typeof content.reflection.skipLabel === "string";
      if (op.optionId !== null && op.optionId !== undefined && !content.reflection.options.some((o) => o.id === op.optionId)) throw new LearningOpError("invalid", "unknown reflection option");
      if ((op.optionId === null || op.optionId === undefined) && !difficultyOptional) throw new LearningOpError("invalid", "difficulty is required by this content");
      const visit = currentVisit(state);
      visit.reflection = op.optionId ?? null;
      const dims = content.reflection.dimensions ?? [];
      if (dims.length || difficultyOptional) {
        // Three states per dimension (R3-3): answered, explicitly skipped ("Lieber nicht sagen"), left open. Never coerced.
        const answers: Record<string, string> = {};
        const skipped: string[] = [];
        const unanswered: string[] = [];
        const offered: string[] = [];
        if (difficultyOptional) {
          offered.push("difficulty");
          if (op.optionId) answers.difficulty = op.optionId;
          else if (op.difficultySkipped) skipped.push("difficulty");
          else unanswered.push("difficulty");
        }
        for (const dim of dims) {
          offered.push(dim.id);
          const given = op.feedback?.[dim.id as "enjoyment" | "clarity"];
          if (given === null || given === "") skipped.push(dim.id);
          else if (given === undefined) unanswered.push(dim.id);
          else if (dim.options.some((o) => o.id === given)) answers[dim.id] = given;
          else throw new LearningOpError("invalid", `unknown ${dim.id} option`);
        }
        visit.feedback = { answers, skipped, unanswered, offered };
      }
      visit.finishedAt = nowIso;
      visit.stageIndex += 1;
      state.currentVisit = null;
      finishedVisit = visit.id;
      result = { finished: visit.id };
      break;
    }

    default: {
      const never: never = op;
      throw new LearningOpError("invalid", `unknown op ${JSON.stringify(never)}`);
    }
  }

  state.revision = input.revision + 1;
  state.updatedAt = nowIso;
  return { state, records, result, finishedVisit };
}

// ---------------------------------------------------------------------------
// Child view — what the browser is allowed to know
// ---------------------------------------------------------------------------

export type MathItemView = {
  id: ScoredMathItemId;
  version: number;
  kind: "sharing" | "remainder";
  prompt: string;
  scene: string | null;
  quantity: number;
  groups: number;
  /** Remainder items: how many fit in each group. */
  perGroup: number | null;
  unit: MathItem["unit"];
  group: MathItem["group"];
  /** People are distributed AMONG; containers are filled INTO (control wording, R2-6). */
  groupKind: "people" | "container";
  phase: MathPhase;
  attemptNo: number;
  clarification: string | null;
  representation: string | null;
  /** The teaching example, only while the item is in the `example` phase. */
  example: { prompt: string; steps: string[]; quantity: number; groups: number; answer: number } | null;
  /** Shown only after the item is resolved by direct teaching. */
  taughtAnswer: number | null;
  taughtAnswers: { used: number; remaining: number } | null;
  /** True once two substantive attempts failed: "teach" and "stop" are offered. */
  teachingOffered: boolean;
  outcome: MathItemState["outcome"];
  /** Remainder items: which half of the last incorrect answer was right (for the clarification). */
  lastPartial: { usedCorrect: boolean; remainingCorrect: boolean } | null;
};

export type LanguageStepView =
  | { id: string; kind: "listen-read"; sentence: string; instruction: string }
  | { id: string; kind: "pick-supply"; sentence: string; instruction: string; options: { id: string; label: string; emoji: string }[] }
  | { id: string; kind: "produce"; instruction: string; frame: string; target: string; choices: string[] };

export type TypingView =
  | { available: true; lesson: { id: string; title: string; layout: KeyboardLayoutId; homeRow: string[]; fingers: Record<string, string>; lines: string[] }; label: { taskId: string; instruction: string; target: string } | null; lessonDone: boolean }
  | { available: false; reason: "layout-unconfirmed"; label: { taskId: string; instruction: string; target: string } | null };

export type TypingCourseView = {
  layoutLabel: string | null;
  /** Parent-readable labels for every known layout id (for the mismatch explanation). */
  layoutLabels: Record<string, string>;
  /** Why practice is unavailable, or null when it is available. */
  unavailable: "layout-unconfirmed" | "alignment-unchecked" | "alignment-mismatch" | "no-course-for-layout" | null;
  alignment: { keys: { id: string; prompt: string }[]; result: TypingAlignment | null };
  lesson: { id: string; title: string; keys: string[]; practiced: string[]; lines: string[]; index: number; count: number } | null;
  homePosition: { left: string[]; right: string[]; anchors: string[]; thumb: string } | null;
  fingers: Record<string, string>;
  progression: { minBursts: number; minAccuracy: number };
  burstsThisVisit: { lessonId: string; accuracy: number; comfort: TypingComfort; correctChars: number; denominator: number; extraChars: number; omittedChars: number; substitutedChars: number; lineCount: number }[];
  decision: TypingCourseDecision | null;
  completed: string[];
};

export type LogReviseView = {
  original: string;
  marked: string;
  suggested: string;
  flags: number;
  rules: string[];
};

export type TutorContext = {
  taskId: string;
  taskVersion: number;
  language: "de" | "en" | "es";
  prompt: string;
  allowedHelp: string;
};

export type ChildView = {
  child: ChildId;
  revision: number;
  /** Server-established erasure generation the view was read under; echoed by telemetry batches (P2). Content-free. */
  erasureGeneration: number;
  /** Content-free fingerprint of the current sign-in (set by the route); binds recoverable completed drafts to this sign-in (R4-2). */
  sessionFingerprint?: string;
  contentVersion: number;
  title: string;
  hook: string;
  base: { name: string | null; location: { id: string; label: string; emoji: string } | null; supplies: Record<string, number> };
  scene: SceneModel;
  pages: ExpeditionPage[];
  /** `ordinal` is the learner-facing number (the observation chapter `v4` is Visit 3 since 2026-09-30); `id` stays the stable internal identity. */
  visit: { id: VisitId; ordinal: number | null; title: string; startedAt: string; stage: StageId | null; stageIndex: number; stageCount: number; minutesElapsed: number; overBudget: boolean; intro: { who: string; make: string; done: string } | null } | null;
  next: { visit: VisitId | null; ordinal: number | null; availableAt: string | null; reason: string | null };
  delayedCheck: DelayedCheckInfo | null;
  /** Compact learner-entry progress strip (follow-on M2); server-derived, never a grade. */
  progress: ProgressStrip;
  /** Concrete words to practise and what to try next (follow-on M3); no counts, no ranks. `null` when no inventory is served. */
  vocabulary: ChildVocabularyCue | null;
  nextStep: string;
  locations: { id: string; label: string; emoji: string }[];
  station: { themes: { id: string; label: string; emoji: string; purpose: string }[]; spots: { id: string; label: string; emoji: string }[]; theme: string | null; spot: string | null; built: boolean; lampLit: boolean; lampAvailable: boolean; reference: { kind: "turtles-in-log" | "none"; text: string } } | null;
  math: MathItemView | null;
  language: {
    id: LanguageSegmentId;
    language: "en" | "es";
    title: string;
    step: LanguageStepView | null;
    stepIndex: number;
    stepCount: number;
    glosses: { word: string; de: string; example: string }[];
    lastCorrect: boolean | null;
    /** Bounded, reviewed feedback for the CURRENT step's last response, or null. */
    feedback: { kind: "clarify" | "incorrect" | "unclear"; message: string; triesUsed: number; retryAllowed: boolean; continueOffered: boolean } | null;
  } | null;
  typing: TypingView | null;
  typingCourse: TypingCourseView | null;
  logRevise: LogReviseView | null;
  /** The fresh writing-transfer prompt while its stage is active. */
  transfer: { id: string; version: number; prompt: string; instruction: string; helpExposed: boolean } | null;
  summary: VisitSummary | null;
  reflection: { prompt: string; options: { id: string; label: string }[]; skipLabel: string | null; dimensions: { id: string; prompt: string; options: { id: string; label: string }[]; skipLabel: string }[] } | null;
  tutor: TutorContext | null;
  retention: string;
};

function nextStepText(state: MissionState, content: LearningContent, stage: StageId | null, now: Date): string {
  if (stage) {
    switch (stage) {
      case "name-base": return "Gib deiner Basis einen Namen.";
      case "place-base": return "Wähle, wo die Basis steht.";
      case "restore": return "Deine Basis wartet auf dich.";
      case "EQ-ENTRY": return "Verteile die Essenspakete an dein Team.";
      case "EQ-FRESH": return "Das zweite Team braucht Vorräte.";
      case "EQ-RETURN": return "Der Garten wird angelegt.";
      case "EQ-DELAY": return "Proben fürs Labor verpacken.";
      case "EQ-STATION": return "Die Beete der Station werden bepflanzt — mit Rest.";
      case "explain": return "Erkläre, wie du gerechnet hast.";
      case "LANG-EN-WATER": return "Eine Nachricht auf Englisch ist angekommen.";
      case "LANG-ES-AGUA": return "Eine Nachricht auf Spanisch ist angekommen.";
      case "LANG-ES-STATION": return "Bitte das Team auf Spanisch um die Lampe.";
      case "typing": return "Ein kurzes Tipp-Training, dann das Schild.";
      case "typing-course": return "Tastatur-Check, dann kurze Tipp-Runden.";
      case "station-choice": return "Was soll deine Station beobachten?";
      case "station-build": return "Baue die Station.";
      case "log": return "Schreib die Expeditionsseite.";
      case "log-revise": return "Schau deinen Satz noch einmal an.";
      case "log-transfer": return "Schreib einen neuen kurzen Satz.";
      case "summary": return "Das hast du heute geschafft.";
      case "reflect": return "Wie war es heute?";
    }
  }
  const availability = nextVisitAvailability(state, content, now);
  if ("reason" in availability && availability.reason === "chapter-unavailable") return "Dein angefangenes Kapitel ist gerade nicht verfügbar. Deine Basis, deine Seiten und dein Fortschritt sind gespeichert.";
  if ("reason" in availability && availability.reason === "no-further-visit-served") return "Das nächste Kapitel ist gerade nicht verfügbar. Deine Basis, deine Seiten und dein Fortschritt sind gespeichert.";
  if (availability.visit) {
    if (availability.visit === "v1") return "Baue deine Basis.";
    if (availability.visit === "v3") return "Deine angefangene Aufgabe von früher wartet auf dich.";
    if (availability.visit === "v4") return `Ein neues Kapitel (Besuch ${visitOrdinal(state, "v4") ?? 3}): die Beobachtungsstation.`;
    return "Zurück zur Basis — ein neuer Besuch wartet.";
  }
  return "Alle Besuche sind geschafft.";
}

/** Optional per-request inputs of the view (follow-on): the learner's time zone, the stored reviews the progress strip may cite and the served vocabulary inventory. */
export type ChildViewOptions = { timeZone?: string | null; progressSources?: ProgressSources | null; vocabulary?: VocabularyInventory | null };

export function buildChildView(state: MissionState, content: LearningContent, settings: ParentSettings, now: Date, erasureGeneration = 0, options: ChildViewOptions = {}): ChildView {
  const stage = currentStage(state, content);
  const running = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null) ?? null;
  const availability = nextVisitAvailability(state, content, now);
  const location = content.locations.find((l) => l.id === state.base.locationId) ?? null;

  let math: MathItemView | null = null;
  const itemId = scoredItemForStage(stage);
  if (itemId && state.math[itemId]) {
    const def = mathItem(content, itemId);
    const item = state.math[itemId]!;
    const modelId: MathItemId = def.kind === "remainder" ? "EQ-STATION-MODEL" : "EQ-MODEL";
    const model = hasMathItem(content, modelId) ? mathItem(content, modelId) : null;
    const lastIncorrect = [...item.attempts].reverse().find((a) => a.correct === false) ?? null;
    math = {
      id: itemId,
      version: def.version,
      kind: def.kind === "remainder" ? "remainder" : "sharing",
      prompt: def.prompt,
      scene: def.scene ?? null,
      quantity: def.quantity,
      groups: def.groups,
      perGroup: def.perGroup ?? null,
      unit: def.unit,
      group: def.group,
      phase: item.phase,
      attemptNo: item.attempts.length + 1,
      clarification: item.phase === "clarify" ? def.clarification ?? null : null,
      representation: item.phase === "represent" || item.phase === "clarify" ? def.representation ?? null : null,
      example: item.phase === "example" && model ? { prompt: model.prompt, steps: model.steps ?? [], quantity: model.quantity, groups: model.groups, answer: model.answer } : null,
      taughtAnswer: item.outcome === "taught" ? def.answer : null,
      taughtAnswers: item.outcome === "taught" && def.kind === "remainder" && def.answers ? { ...def.answers } : null,
      teachingOffered: item.outcome === "pending" && item.attempts.filter((a) => a.correct !== null).length >= content.math.rules.maxSubstantiveAttempts,
      outcome: item.outcome,
      lastPartial: def.kind === "remainder" && lastIncorrect?.remainder && def.answers ? { usedCorrect: lastIncorrect.remainder.used === def.answers.used, remainingCorrect: lastIncorrect.remainder.remaining === def.answers.remaining } : null,
      groupKind: content.math.recipientKinds?.[def.id] ?? (/forscher|person|kind|freund|team/i.test(def.group.singular) ? "people" : "container"),
    };
  }

  let language: ChildView["language"] = null;
  if (isLanguageSegmentId(stage) && state.language[stage] && hasLanguageSegment(content, stage)) {
    const segment = languageSegment(content, stage);
    const seg = state.language[stage]!;
    const step = segment.steps[seg.stepIndex] ?? null;
    let view: LanguageStepView | null = null;
    if (step) {
      if (step.kind === "listen-read") view = { id: step.id, kind: "listen-read", sentence: step.sentence, instruction: step.instruction };
      else if (step.kind === "pick-supply") {
        // The sentence follows the child's actual station choice (R2-4); "none" when declined or not chosen.
        const themeKey = state.station?.theme ?? "none";
        view = {
          id: step.id,
          kind: "pick-supply",
          sentence: step.variants?.[themeKey] ?? step.variants?.none ?? step.sentence,
          instruction: step.instruction,
          options: step.options.map((id) => ({ id, label: content.language.supplyLabels[id]?.de ?? id, emoji: content.language.supplyLabels[id]?.emoji ?? "📦" })),
        };
      } else {
        // Word choices are offered as a supported fallback; typed/spoken
        // production is the independent path.
        view = { id: step.id, kind: "produce", instruction: step.instruction, frame: step.frame, target: step.target, choices: segment.glosses.map((g) => g.word) };
      }
    }
    const last = seg.records.length ? seg.records[seg.records.length - 1] : null;
    let feedback: NonNullable<ChildView["language"]>["feedback"] = null;
    if (step && last && last.stepId === step.id && last.correct !== true) {
      const triesUsed = seg.records.filter((r) => r.stepId === step.id).length;
      const fallback = { clarify: "Sag es bitte noch einmal mit dem Satzanfang — oder mach ohne Bewertung weiter.", incorrect: "Das war etwas anderes. Schau dir das Wort an und probier es nochmal.", unclear: "Ich konnte das keiner Antwort zuordnen. Probier es nochmal — oder mach ohne Bewertung weiter." };
      const kind: "clarify" | "incorrect" | "unclear" = last.correct === false ? "incorrect" : /^unclear/.test(String(records_uncertainty(seg, step.id))) ? "unclear" : "clarify";
      const text = step.kind === "produce" ? (kind === "incorrect" ? step.correction : kind === "unclear" ? step.unclear : step.clarification) : step.kind === "pick-supply" ? step.correction : undefined;
      feedback = { kind, message: text ?? fallback[kind], triesUsed, retryAllowed: triesUsed < 2, continueOffered: step.kind === "produce" };
    }
    language = { id: segment.id, language: segment.language, title: segment.title, step: view, stepIndex: seg.stepIndex, stepCount: segment.steps.length, glosses: segment.glosses, lastCorrect: last?.correct ?? null, feedback };
  }

  let typing: TypingView | null = null;
  if (stage === "typing" && state.currentVisit) {
    const labelTask = content.typing.labelTasks.find((t) => t.visit === state.currentVisit) ?? null;
    const target = labelTask ? (labelTask.targetFrom === "baseName" ? state.base.name ?? "" : labelTask.target ?? "") : "";
    const label = labelTask && target ? { taskId: labelTask.id, instruction: labelTask.instruction, target } : null;
    const lesson = typingLessonForLayout(content, settings.keyboardLayout);
    if (lesson) {
      typing = {
        available: true,
        lesson: { id: lesson.id, title: lesson.title, layout: lesson.layout, homeRow: lesson.homeRow, fingers: lesson.fingers, lines: lesson.lines },
        label,
        lessonDone: state.typing.lessons.some((l) => l.lessonId === lesson.id && running !== null && l.at >= running.startedAt),
      };
    } else {
      typing = { available: false, reason: "layout-unconfirmed", label };
    }
  }

  let typingCourse: TypingCourseView | null = null;
  if (stage === "typing-course" && running) {
    const course = content.typing.course ?? null;
    const availability_ = practiceAvailability(state, content, settings);
    const lesson = availability_.available ? currentCourseLesson(state, content, settings) : null;
    const courseState = state.typing.course && settings.keyboardLayout && state.typing.course.layout === settings.keyboardLayout ? state.typing.course : null;
    typingCourse = {
      layoutLabel: content.typing.layouts.find((l) => l.id === settings.keyboardLayout)?.label ?? null,
      layoutLabels: Object.fromEntries(content.typing.layouts.map((l) => [l.id, l.label])),
      unavailable: availability_.reason,
      alignment: { keys: (course?.alignmentCheck.keys ?? []).map((k) => ({ id: k.id, prompt: k.prompt })), result: state.typing.alignment && state.typing.alignment.layout === settings.keyboardLayout ? state.typing.alignment : null },
      lesson: lesson && course ? { id: lesson.id, title: lesson.title, keys: lesson.keys, practiced: lesson.practiced, lines: lesson.lines, index: course.lessons.findIndex((l) => l.id === lesson.id), count: course.lessons.length } : null,
      homePosition: course?.homePosition ?? null,
      fingers: course?.fingers ?? {},
      progression: { minBursts: course?.progression.minBursts ?? 2, minAccuracy: course?.progression.minAccuracy ?? 0.9 },
      burstsThisVisit: (courseState?.bursts ?? []).filter((b) => b.at >= running.startedAt).map((b) => ({ lessonId: b.lessonId, accuracy: b.accuracy, comfort: b.comfort, correctChars: b.correctChars, denominator: b.denominator, extraChars: b.extraChars, omittedChars: b.omittedChars, substitutedChars: b.substitutedChars, lineCount: b.lineCount ?? b.lines.length })),
      decision: courseState?.decision ?? null,
      completed: courseState?.completed ?? [],
    };
  }

  let logRevise: LogReviseView | null = null;
  if (stage === "log-revise" && state.currentVisit) {
    const page = [...state.pages].reverse().find((p) => p.visit === state.currentVisit) ?? null;
    if (page) {
      const flags = flagSpacing(page.text, content.writing?.spacing.joins ?? []);
      logRevise = { original: page.text, marked: markSpacing(page.text, flags), suggested: suggestSpacing(page.text, flags), flags: flags.length, rules: [...new Set(flags.map((f) => f.rule))] };
    }
  }

  let transfer: ChildView["transfer"] = null;
  if (stage === "log-transfer" && state.currentVisit && content.writing?.transfer) {
    const t = content.writing.transfer;
    const revision = [...state.logRevisions].reverse().find((r) => r.visit === state.currentVisit) ?? null;
    transfer = { id: t.id, version: t.version, prompt: t.prompt, instruction: t.instruction, helpExposed: !!revision?.helpShown };
  }

  let tutor: TutorContext | null = null;
  if (math && math.outcome === "pending") {
    tutor = { taskId: math.id, taskVersion: math.version, language: "de", prompt: math.prompt, allowedHelp: "Erklären und Fragen beantworten, aber die Lösung nicht verraten." };
  } else if (language?.step) {
    const sentence = "sentence" in language.step ? language.step.sentence : language.step.frame;
    tutor = { taskId: `${language.id}/${language.step.id}`, taskVersion: 1, language: language.language, prompt: sentence, allowedHelp: "Wörter erklären (auf Deutsch), Beispiele geben, dann zurück zur Aufgabe." };
  }

  const minutesElapsed = running ? Math.floor((now.getTime() - new Date(running.startedAt).getTime()) / 60000) : 0;
  const def = running ? findVisitDef(content, running.id) ?? null : null;
  const stationDef = content.station ?? null;
  const station = state.station ?? emptyStation();
  // C2: the station prompt may only refer to what the child actually saved.
  const turtleLog = state.pages.some((p) => /schildkr[öo]t/i.test(p.text));
  const stationReference = turtleLog
    ? { kind: "turtles-in-log" as const, text: "In deinem Logbuch hast du Schildkröten erwähnt — du entscheidest, ob die Station sie beobachten soll. Beides ist ein guter Plan, und ohne Thema geht es auch." }
    : { kind: "none" as const, text: "Du entscheidest, was die Station beobachten soll. Beides ist ein guter Plan, und ohne Thema geht es auch." };

  return {
    child: state.child,
    revision: state.revision,
    erasureGeneration,
    contentVersion: state.contentVersion,
    title: settings.missionTitle ?? content.theme.defaultTitle,
    hook: settings.missionHook ?? content.theme.defaultHook,
    base: { name: state.base.name, location, supplies: state.base.supplies },
    scene: buildSceneModel(state, content),
    pages: state.pages,
    visit: running && def
      ? { id: running.id, ordinal: visitOrdinal(state, running.id), title: visitLabel(state, content, running.id), startedAt: running.startedAt, stage, stageIndex: running.stageIndex, stageCount: def.stages.length, minutesElapsed, overBudget: minutesElapsed >= content.visitBudgetMinutes.max, intro: def.intro ?? null }
      : null,
    next: { visit: availability.visit, ordinal: availability.visit ? visitOrdinal(state, availability.visit) : null, availableAt: availability.availableAt, reason: "reason" in availability ? availability.reason : null },
    delayedCheck: delayedCheckInfo(state, content, now),
    progress: buildProgress(state, content, { now, timeZone: options.timeZone ?? null, sources: options.progressSources ?? null }),
    vocabulary: options.vocabulary ? childVocabularyCue(buildVocabularyLedger(state, content, options.vocabulary), content, state) : null,
    nextStep: nextStepText(state, content, stage, now),
    locations: content.locations,
    station: stationDef ? { themes: stationDef.themes, spots: stationDef.spots, theme: station.theme, spot: station.spot, built: station.built, lampLit: station.lampLit, lampAvailable: (state.base.supplies["lámpara"] ?? 0) > 0, reference: stationReference } : null,
    math,
    language,
    typing,
    typingCourse,
    logRevise,
    summary: stage === "summary" && running ? buildVisitSummary(state, content, running.id) : null,
    transfer,
    reflection: stage === "reflect" ? { prompt: content.reflection.prompt, options: content.reflection.options, skipLabel: content.reflection.skipLabel ?? null, dimensions: content.reflection.dimensions ?? [] } : null,
    tutor,
    retention: content.retention.policy,
  };
}

/** The uncertainty tag of the last record on a step, kept on the record for the view. */
function records_uncertainty(seg: LanguageSegmentState, stepId: string): string | null {
  const last = seg.records.filter((r) => r.stepId === stepId).pop();
  return last?.uncertainty ?? null;
}

/** Bounded tutor message: reviewed context first, child text verbatim after. */
export const TUTOR_CONTEXT_SEPARATOR = "\n---\nFrage des Kindes:\n";
export const MAX_TUTOR_QUESTION_CHARS = 1500;

export function buildTutorMessage(context: TutorContext, childText: string): string {
  const question = childText.replace(/\r/g, "").slice(0, MAX_TUTOR_QUESTION_CHARS);
  const header = [
    "Kontext (Lern-Expedition, vom Lernsystem):",
    `Aufgabe ${context.taskId} v${context.taskVersion}, Sprache: ${context.language}.`,
    `Aufgabentext: ${context.prompt}`,
    `Erlaubte Hilfe: ${context.allowedHelp}`,
  ].join("\n");
  return `${header}${TUTOR_CONTEXT_SEPARATOR}${question}`;
}

/** Stage labels for the cockpit progress line. */
export function stageLabel(stage: StageId): string {
  switch (stage) {
    case "name-base": return "Name";
    case "place-base": return "Standort";
    case "restore": return "Zurück";
    case "EQ-ENTRY": return "Vorräte";
    case "EQ-FRESH": return "Team 2";
    case "EQ-RETURN": return "Garten";
    case "EQ-DELAY": return "Labor";
    case "EQ-STATION": return "Beete";
    case "explain": return "Erklären";
    case "LANG-EN-WATER": return "English";
    case "LANG-ES-AGUA": return "Español";
    case "LANG-ES-STATION": return "Español";
    case "typing": return "Tippen";
    case "typing-course": return "Tippen";
    case "station-choice": return "Station";
    case "station-build": return "Bauen";
    case "log": return "Logbuch";
    case "log-revise": return "Nochmal lesen";
    case "log-transfer": return "Neuer Satz";
    case "summary": return "Geschafft";
    case "reflect": return "Fertig";
  }
}

export { SCORED_IDS as SCORED_MATH_ITEM_IDS };
export type { MathItemId };
