// ---------------------------------------------------------------------------
// Family Assistant learning — mission engine (content v5, Visit 6).
//
// Executes a reviewed mission document (`family-learning-mission-spec.ts`):
// a walkable map whose places host steps; steps unlock along their reviewed
// information dependencies (discover a need → gather information → plan →
// request/deliver → see the result); each step kind has one bounded,
// deterministic rule set. Pure and deterministic like the state machine that
// calls it (`applyLearningOp` → op `mission`): state in, state + rows out.
//
// Binding rules (Visit 6 proposal, learning/CONTRACT.md "October 16"):
//  - help is recorded BEFORE it is shown (support rows written in the same
//    transaction as the state that reveals it); recorded help never clears;
//  - the original answer of every attempt is kept verbatim; a repaired or
//    supplied answer is a separate, later attempt (`after-supplied`);
//  - nothing skips to completion: exhausted tries end in supported practice
//    or an explicit unresolved item, never in silent credit;
//  - listening has its own objective: the transcript is support, recorded,
//    never shown before the record exists; reading tasks have no audio;
//  - the typing block is finite and announced; time alone never completes it;
//  - no live inference: language repair is the bounded reviewed matcher
//    below, never semantic tutoring.
// ---------------------------------------------------------------------------

import type { VisitId, LearningContent, TypingCourseLesson } from "./family-learning-content.ts";
import type { MissionDef, MissionStep, MissionProduce, MissionQuestion, MissionTypingBlock, MissionRepairWord, NextInterestDef } from "./family-learning-mission-spec.ts";
import type { EvidenceCategory, MissionState, Records, TypingBurst, TypingComfort, ParentSettings } from "./family-learning-state.ts";
import { alignedLessonMetrics, TYPING_METRIC_VERSION, type AlignedLineMetrics } from "./family-learning-typing-metrics.ts";
import { typingErrors, type TypingError } from "./family-learning-feedback.ts";

// ---------------------------------------------------------------------------
// State (MissionState.missions — additive)
// ---------------------------------------------------------------------------

export type MissionStepStatus = "locked" | "available" | "active" | "done" | "practiced" | "taught" | "unresolved" | "not-needed";
const RESOLVED: readonly MissionStepStatus[] = ["done", "practiced", "taught", "unresolved", "not-needed"];

export type MissionRecallKind = "fresh" | "after-supplied";

export type MissionAttempt = {
  no: number;
  at: string;
  questionId?: string;
  /** Exactly what the child entered or picked (never normalised). */
  raw: string;
  values?: Record<string, number | null>;
  fields?: Record<string, boolean>;
  choice?: string;
  correct: boolean | null;
  evidence: EvidenceCategory;
  support: string[];
  modality: "typed" | "pick" | "word-bank";
  /** Language: what the bounded repair understood, and how. */
  analysis?: ProductionAnalysis;
  recall?: MissionRecallKind;
  /** `practice` = typed after the answer was shown (copying, never independent). */
  kind: "answer" | "practice";
};

export type MissionStepRun = {
  status: "active" | "done" | "practiced" | "taught" | "unresolved";
  openedAt: string;
  finishedAt: string | null;
  attempts: MissionAttempt[];
  /** Every help kind shown on this step, cumulative and never cleared. */
  support: { kind: string; at: string; detail?: string }[];
  /** Listening: how often the recording was played (the task itself, not help). */
  plays: number;
  /** Listening: plays the device reported as actually heard (child voice or browser speech); absent on older runs = 0. */
  heard?: number;
  /** Listening: plays the device reported as failed (no sound confirmed). */
  playFailures?: number;
  /** Per question: resolved and how. */
  questions: Record<string, { status: "open" | "correct" | "given"; evidence: EvidenceCategory | null }>;
  /** Calc/choice/produce phase shown to the child. */
  phase: "answer" | "clarified" | "represented" | "taught" | "repair" | "ask-meaning" | "exhausted" | "finished";
  /** Ambiguous repair: the candidate words the child may choose between. */
  pendingMeaning?: { given: string; options: { word: string; meaningDe: string }[] } | null;
  /** The reviewed repair line shown (help), kept for the view. */
  repairLine?: string | null;
  lexicalOnce?: boolean;
  /** Summary evidence of the step when it finished. */
  outcome: EvidenceCategory | "practiced" | "unresolved" | null;
};

export type MissionDrill = {
  no: number;
  source: "current" | "review" | "focus";
  lessonId: string;
  lines: string[];
  extra?: boolean;
};

export type MissionDrillRecord = {
  no: number;
  lessonId: string;
  source: MissionDrill["source"];
  extra: boolean;
  lineCount: number;
  lines: AlignedLineMetrics[];
  expectedChars: number;
  typedChars: number;
  correctChars: number;
  extraChars: number;
  omittedChars: number;
  substitutedChars: number;
  denominator: number;
  accuracy: number;
  errors: TypingError[];
  /** Client-measured: first keystroke → last commit. */
  seconds: number;
  /** Sum of keystroke gaps ≤ idleGapSeconds (focused typing). */
  activeSeconds: number;
  idleSeconds: number;
  /** At least minTypedShare of the expected characters typed. Accuracy is never a gate. */
  attempted: boolean;
  metricVersion: 2;
  at: string;
};

export type TypingBlockRun = {
  blockId: string;
  startedAt: string;
  plan: { drills: MissionDrill[]; paceCps: number; paceBasis: "observed" | "fallback"; paceSamples: number; estimatedSeconds: number; lessonId: string };
  drills: MissionDrillRecord[];
  /** Partial work saved on pause (never completion). */
  partials: { no: number; typedChars: number; activeSeconds: number; at: string }[];
  completedAt: string | null;
  /** undefined = not asked yet; null = declined. */
  comfort?: TypingComfort | null;
  extra: "not-offered" | "offered" | "taken" | "declined" | "done";
  unavailable?: string | null;
};

export type MissionRun = {
  missionId: string;
  version: number;
  visit: VisitId;
  startedAt: string;
  position: string;
  visited: string[];
  active: string | null;
  steps: Record<string, MissionStepRun>;
  facts: Record<string, { value: string; label: string; source: "answered" | "supported" | "given"; at: string }>;
  /** Target words shown to the child in this mission (word bank, repair line, shown answer) — recall after this is not fresh. */
  shownWords: string[];
  typing: TypingBlockRun | null;
  finishedAt: string | null;
};

export type InterestRecord = {
  id: string;
  visit: VisitId;
  /** `closing` = asked in the normal closing sequence; `entry` = asked at the next entry after an early exit. */
  source: "closing" | "entry";
  kind: "text" | "unsure" | "no-preference" | "declined";
  /** The child's own words, verbatim (text kind only). */
  text: string | null;
  at: string;
};

export class MissionOpError extends Error {
  readonly code: "invalid" | "not-allowed" | "not-available" | "stale";
  constructor(code: "invalid" | "not-allowed" | "not-available" | "stale", message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type MissionAction =
  | { a: "arrive"; place: string }
  | { a: "open"; step: string }
  | { a: "leave" }
  | { a: "story-done"; step: string }
  | { a: "answer-question"; step: string; question: string; value: string }
  | { a: "answer-calc"; step: string; values: Record<string, number | null>; raw: string }
  | { a: "choose"; step: string; option: string }
  | { a: "produce"; step: string; response: string; modality: "typed" | "word-bank" }
  | { a: "meaning"; step: string; word: string }
  | { a: "support"; step: string; kind: "play" | "transcript" | "translation" | "word-bank" | "line-translation"; line?: number }
  /** Listening: what the device reported for the last requested play (`child-voice` / `browser` = sound confirmed; `failed` = not). */
  | { a: "listen-outcome"; step: string; outcome: "child-voice" | "browser" | "failed" }
  | { a: "practice"; step: string; response: string }
  | { a: "later"; step: string }
  | { a: "typing-start" }
  | { a: "typing-drill"; no: number; lines: string[]; seconds: number; activeSeconds: number; idleSeconds: number }
  | { a: "typing-pause"; no: number; lines: string[]; activeSeconds: number }
  | { a: "typing-comfort"; comfort: TypingComfort | null }
  | { a: "typing-extra"; take: boolean }
  | { a: "finish" };

export type MissionEnv = { content: LearningContent; settings: ParentSettings; nowIso: string; newId: () => string; visit: VisitId };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ANSWER_RELEVANT = ["transcript", "translation", "clarification", "representation", "word-bank", "language-repair", "answer-shown", "direct-teaching", "hint"];

export function missionDefFor(content: LearningContent, visit: VisitId): MissionDef | null {
  return content.missions?.find((m) => m.visit === visit) ?? null;
}

export function missionRunOf(state: MissionState, def: MissionDef): MissionRun | null {
  return state.missions?.[def.id] ?? null;
}

export function newMissionRun(def: MissionDef, visit: VisitId, nowIso: string): MissionRun {
  return { missionId: def.id, version: def.version, visit, startedAt: nowIso, position: def.map.start, visited: [def.map.start], active: null, steps: {}, facts: {}, shownWords: [], typing: null, finishedAt: null };
}

function stepDef(def: MissionDef, id: string): MissionStep {
  const s = def.steps.find((x) => x.id === id);
  if (!s) throw new MissionOpError("invalid", `unknown mission step ${id}`);
  return s;
}

function taskId(def: MissionDef, step: MissionStep, question?: string) {
  return `${def.id}/${step.id}${question ? `/${question}` : ""}`;
}

export function normalizeAnswer(value: string): string {
  return value.toLowerCase().normalize("NFC").replace(/[.,!?;:¡¿"'’«»„“]/g, " ").replace(/\s+/g, " ").trim();
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Levenshtein distance with adjacent transposition (Damerau, restricted). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** Status of every step, derived from the run and the reviewed dependencies. */
export function stepStatuses(def: MissionDef, run: MissionRun | null): Record<string, MissionStepStatus> {
  const out: Record<string, MissionStepStatus> = {};
  const resolve = (id: string, seen: Set<string>): MissionStepStatus => {
    if (out[id]) return out[id];
    if (seen.has(id)) return "locked";
    seen.add(id);
    const step = stepDef(def, id);
    const r = run?.steps[id];
    if (r && r.status !== "active") return (out[id] = r.status);
    if (step.when) {
      const ref = resolve(step.when.step, seen);
      const refRun = run?.steps[step.when.step];
      if (!RESOLVED.includes(ref)) return (out[id] = "locked");
      if (refRun?.outcome === "independent") return (out[id] = "not-needed");
    }
    const ready = step.requires.every((req) => RESOLVED.includes(resolve(req, seen)));
    if (r?.status === "active") return (out[id] = ready ? "active" : "locked");
    return (out[id] = ready ? "available" : "locked");
  };
  for (const s of def.steps) resolve(s.id, new Set());
  return out;
}

function isResolved(status: MissionStepStatus) {
  return RESOLVED.includes(status);
}

function emptyStepRun(nowIso: string): MissionStepRun {
  return { status: "active", openedAt: nowIso, finishedAt: null, attempts: [], support: [], plays: 0, questions: {}, phase: "answer", outcome: null };
}

function hasAnswerRelevantSupport(r: MissionStepRun) {
  return r.support.some((s) => ANSWER_RELEVANT.includes(s.kind));
}

function supportKinds(r: MissionStepRun) {
  return [...new Set(r.support.map((s) => s.kind))];
}

// ---------------------------------------------------------------------------
// Language: the bounded, reviewed repair (V6-10)
// ---------------------------------------------------------------------------

export type ProductionAnalysis =
  | { kind: "correct"; completion: "phrase" }
  | { kind: "lexical" }
  | { kind: "noncanonical" }
  | { kind: "spelling"; understood: string; corrections: { given: string; meant: string }[] }
  | { kind: "ambiguous"; given: string; options: { word: string; meaningDe: string }[] }
  | { kind: "distractor"; corrections: { given: string; meant: string }[] }
  | { kind: "unclear" };

function matchesList(norm: string, list: string[]) {
  const n = stripAccents(norm);
  return list.some((entry) => stripAccents(normalizeAnswer(entry)) === n);
}

function containsToken(tokens: string[], list: string[]) {
  const t = tokens.map(stripAccents);
  return list.some((entry) => t.includes(stripAccents(normalizeAnswer(entry))));
}

function baseScore(p: MissionProduce, norm: string): "correct" | "lexical" | "noncanonical" | "distractor" | "unclear" {
  const tokens = norm.split(" ").filter(Boolean);
  if (matchesList(norm, p.accepted)) return "correct";
  if (matchesList(norm, p.lexical)) return "lexical";
  if (containsToken(tokens, p.keywords)) return "noncanonical";
  if (containsToken(tokens, p.distractors)) return "distractor";
  return "unclear";
}

function candidatesFor(token: string, words: MissionRepairWord[]): MissionRepairWord[] {
  const t = stripAccents(token);
  const exact = words.filter((w) => (w.misspellings ?? []).some((m) => stripAccents(normalizeAnswer(m)) === t));
  if (exact.length) return exact;
  if (t.length < 4) return [];
  const scored = words.map((w) => ({ w, d: editDistance(t, stripAccents(w.word)) })).filter(({ w, d }) => d > 0 && d <= (w.word.length >= 7 ? 2 : 1));
  if (!scored.length) return [];
  const best = Math.min(...scored.map((x) => x.d));
  return scored.filter((x) => x.d === best).map((x) => x.w);
}

/**
 * Deterministic analysis of a production against the reviewed rubric. A token that is not a known word of the rubric is
 * compared with the reviewed repair words (explicit misspellings, else a small edit distance); exactly one candidate =
 * understood, two or more = ask, none = unclear. The repaired sentence must itself score as accepted/lexical to count as
 * understood. Never a semantic judgement and never an invented meaning.
 */
export function analyzeProduction(p: MissionProduce, response: string): ProductionAnalysis {
  const norm = normalizeAnswer(response);
  const base = baseScore(p, norm);
  if (base === "correct") return { kind: "correct", completion: "phrase" };
  if (base === "lexical") return { kind: "lexical" };
  const known = new Set([...p.accepted, ...p.lexical, ...p.keywords, ...p.distractors, ...p.wordBank, p.frame].flatMap((x) => normalizeAnswer(x).split(" ")).map(stripAccents).filter((x) => x && x !== "___"));
  const tokens = norm.split(" ").filter(Boolean);
  const corrections: { given: string; meant: string }[] = [];
  for (const token of tokens) {
    if (known.has(stripAccents(token))) continue;
    const c = candidatesFor(token, p.repairWords);
    if (c.length > 1) return { kind: "ambiguous", given: token, options: c.map((w) => ({ word: w.word, meaningDe: w.meaningDe })) };
    if (c.length === 1) corrections.push({ given: token, meant: c[0].word });
  }
  if (corrections.length) {
    const repaired = tokens.map((t) => corrections.find((c) => c.given === t)?.meant ?? t).join(" ");
    const rescored = baseScore(p, repaired);
    if (rescored === "correct" || rescored === "lexical") {
      const accepted = p.accepted.find((a) => stripAccents(normalizeAnswer(a)) === stripAccents(repaired)) ?? p.lexical.find((a) => stripAccents(normalizeAnswer(a)) === stripAccents(repaired)) ?? repaired;
      return { kind: "spelling", understood: accepted, corrections };
    }
    if (rescored === "distractor") return { kind: "distractor", corrections };
    if (rescored === "noncanonical") return { kind: "noncanonical" };
  }
  if (base === "noncanonical") return { kind: "noncanonical" };
  if (base === "distractor") return { kind: "distractor", corrections: [] };
  return { kind: "unclear" };
}

/** The reviewed repair line (V6-10 example copy): what was understood, the spelling explanation, another try. */
export function repairLine(p: MissionProduce, corrections: { given: string; meant: string }[]): string {
  const notes = corrections.map((c) => p.repairWords.find((w) => w.word === c.meant)?.spellingNote).filter((x): x is string => !!x);
  return [`Du möchtest sagen: ${p.sentenceDe}`, ...notes, "Versuch den Satz noch einmal."].join(" ");
}

function targetWords(p: MissionProduce): string[] {
  return p.keywords.map((k) => stripAccents(normalizeAnswer(k)));
}

// ---------------------------------------------------------------------------
// Typing block planning (V6-04/05): finite, announced, calibrated by observed pace
// ---------------------------------------------------------------------------

export function observedPace(state: MissionState, block: MissionTypingBlock): { cps: number; basis: "observed" | "fallback"; samples: number } {
  const bursts = (state.typing.course?.bursts ?? []).filter((b) => b.seconds > 0 && b.typedChars > 0).slice(-4);
  const chars = bursts.reduce((n, b) => n + b.typedChars, 0);
  const secs = bursts.reduce((n, b) => n + b.seconds, 0);
  if (bursts.length && secs > 0) return { cps: Math.max(0.1, chars / secs), basis: "observed", samples: bursts.length };
  return { cps: block.fallbackCharsPerSecond, basis: "fallback", samples: 0 };
}

export function planTypingBlock(state: MissionState, content: LearningContent, block: MissionTypingBlock, focusKeys: string[]): TypingBlockRun["plan"] | null {
  const course = content.typing.course;
  if (!course) return null;
  const index = Math.min(state.typing.course?.lessonIndex ?? 0, course.lessons.length - 1);
  const current = course.lessons[index];
  const review = course.lessons[Math.max(0, index - 1)];
  const focusLine = (() => {
    for (const key of focusKeys) {
      for (const lesson of course.lessons.slice(0, index + 1).reverse()) {
        const line = lesson.lines.find((l) => l.includes(key));
        if (line) return { lesson, lines: lesson.lines.filter((l) => l.includes(key)).concat(current.lines).slice(0, current.lines.length) };
      }
    }
    return null;
  })();
  const sourceLines = (src: "current" | "review" | "focus"): { lesson: TypingCourseLesson; lines: string[] } =>
    src === "review" ? { lesson: review, lines: review.lines } : src === "focus" && focusLine ? focusLine : { lesson: current, lines: current.lines };
  const pace = observedPace(state, block);
  const avgChars = block.pattern.map((p) => sourceLines(p).lines.join("").length).reduce((a, b) => a + b, 0) / block.pattern.length;
  const perDrill = avgChars / pace.cps;
  const n = Math.max(block.minDrills, Math.min(block.maxDrills, Math.round(block.targetActiveSeconds / perDrill)));
  const drills: MissionDrill[] = Array.from({ length: n }, (_, i) => {
    const source = block.pattern[i % block.pattern.length];
    const src = source === "focus" && !focusLine ? "current" : source;
    const { lesson, lines } = sourceLines(src);
    return { no: i + 1, source: src, lessonId: lesson.id, lines: [...lines] };
  });
  const estimatedSeconds = Math.round(drills.reduce((s, d) => s + d.lines.join("").length / pace.cps, 0));
  return { drills, paceCps: Math.round(pace.cps * 1000) / 1000, paceBasis: pace.basis, paceSamples: pace.samples, estimatedSeconds, lessonId: current.id };
}

function extraDrill(plan: TypingBlockRun["plan"]): MissionDrill {
  const first = plan.drills[0];
  return { no: plan.drills.length + 1, source: "current", lessonId: first.lessonId, lines: [...first.lines], extra: true };
}

export function nextDrill(run: TypingBlockRun): MissionDrill | null {
  if (run.unavailable) return null;
  if (!run.completedAt) {
    const done = new Set(run.drills.filter((d) => d.attempted && !d.extra).map((d) => d.no));
    return run.plan.drills.find((d) => !done.has(d.no)) ?? null;
  }
  if (run.extra === "taken") return extraDrill(run.plan);
  return null;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

type Out = { records: Records; result: Record<string, unknown>; finished: boolean };

function support(records: Records, env: MissionEnv, def: MissionDef, step: MissionStep, kind: string, payload: Record<string, unknown>) {
  // The existing support table stores the kind as text; mission kinds are namespaced so earlier readers never misclassify them.
  records.supports.push({ id: env.newId(), visitId: env.visit, taskId: taskId(def, step), kind: `mission_${kind.replace(/-/g, "_")}` as never, payload: { mission: def.id, step: step.id, ...payload }, at: env.nowIso });
}

function finishStep(state: MissionState, run: MissionRun, def: MissionDef, step: MissionStep, r: MissionStepRun, status: MissionStepRun["status"], outcome: MissionStepRun["outcome"], env: MissionEnv) {
  r.status = status;
  r.outcome = outcome;
  r.finishedAt = env.nowIso;
  r.phase = "finished";
  for (const [k, n] of Object.entries(step.supplies ?? {})) state.base.supplies[k] = (state.base.supplies[k] ?? 0) + n;
  // Cross-visit retrieval: a recall that revisits an open practice focus retires it ONLY on a fresh, independent first answer.
  if (step.retrieval?.focus && state.feedback) {
    const f = state.feedback.focus.find((x) => x.id === step.retrieval!.focus);
    if (f && f.status === "open") {
      if (outcome === "independent") {
        f.status = "retired";
        f.retiredAt = env.nowIso;
        f.retiredBy = `${def.id}/${step.id} am ${env.nowIso}: frisch und ohne Hilfe richtig`;
      } else if (r.attempts.some((a) => a.correct === false)) {
        f.reopened += 1;
      }
    }
  }
}

function attemptRow(records: Records, env: MissionEnv, def: MissionDef, step: MissionStep, a: MissionAttempt, language: string, objective = step.objective) {
  records.attempts.push({
    id: env.newId(),
    visitId: env.visit,
    taskId: taskId(def, step, a.questionId),
    taskVersion: step.version,
    objective,
    attemptNo: a.no,
    answer: { mission: def.id, step: step.id, question: a.questionId ?? null, raw: a.raw, values: a.values ?? null, fields: a.fields ?? null, choice: a.choice ?? null, analysis: a.analysis ?? null, recall: a.recall ?? null, kind: a.kind },
    correct: a.correct,
    evidence: a.evidence,
    support: a.support,
    exposureBefore: "shown",
    stimulusLanguage: language,
    responseLanguage: step.produce?.language ?? "de",
    modality: a.modality,
    uncertainty: a.analysis?.kind === "ambiguous" ? "ambiguous-pending-meaning" : a.analysis?.kind === "unclear" ? "unclear" : null,
    teachingMove: null,
    teachingReason: null,
    secondsSinceTeaching: null,
    at: a.at,
  });
}

function requireActive(run: MissionRun, def: MissionDef, stepId: string): { step: MissionStep; r: MissionStepRun } {
  const step = stepDef(def, stepId);
  const r = run.steps[stepId];
  if (run.active !== stepId || !r) throw new MissionOpError("not-allowed", `step ${stepId} is not open`);
  return { step, r };
}

function boundedInt(value: unknown, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
}

export function applyMissionAction(state: MissionState, action: MissionAction, env: MissionEnv): Out {
  const def = missionDefFor(env.content, env.visit);
  if (!def) throw new MissionOpError("not-available", "this visit has no mission");
  state.missions = state.missions ?? {};
  const run = (state.missions[def.id] = state.missions[def.id] ?? newMissionRun(def, env.visit, env.nowIso));
  if (run.finishedAt) throw new MissionOpError("not-allowed", "the mission is finished");
  const records: Records = { attempts: [], exposures: [], supports: [], samples: [] };
  const statuses = () => stepStatuses(def, run);
  let result: Record<string, unknown> = {};
  let finished = false;

  switch (action.a) {
    case "arrive": {
      if (!def.map.places.some((p) => p.id === action.place)) throw new MissionOpError("invalid", "unknown place");
      run.position = action.place;
      if (!run.visited.includes(action.place)) run.visited.push(action.place);
      result = { at: action.place };
      break;
    }
    case "open": {
      const step = stepDef(def, action.step);
      const st = statuses()[step.id];
      if (st !== "available" && st !== "active") throw new MissionOpError("not-allowed", `step ${step.id} is ${st}`);
      if (run.position !== step.place) throw new MissionOpError("not-allowed", `walk to ${step.place} first`);
      if (run.active && run.active !== step.id) throw new MissionOpError("not-allowed", "another step is open");
      run.active = step.id;
      if (!run.steps[step.id]) {
        run.steps[step.id] = emptyStepRun(env.nowIso);
        // Exposure is durable and written first (rule 1): the task is on screen from now on.
        if (!["story", "outcome", "typing-block"].includes(step.kind)) records.exposures.push({ taskId: taskId(def, step), taskVersion: step.version, kind: "shown", source: "mission-open", at: env.nowIso });
      }
      result = { opened: step.id };
      break;
    }
    case "leave": {
      // Back to the map: unfinished work stays saved and open — never completion, never a skip.
      run.active = null;
      result = { left: true };
      break;
    }
    case "story-done": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "story" && step.kind !== "outcome") throw new MissionOpError("invalid", "not a story step");
      if (r.status === "active") finishStep(state, run, def, step, r, "done", "unscored", env);
      result = { done: step.id };
      break;
    }
    case "support": {
      const { step, r } = requireActive(run, def, action.step);
      if (r.status !== "active") throw new MissionOpError("not-allowed", "the step is finished");
      if (action.kind === "play") {
        if (step.kind !== "listen") throw new MissionOpError("invalid", "only listening steps have a recording");
        r.plays += 1;
        // Listening IS the task: a play (or replay) is recorded for the parent but is not answer help.
        support(records, env, def, step, "listen-play", { play: r.plays, language: step.text?.language });
        // The reviewed audio text travels ONLY in the result of a recorded play (for the speech route), never in the view.
        result = { plays: r.plays, script: step.text?.body ?? null, language: step.text?.language ?? null };
        break;
      }
      if (action.kind === "transcript") {
        if (step.kind !== "listen") throw new MissionOpError("invalid", "only listening steps have a transcript");
        if (r.plays < 1) throw new MissionOpError("not-allowed", "listen first; the text is a help after listening");
      } else if (action.kind === "translation") {
        if (step.kind !== "listen" || !step.text?.de) throw new MissionOpError("invalid", "no translation for this step");
        if (r.plays < 1) throw new MissionOpError("not-allowed", "listen first; the translation is a help after listening");
      } else if (action.kind === "word-bank") {
        if (!step.produce) throw new MissionOpError("invalid", "no word help for this step");
        for (const w of step.produce.wordBank.map((x) => stripAccents(normalizeAnswer(x)))) if (!run.shownWords.includes(w)) run.shownWords.push(w);
      } else if (action.kind === "line-translation") {
        const lines = [...step.intro, ...step.done];
        const line = lines[action.line ?? -1];
        if (!line || line.language === "de" || !line.de) throw new MissionOpError("invalid", "no translation for this line");
      }
      const kind = action.kind === "line-translation" ? "line-translation" : action.kind;
      if (!r.support.some((s) => s.kind === kind && s.detail === String(action.line ?? ""))) r.support.push({ kind, at: env.nowIso, detail: String(action.line ?? "") });
      support(records, env, def, step, kind, { line: action.line ?? null });
      result = { support: kind };
      break;
    }
    case "listen-outcome": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "listen") throw new MissionOpError("invalid", "only listening steps report playback");
      if (!["child-voice", "browser", "failed"].includes(action.outcome)) throw new MissionOpError("invalid", "unknown playback outcome");
      const reported = (r.heard ?? 0) + (r.playFailures ?? 0);
      if (reported >= r.plays) throw new MissionOpError("not-allowed", "no requested play is waiting for its outcome");
      if (action.outcome === "failed") r.playFailures = (r.playFailures ?? 0) + 1;
      else r.heard = (r.heard ?? 0) + 1;
      // Device-reported (the server cannot hear): recorded for the parent, never as answer help.
      support(records, env, def, step, "listen-outcome", { outcome: action.outcome, play: reported + 1, reportedBy: "device" });
      result = { heard: r.heard ?? 0, failures: r.playFailures ?? 0 };
      break;
    }
    case "answer-question": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "read" && step.kind !== "listen") throw new MissionOpError("invalid", "not a question step");
      // A listening answer needs a play the device confirmed as heard — or the text, which is recorded help. A failed playback
      // never unlocks answering on its own and never counts as listening.
      if (step.kind === "listen" && (r.heard ?? 0) < 1 && !r.support.some((s) => s.kind === "transcript")) throw new MissionOpError("not-allowed", "listen to the recording first (or open the text, which counts as help)");
      const q: MissionQuestion | undefined = step.questions?.find((x) => x.id === action.question);
      if (!q) throw new MissionOpError("invalid", "unknown question");
      const qs = (r.questions[q.id] = r.questions[q.id] ?? { status: "open", evidence: null });
      if (qs.status !== "open") throw new MissionOpError("not-allowed", "this question is answered");
      const raw = String(action.value ?? "").slice(0, 40);
      if (q.kind === "pick" && !(q.options ?? []).includes(raw)) throw new MissionOpError("invalid", "unknown option");
      const tries = r.attempts.filter((a) => a.questionId === q.id);
      const correct = normalizeAnswer(raw) === normalizeAnswer(q.answer);
      const helped = r.support.some((s) => ["transcript", "translation"].includes(s.kind)) || (step.kind === "listen" && (r.heard ?? 0) < 1);
      const evidence: EvidenceCategory = !correct ? "incorrect" : tries.length === 0 && !helped ? "independent" : "supported";
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, questionId: q.id, raw, correct, evidence, support: [...supportKinds(r), ...(tries.length ? ["retry"] : [])], modality: q.kind === "pick" ? "pick" : "typed", kind: "answer" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, step.text?.language ?? "de");
      if (correct) {
        qs.status = "correct";
        qs.evidence = evidence;
        if (q.fact) run.facts[q.fact.key] = { value: q.answer, label: q.fact.label, source: evidence === "independent" ? "answered" : "supported", at: env.nowIso };
      } else if (tries.length + 1 >= def.rules.maxQuestionAttempts) {
        // Tries used up: the answer is shown (recorded first) so the mission can continue — never credited.
        qs.status = "given";
        qs.evidence = "answer_exposed";
        r.support.push({ kind: "answer-shown", at: env.nowIso, detail: q.id });
        support(records, env, def, step, "answer-shown", { question: q.id });
        records.exposures.push({ taskId: taskId(def, step, q.id), taskVersion: step.version, kind: "answer_revealed", source: "mission-question-exhausted", at: env.nowIso });
        if (q.fact) run.facts[q.fact.key] = { value: q.answer, label: q.fact.label, source: "given", at: env.nowIso };
      }
      const all = (step.questions ?? []).every((x) => r.questions[x.id] && r.questions[x.id].status !== "open");
      if (all) {
        const evs = (step.questions ?? []).map((x) => r.questions[x.id].evidence);
        const outcome: EvidenceCategory = evs.every((e) => e === "independent") ? "independent" : evs.some((e) => e === "answer_exposed") ? "answer_exposed" : "supported";
        finishStep(state, run, def, step, r, evs.some((e) => e === "answer_exposed") ? "taught" : "done", outcome, env);
      }
      result = { correct, question: q.id, status: qs.status };
      break;
    }
    case "answer-calc": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "calc" || !step.calc) throw new MissionOpError("invalid", "not a calculation");
      if (r.status !== "active") throw new MissionOpError("not-allowed", "the step is finished");
      const values: Record<string, number | null> = {};
      const fields: Record<string, boolean> = {};
      for (const f of step.calc.fields) {
        const v = action.values?.[f.key];
        values[f.key] = typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100000 ? v : null;
        fields[f.key] = values[f.key] === f.answer;
      }
      if (Object.values(values).every((v) => v === null)) throw new MissionOpError("invalid", "enter at least one number");
      const correct = Object.values(fields).every(Boolean);
      const prior = r.attempts.filter((a) => a.kind === "answer");
      const evidence: EvidenceCategory = !correct ? "incorrect" : prior.length === 0 && !hasAnswerRelevantSupport(r) ? "independent" : "supported";
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, raw: String(action.raw ?? "").slice(0, 200), values, fields, correct, evidence, support: supportKinds(r), modality: "typed", kind: "answer" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, "de");
      if (correct) {
        finishStep(state, run, def, step, r, "done", evidence, env);
      } else {
        const wrong = prior.length + 1;
        // Bounded retry policy: clarification → representation → teaching (answer revealed). Each is recorded before shown.
        if (wrong >= def.rules.maxCalcAttempts) {
          r.phase = "taught";
          r.support.push({ kind: "direct-teaching", at: env.nowIso });
          support(records, env, def, step, "direct-teaching", {});
          records.exposures.push({ taskId: taskId(def, step), taskVersion: step.version, kind: "answer_revealed", source: "mission-calc-taught", at: env.nowIso });
          finishStep(state, run, def, step, r, "taught", "answer_exposed", env);
          r.phase = "taught";
        } else if (wrong === 1) {
          r.phase = "clarified";
          r.support.push({ kind: "clarification", at: env.nowIso });
          support(records, env, def, step, "clarification", {});
        } else {
          r.phase = "represented";
          r.support.push({ kind: "representation", at: env.nowIso });
          support(records, env, def, step, "representation", {});
        }
      }
      result = { correct, fields };
      break;
    }
    case "choose": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "choice" || !step.choice) throw new MissionOpError("invalid", "not a plan choice");
      if (r.status !== "active") throw new MissionOpError("not-allowed", "the step is finished");
      const option = step.choice.options.find((o) => o.id === action.option);
      if (!option) throw new MissionOpError("invalid", "unknown option");
      const prior = r.attempts.length;
      const correct = option.best;
      const evidence: EvidenceCategory = !correct ? "incorrect" : prior === 0 ? "independent" : "supported";
      const attempt: MissionAttempt = { no: prior + 1, at: env.nowIso, raw: option.label, choice: option.id, correct, evidence, support: [...supportKinds(r), ...(prior ? ["feedback"] : [])], modality: "pick", kind: "answer" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, "de");
      if (correct) finishStep(state, run, def, step, r, "done", evidence, env);
      else if (prior + 1 >= def.rules.maxChoiceAttempts) {
        r.support.push({ kind: "direct-teaching", at: env.nowIso });
        support(records, env, def, step, "direct-teaching", {});
        records.exposures.push({ taskId: taskId(def, step), taskVersion: step.version, kind: "answer_revealed", source: "mission-choice-taught", at: env.nowIso });
        finishStep(state, run, def, step, r, "taught", "answer_exposed", env);
        r.phase = "taught";
      } else r.phase = "clarified";
      result = { correct, valid: option.valid, option: option.id };
      break;
    }
    case "produce": {
      const { step, r } = requireActive(run, def, action.step);
      const p = step.produce;
      if (!p || (step.kind !== "produce" && step.kind !== "recall")) throw new MissionOpError("invalid", "not a language request");
      if (r.status !== "active") throw new MissionOpError("not-allowed", "the step is finished");
      if (r.phase === "exhausted") throw new MissionOpError("not-allowed", "practise with the shown sentence or keep it for later");
      if (r.phase === "ask-meaning") throw new MissionOpError("not-allowed", "choose what you meant first");
      const raw = String(action.response ?? "").replace(/\r/g, "").slice(0, 200);
      if (!raw.trim()) throw new MissionOpError("invalid", "empty response");
      const analysis = analyzeProduction(p, raw);
      const answers = r.attempts.filter((a) => a.kind === "answer");
      const supplied = targetWords(p).some((w) => run.shownWords.includes(w));
      const recall: MissionRecallKind = supplied ? "after-supplied" : "fresh";
      const correct = analysis.kind === "correct" || analysis.kind === "lexical" ? true : analysis.kind === "spelling" || analysis.kind === "distractor" ? false : null;
      const helped = hasAnswerRelevantSupport(r) || supplied || action.modality === "word-bank";
      const evidence: EvidenceCategory = correct === null ? "unscored" : correct === false ? "incorrect" : answers.length === 0 && !helped ? "independent" : "supported";
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, raw, correct, evidence, support: [...supportKinds(r), ...(answers.length ? ["retry"] : []), ...(action.modality === "word-bank" ? ["word-bank"] : [])].filter((x, i, l) => l.indexOf(x) === i), modality: action.modality === "word-bank" ? "word-bank" : "typed", analysis, recall, kind: "answer" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, p.language);
      records.samples.push({ id: env.newId(), visitId: env.visit, taskId: taskId(def, step), kind: "language_response" as const, language: p.language, modality: attempt.modality, text: raw, metrics: { mission: def.id, step: step.id, analysis, recall, evidence }, at: env.nowIso });
      r.repairLine = null;
      if (analysis.kind === "correct" || (analysis.kind === "lexical" && r.lexicalOnce)) {
        finishStep(state, run, def, step, r, "done", evidence, env);
      } else if (analysis.kind === "lexical") {
        r.lexicalOnce = true;
      } else if (analysis.kind === "spelling") {
        // The understood sentence and the spelling note SUPPLY the answer: recorded before shown; the next try is supported practice.
        r.phase = "repair";
        r.repairLine = repairLine(p, analysis.corrections);
        r.support.push({ kind: "language-repair", at: env.nowIso, detail: analysis.corrections.map((c) => `${c.given}→${c.meant}`).join(",") });
        support(records, env, def, step, "language-repair", { corrections: analysis.corrections, understood: analysis.understood, line: r.repairLine });
        for (const c of analysis.corrections) if (!run.shownWords.includes(stripAccents(c.meant))) run.shownWords.push(stripAccents(c.meant));
      } else if (analysis.kind === "ambiguous") {
        r.phase = "ask-meaning";
        r.pendingMeaning = { given: analysis.given, options: analysis.options };
      } else if (analysis.kind === "distractor" && analysis.corrections.length) {
        r.repairLine = null;
      }
      const substantive = r.attempts.filter((a) => a.kind === "answer" && a.correct !== true).length;
      if (r.status === "active" && substantive >= def.rules.maxProduceAttempts && r.phase !== "ask-meaning") {
        // Tries used up: show the reviewed sentence (recorded first). Then supported practice or an explicit unresolved item.
        r.phase = "exhausted";
        r.support.push({ kind: "answer-shown", at: env.nowIso });
        support(records, env, def, step, "answer-shown", { sentence: p.accepted[0] });
        records.exposures.push({ taskId: taskId(def, step), taskVersion: step.version, kind: "answer_revealed", source: "mission-produce-exhausted", at: env.nowIso });
        for (const w of targetWords(p)) if (!run.shownWords.includes(w)) run.shownWords.push(w);
      }
      result = { analysis: analysis.kind, correct, evidence, phase: r.phase };
      break;
    }
    case "meaning": {
      const { step, r } = requireActive(run, def, action.step);
      const p = step.produce;
      if (!p || r.phase !== "ask-meaning" || !r.pendingMeaning) throw new MissionOpError("not-allowed", "nothing to clarify");
      const option = r.pendingMeaning.options.find((o) => o.word === action.word);
      if (!option) throw new MissionOpError("invalid", "unknown meaning");
      const corrections = [{ given: r.pendingMeaning.given, meant: option.word }];
      r.phase = "repair";
      r.pendingMeaning = null;
      r.repairLine = repairLine(p, corrections);
      r.support.push({ kind: "language-repair", at: env.nowIso, detail: `${corrections[0].given}→${option.word} (child chose)` });
      support(records, env, def, step, "language-repair", { corrections, chosenByChild: true, line: r.repairLine });
      if (!run.shownWords.includes(stripAccents(option.word))) run.shownWords.push(stripAccents(option.word));
      result = { meaning: option.word };
      break;
    }
    case "practice": {
      const { step, r } = requireActive(run, def, action.step);
      const p = step.produce;
      if (!p || r.phase !== "exhausted") throw new MissionOpError("not-allowed", "practice comes after the sentence was shown");
      const raw = String(action.response ?? "").replace(/\r/g, "").slice(0, 200);
      const analysis = analyzeProduction(p, raw);
      const ok = analysis.kind === "correct" || analysis.kind === "lexical" || analysis.kind === "spelling";
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, raw, correct: ok, evidence: ok ? "answer_exposed" : "incorrect", support: supportKinds(r), modality: "typed", analysis, recall: "after-supplied", kind: "practice" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, p.language, `${step.objective}-practice`);
      records.samples.push({ id: env.newId(), visitId: env.visit, taskId: taskId(def, step), kind: "language_response" as const, language: p.language, modality: "typed", text: raw, metrics: { mission: def.id, step: step.id, practice: true, analysis }, at: env.nowIso });
      finishStep(state, run, def, step, r, "practiced", "practiced", env);
      result = { practiced: true, matched: ok };
      break;
    }
    case "later": {
      const { step, r } = requireActive(run, def, action.step);
      if (r.phase !== "exhausted") throw new MissionOpError("not-allowed", "keeping it for later is offered when the tries are used up");
      finishStep(state, run, def, step, r, "unresolved", "unresolved", env);
      result = { unresolved: step.id };
      break;
    }
    case "typing-start": {
      const step = def.steps.find((s) => s.kind === "typing-block")!;
      const r = run.steps[step.id];
      if (run.active !== step.id || !r) throw new MissionOpError("not-allowed", "open the typing workshop first");
      if (run.typing) {
        result = { started: false, resumed: true };
        break;
      }
      const focusKeys = (state.feedback?.focus ?? []).filter((f) => f.kind === "typing-key" && f.status === "open").map((f) => f.key);
      const unavailable = !env.settings.keyboardLayout ? "layout-unconfirmed" : state.typing.alignment?.result !== "match" ? "alignment-unchecked" : null;
      const plan = unavailable ? null : planTypingBlock(state, env.content, def.typingBlock, focusKeys);
      run.typing = { blockId: def.typingBlock.id, startedAt: env.nowIso, plan: plan ?? { drills: [], paceCps: 0, paceBasis: "fallback", paceSamples: 0, estimatedSeconds: 0, lessonId: "" }, drills: [], partials: [], completedAt: null, extra: "not-offered", unavailable: plan ? null : unavailable ?? "no-course" };
      if (!plan) {
        // Honest: the block cannot run on this device setup — an explicit unresolved item, never credit.
        finishStep(state, run, def, step, r, "unresolved", "unresolved", env);
      }
      result = { started: !!plan, drills: plan?.drills.length ?? 0, paceBasis: plan?.paceBasis ?? null };
      break;
    }
    case "typing-drill": {
      const step = def.steps.find((s) => s.kind === "typing-block")!;
      const r = run.steps[step.id];
      const block = run.typing;
      if (run.active !== step.id || !r || !block) throw new MissionOpError("not-allowed", "the typing block is not running");
      const drill = nextDrill(block);
      if (!drill || drill.no !== action.no) throw new MissionOpError("stale", `drill ${action.no} is not the next drill`);
      if (!Array.isArray(action.lines) || action.lines.length !== drill.lines.length || action.lines.some((l) => typeof l !== "string" || l.length > 200)) throw new MissionOpError("invalid", "one typed line per drill line");
      const m = alignedLessonMetrics(drill.lines, action.lines);
      const seconds = boundedInt(action.seconds, 3600);
      const activeSeconds = Math.min(seconds, boundedInt(action.activeSeconds, 3600));
      const idleSeconds = Math.min(seconds, boundedInt(action.idleSeconds, 3600));
      const attempted = m.typedChars >= def.typingBlock.minTypedShare * m.expectedChars;
      const rec: MissionDrillRecord = { no: drill.no, lessonId: drill.lessonId, source: drill.source, extra: !!drill.extra, lineCount: drill.lines.length, lines: m.lines, expectedChars: m.expectedChars, typedChars: m.typedChars, correctChars: m.correctChars, extraChars: m.extraChars, omittedChars: m.omittedChars, substitutedChars: m.substitutedChars, denominator: m.denominator, accuracy: m.denominator ? m.correctChars / m.denominator : 0, errors: typingErrors(drill.lines, action.lines), seconds, activeSeconds, idleSeconds, attempted, metricVersion: TYPING_METRIC_VERSION, at: env.nowIso };
      block.drills.push(rec);
      records.samples.push({ id: env.newId(), visitId: env.visit, taskId: `${def.id}/${step.id}/${block.blockId}`, kind: "typing_burst", language: null, modality: "typed", text: action.lines.join("\n"), metrics: { mission: def.id, block: block.blockId, drill: rec.no, extra: rec.extra, lessonId: rec.lessonId, source: rec.source, expectedChars: rec.expectedChars, typedChars: rec.typedChars, correctChars: rec.correctChars, accuracy: rec.accuracy, seconds, activeSeconds, idleSeconds, attempted, metricVersion: 2 }, at: env.nowIso });
      if (drill.extra) block.extra = "done";
      else if (block.plan.drills.every((d) => block.drills.some((x) => x.no === d.no && x.attempted && !x.extra))) {
        block.completedAt = env.nowIso;
      }
      if (block.extra === "done") finishStep(state, run, def, step, r, "done", "unscored", env);
      result = { drill: rec.no, attempted, accuracy: rec.accuracy, completed: !!block.completedAt };
      break;
    }
    case "typing-pause": {
      const block = run.typing;
      if (!block || block.completedAt) {
        result = { saved: false };
        break;
      }
      const lines = Array.isArray(action.lines) ? action.lines.filter((l) => typeof l === "string").map((l) => l.slice(0, 200)) : [];
      const typedChars = lines.join("").length;
      block.partials.push({ no: boundedInt(action.no, 99), typedChars, activeSeconds: boundedInt(action.activeSeconds, 3600), at: env.nowIso });
      if (block.partials.length > 20) block.partials = block.partials.slice(-20);
      result = { saved: true };
      break;
    }
    case "typing-comfort": {
      const step = def.steps.find((s) => s.kind === "typing-block")!;
      const block = run.typing;
      if (!block?.completedAt || block.comfort !== undefined) throw new MissionOpError("not-allowed", "comfort is asked once after the block");
      if (action.comfort !== null && !["easy", "ok", "hard"].includes(action.comfort)) throw new MissionOpError("invalid", "unknown comfort");
      block.comfort = action.comfort;
      block.extra = "offered";
      // The block's full-length drills of the current lesson feed the existing course progression, rated with the ONE comfort
      // answer the child gave for the block; a declined rating adds nothing (no invented comfort, no promotion).
      const course = env.content.typing.course;
      if (course && state.typing.course && action.comfort) {
        const lesson = course.lessons[Math.min(state.typing.course.lessonIndex, course.lessons.length - 1)];
        for (const d of block.drills.filter((x) => x.attempted && !x.extra && x.lessonId === lesson.id)) {
          const burst: TypingBurst = { lessonId: d.lessonId, visit: env.visit, lineCount: d.lineCount, lines: d.lines, expectedChars: d.expectedChars, typedChars: d.typedChars, correctChars: d.correctChars, extraChars: d.extraChars, omittedChars: d.omittedChars, substitutedChars: d.substitutedChars, denominator: d.denominator, accuracy: d.accuracy, comfort: action.comfort, metricVersion: 2, errors: d.errors, blockId: block.blockId, seconds: d.seconds, at: d.at };
          state.typing.course.bursts.push(burst);
        }
        const good = state.typing.course.bursts.filter((b) => b.lessonId === lesson.id && b.accuracy >= course.progression.minAccuracy && b.comfort !== "hard" && (b.lineCount === undefined || b.lineCount >= lesson.lines.length));
        if (good.length >= course.progression.minBursts && state.typing.course.lessonIndex < course.lessons.length - 1 && !state.typing.course.completed.includes(lesson.id)) {
          state.typing.course.completed.push(lesson.id);
          state.typing.course.lessonIndex += 1;
          state.typing.course.decision = { lessonId: lesson.id, action: "advance", reason: `${good.length} bursts ≥ ${Math.round(course.progression.minAccuracy * 100)} % and not hard (typing block ${block.blockId})`, at: env.nowIso };
        }
      }
      records.samples.push({ id: env.newId(), visitId: env.visit, taskId: `${def.id}/${step.id}/${block.blockId}`, kind: "typing_burst", language: null, modality: "typed", text: "", metrics: { mission: def.id, block: block.blockId, summary: true, comfort: action.comfort, ...typingSummary(block) }, at: env.nowIso });
      result = { comfort: action.comfort };
      break;
    }
    case "typing-extra": {
      const step = def.steps.find((s) => s.kind === "typing-block")!;
      const r = run.steps[step.id];
      const block = run.typing;
      if (!block || block.extra !== "offered" || !r) throw new MissionOpError("not-allowed", "no extra drill on offer");
      block.extra = action.take ? "taken" : "declined";
      if (!action.take) finishStep(state, run, def, step, r, "done", "unscored", env);
      result = { extra: block.extra };
      break;
    }
    case "finish": {
      const st = statuses();
      const open = def.steps.filter((s) => (s.required || st[s.id] !== "not-needed") && !isResolved(st[s.id]) && (s.required || st[s.id] !== "locked"));
      // A conditional step that is still locked blocks only while its condition is undecided.
      const blocking = open.filter((s) => s.required || st[s.id] === "available" || st[s.id] === "active");
      if (blocking.length) throw new MissionOpError("not-allowed", `still open: ${blocking.map((s) => s.id).join(", ")}`);
      run.finishedAt = env.nowIso;
      run.active = null;
      finished = true;
      result = { finished: def.id };
      break;
    }
  }
  return { records, result, finished };
}

export function typingSummary(block: TypingBlockRun) {
  const counted = block.drills.filter((d) => d.attempted);
  const sum = (f: (d: MissionDrillRecord) => number) => counted.reduce((n, d) => n + f(d), 0);
  const denominator = sum((d) => d.denominator);
  const wall = block.completedAt ? Math.round((Date.parse(block.completedAt) - Date.parse(block.startedAt)) / 1000) : null;
  return {
    planned: block.plan.drills.length,
    attempted: counted.filter((d) => !d.extra).length,
    extra: counted.some((d) => d.extra),
    paceCps: block.plan.paceCps,
    paceBasis: block.plan.paceBasis,
    estimatedSeconds: block.plan.estimatedSeconds,
    activeSeconds: sum((d) => d.activeSeconds),
    idleSeconds: sum((d) => d.idleSeconds),
    drillSeconds: sum((d) => d.seconds),
    /** Wall time from block start to completion — includes menus, pauses and reading; not focused practice. */
    wallSeconds: wall,
    accuracy: denominator ? sum((d) => d.correctChars) / denominator : null,
    pauses: block.partials.length,
  };
}

// ---------------------------------------------------------------------------
// Interests (V6-11)
// ---------------------------------------------------------------------------

export function recordInterest(state: MissionState, records: Records, input: { kind: InterestRecord["kind"]; text?: string | null }, visit: VisitId, source: InterestRecord["source"], nowIso: string, newId: () => string): InterestRecord {
  if (!["text", "unsure", "no-preference", "declined"].includes(input.kind)) throw new MissionOpError("invalid", "unknown interest answer");
  const text = input.kind === "text" ? String(input.text ?? "").replace(/\r/g, "").slice(0, 300) : null;
  if (input.kind === "text" && !text!.trim()) throw new MissionOpError("invalid", "write a few words, or choose one of the buttons");
  const rec: InterestRecord = { id: newId(), visit, source, kind: input.kind, text, at: nowIso };
  state.interests = [...(state.interests ?? []), rec];
  records.samples.push({ id: rec.id, visitId: visit, taskId: "next-interest", kind: "next_interest" as never, language: "de", modality: "typed", text: text ?? "", metrics: { kind: rec.kind, source }, at: nowIso });
  return rec;
}

/** The visit whose closing interest is still missing (left early / never answered), or null. Only content that asks it counts. */
export function pendingInterest(state: MissionState, content: LearningContent): VisitId | null {
  if (!content.reflection.nextInterest) return null;
  const capable = state.visits.filter((v) => v.id === "v7" || (content.missions ?? []).some((m) => m.visit === v.id));
  const latest = [...capable].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop();
  if (!latest) return null;
  const answered = (state.interests ?? []).some((i) => i.at >= latest.startedAt);
  return answered ? null : latest.id;
}

// ---------------------------------------------------------------------------
// Views (answer keys stripped)
// ---------------------------------------------------------------------------

export type MissionStepView = {
  id: string;
  kind: MissionStep["kind"];
  title: string;
  place: string;
  character: string | null;
  required: boolean;
  status: MissionStepStatus;
};

export type MissionActiveView = {
  id: string;
  kind: MissionStep["kind"];
  title: string;
  character: string | null;
  status: MissionStepRun["status"];
  phase: MissionStepRun["phase"];
  intro: { speaker: string | null; text: string; language: string; translated: string | null }[];
  done: { speaker: string | null; text: string; language: string; translated: string | null }[];
  /** Reading tasks: the text to read (never audio). Listening: the text ONLY after the transcript support was recorded. */
  readText: string | null;
  listen: { language: string; plays: number; heard: number; failures: number; script: string | null; transcriptShown: boolean; translation: string | null; translationShown: boolean } | null;
  questions: { id: string; prompt: string; kind: "pick" | "number"; options: string[] | null; status: "open" | "correct" | "given"; tries: number; hint: string | null; shownAnswer: string | null; lastWrong: string | null }[];
  calc: { prompt: string; fields: { key: string; label: string; correct: boolean | null; last: number | null }[]; clarification: string | null; representation: { text: string; total: number; perGroup: number; unit: string } | null; teach: string | null; tries: number } | null;
  choice: { prompt: string; options: { id: string; label: string }[]; picked: { id: string; feedback: string; best: boolean }[]; teach: string | null } | null;
  produce: { language: string; frame: string; instruction: string; wordBank: string[] | null; feedback: string | null; repairLine: string | null; askMeaning: { given: string; options: { word: string; meaningDe: string }[] } | null; shownSentence: string | null; tries: number; maxTries: number; lastResponse: string | null } | null;
  typing: TypingBlockView | null;
};

export type TypingBlockView = {
  announce: string;
  planned: number;
  completed: number;
  nextDrill: { no: number; lines: string[]; source: MissionDrill["source"]; extra: boolean } | null;
  phase: "not-started" | "drill" | "comfort" | "extra-offer" | "done" | "unavailable";
  unavailable: string | null;
  lessonId: string | null;
  last: { accuracy: number; attempted: boolean } | null;
  idleGapSeconds: number;
  minTypedShare: number;
  /** The reviewed finger guide of the course (hands diagram); never an answer key. */
  guide: { fingers: Record<string, string>; home: { left: string[]; right: string[]; anchors: string[]; thumb: string } } | null;
};

export type MissionView = {
  id: string;
  title: string;
  objective: string;
  theme: MissionDef["theme"];
  places: MissionDef["map"]["places"];
  paths: MissionDef["map"]["paths"];
  characters: MissionDef["characters"];
  position: string;
  steps: MissionStepView[];
  /** Steps that can be started at each place right now. */
  here: string[];
  active: MissionActiveView | null;
  facts: { key: string; label: string; source: string }[];
  world: { id: string; prop: string; place: string; count: number; label: string }[];
  progress: { required: number; resolved: number };
  canFinish: boolean;
  finished: boolean;
  estimatedMinutes: { min: number; max: number };
};

function lineView(step: MissionStep, r: MissionStepRun | undefined, lines: MissionStep["intro"], offset: number) {
  return lines.map((l, i) => ({ speaker: l.speaker, text: l.text, language: l.language, translated: l.language !== "de" && r?.support.some((s) => s.kind === "line-translation" && s.detail === String(i + offset)) ? l.de ?? null : null }));
}

export function typingBlockView(def: MissionDef, run: MissionRun, content?: LearningContent): TypingBlockView {
  const block = run.typing;
  const tb = def.typingBlock;
  const planned = block?.plan.drills.length ?? 0;
  const minutes = block ? Math.max(1, Math.round(block.plan.estimatedSeconds / 60)) : Math.round(tb.targetActiveSeconds / 60);
  const announce = tb.announce.replace("{n}", String(planned || "einige")).replace("{minutes}", String(minutes));
  const phase: TypingBlockView["phase"] = !block ? "not-started" : block.unavailable ? "unavailable" : !block.completedAt ? "drill" : block.comfort === undefined ? "comfort" : block.extra === "offered" ? "extra-offer" : block.extra === "taken" ? "drill" : "done";
  const nd = block ? nextDrill(block) : null;
  const last = block?.drills[block.drills.length - 1] ?? null;
  return { announce, planned, completed: block?.drills.filter((d) => d.attempted && !d.extra).length ?? 0, nextDrill: nd && phase === "drill" ? { no: nd.no, lines: nd.lines, source: nd.source, extra: !!nd.extra } : null, phase, unavailable: block?.unavailable ?? null, lessonId: block?.plan.lessonId || null, last: last ? { accuracy: last.accuracy, attempted: last.attempted } : null, idleGapSeconds: tb.idleGapSeconds, minTypedShare: tb.minTypedShare, guide: content?.typing.course ? { fingers: content.typing.course.fingers, home: content.typing.course.homePosition } : null };
}

function activeView(def: MissionDef, run: MissionRun, step: MissionStep, r: MissionStepRun, content: LearningContent): MissionActiveView {
  const has = (k: string) => r.support.some((s) => s.kind === k);
  const questions = (step.questions ?? []).map((q) => {
    const qs = r.questions[q.id];
    const tries = r.attempts.filter((a) => a.questionId === q.id);
    const last = tries[tries.length - 1];
    return { id: q.id, prompt: q.prompt, kind: q.kind, options: q.options ?? null, status: qs?.status ?? "open", tries: tries.length, hint: qs?.status === "open" && last && last.correct === false ? q.retryHint : null, shownAnswer: qs?.status === "given" ? q.answer : null, lastWrong: last && last.correct === false ? last.raw : null };
  });
  const answers = r.attempts.filter((a) => a.kind === "answer");
  const lastAnswer = answers[answers.length - 1];
  const calc = step.calc
    ? {
        prompt: step.calc.prompt,
        fields: step.calc.fields.map((f) => ({ key: f.key, label: f.label, correct: lastAnswer?.fields ? lastAnswer.fields[f.key] ?? null : null, last: lastAnswer?.values?.[f.key] ?? null })),
        clarification: has("clarification") ? step.calc.clarification : null,
        representation: has("representation") ? step.calc.representation : null,
        teach: has("direct-teaching") ? step.calc.teach : null,
        tries: answers.length,
      }
    : null;
  const choice = step.choice
    ? {
        prompt: step.choice.prompt,
        options: step.choice.options.map((o) => ({ id: o.id, label: o.label })),
        picked: r.attempts.map((a) => step.choice!.options.find((o) => o.id === a.choice)!).filter(Boolean).map((o) => ({ id: o.id, feedback: o.feedback, best: o.best })),
        teach: has("direct-teaching") ? step.choice.teach : null,
      }
    : null;
  let produce: MissionActiveView["produce"] = null;
  if (step.produce) {
    const p = step.produce;
    const a = lastAnswer?.analysis;
    const feedback = r.status !== "active" || !a ? null : a.kind === "lexical" || a.kind === "noncanonical" ? p.feedback.lexical : a.kind === "distractor" ? p.feedback.distractor : a.kind === "unclear" ? p.feedback.unclear : null;
    produce = { language: p.language, frame: p.frame, instruction: p.instruction, wordBank: has("word-bank") ? p.wordBank : null, feedback, repairLine: r.repairLine ?? null, askMeaning: r.phase === "ask-meaning" ? r.pendingMeaning ?? null : null, shownSentence: has("answer-shown") ? p.accepted[0] : null, tries: answers.filter((x) => x.correct !== true).length, maxTries: def.rules.maxProduceAttempts, lastResponse: lastAnswer?.raw ?? null };
  }
  const listen = step.kind === "listen" && step.text
    ? { language: step.text.language, plays: r.plays, heard: r.heard ?? 0, failures: r.playFailures ?? 0, script: has("transcript") ? step.text.body : null, transcriptShown: has("transcript"), translation: has("translation") ? step.text.de ?? null : null, translationShown: has("translation") }
    : null;
  return {
    id: step.id,
    kind: step.kind,
    title: step.title,
    character: step.character,
    status: r.status,
    phase: r.phase,
    intro: lineView(step, r, step.intro, 0),
    done: lineView(step, r, step.done, step.intro.length),
    readText: step.kind === "read" ? step.text?.body ?? null : null,
    listen,
    questions,
    calc,
    choice,
    produce,
    typing: step.kind === "typing-block" ? typingBlockView(def, run, content) : null,
  };
}

export function buildMissionView(state: MissionState, content: LearningContent, visit: VisitId): MissionView | null {
  const def = missionDefFor(content, visit);
  if (!def) return null;
  const run = missionRunOf(state, def) ?? newMissionRun(def, visit, "");
  const st = stepStatuses(def, run);
  const steps = def.steps.map((s) => ({ id: s.id, kind: s.kind, title: s.title, place: s.place, character: s.character, required: s.required, status: st[s.id] }));
  const activeStep = run.active ? def.steps.find((s) => s.id === run.active) : null;
  const active = activeStep && run.steps[activeStep.id] ? activeView(def, run, activeStep, run.steps[activeStep.id], content) : null;
  const shownStatus = (id: string) => ["done", "practiced", "taught", "unresolved"].includes(st[id]);
  const required = def.steps.filter((s) => s.required || (st[s.id] !== "not-needed" && st[s.id] !== "locked"));
  const finishBlocked = def.steps.some((s) => (s.required ? !isResolved(st[s.id]) : st[s.id] === "available" || st[s.id] === "active"));
  return {
    id: def.id,
    title: def.title,
    objective: def.objective,
    theme: def.theme,
    places: def.map.places,
    paths: def.map.paths,
    characters: def.characters,
    position: run.position,
    steps,
    here: steps.filter((s) => s.place === run.position && (s.status === "available" || s.status === "active")).map((s) => s.id),
    active,
    facts: Object.entries(run.facts).map(([key, f]) => ({ key, label: f.label, source: f.source })),
    world: def.world.filter((w) => shownStatus(w.after)).map((w) => ({ id: w.id, prop: w.prop, place: w.place, count: w.count, label: w.label })),
    progress: { required: required.length, resolved: required.filter((s) => isResolved(st[s.id])).length },
    canFinish: !finishBlocked && !run.finishedAt,
    finished: !!run.finishedAt,
    estimatedMinutes: def.estimatedMinutes,
  };
}

// ---------------------------------------------------------------------------
// Reporting (child report, parent review, next-visit planning input)
// ---------------------------------------------------------------------------

export type MissionObjective = { taskId: string; version: number; objective: string; outcome: string; evidence: string; support: string[]; uncertainty: string | null };

const STATUS_DE: Record<string, string> = { done: "geschafft", practiced: "mit Hilfe geübt", taught: "zusammen gelöst", unresolved: "fürs nächste Mal aufgehoben", "not-needed": "nicht nötig", active: "angefangen", available: "noch offen", locked: "noch nicht erreichbar" };

export function missionReport(state: MissionState, content: LearningContent, visit: VisitId) {
  const def = missionDefFor(content, visit);
  if (!def) return null;
  const run = missionRunOf(state, def);
  if (!run) return null;
  const st = stepStatuses(def, run);
  const objectives: MissionObjective[] = [];
  const whatHappened: string[] = [];
  for (const step of def.steps) {
    const r = run.steps[step.id];
    if (!r) continue;
    for (const a of r.attempts) {
      const outcome = a.correct === null ? (a.analysis?.kind === "ambiguous" ? "ambiguous" : "unscored") : a.correct ? "correct" : a.analysis?.kind === "spelling" ? "meaning-understood-spelling-wrong" : "incorrect";
      objectives.push({ taskId: taskId(def, step, a.questionId), version: step.version, objective: a.kind === "practice" ? `${step.objective}-practice` : step.objective, outcome, evidence: a.evidence, support: a.support, uncertainty: a.recall ? `recall: ${a.recall}` : a.analysis?.kind === "spelling" ? `verstanden als „${a.analysis.understood}“` : null });
    }
    const raws = r.attempts.map((a) => `„${a.raw}“${a.correct === true ? " ✓" : a.correct === false ? " ✗" : " ?"}${a.analysis?.kind === "spelling" ? ` (verstanden: ${a.analysis.corrections.map((c) => `${c.given}→${c.meant}`).join(", ")})` : ""}${a.kind === "practice" ? " [nach gezeigter Antwort]" : ""}`);
    whatHappened.push(`${step.id} ${step.title}: ${STATUS_DE[st[step.id]] ?? st[step.id]}${r.outcome ? ` (${r.outcome})` : ""}${raws.length ? ` — Versuche: ${raws.join("; ")}` : ""}${r.support.length ? ` — Hilfe: ${supportKinds(r).join(", ")}` : ""}${step.kind === "listen" ? ` — abgespielt: ${r.plays}×, davon laut Gerät gehört ${r.heard ?? 0}×, ohne Ton ${r.playFailures ?? 0}×` : ""}.`);
  }
  for (const step of def.steps) if (st[step.id] === "not-needed") whatHappened.push(`${step.id} ${step.title}: nicht nötig (die erste Bitte war ohne Hilfe richtig).`);
  const typing = run.typing ? typingSummary(run.typing) : null;
  if (run.typing) {
    whatHappened.push(run.typing.unavailable ? `Tippblock: nicht möglich (${run.typing.unavailable}) — offen, keine Gutschrift.` : `Tippblock: ${typing!.attempted}/${typing!.planned} Übungen${typing!.extra ? " + Extra" : ""}; aktive Tippzeit ${typing!.activeSeconds} s, Pausen zwischen Tasten ${typing!.idleSeconds} s, Gesamtzeit inkl. Lesen/Menüs ${typing!.wallSeconds ?? "—"} s; Genauigkeit ${typing!.accuracy === null ? "—" : Math.round(typing!.accuracy * 100) + " %"}; Tempo-Basis ${typing!.paceBasis} (${typing!.paceCps} Zeichen/s); Selbsteinschätzung ${run.typing.comfort === undefined ? "nicht gefragt" : run.typing.comfort ?? "nicht gesagt"}. Genauigkeit des Texts, keine Aussage über Fingertechnik.`);
  }
  const retrieval = def.steps
    .filter((s) => run.steps[s.id] && ["practiced", "taught", "unresolved"].includes(run.steps[s.id].status) || (run.steps[s.id]?.outcome === "supported" && (s.kind === "produce" || s.kind === "recall" || s.kind === "calc")))
    .map((s) => ({ step: s.id, title: s.title, status: st[s.id], outcome: run.steps[s.id]!.outcome }));
  return { def, run, statuses: st, objectives, whatHappened, typing, retrieval };
}

/** Next-visit planning input (V6-11 + V6-09): the child's own words, open retrieval items and the typing calibration. */
export function planningInput(state: MissionState, content: LearningContent) {
  const missions = (content.missions ?? []).map((m) => missionReport(state, content, m.visit as VisitId)).filter((x): x is NonNullable<ReturnType<typeof missionReport>> => !!x);
  return {
    interests: (state.interests ?? []).map((i) => ({ visit: i.visit, source: i.source, kind: i.kind, text: i.text, at: i.at })),
    pendingInterest: pendingInterest(state, content),
    openFocus: (state.feedback?.focus ?? []).filter((f) => f.status === "open").map((f) => ({ id: f.id, evidence: f.evidence, openedIn: f.openedIn })),
    retrieval: missions.flatMap((m) => m.retrieval.map((r) => ({ mission: m.def.id, ...r }))),
    typing: missions.map((m) => m.typing).filter(Boolean)[0] ?? null,
    note: "Wünsche stehen hier wörtlich, wie das Kind sie gesagt hat; nichts wird daraus geschlossen. Die Tippdauer ist eine Kalibrierung und wird nach echtem Gebrauch überprüft.",
  };
}

export type { NextInterestDef };

/** Child summary lines of a mission visit: one evidence-backed success, one practiced line, the next step, the artifact. */
export function missionVisitSummary(state: MissionState, content: LearningContent, visit: VisitId) {
  const rep = missionReport(state, content, visit);
  if (!rep) return null;
  const { def, run } = rep;
  const ran = (s: MissionStep) => run.steps[s.id];
  const scored = def.steps.filter((s) => ran(s) && !["story", "outcome", "typing-block"].includes(s.kind));
  const independent = scored.find((s) => ran(s)!.outcome === "independent");
  const supportedOk = scored.find((s) => ran(s)!.status === "done" && ran(s)!.outcome === "supported");
  const what = (s: MissionStep) =>
    s.kind === "listen" ? `${s.title}: Du hast ${s.text?.language === "en" ? "auf Englisch" : s.text?.language === "es" ? "auf Spanisch" : ""} zugehört und die Antworten gefunden` : s.kind === "read" ? `${s.title}: Du hast genau gelesen` : s.kind === "calc" ? `${s.title}: richtig gerechnet` : s.kind === "choice" ? `${s.title}: ein Plan, der alle Regeln einhält` : `${s.title}: „${ran(s)!.attempts.filter((a) => a.correct).pop()?.raw ?? ""}“`;
  const success = independent
    ? { text: `${what(independent)} — ohne Hilfe, beim ersten Versuch.`, basis: `${def.id}/${independent.id} independent` }
    : supportedOk
      ? { text: `${what(supportedOk)} — mit Hilfe.`, basis: `${def.id}/${supportedOk.id} supported` }
      : run.finishedAt
        ? { text: "Die Boote fahren zum Forschungsschiff.", basis: `${def.id} finished` }
        : null;
  // The one practiced line, most actionable first: a spelling repair (the child's own words with the reviewed note), then an item
  // kept for later, then a task taught together, then a task right only after help.
  let practiced: { text: string; basis: string } | null = null;
  for (const s of scored) {
    const r = ran(s)!;
    const spelling = r.attempts.find((a) => a.analysis?.kind === "spelling");
    if (spelling && s.produce && spelling.analysis?.kind === "spelling") {
      const note = s.produce.repairWords.find((w) => w.word === (spelling.analysis as { corrections: { meant: string }[] }).corrections[0]?.meant)?.spellingNote;
      practiced = { text: `Geübt: ${note ?? "die Schreibweise auf Spanisch"} Du hattest „${spelling.raw}“ geschrieben.`, basis: `${def.id}/${s.id} spelling repair` };
      break;
    }
  }
  if (!practiced) {
    const rank = (s: MissionStep) => (ran(s)!.status === "unresolved" ? 0 : ran(s)!.status === "taught" || ran(s)!.status === "practiced" ? 1 : ran(s)!.attempts.some((a) => a.correct === false) ? 2 : 9);
    const pick = [...scored].sort((a, b) => rank(a) - rank(b))[0];
    if (pick && rank(pick) < 9) {
      const r = ran(pick)!;
      practiced = { text: r.status === "unresolved" ? `Fürs nächste Mal aufgehoben: ${pick.title}.` : `Geübt: ${pick.title}${r.status === "taught" || r.status === "practiced" ? " — wir haben es zusammen gelöst" : " — beim zweiten Versuch"}.`, basis: `${def.id}/${pick.id} ${r.status}` };
    }
  }
  const langFirst = (o: { step: string }) => (["produce", "recall"].includes(def.steps.find((x) => x.id === o.step)?.kind ?? "") ? 0 : 1);
  const open = [...rep.retrieval].sort((a, b) => langFirst(a) - langFirst(b));
  const next = open.length
    ? { branch: "supported" as const, text: `Nächstes Mal üben wir noch einmal: ${open.slice(0, 2).map((o) => `«${o.title}»`).join(" und ")}.`, basis: `retrieval: ${open.map((o) => o.step).join(", ")}` }
    : { branch: "success" as const, text: "Nächstes Mal: eine neue Mission — dein Wunsch zählt.", basis: "no open retrieval item" };
  // The artifact is the outcome in one line; the individual world changes are listed once, under "In deiner Welt".
  const outcome = def.world.filter((w) => ["done", "practiced", "taught", "unresolved"].includes(rep.statuses[w.after])).pop();
  const artifact = run.finishedAt ? { kind: "mission" as const, text: outcome ? `${outcome.label}.` : `${def.title}: geschafft.` } : null;
  return { success, practiced, next, artifact };
}
