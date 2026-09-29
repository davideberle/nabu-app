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
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import {
  isScoredMathItemId,
  languageSegment,
  mathItem,
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
  type VisitId,
} from "./family-learning-content.ts";

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
  answer: number | null;
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

export type TypingLineMetrics = { expectedChars: number; typedChars: number; correctChars: number; extraChars: number; omittedChars: number };

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
  /** Σ max(expected_i, typed_i): the denominator of the accuracy ratio. */
  denominator: number;
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
  seconds: number;
  at: string;
};

export type ExpeditionPage = {
  visit: VisitId;
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
  reflection: string | null;
};

export type MissionState = {
  missionId: string;
  contentVersion: number;
  child: ChildId;
  revision: number;
  createdAt: string;
  updatedAt: string;
  base: { name: string | null; locationId: string | null; supplies: Record<string, number> };
  pages: ExpeditionPage[];
  visits: VisitRecord[];
  currentVisit: VisitId | null;
  math: Record<ScoredMathItemId, MathItemState>;
  modelShownAt: string | null;
  /** First teaching move in visit 1 — the anchor for the delayed check. */
  teachingFirstAt: string | null;
  explanations: { visit: VisitId; text: string; modality: AnswerModality; at: string }[];
  language: Record<LanguageSegmentId, LanguageSegmentState>;
  typing: { lessons: TypingLessonRecord[]; labels: TypingLabelRecord[]; skipped: { visit: VisitId; reason: "time" | "child" }[] };
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

const SCORED_IDS: readonly ScoredMathItemId[] = ["EQ-ENTRY", "EQ-FRESH", "EQ-RETURN", "EQ-DELAY"];

function emptyMathState(): MathItemState {
  return {
    shownAt: null,
    shownVisit: null,
    exposure: "none",
    phase: "answer",
    attempts: [],
    supportGiven: [],
    allocation: null,
    resolvedAt: null,
    outcome: "pending",
  };
}

function emptyLanguageState(): LanguageSegmentState {
  return { stepIndex: 0, records: [], help: { gloss: [], audio: [], wordChoice: [], tutor: 0 }, done: false, skipped: null };
}

export function newMissionState(content: LearningContent, child: ChildId, nowIso: string): MissionState {
  return {
    missionId: content.contentId,
    contentVersion: content.contentVersion,
    child,
    revision: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    base: { name: null, locationId: null, supplies: {} },
    pages: [],
    visits: [],
    currentVisit: null,
    math: {
      "EQ-ENTRY": emptyMathState(),
      "EQ-FRESH": emptyMathState(),
      "EQ-RETURN": emptyMathState(),
      "EQ-DELAY": emptyMathState(),
    },
    modelShownAt: null,
    teachingFirstAt: null,
    explanations: [],
    language: { "LANG-EN-WATER": emptyLanguageState(), "LANG-ES-AGUA": emptyLanguageState() },
    typing: { lessons: [], labels: [], skipped: [] },
  };
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
  kind: "explanation" | "expedition_log" | "typed_label" | "language_response" | "typing_practice";
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
  | { op: "request-teaching"; itemId: ScoredMathItemId }
  | { op: "stop-item"; itemId: ScoredMathItemId }
  | { op: "continue-item"; itemId: ScoredMathItemId }
  | { op: "explain"; text: string; modality: AnswerModality }
  | { op: "language-step"; segmentId: LanguageSegmentId; stepId: string; response: string; modality: AnswerModality | "listen"; transcriptConfirmed?: boolean }
  | { op: "typing-lesson"; lessonId: string; lines: string[]; seconds: number }
  | { op: "language-continue"; segmentId: LanguageSegmentId; stepId: string }
  | { op: "typing-label"; taskId: string; typed: string; seconds: number }
  | { op: "skip-stage"; stage: StageId; reason: "time" | "child" }
  | { op: "save-log"; text: string; modality?: "typed" | "spoken" }
  | { op: "reflect"; optionId: string };

export type OpEnv = { content: LearningContent; settings: ParentSettings; now: () => Date; newId: () => string };

export class LearningOpError extends Error {
  readonly code: "invalid" | "not-allowed" | "not-available" | "stale";
  constructor(code: "invalid" | "not-allowed" | "not-available" | "stale", message: string) {
    super(message);
    this.code = code;
  }
}

export type OpResult = { state: MissionState; records: Records; result: Record<string, unknown> };

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

function currentVisit(state: MissionState): VisitRecord {
  const visit = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null);
  if (!visit) throw new LearningOpError("not-allowed", "no visit is running");
  return visit;
}

export function currentStage(state: MissionState, content: LearningContent): StageId | null {
  if (!state.currentVisit) return null;
  const visit = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null);
  if (!visit) return null;
  const def = visitDef(content, visit.id);
  return def.stages[visit.stageIndex] ?? null;
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

/** Next visit the child may start, or the reason none can start yet. */
export function nextVisitAvailability(
  state: MissionState,
  content: LearningContent,
  now: Date,
): { visit: VisitId; availableAt: null } | { visit: VisitId | null; availableAt: string | null; reason: string } {
  const running = state.visits.find((v) => v.finishedAt === null);
  if (running) return { visit: running.id, availableAt: null };
  const finished = state.visits.filter((v) => v.finishedAt !== null).map((v) => v.id);
  if (!finished.includes("v1")) return { visit: "v1", availableAt: null };
  if (!finished.includes("v2")) return { visit: "v2", availableAt: null };
  if (!finished.includes("v3")) {
    const def = visitDef(content, "v3");
    const anchor = delayAnchor(state);
    const minDays = def.minDaysAfterTeaching ?? 6;
    if (!anchor) return { visit: null, availableAt: null, reason: "no-anchor" };
    const availableAt = new Date(new Date(anchor).getTime() + minDays * 24 * 3600 * 1000);
    if (now.getTime() < availableAt.getTime()) {
      return { visit: null, availableAt: ISO(availableAt), reason: "delayed-check-waits" };
    }
    return { visit: "v3", availableAt: null };
  }
  return { visit: null, availableAt: null, reason: "all-visits-done" };
}

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
  if (item.shownAt) return { state, records: emptyRecords(), changed: false };
  const next = clone(state);
  const nowIso = ISO(now);
  next.math[itemId].shownAt = nowIso;
  next.math[itemId].shownVisit = next.currentVisit;
  next.math[itemId].exposure = "shown";
  const def = mathItem(content, itemId);
  const records = emptyRecords();
  records.exposures.push({ taskId: itemId, taskVersion: def.version, kind: "shown", source: "render", at: nowIso });
  return { state: next, records, changed: true };
}

/** Anchor for the delayed check: first teaching move, else the end of visit 1. */
export function delayAnchor(state: MissionState): string | null {
  return state.teachingFirstAt ?? state.visits.find((v) => v.id === "v1")?.finishedAt ?? null;
}

function secondsSince(from: string | null, now: Date): number | null {
  if (!from) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 1000));
}

function noteTeaching(state: MissionState, nowIso: string) {
  if (!state.teachingFirstAt && state.currentVisit === "v1") state.teachingFirstAt = nowIso;
}

/** Deterministic classification of a tutor reply against one item's answer. */
export function tutorReplyRevealsAnswer(reply: string, item: MathItem): boolean {
  const answer = String(item.answer);
  const tokens = reply.toLowerCase().match(/\d+|[a-zäöüß]+/g) ?? [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== answer) continue;
    // A standalone occurrence of the answer number anywhere in the reply is a
    // positive exposure signal. Combined phrasings ("je 6", "6 each",
    // "6 Pakete") are covered by the same token match.
    return true;
  }
  return false;
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
 * Typing accuracy over the completed text: positional matches divided by the
 * longer of target and typed length, so inserted or trailing extra characters
 * reduce the score instead of being ignored.
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

/** Per-line metrics for a lesson; aggregates keep insertions and omissions separate. */
export function lessonMetrics(expectedLines: string[], typedLines: string[]): Omit<TypingLessonRecord, "lessonId" | "layout" | "seconds" | "at"> {
  const lines: TypingLineMetrics[] = expectedLines.map((expected, i) => {
    const m = typingAccuracy(expected, typedLines[i] ?? "");
    return { ...m, omittedChars: Math.max(0, m.expectedChars - m.typedChars) };
  });
  const sum = (f: (l: TypingLineMetrics) => number) => lines.reduce((n, l) => n + f(l), 0);
  return {
    lines,
    expectedChars: sum((l) => l.expectedChars),
    typedChars: sum((l) => l.typedChars),
    correctChars: sum((l) => l.correctChars),
    extraChars: sum((l) => l.extraChars),
    omittedChars: sum((l) => l.omittedChars),
    denominator: sum((l) => Math.max(l.expectedChars, l.typedChars)),
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

    case "support": {
      const visit = currentVisit(state);
      const stage = currentStage(state, content);
      const activeItem = scoredItemForStage(stage);
      // The target is the task the client was helping with when the help was
      // requested. It may have advanced meanwhile (another tab, a late tutor
      // reply): the event is still recorded against the ORIGINAL task, so a
      // reply that reveals an answer is bound to that item, never lost.
      const target = op.taskId ?? activeItem ?? (stage === "LANG-EN-WATER" || stage === "LANG-ES-AGUA" ? stage : null);
      const targetItem = target !== null && isScoredMathItemId(target) ? target : null;
      // Language task ids come from the view as "<segment>/<step>" (the tutor
      // context) or as the bare segment id (gloss, audio, word list). Both bind
      // to the segment's durable help ledger; the step is kept on the event.
      const segmentPart = target !== null ? target.split("/")[0] : null;
      const stepPart = target !== null && target.includes("/") ? target.slice(target.indexOf("/") + 1) : null;
      const targetSegment = segmentPart === "LANG-EN-WATER" || segmentPart === "LANG-ES-AGUA" ? segmentPart : null;
      if (target !== null && targetItem === null && targetSegment === null) {
        throw new LearningOpError("invalid", "support must name a known task");
      }
      if (targetSegment && stepPart !== null && !languageSegment(content, targetSegment).steps.some((s) => s.id === stepPart)) {
        throw new LearningOpError("invalid", "support must name a known step");
      }
      let payload: unknown = op.payload ?? null;
      const payloadRecord = (op.payload && typeof op.payload === "object" ? op.payload : {}) as Record<string, unknown>;
      if (targetItem) {
        const item = state.math[targetItem];
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
        const help = state.language[targetSegment].help;
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

    case "answer-math": {
      requireStage(state, content, op.itemId);
      const def = mathItem(content, op.itemId);
      const item = state.math[op.itemId];
      if (item.outcome !== "pending") throw new LearningOpError("not-allowed", "item already resolved");
      if (item.phase !== "answer" && item.phase !== "represent" && item.phase !== "clarify") {
        throw new LearningOpError("not-allowed", `item is in phase ${item.phase}`);
      }
      const uncertain = op.uncertain === true || op.answer === null || !Number.isInteger(op.answer);
      const answer = uncertain ? null : (op.answer as number);
      const correct = answer === null ? null : answer === def.answer;
      if (op.modality === "counters" && !item.supportGiven.includes("counters")) item.supportGiven.push("counters");
      const fresh = item.attempts.every((a) => a.correct === null) && item.exposure !== "answer_revealed" && (item.shownVisit === null || item.shownVisit === state.currentVisit);
      const evidence = evidenceFor(item, correct, fresh);
      const substantiveBefore = item.attempts.filter((a) => a.correct !== null).length;
      const attempt: MathAttempt = {
        no: item.attempts.length + 1,
        answer,
        raw: boundedText(op.raw || String(op.answer ?? ""), 80, "answer"),
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
        item.resolvedAt = nowIso;
        feedback = "done";
      } else if (correct === null) {
        feedback = item.phase; // stays where it was; nothing substantive happened
      } else {
        // CONTRACT rule 4: first incorrect → one clarification; second → a
        // representation (or the model example for EQ-ENTRY) with direct
        // teaching already on offer; a third unsuccessful attempt ends the
        // loop — only "teach" or "stop" remain.
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
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "clarification", payload: { auto: true }, at: nowIso });
          if (!item.supportGiven.includes("clarification")) item.supportGiven.push("clarification");
        } else {
          feedback = "represent";
        }
      }
      // A clarified second attempt that is still wrong: representation or the
      // model example before the last try (rule 4).
      if (correct === false && feedback === "represent") {
        noteTeaching(state, nowIso);
        if (op.itemId === "EQ-ENTRY") {
          item.phase = "example";
          attempt.teachingMove = "model-example";
          attempt.teachingReason = "second-incorrect";
          if (!state.modelShownAt) {
            state.modelShownAt = nowIso;
            records.exposures.push({ taskId: "EQ-MODEL", taskVersion: mathItem(content, "EQ-MODEL").version, kind: "example_shown", source: "teaching", at: nowIso });
          }
          if (!item.supportGiven.includes("example")) item.supportGiven.push("example");
          records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "example", payload: { model: "EQ-MODEL" }, at: nowIso });
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
        objective: content.math.objective,
        attemptNo: attempt.no,
        answer: { value: answer, raw: attempt.raw },
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
        state.base.supplies[def.unit.plural] = (state.base.supplies[def.unit.plural] ?? 0) + def.quantity;
        advance(state, content);
      }
      result = { feedback, correct, evidence: attempt.evidence, attemptNo: attempt.no };
      break;
    }

    case "continue-item": {
      // After the model example: back to answering (the example stays hidden
      // for the fresh item by construction — it belongs to EQ-MODEL only).
      requireStage(state, content, op.itemId);
      const item = state.math[op.itemId];
      if (item.phase === "example" || item.phase === "clarify") item.phase = item.phase === "example" ? "answer" : "answer";
      result = { phase: item.phase };
      break;
    }

    case "request-teaching": {
      requireStage(state, content, op.itemId);
      const def = mathItem(content, op.itemId);
      const item = state.math[op.itemId];
      const substantive = item.attempts.filter((a) => a.correct !== null).length;
      if (item.phase !== "teach-or-stop" && !(substantive >= content.math.rules.maxSubstantiveAttempts && (item.phase === "represent" || item.phase === "example" || item.phase === "answer"))) {
        throw new LearningOpError("not-allowed", "direct teaching is offered only after two unsuccessful attempts");
      }
      noteTeaching(state, nowIso);
      item.exposure = "answer_revealed";
      item.outcome = "taught";
      item.phase = "done";
      item.allocation = def.answer;
      item.resolvedAt = nowIso;
      records.exposures.push({ taskId: op.itemId, taskVersion: def.version, kind: "answer_revealed", source: "direct_teaching", at: nowIso });
      records.supports.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: op.itemId, kind: "direct_teaching", payload: { answer: def.answer }, at: nowIso });
      state.base.supplies[def.unit.plural] = (state.base.supplies[def.unit.plural] ?? 0) + def.quantity;
      advance(state, content);
      result = { taught: true, answer: def.answer };
      break;
    }

    case "stop-item": {
      requireStage(state, content, op.itemId);
      const item = state.math[op.itemId];
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
      state.explanations.push({ visit: state.currentVisit as VisitId, text, modality: op.modality, at: nowIso });
      records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: "EQ-FRESH", kind: "explanation", language: "de", modality: op.modality, text, metrics: null, at: nowIso });
      advance(state, content);
      break;
    }

    case "language-step": {
      requireStage(state, content, op.segmentId);
      const segment = languageSegment(content, op.segmentId);
      const seg = state.language[op.segmentId];
      const { step, index } = findStep(segment, op.stepId);
      if (index !== seg.stepIndex) throw new LearningOpError("not-allowed", `step ${op.stepId} is not the current step`);
      // Support is derived from the durable per-segment help ledger, never from
      // client flags: help that was recorded (and therefore shown) counts.
      const help = seg.help;
      const support: ("gloss" | "audio" | "word-choice" | "tutor" | "retry" | "feedback")[] = [];
      if (help.gloss.length > 0) support.push("gloss");
      if (help.audio.length > 0) support.push("audio");
      if (help.wordChoice.length > 0 || op.modality === "word-choice") support.push("word-choice");
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
      const record: LanguageStepRecord = { stepId: step.id, evidence, correct, uncertainty, response, modality: op.modality, support, at: nowIso };
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
      const seg = state.language[op.segmentId];
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
      const metrics = typingAccuracy(target, typed);
      const rec: TypingLabelRecord = { taskId: task.id, target, typed, ...metrics, omittedChars: Math.max(0, metrics.expectedChars - metrics.typedChars), seconds: Math.max(0, Math.round(op.seconds)), at: nowIso };
      state.typing.labels.push(rec);
      records.samples.push({ id: env.newId(), visitId: state.currentVisit as VisitId, taskId: task.id, kind: "typed_label", language: "de", modality: "typed", text: typed, metrics: rec, at: nowIso });
      advance(state, content);
      result = { accuracy: accuracyRatio(metrics) };
      break;
    }

    case "skip-stage": {
      const visit = currentVisit(state);
      const stage = currentStage(state, content);
      if (stage !== op.stage) throw new LearningOpError("not-allowed", "stage is not active");
      const optional: StageId[] = ["LANG-EN-WATER", "LANG-ES-AGUA", "typing", "explain"];
      if (!optional.includes(op.stage)) throw new LearningOpError("not-allowed", "only optional segments can be skipped");
      visit.skippedStages.push({ stage: op.stage, reason: op.reason });
      if (op.stage === "typing") state.typing.skipped.push({ visit: visit.id, reason: op.reason });
      if (op.stage === "LANG-EN-WATER" || op.stage === "LANG-ES-AGUA") state.language[op.stage].skipped = op.reason;
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

    case "reflect": {
      requireStage(state, content, "reflect");
      if (!content.reflection.options.some((o) => o.id === op.optionId)) throw new LearningOpError("invalid", "unknown reflection option");
      const visit = currentVisit(state);
      visit.reflection = op.optionId;
      visit.finishedAt = nowIso;
      visit.stageIndex += 1;
      state.currentVisit = null;
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
  return { state, records, result };
}

// ---------------------------------------------------------------------------
// Child view — what the browser is allowed to know
// ---------------------------------------------------------------------------

export type MathItemView = {
  id: ScoredMathItemId;
  version: number;
  prompt: string;
  scene: string | null;
  quantity: number;
  groups: number;
  unit: MathItem["unit"];
  group: MathItem["group"];
  phase: MathPhase;
  attemptNo: number;
  clarification: string | null;
  representation: string | null;
  /** The teaching example, only while the item is in the `example` phase. */
  example: { prompt: string; steps: string[]; quantity: number; groups: number; answer: number } | null;
  /** Shown only after the item is resolved by direct teaching. */
  taughtAnswer: number | null;
  /** True once two substantive attempts failed: "teach" and "stop" are offered. */
  teachingOffered: boolean;
  outcome: MathItemState["outcome"];
};

export type LanguageStepView =
  | { id: string; kind: "listen-read"; sentence: string; instruction: string }
  | { id: string; kind: "pick-supply"; sentence: string; instruction: string; options: { id: string; label: string; emoji: string }[] }
  | { id: string; kind: "produce"; instruction: string; frame: string; target: string; choices: string[] };

export type TypingView =
  | { available: true; lesson: { id: string; title: string; layout: KeyboardLayoutId; homeRow: string[]; fingers: Record<string, string>; lines: string[] }; label: { taskId: string; instruction: string; target: string } | null; lessonDone: boolean }
  | { available: false; reason: "layout-unconfirmed"; label: { taskId: string; instruction: string; target: string } | null };

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
  title: string;
  hook: string;
  base: { name: string | null; location: { id: string; label: string; emoji: string } | null; supplies: Record<string, number> };
  pages: ExpeditionPage[];
  visit: { id: VisitId; title: string; startedAt: string; stage: StageId | null; stageIndex: number; stageCount: number; minutesElapsed: number; overBudget: boolean } | null;
  next: { visit: VisitId | null; availableAt: string | null; reason: string | null };
  nextStep: string;
  locations: { id: string; label: string; emoji: string }[];
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
  reflection: { prompt: string; options: { id: string; label: string }[] } | null;
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
      case "explain": return "Erkläre, wie du gerechnet hast.";
      case "LANG-EN-WATER": return "Eine Nachricht auf Englisch ist angekommen.";
      case "LANG-ES-AGUA": return "Eine Nachricht auf Spanisch ist angekommen.";
      case "typing": return "Ein kurzes Tipp-Training, dann das Schild.";
      case "log": return "Schreib die Expeditionsseite.";
      case "reflect": return "Wie war es heute?";
    }
  }
  const availability = nextVisitAvailability(state, content, now);
  if (availability.visit) return availability.visit === "v1" ? "Baue deine Basis." : "Zurück zur Basis — ein neuer Besuch wartet.";
  if (availability.availableAt) {
    return `Der späte Check öffnet am ${new Date(availability.availableAt).toLocaleDateString("de-CH", { day: "numeric", month: "long" })}.`;
  }
  return "Alle drei Besuche sind geschafft.";
}

export function buildChildView(state: MissionState, content: LearningContent, settings: ParentSettings, now: Date): ChildView {
  const stage = currentStage(state, content);
  const running = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null) ?? null;
  const availability = nextVisitAvailability(state, content, now);
  const location = content.locations.find((l) => l.id === state.base.locationId) ?? null;

  let math: MathItemView | null = null;
  const itemId = scoredItemForStage(stage);
  if (itemId) {
    const def = mathItem(content, itemId);
    const item = state.math[itemId];
    const model = mathItem(content, "EQ-MODEL");
    math = {
      id: itemId,
      version: def.version,
      prompt: def.prompt,
      scene: def.scene ?? null,
      quantity: def.quantity,
      groups: def.groups,
      unit: def.unit,
      group: def.group,
      phase: item.phase,
      attemptNo: item.attempts.length + 1,
      clarification: item.phase === "clarify" ? def.clarification ?? null : null,
      representation: item.phase === "represent" || item.phase === "clarify" ? def.representation ?? null : null,
      example: item.phase === "example" ? { prompt: model.prompt, steps: model.steps ?? [], quantity: model.quantity, groups: model.groups, answer: model.answer } : null,
      taughtAnswer: item.outcome === "taught" ? def.answer : null,
      teachingOffered: item.outcome === "pending" && item.attempts.filter((a) => a.correct !== null).length >= content.math.rules.maxSubstantiveAttempts,
      outcome: item.outcome,
    };
  }

  let language: ChildView["language"] = null;
  if (stage === "LANG-EN-WATER" || stage === "LANG-ES-AGUA") {
    const segment = languageSegment(content, stage);
    const seg = state.language[stage];
    const step = segment.steps[seg.stepIndex] ?? null;
    let view: LanguageStepView | null = null;
    if (step) {
      if (step.kind === "listen-read") view = { id: step.id, kind: "listen-read", sentence: step.sentence, instruction: step.instruction };
      else if (step.kind === "pick-supply") {
        view = {
          id: step.id,
          kind: "pick-supply",
          sentence: step.sentence,
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

  let tutor: TutorContext | null = null;
  if (math && math.outcome === "pending") {
    tutor = { taskId: math.id, taskVersion: math.version, language: "de", prompt: math.prompt, allowedHelp: "Erklären und Fragen beantworten, aber die Lösung nicht verraten." };
  } else if (language?.step) {
    const sentence = "sentence" in language.step ? language.step.sentence : language.step.frame;
    tutor = { taskId: `${language.id}/${language.step.id}`, taskVersion: 1, language: language.language, prompt: sentence, allowedHelp: "Wörter erklären (auf Deutsch), Beispiele geben, dann zurück zur Aufgabe." };
  }

  const minutesElapsed = running ? Math.floor((now.getTime() - new Date(running.startedAt).getTime()) / 60000) : 0;
  const def = running ? visitDef(content, running.id) : null;

  return {
    child: state.child,
    revision: state.revision,
    title: settings.missionTitle ?? content.theme.defaultTitle,
    hook: settings.missionHook ?? content.theme.defaultHook,
    base: { name: state.base.name, location, supplies: state.base.supplies },
    pages: state.pages,
    visit: running && def
      ? { id: running.id, title: def.title, startedAt: running.startedAt, stage, stageIndex: running.stageIndex, stageCount: def.stages.length, minutesElapsed, overBudget: minutesElapsed >= content.visitBudgetMinutes.max }
      : null,
    next: { visit: availability.visit, availableAt: availability.availableAt, reason: "reason" in availability ? availability.reason : null },
    nextStep: nextStepText(state, content, stage, now),
    locations: content.locations,
    math,
    language,
    typing,
    reflection: stage === "reflect" ? content.reflection : null,
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
    case "explain": return "Erklären";
    case "LANG-EN-WATER": return "English";
    case "LANG-ES-AGUA": return "Español";
    case "typing": return "Tippen";
    case "log": return "Logbuch";
    case "reflect": return "Fertig";
  }
}

export { SCORED_IDS as SCORED_MATH_ITEM_IDS };
export type { MathItemId };
