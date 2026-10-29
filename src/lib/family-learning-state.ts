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
  isHarborWorkplaceId,
  isLanguageSegmentId,
  isScoredMathItemId,
  languageSegment,
  logDefFor,
  mathItem,
  transferDefFor,
  typingCourseForLayout,
  typingLessonForLayout,
  usedWordOf,
  type HarborWorkplace,
  type HarborWorkplaceId,
  type KeyboardLayoutId,
  type TargetLanguage,
  type LanguageSegment,
  type LanguageSegmentId,
  type LanguageStep,
  type LearningContent,
  type MathItem,
  type MathItemId,
  type ReasoningDef,
  type ScoredMathItemId,
  type StageId,
  type TypingCourseLesson,
  type VisitId, type WritingReviewAspect } from "./family-learning-content.ts";
import { buildSceneModel, buildVisitSummary, delayAnchor, delayedCheckInfo, visitLabel, visitOrdinal, type DelayedCheckInfo, type SceneModel, type VisitSummary } from "./family-learning-summary.ts";
import { buildProgress, type ProgressStrip, type ProgressSources } from "./family-learning-progress.ts";
import { buildVocabularyLedger, childVocabularyCue, childWordbook, type VocabularyInventory, type ChildVocabularyCue, type ChildWordbook } from "./family-learning-vocabulary.ts";
import { alignTyping, alignedLessonMetrics, TYPING_METRIC_VERSION, type AlignedLineMetrics } from "./family-learning-typing-metrics.ts";
import { assessSpacing, evaluateRevision, flagSpacing, markSpacing, suggestSpacing, type SpacingFlag } from "./family-learning-writing.ts";
import { buildWritingReviewDispatch, evaluateLogRevision, parseWritingReviewReply, reviewLogSentence, revisionEvidence, unavailableSemanticReview, unverifiedSemanticReview, writingAspectLabel, type LogRevisionEvaluation, type SemanticReview, type TeachingPoint, type WritingReview } from "./family-learning-writing-review.ts";
import { applyReasoningChoice, applyReasoningReply, applyReasoningTurn, childExplanationText, closeReasoningUnresolved, effectiveLevel, levelLabel, MAX_REPLY_CHARS, methodLabel, newReasoningState, pendingDispatch, turnsLeft, type AssessmentLevel, type ReasoningDispatchContext, type ReasoningState, type ReplyOrigin } from "./family-learning-reasoning.ts";
import { sha256Hex } from "./family-learning-hash.ts";
import { liveTutorDeferred } from "./family-learning-deferral.ts";
import { farewellLines } from "./family-learning-narration.ts";
import { applyMissionAction, buildMissionView, chosenGrid, chosenOption, mapEnding, narratedWorkshopEnding, narratedWorkshopRecap, workshopEnding, workshopRecap, missionDefFor, MissionOpError, newMissionRun, pendingInterest, recordInterest, stepStatuses, visibleWorld, type InterestRecord, type MissionAction, type MissionRun, type MissionView } from "./family-learning-mission.ts";
import { applyNoktTalk, noktTalkView } from "./family-learning-nokt-talk.ts";
import { originWithoutBinding, provenanceOf, receiptOrigin as bindReceipt, type InvalidReceipt, type ReceiptInput, type VerifiedReceipt } from "./family-learning-trust.ts";
import {
  childFacingUnclear,
  acknowledgeLesson,
  buildVisitReports,
  closeRepair,
  emptyFeedbackState,
  evaluateSentenceRetry,
  feedbackOf,
  findRepair,
  languageWordsOf,
  lastLessonFeedback,
  markRepairExplained,
  nextRetryItem,
  openLabelRepair,
  openLanguageRepair,
  openTypingRepair,
  openWritingRepair,
  recordRepairRetry,
  reminderFor,
  repairItems,
  effectiveMaxRetries,
  typingErrors,
  updateLanguageFocus,
  updateMathFocus,
  updateSpacingFocus,
  updateTypingFocus,
  type RepairRetry,
  type FeedbackState,
  type LessonFeedback,
  type ReminderCue,
  type TypingError,
  type VisitReport,
} from "./family-learning-feedback.ts";

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
  | "word_choice"
  /** UX-5b: the visual worked example of a targeted mini-lesson, recorded before it is shown (never answer-relevant). */
  | "mini_lesson"
  /** Content v5 (Visit 6): mission help and listening plays, namespaced (`mission_transcript`, `mission_language_repair`, …). */
  | `mission_${string}`;

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
  /** Quotient items (content v4): part A (full groups, remaining) or part B (groups needed for all) as answered. */
  quotient?: { full: number | null; remaining: number | null; needed: number | null } | null;
  /** Quotient items: which part the attempt answered. */
  part?: "full-remaining" | "needed";
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
  /** Quotient items (content v4): the accepted (full, remaining) once part A is correct; `needed` once part B is resolved. */
  quotientResult?: { full: number; remaining: number; needed: number | null } | null;
  /** Quotient items: the part currently asked (`needed` after part A is correct). Absent on other items. */
  part?: "full-remaining" | "needed";
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
  /** Per-character mismatches of the final line text (world-first 2026-10-03); absent on earlier records — never reconstructed. */
  errors?: TypingError[];
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
  errors?: TypingError[];
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
  /** Per-character mismatches of the final line text (world-first 2026-10-03); absent on rounds saved before it. */
  errors?: TypingError[];
  /** Visit 6: the mission typing block this drill came from (comfort = the block's one answer); absent on course rounds. */
  blockId?: string;
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

/** The pier of visit v5 (content v3): built at a chosen spot; the boat is moored only when the English request supplied wood. */
export type PierState = {
  spot: string | null;
  built: boolean;
  builtAt: string | null;
  boatMoored: boolean;
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
  /**
   * Content v4: the EFFECTIVE stage order of this visit (the harbor chapter lets the child choose which workplace comes
   * first). Absent on every earlier visit — then the frozen content stage list applies. `stageIndex` indexes this route.
   */
  route?: StageId[];
  /** Every skip stays recorded; `undone` marks a skip the child later caught up by re-entering the workplace (repair round 3). */
  /** `deferred` = the live tutor hop is deferred for this visit (owner scope reduction, 2026-10-11): not the child's skip, never caught up, never credited. */
  skippedStages: { stage: StageId; reason: "time" | "child" | "deferred"; undone?: true }[];
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

/** The harbor of visit v6 (content v4): the plan is saved once; boats are tied only when the Spanish request supplied cuerdas. */
export type HarborState = {
  destination: string | null;
  planned: boolean;
  plannedAt: string | null;
  roped: boolean;
  /** Workplaces the child has entered, in order (first entry decides the route). */
  entered: HarborWorkplaceId[];
  /** Workplaces the child re-entered after skipping them ("nachholen"); additive (repair round 3). */
  reentered?: HarborWorkplaceId[];
};

/** The reviewed writing review of the child's own log sentence and the bounded revision (content v4, log-review stage). */
/**
 * The VERIFIED claims of a bridge response receipt, as decoded by the route (signature checked with the shared secret).
 * The state machine never sees a raw receipt and never trusts a caller-supplied origin: it binds these claims to the
 * pending dispatch (turn id, dispatch hash, reply hash, child, session). Repair round 2, IV5-03.
 */
export type { InvalidReceipt, ReceiptInput, VerifiedReceipt };

export type LogReviewSemanticRecord = {
  visit: VisitId;
  logId: string;
  /** Deterministic binding to the sentence: `wr-<visit>-<digits of page.at>`. */
  turnId: string;
  /** `pending` = dispatch recorded, reply not yet applied. */
  status: SemanticReview["status"] | "pending";
  semantic: SemanticReview | null;
  /** Four-way origin of the applied reply (R4-08); absent while pending. */
  origin?: ReplyOrigin;
  /** Authenticated run metadata from the receipt (v2), or null. */
  provenance?: { model: string; runId: string } | null;
  /** sha256 of the dispatch message (the receipt's `req`). */
  reqHash: string;
  dispatchedAt: string;
  at: string;
};

export type LogReviewRecord = {
  visit: VisitId;
  logId: string;
  original: string;
  /** The review as shown (findings, taught points, clean aspects, unknown words, suggestion) — immutable once recorded. */
  review: WritingReview;
  revised: string | null;
  evaluation: LogRevisionEvaluation | null;
  /** The child's answers to "Was meinst du mit …?" (unknown words), verbatim, unscored. */
  clarifications: Record<string, string>;
  outcome: "revised" | "partial" | "unchanged" | "none-needed" | "skipped";
  /** Whether the suggestion (help) was shown before the revision. */
  helpShown: boolean;
  /** Recorded in-app help for the corrected mechanical criteria (assessment reset §6): never a correctness claim; absent on a skipped record. */
  evidence?: "independent" | "supported" | "incorrect" | "unscored";
  /** Always null since the assessment reset (no global revision-correct claim). */
  correct?: boolean | null;
  /** Per-criterion findings of the revision (corrected / changed / unresolved / unassessed / introduced). */
  criteria?: import("./family-learning-writing-review.ts").CriterionFinding[];
  modality: "typed";
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
  /** The quotient teaching example (EQ-HARBOR-MODEL, content v4) shown once. */
  harborModelShownAt?: string | null;
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
  /** Visit 4 (content v3, 2026-10-04): the pier in the bay — additive; absent on earlier rows. */
  pier?: PierState;
  /** Visit 5 (content v4, 2026-10-10): the harbor — additive; absent on earlier rows. */
  harbor?: HarborState;
  /** Visit 5: the reasoning conversation per scored item (additive). */
  reasoning?: Partial<Record<ScoredMathItemId, ReasoningState>>;
  /** Visit 5: the reviewed writing review + revision of the captain's log (additive). */
  logReviews?: LogReviewRecord[];
  /** Visit 5 (repair round 1): the assistant's semantic review of the captain's log, per sentence (additive). */
  logReviewSemantics?: LogReviewSemanticRecord[];
  /**
   * Free-question dispatches the SERVER built (assessment reset §7, R4-01; consumed pending contexts since R5-01/02): the immutable
   * context a tutor reply's receipt must bind to — child, session, visit, task, turn, request hash — and its consumption state.
   * `pending` → exactly one reply consumes it (`consumed` when bound and verified, `failed` on a transport failure or untrusted
   * reply); a consumed/failed context never accepts another reply. Bounded, additive.
   */
  tutorDispatches?: { turnId: string; taskId: string | null; visitId: VisitId; child: ChildId; sessionSuffix: "learn"; childText: string; reqHash: string; at: string; status: "pending" | "consumed" | "failed"; consumedAt?: string; outcome?: { origin: ReplyOrigin; resHash: string | null; shown: boolean } }[];
  logRevisions: LogRevision[];
  transfers?: TransferRecord[];
  /** Lesson-end repairs, practice focus and acknowledged lesson feedback (world-first 2026-10-03, additive; absent on earlier rows). */
  feedback?: FeedbackState;
  /** Content v5 (Visit 6, 2026-10-16): the run of each reviewed mission (`family-learning-mission.ts`) — additive; absent on earlier rows. */
  missions?: Record<string, MissionRun>;
  /** Content v5: the child's own answers to "what next?" (verbatim, append-only) — additive; absent on earlier rows. */
  interests?: InterestRecord[];
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

const SCORED_IDS: readonly ScoredMathItemId[] = ["EQ-ENTRY", "EQ-FRESH", "EQ-RETURN", "EQ-DELAY", "EQ-STATION", "EQ-PIER", "EQ-HARBOR", "EQ-HARBOR-CHECK"];

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

function emptyPier(): PierState {
  return { spot: null, built: false, builtAt: null, boatMoored: false };
}

function emptyHarbor(): HarborState {
  return { destination: null, planned: false, plannedAt: null, roped: false, entered: [] };
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
    pier: emptyPier(),
    harbor: emptyHarbor(),
    reasoning: {},
    logReviews: [],
    logReviewSemantics: [],
    logRevisions: [],
    transfers: [],
    feedback: emptyFeedbackState(),
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
  if (!state.pier) {
    state.pier = emptyPier();
    changed = true;
  }
  if (!state.harbor) {
    state.harbor = emptyHarbor();
    changed = true;
  }
  if (!state.reasoning) {
    state.reasoning = {};
    changed = true;
  }
  if (!Array.isArray(state.logReviews)) {
    state.logReviews = [];
    changed = true;
  }
  if (!Array.isArray(state.logReviewSemantics)) {
    state.logReviewSemantics = [];
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
  if (!state.feedback) {
    state.feedback = emptyFeedbackState();
    changed = true;
  }
  // Only ever upgrade: under a lower served content version (cap / rollback) the
  // saved shape is kept as is, so returning to the newer content resumes exactly.
  if (state.contentVersion < content.contentVersion) {
    // `upgradedAt` dates the ONE upgrade from the pilot content (version 1): historical reviews of pilot visits are
    // labelled by it. A later additive upgrade (2 → 3, Visit 4) never moves it, so chapter reviews keep their version.
    // Isabel's own line (`isabel-workshop`) never had a pilot: her 1 → 2 upgrade (Visit 2) dates nothing.
    if (state.contentVersion === 1 && content.contentId !== "isabel-workshop") state.upgradedAt = nowIso;
    state.contentVersion = content.contentVersion;
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
  kind: "explanation" | "expedition_log" | "expedition_log_revision" | "writing_transfer" | "typed_label" | "language_response" | "typing_practice" | "typing_burst" | "typing_retry" | "writing_retry" | "language_retry" | "reasoning_turn" | "writing_review" | "writing_clarification" | "next_interest" | "self_report";
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
  | { op: "support"; taskId: string | null; kind: SupportKind; payload?: unknown; receipt?: ReceiptInput }
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
  | { op: "build-pier"; spot: string }
  /** Content v4 (Visit 5): enter a harbor workplace from the island; the first entry decides the route. */
  | { op: "enter-workplace"; workplace: HarborWorkplaceId }
  /** Content v4: quotient item part A (full groups + remaining) and part B (groups needed for all). */
  | { op: "answer-quotient"; itemId: ScoredMathItemId; full: number | null; remaining: number | null; raw: string; modality: AnswerModality; uncertain?: boolean }
  | { op: "answer-needed"; itemId: ScoredMathItemId; needed: number | null; raw: string; modality: AnswerModality; uncertain?: boolean }
  /** Content v4 (repair round 1): one child turn of the reasoning conversation (typed, or a confirmed transcript) — recorded, validated and prepared as a bridge dispatch; the assistant's reply bound to that turn; the scaffold choice. */
  | { op: "reasoning-turn"; text: string; modality: "typed" | "spoken" }
  /** `receipt`: set ONLY by the server route after verifying the bridge's signature (never from the client); absent = unverified origin. */
  | { op: "reasoning-reply"; turnId: string; ok: boolean; text: string; receipt?: ReceiptInput }
  | { op: "reasoning-choice"; choice: "counters" | "teach" | "continue" }
  /** Content v4: the harbor plan (a reviewed destination), exactly once. */
  | { op: "plan-harbor"; destination: string }
  /** Content v4: the bounded revision of the child's own log sentence after the writing review (+ answers to unknown-word questions). */
  | { op: "review-log"; text: string; clarifications?: Record<string, string> }
  /** Content v4 (repair round 1): the assistant's semantic review of the captain's log sentence, bound to the sentence. */
  | { op: "review-log-dispatch"; turnId: string }
  | { op: "review-log-semantic"; turnId: string; ok: boolean; text: string; receipt?: ReceiptInput }
  | { op: "revise-log"; text: string }
  | { op: "summary-seen" }
  /** `deferred` (D1, 2026-10-11): the owner-deferral transition for an ALREADY-ACTIVE `explain` stage of a deferred visit — not the child's skip; accepted only there. */
  | { op: "skip-stage"; stage: StageId; reason: "time" | "child" | "deferred" }
  | { op: "save-log"; text: string; modality?: "typed" | "spoken" }
  | { op: "reflect"; optionId: string | null; difficultySkipped?: boolean; feedback?: { enjoyment?: string | null; clarity?: string | null }; interest?: { kind: InterestRecord["kind"]; text?: string | null; choice?: string | null } }
  /** Content v5 (Visit 6): one action of the reviewed mission (stage `mission`). */
  | { op: "mission"; action: MissionAction }
  /** Content v5: the next-visit interest asked at the next entry after an early exit (only while one is pending). */
  | { op: "record-interest"; kind: InterestRecord["kind"]; text?: string | null; choice?: string | null }
  | { op: "write-transfer"; text: string; modality?: "typed" | "spoken" }
  /** UX-5b: record that the mini-lesson's worked example is shown (before it is shown). */
  | { op: "repair-explain"; repairId: string }
  /** UX-5b: one targeted retry line of the same reviewed lesson (typing round or label); `retryNo` must be the next retry. */
  | { op: "typing-retry"; repairId: string; retryNo: number; lineIndex: number; typed: string; seconds: number }
  /** UX-5b (F2): correct the child's own flagged transfer sentence; evaluated with the reviewed spacing rules. */
  | { op: "writing-retry"; repairId: string; retryNo: number; text: string }
  /** UX-5b (F2): the same reviewed language step again (pick an option, or produce the frame). */
  | { op: "language-retry"; repairId: string; retryNo: number; stepId: string; response: string }
  /** UX-5b: close the bounded loop honestly (done = outcome from the retries; skip = moved on). */
  | { op: "repair-close"; repairId: string; reason: "done" | "skip" }
  /** UX-5a: the child has seen the lesson-end feedback and moves on. */
  | { op: "lesson-feedback-seen"; id: string }
  /** Content v7 (Visit 8): one Nokt conversation action outside the task talk (Home, welcome, visit, writing, debrief). Only the Nokt turn routes may apply it. */
  | { op: "nokt-talk"; action: import("./family-learning-nokt-talk.ts").NoktTalkAction }
  /** Content v7: the closing button answers (enjoyment, clarity) recorded BEFORE the spoken look back, so the debrief can use them. */
  | { op: "closing-feedback"; feedback: { difficulty?: string | null; enjoyment?: string | null; clarity?: string | null } };

export type OpEnv = {
  content: LearningContent;
  settings: ParentSettings;
  now: () => Date;
  newId: () => string;
  /** Content v6: a verified child tutor route is available. Absent = unavailable (production: CHILD_ASSISTANT_AI_ENABLED = false). */
  tutorAvailable?: boolean;
  /** Content v6: the origin of a tutor result as verified by the ROUTE (bridge receipt); never taken from the client payload. */
  tutorOrigin?: import("./family-learning-trust.ts").ReplyOrigin;
  /** Content v6: the reply receipt as verified by the Nokt reply ROUTE (signature checked; the engine binds it to its dispatch). */
  tutorReceipt?: import("./family-learning-trust.ts").ReceiptInput;
  /** Content v7: Nokt's conversation is switched on for this deployment (server env only; plans offers/reactions, grants nothing). */
  noktEnabled?: boolean;
};

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

/** The effective stage list of a visit: its own route (content v4, free workplace order) or the frozen content list. */
export function visitStages(visit: VisitRecord, content: LearningContent): readonly StageId[] | null {
  // A visit the served content does not define (content cap / rollback) is parked: no stage, whatever its saved route says.
  const def = findVisitDef(content, visit.id);
  if (!def) return null;
  return visit.route ?? def.stages;
}

export function currentStage(state: MissionState, content: LearningContent): StageId | null {
  if (!state.currentVisit) return null;
  const visit = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null);
  if (!visit) return null;
  return visitStages(visit, content)?.[visit.stageIndex] ?? null;
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
  visitDef(content, visit.id);
  const stages = visitStages(visit, content) ?? [];
  // Stages that can no longer apply are skipped honestly, never faked.
  while (visit.stageIndex < stages.length) {
    const stage = stages[visit.stageIndex];
    if (stage === "restore" && !state.base.name) {
      visit.stageIndex += 1;
      continue;
    }
    if (stage === "explain" && liveTutorDeferred(visit.id)) {
      // Temporary Visit 5 scope reduction: the live reasoning conversation is deferred. The stage is passed with the explicit
      // non-child reason `deferred` — no reasoning state, no work sample, no method credit, no tutor call.
      if (!visit.skippedStages.some((s) => s.stage === "explain" && s.reason === "deferred")) visit.skippedStages.push({ stage: "explain", reason: "deferred" });
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
  // Isabel's own content line: her visits in the reviewed order — never Santiago's chapter sequence.
  if (content.child === "isabel") {
    const nextDef = content.visits.find((v) => !finished.includes(v.id));
    return nextDef ? { visit: nextDef.id, availableAt: null } : { visit: null, availableAt: null, reason: "all-visits-done" };
  }
  if (!finished.includes("v1")) return { visit: "v1", availableAt: null };
  if (!finished.includes("v2")) return { visit: "v2", availableAt: null };
  const hasV4 = content.visits.some((v) => v.id === "v4");
  if (hasV4 && !finished.includes("v4")) return { visit: "v4", availableAt: null };
  if (!hasV4) return { visit: null, availableAt: null, reason: "no-further-visit-served" };
  // Visit 4 (content v3, 2026-10-04): the pier chapter `v5` follows the finished station chapter immediately — no replay,
  // no wait, no retired v3. Under content version 2 (cap / rollback) nothing further is offered and a running v5 is parked.
  const hasV5 = content.visits.some((v) => v.id === "v5");
  if (hasV5 && !finished.includes("v5")) return { visit: "v5", availableAt: null };
  if (!hasV5) return { visit: null, availableAt: null, reason: "all-visits-done" };
  // Visit 5 (content v4, 2026-10-10): the harbor chapter `v6` follows the finished pier chapter immediately. Under content
  // version 3 (cap / rollback) nothing further is offered and a running v6 is parked.
  const hasV6 = content.visits.some((v) => v.id === "v6");
  if (hasV6 && !finished.includes("v6")) return { visit: "v6", availableAt: null };
  // Visit 6 (content v5, 2026-10-16): the mission chapter `v7` follows the finished harbor chapter immediately. Under content
  // version 4 (cap / rollback) nothing further is offered and a running v7 is parked.
  const hasV7 = content.visits.some((v) => v.id === "v7");
  if (hasV7 && !finished.includes("v7")) return { visit: "v7", availableAt: null };
  // Visit 7 (content v6, 2026-10-23): the garden scene mission `v8` follows the finished Visit 6 immediately; Visit 6 is never
  // replayed or reset. Under content version 5 (cap / rollback) nothing further is offered and a running v8 is parked.
  const hasV8 = content.visits.some((v) => v.id === "v8");
  if (hasV8 && !finished.includes("v8")) return { visit: "v8", availableAt: null };
  // Visit 8 (content v7, 2026-10-26): the greenhouse map mission `v9` follows the finished Visit 7 immediately; Visit 7 is never
  // replayed or reset. Under content version 6 (cap / rollback) nothing further is offered and a running v9 is parked.
  const hasV9 = content.visits.some((v) => v.id === "v9");
  if (hasV9 && !finished.includes("v9")) return { visit: "v9", availableAt: null };
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

/** The retry items of a repair not yet used. */
function repairItemsLeft(state: MissionState, content: LearningContent, repair: import("./family-learning-feedback.ts").LessonRepair) {
  const items = repairItems(state, content, repair);
  return items.slice(repair.retries.length, effectiveMaxRetries(repair, items));
}

/** The task a repair record names (`typing:<lesson>` → lesson id, `label:<task>` → task id, `writing:<transfer>` → transfer id, `language:<segment>` → segment id). */
function repairTaskId(lesson: string): string {
  return lesson.slice(lesson.indexOf(":") + 1);
}

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

function evidenceFor(item: MathItemState, correct: boolean | null, fresh: boolean, part?: "full-remaining" | "needed"): EvidenceCategory {
  if (correct === null) return "unscored";
  if (!correct) return "incorrect";
  if (item.exposure === "answer_revealed") return "answer_exposed";
  // Quotient items: each part is its own question — only substantive attempts of the SAME part count against freshness.
  const substantive = item.attempts.filter((a) => a.correct !== null && (part === undefined || (a.part ?? "full-remaining") === part)).length;
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

/** Text kept EXACTLY as typed (only \r removed): the child's own writing is evidence and is never normalised. */
function exactText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new LearningOpError("invalid", `${label} must be text`);
  const text = value.replace(/\r/g, "");
  if (!text.trim()) throw new LearningOpError("invalid", `${label} must not be empty`);
  if (text.length > max) throw new LearningOpError("invalid", `${label} is too long`);
  return text;
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

/** Deterministic binding of the semantic review to one sentence. */
function semanticTurnId(visit: VisitId, page: ExpeditionPage): string {
  return `wr-${visit}-${page.at.replace(/\D/g, "")}`;
}

/** The ONE binding step of the trusted-reply boundary (`family-learning-trust.ts`): mismatching claims are a forgery and refused. */
function receiptOrigin(receipt: ReceiptInput, expected: { child: string; turnId: string; reqHash: string; text: string }): ReplyOrigin {
  try {
    return bindReceipt(receipt, expected);
  } catch {
    throw new LearningOpError("not-allowed", "the receipt does not match this turn");
  }
}

/** Nabu's assessment as shown (effective levels: a stale or pre-retraction-grounded assessment reads as uncertain). */
export function reasoningAssessmentView(r: ReasoningState, def: ReasoningDef): ReasoningAssessmentView | null {
  const a = r.final ?? r.assessments[r.assessments.length - 1] ?? null;
  if (!a) return null;
  return { by: a.by, revision: a.revision, revisions: r.assessments.length, stale: a.stale, ungrounded: a.ungrounded, preRetractionGrounding: a.preRetractionGrounding, criteria: def.criteria.map((c) => ({ id: c.id, label: c.label, level: effectiveLevel(a, c.id)!, levelLabel: levelLabel(def, effectiveLevel(a, c.id)), passages: a.criteria[c.id].passages, rationale: a.criteria[c.id].rationale })) };
}

function semanticReviewFor(state: MissionState, visit: VisitId, page: ExpeditionPage): LogReviewSemanticRecord | null {
  const id = semanticTurnId(visit, page);
  return (state.logReviewSemantics ?? []).find((r) => r.visit === visit && r.turnId === id) ?? null;
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

/** Position of a contiguous block inside a stage list, or -1. */
function indexOfBlock(list: readonly StageId[], block: readonly StageId[]): number {
  outer: for (let i = 0; i + block.length <= list.length; i += 1) {
    for (let k = 0; k < block.length; k += 1) if (list[i + k] !== block[k]) continue outer;
    return i;
  }
  return -1;
}

/** Position of the LAST occurrence of a contiguous block (a re-entered workplace appears twice in the route), or -1. */
function lastIndexOfBlock(list: readonly StageId[], block: readonly StageId[]): number {
  let found = -1;
  outer: for (let i = 0; i + block.length <= list.length; i += 1) {
    for (let k = 0; k < block.length; k += 1) if (list[i + k] !== block[k]) continue outer;
    found = i;
  }
  return found;
}

/** A skip that still stands (not caught up by re-entering the workplace). */
function standingSkip(visit: VisitRecord, stage: StageId): boolean {
  return visit.skippedStages.some((sk) => sk.stage === stage && !sk.undone);
}

export type WorkplaceStatus = "open" | "done" | "locked" | "current" | "skipped";

/**
 * The harbor workplaces of a routed visit with their honest status: done when its (last) block lies behind the stage
 * index and real work happened there, SKIPPED when every required stage of the passed block was skipped (the child may
 * re-enter it: "nachholen"), current when inside it, open otherwise. The closing check stays LOCKED until every other
 * workplace is DONE — a skipped block never unlocks it (completion semantics, repair round 3).
 */
export function workplaceStatuses(state: MissionState, content: LearningContent, visit: VisitRecord): { id: HarborWorkplaceId; status: WorkplaceStatus }[] {
  void state;
  const harborDef = content.harbor;
  if (!harborDef || !visit.route) return [];
  const route = visit.route;
  const plain = (w: HarborWorkplace): WorkplaceStatus => {
    const start = lastIndexOfBlock(route, w.stages);
    const end = start + w.stages.length; // exclusive
    if (start < 0) return "locked";
    if (visit.stageIndex >= end) {
      // Passed, but a block whose every required stage was SKIPPED is not done work (IV5-10): honest "skipped".
      const required = w.stages.filter((st) => st !== "island");
      const allSkipped = required.length > 0 && required.every((st) => standingSkip(visit, st));
      return allSkipped ? "skipped" : "done";
    }
    if (visit.stageIndex >= start) return "current";
    return "open";
  };
  return harborDef.workplaces.map((w) => {
    let status = plain(w);
    if (status === "open" && w.afterAllOthers) {
      const othersDone = harborDef.workplaces.filter((o) => o.id !== w.id).every((o) => plain(o) === "done");
      status = othersDone ? "open" : "locked";
    }
    return { id: w.id, status };
  });
}

/** Workplaces the child may enter from the island: open ones and skipped ones (to catch up). */
function openWorkplaces(state: MissionState, content: LearningContent, visit: VisitRecord): { id: HarborWorkplaceId; status: WorkplaceStatus }[] {
  return workplaceStatuses(state, content, visit).filter((w) => w.status === "open" || w.status === "current" || w.status === "skipped");
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
      const def = visitDef(content, availability.visit);
      // Content v4: a chapter with free workplace order carries its own route (initially the frozen default order).
      const routed = content.harbor && def.stages.includes("island");
      state.visits.push({ id: availability.visit, startedAt: nowIso, finishedAt: null, stageIndex: 0, skippedStages: [], reflection: null, ...(routed ? { route: [...def.stages] } : {}) });
      state.currentVisit = availability.visit;
      // Content v5: a mission visit starts its reviewed mission run (position at the map start, nothing done).
      const missionDef = missionDefFor(content, availability.visit);
      if (missionDef) state.missions = { ...(state.missions ?? {}), [missionDef.id]: newMissionRun(missionDef, availability.visit, nowIso) };
      // `restore` is only meaningful when a base exists.
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

    case "build-pier": {
      requireStage(state, content, "pier-build");
      const spots = content.pier?.spots ?? [];
      if (!spots.some((s) => s.id === op.spot)) throw new LearningOpError("invalid", "unknown pier spot");
      const pier = state.pier ?? emptyPier();
      if (pier.built) throw new LearningOpError("not-allowed", "the pier is already built");
      // The boat is moored only if the English request actually supplied wood (durable supply), like the station's lamp.
      const boat = (state.base.supplies["wood"] ?? 0) > 0;
      state.pier = { ...pier, spot: op.spot, built: true, builtAt: nowIso, boatMoored: boat };
      advance(state, content);
      result = { spot: op.spot, boatMoored: boat };
      break;
    }

    case "enter-workplace": {
      requireStage(state, content, "island");
      const visit = currentVisit(state);
      const harborDef = content.harbor;
      if (!harborDef || !visit.route) throw new LearningOpError("not-available", "this chapter has no workplaces");
      if (!isHarborWorkplaceId(op.workplace)) throw new LearningOpError("invalid", "unknown workplace");
      const workplace = harborDef.workplaces.find((w) => w.id === op.workplace);
      if (!workplace) throw new LearningOpError("invalid", "unknown workplace");
      const harbor = state.harbor ?? emptyHarbor();
      const open = openWorkplaces(state, content, visit);
      const chosen = open.find((w) => w.id === op.workplace);
      if (!chosen) throw new LearningOpError("not-allowed", `the ${op.workplace} workplace is not open`);
      const rest = visit.route.slice(visit.stageIndex + 1);
      const block = [...workplace.stages];
      const start = indexOfBlock(rest, block);
      if (chosen.status === "skipped") {
        // Catching up a skipped workplace: its block is inserted again right after this island stop (nothing passed is
        // rewritten; the earlier skips stay recorded and are marked as caught up so the status can become "done" only
        // through real work in the re-entered block).
        visit.route = [...visit.route.slice(0, visit.stageIndex + 1), ...block, "island", ...rest];
        for (const sk of visit.skippedStages) if (block.includes(sk.stage) && !sk.undone && sk.reason !== "deferred") sk.undone = true;
        (harbor.reentered ??= []).push(op.workplace);
      } else if (start > 0) {
        // Move the chosen block to the front of the remaining route (the blocks keep their internal order; nothing done is touched).
        const without = [...rest.slice(0, start), ...rest.slice(start + block.length)];
        // The island stop that preceded the block in the default order moves with it: remove the first "island" after the moved block.
        const nextIsland = without.indexOf("island");
        if (nextIsland >= 0) without.splice(nextIsland, 1);
        visit.route = [...visit.route.slice(0, visit.stageIndex + 1), ...block, "island", ...without];
      }
      harbor.entered.push(op.workplace);
      state.harbor = harbor;
      advance(state, content);
      result = { workplace: op.workplace, route: visit.route, reentered: chosen.status === "skipped" };
      break;
    }

    case "plan-harbor": {
      requireStage(state, content, "harbor-build");
      const destinations = content.harbor?.destinations ?? [];
      if (!destinations.some((d) => d.id === op.destination)) throw new LearningOpError("invalid", "unknown destination");
      const harbor = state.harbor ?? emptyHarbor();
      if (harbor.planned) throw new LearningOpError("not-allowed", "the harbor plan is already saved");
      // The boats are tied only if the Spanish request actually supplied ropes (durable supply), like the pier's boat and the station's lamp.
      const roped = (state.base.supplies["cuerdas"] ?? 0) > 0;
      state.harbor = { ...harbor, destination: op.destination, planned: true, plannedAt: nowIso, roped };
      advance(state, content);
      result = { destination: op.destination, roped };
      break;
    }

    case "answer-quotient":
    case "answer-needed": {
      requireStage(state, content, op.itemId);
      const def = mathItem(content, op.itemId);
      const item = mathState(state, op.itemId);
      if (def.kind !== "quotient" || !def.answers || def.answers.full === undefined || def.answers.needed === undefined) throw new LearningOpError("invalid", "this item is not a quotient item");
      if (item.outcome !== "pending") throw new LearningOpError("not-allowed", "item already resolved");
      if (item.phase !== "answer" && item.phase !== "represent" && item.phase !== "clarify") throw new LearningOpError("not-allowed", `item is in phase ${item.phase}`);
      const part: "full-remaining" | "needed" = item.part ?? "full-remaining";
      if ((part === "needed") !== (op.op === "answer-needed")) throw new LearningOpError("invalid", part === "needed" ? "this part asks how many groups are needed for all" : "this part asks for the full groups and the remaining");
      let uncertain: boolean;
      let correct: boolean | null;
      let quotient: MathAttempt["quotient"];
      let partial: Record<string, unknown> = {};
      if (op.op === "answer-quotient") {
        uncertain = op.uncertain === true || op.full === null || op.remaining === null || !Number.isInteger(op.full) || !Number.isInteger(op.remaining);
        quotient = { full: uncertain ? null : op.full, remaining: uncertain ? null : op.remaining, needed: null };
        const fullCorrect = quotient.full === def.answers.full;
        const remainingCorrect = quotient.remaining === def.answers.remaining;
        correct = uncertain ? null : fullCorrect && remainingCorrect;
        partial = uncertain ? {} : { fullCorrect, remainingCorrect };
      } else {
        uncertain = op.uncertain === true || op.needed === null || !Number.isInteger(op.needed);
        quotient = { full: null, remaining: null, needed: uncertain ? null : op.needed };
        correct = uncertain ? null : quotient.needed === def.answers.needed;
      }
      if (op.modality === "counters" && !item.supportGiven.includes("counters")) item.supportGiven.push("counters");
      const partAttempts = item.attempts.filter((a) => (a.part ?? "full-remaining") === part);
      const fresh = partAttempts.every((a) => a.correct === null) && item.exposure !== "answer_revealed" && (item.shownVisit === null || item.shownVisit === state.currentVisit);
      const evidence = evidenceFor(item, correct, fresh, part);
      const substantiveBefore = partAttempts.filter((a) => a.correct !== null).length;
      const attempt: MathAttempt = {
        no: item.attempts.length + 1,
        visit: state.currentVisit as VisitId,
        answer: op.op === "answer-quotient" ? quotient.full : quotient.needed,
        quotient,
        part,
        raw: boundedText(op.raw || "", 80, "answer"),
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
      if (correct === true && part === "full-remaining") {
        // Part A done: the decision question (part B) follows on the same item; nothing is resolved yet.
        item.quotientResult = { full: quotient.full as number, remaining: quotient.remaining as number, needed: null };
        item.part = "needed";
        item.phase = "answer";
        feedback = "answer";
      } else if (correct === true) {
        item.outcome = "correct";
        item.phase = "done";
        item.allocation = def.answers.full;
        item.quotientResult = { full: item.quotientResult?.full ?? def.answers.full, remaining: item.quotientResult?.remaining ?? def.answers.remaining, needed: quotient.needed as number };
        item.resolvedAt = nowIso;
        feedback = "done";
      } else if (correct === null) {
        feedback = item.phase;
      } else {
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
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "clarification", payload: { auto: true, part, ...partial }, at: nowIso });
          if (!item.supportGiven.includes("clarification")) item.supportGiven.push("clarification");
        } else feedback = "represent";
      }
      if (correct === false && feedback === "represent") {
        noteTeaching(state, nowIso);
        // Part A: the quotient example (EQ-HARBOR-MODEL) before the last try; part B: the counters (the full boats and the leftover crates).
        if (part === "full-remaining" && hasMathItem(content, "EQ-HARBOR-MODEL")) {
          item.phase = "example";
          attempt.teachingMove = "model-example";
          attempt.teachingReason = "second-incorrect";
          if (!state.harborModelShownAt) {
            state.harborModelShownAt = nowIso;
            records.exposures.push({ taskId: "EQ-HARBOR-MODEL", taskVersion: mathItem(content, "EQ-HARBOR-MODEL").version, kind: "example_shown", source: "teaching", at: nowIso });
          }
          if (!item.supportGiven.includes("example")) item.supportGiven.push("example");
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "example", payload: { model: "EQ-HARBOR-MODEL", part }, at: nowIso });
        } else {
          item.phase = "represent";
          attempt.teachingMove = "representation";
          attempt.teachingReason = "second-incorrect";
          if (!item.supportGiven.includes("representation")) item.supportGiven.push("representation");
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "representation", payload: { counters: true, part }, at: nowIso });
        }
        feedback = item.phase;
      }
      item.attempts.push(attempt);
      records.attempts.push({
        id: env.newId(),
        visitId: state.currentVisit as VisitId,
        taskId: op.itemId,
        taskVersion: def.version,
        objective: part === "needed" ? "quotient-groups-needed" : "quotient-with-remainder",
        attemptNo: attempt.no,
        answer: { part, full: quotient.full, remaining: quotient.remaining, needed: quotient.needed, raw: attempt.raw },
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
        secondsSinceTeaching: null,
        at: nowIso,
      });
      if (item.outcome === "correct") {
        state.base.supplies[def.unit.plural] = (state.base.supplies[def.unit.plural] ?? 0) + def.quantity;
        state.feedback = updateMathFocus(feedbackOf(state), content, { id: op.itemId, item, at: nowIso, visit: state.currentVisit as VisitId });
        advance(state, content);
      }
      result = { feedback, correct, evidence: attempt.evidence, attemptNo: attempt.no, part, nextPart: item.part ?? null, ...partial };
      break;
    }

    case "reasoning-turn":
    case "reasoning-reply":
    case "reasoning-choice": {
      if (liveTutorDeferred(state.currentVisit)) throw new LearningOpError("not-available", "the live reasoning conversation is deferred for this visit (owner scope reduction)");
      requireStage(state, content, "explain");
      const visit = state.currentVisit as VisitId;
      const def = content.reasoning;
      if (!def) throw new LearningOpError("not-available", "this content has no reasoning conversation");
      const itemId = explainTarget(state, visit);
      if (!itemId) throw new LearningOpError("not-allowed", "no resolved item to explain");
      const item = mathItem(content, itemId);
      const itemState = mathState(state, itemId);
      const reasoning = state.reasoning ?? (state.reasoning = {});
      const current = reasoning[itemId] ?? newReasoningState(itemId, def, nowIso);
      const q = itemState.quotientResult ?? null;
      const childAnswer = q ? `${q.full} volle ${item.group.plural}, ${q.remaining} übrig${typeof q.needed === "number" ? `, ${q.needed} für alle` : ""} (${itemState.outcome === "correct" ? "richtig" : "mit Hilfe gelöst"})` : itemState.attempts.length ? `„${itemState.attempts[itemState.attempts.length - 1].raw}“` : "gelöst";
      const ctx: ReasoningDispatchContext = { item, def, childAnswer, page: "mission" };
      if (op.op === "reasoning-turn") {
        const text = exactText(op.text, MAX_TEXT_CHARS, "explanation");
        if (op.modality !== "typed" && op.modality !== "spoken") throw new LearningOpError("invalid", "modality must be typed or spoken");
        if (current.status === "scaffold") throw new LearningOpError("not-allowed", "choose first: counters, teaching or continue");
        if (current.status === "done") throw new LearningOpError("not-allowed", "the explanation is finished");
        if (current.status === "awaiting") throw new LearningOpError("not-allowed", "the assistant's reply is pending — send it or wait");
        if (turnsLeft(current, def) <= 0) throw new LearningOpError("not-allowed", "no turns left in this conversation");
        const turnId = env.newId();
        let dispatch;
        try {
          dispatch = applyReasoningTurn(current, text, op.modality, ctx, turnId, nowIso);
        } catch (error) {
          if (error instanceof Error && /too long/.test(error.message)) throw new LearningOpError("invalid", def.fallback.tooLong);
          throw error;
        }
        reasoning[itemId] = dispatch.state;
        const childTurn = dispatch.state.turns[dispatch.state.turns.length - 1];
        records.samples.push({ id: env.newId(), visitId: visit, taskId: itemId, kind: "reasoning_turn", language: "de", modality: op.modality, text, metrics: { turn: dispatch.state.childTurns, screen: childTurn.screen ?? null, turnId, reqHash: dispatch.reqHash, afterTeach: dispatch.state.afterTeach, supportMode: dispatch.state.supportMode, assessmentsStale: dispatch.state.assessments.some((a) => a.stale), spellingJudged: false }, at: nowIso });
        // Provenance: the dispatch is recorded BEFORE the browser sends it — the question exists even if the reply never arrives.
        records.supports.push({ id: env.newId(), visitId: visit, taskId: itemId, kind: "tutor_question", payload: { reasoning: true, turnId, reqHash: dispatch.reqHash, text: text.slice(0, 500), message: dispatch.message }, at: nowIso });
        result = { status: "awaiting", dispatch: { turnId: dispatch.turnId, message: dispatch.message, reqHash: dispatch.reqHash }, turnsLeft: turnsLeft(dispatch.state, def), done: false };
        break;
      }
      let step;
      if (op.op === "reasoning-reply") {
        if (typeof op.turnId !== "string" || !op.turnId) throw new LearningOpError("invalid", "turnId is required");
        if (current.status !== "awaiting" || !current.pending) throw new LearningOpError("not-allowed", "no reply is pending");
        if (current.pending.turnId !== op.turnId) throw new LearningOpError("not-allowed", "the reply belongs to another turn");
        const ok = op.ok === true;
        // The reply's EXACT wire text: never normalised or sliced before hashing (R2-02); an overlong reply is refused.
        const text = ok && typeof op.text === "string" ? op.text : "";
        if (text.length > MAX_REPLY_CHARS) throw new LearningOpError("invalid", `reply too long (${text.length} > ${MAX_REPLY_CHARS})`);
        // One discriminated origin from here to the report: verified / missing / malformed / invalid (assessment reset, trust).
        const origin: ReplyOrigin = ok && text.trim() ? receiptOrigin(op.receipt, { child: state.child, turnId: op.turnId, reqHash: current.pending.reqHash, text }) : originWithoutBinding(op.receipt);
        step = applyReasoningReply(current, { turnId: op.turnId, ok, text, origin, provenance: provenanceOf(op.receipt) }, ctx, nowIso);
        // The reply is recorded BEFORE anything is shown: the exact text with its origin (an untrusted text is kept in the evidence only, never in the transcript),
        // the support event if one was recorded, and the assessment revision it produced (Nabu's assessment, labelled as such).
        const latest = step.state.assessments[step.state.assessments.length - 1] ?? null;
        records.supports.push({ id: env.newId(), visitId: visit, taskId: itemId, kind: "tutor_reply", payload: { reasoning: true, turnId: op.turnId, ok, origin, receiptProblem: op.receipt && "invalid" in op.receipt ? op.receipt.invalid : null, text, shown: step.nabu.kind === "dialogue" || step.nabu.kind === "prompt-bank" ? step.nabu.text : null, shownKind: step.nabu.kind ?? null, source: step.nabu.source ?? null, malformed: step.malformed, supportRecorded: step.supportRecorded, supportMode: step.state.supportMode, assessment: latest && latest.turnId === op.turnId ? { revision: latest.revision, schemaVersion: latest.schemaVersion, kind: latest.kind, criteria: latest.criteria, ungrounded: latest.ungrounded, preRetractionGrounding: latest.preRetractionGrounding } : null, screen: step.state.screen, classification: origin !== "verified" ? `origin-${origin}` : !ok || !text.trim() ? "unavailable" : step.malformed ? "malformed" : step.nabu.kind === "prompt-bank" ? "clarification-prompt" : step.done && step.nabu.kind === "dialogue" ? "closing" : step.supportRecorded === "tutor-content" ? "tutor-content" : "neutral", supportPhase: step.state.supportEvents.at(-1)?.turnId === op.turnId ? step.state.supportEvents.at(-1)?.phase ?? null : null }, at: nowIso });
      } else {
        if (op.choice !== "counters" && op.choice !== "teach" && op.choice !== "continue") throw new LearningOpError("invalid", "choice must be counters, teach or continue");
        if (current.status !== "scaffold") throw new LearningOpError("not-allowed", "no scaffold is offered");
        try {
          step = applyReasoningChoice(current, op.choice, def, nowIso);
        } catch (error) {
          throw new LearningOpError("not-allowed", error instanceof Error ? error.message : "choice not available");
        }
        // Support in the conversation is recorded on the CONVERSATION (support mode + event log); the item's own answer record is an
        // observed fact that later help never rewrites (assessment reset, observed facts).
        if (op.choice === "counters") {
          records.supports.push({ id: env.newId(), visitId: visit, taskId: itemId, kind: "representation", payload: { counters: true, reasoning: true, supportMode: step.state.supportMode }, at: nowIso });
        } else if (op.choice === "teach") {
          records.supports.push({ id: env.newId(), visitId: visit, taskId: itemId, kind: "direct_teaching", payload: { reasoning: true, text: def.teach, recordsMethod: false, supportMode: step.state.supportMode }, at: nowIso });
        } else {
          records.supports.push({ id: env.newId(), visitId: visit, taskId: itemId, kind: "step_down", payload: { reasoning: true, method: step.state.method, closeReason: step.state.closeReason }, at: nowIso });
        }
      }
      reasoning[itemId] = step.state;
      if (step.done) {
        const text = childExplanationText(step.state) || "(keine eigene Erklärung)";
        const spoken = step.state.turns.some((t) => t.role === "child" && t.modality === "spoken");
        const typed = step.state.turns.some((t) => t.role === "child" && t.modality === "typed");
        state.explanations.push({ visit, text, modality: spoken && !typed ? "spoken" : "typed", taskId: itemId, at: nowIso });
        const fin = step.state.final;
        records.samples.push({ id: env.newId(), visitId: visit, taskId: itemId, kind: "explanation", language: "de", modality: spoken ? "spoken" : "typed", text, metrics: { method: step.state.method, assessment: fin ? { by: fin.by, revision: fin.revision, schemaVersion: fin.schemaVersion, stale: fin.stale, ungrounded: fin.ungrounded, preRetractionGrounding: fin.preRetractionGrounding, levels: { strategy: effectiveLevel(fin, "strategy"), quantities: effectiveLevel(fin, "quantities"), meaning: effectiveLevel(fin, "meaning") }, criteria: fin.criteria } : null, revisions: step.state.assessments.length, supportMode: step.state.supportMode, supportEvents: step.state.supportEvents, clarificationsUsed: step.state.clarificationsUsed, childTurns: step.state.childTurns, assistantTurns: step.state.assistantTurns, origins: step.state.origins, support: step.state.support, screen: step.state.screen, closeReason: step.state.closeReason, turns: step.state.turns.length, spellingJudged: false }, at: nowIso });
        advance(state, content);
      }
      result = { nabu: step.nabu.text, kind: step.nabu.kind, source: step.nabu.source ?? null, origin: step.nabu.origin ?? null, status: step.state.status, method: step.state.method, methodLabel: methodLabel(def, step.state.method), supportMode: step.state.supportMode, supportRecorded: step.supportRecorded, turnsLeft: turnsLeft(step.state, def), done: step.done, malformed: step.malformed, closeReason: step.state.closeReason, assessment: step.state.final ? reasoningAssessmentView(step.state, def) : null };
      break;
    }

    case "review-log": {
      requireStage(state, content, "log-review");
      const visit = state.currentVisit as VisitId;
      const logDef = logDefFor(content, visit);
      const reviewDef = content.writing?.review;
      if (!logDef || !reviewDef) throw new LearningOpError("not-available", "no writing review in this content");
      const page = [...state.pages].reverse().find((p) => p.visit === visit) ?? null;
      if (!page) throw new LearningOpError("not-allowed", "no log sentence to review in this visit");
      if (page.modality === "spoken") throw new LearningOpError("not-allowed", "a spoken page is not reviewed for spelling");
      const joins = content.writing?.spacing.joins ?? [];
      const review = reviewLogSentence(page.text, reviewDef, joins, semanticReviewFor(state, visit, page)?.semantic ?? null);
      const revised = exactText(op.text, MAX_TEXT_CHARS, "revision");
      const evaluation = evaluateLogRevision(review, revised, reviewDef, joins);
      const clarifications: Record<string, string> = {};
      if (op.clarifications && typeof op.clarifications === "object") {
        for (const [word, meaning] of Object.entries(op.clarifications)) {
          if ((review.clarify?.words.includes(word) || (word === "question" && review.clarify)) && typeof meaning === "string" && meaning.trim()) clarifications[word] = meaning.replace(/\s+/g, " ").trim().slice(0, 200);
        }
      }
      const helpShown = review.suggestion !== null;
      const verdict = revisionEvidence(review, evaluation, helpShown);
      const record: LogReviewRecord = { visit, logId: logDef.id, original: page.text, review, revised, evaluation, clarifications, outcome: evaluation.outcome, helpShown, evidence: verdict.evidence, correct: null, criteria: evaluation.criteria, modality: "typed", at: nowIso };
      (state.logReviews ??= []).push(record);
      const taught = review.taught.length;
      const correct = null;
      const evidence: EvidenceCategory = verdict.evidence;
      records.attempts.push({
        id: env.newId(), visitId: visit, taskId: logDef.id, taskVersion: logDef.version, objective: "writing-review-revision",
        attemptNo: (state.logReviews ?? []).filter((r) => r.visit === visit).length,
        answer: { taught: review.taught.map((f) => f.id), criteria: evaluation.criteria, resolved: evaluation.resolved, unresolved: evaluation.unresolved, unverified: evaluation.unverified, introduced: evaluation.introduced, unassessed: evaluation.unassessed, boundaries: evaluation.boundaries, copiedSuggestion: evaluation.copiedSuggestion, aspectsClean: review.clean, aspectsUnchecked: review.unchecked, uncheckedWords: review.uncheckedWords, semantic: review.semantic?.status ?? "none" },
        correct, evidence, support: record.helpShown ? ["suggestion-shown"] : [], exposureBefore: record.helpShown ? "suggestion-shown" : "none",
        stimulusLanguage: "de", responseLanguage: "de", modality: "typed",
        uncertainty: verdict.uncertainty,
        teachingMove: taught ? "writing-review" : null, teachingReason: taught ? review.taught.map((f) => f.aspect).join(",") : null, secondsSinceTeaching: null, at: nowIso,
      });
      records.samples.push({ id: env.newId(), visitId: visit, taskId: logDef.id, kind: "writing_review", language: "de", modality: "typed", text: revised, metrics: { original: page.text, findings: review.findings.map((f) => ({ id: f.id, source: f.source, certainty: f.certainty })), taught: review.taught.map((f) => f.id), clean: review.clean, unchecked: review.unchecked, uncheckedWords: review.uncheckedWords, clarify: review.clarify, semantic: review.semantic?.status ?? "none", suggestion: review.suggestion, outcome: evaluation.outcome, criteria: evaluation.criteria, resolved: evaluation.resolved, unresolved: evaluation.unresolved, unverified: evaluation.unverified, introduced: evaluation.introduced, unassessed: evaluation.unassessed, boundaries: evaluation.boundaries, copiedSuggestion: evaluation.copiedSuggestion, helpShown: record.helpShown }, at: nowIso });
      for (const [word, meaning] of Object.entries(clarifications)) records.samples.push({ id: env.newId(), visitId: visit, taskId: logDef.id, kind: "writing_clarification", language: "de", modality: "typed", text: meaning, metrics: { word, unscored: true }, at: nowIso });
      // The spacing focus follows the reviewed spacing finding of the ORIGINAL (typed): flagged opens it; a helped revision never retires it.
      const spacingFlags = flagSpacing(page.text, joins);
      state.feedback = updateSpacingFocus(feedbackOf(state), { outcome: spacingFlags.length ? "flagged" : assessSpacing(page.text, joins).assessable ? "clean" : "unassessable", modality: "typed", helpExposed: true, flagged: spacingFlags.length, text: page.text, at: nowIso, visit, lesson: `writing:${logDef.id}` });
      advance(state, content);
      result = { outcome: evaluation.outcome, evidence: verdict.evidence, criteria: evaluation.criteria, resolved: evaluation.resolved.length, unresolved: evaluation.unresolved.length, unverified: evaluation.unverified.length, unassessed: evaluation.unassessed, taught, introduced: evaluation.introduced.length, uncertainty: verdict.uncertainty };
      break;
    }

    case "review-log-dispatch":
    case "review-log-semantic": {
      if (liveTutorDeferred(state.currentVisit)) throw new LearningOpError("not-available", "the live semantic writing review is deferred for this visit (owner scope reduction)");
      requireStage(state, content, "log-review");
      const visit = state.currentVisit as VisitId;
      const logDef = logDefFor(content, visit);
      const reviewDef = content.writing?.review;
      if (!logDef || !reviewDef) throw new LearningOpError("not-available", "no writing review in this content");
      const page = [...state.pages].reverse().find((p) => p.visit === visit) ?? null;
      if (!page) throw new LearningOpError("not-allowed", "no log sentence to review in this visit");
      if (page.modality === "spoken") throw new LearningOpError("not-allowed", "a spoken page is not reviewed");
      if (typeof op.turnId !== "string" || op.turnId !== semanticTurnId(visit, page)) throw new LearningOpError("not-allowed", "the semantic review belongs to another sentence");
      const existing = semanticReviewFor(state, visit, page);
      const message = buildWritingReviewDispatch(reviewDef, logDef, page.text);
      const reqHash = sha256Hex(message);
      if (op.op === "review-log-dispatch") {
        // The durable question receipt BEFORE the browser sends anything (IV5-12); idempotent while pending.
        if (existing && existing.status !== "pending") throw new LearningOpError("not-allowed", "the semantic review is already recorded");
        if (!existing) {
          (state.logReviewSemantics ??= []).push({ visit, logId: logDef.id, turnId: op.turnId, status: "pending", semantic: null, reqHash, dispatchedAt: nowIso, at: nowIso });
          records.supports.push({ id: env.newId(), visitId: visit, taskId: logDef.id, kind: "tutor_question", payload: { writingReview: true, turnId: op.turnId, reqHash, message }, at: nowIso });
        }
        result = { status: "pending", turnId: op.turnId, reqHash, message };
        break;
      }
      if (!existing || existing.status !== "pending") throw new LearningOpError("not-allowed", existing ? "the semantic review is already recorded" : "the dispatch was not recorded first (review-log-dispatch)");
      const ok = op.ok === true;
      // The reply's EXACT wire text (R2-02): hashed as received; overlong replies are refused, never sliced.
      const text = ok && typeof op.text === "string" ? op.text : "";
      if (text.length > MAX_REPLY_CHARS) throw new LearningOpError("invalid", `reply too long (${text.length} > ${MAX_REPLY_CHARS})`);
      const origin: ReplyOrigin = ok && text.trim() ? receiptOrigin(op.receipt, { child: state.child, turnId: op.turnId, reqHash: existing.reqHash, text }) : originWithoutBinding(op.receipt);
      const semantic = !ok || !text.trim() ? unavailableSemanticReview() : origin === "invalid" || origin === "malformed" ? unavailableSemanticReview(`receipt ${origin}: ${(op.receipt as InvalidReceipt).invalid}`) : origin !== "verified" ? unverifiedSemanticReview(text) : parseWritingReviewReply(text, page.text);
      existing.status = semantic.status;
      existing.semantic = semantic;
      existing.origin = origin;
      existing.provenance = provenanceOf(op.receipt);
      existing.at = nowIso;
      records.supports.push({ id: env.newId(), visitId: visit, taskId: logDef.id, kind: "tutor_reply", payload: { writingReview: true, turnId: op.turnId, ok, origin, receiptProblem: op.receipt && "invalid" in op.receipt ? op.receipt.invalid : null, text, status: semantic.status, problem: semantic.problem, findings: { taskFulfilled: semantic.taskFulfilled, reason: semantic.reason, complete: semantic.complete, grammarChecked: semantic.grammarChecked, unclearWords: semantic.unclearWords, grammar: semantic.grammar, question: semantic.question }, classification: origin !== "verified" ? `origin-${origin}` : "semantic-review" }, at: nowIso });
      const review = reviewLogSentence(page.text, reviewDef, content.writing?.spacing.joins ?? [], semantic);
      result = { status: semantic.status, origin, taught: review.taught.map((f) => f.id), points: review.points.length, unchecked: review.unchecked, clarify: review.clarify };
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
      const replyEntry = op.kind === "tutor_reply" && op.payload && typeof op.payload === "object" && typeof (op.payload as { turnId?: unknown }).turnId === "string" ? (state.tutorDispatches ?? []).find((d) => d.turnId === (op.payload as { turnId: string }).turnId) ?? null : null;
      const target = op.taskId ?? replyEntry?.taskId ?? activeItem ?? (isLanguageSegmentId(stage) ? stage : null);
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
      let dispatch: { turnId: string; message: string; reqHash: string; replayed: boolean } | null = null;
      let tutorOrigin: ReplyOrigin | null = null;
      let tutorShown = false;
      let transportFailure = false;
      if ((op.kind === "tutor_question" || op.kind === "tutor_reply") && liveTutorDeferred(state.currentVisit)) {
        // Temporary Visit 5 scope reduction: no free question leaves the app for a deferred visit — nothing is dispatched or recorded.
        throw new LearningOpError("not-available", "the live tutor is deferred for this visit (owner scope reduction)");
      }
      if (op.kind === "tutor_question") {
        // The free question goes through the SAME trusted boundary as every other reply: the server builds the exact message
        // from its own view of the task and records an IMMUTABLE pending context (child, session, visit, task, turn, request hash)
        // before the send. A duplicate turn id with the same text/task/visit replays that context; anything else is a conflict.
        const turnId = typeof payloadRecord.turnId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(payloadRecord.turnId) ? payloadRecord.turnId : null;
        const childText = typeof payloadRecord.text === "string" ? payloadRecord.text.slice(0, 500) : "";
        if (turnId && childText.trim()) {
          const ledger = (state.tutorDispatches ??= []);
          const existing = ledger.find((d) => d.turnId === turnId) ?? null;
          const tutor = buildChildView(state, content, env.settings, env.now(), 0).tutor;
          const message = tutor ? buildTutorMessage(tutor, childText) : childText;
          const taskKey = target ?? stage ?? null;
          if (existing) {
            if (existing.childText !== childText || existing.taskId !== taskKey || existing.visitId !== visit.id) throw new LearningOpError("not-allowed", "this turn id was already used for a different question, task or visit");
            // stable replay of the SAME question: the recorded context stands; the message is rebuilt only if it still hashes the same
            dispatch = { turnId, message: sha256Hex(message) === existing.reqHash ? message : "", reqHash: existing.reqHash, replayed: true };
            if (!dispatch.message) throw new LearningOpError("not-allowed", "the context of this question changed since it was dispatched");
          } else {
            const reqHash = sha256Hex(message);
            dispatch = { turnId, message, reqHash, replayed: false };
            ledger.push({ turnId, taskId: taskKey, visitId: visit.id, child: state.child, sessionSuffix: "learn", childText, reqHash, at: nowIso, status: "pending" });
            while (ledger.length > 24) ledger.shift();
          }
          payload = { ...payloadRecord, text: childText, turnId, reqHash: dispatch.reqHash, message: dispatch.message, replayed: dispatch.replayed };
        }
      }
      if (op.kind === "tutor_reply") {
        // ONE consumed pending-dispatch transition (R5-01/02). Every reply, whatever the client's ok flag says, must satisfy ALL of:
        // a pending (not consumed, not failed) context for this turn; matching child/session/visit/task; usable reply text;
        // a receipt bound to that context's request hash and these reply bytes. Only then is it verified/shown/provenanced.
        // An unusable reply (ok:false / empty) records a TRANSPORT FAILURE only — never authenticated prose — and consumes the context.
        const turnId = typeof payloadRecord.turnId === "string" ? payloadRecord.turnId : null;
        const text = typeof payloadRecord.text === "string" ? payloadRecord.text : "";
        if (text.length > MAX_REPLY_CHARS) throw new LearningOpError("invalid", `reply too long (${text.length} > ${MAX_REPLY_CHARS})`);
        const entry = turnId ? (state.tutorDispatches ?? []).find((d) => d.turnId === turnId) ?? null : null;
        if (!entry) throw new LearningOpError("not-allowed", "no pending dispatch for this turn");
        if (entry.status !== "pending") throw new LearningOpError("not-allowed", "this dispatch was already consumed");
        if (entry.child !== state.child || entry.visitId !== visit.id || entry.sessionSuffix !== "learn") throw new LearningOpError("not-allowed", "the reply belongs to another child, session or visit");
        if (op.taskId !== null && op.taskId !== undefined && op.taskId !== entry.taskId) throw new LearningOpError("not-allowed", "the reply names a different task than its question");
        const usable = payloadRecord.ok === true && text.trim().length > 0;
        if (!usable) {
          transportFailure = true;
          tutorOrigin = originWithoutBinding(op.receipt);
          entry.status = "failed";
          entry.consumedAt = nowIso;
          entry.outcome = { origin: tutorOrigin, resHash: null, shown: false };
        } else {
          tutorOrigin = receiptOrigin(op.receipt, { child: entry.child, turnId: entry.turnId, reqHash: entry.reqHash, text });
          tutorShown = tutorOrigin === "verified";
          entry.status = tutorShown ? "consumed" : "failed";
          entry.consumedAt = nowIso;
          entry.outcome = { origin: tutorOrigin, resHash: sha256Hex(text), shown: tutorShown };
        }
      }
      if (targetItem) {
        const item = mathState(state, targetItem);
        if (ANSWER_RELEVANT_SUPPORT.includes(op.kind) && !item.supportGiven.includes(op.kind)) item.supportGiven.push(op.kind);
        if (op.kind === "tutor_reply") {
          const text = typeof payloadRecord.text === "string" ? payloadRecord.text : "";
          // Only a VERIFIED, bound, consumed reply is shown, so only that can reveal an answer; untrusted text is evidence only.
          const shown = tutorShown;
          const revealed = shown && tutorReplyRevealsAnswer(text, mathItem(content, targetItem));
          if (revealed && item.exposure !== "answer_revealed") {
            item.exposure = "answer_revealed";
            records.exposures.push({ taskId: targetItem, taskVersion: mathItem(content, targetItem).version, kind: "answer_revealed", source: "tutor_reply", at: nowIso });
          }
          payload = { ...payloadRecord, text, origin: tutorOrigin, shown, transportFailure, provenance: shown ? provenanceOf(op.receipt) : null, revealed, classification: transportFailure ? "transport-failure" : !shown ? `origin-${tutorOrigin}` : revealed ? "answer_revealed" : "supported" };
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
          payload = { ...payloadRecord, text: typeof payloadRecord.text === "string" ? payloadRecord.text : "", origin: tutorOrigin, shown: tutorShown, transportFailure, provenance: tutorShown ? provenanceOf(op.receipt) : null, classification: transportFailure ? "transport-failure" : !tutorShown ? `origin-${tutorOrigin}` : "supported" };
        }
      }
      if (op.kind === "tutor_reply" && !targetItem && !targetSegment) {
        payload = { ...payloadRecord, text: typeof payloadRecord.text === "string" ? payloadRecord.text : "", origin: tutorOrigin, shown: tutorShown, transportFailure, provenance: tutorShown ? provenanceOf(op.receipt) : null, classification: transportFailure ? "transport-failure" : !tutorShown ? `origin-${tutorOrigin}` : "supported" };
      }
      records.supports.push({ id: env.newId(), visitId: visit.id, taskId: target ?? stage, kind: op.kind, payload, at: nowIso });
      result = { recorded: op.kind, taskId: target ?? stage, ...(dispatch ? { dispatch: { turnId: dispatch.turnId, message: dispatch.message, reqHash: dispatch.reqHash }, replayed: dispatch.replayed } : {}), ...(tutorOrigin ? { origin: tutorOrigin, shown: tutorShown, transportFailure } : {}) };
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
        // The sharing example belongs to EQ-ENTRY; the remainder example (EQ-STATION-MODEL) serves every remainder item.
        const modelId: MathItemId | null = op.itemId === "EQ-ENTRY" ? "EQ-MODEL" : def.kind === "remainder" && hasMathItem(content, "EQ-STATION-MODEL") ? "EQ-STATION-MODEL" : null;
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
        // UX-5c: a confirmed wrong attempt on the way opens the practice focus; an independent first-try success retires an earlier one.
        state.feedback = updateMathFocus(feedbackOf(state), content, { id: op.itemId, item, at: nowIso, visit: state.currentVisit as VisitId });
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
      const partSubstantive = def.kind === "quotient" ? item.attempts.filter((a) => a.correct !== null && (a.part ?? "full-remaining") === (item.part ?? "full-remaining")).length : substantive;
      if (item.phase !== "teach-or-stop" && !(partSubstantive >= content.math.rules.maxSubstantiveAttempts && (item.phase === "represent" || item.phase === "example" || item.phase === "answer"))) {
        throw new LearningOpError("not-allowed", "direct teaching is offered only after two unsuccessful attempts");
      }
      noteTeaching(state, nowIso);
      item.exposure = "answer_revealed";
      item.outcome = "taught";
      item.phase = "done";
      item.allocation = def.answer;
      if (def.kind === "remainder" && def.answers) item.remainderResult = { used: def.answers.used, remaining: def.answers.remaining };
      if (def.kind === "quotient" && def.answers) item.quotientResult = { full: def.answers.full ?? def.answer, remaining: def.answers.remaining, needed: def.answers.needed ?? null };
      item.resolvedAt = nowIso;
      records.exposures.push({ taskId: op.itemId, taskVersion: def.version, kind: "answer_revealed", source: "direct_teaching", at: nowIso });
      records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "direct_teaching", payload: def.kind === "remainder" || def.kind === "quotient" ? { answers: def.answers } : { answer: def.answer }, at: nowIso });
      const gained = def.kind === "remainder" && def.answers ? def.answers.used : def.quantity;
      state.base.supplies[def.unit.plural] = (state.base.supplies[def.unit.plural] ?? 0) + gained;
      state.feedback = updateMathFocus(feedbackOf(state), content, { id: op.itemId, item, at: nowIso, visit: state.currentVisit as VisitId });
      advance(state, content);
      result = def.kind === "remainder" || def.kind === "quotient" ? { taught: true, answers: def.answers } : { taught: true, answer: def.answer };
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
      state.feedback = updateMathFocus(feedbackOf(state), content, { id: op.itemId, item, at: nowIso, visit: state.currentVisit as VisitId });
      advance(state, content);
      result = { stopped: true };
      break;
    }

    case "explain": {
      requireStage(state, content, "explain");
      const text = boundedText(op.text, MAX_TEXT_CHARS, "explanation");
      const visit = state.currentVisit as VisitId;
      if (content.reasoning && visit === "v6") throw new LearningOpError("not-allowed", "this chapter explains in the conversation (reasoning-turn)");
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
        const inVisitRecords = seg.records.filter((r) => r.visit === state.currentVisit);
        state.feedback = updateLanguageFocus(feedbackOf(state), content, { id: op.segmentId, records: inVisitRecords, at: nowIso, visit: state.currentVisit as VisitId });
        state.feedback = openLanguageRepair(feedbackOf(state), content, { id: op.segmentId, records: inVisitRecords, at: nowIso, visit: state.currentVisit as VisitId });
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
        const inVisitRecords = seg.records.filter((r) => r.visit === state.currentVisit);
        state.feedback = updateLanguageFocus(feedbackOf(state), content, { id: op.segmentId, records: inVisitRecords, at: nowIso, visit: state.currentVisit as VisitId });
        state.feedback = openLanguageRepair(feedbackOf(state), content, { id: op.segmentId, records: inVisitRecords, at: nowIso, visit: state.currentVisit as VisitId });
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
      const errors = typingErrors(lesson.lines, op.lines);
      const rec: TypingLessonRecord = { lessonId: lesson.id, layout: lesson.layout, ...lessonMetrics(lesson.lines, op.lines), errors, seconds: Math.max(0, Math.round(op.seconds)), at: nowIso };
      state.typing.lessons.push(rec);
      records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: lesson.id, kind: "typing_practice", language: null, modality: "typed", text: lesson.lines.join(" / "), metrics: rec, at: nowIso });
      // UX-5a/5b/5c: the per-key mismatches open the practice focus and, when a pattern warrants it, the bounded repair for this round.
      state.feedback = updateTypingFocus(feedbackOf(state), { lessonId: lesson.id, lines: lesson.lines, errors, at: nowIso, visit: state.currentVisit as VisitId, fingers: lesson.fingers });
      state.feedback = openTypingRepair(state.feedback, content, { lessonId: lesson.id, at: nowIso, visit: state.currentVisit as VisitId, lines: lesson.lines, errors });
      result = { accuracy: accuracyRatio(rec), errors: errors.length };
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
      const rec: TypingLabelRecord = { taskId: task.id, target, typed, ...metrics, errors: typingErrors([target], [typed]), seconds: Math.max(0, Math.round(op.seconds)), at: nowIso };
      state.typing.labels.push(rec);
      records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: task.id, kind: "typed_label", language: "de", modality: "typed", text: typed, metrics: rec, at: nowIso });
      // F2: a label written wrong at its single step gets a bounded repair (the target shown, up to two attempts).
      state.feedback = openLabelRepair(feedbackOf(state), { taskId: task.id, target, errors: rec.errors ?? [], at: nowIso, visit: state.currentVisit as VisitId });
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
      const roundLines = lesson.lines.slice(0, op.lines.length);
      const metrics = alignedLessonMetrics(roundLines, op.lines);
      const errors = typingErrors(roundLines, op.lines);
      const burst: TypingBurst = { lessonId: lesson.id, visit: state.currentVisit as VisitId, lineCount: op.lines.length, ...metrics, comfort: op.comfort, errors, seconds: Math.max(0, Math.round(op.seconds)), at: nowIso };
      const courseState = state.typing.course!;
      courseState.bursts.push(burst);
      // UX-5a/5b/5c: a FULL round opens or retires per-key practice focus (a later error-free round is the independent check);
      // a round with a warranted pattern gets its bounded repair record. Retries (typing-retry) never touch the focus or the progression.
      state.feedback = updateTypingFocus(feedbackOf(state), { lessonId: lesson.id, lines: roundLines, errors, at: nowIso, visit: state.currentVisit as VisitId, fingers: course.fingers });
      state.feedback = openTypingRepair(state.feedback, content, { lessonId: lesson.id, at: nowIso, visit: state.currentVisit as VisitId, lines: roundLines, errors });
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
      const optional: StageId[] = ["LANG-EN-WATER", "LANG-ES-AGUA", "LANG-ES-STATION", "LANG-EN-PIER", "LANG-ES-HARBOR", "LANG-ES-HARBOR-CHECK", "typing", "typing-course", "explain", "log-revise", "log-transfer", "log-review"];
      if (!optional.includes(op.stage)) throw new LearningOpError("not-allowed", "only optional segments can be skipped");
      if (op.reason === "deferred" && !(op.stage === "explain" && liveTutorDeferred(visit.id))) throw new LearningOpError("not-allowed", "the deferred reason is the owner's rule for the explain stage of a deferred visit only");
      visit.skippedStages.push({ stage: op.stage, reason: op.reason });
      if (op.stage === "typing" || op.stage === "typing-course") state.typing.skipped.push({ visit: visit.id, reason: op.reason as "time" | "child" });
      if (isLanguageSegmentId(op.stage)) languageState(state, op.stage).skipped = op.reason as "time" | "child";
      if (op.stage === "log-revise") {
        const page = [...state.pages].reverse().find((p) => p.visit === visit.id) ?? null;
        if (page) {
          const flags = flagSpacing(page.text, content.writing?.spacing.joins ?? []);
          state.logRevisions.push({ visit: visit.id, original: page.text, revised: null, flagged: flags, resolved: 0, outcome: "skipped", modality: "typed", helpShown: flags.length > 0, at: nowIso });
        }
      }
      if (op.stage === "explain" && content.reasoning && state.reasoning?.[explainTarget(state, visit.id) ?? "EQ-HARBOR"]) {
        // A skipped conversation stays recorded as it was; the method is honestly open.
        const target = explainTarget(state, visit.id);
        const open = target ? state.reasoning?.[target] : null;
        // D1: an owner-deferred transition closes the captured conversation as it was (turns, assessments, origins kept; no new credit) with its own reason
        if (open && open.status !== "done") state.reasoning![target!] = closeReasoningUnresolved(open, nowIso, op.reason === "deferred" ? "owner-deferred" : "stage-skipped");
      }
      if (op.stage === "log-review") {
        const logDef = logDefFor(content, visit.id);
        const page = [...state.pages].reverse().find((p) => p.visit === visit.id) ?? null;
        if (logDef && page && content.writing?.review) {
          const review = reviewLogSentence(page.text, content.writing.review, content.writing.spacing.joins, semanticReviewFor(state, visit.id, page)?.semantic ?? null);
          (state.logReviews ??= []).push({ visit: visit.id, logId: logDef.id, original: page.text, review, revised: null, evaluation: null, clarifications: {}, outcome: "skipped", helpShown: review.suggestion !== null, modality: "typed", at: nowIso });
        }
      }
      const skippedTransfer = op.stage === "log-transfer" ? transferDefFor(content, visit.id) : null;
      if (skippedTransfer) {
        const t = skippedTransfer;
        const revision = [...state.logRevisions].reverse().find((r) => r.visit === visit.id) ?? null;
        (state.transfers ??= []).push({ id: t.id, version: t.version, visit: visit.id, text: null, modality: "typed", flagged: [], assessed: 0, outcome: "skipped", helpExposed: !!revision?.helpShown, linkedRevisionAt: revision?.at ?? null, at: nowIso });
      }
      advance(state, content);
      break;
    }

    case "save-log": {
      requireStage(state, content, "log");
      if (!state.base.name) throw new LearningOpError("not-allowed", "name the base first");
      const text = exactText(op.text, MAX_TEXT_CHARS, "log");
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
      const visit = state.currentVisit as VisitId;
      const t = transferDefFor(content, visit);
      if (!t) throw new LearningOpError("not-available", "no transfer check in this content");
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
      state.feedback = updateSpacingFocus(feedbackOf(state), { outcome: record.outcome, modality, helpExposed: record.helpExposed, flagged: flags.length, text, at: nowIso, visit, lesson: `writing:${t.id}` });
      // F2: a typed, flagged transfer at the loop's final step gets its own bounded repair of the child's sentence.
      state.feedback = openWritingRepair(feedbackOf(state), { transferId: t.id, visit, at: nowIso, modality, outcome: record.outcome, flagged: flags.length });
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
      // Content v7: the button answers recorded before the spoken look back (closing-feedback) stand unless the closing sends new ones.
      const keepEarlier = op.feedback === undefined && op.optionId === undefined && !op.difficultySkipped && !!visit.feedback;
      if (!keepEarlier) visit.reflection = op.optionId ?? null;
      const dims = content.reflection.dimensions ?? [];
      if (!keepEarlier && (dims.length || difficultyOptional)) {
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
      // Content v5 (V6-11): every normal closing asks what the child wants next; the answer (own words, "weiss nicht", "egal" or
      // "lieber nicht sagen") is stored verbatim in the child's evidence. Nothing is inferred when no answer is given.
      // Content v7: the spoken look back may already have recorded his own next-interest words (verbatim, server-side).
      const debriefed = (state.interests ?? []).some((i) => i.visit === visit.id && i.at >= visit.startedAt && i.source === "debrief");
      if (content.reflection.nextInterest && (op.interest || !debriefed)) {
        if (!op.interest) throw new LearningOpError("invalid", "the closing asks what comes next — answer it or choose one of its buttons");
        try {
          recordInterest(state, records, op.interest, visit.id, "closing", nowIso, env.newId, missionDefFor(content, visit.id)?.nextAdventure ?? null);
        } catch (error) {
          if (error instanceof MissionOpError) throw new LearningOpError(error.code, error.message);
          throw error;
        }
      }
      visit.finishedAt = nowIso;
      visit.stageIndex += 1;
      state.currentVisit = null;
      finishedVisit = visit.id;
      result = { finished: visit.id };
      break;
    }

    case "nokt-talk": {
      try {
        const out = applyNoktTalk(state, op.action, { content, nowIso, newId: env.newId, child: state.child, available: env.tutorAvailable === true, ...(env.tutorReceipt !== undefined ? { receipt: env.tutorReceipt } : {}) });
        records.attempts.push(...out.records.attempts);
        records.exposures.push(...out.records.exposures);
        records.supports.push(...out.records.supports);
        records.samples.push(...out.records.samples);
        result = out.result;
      } catch (error) {
        if (error instanceof MissionOpError) throw new LearningOpError(error.code, error.message);
        throw error;
      }
      break;
    }

    case "closing-feedback": {
      requireStage(state, content, "reflect");
      const visit = currentVisit(state);
      const closingPresentation = missionDefFor(content, visit.id)?.presentation;
      if (closingPresentation !== "map" && closingPresentation !== "workshop") throw new LearningOpError("not-available", "this visit closes with the reflection form");
      const dims = [{ id: "difficulty", options: content.reflection.options }, ...(content.reflection.dimensions ?? [])];
      const answers: Record<string, string> = {};
      const skipped: string[] = [];
      const unanswered: string[] = [];
      for (const dim of dims) {
        const given = op.feedback?.[dim.id as "enjoyment" | "clarity" | "difficulty"];
        if (given === null || given === "") skipped.push(dim.id);
        else if (given === undefined) unanswered.push(dim.id);
        else if (dim.options.some((o) => o.id === given)) answers[dim.id] = given;
        else throw new LearningOpError("invalid", `unknown ${dim.id} option`);
      }
      // Three states per dimension (R3-3), exactly like the reflection; the latest answer counts until the visit closes.
      visit.reflection = answers.difficulty ?? null;
      visit.feedback = { answers, skipped, unanswered, offered: dims.map((d) => d.id) };
      result = { feedback: visit.feedback };
      break;
    }

    case "mission": {
      requireStage(state, content, "mission");
      const visit = currentVisit(state);
      try {
        const out = applyMissionAction(state, op.action, { content, settings: env.settings, nowIso, newId: env.newId, visit: visit.id, tutor: { available: env.tutorAvailable === true, child: state.child, origin: env.tutorOrigin ?? "missing", ...(env.tutorReceipt !== undefined ? { receipt: env.tutorReceipt } : {}) }, noktEnabled: env.noktEnabled === true });
        records.attempts.push(...out.records.attempts);
        records.exposures.push(...out.records.exposures);
        records.supports.push(...out.records.supports);
        records.samples.push(...out.records.samples);
        result = out.result;
        if (out.finished) advance(state, content);
      } catch (error) {
        if (error instanceof MissionOpError) throw new LearningOpError(error.code, error.message);
        throw error;
      }
      break;
    }

    case "record-interest": {
      const pending = pendingInterest(state, content);
      if (!pending) throw new LearningOpError("not-allowed", "no next-visit question is waiting");
      try {
        const rec = recordInterest(state, records, { kind: op.kind, text: op.text ?? null, choice: op.choice ?? null }, pending, "entry", nowIso, env.newId, missionDefFor(content, pending)?.nextAdventure ?? null);
        result = { interest: rec.id };
      } catch (error) {
        if (error instanceof MissionOpError) throw new LearningOpError(error.code, error.message);
        throw error;
      }
      break;
    }

    case "repair-explain": {
      // UX-5b: the worked example is help; it is recorded before the client shows it. Idempotent.
      const visit = currentVisit(state);
      const repair = findRepair(feedbackOf(state), op.repairId);
      if (!repair || repair.visit !== visit.id) throw new LearningOpError("invalid", "unknown repair for this visit");
      if (repair.outcome !== "open") throw new LearningOpError("not-allowed", "the repair is closed");
      const already = repair.explainedAt !== null;
      state.feedback = markRepairExplained(feedbackOf(state), op.repairId, nowIso);
      if (!already) records.supports.push({ id: env.newId(), visitId: visit.id, taskId: repairTaskId(repair.lesson), kind: "mini_lesson", payload: { repairId: op.repairId, focus: repair.focus, kind: repair.kind }, at: nowIso });
      result = { explained: true, repeated: already };
      break;
    }

    case "typing-retry":
    case "writing-retry":
    case "language-retry": {
      // UX-5b: one targeted retry of the SAME reviewed item, bounded by the repair; recorded apart from rounds, labels, transfers and
      // language records (never progression or ledger evidence, never retires a focus). The original attempt stays untouched.
      // Exhausting the items closes the repair in this same write (F3): no separate close is needed after the last retry.
      const visit = currentVisit(state);
      const fb = feedbackOf(state);
      const repair = findRepair(fb, op.repairId);
      if (!repair || repair.visit !== visit.id) throw new LearningOpError("invalid", "unknown repair for this visit");
      if (repair.outcome !== "open") throw new LearningOpError("not-allowed", "the repair is closed");
      if (repair.explainedAt === null) throw new LearningOpError("not-allowed", "the worked example comes before the retry");
      if (!Number.isInteger(op.retryNo) || op.retryNo !== repair.retries.length + 1) throw new LearningOpError("stale", `the next retry is ${repair.retries.length + 1}`);
      const offered = repairItems(state, content, repair);
      const maxAttempts = effectiveMaxRetries(repair, offered);
      if (repair.retries.length >= maxAttempts) throw new LearningOpError("not-allowed", "the retries are used up");
      const item = nextRetryItem(state, content, repair);
      if (!item) throw new LearningOpError("not-allowed", "no retry item is left");
      const expectedOp = repair.kind === "typing" || repair.kind === "label" ? "typing-retry" : repair.kind === "writing" ? "writing-retry" : "language-retry";
      if (op.op !== expectedOp) throw new LearningOpError("invalid", `this repair takes ${expectedOp}`);
      let retry: RepairRetry;
      if (op.op === "typing-retry") {
        if (item.kind === "typing-line" ? item.lineIndex !== op.lineIndex : item.kind !== "label") throw new LearningOpError("invalid", "the retry line does not match the repair");
        if (typeof op.typed !== "string" || Array.from(op.typed).length > 120) throw new LearningOpError("invalid", "typed text too long");
        const errors = typingErrors([item.text], [op.typed]);
        const focusKey = repair.kind === "typing" ? repair.focus.slice("typing-key:".length) : null;
        const focusErrors = focusKey ? errors.filter((e) => e.kind !== "extra" && e.expected === focusKey).length : errors.length;
        retry = { no: op.retryNo, item: item.item, purpose: item.purpose, at: nowIso, result: focusErrors === 0 ? "correct" : "incorrect", focusErrors, lineErrors: errors.length, seconds: Math.max(0, Math.round(op.seconds)), ...(repair.kind === "label" ? { text: op.typed } : {}) };
        const { ops: _ops, ...metrics } = alignTyping(item.text, op.typed);
        records.samples.push({ id: env.newId(), visitId: visit.id, taskId: repairTaskId(repair.lesson), kind: "typing_retry", language: null, modality: "typed", text: item.text, metrics: { ...metrics, errors, focus: repair.focus, purpose: item.purpose, retryNo: op.retryNo, repairId: op.repairId, typed: repair.kind === "label" ? op.typed : undefined }, at: nowIso });
      } else if (op.op === "writing-retry") {
        if (item.kind !== "sentence") throw new LearningOpError("invalid", "the retry does not match the repair");
        const text = boundedText(op.text, MAX_TEXT_CHARS, "sentence");
        const e = evaluateSentenceRetry(item.text, text, content.writing?.spacing.joins ?? []);
        retry = { no: op.retryNo, item: item.item, purpose: item.purpose, at: nowIso, result: e.remaining === 0 ? "correct" : "incorrect", focusErrors: e.remaining, lineErrors: e.remaining, seconds: 0, text };
        records.samples.push({ id: env.newId(), visitId: visit.id, taskId: repairTaskId(repair.lesson), kind: "writing_retry", language: "de", modality: "typed", text, metrics: { original: item.text, resolved: e.resolved, total: e.total, purpose: item.purpose, retryNo: op.retryNo, repairId: op.repairId, spellingJudged: false }, at: nowIso });
      } else {
        if (item.kind !== "pick" && item.kind !== "produce") throw new LearningOpError("invalid", "the retry does not match the repair");
        if (item.stepId !== op.stepId) throw new LearningOpError("invalid", "the retry step does not match the repair");
        const segmentId = repair.lesson.slice("language:".length);
        if (!isLanguageSegmentId(segmentId)) throw new LearningOpError("invalid", "unknown segment");
        const segment = languageSegment(content, segmentId);
        const { step } = findStep(segment, op.stepId);
        let result_: RepairRetry["result"];
        let response: string;
        if (step.kind === "pick-supply") {
          response = boundedText(op.response, 40, "choice");
          if (!step.options.includes(response)) throw new LearningOpError("invalid", "choice is not one of the options");
          result_ = response === step.answer ? "correct" : "incorrect";
        } else if (step.kind === "produce") {
          response = boundedText(op.response, 200, "response");
          const scored = scoreProduction(step, response);
          result_ = scored.correct === null ? "unscored" : scored.correct ? "correct" : "incorrect";
        } else throw new LearningOpError("invalid", "this step has no retry");
        retry = { no: op.retryNo, item: item.item, purpose: item.purpose, at: nowIso, result: result_, focusErrors: result_ === "incorrect" ? 1 : 0, lineErrors: result_ === "incorrect" ? 1 : 0, seconds: 0, text: response };
        records.samples.push({ id: env.newId(), visitId: visit.id, taskId: `${segmentId}/${op.stepId}`, kind: "language_retry", language: segment.language, modality: "typed", text: response, metrics: { result: result_, purpose: item.purpose, retryNo: op.retryNo, repairId: op.repairId, support: ["retry", "feedback"] }, at: nowIso });
      }
      state.feedback = recordRepairRetry(fb, op.repairId, retry);
      let after = findRepair(feedbackOf(state), op.repairId)!;
      // Done when the items are used up, or when the attempt succeeded and only repeat attempts of the same item would remain
      // (a fresh check of another line still follows a correct typing retry).
      const remainingItems = (nextRetryItem(state, content, after) ? repairItemsLeft(state, content, after) : []);
      // Early close only when the remaining items are repeat attempts of the item just corrected — another unresolved item (a second
      // language word) or a fresh check stays reachable (repair round 2, R2-1).
      const exhausted = after.retries.length >= maxAttempts || remainingItems.length === 0 || (retry.result === "correct" && remainingItems.every((i) => i.purpose === "correct-original" && i.item === retry.item));
      if (exhausted) {
        state.feedback = closeRepair(feedbackOf(state), op.repairId, nowIso, "done", offered.map((i) => i.item));
        after = findRepair(feedbackOf(state), op.repairId)!;
        records.supports.push({ id: env.newId(), visitId: visit.id, taskId: repairTaskId(repair.lesson), kind: "step_down", payload: { repairId: op.repairId, outcome: after.outcome, retries: after.retries.length, reason: "exhausted" }, at: nowIso });
      }
      result = { retryNo: op.retryNo, result: retry.result, focusErrors: retry.focusErrors, lineErrors: retry.lineErrors, remaining: exhausted ? 0 : Math.max(0, maxAttempts - after.retries.length), closed: exhausted, outcome: exhausted ? after.outcome : null };
      break;
    }

    case "repair-close": {
      const visit = currentVisit(state);
      const repair = findRepair(feedbackOf(state), op.repairId);
      if (!repair || repair.visit !== visit.id) throw new LearningOpError("invalid", "unknown repair for this visit");
      if (op.reason !== "done" && op.reason !== "skip") throw new LearningOpError("invalid", "reason must be done or skip");
      if (repair.outcome !== "open") {
        result = { outcome: repair.outcome, repeated: true };
        break;
      }
      state.feedback = closeRepair(feedbackOf(state), op.repairId, nowIso, op.reason, repairItems(state, content, repair).map((i) => i.item));
      const closed = findRepair(feedbackOf(state), op.repairId)!;
      records.supports.push({ id: env.newId(), visitId: visit.id, taskId: repairTaskId(repair.lesson), kind: "step_down", payload: { repairId: op.repairId, outcome: closed.outcome, retries: closed.retries.length, reason: op.reason }, at: nowIso });
      result = { outcome: closed.outcome };
      break;
    }

    case "lesson-feedback-seen": {
      currentVisit(state);
      if (typeof op.id !== "string" || op.id.length === 0 || op.id.length > 120) throw new LearningOpError("invalid", "feedback id");
      // Only feedback of a lesson that actually ended may be acknowledged; an open repair is closed as skipped first.
      const pending = lastLessonFeedback(state, content);
      if (!pending || pending.id !== op.id) {
        const all = feedbackOf(state).acknowledged.includes(op.id);
        if (all) {
          result = { acknowledged: op.id, repeated: true };
          break;
        }
        throw new LearningOpError("not-allowed", "this lesson feedback is not pending");
      }
      if (pending.repair.repairId && (pending.repair.status === "open" || pending.repair.status === "available")) {
        // Repair round 4 (R3-F1): acknowledging an open repair closes it with the SAME complete required-item inventory as the
        // explicit close and the exhausted close — a record persisted by an earlier round with a shorter inventory (two items, or
        // none) must not be stored as "corrected" while a currently unresolved step was never attempted.
        const open = findRepair(feedbackOf(state), pending.repair.repairId);
        const required = open ? repairItems(state, content, open).map((i) => i.item) : [];
        state.feedback = closeRepair(feedbackOf(state), pending.repair.repairId, nowIso, "skip", required);
      }
      state.feedback = acknowledgeLesson(feedbackOf(state), op.id);
      result = { acknowledged: op.id };
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
  kind: "sharing" | "remainder" | "quotient";
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
  /** Remainder items: the verb of the used part ("gepflanzt" / "verbaut") and its field label. */
  usedWord: { past: string; label: string };
  /** Quotient items (content v4): the part asked now, its labels, the decision prompt (part B) and the accepted part-A result. */
  part: "full-remaining" | "needed" | null;
  quotientWords: { fullLabel: string; remainingLabel: string; neededLabel: string } | null;
  decisionPrompt: string | null;
  partA: { full: number; remaining: number } | null;
  taughtQuotient: { full: number; remaining: number; needed: number } | null;
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
  /** Content v4 (Nabu sidebar, F4): the validated page/task binding of the turn — content-free of adult or sibling data. */
  page?: "map" | "mission";
  stage?: StageId | null;
  /** The child's current work on the task (last answer / typed text), bounded. */
  childWork?: string | null;
  /** One line of saved island state in words. */
  islandState?: string;
  /** The reviewed objective of the current task. */
  objective?: string | null;
  /** Prior attempts and recorded help on this task, in words (never the key). */
  priorAttempts?: string[];
  /** The open practice focus relevant here, if any. */
  focus?: string | null;
};

export type HarborWorkplaceView = {
  id: HarborWorkplaceId;
  label: string;
  building: string;
  status: WorkplaceStatus;
  character: { id: string; name: string; role: string; language: TargetLanguage; lines: { id: string; text: string; de: string | null }[] } | null;
  stages: StageId[];
};

export type HarborView = {
  destinations: { id: string; label: string; emoji: string }[];
  destination: string | null;
  planned: boolean;
  roped: boolean;
  ropesAvailable: boolean;
  /** Saved arithmetic of the harbor item once it is resolved: crates per boat, full boats, leftovers, boats needed. */
  load: { crates: number; perBoat: number; fullBoats: number; remaining: number; boatsNeeded: number | null } | null;
  workplaces: HarborWorkplaceView[];
  /** Every reviewed character (the supplier Rosa keeps the shop, not a workplace). */
  characters: NonNullable<HarborWorkplaceView["character"]>[];
  /** Workplaces the child entered so far (route order). */
  entered: HarborWorkplaceId[];
};

/** Nabu's assessment as shown: per criterion the effective level with its label, the passages and the rationale; always labelled as Nabu's. */
export type ReasoningAssessmentView = { by: "nabu-child-assistant"; revision: number; revisions: number; stale: boolean; ungrounded: boolean; preRetractionGrounding: boolean; criteria: { id: string; label: string; level: AssessmentLevel; levelLabel: string; passages: string[]; rationale: string }[] };

export type ReasoningView = {
  itemId: ScoredMathItemId;
  status: ReasoningState["status"];
  /** `source`: `assistant` = verified Nabu line (may be spoken); `reviewed` = reviewed app text; `local` = local guidance shown instead of untrusted content. `origin` on reply lines. */
  turns: { role: "nabu" | "child"; text: string; kind: string | null; source: "assistant" | "reviewed" | "local" | null; origin: ReplyOrigin | null; modality: "typed" | "spoken" | null; at: string }[];
  supportMode: "unsupported" | "supported";
  clarificationsLeft: number;
  /** Nabu's assessment at close (or the latest revision while open), labelled; null when none exists. */
  assessment: ReasoningAssessmentView | null;
  /** Child turns still possible in this bounded conversation. */
  turnsLeft: number;
  /** A child turn whose assistant reply is still pending: the browser sends `message` through the bridge with `turnId` as the idempotency key and posts `reasoning-reply` with the reply and its receipt. */
  pending: { turnId: string; message: string } | null;
  method: ReasoningState["method"];
  methodLabel: string;
  /** The scaffold's choices, when offered. */
  choices: { counters: boolean; teach: boolean; continue: boolean } | null;
  /** D1 (temporary scope reduction): the explain stage is already active on a deferred visit (saved before the deferral, or a legacy pending dispatch) — no live invitation, no pending send; the one way on is `skip-stage` with reason `deferred`. */
  deferred: boolean;
  /** The resolved item for the counters (quantity, perGroup, groups, labels). */
  item: { quantity: number; perGroup: number; groups: number; unit: MathItem["unit"]; group: MathItem["group"]; prompt: string };
};

export type LogReviewView = {
  logId: string;
  original: string;
  summary: string;
  taught: { id: string; aspect: string; aspectLabel: string; given: string; expected: string | null; teaching: string; source: "rule" | "assistant"; certainty: "certain" | "uncertain" }[];
  /** The at most two TEACHING POINTS shown (one per aspect, occurrences grouped). */
  points: TeachingPoint[];
  clean: string[];
  cleanLabels: string[];
  /** Aspects not checked (no semantic reply). */
  unchecked: string[];
  uncheckedLabels: string[];
  /** Words outside the lexicon — unchecked, never a finding. */
  uncheckedWords: string[];
  /** The one question to the child, if any. */
  clarify: { words: string[]; question: string } | null;
  /** The semantic review the browser still has to fetch: record the dispatch (`review-log-dispatch`), send `message` through the bridge with `turnId` as the idempotency key, then post `review-log-semantic` with the reply and its receipt. `recorded` = the dispatch event exists. */
  pending: { turnId: string; message: string; recorded: boolean } | null;
  semanticStatus: "pending" | "done" | "unavailable" | "unverified";
  /** Temporary Visit 5 scope reduction: the semantic hop is deferred — meaning, completeness and grammar are reported as not assessed, nothing is dispatched. */
  semanticDeferred: boolean;
  /** Four-way origin of the applied semantic reply (R4-08); null while pending. */
  semanticOrigin: ReplyOrigin | null;
  suggestion: string | null;
  marked: string | null;
  /** The recorded review/revision of this visit, once made. */
  record: { outcome: LogReviewRecord["outcome"]; revised: string | null; resolved: number; unresolved: number } | null;
};

/** Content v7: what the look back shows before Nokt speaks — the visible result (his own plan), one evidenced success, one next step, his button answers so far. */
export type ClosingView = { success: string | null; next: string; artifact: string | null; plan: import("./family-learning-mission-spec.ts").MissionGrid | null; feedback: Record<string, string | null>; made?: { id: string; label: string; picture: string | null; room: string } | null; recap?: string | null; /** Isabel Visit 2+ (narrated): the spoken goodbye after the closing questions (the outcome's reviewed done lines + the visit's saved line). */ farewell?: string[] | null; narrated?: boolean };

/** Isabel Visit 2+: the running (else the next) visit's own reviewed wording and its mission's story character; null for Visit 1. */
export type VisitText = { visit: string; title: string; hub: string; mission: string; done: string; start: string; character: string | null; narrated: boolean; /** The story character's voice slot (six-slot registry), or null. */ voice: import("./family-voice-registry.ts").VoiceSlot | null };

function visitTextFor(state: MissionState, content: LearningContent, nextVisit: string | null): VisitText | null {
  const id = state.visits.find((v) => v.finishedAt === null)?.id ?? nextVisit;
  const def = content.visits.find((v) => v.id === id);
  if (!def?.childText) return null;
  const mission = (content.missions ?? []).find((m) => m.visit === def.id) ?? null;
  return { visit: def.id, title: mission?.title ?? def.title, ...def.childText, character: mission?.characters[0]?.name ?? null, narrated: mission?.narration?.mode === "auto", voice: mission?.characters[0]?.voice ?? null };
}

export type ChildView = {
  /** Isabel Visit 2+: see `VisitText` (absent for Santiago). */
  visitText?: VisitText | null;
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
  /** Visit 5 (F3): the simple wordbook — words met, per language, with picture/meaning/example; exposure, never a score. `null` when no inventory is served. */
  wordbook: ChildWordbook | null;
  nextStep: string;
  locations: { id: string; label: string; emoji: string }[];
  station: { themes: { id: string; label: string; emoji: string; purpose: string }[]; spots: { id: string; label: string; emoji: string }[]; theme: string | null; spot: string | null; built: boolean; lampLit: boolean; lampAvailable: boolean; reference: { kind: "turtles-in-log" | "none"; text: string } } | null;
  /** Visit 4 (content v3): the pier's reviewed spots, the chosen spot, whether it stands and whether the boat is moored (wood supplied). */
  pier: { spots: { id: string; label: string; emoji: string }[]; spot: string | null; built: boolean; boatMoored: boolean; woodAvailable: boolean } | null;
  /** Visit 5 (content v4): the harbor — workplaces with their status, the saved plan and the loaded boats. Present whenever the served content has a harbor. */
  harbor: HarborView | null;
  /** Visit 5: the reasoning conversation while its stage is active (or the finished one of the running visit). */
  reasoning: ReasoningView | null;
  /** Visit 5: the captain's-log prompt while the `log` stage of a routed chapter is active. */
  log: { id: string; prompt: string; instruction: string } | null;
  /** Visit 5: the writing review of the child's own sentence while `log-review` is active. */
  logReview: LogReviewView | null;
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
  /** UX-5a/5b: the lesson that just ended in the running visit, until the child has seen it. */
  lastLesson: LessonFeedback | null;
  /** UX-5c: one relevant cue for the lesson about to start, or null. */
  reminder: ReminderCue | null;
  /** The reopenable visit reports (finished visits complete, the running one partial), oldest first. */
  reports: VisitReport[];
  reflection: { prompt: string; options: { id: string; label: string }[]; skipLabel: string | null; dimensions: { id: string; prompt: string; options: { id: string; label: string }[]; skipLabel: string }[]; nextInterest: import("./family-learning-mission-spec.ts").NextInterestDef | null; adventure?: import("./family-learning-mission-spec.ts").MissionNextAdventure | null; closing?: ClosingView | null } | null;
  /** Content v5 (Visit 6): the running mission (stage `mission`), answer keys stripped. */
  mission: MissionView | null;
  /** Content v5 (V6-11): the next-visit question is still unanswered for this visit (asked at the next entry, never inferred). */
  interestPrompt: { visit: VisitId; prompt: string; entryPrompt: string; hint: string; unsureLabel: string; noPreferenceLabel: string; declineLabel: string } | null;
  /** Content v5: the child's latest own answer to "what next?" (shown back in the report). */
  latestInterest: { visit: VisitId; kind: InterestRecord["kind"]; text: string | null; at: string } | null;
  tutor: TutorContext | null;
  retention: string;
  /** Content v6: whether Nokt can talk on this surface (deployed builds: never; `fictional-stub` only on an isolated local DB). */
  nokt?: { mode: import("./family-learning-nokt.ts").NoktMode; mic?: boolean; talk?: ReturnType<typeof noktTalkView> };
};

function nextStepText(state: MissionState, content: LearningContent, stage: StageId | null, now: Date): string {
  // Isabel's own content (Old Lilas kleine Werkstatt): her own wording, never Santiago's base/island lines.
  if (content.child === "isabel") {
    // Isabel Visit 2+: a visit with its own reviewed wording (`childText`) speaks for itself; Visit 1 keeps its released lines.
    const running = state.visits.find((v) => v.finishedAt === null);
    const next = nextVisitAvailability(state, content, now);
    const text = content.visits.find((v) => v.id === (running?.id ?? next.visit))?.childText ?? null;
    const lastDone = [...state.visits].reverse().find((v) => v.finishedAt !== null);
    const doneText = lastDone ? content.visits.find((v) => v.id === lastDone.id)?.childText ?? null : null;
    if (stage === "mission") return text?.mission ?? "Hilf Old Lila in der Werkstatt: Wir bauen ein kleines Zimmer.";
    if (stage === "reflect") return "Wie war es heute?";
    if (next.visit) return text?.hub ?? "Old Lilas kleine Werkstatt wartet auf dich.";
    return doneText?.done ?? "Die Werkstatt ist für heute geschafft. Dein Zimmer ist gespeichert.";
  }
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
      case "EQ-PIER": return "Die Bretter für den Steg — Abschnitt für Abschnitt, mit Rest.";
      case "explain": return "Erkläre, wie du gerechnet hast.";
      case "LANG-EN-WATER": return "Eine Nachricht auf Englisch ist angekommen.";
      case "LANG-ES-AGUA": return "Eine Nachricht auf Spanisch ist angekommen.";
      case "LANG-ES-STATION": return "Bitte das Team auf Spanisch um die Lampe.";
      case "LANG-EN-PIER": return "Bitte das Team auf Englisch um Holz für den Steg.";
      case "typing": return "Ein kurzes Tipp-Training, dann das Schild.";
      case "typing-course": return "Tastatur-Check, dann kurze Tipp-Runden.";
      case "station-choice": return "Was soll deine Station beobachten?";
      case "station-build": return "Baue die Station.";
      case "pier-build": return "Baue den Steg ins Wasser.";
      case "island": return "Geh zu einer Werkstatt — du wählst, wo du anfängst.";
      case "EQ-HARBOR": return "Die Kisten kommen in die Boote — wie viele werden voll?";
      case "EQ-HARBOR-CHECK": return "Noch eine Ladung — ein kurzer Check.";
      case "LANG-ES-HARBOR": return "Bitte Rosa auf Spanisch um das Werkzeug.";
      case "LANG-ES-HARBOR-CHECK": return "Ein Wort zum Schluss — auf Spanisch.";
      case "harbor-build": return "Wohin fahren die Boote? Dein Plan.";
      case "log-review": return "Schau deinen Satz im Kapitänslogbuch noch einmal an.";
      case "log": return state.currentVisit === "v6" ? "Schreib einen Satz ins Kapitänslogbuch." : "Schreib die Expeditionsseite.";
      case "log-revise": return "Schau deinen Satz noch einmal an.";
      case "log-transfer": return "Schreib einen neuen kurzen Satz.";
      case "summary": return "Das hast du heute geschafft.";
      case "reflect": return "Wie war es heute?";
      case "mission": return state.currentVisit === "v9" ? "Geh über die Insel: Plan das neue Gewächshaus." : state.currentVisit === "v8" ? "Hilf Rosa, die Setzlinge in den Inselgarten zu bringen." : "Geh über die Insel: Finde heraus, was das Schiff braucht.";
    }
  }
  const availability = nextVisitAvailability(state, content, now);
  if ("reason" in availability && availability.reason === "chapter-unavailable") return "Dein angefangenes Kapitel ist gerade nicht verfügbar. Deine Basis, deine Seiten und dein Fortschritt sind gespeichert.";
  if ("reason" in availability && availability.reason === "no-further-visit-served") return "Das nächste Kapitel ist gerade nicht verfügbar. Deine Basis, deine Seiten und dein Fortschritt sind gespeichert.";
  if (availability.visit) {
    if (availability.visit === "v1") return "Baue deine Basis.";
    if (availability.visit === "v3") return "Deine angefangene Aufgabe von früher wartet auf dich.";
    if (availability.visit === "v4") return `Ein neues Kapitel (Besuch ${visitOrdinal(state, "v4") ?? 3}): die Beobachtungsstation.`;
    if (availability.visit === "v5") return `Ein neues Kapitel (Besuch ${visitOrdinal(state, "v5") ?? 4}): der Steg in der Bucht.`;
    if (availability.visit === "v6") return `Ein neues Kapitel (Besuch ${visitOrdinal(state, "v6") ?? 5}): der Hafen.`;
    if (availability.visit === "v7") return `Ein neues Kapitel (Besuch ${visitOrdinal(state, "v7") ?? 6}): die Fahrt zum Forschungsschiff.`;
    if (availability.visit === "v8") return `Ein neues Kapitel (Besuch ${visitOrdinal(state, "v8") ?? 7}): Rosas Inselgarten.`;
    if (availability.visit === "v9") return `Ein neues Kapitel (Besuch ${visitOrdinal(state, "v9") ?? 8}): das grössere Gewächshaus.`;
    return "Zurück zur Basis — ein neuer Besuch wartet.";
  }
  return "Alle Besuche sind geschafft.";
}

/** Optional per-request inputs of the view (follow-on): the learner's time zone, the stored reviews the progress strip may cite and the served vocabulary inventory. */
/** Content v7 (map missions): the closing card of the look back; null for every earlier mission (their reflection form is unchanged). */
function closingView(state: MissionState, content: LearningContent, visit: VisitId): ClosingView | null {
  const def = missionDefFor(content, visit);
  if (!def || (def.presentation !== "map" && def.presentation !== "workshop")) return null;
  const run = state.missions?.[def.id];
  if (!run) return null;
  if (def.presentation === "workshop") {
    // Isabel's workshop: her chosen room element, one honest success (or none), one factual recap; her button answers.
    const decideStep = def.steps.find((s) => s.kind === "decide");
    const ending = workshopEnding(def, run);
    const vw = state.visits.find((x) => x.id === visit && x.finishedAt === null);
    const fb: Record<string, string | null> = {};
    for (const [k, val] of Object.entries(vw?.feedback?.answers ?? {})) fb[k] = val;
    for (const k of vw?.feedback?.skipped ?? []) fb[k] = null;
    if (def.narration) {
      // Isabel Visit 2 (narrated): the result was already shown and spoken on the outcome beat; the closing asks one question per
      // screen and ends with the spoken goodbye.
      const nEnding = narratedWorkshopEnding(def, run);
      return { success: nEnding.success, next: nEnding.next, artifact: null, plan: null, feedback: fb, made: decideStep ? chosenOption(def, run, decideStep.id) : null, recap: narratedWorkshopRecap(def, run), farewell: farewellLines(content, def), narrated: true };
    }
    return { success: ending.success, next: ending.next, artifact: null, plan: null, feedback: fb, made: decideStep ? chosenOption(def, run, decideStep.id) : null, recap: workshopRecap(def, run) };
  }
  const ending = mapEnding(def, run);
  const decide = def.steps.find((s) => s.kind === "decide");
  const world = visibleWorld(def, run, stepStatuses(def, run));
  const v = state.visits.find((x) => x.id === visit && x.finishedAt === null);
  const feedback: Record<string, string | null> = {};
  for (const [k, val] of Object.entries(v?.feedback?.answers ?? {})) feedback[k] = val;
  for (const k of v?.feedback?.skipped ?? []) feedback[k] = null;
  return { success: ending.success, next: ending.next, artifact: world.length ? world.map((w) => w.label).join(" · ") : null, plan: decide ? chosenGrid(def, run, decide.id) : null, feedback };
}

export type ChildViewOptions = { timeZone?: string | null; progressSources?: ProgressSources | null; vocabulary?: VocabularyInventory | null; tutorAvailable?: boolean; noktMode?: import("./family-learning-nokt.ts").NoktMode; noktMic?: boolean };

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
    const modelId: MathItemId = def.kind === "quotient" ? "EQ-HARBOR-MODEL" : def.kind === "remainder" ? "EQ-STATION-MODEL" : "EQ-MODEL";
    const model = hasMathItem(content, modelId) ? mathItem(content, modelId) : null;
    const part = def.kind === "quotient" ? item.part ?? "full-remaining" : null;
    const partAttempts = part ? item.attempts.filter((a) => (a.part ?? "full-remaining") === part) : item.attempts;
    const lastIncorrect = [...partAttempts].reverse().find((a) => a.correct === false) ?? null;
    math = {
      id: itemId,
      version: def.version,
      kind: def.kind === "quotient" ? "quotient" : def.kind === "remainder" ? "remainder" : "sharing",
      prompt: def.prompt,
      scene: def.scene ?? null,
      quantity: def.quantity,
      groups: def.groups,
      perGroup: def.perGroup ?? null,
      unit: def.unit,
      group: def.group,
      phase: item.phase,
      attemptNo: item.attempts.length + 1,
      clarification: item.phase === "clarify" ? (part === "needed" ? def.decisionClarification ?? def.clarification ?? null : def.clarification ?? null) : null,
      representation: item.phase === "represent" || item.phase === "clarify" ? def.representation ?? null : null,
      example: item.phase === "example" && model ? { prompt: model.prompt, steps: model.steps ?? [], quantity: model.quantity, groups: model.groups, answer: model.answer } : null,
      taughtAnswer: item.outcome === "taught" ? def.answer : null,
      taughtAnswers: item.outcome === "taught" && def.kind === "remainder" && def.answers ? { ...def.answers } : null,
      teachingOffered: item.outcome === "pending" && partAttempts.filter((a) => a.correct !== null).length >= content.math.rules.maxSubstantiveAttempts,
      outcome: item.outcome,
      lastPartial:
        def.kind === "remainder" && lastIncorrect?.remainder && def.answers
          ? { usedCorrect: lastIncorrect.remainder.used === def.answers.used, remainingCorrect: lastIncorrect.remainder.remaining === def.answers.remaining }
          : def.kind === "quotient" && part === "full-remaining" && lastIncorrect?.quotient && def.answers
            ? { usedCorrect: lastIncorrect.quotient.full === def.answers.full, remainingCorrect: lastIncorrect.quotient.remaining === def.answers.remaining }
            : null,
      groupKind: content.math.recipientKinds?.[def.id] ?? (/forscher|person|kind|freund|team/i.test(def.group.singular) ? "people" : "container"),
      usedWord: usedWordOf(def),
      part,
      quotientWords: def.quotientWords ?? null,
      decisionPrompt: part === "needed" ? def.decisionPrompt ?? null : null,
      partA: item.quotientResult ? { full: item.quotientResult.full, remaining: item.quotientResult.remaining } : null,
      taughtQuotient: item.outcome === "taught" && def.kind === "quotient" && def.answers && def.answers.full !== undefined && def.answers.needed !== undefined ? { full: def.answers.full, remaining: def.answers.remaining, needed: def.answers.needed } : null,
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
      const fallback = { clarify: "Sag es bitte noch einmal mit dem Satzanfang — oder mach ohne Bewertung weiter.", incorrect: "Das war etwas anderes. Schau dir das Wort an und probier es nochmal.", unclear: "Das habe ich noch nicht verstanden. Probier es nochmal mit dem Satzanfang — oder mach ohne Bewertung weiter." };
      const kind: "clarify" | "incorrect" | "unclear" = last.correct === false ? "incorrect" : /^unclear/.test(String(records_uncertainty(seg, step.id))) ? "unclear" : "clarify";
      const text = step.kind === "produce" ? (kind === "incorrect" ? step.correction : kind === "unclear" ? childFacingUnclear(step.unclear) : step.clarification) : step.kind === "pick-supply" ? step.correction : undefined;
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
  const transferDef = transferDefFor(content, state.currentVisit);
  if (stage === "log-transfer" && state.currentVisit && transferDef) {
    const t = transferDef;
    const revision = [...state.logRevisions].reverse().find((r) => r.visit === state.currentVisit) ?? null;
    transfer = { id: t.id, version: t.version, prompt: t.prompt, instruction: t.instruction, helpExposed: !!revision?.helpShown };
  }

  // --- Visit 5 (content v4): the harbor, the reasoning conversation, the captain's log and its review
  const harborDef = content.harbor ?? null;
  const harborState = state.harbor ?? emptyHarbor();
  let harbor: HarborView | null = null;
  if (harborDef) {
    const harborItem = state.math["EQ-HARBOR"];
    const harborItemDef = hasMathItem(content, "EQ-HARBOR") ? mathItem(content, "EQ-HARBOR") : null;
    const resolved = !!harborItem && (harborItem.outcome === "correct" || harborItem.outcome === "taught") && harborItemDef;
    const q = harborItem?.quotientResult ?? null;
    const statuses = running && running.route ? workplaceStatuses(state, content, running) : [];
    harbor = {
      destinations: harborDef.destinations,
      destination: harborState.destination,
      planned: harborState.planned,
      roped: harborState.roped,
      ropesAvailable: (state.base.supplies["cuerdas"] ?? 0) > 0,
      load: resolved && harborItemDef ? { crates: harborItemDef.quantity, perBoat: harborItemDef.perGroup ?? 0, fullBoats: q?.full ?? harborItemDef.answers?.full ?? 0, remaining: q?.remaining ?? harborItemDef.answers?.remaining ?? 0, boatsNeeded: q?.needed ?? (harborItem?.outcome === "taught" ? harborItemDef.answers?.needed ?? null : null) } : null,
      workplaces: harborDef.workplaces.map((w) => {
        const ch = harborDef.characters.find((c) => c.id === w.character) ?? null;
        const st = statuses.find((x) => x.id === w.id)?.status ?? (running && running.id === "v6" ? "locked" : "locked");
        return { id: w.id, label: w.label, building: w.building, status: st, character: ch ? { id: ch.id, name: ch.name, role: ch.role, language: ch.language, lines: ch.lines } : null, stages: [...w.stages] };
      }),
      characters: harborDef.characters.map((ch) => ({ id: ch.id, name: ch.name, role: ch.role, language: ch.language, lines: ch.lines })),
      entered: [...harborState.entered],
    };
  }

  let reasoning: ReasoningView | null = null;
  if (stage === "explain" && content.reasoning && state.currentVisit === "v6") {
    const target = explainTarget(state, state.currentVisit);
    if (target && hasMathItem(content, target)) {
      const def = mathItem(content, target);
      const r = state.reasoning?.[target] ?? newReasoningState(target, content.reasoning, now.toISOString());
      reasoning = {
        itemId: target,
        status: r.status,
        turns: r.turns.map((t) => ({ role: t.role, text: t.text, kind: t.kind ?? null, source: t.source ?? null, origin: t.origin ?? null, modality: t.modality ?? null, at: t.at })),
        supportMode: r.supportMode,
        clarificationsLeft: Math.max(0, content.reasoning.maxClarifications - r.clarificationsUsed),
        assessment: reasoningAssessmentView(r, content.reasoning),
        turnsLeft: turnsLeft(r, content.reasoning),
        pending: liveTutorDeferred(state.currentVisit) ? null : pendingDispatch(r) ? { turnId: pendingDispatch(r)!.turnId, message: pendingDispatch(r)!.message } : null,
        deferred: liveTutorDeferred(state.currentVisit),
        method: r.method,
        methodLabel: methodLabel(content.reasoning, r.method),
        choices: !liveTutorDeferred(state.currentVisit) && r.status === "scaffold" ? { counters: !r.support.includes("counters"), teach: !r.support.includes("teaching"), continue: true } : null,
        item: { quantity: def.quantity, perGroup: def.perGroup ?? def.answer, groups: def.groups, unit: def.unit, group: def.group, prompt: def.prompt },
      };
    }
  }

  const logDef = logDefFor(content, state.currentVisit);
  const log = stage === "log" && logDef ? { id: logDef.id, prompt: logDef.prompt, instruction: logDef.instruction } : null;

  let logReview: LogReviewView | null = null;
  if (stage === "log-review" && state.currentVisit && logDef && content.writing?.review) {
    const page = [...state.pages].reverse().find((p) => p.visit === state.currentVisit) ?? null;
    if (page && page.modality !== "spoken") {
      const semanticRecord = semanticReviewFor(state, state.currentVisit, page);
      const review = reviewLogSentence(page.text, content.writing.review, content.writing.spacing.joins, semanticRecord?.semantic ?? null);
      const record = [...(state.logReviews ?? [])].reverse().find((r) => r.visit === state.currentVisit) ?? null;
      const label = (a: string) => writingAspectLabel(a as WritingReviewAspect);
      logReview = {
        logId: logDef.id,
        original: page.text,
        summary: review.summary,
        taught: review.taught.map((f) => ({ id: f.id, aspect: f.aspect, aspectLabel: label(f.aspect), given: f.given, expected: f.expected, teaching: f.teaching, source: f.source, certainty: f.certainty })),
        points: review.points,
        clean: review.clean,
        cleanLabels: review.clean.map(label),
        unchecked: review.unchecked,
        uncheckedLabels: review.unchecked.map(label),
        uncheckedWords: review.uncheckedWords,
        clarify: review.clarify,
        pending: liveTutorDeferred(state.currentVisit) ? null : semanticRecord && semanticRecord.status !== "pending" ? null : { turnId: semanticTurnId(state.currentVisit, page), message: buildWritingReviewDispatch(content.writing.review, logDef, page.text), recorded: !!semanticRecord },
        semanticStatus: liveTutorDeferred(state.currentVisit) ? "unavailable" : semanticRecord ? semanticRecord.status : "pending",
        semanticDeferred: liveTutorDeferred(state.currentVisit),
        semanticOrigin: semanticRecord?.origin ?? null,
        suggestion: review.suggestion,
        marked: review.marked,
        record: record ? { outcome: record.outcome, revised: record.revised, resolved: record.evaluation?.resolved.length ?? 0, unresolved: record.evaluation?.unresolved.length ?? 0 } : null,
      };
    }
  }

  // --- the assistant context (Nabu sidebar): page/task binding, the child's current work, island state, objective, prior attempts, open focus
  const islandWords = describeIslandState(state, content);
  const openFocus = (state.feedback?.focus ?? []).filter((f) => f.status === "open").map((f) => f.evidence);
  let tutor: TutorContext | null = null;
  if (math && math.outcome === "pending") {
    const itemState = state.math[math.id]!;
    const prior = itemState.attempts.map((a) => `Versuch ${a.no}${a.part ? ` (${a.part === "needed" ? "Boote für alle" : "volle Boote/übrig"})` : ""}: „${a.raw}“ — ${a.correct === null ? "unklar" : a.correct ? "richtig" : "nicht richtig"}${a.support.length ? `, Hilfe: ${a.support.join(", ")}` : ""}`);
    tutor = { taskId: math.id, taskVersion: math.version, language: "de", prompt: math.part === "needed" && math.decisionPrompt ? math.decisionPrompt : math.prompt, allowedHelp: "Erklären und Fragen beantworten, aber die Lösung nicht verraten.", page: "mission", stage, childWork: itemState.attempts.length ? itemState.attempts[itemState.attempts.length - 1].raw : null, islandState: islandWords, objective: mathItem(content, math.id).purpose, priorAttempts: prior, focus: openFocus[0] ?? null };
  } else if (language?.step) {
    const sentence = "sentence" in language.step ? language.step.sentence : language.step.frame;
    const seg = state.language[language.id];
    const prior = (seg?.records ?? []).filter((r) => r.stepId === language.step!.id).map((r) => `„${r.response}“ — ${r.correct === null ? "unbewertet" : r.correct ? "richtig" : "nicht richtig"}${r.support.length ? `, Hilfe: ${r.support.join(", ")}` : ""}`);
    tutor = { taskId: `${language.id}/${language.step.id}`, taskVersion: 1, language: language.language, prompt: sentence, allowedHelp: "Wörter erklären (auf Deutsch), Beispiele geben, dann zurück zur Aufgabe.", page: "mission", stage, childWork: prior.length ? (seg?.records ?? []).filter((r) => r.stepId === language.step!.id).slice(-1)[0]?.response ?? null : null, islandState: islandWords, objective: languageSegment(content, language.id).objective, priorAttempts: prior, focus: openFocus[0] ?? null };
  } else if (reasoning) {
    const def = mathItem(content, reasoning.itemId);
    const itemState = state.math[reasoning.itemId]!;
    tutor = { taskId: reasoning.itemId, taskVersion: def.version, language: "de", prompt: def.prompt, allowedHelp: "Nachfragen stellen, Begriffe erklären, aber keine fertige Erklärung vorsagen.", page: "mission", stage, childWork: itemState.attempts.length ? itemState.attempts[itemState.attempts.length - 1].raw : null, islandState: islandWords, objective: "Den eigenen Rechenweg erklären.", priorAttempts: reasoning.turns.filter((t) => t.role === "child").map((t) => `„${t.text}“ (${t.modality ?? "typed"})`), focus: openFocus[0] ?? null };
  } else if (stage) {
    const current = stage === "log-review" && logReview ? logReview.original : stage === "typing-course" ? "Tipp-Runde" : null;
    tutor = { taskId: stage, taskVersion: 1, language: "de", prompt: nextStepText(state, content, stage, now), allowedHelp: "Erklären, was zu tun ist; nichts vorsagen, was bewertet wird.", page: "mission", stage, childWork: current, islandState: islandWords, objective: null, priorAttempts: [], focus: openFocus[0] ?? null };
  } else {
    tutor = { taskId: "map", taskVersion: 1, language: "de", prompt: nextStepText(state, content, null, now), allowedHelp: "Erklären, was auf der Insel zu sehen ist und was als Nächstes kommt.", page: "map", stage: null, childWork: null, islandState: islandWords, objective: null, priorAttempts: [], focus: openFocus[0] ?? null };
  }

  const minutesElapsed = running ? Math.floor((now.getTime() - new Date(running.startedAt).getTime()) / 60000) : 0;
  const def = running ? findVisitDef(content, running.id) ?? null : null;
  const stationDef = content.station ?? null;
  const pier = state.pier ?? emptyPier();
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
      ? { id: running.id, ordinal: visitOrdinal(state, running.id), title: visitLabel(state, content, running.id), startedAt: running.startedAt, stage, stageIndex: running.stageIndex, stageCount: (visitStages(running, content) ?? def.stages).length, minutesElapsed, overBudget: minutesElapsed >= content.visitBudgetMinutes.max, intro: def.intro ?? null }
      : null,
    next: { visit: availability.visit, ordinal: availability.visit ? visitOrdinal(state, availability.visit) : null, availableAt: availability.availableAt, reason: "reason" in availability ? availability.reason : null },
    delayedCheck: delayedCheckInfo(state, content, now),
    progress: buildProgress(state, content, { now, timeZone: options.timeZone ?? null, sources: options.progressSources ?? null }),
    vocabulary: options.vocabulary ? childVocabularyCue(buildVocabularyLedger(state, content, options.vocabulary), content, state) : null,
    wordbook: options.vocabulary ? childWordbook(buildVocabularyLedger(state, content, options.vocabulary), content, state, options.vocabulary) : null,
    nextStep: nextStepText(state, content, stage, now),
    ...(content.child === "isabel" ? { visitText: visitTextFor(state, content, availability.visit) } : {}),
    locations: content.locations,
    station: stationDef ? { themes: stationDef.themes, spots: stationDef.spots, theme: station.theme, spot: station.spot, built: station.built, lampLit: station.lampLit, lampAvailable: (state.base.supplies["lámpara"] ?? 0) > 0, reference: stationReference } : null,
    pier: content.pier ? { spots: content.pier.spots, spot: pier.spot, built: pier.built, boatMoored: pier.boatMoored, woodAvailable: (state.base.supplies["wood"] ?? 0) > 0 } : null,
    harbor,
    reasoning,
    log,
    logReview,
    math,
    language,
    typing,
    typingCourse,
    logRevise,
    summary: stage === "summary" && running ? buildVisitSummary(state, content, running.id) : null,
    lastLesson: lastLessonFeedback(state, content),
    // The cue belongs to the lesson about to start: while the last lesson's feedback is still pending there is none.
    reminder: lastLessonFeedback(state, content)
      ? null
      : reminderFor(state, content, {
          stage,
          typingLines: typingCourse?.lesson?.lines ?? (typing && typing.available ? typing.lesson.lines : null),
          mathKind: math ? (math.kind === "quotient" ? "remainder" : math.kind) : null,
          language: language?.language ?? null,
          languageWords: language ? languageWordsOf(content, language.id) : null,
        }),
    reports: buildVisitReports(state, content),
    transfer,
    reflection: stage === "reflect" ? { prompt: content.reflection.prompt, options: content.reflection.options, skipLabel: content.reflection.skipLabel ?? null, dimensions: content.reflection.dimensions ?? [], nextInterest: content.reflection.nextInterest ?? null, adventure: running ? missionDefFor(content, running.id)?.nextAdventure ?? null : null, ...(running ? { closing: closingView(state, content, running.id) } : {}) } : null,
    mission: stage === "mission" && running ? buildMissionView(state, content, running.id, { tutorAvailable: options.tutorAvailable === true }) : null,
    interestPrompt: (() => {
      const ni = content.reflection.nextInterest;
      const pending = ni && stage !== "reflect" ? pendingInterest(state, content) : null;
      // Asked at the next entry only when the visit was LEFT before its closing: a running mission visit counts once the child
      // is outside it (the hub shows the prompt), a finished one when its closing answer is missing.
      return ni && pending ? { visit: pending, prompt: ni.prompt, entryPrompt: ni.entryPrompt, hint: ni.hint, unsureLabel: ni.unsureLabel, noPreferenceLabel: ni.noPreferenceLabel, declineLabel: ni.declineLabel } : null;
    })(),
    latestInterest: (() => {
      const last = (state.interests ?? [])[(state.interests ?? []).length - 1];
      return last ? { visit: last.visit, kind: last.kind, text: last.text, at: last.at } : null;
    })(),
    tutor,
    retention: content.retention.policy,
    // Nokt is Santiago's companion: for any other child's content (Isabel's workshop) the view says «unavailable» whatever the
    // server's conversation mode is — no Nokt button, no look-back talk, no microphone; Old Lila's lines are reviewed content.
    nokt: (() => {
      const mode = content.child === "santiago" ? options.noktMode ?? "unavailable" : "unavailable";
      return { mode, mic: mode !== "unavailable" && !!options.noktMic, ...(mode !== "unavailable" && content.child === state.child && (content.missions ?? []).some((m) => m.presentation === "map") ? { talk: noktTalkView(state, content) } : {}) };
    })(),
  };
}

/** The uncertainty tag of the last record on a step, kept on the record for the view. */
function records_uncertainty(seg: LanguageSegmentState, stepId: string): string | null {
  const last = seg.records.filter((r) => r.stepId === stepId).pop();
  return last?.uncertainty ?? null;
}

/** One line of saved island state in words (for the assistant context and the parent); durable records only. */
export function describeIslandState(state: MissionState, content: LearningContent): string {
  const scene = buildSceneModel(state, content);
  const parts: string[] = [];
  if (scene.name) parts.push(`Basis „${scene.name}“ (${scene.base === "tent" ? "Zelt" : "Hütte"})`);
  const garden = scene.beds.filter((b) => b.id.startsWith("garden")).length;
  const station = scene.beds.filter((b) => b.id.startsWith("station")).length;
  if (garden) parts.push(`${garden} Gartenbeete`);
  if (station) parts.push(`${station} Stationsbeete${scene.leftovers ? `, ${scene.leftovers} übrig` : ""}`);
  if (scene.station.built) parts.push(`Station${scene.station.lamp ? " mit Lampe" : ""}`);
  if (scene.pier.built) parts.push(`Steg${scene.pier.boat ? ", Boot angelegt" : ""}`);
  if (scene.harbor.fullBoats) parts.push(`Hafen: ${scene.harbor.fullBoats} volle Boote, ${scene.harbor.remaining} Kisten übrig${scene.harbor.boatsNeeded ? `, ${scene.harbor.boatsNeeded} Boote nötig` : ""}${scene.harbor.destination ? `, Ziel gewählt` : ""}${scene.harbor.roped ? ", Seile da" : ""}`);
  const stores = Object.entries(state.base.supplies).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  if (stores.length) parts.push(`Vorräte: ${stores.join(", ")}`);
  parts.push(`${state.pages.length} Logbuchseite${state.pages.length === 1 ? "" : "n"}`);
  return parts.join(" · ");
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
    ...(context.page ? [`Seite: ${context.page === "map" ? "Insel-Karte" : "Aufgabe"}${context.stage ? ` (${context.stage})` : ""}.`] : []),
    ...(context.objective ? [`Lernziel: ${context.objective}`] : []),
    ...(context.childWork ? [`Aktuelle Arbeit des Kindes: ${context.childWork.slice(0, 300)}`] : []),
    ...(context.priorAttempts && context.priorAttempts.length ? [`Bisherige Versuche/Hilfe: ${context.priorAttempts.slice(-4).join(" | ").slice(0, 600)}`] : []),
    ...(context.islandState ? [`Gespeicherte Insel: ${context.islandState.slice(0, 300)}`] : []),
    ...(context.focus ? [`Offener Übungsfokus: ${context.focus.slice(0, 200)}`] : []),
    "Regeln: Antworte dem Kind kurz und freundlich auf Deutsch. Verrate keine Lösung einer bewerteten Aufgabe. Keine Daten anderer Personen.",
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
    case "EQ-PIER": return "Steg";
    case "explain": return "Erklären";
    case "LANG-EN-WATER": return "English";
    case "LANG-ES-AGUA": return "Español";
    case "LANG-ES-STATION": return "Español";
    case "LANG-EN-PIER": return "English";
    case "typing": return "Tippen";
    case "typing-course": return "Tippen";
    case "station-choice": return "Station";
    case "station-build": return "Bauen";
    case "pier-build": return "Steg bauen";
    case "island": return "Insel";
    case "EQ-HARBOR": return "Boote";
    case "EQ-HARBOR-CHECK": return "Check";
    case "LANG-ES-HARBOR": return "Español";
    case "LANG-ES-HARBOR-CHECK": return "Español";
    case "harbor-build": return "Plan";
    case "log-review": return "Dein Satz";
    case "log": return "Logbuch";
    case "log-revise": return "Nochmal lesen";
    case "log-transfer": return "Neuer Satz";
    case "summary": return "Geschafft";
    case "reflect": return "Fertig";
    case "mission": return "Mission";
  }
}

export { SCORED_IDS as SCORED_MATH_ITEM_IDS };
export type { MathItemId };
