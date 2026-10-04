// ---------------------------------------------------------------------------
// Runtime validation of the ChildView contract consumed by the cockpit and the
// mission workspace (independent M3 r2 review, 2026-09-29).
//
// A successful HTTP response is adopted ONLY if its `view` has the shape the
// surfaces dereference — top-level fields and every nested discriminated
// shape (math item, language step/feedback, typing lesson/label, reflection,
// tutor context, pages, visit, next). A record that merely names the right
// child is not a view; adopting it crashed both surfaces into the generic
// error boundary. Anything incomplete or contradictory is rejected by the
// learning client as `bad-response` (recoverable load error), never rendered.
// Pure and dependency-free so it is unit-tested against real views built by
// the state machine and against malformed probes.
// ---------------------------------------------------------------------------

import { CHILD_IDS, type ChildId } from "./family-assistant-turn.ts";
import type { ChildView, LanguageStepView, MathItemView, TypingView } from "./family-learning-state.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStrOrNull = (v: unknown) => v === null || isStr(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);
const isBoolOrNull = (v: unknown) => v === null || isBool(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isNumRecord = (v: unknown) => isRec(v) && Object.values(v).every(isNum);
const isStrRecord = (v: unknown) => isRec(v) && Object.values(v).every(isStr);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => isStr(v) && (values as readonly string[]).includes(v);
const isNamed = (v: unknown) => isRec(v) && isStr(v.id) && isStr(v.label) && isStr(v.emoji);
const isUnitLike = (v: unknown) => isRec(v) && isStr(v.singular) && isStr(v.plural) && isStr(v.emoji);
const isLabel = (v: unknown) => isRec(v) && isStr(v.taskId) && isStr(v.instruction) && isStr(v.target);

export function isMathItemView(v: unknown): v is MathItemView {
  if (!isRec(v)) return false;
  const example = v.example;
  return (
    isStr(v.id) &&
    isNum(v.version) &&
    isStr(v.prompt) &&
    isStrOrNull(v.scene) &&
    isNum(v.quantity) &&
    isNum(v.groups) &&
    isUnitLike(v.unit) &&
    isUnitLike(v.group) &&
    oneOf(v.phase, ["answer", "clarify", "represent", "example", "teach-or-stop", "done"]) &&
    isNum(v.attemptNo) &&
    isStrOrNull(v.clarification) &&
    isStrOrNull(v.representation) &&
    (example === null || (isRec(example) && isStr(example.prompt) && isStrArray(example.steps) && isNum(example.quantity) && isNum(example.groups) && isNum(example.answer))) &&
    isNumOrNull(v.taughtAnswer) &&
    isBool(v.teachingOffered) &&
    oneOf(v.outcome, ["pending", "correct", "taught", "stopped"])
  );
}

export function isLanguageStepView(v: unknown): v is LanguageStepView {
  if (!isRec(v) || !isStr(v.id) || !isStr(v.instruction)) return false;
  switch (v.kind) {
    case "listen-read":
      return isStr(v.sentence);
    case "pick-supply":
      return isStr(v.sentence) && Array.isArray(v.options) && v.options.every(isNamed);
    case "produce":
      return isStr(v.frame) && isStr(v.target) && isStrArray(v.choices);
    default:
      return false;
  }
}

function isLanguageView(v: unknown): boolean {
  if (!isRec(v)) return false;
  const fb = v.feedback;
  return (
    isStr(v.id) &&
    oneOf(v.language, ["en", "es"]) &&
    isStr(v.title) &&
    (v.step === null || isLanguageStepView(v.step)) &&
    isNum(v.stepIndex) &&
    isNum(v.stepCount) &&
    Array.isArray(v.glosses) &&
    v.glosses.every((g) => isRec(g) && isStr(g.word) && isStr(g.de) && isStr(g.example)) &&
    isBoolOrNull(v.lastCorrect) &&
    (fb === null || (isRec(fb) && oneOf(fb.kind, ["clarify", "incorrect", "unclear"]) && isStr(fb.message) && isNum(fb.triesUsed) && isBool(fb.retryAllowed) && isBool(fb.continueOffered)))
  );
}

export function isTypingView(v: unknown): v is TypingView {
  if (!isRec(v)) return false;
  if (v.available === true) {
    const lesson = v.lesson;
    return (
      isRec(lesson) &&
      isStr(lesson.id) &&
      isStr(lesson.title) &&
      oneOf(lesson.layout, ["ch-de-qwertz", "de-qwertz", "us-qwerty"]) &&
      isStrArray(lesson.homeRow) &&
      isStrRecord(lesson.fingers) &&
      isStrArray(lesson.lines) &&
      (v.label === null || isLabel(v.label)) &&
      isBool(v.lessonDone)
    );
  }
  if (v.available === false) return v.reason === "layout-unconfirmed" && (v.label === null || isLabel(v.label));
  return false;
}

/** The progress strip (follow-on M2): every field the cockpit dereferences. */
export function isProgressStrip(v: unknown): boolean {
  if (!isRec(v)) return false;
  const week = v.week;
  if (!isStr(v.timeZone) || !isRec(week) || !isStr(week.start) || !isStr(week.end) || !isStr(week.label)) return false;
  if (!isNum(v.completedThisWeek) || !isNum(v.completedTotal) || !isStr(v.counting)) return false;
  if (!Array.isArray(v.completed) || !v.completed.every((c) => isRec(c) && isStr(c.visit) && isNumOrNull(c.ordinal) && isStr(c.label) && isStr(c.finishedAt) && isBool(c.thisWeek) && isNum(c.pages))) return false;
  const next = v.next;
  if (!isRec(next) || !oneOf(next.kind, ["continue", "start", "none"]) || !isStrOrNull(next.visit) || !isNumOrNull(next.ordinal) || !isStrOrNull(next.label) || !isStr(next.text) || !isStrOrNull(next.reason)) return false;
  const recent = v.recent;
  if (recent !== null) {
    if (!isRec(recent) || !isStr(recent.visit) || !isNumOrNull(recent.ordinal) || !isStr(recent.label) || !isStr(recent.finishedAt) || !isStrOrNull(recent.did) || !isStr(recent.tryNext)) return false;
    const artifact = recent.artifact;
    if (!isRec(artifact) || !oneOf(artifact.kind, ["page", "station", "pier", "revision", "none"]) || !isStr(artifact.text)) return false;
    const g = recent.grounding;
    if (!isRec(g) || !oneOf(g.source, ["review", "review-historical", "none"]) || !isNumOrNull(g.reviewVersion)) return false;
    if (!(g.suppressed === null || (isRec(g.suppressed) && isStr(g.suppressed.reason) && isStr(g.suppressed.text)))) return false;
  }
  return true;
}

/** The child's vocabulary cue (follow-on M3): words + a try-next line, nothing numeric. */
export function isChildVocabularyCue(v: unknown): boolean {
  if (!isRec(v) || !isNum(v.inventoryVersion) || !isStr(v.note) || !Array.isArray(v.words)) return false;
  return v.words.every((w) => isRec(w) && isStr(w.entryId) && isStr(w.lemma) && isStr(w.gloss) && oneOf(w.language, ["en", "es"]) && isStr(w.try) && isBool(w.upcoming));
}

/** A mistake entry of the lesson feedback (world-first 2026-10-03). */
function isMistake(v: unknown): boolean {
  if (!isRec(v)) return false;
  const vis = v.visual;
  const visualOk = vis === null || (isRec(vis) && isStr(vis.kind));
  return isStr(v.id) && oneOf(v.evidence, ["incorrect", "unscored"]) && isStrOrNull(v.focus) && isNum(v.count) && isStr(v.given) && isStr(v.expected) && isStr(v.correction) && visualOk && isStrArray(v.refs);
}

/** One lesson's end-of-lesson feedback with its repair view (UX-5a/5b). */
export function isLessonFeedback(v: unknown): boolean {
  if (!isRec(v)) return false;
  const lesson = v.lesson;
  if (!isStr(v.id) || !isStr(v.visit) || !isRec(lesson) || !oneOf(lesson.kind, ["math", "language", "typing", "writing"]) || !isStr(lesson.ref) || !isStr(lesson.title) || !isStr(v.at)) return false;
  if (!(v.success === null || (isRec(v.success) && isStr(v.success.text) && isStr(v.success.basis)))) return false;
  if (!Array.isArray(v.mistakes) || !v.mistakes.every(isMistake) || !Array.isArray(v.unscored) || !v.unscored.every(isMistake)) return false;
  if (!(v.pattern === null || isMistake(v.pattern))) return false;
  const r = v.repair;
  if (!isRec(r) || !oneOf(r.status, ["none-needed", "available", "open", "closed"]) || !(r.kind === null || oneOf(r.kind, ["typing", "label", "writing", "language"])) || !isStrOrNull(r.repairId) || !isStrOrNull(r.focus) || !isNum(r.remaining) || !isNum(r.used)) return false;
  if (!(r.explanation === null || (isRec(r.explanation) && isStr(r.explanation.title) && isStr(r.explanation.text) && isBool(r.explanation.recorded)))) return false;
  if (!Array.isArray(r.items) || !r.items.every((i) => isRec(i) && isNum(i.no) && isStr(i.item) && oneOf(i.purpose, ["correct-original", "fresh-check"]) && oneOf(i.kind, ["typing-line", "label", "sentence", "pick", "produce"]) && isStr(i.text) && (!(i.kind === "pick" || i.kind === "produce") || (isRec(i.cue) && isStr(i.cue.word) && isStr(i.cue.title) && isStr(i.cue.text))))) return false;
  if (!Array.isArray(r.retries) || !r.retries.every((x) => isRec(x) && isNum(x.no) && isStr(x.item) && oneOf(x.result, ["correct", "incorrect", "unscored"]) && isNum(x.focusErrors))) return false;
  if (!(r.outcome === null || oneOf(r.outcome, ["open", "corrected-with-practice", "practice-again", "skipped"]))) return false;
  const c = v.close;
  if (!isRec(c) || !oneOf(c.kind, ["none-needed", "corrected-with-practice", "corrected-with-help", "practice-again", "pending", "unscored"]) || !isStr(c.text)) return false;
  return isBool(v.acknowledged);
}

/** The next-lesson reminder cue (UX-5c). */
export function isReminderCue(v: unknown): boolean {
  if (!isRec(v)) return false;
  const o = v.openedIn;
  return isStr(v.focusId) && oneOf(v.kind, ["typing-key", "math", "language", "spacing"]) && isStr(v.key) && isStr(v.cue) && isStr(v.grounding) && isRec(o) && isStr(o.visit) && isStr(o.lesson) && isStr(o.label) && (v.visual === null || (isRec(v.visual) && isStr(v.visual.kind)));
}

/** A reopenable visit report (complete or honestly partial). */
export function isVisitReport(v: unknown): boolean {
  if (!isRec(v)) return false;
  const s = v.summary;
  if (!isStr(v.visit) || !isNumOrNull(v.ordinal) || !isStr(v.label) || !isStr(v.startedAt) || !isStrOrNull(v.finishedAt) || !isBool(v.partial) || !isNum(v.stagesDone) || !isNum(v.stageCount)) return false;
  if (!isRec(s) || !isStr(s.visit) || !isStr(s.title) || !(s.success === null || (isRec(s.success) && isStr(s.success.text))) || !(s.practiced === null || (isRec(s.practiced) && isStr(s.practiced.text))) || !isRec(s.next) || !isStr(s.next.text) || !isRec(s.artifact) || !oneOf(s.artifact.kind, ["page", "station", "pier", "revision", "none"]) || !isStr(s.artifact.text)) return false;
  return Array.isArray(v.lessons) && v.lessons.every(isLessonFeedback) && isStrArray(v.worldChanges);
}

/**
 * True only for a complete, self-consistent ChildView for `child` (when
 * given). Every field the surfaces read is checked, so a passing value can
 * be rendered without a runtime exception.
 */
export function isChildView(value: unknown, child?: ChildId): value is ChildView {
  if (!isRec(value)) return false;
  if (!oneOf(value.child, CHILD_IDS)) return false;
  if (child !== undefined && value.child !== child) return false;
  if (!isNum(value.revision) || value.revision < 0 || !Number.isInteger(value.revision)) return false;
  if (!isNum(value.erasureGeneration) || value.erasureGeneration < 0 || !Number.isInteger(value.erasureGeneration)) return false;
  if (value.sessionFingerprint !== undefined && !isStr(value.sessionFingerprint)) return false;
  if (!isStr(value.title) || !isStr(value.hook) || !isStr(value.nextStep) || !isStr(value.retention)) return false;
  const base = value.base;
  if (!isRec(base) || !isStrOrNull(base.name) || !(base.location === null || isNamed(base.location)) || !isNumRecord(base.supplies)) return false;
  if (!Array.isArray(value.pages) || !value.pages.every((p) => isRec(p) && isStr(p.visit) && isStr(p.title) && isStr(p.baseName) && isStrOrNull(p.locationId) && isNumRecord(p.supplies) && isStrOrNull(p.explanation) && isStr(p.text) && isStr(p.at))) return false;
  const visit = value.visit;
  if (!(visit === null || (isRec(visit) && isStr(visit.id) && isNumOrNull(visit.ordinal) && isStr(visit.title) && isStr(visit.startedAt) && isStrOrNull(visit.stage) && isNum(visit.stageIndex) && isNum(visit.stageCount) && isNum(visit.minutesElapsed) && isBool(visit.overBudget)))) return false;
  const next = value.next;
  if (!isRec(next) || !isStrOrNull(next.visit) || !isNumOrNull(next.ordinal) || !isStrOrNull(next.availableAt) || !isStrOrNull(next.reason)) return false;
  if (!isProgressStrip(value.progress)) return false;
  if (!(value.vocabulary === null || isChildVocabularyCue(value.vocabulary))) return false;
  if (!Array.isArray(value.locations) || !value.locations.every(isNamed)) return false;
  if (!(value.math === null || isMathItemView(value.math))) return false;
  if (!(value.language === null || isLanguageView(value.language))) return false;
  if (!(value.typing === null || isTypingView(value.typing))) return false;
  if (!(value.lastLesson === null || isLessonFeedback(value.lastLesson))) return false;
  if (!(value.reminder === null || isReminderCue(value.reminder))) return false;
  if (!Array.isArray(value.reports) || !value.reports.every(isVisitReport)) return false;
  const reflection = value.reflection;
  if (!(reflection === null || (isRec(reflection) && isStr(reflection.prompt) && Array.isArray(reflection.options) && reflection.options.every((o) => isRec(o) && isStr(o.id) && isStr(o.label))))) return false;
  const tutor = value.tutor;
  if (!(tutor === null || (isRec(tutor) && isStr(tutor.taskId) && isNum(tutor.taskVersion) && oneOf(tutor.language, ["de", "en", "es"]) && isStr(tutor.prompt) && isStr(tutor.allowedHelp)))) return false;
  return true;
}
