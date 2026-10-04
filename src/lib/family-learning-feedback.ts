// ---------------------------------------------------------------------------
// Lesson-end feedback, targeted repair and next-lesson reminders
// (world-first learner experience, authorized 2026-10-03; family-assistant
// DESIGN §7.6 and learning/CONTRACT.md "October 3 lesson feedback";
// independent repair round 1 (F1–F4) folded in).
//
// Pure and deterministic over the saved mission state and the reviewed
// content. Nothing here scores anything new: every mistake named below is an
// attempt row, a language record, a per-character typing alignment or a
// spacing flag that the state machine already recorded. The rules:
//
//  UX-5a  A lesson ends with one specific, evidence-backed success when there
//         is one, then the recorded mistakes with the child's own answer / key
//         / word and the reviewed correction. Repeats are grouped; one pattern
//         is marked actionable. A wrong answer ("incorrect") is kept apart from
//         unscored / ambiguous work (uncertain transcript, spoken spacing,
//         non-canonical production), which is never called a mistake and never
//         opens a practice focus (F1, F4).
//  UX-5b  When a confirmed mistake warrants practice, a short visual worked
//         example (recorded as help BEFORE it is shown) is followed by one to
//         three targeted retry items drawn ONLY from the reviewed content of
//         the same lesson: typing lines, the label target, the child's own
//         flagged sentence, the same reviewed pick/produce step (F2). The
//         first attempt is preserved; the explanation, every retry and the
//         outcome are separate records. Exhausting the items closes the repair
//         in the same write (no separate close is needed, F3); the close is
//         "corrected with practice" or "we'll practice this again" — never
//         inferred mastery. The loop is bounded (MAX_RETRIES), skippable and
//         never penalised. Lessons whose own reviewed loop already contains
//         the correction (math clarification → example → teach-or-stop; the
//         second language try; the spacing revision) present that loop; a
//         wrong answer at a loop's FINAL step (the transfer sentence, a final
//         pick, a label) gets its own repair.
//  UX-5c  An open practice focus yields exactly one short cue immediately
//         before the next RELEVANT lesson (same key in the lines, same kind of
//         math item, the same word in the segment, the same writing rule),
//         grounded in that child's saved evidence. A focus is retired only by
//         a suitable LATER independent check (a later full typing round with
//         the key error-free, a later fresh item of the same kind solved
//         independently, a later independent correct record on a step for the
//         same word, a later clean typed transfer without prior help) — a
//         helped or copied retry alone never retires it. With no relevant open
//         focus the cue is omitted. Correction status and the focus list live
//         in the mission state (the existing child-scoped domain persistence),
//         never in a second store.
//
// Companion App renders these views; it decides nothing here.
// ---------------------------------------------------------------------------

import type { LanguageSegmentId, LearningContent, ScoredMathItemId, TypingCourseLesson, TypingLesson, VisitId, StageId, LanguageStep } from "./family-learning-content.ts";
import { hasLanguageSegment, hasMathItem, isLanguageSegmentId, isScoredMathItemId, languageSegment, mathItem, usedWordOf } from "./family-learning-content.ts";
import type { LanguageStepRecord, MathAttempt, MathItemState, MissionState, TypingBurst, TypingLabelRecord, TypingLessonRecord, VisitRecord } from "./family-learning-state.ts";
import { buildVisitSummary, visitLabel, visitOrdinal, type VisitSummary } from "./family-learning-summary.ts";
import { alignTyping } from "./family-learning-typing-metrics.ts";
import { evaluateRevision, flagSpacing, markSpacing, type SpacingFlag } from "./family-learning-writing.ts";

// ---------------------------------------------------------------------------
// Persisted shapes (additive fields of MissionState)
// ---------------------------------------------------------------------------

/** One recorded per-character typing mismatch (final line text, metric version 2 alignment); never a keystroke stream. */
export type TypingError = { line: number; kind: "substitute" | "omit" | "extra"; expected: string | null; typed: string | null };

/** Upper bound on stored per-round mismatches (a round has at most ~30 characters; the cap only guards pathological input). */
export const MAX_TYPING_ERRORS = 60;

/** Bounded targeted retries per repair (UX-5b: one to three). */
export const MAX_RETRIES = 3;

export type RepairKind = "typing" | "label" | "writing" | "language";

export type RepairRetry = {
  no: number;
  /** The reviewed item retried: `line:<index>`, `label`, `sentence`, `<segment>/<step>`. */
  item: string;
  purpose: "correct-original" | "fresh-check";
  at: string;
  /** `correct` = the focus resolved in this attempt; `incorrect` = confirmed not yet; `unscored` = ambiguous (never counted as either). */
  result: "correct" | "incorrect" | "unscored";
  /** Confirmed errors on the focus in this attempt (0 when unscored). */
  focusErrors: number;
  lineErrors: number;
  seconds: number;
  /** The child's retry text where the retry IS text (label, sentence, produce); absent for typing lines and picks. */
  text?: string;
};

export type LessonRepair = {
  /** Equals the lesson feedback id it belongs to. */
  id: string;
  visit: VisitId;
  kind: RepairKind;
  /** `typing:<lessonId>` | `label:<taskId>` | `writing:<transferId>` | `language:<segmentId>`. */
  lesson: string;
  /** The practice focus this repair addresses (e.g. `typing-key:j`, `spacing:rule`, `language:es:agua`). */
  focus: string;
  openedAt: string;
  /** When the visual worked example was recorded as shown (UX-5b help is recorded before it is shown). */
  explainedAt: string | null;
  retries: RepairRetry[];
  maxRetries: number;
  /** The item ids offered when the repair opened (language: one per unresolved step). Present since repair round 2; when set,
   *  the close outcome is per item: `corrected-with-practice` only when EVERY offered item was corrected. */
  items?: string[];
  outcome: "open" | "corrected-with-practice" | "practice-again" | "skipped";
  closedAt: string | null;
};

export type PracticeFocusKind = "typing-key" | "math" | "language" | "spacing";

export type PracticeFocus = {
  /** `typing-key:<char>` | `math:sharing` | `math:remainder` | `language:<en|es>:<word>` | `spacing:rule`. */
  id: string;
  kind: PracticeFocusKind;
  key: string;
  openedAt: string;
  openedIn: { visit: VisitId; lesson: string };
  /** Short, child-readable grounding (what was recorded), German. */
  evidence: string;
  status: "open" | "retired";
  retiredAt: string | null;
  /** The later independent check that retired it, or null. */
  retiredBy: string | null;
  /** How often the focus was (re)opened by a confirmed mistake. */
  reopened: number;
};

export type FeedbackState = {
  repairs: LessonRepair[];
  focus: PracticeFocus[];
  /** Lesson feedback ids the child has seen and moved past (bounded). */
  acknowledged: string[];
};

export const MAX_ACKNOWLEDGED = 200;

export function emptyFeedbackState(): FeedbackState {
  return { repairs: [], focus: [], acknowledged: [] };
}

export function feedbackOf(state: MissionState): FeedbackState {
  return state.feedback ?? emptyFeedbackState();
}

// ---------------------------------------------------------------------------
// Typing errors (shared by the state machine when it records a round)
// ---------------------------------------------------------------------------

/** Per-character mismatches of a typed round against its lesson lines (bounded). */
export function typingErrors(expectedLines: readonly string[], typedLines: readonly string[]): TypingError[] {
  const out: TypingError[] = [];
  expectedLines.forEach((expected, line) => {
    const { ops } = alignTyping(expected, typedLines[line] ?? "");
    for (const op of ops) {
      if (op.kind === "match") continue;
      if (out.length >= MAX_TYPING_ERRORS) return;
      out.push({ line, kind: op.kind, expected: op.expected, typed: op.typed });
    }
  });
  return out;
}

const KEY_LABEL = (key: string) => (key === " " ? "Leertaste" : key);

// ---------------------------------------------------------------------------
// Feedback views
// ---------------------------------------------------------------------------

export type LessonKind = "math" | "language" | "typing" | "writing";

export type MistakeVisual =
  | { kind: "key"; key: string; finger: string | null; typed: string | null }
  | { kind: "sharing"; quantity: number; groups: number; answer: number; unit: string; group: string }
  | { kind: "remainder"; quantity: number; groups: number; perGroup: number; used: number; remaining: number; unit: string; group: string; usedWord: string }
  | { kind: "word"; word: string; gloss: string; emoji: string | null; language: "en" | "es" }
  | { kind: "spacing"; marked: string }
  | { kind: "label"; target: string; typed: string };

export type Mistake = {
  id: string;
  /** `incorrect` = confirmed wrong; `unscored` = uncertain / ambiguous — shown apart, never called wrong. */
  evidence: "incorrect" | "unscored";
  /** The practice focus this mistake maps to, or null when none is warranted. */
  focus: string | null;
  /** Repeats grouped. */
  count: number;
  /** The child's recorded answer / key / word. */
  given: string;
  /** What was expected. */
  expected: string;
  /** Concise correction (reviewed content text where the content has one, else a deterministic rule phrase). */
  correction: string;
  visual: MistakeVisual | null;
  /** Record references (attempt numbers, step ids, line numbers) for inspection. */
  refs: string[];
};

export type RetryItem =
  | { no: number; item: string; purpose: "correct-original" | "fresh-check"; kind: "typing-line"; text: string; lessonId: string; lineIndex: number }
  | { no: number; item: string; purpose: "correct-original"; kind: "label"; text: string; taskId: string }
  | { no: number; item: string; purpose: "correct-original"; kind: "sentence"; text: string; marked: string }
  | { no: number; item: string; purpose: "correct-original"; kind: "pick"; text: string; stepId: string; options: { id: string; label: string; emoji: string }[]; cue: RetryCue }
  | { no: number; item: string; purpose: "correct-original"; kind: "produce"; text: string; stepId: string; frame: string; cue: RetryCue };

/** The applicable explanation of ONE retry item (the word it practises) — shown with the item, so a second unresolved word never
 *  inherits the first word's example (repair round 2, R2-1). */
export type RetryCue = { word: string; title: string; text: string; visual: MistakeVisual | null };

export type RepairView = {
  /** `none-needed` (no confirmed mistake warrants practice), `available` (offered, not started), `open`, `closed`. */
  status: "none-needed" | "available" | "open" | "closed";
  kind: RepairKind | null;
  repairId: string | null;
  focus: string | null;
  /** `recorded` is true only when a durable shown/support record exists for the explanation (never from a mere definition). */
  explanation: { title: string; text: string; visual: MistakeVisual | null; recorded: boolean } | null;
  items: RetryItem[];
  /** Every attempt after the first mistake, in order: the attempts made inside the task itself (clarification, second try,
   *  reuse check) and the attempts recorded on the repair. For the child's history; never an index into `items`. */
  retries: RepairRetry[];
  /** Attempts recorded on the repair record itself — `items[used]` is the next retry item. */
  used: number;
  remaining: number;
  outcome: LessonRepair["outcome"] | null;
};

export type LessonFeedback = {
  id: string;
  visit: VisitId;
  lesson: { kind: LessonKind; ref: string; title: string };
  at: string;
  success: { text: string; basis: string } | null;
  mistakes: Mistake[];
  unscored: Mistake[];
  pattern: Mistake | null;
  repair: RepairView;
  close: { kind: "none-needed" | "corrected-with-practice" | "corrected-with-help" | "practice-again" | "pending" | "unscored"; text: string };
  acknowledged: boolean;
};

export type ReminderCue = {
  focusId: string;
  kind: PracticeFocusKind;
  key: string;
  /** One short imperative cue (German). */
  cue: string;
  /** What the saved evidence says (German, names the child's recorded answer). */
  grounding: string;
  openedIn: { visit: VisitId; lesson: string; label: string };
  visual: MistakeVisual | null;
};

export type VisitReport = {
  visit: VisitId;
  ordinal: number | null;
  label: string;
  startedAt: string;
  finishedAt: string | null;
  /** True for the running visit: an honest partial recap, never a completed report. */
  partial: boolean;
  stagesDone: number;
  stageCount: number;
  summary: VisitSummary;
  lessons: LessonFeedback[];
  /** What changed in the world during this visit, in saved-state terms. */
  worldChanges: string[];
};

// ---------------------------------------------------------------------------
// Lesson-end events
// ---------------------------------------------------------------------------

type LessonEvent =
  | { kind: "math"; id: ScoredMathItemId; at: string }
  | { kind: "language"; id: LanguageSegmentId; at: string }
  | { kind: "typing-burst"; burst: TypingBurst; index: number; at: string }
  | { kind: "typing-lesson"; record: TypingLessonRecord; index: number; at: string }
  | { kind: "typing-label"; record: TypingLabelRecord; index: number; at: string }
  | { kind: "writing"; at: string };

function inVisit(visit: VisitRecord, at: string): boolean {
  const end = visit.finishedAt ?? "9999";
  return at >= visit.startedAt && at <= end;
}

function belongsTo(visit: VisitRecord, record: { visit?: VisitId; at: string }): boolean {
  if (record.visit) return record.visit === visit.id;
  return inVisit(visit, record.at);
}

/** Every lesson that ENDED inside the visit, oldest first. */
function lessonEvents(state: MissionState, content: LearningContent, visit: VisitRecord): LessonEvent[] {
  const events: LessonEvent[] = [];
  for (const [id, item] of Object.entries(state.math)) {
    // Only items the SERVED content knows can be explained (a capped / rolled-back content leaves later chapters parked).
    if (!item || !item.resolvedAt || !isScoredMathItemId(id) || !hasMathItem(content, id)) continue;
    if (item.shownVisit === visit.id || (item.shownVisit === null && inVisit(visit, item.resolvedAt))) events.push({ kind: "math", id, at: item.resolvedAt });
  }
  for (const [id, seg] of Object.entries(state.language)) {
    if (!seg || !isLanguageSegmentId(id) || !seg.done || !hasLanguageSegment(content, id)) continue;
    const records = seg.records.filter((r) => belongsTo(visit, r));
    if (records.length === 0) continue;
    const last = records[records.length - 1];
    if (seg.records[seg.records.length - 1] === last) events.push({ kind: "language", id, at: last.at });
  }
  (state.typing.course?.bursts ?? []).forEach((burst, index) => {
    if (burst.visit === visit.id && inVisit(visit, burst.at)) events.push({ kind: "typing-burst", burst, index, at: burst.at });
  });
  state.typing.lessons.forEach((record, index) => {
    if (inVisit(visit, record.at)) events.push({ kind: "typing-lesson", record, index, at: record.at });
  });
  state.typing.labels.forEach((record, index) => {
    if (inVisit(visit, record.at)) events.push({ kind: "typing-label", record, index, at: record.at });
  });
  // The writing lesson ends with the fresh transfer sentence (written or skipped) when the content has one; otherwise with the revision.
  const transfer = (state.transfers ?? []).find((t) => t.visit === visit.id && inVisit(visit, t.at)) ?? null;
  const revision = state.logRevisions.find((r) => r.visit === visit.id && inVisit(visit, r.at)) ?? null;
  if (transfer && (transfer.outcome !== "skipped" || (revision && revision.outcome !== "skipped"))) events.push({ kind: "writing", at: transfer.at });
  else if (!content.writing?.transfer && revision && revision.outcome !== "skipped") events.push({ kind: "writing", at: revision.at });
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Repair view helpers
// ---------------------------------------------------------------------------

const NO_REPAIR: RepairView = { status: "none-needed", kind: null, repairId: null, focus: null, explanation: null, items: [], retries: [], used: 0, remaining: 0, outcome: null };

/** Status of a persisted repair record: offered until the worked example is recorded, then open, then closed. */
function repairStatusOf(record: LessonRepair): RepairView["status"] {
  if (record.outcome !== "open") return "closed";
  return record.explainedAt === null && record.retries.length === 0 ? "available" : "open";
}

function repairViewFrom(record: LessonRepair | null, kind: RepairKind, id: string, focus: string, explanation: RepairView["explanation"], items: RetryItem[]): RepairView {
  if (!record) return items.length ? { status: "available", kind, repairId: id, focus, explanation, items, retries: [], used: 0, remaining: items.length, outcome: null } : NO_REPAIR;
  const bounded = Math.min(items.length, effectiveMaxRetries(record, items));
  return { status: repairStatusOf(record), kind, repairId: id, focus, explanation: explanation ? { ...explanation, recorded: record.explainedAt !== null } : null, items, retries: record.retries, used: record.retries.length, remaining: Math.max(0, bounded - record.retries.length), outcome: record.outcome === "open" ? null : record.outcome };
}

// ---------------------------------------------------------------------------
// Typing lessons (course rounds, the starter lesson and the label share one shape)
// ---------------------------------------------------------------------------

export type TypingLessonDef = { id: string; title: string; lines: string[]; fingers: Record<string, string>; keys: string[] };

export function typingLessonDef(content: LearningContent, lessonId: string): TypingLessonDef | null {
  const course = content.typing.course ?? null;
  const courseLesson: TypingCourseLesson | undefined = course?.lessons.find((l) => l.id === lessonId);
  if (courseLesson && course) return { id: courseLesson.id, title: courseLesson.title, lines: courseLesson.lines, fingers: course.fingers, keys: [...courseLesson.keys, ...courseLesson.practiced] };
  const starter: TypingLesson | undefined = content.typing.lessons.find((l) => l.id === lessonId);
  if (starter) return { id: starter.id, title: starter.title, lines: starter.lines, fingers: starter.fingers, keys: Array.from(new Set(starter.lines.join("").split("")).values()) };
  return null;
}

/** Keys of a lesson's lines (letters and the space), in order of appearance. */
function lessonKeys(lines: readonly string[]): string[] {
  return Array.from(new Set(lines.join("").split("")));
}

const FOCUS_TYPING = (key: string) => `typing-key:${key}`;

function groupTypingErrors(errors: TypingError[], fingers: Record<string, string>, focusable: boolean): { mistakes: Mistake[]; extras: Mistake[] } {
  const byKey = new Map<string, { count: number; typed: Map<string, number>; lines: Set<number>; omitted: number }>();
  const extras = new Map<string, { count: number; lines: Set<number> }>();
  for (const e of errors) {
    if (e.kind === "extra") {
      const k = e.typed ?? "?";
      const g = extras.get(k) ?? { count: 0, lines: new Set<number>() };
      g.count += 1;
      g.lines.add(e.line);
      extras.set(k, g);
      continue;
    }
    const key = e.expected ?? "?";
    const g = byKey.get(key) ?? { count: 0, typed: new Map<string, number>(), lines: new Set<number>(), omitted: 0 };
    g.count += 1;
    g.lines.add(e.line);
    if (e.kind === "omit") g.omitted += 1;
    else g.typed.set(e.typed ?? "?", (g.typed.get(e.typed ?? "?") ?? 0) + 1);
    byKey.set(key, g);
  }
  const mistakes: Mistake[] = [...byKey.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([key, g]) => {
      const typedList = [...g.typed.entries()].sort((a, b) => b[1] - a[1]);
      const given = [...typedList.map(([t, n]) => `${KEY_LABEL(t)}${n > 1 ? ` (${n}×)` : ""}`), ...(g.omitted ? [`ausgelassen${g.omitted > 1 ? ` (${g.omitted}×)` : ""}`] : [])].join(", ");
      const finger = fingers[key] ?? null;
      return {
        id: `key:${key}`,
        evidence: "incorrect" as const,
        focus: focusable ? FOCUS_TYPING(key) : null,
        count: g.count,
        given,
        expected: KEY_LABEL(key),
        correction: finger ? `„${KEY_LABEL(key)}“ tippt der ${finger}${key === "f" || key === "j" ? " — er liegt auf der Taste mit der Noppe" : ""}.` : `„${KEY_LABEL(key)}“ noch einmal langsam.`,
        visual: { kind: "key" as const, key, finger, typed: typedList[0]?.[0] ?? null },
        refs: [...g.lines].sort().map((l) => `Zeile ${l + 1}`),
      };
    });
  const extraMistakes: Mistake[] = [...extras.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([typed, g]) => ({
      id: `extra:${typed}`,
      evidence: "incorrect" as const,
      focus: null,
      count: g.count,
      given: `${KEY_LABEL(typed)} zu viel${g.count > 1 ? ` (${g.count}×)` : ""}`,
      expected: "—",
      correction: "Ein Zeichen zu viel — vor Enter kurz die Zeile vergleichen.",
      visual: null,
      refs: [...g.lines].sort().map((l) => `Zeile ${l + 1}`),
    }));
  return { mistakes, extras: extraMistakes };
}

/** Retry items for a typing focus: the line with the most errors on the key first (correct the original), then other lines that contain the key (fresh checks). */
export function typingRetryItems(lesson: TypingLessonDef, focusKey: string, errors: TypingError[]): RetryItem[] {
  const perLine = lesson.lines.map((text, lineIndex) => ({ text, lineIndex, errors: errors.filter((e) => e.line === lineIndex && e.kind !== "extra" && e.expected === focusKey).length, has: text.includes(focusKey) }));
  const candidates = perLine.filter((l) => l.has);
  if (candidates.length === 0) return [];
  const original = [...candidates].sort((a, b) => b.errors - a.errors || a.lineIndex - b.lineIndex)[0];
  const items: RetryItem[] = [{ no: 1, item: `line:${original.lineIndex}`, purpose: "correct-original", kind: "typing-line", text: original.text, lessonId: lesson.id, lineIndex: original.lineIndex }];
  for (const c of candidates) {
    if (items.length >= MAX_RETRIES) break;
    if (c.lineIndex === original.lineIndex) continue;
    items.push({ no: items.length + 1, item: `line:${c.lineIndex}`, purpose: "fresh-check", kind: "typing-line", text: c.text, lessonId: lesson.id, lineIndex: c.lineIndex });
  }
  return items;
}

/** Up to two attempts to write the label exactly (correct the original); a label has no approved equivalent for a fresh check. */
export function labelRetryItems(taskId: string, target: string): RetryItem[] {
  return [1, 2].map((no) => ({ no, item: "label", purpose: "correct-original" as const, kind: "label" as const, text: target, taskId }));
}

/** Up to two attempts to set the missing spaces in the child's OWN sentence (correct the original); the reviewed rules decide. */
export function sentenceRetryItems(text: string, flags: readonly SpacingFlag[]): RetryItem[] {
  return [1, 2].map((no) => ({ no, item: "sentence", purpose: "correct-original" as const, kind: "sentence" as const, text, marked: markSpacing(text, flags) }));
}

function typingLessonFeedback(state: MissionState, content: LearningContent, visit: VisitRecord, ref: { lessonId: string; at: string; lines: readonly string[]; errors: TypingError[] | undefined; correct: number; denominator: number; kindLabel: string; roundNo?: number }): LessonFeedback {
  const fb = feedbackOf(state);
  const lesson = typingLessonDef(content, ref.lessonId);
  const id = `typing:${ref.lessonId}@${ref.at}`;
  const title = `${lesson ? `Tippen: ${lesson.title}` : "Tippen"}${ref.roundNo ? ` · Runde ${ref.roundNo}` : ""}`;
  const fingers = lesson?.fingers ?? {};
  const errors = ref.errors;
  let mistakes: Mistake[] = [];
  let unscored: Mistake[] = [];
  if (errors === undefined) {
    // Rounds saved before this build carry only counts; their details were not recorded. Never invent them.
    unscored = [{ id: "no-detail", evidence: "unscored", focus: null, count: 1, given: `${ref.correct} von ${ref.denominator} Zeichen richtig`, expected: "—", correction: "Welche Tasten schwierig waren, wurde bei dieser Runde nicht aufgezeichnet.", visual: null, refs: [] }];
  } else {
    const grouped = groupTypingErrors(errors, fingers, true);
    mistakes = [...grouped.mistakes, ...grouped.extras];
  }
  const cleanLines = ref.lines.map((line, i) => ({ line, i, clean: !(errors ?? []).some((e) => e.line === i) })).filter((l) => l.clean);
  let success: LessonFeedback["success"] = null;
  if (errors !== undefined && cleanLines.length === ref.lines.length && ref.lines.length > 0) success = { text: `Alle ${ref.lines.length === 1 ? "Zeichen der Zeile" : `${ref.lines.length} Zeilen`} richtig getippt.`, basis: `${ref.kindLabel} ${ref.lessonId} ${ref.at}: 0 mismatches` };
  else if (errors !== undefined && cleanLines.length > 0) success = { text: `Die Zeile „${cleanLines[0].line}“ war ganz richtig.`, basis: `${ref.kindLabel} ${ref.lessonId} ${ref.at}: line ${cleanLines[0].i + 1} clean` };
  else if (ref.correct > 0 && ref.denominator > 0) success = { text: `${ref.correct} von ${ref.denominator} Zeichen richtig getroffen.`, basis: `${ref.kindLabel} ${ref.lessonId} ${ref.at}: ${ref.correct}/${ref.denominator}` };
  const pattern = mistakes.find((m) => m.focus !== null) ?? mistakes[0] ?? null;
  const record = fb.repairs.find((r) => r.id === id) ?? null;
  let repair: RepairView = NO_REPAIR;
  if (pattern && pattern.focus && lesson) {
    const focusKey = pattern.focus.slice("typing-key:".length);
    const items = typingRetryItems({ ...lesson, lines: [...ref.lines] }, focusKey, errors ?? []);
    const finger = fingers[focusKey] ?? null;
    const explanation = {
      title: `So findest du „${KEY_LABEL(focusKey)}“`,
      text: finger ? `${finger}${focusKey === "f" || focusKey === "j" ? " — die Taste mit der Noppe" : focusKey === " " ? " — kurz antippen" : ""}. Die anderen Finger bleiben auf ihren Tasten.` : `Schau auf die Tastatur, finde „${KEY_LABEL(focusKey)}“, dann zurück in die Grundstellung.`,
      visual: { kind: "key" as const, key: focusKey, finger, typed: pattern.visual?.kind === "key" ? pattern.visual.typed : null },
      recorded: false,
    };
    repair = repairViewFrom(record, "typing", id, pattern.focus, explanation, items);
  }
  const close = closeOf(repair, mistakes, unscored, errors === undefined ? "unscored" : null, {
    none: mistakes.length === 0 && errors !== undefined ? "Nichts zu verbessern — weiter so." : "Gespeichert. Die Zeichen zu viel schauen wir beim nächsten Mal an.",
    unscored: "Diese Runde ist gespeichert; Einzelheiten fehlen.",
    corrected: `Mit Üben korrigiert: „${KEY_LABEL(repair.focus?.slice("typing-key:".length) ?? "")}“ hat in der Wiederholung gestimmt.`,
    again: `„${KEY_LABEL(repair.focus?.slice("typing-key:".length) ?? "")}“ üben wir nochmal — beim nächsten Mal gibt es einen Hinweis.`,
  });
  return { id, visit: visit.id, lesson: { kind: "typing", ref: ref.lessonId, title }, at: ref.at, success, mistakes, unscored, pattern, repair, close, acknowledged: fb.acknowledged.includes(id) };
}

/** The honest close of a lesson from its repair view and mistake lists. */
function closeOf(repair: RepairView, mistakes: Mistake[], unscored: Mistake[], forced: "unscored" | null, texts: { none: string; unscored: string; corrected: string; again: string }): LessonFeedback["close"] {
  if (forced === "unscored") return { kind: "unscored", text: texts.unscored };
  if (repair.status === "none-needed") {
    if (mistakes.length === 0 && unscored.length > 0) return { kind: "unscored", text: texts.unscored };
    return { kind: "none-needed", text: texts.none };
  }
  if (repair.status === "available" || repair.status === "open") return { kind: "pending", text: "" };
  if (repair.outcome === "corrected-with-practice") return { kind: "corrected-with-practice", text: texts.corrected };
  if (repair.outcome === "skipped" || repair.outcome === "practice-again") return { kind: "practice-again", text: texts.again };
  return { kind: "pending", text: "" };
}

function labelLessonFeedback(state: MissionState, content: LearningContent, visit: VisitRecord, r: TypingLabelRecord): LessonFeedback {
  void content;
  const fb = feedbackOf(state);
  // The label stores its typed text; the mismatches of a record saved before this build are reconstructed from that stored text (nothing invented).
  const errors = r.errors ?? typingErrors([r.target], [r.typed]);
  const fid = `label:${r.taskId}@${r.at}`;
  const grouped = groupTypingErrors(errors, {}, false);
  const mistakes = [...grouped.mistakes.map((m) => ({ ...m, correction: `Auf dem Schild steht „${r.target}“.`, visual: { kind: "label" as const, target: r.target, typed: r.typed } })), ...grouped.extras];
  const success = errors.length === 0 ? { text: `Das Schild „${r.target}“ ist genau so geschrieben.`, basis: `label ${r.taskId} clean` } : r.correctChars > 0 ? { text: `${r.correctChars} von ${Math.max(r.expectedChars, r.typedChars)} Zeichen des Schilds richtig.`, basis: `label ${r.taskId} ${r.correctChars}/${Math.max(r.expectedChars, r.typedChars)}` } : null;
  const record = fb.repairs.find((x) => x.id === fid) ?? null;
  // A label written wrong at its single step gets its own bounded repair (F2): the target shown, up to two attempts to write it exactly.
  const repair = mistakes.length && record ? repairViewFrom(record, "label", fid, `label:${r.taskId}`, { title: "So steht es auf dem Schild", text: `Schreib es genau so: „${r.target}“. Vergleiche Buchstabe für Buchstabe.`, visual: { kind: "label", target: r.target, typed: r.typed }, recorded: false }, labelRetryItems(r.taskId, r.target)) : NO_REPAIR;
  const close = closeOf(repair, mistakes, [], null, {
    none: mistakes.length ? `Dein Schild hängt so, wie du es geschrieben hast: „${r.typed}“.` : "Das Schild hängt.",
    unscored: "",
    corrected: `Mit Üben korrigiert: das Schild „${r.target}“ ist jetzt genau geschrieben.`,
    again: `Das Schild hängt so, wie du es geschrieben hast: „${r.typed}“. Genaues Abschreiben üben wir nochmal.`,
  });
  return { id: fid, visit: visit.id, lesson: { kind: "typing", ref: r.taskId, title: "Schild schreiben" }, at: r.at, success, mistakes, unscored: [], pattern: mistakes[0] ?? null, repair, close, acknowledged: fb.acknowledged.includes(fid) };
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

const FOCUS_MATH = (kind: "sharing" | "remainder") => `math:${kind}`;
const MATH_EXPLAIN_SUPPORT = ["clarification", "representation", "example", "direct_teaching", "counters"] as const;

function mathVisual(content: LearningContent, id: ScoredMathItemId): MistakeVisual {
  const def = mathItem(content, id);
  if (def.kind === "remainder" && def.answers && def.perGroup) return { kind: "remainder", quantity: def.quantity, groups: def.groups, perGroup: def.perGroup, used: def.answers.used, remaining: def.answers.remaining, unit: def.unit.plural, group: def.group.plural, usedWord: usedWordOf(def).past };
  return { kind: "sharing", quantity: def.quantity, groups: def.groups, answer: def.answer, unit: def.unit.plural, group: def.group.singular };
}

function mathCorrection(content: LearningContent, id: ScoredMathItemId): string {
  const def = mathItem(content, id);
  if (def.kind === "remainder" && def.answers && def.perGroup) return `${def.groups} ${def.group.plural} × ${def.perGroup} = ${def.answers.used} ${def.unit.plural} ${usedWordOf(def).past}, ${def.quantity} − ${def.answers.used} = ${def.answers.remaining} übrig.`;
  return `${def.quantity} ${def.unit.plural} ÷ ${def.groups} = ${def.answer} pro ${def.group.singular.split("/")[0]}.`;
}

function mathAnswerText(a: MathAttempt, isRemainder: boolean, usedWord = "gepflanzt"): string {
  if (a.correct === null) return a.raw ? `„${a.raw}“` : "(unklar)";
  if (isRemainder && a.remainder) return `${a.remainder.used ?? "?"} ${usedWord}, ${a.remainder.remaining ?? "?"} übrig`;
  return String(a.answer ?? a.raw);
}

function mathLessonFeedback(state: MissionState, content: LearningContent, visit: VisitRecord, id: ScoredMathItemId, item: MathItemState): LessonFeedback {
  const fb = feedbackOf(state);
  const def = mathItem(content, id);
  const isRemainder = def.kind === "remainder";
  const at = item.resolvedAt ?? visit.startedAt;
  const fid = `math:${id}@${at}`;
  const attempts = item.attempts.filter((a) => belongsTo(visit, a));
  const incorrect = attempts.filter((a) => a.correct === false);
  const unscoredAttempts = attempts.filter((a) => a.correct === null);
  const correct = attempts.find((a) => a.correct === true) ?? null;
  const usedWord = usedWordOf(def).past;
  const expected = isRemainder && def.answers ? `${def.answers.used} ${usedWord}, ${def.answers.remaining} übrig` : `${def.answer} pro ${def.group.singular.split("/")[0]}`;
  const focus = FOCUS_MATH(isRemainder ? "remainder" : "sharing");
  const grouped = new Map<string, { count: number; refs: string[] }>();
  for (const a of incorrect) {
    const text = mathAnswerText(a, isRemainder, usedWord);
    const g = grouped.get(text) ?? { count: 0, refs: [] };
    g.count += 1;
    g.refs.push(`Versuch ${a.no}`);
    grouped.set(text, g);
  }
  const mistakes: Mistake[] = [...grouped.entries()].map(([given, g]) => ({ id: `answer:${given}`, evidence: "incorrect" as const, focus, count: g.count, given, expected, correction: def.clarification ?? mathCorrection(content, id), visual: mathVisual(content, id), refs: g.refs }));
  const unscored: Mistake[] = unscoredAttempts.map((a) => ({ id: `unscored:${a.no}`, evidence: "unscored" as const, focus: null, count: 1, given: mathAnswerText(a, isRemainder, usedWord), expected: "—", correction: a.uncertainty === "transcript" ? "Da war keine klare Zahl dabei — nicht bewertet." : "Nicht bewertet.", visual: null, refs: [`Versuch ${a.no}`] }));
  let success: LessonFeedback["success"] = null;
  const unit = isRemainder && def.answers ? `${def.quantity} ${def.unit.plural} auf ${def.groups} ${def.group.plural}: ${def.answers.used} ${usedWord}, ${def.answers.remaining} übrig` : `${def.quantity} ${def.unit.plural} gerecht auf ${def.groups} ${def.group.plural} verteilt`;
  if (correct && correct.evidence === "independent") success = { text: `${unit} — ohne Hilfe${correct.no === 1 ? ", beim ersten Versuch" : ""}.`, basis: `attempt ${id}#${correct.no} independent` };
  else if (correct) success = { text: `${unit} — ${correct.support.length ? "mit Hilfe" : "nach einem neuen Versuch"} gelöst.`, basis: `attempt ${id}#${correct.no} ${correct.evidence}` };
  else if (item.outcome === "taught") success = { text: `${unit} — zusammen gelöst.`, basis: `${id} taught` };
  // The in-item loop (clarification → representation/example → teach or stop) IS the bounded repair for math; its explanation is
  // "recorded" only when a durable support event of that kind exists on the item (never from the mere existence of the texts).
  const explained = item.supportGiven.some((k) => (MATH_EXPLAIN_SUPPORT as readonly string[]).includes(k)) || item.outcome === "taught";
  const explanation = { title: isRemainder ? `Erst die vollen ${def.group.plural}, dann der Rest` : "Gleich viele für alle", text: def.representation ?? mathCorrection(content, id), visual: mathVisual(content, id), recorded: explained };
  const retriesAfterFirstWrong: RepairRetry[] = incorrect.length ? attempts.filter((a) => a.no > incorrect[0].no).map((a, i) => ({ no: i + 1, item: id, purpose: "correct-original" as const, at: a.at, result: a.correct === null ? ("unscored" as const) : a.correct ? ("correct" as const) : ("incorrect" as const), focusErrors: a.correct === false ? 1 : 0, lineErrors: a.correct === false ? 1 : 0, seconds: 0 })) : [];
  const repair: RepairView = mistakes.length === 0 ? NO_REPAIR : { status: "closed", kind: null, repairId: fid, focus, explanation, items: [], retries: retriesAfterFirstWrong, used: 0, remaining: 0, outcome: correct ? "corrected-with-practice" : "practice-again" };
  let close: LessonFeedback["close"];
  if (mistakes.length === 0 && correct) close = { kind: "none-needed", text: "Richtig gelöst." };
  else if (mistakes.length === 0 && item.outcome === "stopped") close = { kind: "unscored", text: "Hier hast du pausiert — nichts wurde als falsch gespeichert." };
  else if (mistakes.length === 0 && item.outcome === "taught") close = { kind: "practice-again", text: "Zusammen gelöst — so eine Aufgabe üben wir nochmal." };
  else if (correct) close = { kind: "corrected-with-help", text: `Korrigiert${correct.support.length ? " — mit Hilfe" : ""}: ${expected}. Beim nächsten Mal gibt es einen kurzen Hinweis.` };
  else if (item.outcome === "taught") close = { kind: "practice-again", text: "Wir haben es zusammen gelöst — so eine Aufgabe üben wir nochmal." };
  else close = { kind: "practice-again", text: "Hier hast du pausiert — so eine Aufgabe üben wir nochmal." };
  const title = `Mathe: ${def.quantity} ${def.unit.plural} · ${def.groups} ${def.group.plural}${isRemainder ? " (mit Rest)" : ""}`;
  return { id: fid, visit: visit.id, lesson: { kind: "math", ref: id, title }, at, success, mistakes, unscored, pattern: mistakes[0] ?? null, repair, close, acknowledged: fb.acknowledged.includes(fid) };
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/** The concrete word a step teaches: the supply to pick, or the produce step's first keyword. */
function stepWord(step: LanguageStep): string | null {
  if (step.kind === "pick-supply") return step.answer;
  if (step.kind === "produce") return step.keywords[0] ?? null;
  return null;
}
const FOCUS_LANGUAGE = (language: "en" | "es", word: string) => `language:${language}:${word.toLowerCase()}`;

/** Every word a segment offers an opportunity for (pick answers, produce keywords, gloss words). */
function segmentWords(segment: ReturnType<typeof languageSegment>): Set<string> {
  const words = new Set<string>();
  for (const s of segment.steps) {
    const w = stepWord(s);
    if (w) words.add(w.toLowerCase());
    if (s.kind === "produce") for (const k of s.keywords) words.add(k.toLowerCase());
  }
  for (const g of segment.glosses) words.add(g.word.toLowerCase());
  return words;
}

/** Steps whose LAST record in these records is a confirmed wrong answer (the step's reviewed tries are used up). */
/** Steps with a confirmed wrong record and no LATER correct record on the same step. An unscored record (unclear production)
 *  never resolves the earlier confirmed error; neither does a correct record on another step (repair round 2, R2-2). */
function unresolvedWrongSteps(segment: ReturnType<typeof languageSegment>, records: LanguageStepRecord[]): LanguageStep[] {
  return segment.steps.filter((s) => {
    const onStep = records.filter((r) => r.stepId === s.id);
    const firstWrong = onStep.findIndex((r) => r.correct === false);
    return firstWrong >= 0 && !onStep.slice(firstWrong + 1).some((r) => r.correct === true);
  });
}

/** The reviewed gloss of a step's word as a retry cue (title, example sentence, word visual). */
function languageCue(content: LearningContent, segment: ReturnType<typeof languageSegment>, step: LanguageStep): RetryCue | null {
  const word = stepWord(step);
  if (!word) return null;
  const label = (supply: string) => content.language.supplyLabels[supply]?.de ?? supply;
  const emoji = (supply: string) => content.language.supplyLabels[supply]?.emoji ?? null;
  const gloss = segment.glosses.find((g) => g.word.toLowerCase() === word.toLowerCase()) ?? null;
  return { word, title: `${word} = ${gloss?.de ?? label(word)}`, text: gloss?.example ?? `„${word}“ heisst ${label(word)}.`, visual: { kind: "word", word, gloss: gloss?.de ?? label(word), emoji: emoji(word), language: segment.language } };
}

function languageLessonFeedback(state: MissionState, content: LearningContent, visit: VisitRecord, id: LanguageSegmentId): LessonFeedback {
  const fb = feedbackOf(state);
  const segment = languageSegment(content, id);
  const seg = state.language[id]!;
  const records = seg.records.filter((r) => belongsTo(visit, r));
  const at = records.length ? records[records.length - 1].at : visit.startedAt;
  const fid = `language:${id}@${at}`;
  const label = (supply: string) => content.language.supplyLabels[supply]?.de ?? supply;
  const emoji = (supply: string) => content.language.supplyLabels[supply]?.emoji ?? null;
  const mistakes: Mistake[] = [];
  const unscored: Mistake[] = [];
  for (const step of segment.steps) {
    const onStep = records.filter((r) => r.stepId === step.id);
    const word = stepWord(step);
    const focus = word ? FOCUS_LANGUAGE(segment.language, word) : null;
    if (step.kind === "pick-supply") {
      for (const r of onStep.filter((x) => x.correct === false)) {
        const key = `pick:${step.id}:${r.response}`;
        const existing = mistakes.find((m) => m.id === key);
        if (existing) {
          existing.count += 1;
          existing.refs.push(`${step.id} #${onStep.indexOf(r) + 1}`);
        } else mistakes.push({ id: key, evidence: "incorrect", focus, count: 1, given: label(r.response), expected: label(step.answer), correction: step.correction ?? `Gesucht war „${step.answer}“ = ${label(step.answer)}.`, visual: { kind: "word", word: step.answer, gloss: label(step.answer), emoji: emoji(step.answer), language: segment.language }, refs: [`${step.id} #${onStep.indexOf(r) + 1}`] });
      }
    } else if (step.kind === "produce") {
      const gloss = segment.glosses.find((g) => step.keywords.some((k) => k.toLowerCase() === g.word.toLowerCase())) ?? segment.glosses[0] ?? null;
      for (const r of onStep) {
        if (r.correct === true) continue;
        const ref = `${step.id} #${onStep.indexOf(r) + 1}`;
        if (r.correct === false) mistakes.push({ id: `produce:${step.id}:${r.response}`, evidence: "incorrect", focus, count: 1, given: `„${r.response}“`, expected: step.target, correction: step.correction ?? `Gesucht: ${step.target}`, visual: gloss ? { kind: "word", word: gloss.word, gloss: gloss.de, emoji: emoji(step.keywords[0] ?? ""), language: segment.language } : null, refs: [ref] });
        else unscored.push({ id: `unscored:${step.id}:${onStep.indexOf(r) + 1}`, evidence: "unscored", focus: null, count: 1, given: `„${r.response}“`, expected: step.target, correction: /^unclear/.test(r.uncertainty ?? "") ? step.unclear ?? "Das konnte keiner Antwort zugeordnet werden — nicht bewertet." : step.clarification ?? "Fast — nicht bewertet.", visual: null, refs: [ref] });
      }
    }
  }
  const wrongSteps = unresolvedWrongSteps(segment, records);
  const production = records.find((r) => r.evidence === "production" && r.correct === true) ?? null;
  const completion = records.find((r) => r.evidence === "completion" && r.correct === true) ?? null;
  const recognitions = records.filter((r) => r.evidence === "recognition" && r.correct === true);
  let success: LessonFeedback["success"] = null;
  if (production) success = { text: `Du hast ${segment.language === "es" ? "auf Spanisch" : "auf Englisch"} gesagt: „${production.response}“${production.support.length ? " — mit Hilfe" : " — ohne Hilfe"}.`, basis: `${id}/${production.stepId} production correct (${production.support.join(",") || "no help"})` };
  else if (completion) success = { text: `Du hast das richtige Wort eingesetzt: „${completion.response}“${completion.support.length ? " — mit Hilfe" : ""}.`, basis: `${id}/${completion.stepId} completion correct` };
  else if (recognitions.length) success = { text: `Du hast die richtige Lieferung erkannt (${recognitions.map((r) => label(r.response)).join(", ")})${recognitions.some((r) => r.support.length) ? " — mit Hilfe" : ""}.`, basis: `${id} recognition correct ×${recognitions.length}` };

  // Retries (F4): only SAME-ITEM retries after a confirmed wrong record on that step, keeping unscored as unscored, plus the segment's
  // reuse pick as the fresh check of a wrong pick. Unrelated later work (a production after a wrong pick) is never a retry.
  const inLoop: RepairRetry[] = [];
  const firstWrongByStep = new Map<string, LanguageStepRecord>();
  for (const r of records) if (r.correct === false && !firstWrongByStep.has(r.stepId)) firstWrongByStep.set(r.stepId, r);
  for (const [stepId, first] of firstWrongByStep) {
    for (const r of records.filter((x) => x.stepId === stepId && x.at > first.at)) {
      inLoop.push({ no: 0, item: `${id}/${stepId}`, purpose: "correct-original", at: r.at, result: r.correct === null ? "unscored" : r.correct ? "correct" : "incorrect", focusErrors: r.correct === false ? 1 : 0, lineErrors: r.correct === false ? 1 : 0, seconds: 0, text: r.response });
    }
    if (stepId === "pick") {
      const reuse = records.find((x) => x.stepId === "reuse" && x.at > first.at && x.correct !== null);
      if (reuse) inLoop.push({ no: 0, item: `${id}/reuse`, purpose: "fresh-check", at: reuse.at, result: reuse.correct ? "correct" : "incorrect", focusErrors: reuse.correct ? 0 : 1, lineErrors: reuse.correct ? 0 : 1, seconds: 0, text: reuse.response });
    }
  }
  inLoop.sort((a, b) => (a.at < b.at ? -1 : 1));
  // The reviewed correction/gloss is "recorded" only when a durable support record exists: an opened gloss, played audio, a tutor turn
  // or the feedback that an earlier incorrect record carried into a later record's support list.
  const explained = seg.help.gloss.length > 0 || seg.help.audio.length > 0 || seg.help.tutor > 0 || records.some((r) => r.support.includes("feedback") || r.support.includes("retry"));
  const firstMistakeStep = segment.steps.find((s) => mistakes.some((m) => m.id.includes(`:${s.id}:`))) ?? null;
  const focusWord = wrongSteps.length ? stepWord(wrongSteps[0]) : firstMistakeStep ? stepWord(firstMistakeStep) : null;
  const gloss = focusWord ? segment.glosses.find((g) => g.word.toLowerCase() === focusWord.toLowerCase()) ?? null : null;
  const explanation = focusWord ? { title: `${focusWord} = ${gloss?.de ?? label(focusWord)}`, text: gloss?.example ?? `„${focusWord}“ heisst ${label(focusWord)}.`, visual: { kind: "word" as const, word: focusWord, gloss: gloss?.de ?? label(focusWord), emoji: emoji(focusWord), language: segment.language }, recorded: explained } : null;
  void emoji;
  // A step still wrong at the segment's end (its reviewed tries used up) gets its own bounded repair (F2): the same reviewed step again.
  const record = fb.repairs.find((r) => r.id === fid) ?? null;
  let repair: RepairView;
  if (mistakes.length === 0) repair = NO_REPAIR;
  else if (wrongSteps.length && focusWord) {
    const items = languageRetryItems(content, id, wrongSteps, state);
    repair = repairViewFrom(record, "language", fid, FOCUS_LANGUAGE(segment.language, focusWord), explanation, items);
    repair = { ...repair, retries: [...inLoop, ...(record?.retries ?? [])].map((r, i) => ({ ...r, no: i + 1 })) };
  } else repair = { status: "closed", kind: null, repairId: fid, focus: focusWord ? FOCUS_LANGUAGE(segment.language, focusWord) : null, explanation, items: [], retries: inLoop.map((r, i) => ({ ...r, no: i + 1 })), used: 0, remaining: 0, outcome: "corrected-with-practice" };
  const unresolvedUnscored = segment.steps.some((s) => {
    const last = records.filter((r) => r.stepId === s.id).pop() ?? null;
    return last && last.evidence === "production" && last.correct === null;
  });
  let close: LessonFeedback["close"];
  // Honest readback (repair round 3): "corrected" only when EVERY step still unresolved in the records was corrected by its own retry
  // — a record persisted by an earlier round that closed as corrected with a third step never offered reads back as practice-again,
  // with its recorded attempts untouched and nothing fabricated.
  const correctedEveryStep = wrongSteps.length > 0 && wrongSteps.every((step) => {
    const onItem = (record?.retries ?? []).filter((x) => x.item === `${id}/${step.id}` && x.result !== "unscored");
    return onItem.length > 0 && onItem[onItem.length - 1].result === "correct";
  });
  const resolvedByRetry = wrongSteps.length ? correctedEveryStep : repair.retries.some((r) => r.result === "correct");
  if (mistakes.length === 0 && unscored.length === 0) close = { kind: "none-needed", text: "Alles richtig." };
  else if (mistakes.length === 0) close = { kind: "unscored", text: unresolvedUnscored ? "Eine Antwort blieb unbewertet — kein Fehler, nur unklar." : "Eine Antwort war erst unklar, dann hat es geklappt." };
  else if (repair.status === "available" || repair.status === "open") close = { kind: "pending", text: "" };
  else if (repair.outcome === "corrected-with-practice" && resolvedByRetry) close = { kind: "corrected-with-practice", text: "Mit Üben korrigiert: nach dem Hinweis hat es gestimmt." };
  else close = { kind: "practice-again", text: wrongSteps.length > 1 ? "Die Wörter üben wir nochmal — beim nächsten Mal gibt es einen Hinweis." : "Das Wort üben wir nochmal — beim nächsten Mal gibt es einen Hinweis." };
  return { id: fid, visit: visit.id, lesson: { kind: "language", ref: id, title: `${segment.language === "es" ? "Español" : "English"}: ${segment.title}` }, at, success, mistakes, unscored, pattern: mistakes[0] ?? null, repair, close, acknowledged: fb.acknowledged.includes(fid) };
}

/** Retry items for the steps still wrong at a segment's end: the same reviewed pick (with its options) or the same produce frame; at most three. */
/** A language repair offers every unresolved reviewed step of the segment — pick, produce and reuse — at most three (the brief's
 *  one to three targeted items), one bounded attempt each (repair round 3). */
export const MAX_LANGUAGE_ITEMS = 3;

export function languageRetryItems(content: LearningContent, id: LanguageSegmentId, wrongSteps: LanguageStep[], state: Pick<MissionState, "station">): RetryItem[] {
  const items: RetryItem[] = [];
  const segment = languageSegment(content, id);
  for (const step of wrongSteps) {
    if (items.length >= MAX_LANGUAGE_ITEMS) break;
    if (step.kind === "pick-supply") {
      const themeKey = state.station?.theme ?? "none";
      const sentence = step.variants?.[themeKey] ?? step.variants?.none ?? step.sentence;
      const cue = languageCue(content, segment, step);
      if (!cue) continue;
      items.push({ no: items.length + 1, item: `${id}/${step.id}`, purpose: "correct-original", kind: "pick", text: sentence, stepId: step.id, options: step.options.map((o) => ({ id: o, label: content.language.supplyLabels[o]?.de ?? o, emoji: content.language.supplyLabels[o]?.emoji ?? "📦" })), cue });
    } else if (step.kind === "produce") {
      const cue = languageCue(content, segment, step);
      if (!cue) continue;
      items.push({ no: items.length + 1, item: `${id}/${step.id}`, purpose: "correct-original", kind: "produce", text: step.target, stepId: step.id, frame: step.frame, cue });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Writing (spacing revision + fresh transfer sentence)
// ---------------------------------------------------------------------------

const FOCUS_SPACING = "spacing:rule";

function writingLessonFeedback(state: MissionState, content: LearningContent, visit: VisitRecord, at: string): LessonFeedback {
  const fb = feedbackOf(state);
  const fid = `writing:${visit.id}@${at}`;
  const revision = state.logRevisions.find((r) => r.visit === visit.id && inVisit(visit, r.at)) ?? null;
  const transfer = (state.transfers ?? []).find((t) => t.visit === visit.id && inVisit(visit, t.at)) ?? null;
  const joins = content.writing?.spacing.joins ?? [];
  const mistakes: Mistake[] = [];
  const unscored: Mistake[] = [];
  // F1: only a TYPED, assessable, flagged sentence is a confirmed spacing error; spoken text's spacing comes from the transcription.
  const transferFlagged = !!transfer && transfer.text !== null && transfer.modality === "typed" && transfer.outcome === "flagged";
  const transferFlags = transfer && transfer.text ? flagSpacing(transfer.text, joins) : [];
  if (revision && revision.flagged.length > 0) {
    mistakes.push({ id: "spacing:page", evidence: "incorrect", focus: FOCUS_SPACING, count: revision.flagged.length, given: revision.original, expected: "Leerzeichen an den markierten Stellen", correction: "Zwischen Wörtern, und zwischen Wort und Zahl, kommt ein Leerzeichen.", visual: { kind: "spacing", marked: markSpacing(revision.original, revision.flagged) }, refs: ["Logbuchseite"] });
  }
  if (transferFlagged && transfer?.text) {
    mistakes.push({ id: "spacing:transfer", evidence: "incorrect", focus: FOCUS_SPACING, count: transfer.flagged.length, given: transfer.text, expected: "Leerzeichen an den markierten Stellen", correction: "Auch im neuen Satz: ein Leerzeichen zwischen Wort und Zahl.", visual: { kind: "spacing", marked: markSpacing(transfer.text, transferFlags) }, refs: ["Neuer Satz"] });
  }
  if (transfer && transfer.text && (transfer.outcome === "unassessable" || transfer.modality === "spoken")) {
    unscored.push({ id: "transfer:unscored", evidence: "unscored", focus: null, count: 1, given: transfer.text, expected: "—", correction: transfer.modality === "spoken" ? "Gesprochen: die Leerzeichen kommen von der Aufnahme — nicht bewertet." : "Keine der geprüften Stellen kommt im Satz vor — nicht bewertet.", visual: null, refs: ["Neuer Satz"] });
  }
  let success: LessonFeedback["success"] = null;
  if (transfer && transfer.outcome === "clean" && (transfer.assessed ?? 0) > 0 && transfer.modality === "typed") success = { text: `Dein neuer Satz hatte an ${transfer.assessed} geprüften ${transfer.assessed === 1 ? "Stelle" : "Stellen"} das Leerzeichen richtig${transfer.helpExposed ? " — nach der Hilfe von vorhin" : " — ganz ohne Hilfe"}.`, basis: `transfer ${transfer.id} clean ${transfer.assessed} assessed` };
  else if (revision && revision.outcome === "revised") success = { text: "Auf deiner Logbuchseite hast du die Leerzeichen selbst eingesetzt.", basis: `revision resolved ${revision.resolved}/${revision.flagged.length}` };
  else if (revision && revision.outcome === "no-flags") success = { text: "Auf deiner Logbuchseite fehlte an den geprüften Stellen kein Leerzeichen.", basis: "revision no-flags" };
  // The revision IS the correction of the page (correct-original) and a typed transfer the fresh check of the page's rule — only when the
  // page had a flag; a transfer error with a clean page is a NEW first error (F2), repaired below, never relabelled as a retry.
  const inLoop: RepairRetry[] = [];
  const pageHadFlags = !!revision && revision.flagged.length > 0;
  if (pageHadFlags && revision && revision.outcome !== "skipped") inLoop.push({ no: 1, item: "revision", purpose: "correct-original", at: revision.at, result: revision.outcome === "revised" ? "correct" : "incorrect", focusErrors: revision.flagged.length - revision.resolved, lineErrors: revision.flagged.length - revision.resolved, seconds: 0, text: revision.revised ?? undefined });
  if (pageHadFlags && transfer && transfer.text && transfer.outcome !== "skipped" && transfer.modality === "typed") inLoop.push({ no: inLoop.length + 1, item: transfer.id, purpose: "fresh-check", at: transfer.at, result: transfer.outcome === "unassessable" ? "unscored" : transfer.outcome === "clean" ? "correct" : "incorrect", focusErrors: transfer.outcome === "flagged" ? transfer.flagged.length : 0, lineErrors: transfer.outcome === "flagged" ? transfer.flagged.length : 0, seconds: 0, text: transfer.text });
  const record = fb.repairs.find((r) => r.id === fid) ?? null;
  let repair: RepairView;
  if (mistakes.length === 0) repair = NO_REPAIR;
  else if (transferFlagged && transfer?.text) {
    // The confirmed error at the final step: a bounded repair of the child's OWN sentence with the marked cue (F2).
    const explanation = { title: "Der Strich zeigt, wo ein Leerzeichen fehlt", text: "Zwischen Wörtern, und zwischen Wort und Zahl, kommt ein Leerzeichen. Setz es in deinem Satz ein — Rechtschreibung schauen wir ein andermal an.", visual: { kind: "spacing" as const, marked: markSpacing(transfer.text, transferFlags) }, recorded: false };
    repair = repairViewFrom(record, "writing", fid, FOCUS_SPACING, explanation, sentenceRetryItems(transfer.text, transferFlags));
    repair = { ...repair, retries: [...inLoop, ...(record?.retries ?? [])].map((r, i) => ({ ...r, no: i + 1 })) };
  } else {
    const explanation = revision && pageHadFlags ? { title: "Der Strich zeigt, wo ein Leerzeichen fehlt", text: "Zwischen Wörtern, und zwischen Wort und Zahl, kommt ein Leerzeichen. Rechtschreibung schauen wir ein andermal an.", visual: { kind: "spacing" as const, marked: markSpacing(revision.original, revision.flagged) }, recorded: revision.helpShown } : null;
    const resolved = transfer && transfer.modality === "typed" && transfer.outcome === "clean" ? true : revision?.outcome === "revised";
    repair = { status: "closed", kind: null, repairId: fid, focus: FOCUS_SPACING, explanation, items: [], retries: inLoop, used: 0, remaining: 0, outcome: resolved ? "corrected-with-practice" : "practice-again" };
  }
  const close = closeOf(repair, mistakes, unscored, null, {
    none: "Leerzeichen: alles an seinem Platz.",
    unscored: "Der neue Satz wurde nicht bewertet.",
    corrected: "Mit Üben korrigiert: die Leerzeichen stimmen jetzt.",
    again: "Leerzeichen üben wir nochmal — beim nächsten Logbuch gibt es einen Hinweis.",
  });
  return { id: fid, visit: visit.id, lesson: { kind: "writing", ref: "spacing", title: "Schreiben: Leerzeichen" }, at, success, mistakes, unscored, pattern: mistakes[0] ?? null, repair, close, acknowledged: fb.acknowledged.includes(fid) };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function feedbackForEvent(state: MissionState, content: LearningContent, visit: VisitRecord, event: LessonEvent): LessonFeedback {
  switch (event.kind) {
    case "math":
      return mathLessonFeedback(state, content, visit, event.id, state.math[event.id]!);
    case "language":
      return languageLessonFeedback(state, content, visit, event.id);
    case "typing-burst": {
      const lesson = typingLessonDef(content, event.burst.lessonId);
      const lines = lesson ? lesson.lines.slice(0, event.burst.lineCount ?? lesson.lines.length) : [];
      const roundNo = (state.typing.course?.bursts ?? []).filter((b, i) => i <= event.index && b.lessonId === event.burst.lessonId && b.visit === visit.id && inVisit(visit, b.at)).length;
      return typingLessonFeedback(state, content, visit, { lessonId: event.burst.lessonId, at: event.burst.at, lines, errors: event.burst.errors, correct: event.burst.correctChars, denominator: event.burst.denominator, kindLabel: "burst", roundNo });
    }
    case "typing-lesson": {
      const lesson = typingLessonDef(content, event.record.lessonId);
      return typingLessonFeedback(state, content, visit, { lessonId: event.record.lessonId, at: event.record.at, lines: lesson?.lines ?? [], errors: event.record.errors, correct: event.record.correctChars, denominator: event.record.denominator, kindLabel: "lesson" });
    }
    case "typing-label":
      return labelLessonFeedback(state, content, visit, event.record);
    case "writing":
      return writingLessonFeedback(state, content, visit, event.at);
  }
}

/** Feedback for every lesson that ended in the visit, oldest first. */
export function visitLessonFeedback(state: MissionState, content: LearningContent, visit: VisitRecord): LessonFeedback[] {
  return lessonEvents(state, content, visit).map((e) => feedbackForEvent(state, content, visit, e));
}

/** The most recent lesson that ended in the RUNNING visit and has not been acknowledged yet, or null. */
export function lastLessonFeedback(state: MissionState, content: LearningContent): LessonFeedback | null {
  const running = state.visits.find((v) => v.id === state.currentVisit && v.finishedAt === null) ?? null;
  // A running visit the served content does not define (cap / rollback) is parked: nothing is pending.
  if (!running || !content.visits.some((v) => v.id === running.id)) return null;
  const all = visitLessonFeedback(state, content, running);
  const pending = all.filter((f) => !f.acknowledged);
  return pending.length ? pending[pending.length - 1] : null;
}

function worldChanges(state: MissionState, content: LearningContent, visit: VisitRecord): string[] {
  const out: string[] = [];
  const within = (at: string | null | undefined) => typeof at === "string" && inVisit(visit, at);
  if (visit.id === "v1" && state.base.name) out.push(`Basis „${state.base.name}“ gebaut${state.base.locationId ? ` (${content.locations.find((l) => l.id === state.base.locationId)?.label ?? state.base.locationId})` : ""}.`);
  for (const [id, item] of Object.entries(state.math)) {
    if (!item || !isScoredMathItemId(id) || !hasMathItem(content, id) || !within(item.resolvedAt) || item.outcome === "stopped") continue;
    const def = mathItem(content, id);
    if (id === "EQ-RETURN") out.push("Vier Gartenbeete bepflanzt.");
    else if (id === "EQ-STATION") out.push(`Fünf Stationsbeete bepflanzt${item.remainderResult ? `, ${item.remainderResult.remaining} Setzlinge übrig` : ""}.`);
    else if (id === "EQ-PIER") out.push(`${def.groups} Steg-Abschnitte mit Brettern belegt${item.remainderResult ? `, ${item.remainderResult.remaining} Bretter übrig` : ""}.`);
    else out.push(`${def.quantity} ${def.unit.plural} verteilt.`);
  }
  for (const [id, seg] of Object.entries(state.language)) {
    if (!seg || !isLanguageSegmentId(id) || !hasLanguageSegment(content, id)) continue;
    for (const r of seg.records.filter((x) => belongsTo(visit, x) && x.evidence === "recognition" && x.correct === true)) {
      const step = languageSegment(content, id).steps.find((s) => s.id === r.stepId);
      if (step && step.kind === "pick-supply") out.push(`Lieferung erhalten: ${content.language.supplyLabels[step.answer]?.de ?? step.answer}.`);
    }
  }
  if (state.station?.built && within(state.station.builtAt)) out.push(`Beobachtungsstation gebaut${state.station.lampLit ? " — die Lampe brennt" : " — ohne Lampe"}.`);
  if (state.pier?.built && within(state.pier.builtAt)) out.push(`Steg gebaut${state.pier.boatMoored ? " — das Boot hat angelegt" : " — das Boot wartet noch (kein Holz geliefert)"}.`);
  const labels = state.typing.labels.filter((l) => within(l.at));
  for (const l of labels) out.push(`Schild aufgehängt: „${l.typed}“.`);
  const pages = state.pages.filter((p) => p.visit === visit.id && within(p.at));
  if (pages.length) out.push(`${pages.length === 1 ? "Eine Seite" : `${pages.length} Seiten`} ins Logbuch geschrieben.`);
  return out;
}

/** One report per visit the served content knows: finished visits (complete) and the running one (partial). Oldest first. */
export function buildVisitReports(state: MissionState, content: LearningContent): VisitReport[] {
  const reports: VisitReport[] = [];
  for (const visit of state.visits) {
    const def = content.visits.find((v) => v.id === visit.id);
    if (!def) continue;
    const partial = visit.finishedAt === null;
    reports.push({
      visit: visit.id,
      ordinal: visitOrdinal(state, visit.id),
      label: visitLabel(state, content, visit.id),
      startedAt: visit.startedAt,
      finishedAt: visit.finishedAt,
      partial,
      stagesDone: Math.min(visit.stageIndex, def.stages.length),
      stageCount: def.stages.length,
      summary: buildVisitSummary(state, content, visit.id),
      lessons: visitLessonFeedback(state, content, visit),
      worldChanges: worldChanges(state, content, visit),
    });
  }
  return reports.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Focus lifecycle (called by the state machine after the relevant ops)
// ---------------------------------------------------------------------------

function findFocus(fb: FeedbackState, id: string): PracticeFocus | null {
  return fb.focus.find((f) => f.id === id) ?? null;
}

/** Open (or re-open) a focus from a confirmed mistake. Idempotent for an already-open focus (evidence refreshed). */
export function openFocus(fb: FeedbackState, input: { id: string; kind: PracticeFocusKind; key: string; nowIso: string; visit: VisitId; lesson: string; evidence: string }): FeedbackState {
  const existing = findFocus(fb, input.id);
  if (existing && existing.status === "open") {
    return { ...fb, focus: fb.focus.map((f) => (f.id === input.id ? { ...f, evidence: input.evidence, openedIn: { visit: input.visit, lesson: input.lesson }, openedAt: f.openedAt } : f)) };
  }
  if (existing) {
    return { ...fb, focus: fb.focus.map((f) => (f.id === input.id ? { ...f, status: "open", openedAt: input.nowIso, openedIn: { visit: input.visit, lesson: input.lesson }, evidence: input.evidence, retiredAt: null, retiredBy: null, reopened: f.reopened + 1 } : f)) };
  }
  return { ...fb, focus: [...fb.focus, { id: input.id, kind: input.kind, key: input.key, openedAt: input.nowIso, openedIn: { visit: input.visit, lesson: input.lesson }, evidence: input.evidence, status: "open", retiredAt: null, retiredBy: null, reopened: 0 }] };
}

/** Retire an open focus on a suitable later independent check; no-op otherwise. */
export function retireFocus(fb: FeedbackState, id: string, nowIso: string, by: string): FeedbackState {
  const existing = findFocus(fb, id);
  if (!existing || existing.status !== "open") return fb;
  return { ...fb, focus: fb.focus.map((f) => (f.id === id ? { ...f, status: "retired", retiredAt: nowIso, retiredBy: by } : f)) };
}

/**
 * After a FULL typing round (never a retry): keys with a confirmed mismatch open a focus;
 * keys present in the round and typed without any mismatch retire a focus that was opened
 * EARLIER (a later independent check). The round that opens a focus can never retire it.
 */
export function updateTypingFocus(fb: FeedbackState, input: { lessonId: string; lines: readonly string[]; errors: TypingError[]; at: string; visit: VisitId; fingers: Record<string, string> }): FeedbackState {
  let next = fb;
  const keys = lessonKeys(input.lines);
  const errorKeys = new Map<string, number>();
  for (const e of input.errors) if (e.kind !== "extra" && e.expected) errorKeys.set(e.expected, (errorKeys.get(e.expected) ?? 0) + 1);
  for (const key of keys) {
    const id = FOCUS_TYPING(key);
    const n = errorKeys.get(key) ?? 0;
    if (n > 0) {
      const typed = input.errors.filter((e) => e.kind === "substitute" && e.expected === key).map((e) => e.typed ?? "?");
      const mostTyped = typed.sort((a, b) => typed.filter((x) => x === b).length - typed.filter((x) => x === a).length)[0] ?? null;
      const evidence = `Letzte Runde (${input.lessonId.replace("TYPE-CH-COURSE-", "Lektion ")}): „${KEY_LABEL(key)}“ ${n}× nicht getroffen${mostTyped ? ` — stattdessen „${KEY_LABEL(mostTyped)}“` : ""}.`;
      next = openFocus(next, { id, kind: "typing-key", key, nowIso: input.at, visit: input.visit, lesson: `typing:${input.lessonId}`, evidence });
    } else {
      const open = findFocus(next, id);
      if (open && open.status === "open" && open.openedAt < input.at) next = retireFocus(next, id, input.at, `Runde ${input.lessonId} am ${input.at}: „${KEY_LABEL(key)}“ fehlerfrei`);
    }
  }
  return next;
}

/** After a scored math item is resolved: a confirmed wrong attempt opens the focus; a later item OF THE SAME KIND solved independently (first attempt, no support) retires it. */
export function updateMathFocus(fb: FeedbackState, content: LearningContent, input: { id: ScoredMathItemId; item: MathItemState; at: string; visit: VisitId }): FeedbackState {
  const def = mathItem(content, input.id);
  const kind: "sharing" | "remainder" = def.kind === "remainder" ? "remainder" : "sharing";
  const focusId = FOCUS_MATH(kind);
  const attempts = input.item.attempts;
  const incorrect = attempts.filter((a) => a.correct === false);
  if (incorrect.length > 0 || input.item.outcome === "taught" || input.item.outcome === "stopped") {
    const first = incorrect[0] ?? null;
    const expected = def.kind === "remainder" && def.answers ? `${def.answers.used} ${usedWordOf(def).past}, ${def.answers.remaining} übrig` : `${def.answer}`;
    const evidence = first ? `Letztes Mal (${def.quantity} ${def.unit.plural} auf ${def.groups} ${def.group.plural}): du hattest ${mathAnswerText(first, def.kind === "remainder", usedWordOf(def).past)}, richtig war ${expected}.` : `Letztes Mal (${def.quantity} ${def.unit.plural} auf ${def.groups} ${def.group.plural}) haben wir ${input.item.outcome === "taught" ? "zusammen gelöst" : "pausiert"}.`;
    return openFocus(fb, { id: focusId, kind: "math", key: kind, nowIso: input.at, visit: input.visit, lesson: `math:${input.id}`, evidence });
  }
  const correct = attempts.find((a) => a.correct === true) ?? null;
  const open = findFocus(fb, focusId);
  if (correct && correct.evidence === "independent" && open && open.status === "open" && open.openedIn.lesson !== `math:${input.id}`) {
    return retireFocus(fb, focusId, input.at, `${input.id} am ${input.at}: ohne Hilfe richtig`);
  }
  return fb;
}

/**
 * After a language segment is done: a step still wrong at the end opens the focus for ITS word; a later segment with an independent
 * correct record on a step for the SAME word retires it. Other correct work in the language never retires a word's focus.
 */
export function updateLanguageFocus(fb: FeedbackState, content: LearningContent, input: { id: LanguageSegmentId; records: LanguageStepRecord[]; at: string; visit: VisitId }): FeedbackState {
  const segment = languageSegment(content, input.id);
  const label = (supply: string) => content.language.supplyLabels[supply]?.de ?? supply;
  let next = fb;
  for (const step of segment.steps) {
    const word = stepWord(step);
    if (!word) continue;
    const focusId = FOCUS_LANGUAGE(segment.language, word);
    const onStep = input.records.filter((r) => r.stepId === step.id);
    const last = onStep[onStep.length - 1] ?? null;
    const firstWrong = onStep.find((r) => r.correct === false) ?? null;
    const anyWrong = firstWrong !== null;
    if (firstWrong) {
      // Like math: a confirmed wrong record on the step opens the word's focus, even when a later try (helped by the feedback) was right.
      const evidence = step.kind === "pick-supply" ? `Letztes Mal: „${step.answer}“ heisst ${label(step.answer)} — du hattest ${label(firstWrong.response)} gewählt.` : `Letztes Mal: gesucht war „${(step as Extract<LanguageStep, { kind: "produce" }>).target}“ — du hattest „${firstWrong.response}“.`;
      next = openFocus(next, { id: focusId, kind: "language", key: `${segment.language}:${word.toLowerCase()}`, nowIso: input.at, visit: input.visit, lesson: `language:${input.id}`, evidence });
      continue;
    }
    const open = findFocus(next, focusId);
    // Independent = correct on the first try of this step, no recorded help; a wrong-then-right step in the same segment was helped by feedback.
    const independent = last && last.correct === true && last.support.length === 0 && !anyWrong;
    if (open && open.status === "open" && open.openedIn.lesson !== `language:${input.id}` && independent) next = retireFocus(next, focusId, input.at, `${input.id}/${step.id} am ${input.at}: „${word}“ ohne Hilfe richtig`);
  }
  return next;
}

/** After the transfer sentence: a TYPED flagged sentence opens the spacing focus; a later clean typed transfer WITHOUT prior help retires it. Spoken text never touches the focus. */
export function updateSpacingFocus(fb: FeedbackState, input: { outcome: "clean" | "flagged" | "unassessable" | "skipped"; modality: "typed" | "spoken"; helpExposed: boolean; flagged: number; text: string | null; at: string; visit: VisitId; lesson: string }): FeedbackState {
  if (input.modality !== "typed") return fb;
  if (input.outcome === "flagged") {
    return openFocus(fb, { id: FOCUS_SPACING, kind: "spacing", key: "rule", nowIso: input.at, visit: input.visit, lesson: input.lesson, evidence: `Letztes Mal fehlte${input.flagged === 1 ? " ein Leerzeichen" : `n ${input.flagged} Leerzeichen`} in „${input.text ?? ""}“.` });
  }
  const open = findFocus(fb, FOCUS_SPACING);
  if (input.outcome === "clean" && !input.helpExposed && open && open.status === "open" && open.openedIn.lesson !== input.lesson) return retireFocus(fb, FOCUS_SPACING, input.at, `${input.lesson} am ${input.at}: Leerzeichen ohne Hilfe richtig`);
  return fb;
}

// ---------------------------------------------------------------------------
// Reminder before the next relevant lesson (UX-5c)
// ---------------------------------------------------------------------------

export type ReminderInput = { stage: StageId | null; typingLines: readonly string[] | null; mathKind: "sharing" | "remainder" | null; languageWords: readonly string[] | null; language: "en" | "es" | null };

/** Exactly one relevant open focus for the stage about to start, or null. Never an unrelated subject, never a fallback to another focus. */
export function reminderFor(state: MissionState, content: LearningContent, input: ReminderInput): ReminderCue | null {
  const fb = feedbackOf(state);
  const open = fb.focus.filter((f) => f.status === "open").sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  if (open.length === 0 || !input.stage) return null;
  const label = (f: PracticeFocus) => visitLabel(state, content, f.openedIn.visit);
  const make = (f: PracticeFocus, cue: string, visual: MistakeVisual | null): ReminderCue => ({ focusId: f.id, kind: f.kind, key: f.key, cue, grounding: f.evidence, openedIn: { visit: f.openedIn.visit, lesson: f.openedIn.lesson, label: label(f) }, visual });
  if ((input.stage === "typing-course" || input.stage === "typing") && input.typingLines) {
    const keys = lessonKeys(input.typingLines);
    const f = open.find((x) => x.kind === "typing-key" && keys.includes(x.key));
    if (!f) return null;
    const finger = content.typing.course?.fingers[f.key] ?? content.typing.lessons[0]?.fingers[f.key] ?? null;
    return make(f, `Achte auf „${KEY_LABEL(f.key)}“${finger ? `: ${finger}` : ""}.`, { kind: "key", key: f.key, finger, typed: null });
  }
  if (isScoredMathItemId(input.stage) && input.mathKind) {
    const f = open.find((x) => x.kind === "math" && x.key === input.mathKind);
    if (!f) return null;
    return make(f, f.key === "remainder" ? "Erst alle vollen Gruppen rechnen (Beete, Abschnitte …), dann den Rest." : "Alle bekommen gleich viele — am Ende nachzählen.", null);
  }
  if (isLanguageSegmentId(input.stage) && input.language && input.languageWords) {
    const lang = input.language;
    const words = new Set(input.languageWords.map((w) => w.toLowerCase()));
    const f = open.find((x) => x.kind === "language" && x.key.startsWith(`${lang}:`) && words.has(x.key.slice(lang.length + 1)));
    if (!f) return null;
    const word = f.key.slice(lang.length + 1);
    const gloss = content.language.supplyLabels[word]?.de ?? content.language.segments.flatMap((s) => s.glosses).find((g) => g.word.toLowerCase() === word)?.de ?? null;
    return make(f, `„${word}“${gloss ? ` heisst ${gloss}` : ""} — schau auf das Bild, dann wähle.`, { kind: "word", word, gloss: gloss ?? word, emoji: content.language.supplyLabels[word]?.emoji ?? null, language: lang });
  }
  if (input.stage === "log" || input.stage === "log-revise" || input.stage === "log-transfer") {
    const f = open.find((x) => x.kind === "spacing");
    if (!f) return null;
    return make(f, "Zwischen Wort und Zahl kommt ein Leerzeichen.", null);
  }
  return null;
}

/** The words a segment offers opportunities for (for the reminder relevance input). */
export function languageWordsOf(content: LearningContent, id: LanguageSegmentId): string[] {
  return [...segmentWords(languageSegment(content, id))];
}

// ---------------------------------------------------------------------------
// Repairs (persisted; the state machine calls these inside its ops)
// ---------------------------------------------------------------------------

function openRepair(fb: FeedbackState, repair: Omit<LessonRepair, "explainedAt" | "retries" | "outcome" | "closedAt"> & { items?: string[] }): FeedbackState {
  if (fb.repairs.some((r) => r.id === repair.id)) return fb;
  return { ...fb, repairs: [...fb.repairs, { ...repair, explainedAt: null, retries: [], outcome: "open", closedAt: null }] };
}

/** Create the open repair for a typing round whose pattern warrants practice; no-op when none is warranted or it already exists. */
export function openTypingRepair(fb: FeedbackState, content: LearningContent, input: { lessonId: string; at: string; visit: VisitId; lines: readonly string[]; errors: TypingError[] }): FeedbackState {
  const lesson = typingLessonDef(content, input.lessonId);
  if (!lesson) return fb;
  const id = `typing:${input.lessonId}@${input.at}`;
  const grouped = groupTypingErrors(input.errors, lesson.fingers, true);
  const pattern = grouped.mistakes[0] ?? null;
  if (!pattern || !pattern.focus) return fb;
  const items = typingRetryItems({ ...lesson, lines: [...input.lines] }, pattern.focus.slice("typing-key:".length), input.errors);
  if (items.length === 0) return fb;
  return openRepair(fb, { id, visit: input.visit, kind: "typing", lesson: `typing:${input.lessonId}`, focus: pattern.focus, openedAt: input.at, maxRetries: Math.min(MAX_RETRIES, items.length) });
}

/** A label with a confirmed mismatch gets a bounded repair (write it exactly, ≤ 2 attempts). */
export function openLabelRepair(fb: FeedbackState, input: { taskId: string; target: string; errors: TypingError[]; at: string; visit: VisitId }): FeedbackState {
  if (input.errors.length === 0) return fb;
  return openRepair(fb, { id: `label:${input.taskId}@${input.at}`, visit: input.visit, kind: "label", lesson: `label:${input.taskId}`, focus: `label:${input.taskId}`, openedAt: input.at, maxRetries: 2 });
}

/** A TYPED, flagged transfer sentence (the writing loop's final step) gets a bounded repair of the child's own sentence (≤ 2 attempts). */
export function openWritingRepair(fb: FeedbackState, input: { transferId: string; visit: VisitId; at: string; modality: "typed" | "spoken"; outcome: string; flagged: number }): FeedbackState {
  if (input.modality !== "typed" || input.outcome !== "flagged" || input.flagged === 0) return fb;
  return openRepair(fb, { id: `writing:${input.visit}@${input.at}`, visit: input.visit, kind: "writing", lesson: `writing:${input.transferId}`, focus: FOCUS_SPACING, openedAt: input.at, maxRetries: 2 });
}

/** A language segment that ends with a step still wrong gets a bounded repair of that reviewed step (≤ 2 attempts). */
export function openLanguageRepair(fb: FeedbackState, content: LearningContent, input: { id: LanguageSegmentId; records: LanguageStepRecord[]; at: string; visit: VisitId }): FeedbackState {
  const segment = languageSegment(content, input.id);
  const wrongSteps = unresolvedWrongSteps(segment, input.records);
  if (wrongSteps.length === 0) return fb;
  const word = stepWord(wrongSteps[0]);
  if (!word) return fb;
  const items = languageRetryItems(content, input.id, wrongSteps, { station: undefined });
  if (items.length === 0) return fb;
  // One bounded attempt per unresolved item (at most two items); every offered item stays reachable until it is attempted, skipped or exhausted.
  return openRepair(fb, { id: `language:${input.id}@${input.at}`, visit: input.visit, kind: "language", lesson: `language:${input.id}`, focus: FOCUS_LANGUAGE(segment.language, word), openedAt: input.at, maxRetries: items.length, items: items.map((i) => i.item) });
}

export function findRepair(fb: FeedbackState, id: string): LessonRepair | null {
  return fb.repairs.find((r) => r.id === id) ?? null;
}

export function markRepairExplained(fb: FeedbackState, id: string, nowIso: string): FeedbackState {
  return { ...fb, repairs: fb.repairs.map((r) => (r.id === id && r.explainedAt === null ? { ...r, explainedAt: nowIso } : r)) };
}

export function recordRepairRetry(fb: FeedbackState, id: string, retry: RepairRetry): FeedbackState {
  return { ...fb, repairs: fb.repairs.map((r) => (r.id === id ? { ...r, retries: [...r.retries, retry] } : r)) };
}

/** Close a repair honestly: the last scored retry resolved the focus → corrected with practice; otherwise practice again; skipped when the child moved on without a retry. */
export function closeRepair(fb: FeedbackState, id: string, nowIso: string, reason: "done" | "skip", requiredItems: readonly string[] = []): FeedbackState {
  void reason;
  return {
    ...fb,
    repairs: fb.repairs.map((r) => {
      if (r.id !== id || r.outcome !== "open") return r;
      if (r.retries.length === 0) return { ...r, outcome: "skipped", closedAt: nowIso };
      const scored = r.retries.filter((x) => x.result !== "unscored");
      // Per item (language, repair rounds 2–3): corrected only when EVERY required item's last scored attempt was correct — an item
      // never attempted, skipped, unscored or still wrong keeps the honest "practice again". Required = the inventory the record was
      // opened with plus whatever the state machine offers now (a persisted two-item record with a third unresolved step).
      // Single-focus repairs (typing, label, writing): the last scored attempt decides, as before.
      const required = Array.from(new Set([...(r.items ?? []), ...requiredItems]));
      const corrected = required.length
        ? required.every((item) => {
            const onItem = scored.filter((x) => x.item === item);
            return onItem.length > 0 && onItem[onItem.length - 1].result === "correct";
          })
        : scored.length > 0 && scored[scored.length - 1].result === "correct";
      return { ...r, outcome: corrected ? "corrected-with-practice" : "practice-again", closedAt: nowIso };
    }),
  };
}

export function acknowledgeLesson(fb: FeedbackState, id: string): FeedbackState {
  if (fb.acknowledged.includes(id)) return fb;
  const acknowledged = [...fb.acknowledged, id];
  return { ...fb, acknowledged: acknowledged.length > MAX_ACKNOWLEDGED ? acknowledged.slice(acknowledged.length - MAX_ACKNOWLEDGED) : acknowledged };
}

/** The retry items of a persisted repair, rebuilt from the records it refers to (typing lines, label target, sentence, language steps). */
export function repairItems(state: MissionState, content: LearningContent, repair: LessonRepair): RetryItem[] {
  const atOf = repair.id.slice(repair.id.indexOf("@") + 1);
  if (repair.kind === "typing") {
    const lessonId = repair.lesson.slice("typing:".length);
    const lesson = typingLessonDef(content, lessonId);
    if (!lesson) return [];
    const burst = state.typing.course?.bursts.find((b) => b.lessonId === lessonId && b.at === atOf) ?? null;
    const lessonRecord = state.typing.lessons.find((l) => l.lessonId === lessonId && l.at === atOf) ?? null;
    const errors = burst?.errors ?? lessonRecord?.errors ?? [];
    const lines = burst ? lesson.lines.slice(0, burst.lineCount ?? lesson.lines.length) : lesson.lines;
    return typingRetryItems({ ...lesson, lines }, repair.focus.slice("typing-key:".length), errors);
  }
  if (repair.kind === "label") {
    const taskId = repair.lesson.slice("label:".length);
    const record = state.typing.labels.find((l) => l.taskId === taskId && l.at === atOf) ?? null;
    return record ? labelRetryItems(taskId, record.target) : [];
  }
  if (repair.kind === "writing") {
    const transfer = (state.transfers ?? []).find((t) => t.visit === repair.visit && t.at === atOf) ?? null;
    if (!transfer || !transfer.text) return [];
    return sentenceRetryItems(transfer.text, flagSpacing(transfer.text, content.writing?.spacing.joins ?? []));
  }
  const id = repair.lesson.slice("language:".length) as LanguageSegmentId;
  if (!isLanguageSegmentId(id) || !hasLanguageSegment(content, id) || !state.language[id]) return [];
  const segment = languageSegment(content, id);
  const records = state.language[id]!.records.filter((r) => r.visit === repair.visit || (!r.visit && r.at <= atOf));
  return languageRetryItems(content, id, unresolvedWrongSteps(segment, records), state);
}

/** The retry the child may do next for a repair, or null when the repair is closed or exhausted. */
export function nextRetryItem(state: MissionState, content: LearningContent, repair: LessonRepair): RetryItem | null {
  if (repair.outcome !== "open") return null;
  const items = repairItems(state, content, repair);
  const next = items[repair.retries.length] ?? null;
  if (!next || repair.retries.length >= effectiveMaxRetries(repair, items)) return null;
  return next;
}

/** The bounded attempts of a repair. A language repair gives every currently unresolved item one attempt — also for a record
 *  persisted by an earlier round with a shorter inventory (`maxRetries` 2, two `items`): the third unresolved step stays reachable
 *  instead of being closed away (repair round 3 compatibility). Other kinds keep the record's bound. */
export function effectiveMaxRetries(repair: Pick<LessonRepair, "kind" | "maxRetries">, items: readonly RetryItem[]): number {
  return repair.kind === "language" ? Math.max(repair.maxRetries, items.length) : repair.maxRetries;
}

/** Evaluate a sentence correction attempt against the reviewed rules: how many of the original flags were resolved. */
export function evaluateSentenceRetry(original: string, revised: string, joins: readonly { joined: string; split: string }[]): { resolved: number; total: number; remaining: number } {
  const flags = flagSpacing(original, joins);
  const r = evaluateRevision(original, revised, flags);
  return { resolved: r.resolved, total: r.total, remaining: r.total - r.resolved };
}
