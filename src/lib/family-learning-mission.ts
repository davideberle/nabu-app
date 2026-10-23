// ---------------------------------------------------------------------------
// Family Assistant learning — mission engine (content v5, Visit 6; content v6, Visit 7).
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
//
// Content v6 (Visit 7, 2026-10-23) adds, without changing any earlier rule
// for earlier content:
//  - `solve` steps: one clear question per part, answered on its own; a
//    correct part stays correct; 1st substantive miss → neutral recheck, 2nd →
//    stuck (a verified tutor may offer a diagnostic talk; without one the child
//    is pointed to the hint, never interrogated), 3rd → worked teaching
//    (answer revealed) and a copy that must be right to count as practiced —
//    or "keep for later" (unresolved), never false success;
//  - reviewed hints revealed one level at a time on explicit request, each
//    recorded with its id/type/level and the attempts before it; a hint that
//    shows an answer is answer exposure; help on an earlier part makes later
//    first answers of the same problem `supported` (rule 3, conservative);
//  - empty, non-numeric and unchanged repeated answers are refused before
//    they become attempts (accidental Enter, double tap);
//  - outcome-specific closing lines: success lines only after success
//    (V6-F06 — also fixes the projection of earlier missions);
//  - the practice copy after a shown sentence counts only when it matches;
//    a wrong copy stays open (bounded) and "keep for later" always remains;
//  - `write` steps: one own sentence with the existing mechanical spacing
//    review, at most one correction, original and revision kept apart;
//  - the tutor (Nokt) entry points are recorded, never as help; the tutor
//    itself is unavailable unless the environment says otherwise.
// ---------------------------------------------------------------------------

import type { VisitId, LearningContent, TypingCourseLesson } from "./family-learning-content.ts";
import type { MissionDef, MissionStep, MissionProduce, MissionQuestion, MissionTypingBlock, MissionRepairWord, NextInterestDef } from "./family-learning-mission-spec.ts";
import type { EvidenceCategory, MissionState, Records, TypingBurst, TypingComfort, ParentSettings } from "./family-learning-state.ts";
import { alignedLessonMetrics, TYPING_METRIC_VERSION, type AlignedLineMetrics } from "./family-learning-typing-metrics.ts";
import { typingErrors, type TypingError, feedbackOf, updateSpacingFocus } from "./family-learning-feedback.ts";
import { assessSpacing, flagSpacing, markSpacing, evaluateRevision, type SpacingFlag } from "./family-learning-writing.ts";
import type { MissionPart, MissionHint, MissionLine, MissionDiagram } from "./family-learning-mission-spec.ts";
import { validateTutorOutcome, type TutorDispatch, type TutorOutcomeRecord } from "./family-learning-tutor-outcome.ts";
import type { ReplyOrigin } from "./family-learning-trust.ts";

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
  /** `practice` = typed after the answer was shown (copying, never independent); `hint-check` = the small question inside a hint. */
  kind: "answer" | "practice" | "hint-check";
  /** Content v6: the reviewed hints shown on this part before this attempt, in order. */
  hintsBefore?: string[];
};

/** Content v6: the run of one question of a `solve` step. */
export type MissionPartRun = {
  status: "open" | "correct" | "taught" | "unresolved";
  evidence: EvidenceCategory | null;
  phase: "answer" | "rechecked" | "stuck" | "taught";
  misses: number;
  /** Reviewed hints shown, in order, with the number of main attempts before each. */
  hints: { id: string; type: MissionHint["type"]; level: number; at: string; afterAttempts: number }[];
  /** The child's answer to the small question inside a hint (latest per hint). */
  checks: Record<string, { result: "correct" | "wrong"; raw: string; at: string }>;
  /** What made this part's answer visible before it was given (hint, picture, teaching). */
  exposed: { by: string; at: string }[];
  practiceFails: number;
  /** Planned reflection with the tutor: never asked while the tutor is unavailable (missing evidence, recorded). */
  reflection?: "not-available" | "asked" | null;
  /** Repeated-error tutor offer (N7-04b): shown once, then dismissed or accepted; never starts a microphone. */
  offer?: "shown" | "dismissed" | "accepted" | null;
  /** Earlier help on this problem that makes a first answer here supported (rule 3). */
  inheritedSupport?: string[];
};

/** Content v6: the run of one own sentence. */
export type MissionWriteRun = {
  original: string;
  at: string;
  assessable: boolean;
  flags: SpacingFlag[];
  /** At most one correction is shown (help, recorded before it is shown). */
  correction: { index: number; marked: string } | null;
  revision: { text: string; at: string; outcome: string } | null;
  kept: boolean;
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
  /** Listening: plays for which the device reported the playback completion event (child voice or browser speech) — not proof of audible sound or of listening. */
  completedPlays?: number;
  /** Listening: plays the device reported as failed (no completion event). */
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
  /** Content v6: wrong copies after the shown sentence (practice stays open until it matches or the child keeps it for later). */
  practiceFails?: number;
  /** Content v6: per question of a `solve` step. */
  parts?: Record<string, MissionPartRun>;
  /** Content v6: the own sentence of a `write` step. */
  writing?: MissionWriteRun | null;
  /** Content v6: tutor entry points used on this step (opening the tutor is never help). */
  tutor?: { entry: "manual" | "offer" | "planned"; part: string | null; available: boolean; at: string }[];
  /** Content v6 (N7-06): tutor dispatches recorded before the tutor is asked, and the accepted structured results (immutable). */
  tutorDispatches?: TutorDispatch[];
  tutorOutcomes?: TutorOutcomeRecord[];
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
  kind: "text" | "unsure" | "no-preference" | "declined" | "choice";
  /** The child's own words, verbatim (text kind only); for a choice, the label the child picked. */
  text: string | null;
  /** Content v6 (V7-D13): the offered story direction the child picked — never inferred, only recorded when tapped. */
  choice?: string | null;
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
  /** Listening: what the device reported for the last requested play (`child-voice` / `browser` = playback completion event reported; `failed` = none). */
  | { a: "listen-outcome"; step: string; outcome: "child-voice" | "browser" | "failed" }
  | { a: "practice"; step: string; response: string }
  | { a: "later"; step: string }
  | { a: "typing-start" }
  | { a: "typing-drill"; no: number; lines: string[]; seconds: number; activeSeconds: number; idleSeconds: number }
  | { a: "typing-pause"; no: number; lines: string[]; activeSeconds: number }
  | { a: "typing-comfort"; comfort: TypingComfort | null }
  | { a: "typing-extra"; take: boolean }
  /** Content v6: one question of a `solve` step. */
  | { a: "answer-part"; step: string; part: string; value: string }
  /** Content v6: reveal the next reviewed hint of the current question (recorded before it is shown). */
  | { a: "hint"; step: string; part: string }
  /** Content v6: the child's answer to the small question inside a hint. */
  | { a: "hint-check"; step: string; part: string; hint: string; value: string }
  /** Content v6: the child's own entry after worked teaching (counts only when it matches). */
  | { a: "practice-part"; step: string; part: string; value: string }
  /** Content v6: keep a taught question for later (explicit unresolved item, never credit). */
  | { a: "later-part"; step: string; part: string }
  /** Content v6: one own sentence; `revise` = the one revision after the correction, or keep (`text: null`). */
  | { a: "write"; step: string; text: string }
  | { a: "revise"; step: string; text: string | null }
  /** Content v6: a tutor entry point (opening Nokt is never help; the tutor's availability is the server's). */
  | { a: "tutor-open"; step: string; entry: "manual" | "offer" | "planned"; part?: string | null }
  | { a: "tutor-offer"; step: string; part: string; response: "dismissed" | "accepted" }
  /** Content v6: a character line was played aloud (its own text, never an answer; recorded, not help). */
  | { a: "line-audio"; step: string; line: number; outcome: "child-voice" | "browser" | "failed" }
  /** Content v6 (N7-06): record the tutor context BEFORE the tutor is asked; refused while the tutor is unavailable. */
  | { a: "tutor-dispatch"; step: string; part: string; purpose: "diagnostic" | "reflection"; entry: "manual" | "offer" | "planned"; turnId: string; sessionId: string }
  /** Content v6 (N7-06): the tutor's structured result — accepted only when bound, fresh and verified (origin from the server, never the client). */
  | { a: "tutor-outcome"; step: string; outcome: unknown }
  | { a: "finish" };

export type MissionEnv = {
  content: LearningContent;
  settings: ParentSettings;
  nowIso: string;
  newId: () => string;
  visit: VisitId;
  /** Content v6: whether a verified tutor route is available for this child right now (production: never, CHILD_ASSISTANT_AI_ENABLED = false). */
  tutor?: { available: boolean; child?: string; origin?: ReplyOrigin };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ANSWER_RELEVANT = ["transcript", "translation", "clarification", "representation", "word-bank", "language-repair", "answer-shown", "direct-teaching", "hint"];

/** Content v6: neutral closing lines for non-success outcomes when the reviewed step carries none (also used for earlier missions). */
export const NEUTRAL_DONE_LINES: Record<"practiced" | "practiced-wrong" | "taught" | "unresolved", MissionLine[]> = {
  practiced: [{ speaker: null, text: "Du hast den Satz geübt. Beim nächsten Mal versuchst du ihn ohne Hilfe.", language: "de" }],
  "practiced-wrong": [{ speaker: null, text: "Der Satz stimmt noch nicht ganz. Wir üben ihn beim nächsten Mal noch einmal.", language: "de" }],
  taught: [{ speaker: null, text: "Das haben wir zusammen gelöst. Beim nächsten Mal versuchst du es noch einmal selbst.", language: "de" }],
  unresolved: [{ speaker: null, text: "Das heben wir fürs nächste Mal auf.", language: "de" }],
};

/**
 * The closing lines a finished step may show (V6-F06): success lines only after a correct result; after practice, teaching or an
 * open item the reviewed outcome lines, else neutral lines. A practice copy that did not match is never presented as success —
 * this also covers practiced records written before content v6 (they are read, never rewritten).
 */
export function doneLinesFor(step: MissionStep, r: MissionStepRun | undefined): MissionLine[] {
  if (!r || r.status === "active") return [];
  if (r.status === "done") {
    if (r.outcome === "independent") return step.doneBy?.independent ?? step.done;
    if (r.outcome === "supported") return step.doneBy?.supported ?? step.done;
    return step.done;
  }
  if (r.status === "practiced") {
    const lastPractice = [...r.attempts].reverse().find((a) => a.kind === "practice");
    if (lastPractice && lastPractice.correct !== true) return NEUTRAL_DONE_LINES["practiced-wrong"];
    return step.doneBy?.practiced ?? NEUTRAL_DONE_LINES.practiced;
  }
  if (r.status === "taught") return step.doneBy?.taught ?? NEUTRAL_DONE_LINES.taught;
  return step.doneBy?.unresolved ?? NEUTRAL_DONE_LINES.unresolved;
}

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

/**
 * The reviewed repair line (V6-10 example copy): what was understood, the spelling explanation, another try. Content v6
 * (`nearMiss`, V6-F07): the understood intention is acknowledged first and only ONE specific correction is given per try.
 */
export function repairLine(p: MissionProduce, corrections: { given: string; meant: string }[]): string {
  const notes = corrections.map((c) => p.repairWords.find((w) => w.word === c.meant)?.spellingNote).filter((x): x is string => !!x);
  if (p.nearMiss) return [p.nearMiss.ack, ...notes.slice(0, 1), "Schreib den Satz noch einmal."].join(" ");
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


function requirePart(step: MissionStep, r: MissionStepRun, partId: string): { part: MissionPart; pr: MissionPartRun } {
  if (step.kind !== "solve" || !step.solve) throw new MissionOpError("invalid", "not a problem with questions");
  if (r.status !== "active") throw new MissionOpError("not-allowed", "the step is finished");
  const parts = step.solve.parts;
  const index = parts.findIndex((x) => x.id === partId);
  if (index < 0) throw new MissionOpError("invalid", "unknown question");
  r.parts = r.parts ?? {};
  // One question at a time, in the reviewed order: a later question opens only after the earlier one is resolved.
  const current = parts.find((x) => !r.parts![x.id] || r.parts![x.id].status === "open");
  if (!current || current.id !== partId) throw new MissionOpError("not-allowed", current ? `answer question ${current.id} first` : "every question is answered");
  const pr = (r.parts[partId] = r.parts[partId] ?? emptyPartRun(r, step, index));
  return { part: parts[index], pr };
}

function emptyPartRun(r: MissionStepRun, step: MissionStep, index: number): MissionPartRun {
  // Rule 3 (conservative, cumulative): answer-relevant help on an earlier question of the same problem makes a first answer here supported.
  const earlier = (step.solve?.parts ?? []).slice(0, index).map((x) => r.parts?.[x.id]).filter((x): x is MissionPartRun => !!x);
  const inherited = [...new Set(earlier.flatMap((x) => [...x.hints.map((h) => `earlier-hint:${h.id}`), ...(x.phase === "taught" ? ["earlier-teaching"] : [])]))];
  return { status: "open", evidence: null, phase: "answer", misses: 0, hints: [], checks: {}, exposed: [], practiceFails: 0, reflection: null, offer: null, inheritedSupport: inherited };
}

function parseWhole(value: unknown): number {
  const raw = String(value ?? "").trim();
  // Accidental/incomplete input never becomes an attempt (V7-D05): only a whole number is an answer.
  if (!/^\d{1,4}$/.test(raw)) throw new MissionOpError("invalid", "enter a whole number");
  return Number(raw);
}

function partEvidence(pr: MissionPartRun, priorMains: number, correct: boolean): EvidenceCategory {
  if (!correct) return "incorrect";
  if (pr.exposed.length) return "answer_exposed";
  if (priorMains === 0 && pr.hints.length === 0 && !(pr.inheritedSupport ?? []).length) return "independent";
  return "supported";
}

function partSupport(pr: MissionPartRun, priorMains: number): string[] {
  return [...pr.hints.map((h) => `hint:${h.id}`), ...Object.entries(pr.checks).filter(([, c]) => c.result === "wrong").map(([id]) => `representation:${id}`), ...pr.exposed.map((e) => `exposed:${e.by}`), ...(pr.inheritedSupport ?? []), ...(priorMains ? ["retry"] : [])].filter((x, i, l) => l.indexOf(x) === i);
}

function exposePart(records: Records, env: MissionEnv, def: MissionDef, step: MissionStep, r: MissionStepRun, target: string, by: string) {
  r.parts = r.parts ?? {};
  const index = (step.solve?.parts ?? []).findIndex((x) => x.id === target);
  if (index < 0) return;
  const pr = (r.parts[target] = r.parts[target] ?? emptyPartRun(r, step, index));
  if (pr.status !== "open") return; // an answer given before the exposure keeps its evidence
  pr.exposed.push({ by, at: env.nowIso });
  records.exposures.push({ taskId: taskId(def, step, target), taskVersion: step.version, kind: "answer_revealed", source: `mission-${by.split(":")[0]}`, at: env.nowIso });
}

/** Exposure is durable and written first (rule 1): the next question is `shown` the moment it appears, one at a time. */
function revealNextPart(records: Records, env: MissionEnv, def: MissionDef, step: MissionStep, r: MissionStepRun) {
  const parts = step.solve?.parts ?? [];
  r.parts = r.parts ?? {};
  const index = parts.findIndex((x) => !r.parts![x.id] || r.parts![x.id].status === "open");
  if (index < 0 || r.parts[parts[index].id]) return;
  r.parts[parts[index].id] = emptyPartRun(r, step, index);
  records.exposures.push({ taskId: taskId(def, step, parts[index].id), taskVersion: step.version, kind: "shown", source: "mission-part-shown", at: env.nowIso });
}

function finishSolveIfDone(state: MissionState, run: MissionRun, def: MissionDef, step: MissionStep, r: MissionStepRun, env: MissionEnv, records?: Records) {
  const parts = step.solve?.parts ?? [];
  if (records) revealNextPart(records, env, def, step, r);
  const runs = parts.map((x) => r.parts?.[x.id]);
  if (runs.some((x) => !x || x.status === "open")) return;
  const evs = runs.map((x) => x!.evidence);
  const status: MissionStepRun["status"] = runs.some((x) => x!.status === "unresolved") ? "unresolved" : runs.some((x) => x!.status === "taught") ? "taught" : "done";
  const outcome: MissionStepRun["outcome"] = status === "unresolved" ? "unresolved" : evs.every((e) => e === "independent") ? "independent" : evs.some((e) => e === "answer_exposed") ? "answer_exposed" : "supported";
  finishStep(state, run, def, step, r, status, outcome, env);
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
        if (step.kind === "solve") revealNextPart(records, env, def, step, run.steps[step.id]);
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
      const reported = (r.completedPlays ?? 0) + (r.playFailures ?? 0);
      if (reported >= r.plays) throw new MissionOpError("not-allowed", "no requested play is waiting for its outcome");
      if (action.outcome === "failed") r.playFailures = (r.playFailures ?? 0) + 1;
      else r.completedPlays = (r.completedPlays ?? 0) + 1;
      // Device-reported (the server cannot hear): recorded for the parent, never as answer help.
      support(records, env, def, step, "listen-outcome", { outcome: action.outcome, play: reported + 1, reportedBy: "device" });
      result = { completedPlays: r.completedPlays ?? 0, failures: r.playFailures ?? 0 };
      break;
    }
    case "answer-question": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "read" && step.kind !== "listen") throw new MissionOpError("invalid", "not a question step");
      // A listening answer needs a play with a reported completion event — or the text, which is recorded help. A failed playback
      // never unlocks answering on its own and never counts as listening.
      if (step.kind === "listen" && (r.completedPlays ?? 0) < 1 && !r.support.some((s) => s.kind === "transcript")) throw new MissionOpError("not-allowed", "listen to the recording first (or open the text, which counts as help)");
      const q: MissionQuestion | undefined = step.questions?.find((x) => x.id === action.question);
      if (!q) throw new MissionOpError("invalid", "unknown question");
      const qs = (r.questions[q.id] = r.questions[q.id] ?? { status: "open", evidence: null });
      if (qs.status !== "open") throw new MissionOpError("not-allowed", "this question is answered");
      const raw = String(action.value ?? "").slice(0, 40);
      if (q.kind === "pick" && !(q.options ?? []).includes(raw)) throw new MissionOpError("invalid", "unknown option");
      const tries = r.attempts.filter((a) => a.questionId === q.id);
      const correct = normalizeAnswer(raw) === normalizeAnswer(q.answer);
      const helped = r.support.some((s) => ["transcript", "translation"].includes(s.kind)) || (step.kind === "listen" && (r.completedPlays ?? 0) < 1);
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
        support(records, env, def, step, "language-repair", { corrections: analysis.corrections, understood: analysis.understood, line: r.repairLine, shown: p.nearMiss ? analysis.corrections.slice(0, 1).map((c) => c.meant) : analysis.corrections.map((c) => c.meant) });
        // The words whose correct spelling was SHOWN are supplied from now on (content v6 near-miss: only the one correction shown).
        for (const c of p.nearMiss ? analysis.corrections.slice(0, 1) : analysis.corrections) if (!run.shownWords.includes(stripAccents(c.meant))) run.shownWords.push(stripAccents(c.meant));
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
      if (!raw.trim()) throw new MissionOpError("invalid", "empty response");
      const maxPractice = def.rules.maxPracticeAttempts ?? 2;
      if ((r.practiceFails ?? 0) >= maxPractice) throw new MissionOpError("not-allowed", "keep the sentence for later");
      const analysis = analyzeProduction(p, raw);
      // V6-F06: the copy must match the shown sentence. A spelling near miss or anything else is NOT practiced (the Visit 6
      // record "Necesitamos ue" was finished as practiced regardless of this check — that transition is repaired here).
      const ok = analysis.kind === "correct" || analysis.kind === "lexical";
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, raw, correct: ok, evidence: ok ? "answer_exposed" : "incorrect", support: supportKinds(r), modality: "typed", analysis, recall: "after-supplied", kind: "practice" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, p.language, `${step.objective}-practice`);
      records.samples.push({ id: env.newId(), visitId: env.visit, taskId: taskId(def, step), kind: "language_response" as const, language: p.language, modality: "typed", text: raw, metrics: { mission: def.id, step: step.id, practice: true, analysis }, at: env.nowIso });
      if (ok) finishStep(state, run, def, step, r, "practiced", "practiced", env);
      else r.practiceFails = (r.practiceFails ?? 0) + 1;
      result = { practiced: ok, matched: ok, practiceLeft: ok ? 0 : Math.max(0, maxPractice - (r.practiceFails ?? 0)) };
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

    case "answer-part": {
      const { step, r } = requireActive(run, def, action.step);
      const { part, pr } = requirePart(step, r, action.part);
      if (pr.status !== "open" || pr.phase === "taught") throw new MissionOpError("not-allowed", pr.phase === "taught" ? "type the answer from the worked solution" : "this question is answered");
      const value = parseWhole(action.value);
      const raw = String(action.value ?? "").trim().slice(0, 12);
      const mains = r.attempts.filter((a) => a.questionId === part.id && a.kind === "answer");
      const last = mains[mains.length - 1];
      // Accidental input recovers instead of consuming a teaching attempt (V7-D05): an unchanged repeat of the last wrong answer is refused.
      if (last && last.correct === false && last.values?.[part.id] === value) throw new MissionOpError("invalid", "same answer as before — look at the question again");
      const correct = value === part.answer;
      const evidence = partEvidence(pr, mains.length, correct);
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, questionId: part.id, raw, values: { [part.id]: value }, correct, evidence, support: partSupport(pr, mains.length), modality: "typed", kind: "answer", hintsBefore: pr.hints.map((h) => h.id) };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, "de");
      if (correct) {
        pr.status = "correct";
        pr.evidence = evidence;
        if (part.reflect && !env.tutor?.available) {
          // Planned reflection (N7-04c) needs the verified tutor. Without it the explanation is missing evidence — recorded, never replaced by written questioning.
          pr.reflection = "not-available";
          support(records, env, def, step, "tutor-unavailable", { part: part.id, entry: "planned", help: false });
        }
      } else {
        pr.misses += 1;
        const max = def.rules.maxPartAttempts ?? 3;
        if (pr.misses >= max) {
          pr.phase = "taught";
          pr.exposed.push({ by: "teaching", at: env.nowIso });
          r.support.push({ kind: "direct-teaching", at: env.nowIso, detail: part.id });
          support(records, env, def, step, "direct-teaching", { part: part.id });
          records.exposures.push({ taskId: taskId(def, step, part.id), taskVersion: step.version, kind: "answer_revealed", source: "mission-part-taught", at: env.nowIso });
        } else if (pr.misses === 1) {
          pr.phase = "rechecked";
        } else {
          pr.phase = "stuck";
          if (env.tutor?.available) pr.offer = pr.offer ?? "shown";
          else support(records, env, def, step, "tutor-unavailable", { part: part.id, entry: "offer", help: false });
        }
      }
      finishSolveIfDone(state, run, def, step, r, env, records);
      result = { correct, part: part.id, status: pr.status, phase: pr.phase };
      break;
    }
    case "hint": {
      const { step, r } = requireActive(run, def, action.step);
      const { part, pr } = requirePart(step, r, action.part);
      if (pr.status !== "open") throw new MissionOpError("not-allowed", "this question is answered");
      const mains = r.attempts.filter((a) => a.questionId === part.id && a.kind === "answer");
      if (part.hintsAfterFirstAttempt && mains.length === 0) throw new MissionOpError("not-allowed", "try the question first — the hint comes after your first answer");
      const next = part.hints[pr.hints.length];
      if (!next) throw new MissionOpError("not-allowed", "no further hint");
      // N7-01: the exact hint, its type/level and its place among the attempts are recorded BEFORE it is shown.
      pr.hints.push({ id: next.id, type: next.type, level: next.level, at: env.nowIso, afterAttempts: mains.length });
      r.support.push({ kind: "hint", at: env.nowIso, detail: `${part.id}:${next.id}` });
      support(records, env, def, step, "hint", { part: part.id, hint: next.id, type: next.type, level: next.level, afterAttempts: mains.length, exposes: next.exposes ?? [] });
      for (const target of next.exposes ?? []) exposePart(records, env, def, step, r, target, `hint:${next.id}`);
      result = { hint: next.id, level: next.level };
      break;
    }
    case "hint-check": {
      const { step, r } = requireActive(run, def, action.step);
      const { part, pr } = requirePart(step, r, action.part);
      const hint = part.hints.find((h) => h.id === action.hint);
      if (!hint || !hint.check || !pr.hints.some((h) => h.id === hint.id)) throw new MissionOpError("not-allowed", "open this hint first");
      if (pr.status !== "open") throw new MissionOpError("not-allowed", "this question is answered");
      const raw = String(action.value ?? "").trim().slice(0, 40);
      if (!raw) throw new MissionOpError("invalid", "empty response");
      if (hint.check.kind === "number") parseWhole(raw);
      if (hint.check.kind === "pick" && !(hint.check.options ?? []).includes(raw)) throw new MissionOpError("invalid", "unknown option");
      const correct = normalizeAnswer(raw) === normalizeAnswer(hint.check.answer);
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, questionId: `${part.id}/${hint.id}`, raw, correct, evidence: correct ? "supported" : "incorrect", support: ["hint"], modality: hint.check.kind === "pick" ? "pick" : "typed", kind: "hint-check", hintsBefore: pr.hints.map((h) => h.id) };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, "de", `${step.objective}-hint-check`);
      pr.checks[hint.id] = { result: correct ? "correct" : "wrong", raw, at: env.nowIso };
      if (!correct && hint.check.representation) {
        // A different representation after a wrong check: recorded help before it is shown.
        r.support.push({ kind: "representation", at: env.nowIso, detail: `${part.id}:${hint.id}` });
        support(records, env, def, step, "representation", { part: part.id, hint: hint.id });
      }
      if (!correct) for (const target of hint.check.exposesOnWrong ?? []) exposePart(records, env, def, step, r, target, `hint-check:${hint.id}`);
      result = { correct, hint: hint.id };
      break;
    }
    case "practice-part": {
      const { step, r } = requireActive(run, def, action.step);
      const { part, pr } = requirePart(step, r, action.part);
      if (pr.status !== "open" || pr.phase !== "taught") throw new MissionOpError("not-allowed", "practice comes after the worked solution");
      const max = def.rules.maxPracticeAttempts ?? 2;
      if (pr.practiceFails >= max) throw new MissionOpError("not-allowed", "keep it for later");
      const value = parseWhole(action.value);
      const raw = String(action.value ?? "").trim().slice(0, 12);
      const correct = value === part.answer;
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, questionId: part.id, raw, values: { [part.id]: value }, correct, evidence: correct ? "answer_exposed" : "incorrect", support: partSupport(pr, 1), modality: "typed", kind: "practice", hintsBefore: pr.hints.map((h) => h.id) };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, "de", `${step.objective}-practice`);
      if (correct) {
        pr.status = "taught";
        pr.evidence = "answer_exposed";
      } else pr.practiceFails += 1;
      finishSolveIfDone(state, run, def, step, r, env, records);
      result = { correct, part: part.id, status: pr.status, practiceLeft: correct ? 0 : Math.max(0, max - pr.practiceFails) };
      break;
    }
    case "later-part": {
      const { step, r } = requireActive(run, def, action.step);
      const { part, pr } = requirePart(step, r, action.part);
      if (pr.status !== "open" || pr.phase !== "taught") throw new MissionOpError("not-allowed", "keeping it for later is offered after the worked solution");
      pr.status = "unresolved";
      pr.evidence = "answer_exposed";
      finishSolveIfDone(state, run, def, step, r, env, records);
      result = { part: part.id, status: pr.status };
      break;
    }
    case "write": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "write" || !step.write) throw new MissionOpError("invalid", "not a writing step");
      if (r.status !== "active" || r.writing) throw new MissionOpError("not-allowed", "the sentence is written");
      const text = String(action.text ?? "").replace(/\r/g, "").replace(/\n+/g, " ").slice(0, 300);
      if (!text.trim() || !/\p{L}/u.test(text)) throw new MissionOpError("invalid", "write a sentence");
      const joins = env.content.writing?.spacing.joins ?? [];
      const assessment = assessSpacing(text, joins);
      const flags = flagSpacing(text, joins);
      // At most ONE useful correction (D-W1): the first flagged boundary, marked in the child's own sentence. Help, recorded first.
      const first = flags[0] ?? null;
      const correction = first ? { index: first.index, marked: markSpacing(text, [first]) } : null;
      r.writing = { original: text, at: env.nowIso, assessable: assessment.assessable, flags, correction, revision: null, kept: false };
      const outcome = !assessment.assessable ? "unassessable" : flags.length ? "flagged" : "clean";
      const evidence: EvidenceCategory = !assessment.assessable ? "unscored" : flags.length ? "incorrect" : "independent";
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, raw: text, correct: !assessment.assessable ? null : flags.length === 0, evidence, support: [], modality: "typed", kind: "answer" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, "de");
      records.samples.push({ id: env.newId(), visitId: env.visit, taskId: taskId(def, step), kind: "writing_transfer" as const, language: "de", modality: "typed", text, metrics: { mission: def.id, step: step.id, assessed: assessment.assessed, correct: assessment.correct, flagged: flags.length, rules: flags.map((f) => f.rule), outcome, meaningJudged: false, spellingJudged: false }, at: env.nowIso });
      state.feedback = updateSpacingFocus(feedbackOf(state), { outcome, modality: "typed", helpExposed: false, flagged: flags.length, text, at: env.nowIso, visit: env.visit, lesson: `mission:${def.id}/${step.id}` });
      if (correction) {
        r.support.push({ kind: "spacing-correction", at: env.nowIso, detail: String(correction.index) });
        support(records, env, def, step, "spacing-correction", { index: correction.index, rule: first!.rule });
      } else finishStep(state, run, def, step, r, "done", evidence, env);
      result = { outcome, flags: flags.length, correction: !!correction };
      break;
    }
    case "revise": {
      const { step, r } = requireActive(run, def, action.step);
      if (step.kind !== "write" || !r.writing || !r.writing.correction || r.status !== "active") throw new MissionOpError("not-allowed", "nothing to revise");
      if (action.text === null) {
        r.writing.kept = true;
        finishStep(state, run, def, step, r, "done", r.attempts[0]?.evidence ?? "unscored", env);
        result = { kept: true };
        break;
      }
      const text = String(action.text ?? "").replace(/\r/g, "").replace(/\n+/g, " ").slice(0, 300);
      if (!text.trim()) throw new MissionOpError("invalid", "write the sentence or keep it");
      const ev = evaluateRevision(r.writing.original, text, r.writing.flags.slice(0, 1));
      r.writing.revision = { text, at: env.nowIso, outcome: ev.outcome };
      // The revision is a separate, supported record; the original stays exactly as typed.
      const attempt: MissionAttempt = { no: r.attempts.length + 1, at: env.nowIso, raw: text, correct: ev.outcome === "revised" ? true : ev.outcome === "unchanged" ? false : null, evidence: ev.outcome === "revised" ? "supported" : ev.outcome === "unchanged" ? "incorrect" : "unscored", support: ["spacing-correction"], modality: "typed", kind: "practice" };
      r.attempts.push(attempt);
      attemptRow(records, env, def, step, attempt, "de", `${step.objective}-revision`);
      records.samples.push({ id: env.newId(), visitId: env.visit, taskId: taskId(def, step), kind: "writing_retry" as const, language: "de", modality: "typed", text, metrics: { mission: def.id, step: step.id, original: r.writing.original, outcome: ev.outcome, resolved: ev.resolved, total: ev.total, meaningJudged: false }, at: env.nowIso });
      finishStep(state, run, def, step, r, "done", r.attempts[0]?.evidence ?? "unscored", env);
      result = { revision: ev.outcome };
      break;
    }
    case "tutor-open": {
      const { step, r } = requireActive(run, def, action.step);
      const available = !!env.tutor?.available;
      const partId = action.part ?? null;
      if (partId && !(step.solve?.parts ?? []).some((x) => x.id === partId)) throw new MissionOpError("invalid", "unknown question");
      if (!["manual", "offer", "planned"].includes(action.entry)) throw new MissionOpError("invalid", "unknown entry");
      (r.tutor ??= []).push({ entry: action.entry, part: partId, available, at: env.nowIso });
      if (r.tutor.length > 30) r.tutor = r.tutor.slice(-30);
      // N7-04: opening Nokt is recorded with its entry point — never as a hint, never as help, never a microphone start.
      support(records, env, def, step, "tutor-open", { entry: action.entry, part: partId, available, help: false });
      result = { available };
      break;
    }
    case "tutor-offer": {
      const { step, r } = requireActive(run, def, action.step);
      const { pr } = requirePart(step, r, action.part);
      if (pr.offer !== "shown") throw new MissionOpError("not-allowed", "no offer is waiting");
      if (action.response !== "dismissed" && action.response !== "accepted") throw new MissionOpError("invalid", "unknown response");
      pr.offer = action.response;
      support(records, env, def, step, "tutor-offer", { part: action.part, response: action.response, help: false });
      result = { offer: pr.offer };
      break;
    }
    case "line-audio": {
      const { step, r } = requireActive(run, def, action.step);
      const lines = [...step.intro, ...doneLinesFor(step, r)];
      if (!lines[action.line]) throw new MissionOpError("invalid", "unknown line");
      if (!["child-voice", "browser", "failed"].includes(action.outcome)) throw new MissionOpError("invalid", "unknown playback outcome");
      // A character's own line read aloud: no answer content, not help; the device-reported outcome is kept for the audio review.
      support(records, env, def, step, "line-audio", { line: action.line, language: lines[action.line].language, outcome: action.outcome, reportedBy: "device", help: false });
      result = { line: action.line, outcome: action.outcome };
      break;
    }
    case "tutor-dispatch": {
      if (!env.tutor?.available) throw new MissionOpError("not-available", "the tutor is not available");
      const { step, r } = requireActive(run, def, action.step);
      const part = step.solve?.parts.find((x) => x.id === action.part);
      if (!part || !r.parts?.[part.id]) throw new MissionOpError("invalid", "unknown question");
      if (!["diagnostic", "reflection"].includes(action.purpose) || !["manual", "offer", "planned"].includes(action.entry)) throw new MissionOpError("invalid", "unknown purpose or entry");
      if (typeof action.turnId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(action.turnId) || typeof action.sessionId !== "string" || !action.sessionId) throw new MissionOpError("invalid", "turn and session ids required");
      r.tutorDispatches = r.tutorDispatches ?? [];
      if (r.tutorDispatches.some((d) => d.turnId === action.turnId)) throw new MissionOpError("not-allowed", "this tutor turn exists");
      // The revision a result must bind to: the number of recorded attempts on this step (a new answer makes older results stale).
      const dispatch: TutorDispatch = { turnId: action.turnId, child: env.tutor.child ?? "", missionId: def.id, visit: env.visit, step: step.id, part: part.id, taskVersion: step.version, sessionId: action.sessionId, revision: r.attempts.length, purpose: action.purpose, entry: action.entry, at: env.nowIso, status: "pending" };
      r.tutorDispatches.push(dispatch);
      if (r.tutorDispatches.length > 20) r.tutorDispatches = r.tutorDispatches.slice(-20);
      support(records, env, def, step, "tutor-dispatch", { part: part.id, purpose: action.purpose, entry: action.entry, turnId: action.turnId, help: false });
      result = { dispatch };
      break;
    }
    case "tutor-outcome": {
      if (!env.tutor?.available) throw new MissionOpError("not-available", "the tutor is not available");
      const { step, r } = requireActive(run, def, action.step);
      const claimTurn = typeof action.outcome === "object" && action.outcome !== null ? (action.outcome as { turnId?: unknown }).turnId : null;
      const dispatch = (r.tutorDispatches ?? []).find((d) => d.turnId === claimTurn);
      const pr = dispatch ? r.parts?.[dispatch.part] : undefined;
      const question = pr && dispatch
        ? { status: pr.status, attemptNos: r.attempts.filter((a) => a.questionId === dispatch.part).map((a) => a.no), helped: pr.hints.length > 0 || (pr.inheritedSupport ?? []).length > 0 || pr.phase === "taught" || r.attempts.some((a) => a.questionId === dispatch.part && a.kind !== "answer"), answerExposed: pr.exposed.length > 0 }
        : null;
      const verdict = validateTutorOutcome(action.outcome, { child: env.tutor.child ?? "", origin: env.tutor.origin ?? "missing", nowIso: env.nowIso, dispatch, question, currentRevision: r.attempts.length });
      if (!verdict.ok) throw new MissionOpError(verdict.reason === "unknown-or-consumed" ? "stale" : "invalid", `tutor result refused: ${verdict.reason}`);
      dispatch!.status = "consumed";
      (r.tutorOutcomes ??= []).push(verdict.record);
      if (verdict.record.support.kind !== "none") {
        // Help given in the talk is recorded before anything follows from it; it makes later answers on this question supported.
        r.support.push({ kind: "tutor-content", at: env.nowIso, detail: dispatch!.part });
        pr!.inheritedSupport = [...new Set([...(pr!.inheritedSupport ?? []), `tutor:${verdict.record.support.kind}`])];
      }
      if (verdict.record.support.answerExposed) pr!.exposed.push({ by: `tutor:${dispatch!.turnId}`, at: env.nowIso });
      if (dispatch!.purpose === "reflection") pr!.reflection = "asked";
      support(records, env, def, step, "tutor-outcome", { part: dispatch!.part, status: verdict.record.status, next: verdict.record.next, support: verdict.record.support, turnId: dispatch!.turnId, help: verdict.record.support.kind !== "none" });
      result = { status: verdict.record.status, next: verdict.record.next };
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

export function recordInterest(state: MissionState, records: Records, input: { kind: InterestRecord["kind"]; text?: string | null; choice?: string | null }, visit: VisitId, source: InterestRecord["source"], nowIso: string, newId: () => string, adventure: import("./family-learning-mission-spec.ts").MissionNextAdventure | null = null): InterestRecord {
  if (!["text", "unsure", "no-preference", "declined", "choice"].includes(input.kind)) throw new MissionOpError("invalid", "unknown interest answer");
  const picked = input.kind === "choice" ? adventure?.choices.find((c) => c.id === input.choice) ?? null : null;
  if (input.kind === "choice" && !picked) throw new MissionOpError("invalid", "unknown choice for this visit");
  const text = input.kind === "text" ? String(input.text ?? "").replace(/\r/g, "").slice(0, 300) : picked ? picked.label : null;
  if (input.kind === "text" && !text!.trim()) throw new MissionOpError("invalid", "write a few words, or choose one of the buttons");
  const rec: InterestRecord = { id: newId(), visit, source, kind: input.kind, text, ...(picked ? { choice: picked.id } : {}), at: nowIso };
  state.interests = [...(state.interests ?? []), rec];
  records.samples.push({ id: rec.id, visitId: visit, taskId: "next-interest", kind: "next_interest" as never, language: "de", modality: input.kind === "choice" ? "pick" : "typed", text: text ?? "", metrics: { kind: rec.kind, source, ...(picked ? { choice: picked.id } : {}) }, at: nowIso });
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
  listen: { language: string; plays: number; completedPlays: number; failures: number; script: string | null; transcriptShown: boolean; translation: string | null; translationShown: boolean } | null;
  questions: { id: string; prompt: string; kind: "pick" | "number"; options: string[] | null; status: "open" | "correct" | "given"; tries: number; hint: string | null; shownAnswer: string | null; lastWrong: string | null }[];
  calc: { prompt: string; fields: { key: string; label: string; correct: boolean | null; last: number | null }[]; clarification: string | null; representation: { text: string; total: number; perGroup: number; unit: string } | null; teach: string | null; tries: number } | null;
  choice: { prompt: string; options: { id: string; label: string }[]; picked: { id: string; feedback: string; best: boolean }[]; teach: string | null } | null;
  produce: { language: string; frame: string; instruction: string; wordBank: string[] | null; feedback: string | null; repairLine: string | null; askMeaning: { given: string; options: { word: string; meaningDe: string }[] } | null; shownSentence: string | null; tries: number; maxTries: number; lastResponse: string | null; practiceFeedback?: string | null; practiceLeft?: number } | null;
  typing: TypingBlockView | null;
  /** Content v6: the problem answered question by question (answer keys absent until teaching). */
  solve?: SolveView | null;
  /** Content v6: the own sentence. */
  write?: WriteView | null;
  /** Content v6: the exact quantity picture of a story/outcome step. */
  diagram?: MissionDiagram | null;
  /** Content v6: the evidence-based ending of a scene mission's outcome step (one actual success, one next step). */
  ending?: { success: string | null; next: string } | null;
  /** Content v6: tutor state for this step (never an answer). */
  tutor?: { available: boolean; offerPart: string | null };
};

export type SolvePartView = {
  id: string;
  question: string;
  unit: string;
  status: MissionPartRun["status"];
  /** The child's own correct answer, or the taught value after teaching — never before. */
  value: number | null;
  phase: MissionPartRun["phase"];
  tries: number;
  /** The child's own last wrong number (to catch an unchanged repeat before it is sent) — never an answer key. */
  lastWrong: number | null;
  feedback: { tone: "retry" | "stuck" | "success" | "taught" | "practice-wrong"; text: string } | null;
  hints: { id: string; level: number; type: string; text: string; diagram: MissionDiagram | null; check: { prompt: string; kind: "number" | "pick"; options: string[] | null; unit: string | null; result: "correct" | "wrong" | null; reply: string | null; representation: MissionDiagram | null } | null }[];
  hintsLeft: number;
  /** False before the first attempt of a fresh application (hints come after trying). */
  hintAllowed: boolean;
  teach: string | null;
  practiceLeft: number;
  offer: "shown" | null;
  reflection: "not-available" | "asked" | null;
};
export type SolveView = { facts: string[]; current: string | null; parts: SolvePartView[]; diagram: MissionDiagram | null; application: { of: string; kind: string } | null; total: number };
export type WriteView = { prompt: string; instruction: string; placeholder: string | null; original: string | null; correction: { intro: string; marked: string } | null; revision: string | null; keepLabel: string; thanks: string | null };

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
  /** Content v6: `scene` missions show one illustrated scene and their beats in order; absent/`walk` = the walkable island. */
  presentation?: "walk" | "scene";
  scene?: { art: string; alt: string } | null;
  /** Content v6 (scene): which beat of the reviewed order is on screen (1-based) and how many there are. */
  beat?: { index: number; count: number; next: string | null } | null;
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

export function typingBlockView(def: MissionDef, run: MissionRun, content?: LearningContent, preview?: TypingBlockRun["plan"] | null): TypingBlockView {
  const block = run.typing;
  const tb = def.typingBlock;
  // Before the start the block is announced from the same pace rule it will use (a preview; it is fixed at typing-start).
  const plan = block?.plan ?? preview ?? null;
  const planned = plan?.drills.length ?? 0;
  const minutes = plan && plan.estimatedSeconds ? Math.max(1, Math.round(plan.estimatedSeconds / 60)) : Math.round(tb.targetActiveSeconds / 60);
  const announce = tb.announce.replace("{n}", String(planned || "einige")).replace("{minutes}", String(minutes));
  const phase: TypingBlockView["phase"] = !block ? "not-started" : block.unavailable ? "unavailable" : !block.completedAt ? "drill" : block.comfort === undefined ? "comfort" : block.extra === "offered" ? "extra-offer" : block.extra === "taken" ? "drill" : "done";
  const nd = block ? nextDrill(block) : null;
  const last = block?.drills[block.drills.length - 1] ?? null;
  return { announce, planned, completed: block?.drills.filter((d) => d.attempted && !d.extra).length ?? 0, nextDrill: nd && phase === "drill" ? { no: nd.no, lines: nd.lines, source: nd.source, extra: !!nd.extra } : null, phase, unavailable: block?.unavailable ?? null, lessonId: block?.plan.lessonId || null, last: last ? { accuracy: last.accuracy, attempted: last.attempted } : null, idleGapSeconds: tb.idleGapSeconds, minTypedShare: tb.minTypedShare, guide: content?.typing.course ? { fingers: content.typing.course.fingers, home: content.typing.course.homePosition } : null };
}

function activeView(def: MissionDef, run: MissionRun, step: MissionStep, r: MissionStepRun, content: LearningContent, state?: MissionState, tutorAvailable = false): MissionActiveView {
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
    const practiceFails = r.practiceFails ?? 0;
    const lastPractice = [...r.attempts].reverse().find((x) => x.kind === "practice");
    produce = { language: p.language, frame: p.frame, instruction: p.instruction, wordBank: has("word-bank") ? p.wordBank : null, feedback, repairLine: r.repairLine ?? null, askMeaning: r.phase === "ask-meaning" ? r.pendingMeaning ?? null : null, shownSentence: has("answer-shown") ? p.accepted[0] : null, tries: answers.filter((x) => x.correct !== true).length, maxTries: def.rules.maxProduceAttempts, lastResponse: lastAnswer?.raw ?? null, practiceFeedback: r.status === "active" && lastPractice && lastPractice.correct !== true ? (practiceFails >= (def.rules.maxPracticeAttempts ?? 2) ? "Der Satz stimmt noch nicht ganz. Heb ihn fürs nächste Mal auf, dann üben wir ihn wieder." : "Noch nicht ganz gleich. Schau den Satz oben genau an und schreib ihn noch einmal.") : null, practiceLeft: Math.max(0, (def.rules.maxPracticeAttempts ?? 2) - practiceFails) };
  }
  const listen = step.kind === "listen" && step.text
    ? { language: step.text.language, plays: r.plays, completedPlays: r.completedPlays ?? 0, failures: r.playFailures ?? 0, script: has("transcript") ? step.text.body : null, transcriptShown: has("transcript"), translation: has("translation") ? step.text.de ?? null : null, translationShown: has("translation") }
    : null;
  return {
    id: step.id,
    kind: step.kind,
    title: step.title,
    character: step.character,
    status: r.status,
    phase: r.phase,
    intro: lineView(step, r, step.intro, 0),
    done: lineView(step, r, doneLinesFor(step, r), step.intro.length),
    readText: step.kind === "read" ? step.text?.body ?? null : null,
    listen,
    questions,
    calc,
    choice,
    produce,
    typing: step.kind === "typing-block" ? typingBlockView(def, run, content, !run.typing && state && state.typing.alignment?.result === "match" ? planTypingBlock(state, content, def.typingBlock, (state.feedback?.focus ?? []).filter((f) => f.kind === "typing-key" && f.status === "open").map((f) => f.key)) : null) : null,
    solve: step.solve ? solveView(def, step, r) : null,
    write: step.write ? writeView(step, r) : null,
    diagram: step.diagram ?? null,
    ending: step.kind === "outcome" && def.presentation === "scene" ? sceneEnding(def, run) : null,
    tutor: { available: !!tutorAvailable, offerPart: Object.entries(r.parts ?? {}).find(([, x]) => x.offer === "shown")?.[0] ?? null },
  };
}

function solveView(def: MissionDef, step: MissionStep, r: MissionStepRun): SolveView {
  const sv = step.solve!;
  const current = sv.parts.find((x) => !r.parts?.[x.id] || r.parts[x.id].status === "open")?.id ?? null;
  const parts: SolvePartView[] = [];
  for (const part of sv.parts) {
    const pr = r.parts?.[part.id];
    // Questions appear one at a time: a later question is not in the view before it is shown (its exposure row exists).
    if (!pr) break;
    const mains = r.attempts.filter((a) => a.questionId === part.id && a.kind === "answer");
    const practices = r.attempts.filter((a) => a.questionId === part.id && a.kind === "practice");
    const lastMain = mains[mains.length - 1];
    const lastPractice = practices[practices.length - 1];
    const taughtShown = pr.phase === "taught";
    const value = pr.status === "correct" ? part.answer : taughtShown ? part.answer : null;
    const feedback: SolvePartView["feedback"] =
      pr.status === "correct"
        ? { tone: "success", text: `Richtig! ${part.answer} ${part.unit}.` }
        : pr.status === "taught"
          ? { tone: "taught", text: `Genau, ${part.answer} ${part.unit}. Das haben wir zusammen gelöst.` }
          : pr.status === "unresolved"
            ? { tone: "taught", text: "Das heben wir fürs nächste Mal auf." }
            : taughtShown && lastPractice && lastPractice.correct === false
              ? { tone: "practice-wrong", text: pr.practiceFails >= (def.rules.maxPracticeAttempts ?? 2) ? "Das stimmt noch nicht. Heb die Frage fürs nächste Mal auf." : "Noch nicht. Schau die Lösung oben noch einmal an und trag die Zahl ein." }
              : taughtShown
                ? null
                : lastMain && lastMain.correct === false
                  ? pr.phase === "stuck"
                    ? { tone: "stuck", text: part.stuck }
                    : { tone: "retry", text: part.recheck }
                  : null;
    const hints = pr.hints.map((h) => {
      const hd = part.hints.find((x) => x.id === h.id)!;
      const c = hd.check ? pr.checks[hd.id] : undefined;
      return {
        id: hd.id,
        level: hd.level,
        type: hd.type,
        text: hd.text,
        diagram: hd.diagram ?? null,
        check: hd.check ? { prompt: hd.check.prompt, kind: hd.check.kind, options: hd.check.options ?? null, unit: hd.check.unit ?? null, result: c?.result ?? null, reply: c ? (c.result === "correct" ? hd.check.correct : hd.check.wrong) : null, representation: c?.result === "wrong" ? hd.check.representation ?? null : null } : null,
      };
    });
    parts.push({
      id: part.id,
      question: part.question,
      unit: part.unit,
      status: pr.status,
      value,
      phase: pr.phase,
      tries: mains.length,
      lastWrong: lastMain && lastMain.correct === false ? lastMain.values?.[part.id] ?? null : null,
      feedback,
      hints,
      hintsLeft: pr.status === "open" && !taughtShown ? part.hints.length - pr.hints.length : 0,
      hintAllowed: pr.status === "open" && !taughtShown && !(part.hintsAfterFirstAttempt && mains.length === 0),
      teach: taughtShown ? part.teach : null,
      practiceLeft: taughtShown && pr.status === "open" ? Math.max(0, (def.rules.maxPracticeAttempts ?? 2) - pr.practiceFails) : 0,
      offer: pr.offer === "shown" ? "shown" : null,
      reflection: pr.reflection ?? null,
    });
  }
  const resolved = r.status !== "active";
  return { facts: sv.facts, current, parts, diagram: resolved ? sv.diagram ?? null : null, application: sv.application ?? null, total: sv.parts.length };
}

function writeView(step: MissionStep, r: MissionStepRun): WriteView {
  const w = step.write!;
  const wr = r.writing ?? null;
  return {
    prompt: w.prompt,
    instruction: w.instruction,
    placeholder: w.placeholder ?? null,
    original: wr?.original ?? null,
    correction: wr?.correction && !wr.revision && !wr.kept ? { intro: w.correctionIntro, marked: wr.correction.marked } : null,
    revision: wr?.revision?.text ?? null,
    keepLabel: w.keep,
    thanks: r.status !== "active" ? w.thanks : null,
  };
}

/**
 * The ending of a scene mission (V7-D12): ONE success that actually happened, from the records (fresh application first, then a
 * first-try question, the Spanish request, the listening), else an honest "with help" line; and ONE next step from what is still
 * open. Never praise for zero mistakes, never a mastery claim, never a list.
 */
export function sceneEnding(def: MissionDef, run: MissionRun): { success: string | null; next: string } {
  const ran = (id: string) => run.steps[id];
  const solves = def.steps.filter((s) => s.kind === "solve");
  const fresh = solves.find((s) => s.solve?.application && ran(s.id)?.outcome === "independent");
  const firstTry = solves.flatMap((s) => (s.solve?.parts ?? []).map((p) => ({ s, p, pr: ran(s.id)?.parts?.[p.id] }))).find((x) => x.pr?.evidence === "independent");
  const recall = def.steps.find((s) => (s.kind === "recall" || s.kind === "produce") && ran(s.id)?.outcome === "independent");
  const listen = def.steps.find((s) => s.kind === "listen" && ran(s.id)?.outcome === "independent");
  const helped = solves.find((s) => ran(s.id)?.status === "done");
  const success = fresh
    ? `${fresh.title}: Du hast beim ersten Versuch richtig gerechnet.`
    : firstTry
      ? `${firstTry.s.title}: ${firstTry.p.answer} ${firstTry.p.unit} — beim ersten Versuch richtig.`
      : recall
        ? `Du hast Rosa auf Spanisch gesagt: «${[...ran(recall.id)!.attempts].reverse().find((a) => a.correct === true)?.raw ?? ""}».`
        : listen
          ? "Du hast June auf Englisch verstanden."
          : helped
            ? `${helped.title}: mit Hilfe richtig geplant.`
            : null;
  const openSolve = solves.find((s) => ["taught", "unresolved"].includes(ran(s.id)?.status ?? "") || ran(s.id)?.outcome === "answer_exposed");
  const openRecall = def.steps.find((s) => (s.kind === "recall" || s.kind === "produce") && ran(s.id) && ran(s.id)!.outcome !== "independent");
  const next = openSolve
    ? "Nächstes Mal packen wir noch einmal Tragen, mit neuen Zahlen."
    : openRecall
      ? `Nächstes Mal sagst du Rosa noch einmal auf Spanisch, was ihr braucht.`
      : "Gleich wählst du, wie es im Inselgarten weitergeht.";
  return { success, next };
}

export function buildMissionView(state: MissionState, content: LearningContent, visit: VisitId, options: { tutorAvailable?: boolean } = {}): MissionView | null {
  const def = missionDefFor(content, visit);
  if (!def) return null;
  const run = missionRunOf(state, def) ?? newMissionRun(def, visit, "");
  const st = stepStatuses(def, run);
  const steps = def.steps.map((s) => ({ id: s.id, kind: s.kind, title: s.title, place: s.place, character: s.character, required: s.required, status: st[s.id] }));
  const activeStep = run.active ? def.steps.find((s) => s.id === run.active) : null;
  const active = activeStep && run.steps[activeStep.id] ? activeView(def, run, activeStep, run.steps[activeStep.id], content, state, !!options.tutorAvailable) : null;
  const nextStep = def.steps.find((s) => st[s.id] === "available" || st[s.id] === "active") ?? null;
  const beatStep = activeStep ?? nextStep;
  const shownStatus = (id: string) => ["done", "practiced", "taught", "unresolved"].includes(st[id]);
  const required = def.steps.filter((s) => s.required || (st[s.id] !== "not-needed" && st[s.id] !== "locked"));
  const finishBlocked = def.steps.some((s) => (s.required ? !isResolved(st[s.id]) : st[s.id] === "available" || st[s.id] === "active"));
  return {
    id: def.id,
    title: def.title,
    objective: def.objective,
    presentation: def.presentation ?? "walk",
    scene: def.scene ?? null,
    beat: def.presentation === "scene" ? { index: beatStep ? def.steps.indexOf(beatStep) + 1 : def.steps.length, count: def.steps.length, next: nextStep?.id ?? null } : null,
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
      objectives.push({ taskId: taskId(def, step, a.questionId), version: step.version, objective: a.kind === "practice" ? `${step.objective}-practice` : a.kind === "hint-check" ? `${step.objective}-hint-check` : step.objective, outcome, evidence: a.evidence, support: a.support, uncertainty: a.recall ? `recall: ${a.recall}` : a.analysis?.kind === "spelling" ? `verstanden als „${a.analysis.understood}“` : step.solve?.application && a.kind === "answer" ? "frische Anwendung am selben Tag — kein Nachweis für längerfristiges Behalten" : null });
    }
    const raws = r.attempts.map((a) => `${a.questionId ? `${a.questionId}: ` : ""}„${a.raw}“${a.correct === true ? " ✓" : a.correct === false ? " ✗" : " ?"}${a.analysis?.kind === "spelling" ? ` (verstanden: ${a.analysis.corrections.map((c) => `${c.given}→${c.meant}`).join(", ")})` : ""}${a.kind === "practice" ? " [nach gezeigter Antwort]" : a.kind === "hint-check" ? " [Frage im Hinweis]" : ""}${a.hintsBefore?.length && a.kind === "answer" ? ` [nach ${a.hintsBefore.join(", ")}]` : ""}`);
    whatHappened.push(`${step.id} ${step.title}: ${STATUS_DE[st[step.id]] ?? st[step.id]}${r.outcome ? ` (${r.outcome})` : ""}${raws.length ? ` — Versuche: ${raws.join("; ")}` : ""}${r.support.length ? ` — Hilfe: ${supportKinds(r).join(", ")}` : ""}${step.kind === "listen" ? ` — abgespielt: ${r.plays}×, davon mit gemeldetem Abspiel-Ende ${r.completedPlays ?? 0}×, ohne Abspiel-Ende ${r.playFailures ?? 0}× (Gerätemeldung, kein Nachweis, dass es zu hören war)` : ""}.`);
  }
  for (const step of def.steps) if (st[step.id] === "not-needed") whatHappened.push(`${step.id} ${step.title}: nicht nötig (die erste Bitte war ohne Hilfe richtig).`);
  const typing = run.typing ? typingSummary(run.typing) : null;
  if (run.typing) {
    whatHappened.push(run.typing.unavailable ? `Tippblock: nicht möglich (${run.typing.unavailable}) — offen, keine Gutschrift.` : `Tippblock: ${typing!.attempted}/${typing!.planned} Übungen${typing!.extra ? " + Extra" : ""}; aktive Tippzeit ${typing!.activeSeconds} s, Pausen zwischen Tasten ${typing!.idleSeconds} s, Gesamtzeit inkl. Lesen/Menüs ${typing!.wallSeconds ?? "—"} s; Genauigkeit ${typing!.accuracy === null ? "—" : Math.round(typing!.accuracy * 100) + " %"}; Tempo-Basis ${typing!.paceBasis} (${typing!.paceCps} Zeichen/s); Selbsteinschätzung ${run.typing.comfort === undefined ? "nicht gefragt" : run.typing.comfort ?? "nicht gesagt"}. Genauigkeit des Texts, keine Aussage über Fingertechnik.`);
  }
  const retrieval = def.steps
    .filter((s) => run.steps[s.id] && ["practiced", "taught", "unresolved"].includes(run.steps[s.id].status) || (run.steps[s.id]?.outcome === "supported" && (s.kind === "produce" || s.kind === "recall" || s.kind === "calc" || s.kind === "solve")))
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
    // The latest mission's typing block is the current calibration (Visit 7 after Visit 6); earlier blocks stay in their reviews.
    typing: missions.map((m) => m.typing).filter(Boolean).at(-1) ?? null,
    note: "Wünsche stehen hier wörtlich, wie das Kind sie gesagt hat; nichts wird daraus geschlossen. Die Tippdauer ist eine Kalibrierung und wird nach echtem Gebrauch überprüft.",
  };
}

export type { NextInterestDef };

/** Child summary lines of a mission visit: one evidence-backed success, one practiced line, the next step, the artifact. */
export function missionVisitSummary(state: MissionState, content: LearningContent, visit: VisitId) {
  const rep = missionReport(state, content, visit);
  if (!rep) return null;
  const { def, run } = rep;
  if (def.presentation === "scene") {
    // V6-F10 / V7-D12: short and child-sized — the visible result, one evidenced success, one next step. Details stay in the parent view.
    const ending = sceneEnding(def, run);
    const outcome = def.world.filter((w) => ["done", "practiced", "taught", "unresolved"].includes(rep.statuses[w.after])).pop();
    return {
      success: ending.success ? { text: ending.success, basis: `${def.id} records` } : null,
      practiced: null,
      next: { branch: (ending.next.startsWith("Gleich") ? "success" : "supported") as "success" | "supported", text: ending.next.startsWith("Gleich") ? "Nächstes Mal: dein neues Abenteuer im Inselgarten." : ending.next, basis: `${def.id} open items` },
      artifact: run.finishedAt ? { kind: "mission" as const, text: outcome ? `${outcome.label}.` : `${def.title}: geschafft.` } : null,
    };
  }
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


// ---------------------------------------------------------------------------
// Parent evidence (content v6, V7-D14): observed answers, support, tutor judgments, missing evidence and later checks — apart.
// ---------------------------------------------------------------------------

export type MissionEvidenceQuestion = {
  taskId: string;
  question: string;
  /** Every answer the child submitted, in order and verbatim (main answers, copies after teaching, answers inside hints). */
  answers: { no: number; at: string; raw: string; correct: boolean | null; kind: MissionAttempt["kind"]; afterHints: string[] }[];
  /** The exact reviewed hints shown, with their type/level and how many answers came before each. */
  hints: { id: string; type: string; level: number; at: string; afterAttempts: number }[];
  exposure: string[];
  result: "first-try" | "after-retry" | "after-hint" | "after-teaching" | "kept-for-later" | "open";
  /** Plain-language reading of the result, never a mastery claim. */
  reading: string;
};

export type MissionEvidenceStep = {
  id: string;
  title: string;
  kind: MissionStep["kind"];
  status: MissionStepStatus;
  observed: string[];
  questions: MissionEvidenceQuestion[];
  support: string[];
  tutor: string;
  missing: string[];
  laterCheck: string | null;
};

const HINT_TYPE_DE: Record<string, string> = { grouping: "Bündeln", subtract: "Abziehen", "extra-tray": "Zusatztrage", "count-all": "Alle zählen (Bild)", compare: "Vergleichen", "word-options": "Wortauswahl" };

/** The parent's view of one mission run: observation, help, tutor, missing evidence, later checks — never merged. */
export function missionEvidence(state: MissionState, content: LearningContent, visit: VisitId): { mission: string; title: string; steps: MissionEvidenceStep[]; note: string } | null {
  const def = missionDefFor(content, visit);
  if (!def) return null;
  const run = missionRunOf(state, def);
  if (!run) return null;
  const st = stepStatuses(def, run);
  const steps: MissionEvidenceStep[] = [];
  for (const step of def.steps) {
    const r = run.steps[step.id];
    const missing: string[] = [];
    const questions: MissionEvidenceQuestion[] = [];
    const observed: string[] = [];
    let laterCheck: string | null = null;
    if (!r) {
      steps.push({ id: step.id, title: step.title, kind: step.kind, status: st[step.id], observed, questions, support: [], tutor: "—", missing: ["nicht begonnen"], laterCheck });
      continue;
    }
    for (const part of step.solve?.parts ?? []) {
      const pr = r.parts?.[part.id];
      if (!pr) {
        missing.push(`Frage «${part.id}» noch nicht erreicht`);
        continue;
      }
      const answers = r.attempts.filter((a) => a.questionId === part.id || a.questionId?.startsWith(`${part.id}/`)).map((a) => ({ no: a.no, at: a.at, raw: a.raw, correct: a.correct, kind: a.kind, afterHints: a.hintsBefore ?? [] }));
      const mains = answers.filter((a) => a.kind === "answer");
      const result: MissionEvidenceQuestion["result"] = pr.status === "unresolved" ? "kept-for-later" : pr.status === "taught" ? "after-teaching" : pr.status === "open" ? "open" : pr.evidence === "independent" ? "first-try" : pr.hints.length || (pr.inheritedSupport ?? []).length || pr.exposed.length ? "after-hint" : "after-retry";
      const reading =
        result === "first-try" ? "Beim ersten Versuch richtig, ohne Hinweis." :
        result === "after-retry" ? `Richtig nach ${mains.length - 1} falschen Versuch(en), ohne Hinweis; der erste Versuch ist der aussagekräftige.` :
        result === "after-hint" ? `Richtig mit Unterstützung (${[...pr.hints.map((h) => `${h.id} ${HINT_TYPE_DE[h.type] ?? h.type}`), ...(pr.inheritedSupport ?? [])].join(", ") || "Hilfe"}${pr.exposed.length ? `; Antwort vorher sichtbar durch ${pr.exposed.map((e) => e.by).join(", ")}` : ""}). Kein selbständiger Nachweis.` :
        result === "after-teaching" ? "Nach gezeigter Lösung abgeschrieben. Kein selbständiger Nachweis." :
        result === "kept-for-later" ? "Nach gezeigter Lösung fürs nächste Mal aufgehoben." : "Noch offen.";
      questions.push({ taskId: taskId(def, step, part.id), question: part.question, answers, hints: pr.hints.map((h) => ({ ...h })), exposure: pr.exposed.map((e) => e.by), result, reading });
      if (part.reflect && pr.status === "correct" && pr.reflection !== "asked") missing.push(`Erklärung des Rechenwegs zu «${part.id}»: nicht erhoben (Nokt nicht aktiv). Ob verstanden oder geraten, ist offen.`);
      if (mains.some((a) => a.correct === false)) missing.push(`Ursache der falschen Antwort(en) bei «${part.id}» unbekannt (Aufgabe missverstanden, Rechenfehler oder Versehen sind nicht unterscheidbar ohne Gespräch).`);
    }
    if (step.solve?.application) laterCheck = `Frische Anwendung am selben Tag nach «${def.steps.find((x) => x.id === step.solve!.application!.of)?.title ?? step.solve.application.of}» — kein Nachweis für Behalten über Tage.`;
    if (!step.solve) {
      for (const a of r.attempts) observed.push(`${a.questionId ? `${a.questionId}: ` : ""}«${a.raw}» ${a.correct === true ? "richtig" : a.correct === false ? "falsch" : "nicht bewertet"}${a.kind === "practice" ? " (Abschrift nach gezeigter Antwort)" : ""}${a.recall ? ` — ${a.recall === "fresh" ? "frisch abgerufen" : "nachdem das Wort gezeigt wurde"}` : ""}`);
      if (step.kind === "listen") {
        observed.push(`Abgespielt ${r.plays}×; Abspiel-Ende gemeldet ${r.completedPlays ?? 0}×, fehlgeschlagen ${r.playFailures ?? 0}× (Gerätemeldung).`);
        missing.push("Ob der Ton tatsächlich hörbar war, ist nicht belegt.");
      }
      if (step.kind === "write" && r.writing) {
        observed.splice(0, observed.length, `Original: «${r.writing.original}»`, ...(r.writing.revision ? [`Überarbeitung: «${r.writing.revision.text}» (${r.writing.revision.outcome})`] : []), `Abstände: ${!r.writing.assessable ? "nicht prüfbar (keine geprüfte Wortgrenze)" : r.writing.flags.length ? `${r.writing.flags.length} Stelle(n) markiert, 1 Korrektur gezeigt` : "keine Auffälligkeit"}`);
        missing.push("Inhalt und Grammatik des Satzes wurden nicht beurteilt.");
      }
      if (step.retrieval?.focus) laterCheck = `Wiederabruf von «${step.retrieval.focus.split(":").pop()}» aus früheren Besuchen; zählt nur frisch und ohne Hilfe als Behalten.`;
    }
    const support = [...new Set(r.support.map((x) => (x.kind === "hint" ? `Hinweis ${x.detail ?? ""}` : x.kind)))];
    const tutorEntries = r.tutor ?? [];
    const tutor = tutorEntries.length ? `Nokt geöffnet ${tutorEntries.length}× (${tutorEntries.map((t) => t.entry).join(", ")}); ${tutorEntries.some((t) => t.available) ? "Gespräch verfügbar" : "Gespräch nicht verfügbar — keine Tutor-Einschätzung"}` : "Keine Tutor-Einschätzung (Nokt nicht aktiv).";
    steps.push({ id: step.id, title: step.title, kind: step.kind, status: st[step.id], observed, questions, support, tutor, missing, laterCheck });
  }
  return { mission: def.id, title: def.title, steps, note: "Elternhilfe am Gerät wird von der App nicht erfasst. Abschluss, Hilfe-Zahl oder Abspiel-Meldungen sind kein Nachweis von Können." };
}
