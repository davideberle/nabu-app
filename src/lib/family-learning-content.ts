// ---------------------------------------------------------------------------
// Family Assistant learning content — types, validation and reconciliation.
//
// The canonical content lives in the workspace
// (`projects/family-assistant/learning/content/*.json`, see CONTRACT.md) and is
// mirrored verbatim into `src/data/family-learning/`. This module never reads
// the file itself: it is pure so `node --test` can load it, and the server
// half (`family-learning-content-server.ts`) hands it the parsed JSON.
//
// Reconciliation is by stable ID (DESIGN §7.6 "review every content entry by
// stable ID; record exact source/output counts and exclusions"): the expected
// inventory per content version below is the contract, and a content file
// that does not match it exactly is refused rather than partially served.
//
// Content version 2 (approved redesign, 2026-09-29) is a strict additive
// superset of version 1: every version-1 entry is unchanged in text, answer
// and version; version 2 adds visit v4, the remainder item EQ-STATION with
// its teaching example, the Spanish request LANG-ES-STATION, the Swiss-German
// typing course with its input-alignment check, the reviewed spacing rules and
// the visit-4 station choices.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";

export type VisitId = "v1" | "v2" | "v3" | "v4";

export type StageId =
  | "name-base"
  | "place-base"
  | "restore"
  | "EQ-ENTRY"
  | "EQ-FRESH"
  | "EQ-RETURN"
  | "EQ-DELAY"
  | "EQ-STATION"
  | "explain"
  | "LANG-EN-WATER"
  | "LANG-ES-AGUA"
  | "LANG-ES-STATION"
  | "typing"
  | "typing-course"
  | "station-choice"
  | "station-build"
  | "log-transfer"
  | "log"
  | "log-revise"
  | "summary"
  | "reflect";

export type MathItemId = "EQ-ENTRY" | "EQ-MODEL" | "EQ-FRESH" | "EQ-RETURN" | "EQ-DELAY" | "EQ-STATION" | "EQ-STATION-MODEL";
export type ScoredMathItemId = Exclude<MathItemId, "EQ-MODEL" | "EQ-STATION-MODEL">;
export type LanguageSegmentId = "LANG-EN-WATER" | "LANG-ES-AGUA" | "LANG-ES-STATION";
export type KeyboardLayoutId = "ch-de-qwertz" | "de-qwertz" | "us-qwerty";
export type TargetLanguage = "de" | "en" | "es";

export type MathItem = {
  id: MathItemId;
  version: number;
  purpose: string;
  scored: boolean;
  visit: VisitId;
  /** `sharing` (default): quantity ÷ groups = answer. `remainder`: groups × perGroup used, the rest remains whole. */
  kind?: "sharing" | "remainder";
  quantity: number;
  groups: number;
  /** Remainder items: how many fit in each group. */
  perGroup?: number;
  /** Remainder items: the two requested numbers. */
  answers?: { used: number; remaining: number };
  answer: number;
  unit: { singular: string; plural: string; emoji: string };
  group: { singular: string; plural: string; emoji: string };
  prompt: string;
  clarification?: string;
  representation?: string;
  scene?: string;
  steps?: string[];
  note?: string;
};

export type LanguageGloss = { word: string; de: string; example: string };

export type LanguageStep =
  | { id: string; kind: "listen-read"; sentence: string; instruction: string }
  | {
      id: string;
      kind: "pick-supply";
      sentence: string;
      instruction: string;
      options: string[];
      answer: string;
      evidence: "recognition";
      /** Neutral, reviewed correction shown after an incorrect pick. */
      correction?: string;
      /** Theme-dependent sentence (station theme id or "none"); same answer in every variant. */
      variants?: Record<string, string>;
      note?: string;
    }
  | {
      id: string;
      kind: "produce";
      instruction: string;
      frame: string;
      /** Canonical phrase forms → correct phrase production. */
      accepted: string[];
      /** Bare completions of the frame → correct lexical completion, not phrase production. */
      lexical: string[];
      /** A response containing one of these but matching neither list stays unscored. */
      keywords: string[];
      /** A response naming one of these and no keyword is incorrect. */
      distractors: string[];
      target: string;
      evidence: "production";
      rubric?: string;
      /** Reviewed, neutral feedback texts (German) for the three non-success outcomes. */
      clarification?: string;
      correction?: string;
      unclear?: string;
    };

export type LanguageSegment = {
  id: LanguageSegmentId;
  version: number;
  language: Exclude<TargetLanguage, "de">;
  visit: VisitId;
  title: string;
  objective: string;
  glosses: LanguageGloss[];
  steps: LanguageStep[];
};

export type TypingLesson = {
  id: string;
  version: number;
  layout: KeyboardLayoutId;
  title: string;
  homeRow: string[];
  fingers: Record<string, string>;
  lines: string[];
};

export type TypingCourseLesson = {
  id: string;
  version: number;
  title: string;
  /** Keys introduced by this lesson (" " is the space bar). */
  keys: string[];
  /** Keys practiced before this lesson (cumulative). */
  practiced: string[];
  lines: string[];
};

export type TypingAlignmentKey = { id: string; prompt: string; expected: Record<KeyboardLayoutId, string> };

export type TypingCourse = {
  note: string;
  layout: KeyboardLayoutId;
  homePosition: { left: string[]; right: string[]; anchors: string[]; thumb: string };
  reaches: Record<string, string>;
  fingers: Record<string, string>;
  progression: { minBursts: number; minAccuracy: number; comfortRequired: "ok"; tunable: boolean; note: string };
  alignmentCheck: { note: string; keys: TypingAlignmentKey[] };
  lessons: TypingCourseLesson[];
};

export type TypingLabelTask = {
  id: string;
  version: number;
  visit: VisitId;
  instruction: string;
  target?: string;
  targetFrom?: "baseName";
};

export type StationTheme = { id: string; label: string; emoji: string; purpose: string };
export type StationSpot = { id: string; label: string; emoji: string };

export type SpacingJoin = { joined: string; split: string };

export type LearningContent = {
  contentId: string;
  contentVersion: number;
  supersedes?: { contentVersion: number; note: string };
  child: ChildId;
  reviewed: { status: string; note: string };
  theme: { defaultTitle: string; defaultHook: string; note: string };
  anchorLanguage: "de";
  visitBudgetMinutes: { min: number; max: number };
  visits: { id: VisitId; title: string; stages: StageId[]; minDaysAfterTeaching?: number; intro?: { who: string; make: string; done: string } }[];
  locations: { id: string; label: string; emoji: string }[];
  station?: { note: string; themes: StationTheme[]; spots: StationSpot[] };
  math: {
    objective: string;
    items: MathItem[];
    /** People (distribute among) versus containers (put into) — control wording only. */
    recipientKinds?: Record<string, RecipientKind>;
    recipientKindsNote?: string;
    rules: {
      maxSubstantiveAttempts: number;
      clarifyAfterFirstIncorrect: boolean;
      hideModelDuringFresh: boolean;
      answerRevealDowngradesToExposed: boolean;
    };
  };
  language: {
    segments: LanguageSegment[];
    supplyLabels: Record<string, { de: string; emoji: string }>;
  };
  typing: {
    note: string;
    layouts: { id: KeyboardLayoutId; label: string }[];
    lessons: TypingLesson[];
    course?: TypingCourse;
    labelTasks: TypingLabelTask[];
  };
  writing?: { spacing: { note: string; rules: string[]; joins: SpacingJoin[] }; transfer?: { id: string; version: number; prompt: string; instruction: string; note: string } };
  reflection: { prompt: string; options: { id: string; label: string }[]; skipLabel?: string; dimensions?: { id: string; prompt: string; options: { id: string; label: string }[]; skipLabel: string }[]; note?: string };
  retention: { policy: string };
};

/** The contract inventory for content version 1, by stable ID. */
export const EXPECTED_MATH_ITEM_IDS: readonly MathItemId[] = ["EQ-ENTRY", "EQ-MODEL", "EQ-FRESH", "EQ-RETURN", "EQ-DELAY"];
export const EXPECTED_LANGUAGE_SEGMENT_IDS: readonly LanguageSegmentId[] = ["LANG-EN-WATER", "LANG-ES-AGUA"];
export const EXPECTED_TYPING_LESSON_IDS: readonly string[] = ["TYPE-CH-QWERTZ-HOME", "TYPE-DE-QWERTZ-HOME", "TYPE-US-QWERTY-HOME"];
export const EXPECTED_TYPING_LABEL_IDS: readonly string[] = ["TYPE-LABEL-BASE", "TYPE-LABEL-GARDEN"];
export const EXPECTED_VISIT_IDS_V1: readonly VisitId[] = ["v1", "v2", "v3"];

/** The contract inventory for content version 2: version 1 plus the additions. */
export const EXPECTED_MATH_ITEM_IDS_V2: readonly MathItemId[] = [...EXPECTED_MATH_ITEM_IDS, "EQ-STATION", "EQ-STATION-MODEL"];
export const EXPECTED_LANGUAGE_SEGMENT_IDS_V2: readonly LanguageSegmentId[] = [...EXPECTED_LANGUAGE_SEGMENT_IDS, "LANG-ES-STATION"];
export const EXPECTED_TYPING_COURSE_IDS_V2: readonly string[] = ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4", "TYPE-CH-COURSE-5"];
export const EXPECTED_VISIT_IDS_V2: readonly VisitId[] = ["v1", "v2", "v3", "v4"];
/**
 * Stage lists of the retained visits are FROZEN: a saved mission stores a
 * numeric stageIndex per visit, so any reorder/insert in v1–v3 would silently
 * reinterpret an in-flight visit. Every supported content version must match
 * these lists exactly (independent acceptance M4).
 */
export const EXPECTED_RETAINED_STAGES: Readonly<Record<"v1" | "v2" | "v3", readonly StageId[]>> = {
  v1: ["name-base", "place-base", "EQ-ENTRY", "EQ-FRESH", "explain", "LANG-EN-WATER", "typing", "log", "reflect"],
  v2: ["restore", "EQ-RETURN", "LANG-ES-AGUA", "typing", "log", "reflect"],
  v3: ["restore", "EQ-DELAY", "log", "reflect"],
};
export const EXPECTED_V4_STAGES: readonly StageId[] = ["restore", "station-choice", "typing-course", "EQ-STATION", "explain", "LANG-ES-STATION", "station-build", "log", "log-revise", "log-transfer", "summary", "reflect"];
/** Stable identity of the fresh writing-transfer check (content v2, round 2). */
export const EXPECTED_TRANSFER_ID = "WRITE-TRANSFER-1";
export const EXPECTED_FEEDBACK_DIMENSIONS: readonly string[] = ["enjoyment", "clarity"];
export type RecipientKind = "people" | "container";
export const KEYBOARD_LAYOUT_IDS: readonly KeyboardLayoutId[] = ["ch-de-qwertz", "de-qwertz", "us-qwerty"];
export const SUPPORTED_CONTENT_VERSIONS: readonly number[] = [1, 2];

export type ContentReconciliation = {
  ok: boolean;
  version: number | null;
  counts: { math: number; language: number; typingLessons: number; typingLabels: number; typingCourse: number; visits: number };
  problems: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id : "?"));
}

function sameSet(actual: readonly string[], expected: readonly string[], label: string, problems: string[]) {
  const missing = expected.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !expected.includes(id));
  const dupes = actual.filter((id, index) => actual.indexOf(id) !== index);
  if (missing.length) problems.push(`${label}: missing ${missing.join(", ")}`);
  if (extra.length) problems.push(`${label}: unexpected ${extra.join(", ")}`);
  if (dupes.length) problems.push(`${label}: duplicate ${dupes.join(", ")}`);
}

function checkMathItem(item: Record<string, unknown>, problems: string[]) {
  const { id, quantity, groups, answer, scored, version, prompt } = item;
  const label = `math ${String(id)}`;
  if (typeof quantity !== "number" || typeof groups !== "number" || typeof answer !== "number") {
    problems.push(`${label}: quantity/groups/answer must be numbers`);
    return;
  }
  if (item.kind === "remainder") {
    // Deliberate change of the validator for the remainder item: groups × perGroup
    // are used, the rest remains whole and must be smaller than one group.
    const perGroup = item.perGroup;
    const answers = isRecord(item.answers) ? item.answers : null;
    if (typeof perGroup !== "number" || perGroup <= 0 || !answers || typeof answers.used !== "number" || typeof answers.remaining !== "number") {
      problems.push(`${label}: remainder item needs perGroup and answers {used, remaining}`);
      return;
    }
    if (groups * perGroup !== answers.used) problems.push(`${label}: ${groups} × ${perGroup} is not ${answers.used}`);
    if (quantity - answers.used !== answers.remaining) problems.push(`${label}: ${quantity} − ${answers.used} is not ${answers.remaining}`);
    if (answers.remaining < 0 || answers.remaining >= perGroup) problems.push(`${label}: remainder ${answers.remaining} must be smaller than one group of ${perGroup}`);
    if (answer !== perGroup) problems.push(`${label}: answer must equal perGroup for a remainder item`);
  } else if (groups <= 0 || quantity % groups !== 0 || quantity / groups !== answer) {
    problems.push(`${label}: ${quantity} ÷ ${groups} is not ${answer}`);
  }
  if (version !== 1) problems.push(`${label}: version must be 1`);
  if (typeof prompt !== "string" || !prompt.trim()) problems.push(`${label}: prompt missing`);
  const teaching = id === "EQ-MODEL" || id === "EQ-STATION-MODEL";
  if (teaching && scored !== false) problems.push(`${String(id)} must be unscored`);
  if (!teaching && scored !== true) problems.push(`${label} must be scored`);
}

function checkLanguageSegment(segment: Record<string, unknown>, problems: string[]) {
  if (segment.language !== "en" && segment.language !== "es") {
    problems.push(`language ${String(segment.id)}: language must be en or es`);
  }
  const steps = Array.isArray(segment.steps) ? segment.steps : [];
  if (steps.length === 0) problems.push(`language ${String(segment.id)}: no steps`);
  const glosses = Array.isArray(segment.glosses) ? segment.glosses : [];
  for (const gloss of glosses) {
    if (!isRecord(gloss) || typeof gloss.word !== "string" || typeof gloss.de !== "string" || typeof gloss.example !== "string") {
      problems.push(`language ${String(segment.id)}: malformed gloss`);
    }
  }
  for (const step of steps) {
    if (!isRecord(step)) continue;
    if (step.kind === "pick-supply") {
      const options = Array.isArray(step.options) ? step.options : [];
      if (isRecord(step.variants)) {
        for (const [theme, sentence] of Object.entries(step.variants)) {
          if (typeof sentence !== "string" || !sentence.toLowerCase().includes(String(step.answer).toLowerCase())) problems.push(`language ${String(segment.id)}/${String(step.id)}: variant ${theme} must contain the answer`);
        }
        if (!("none" in step.variants)) problems.push(`language ${String(segment.id)}/${String(step.id)}: variants need a "none" (no theme) sentence`);
      }
      if (!options.includes(step.answer)) {
        problems.push(`language ${String(segment.id)}/${String(step.id)}: answer not among options`);
      }
    }
    if (step.kind === "produce") {
      for (const key of ["accepted", "lexical", "keywords", "distractors"] as const) {
        const list = Array.isArray(step[key]) ? (step[key] as unknown[]) : [];
        if (list.length === 0 || list.some((v) => typeof v !== "string" || !v.trim())) {
          problems.push(`language ${String(segment.id)}/${String(step.id)}: ${key} must be a non-empty list of strings`);
        }
      }
      const keywords = Array.isArray(step.keywords) ? (step.keywords as string[]) : [];
      for (const phrase of [...(Array.isArray(step.accepted) ? (step.accepted as string[]) : []), ...(Array.isArray(step.lexical) ? (step.lexical as string[]) : [])]) {
        if (!keywords.some((k) => phrase.toLowerCase().includes(k.toLowerCase()))) {
          problems.push(`language ${String(segment.id)}/${String(step.id)}: "${phrase}" lacks the keyword`);
        }
      }
      const distractors = Array.isArray(step.distractors) ? (step.distractors as string[]) : [];
      for (const d of distractors) {
        if (keywords.some((k) => d.toLowerCase() === k.toLowerCase())) problems.push(`language ${String(segment.id)}/${String(step.id)}: distractor "${d}" is also a keyword`);
      }
    }
  }
}

function checkTypingLesson(lesson: Record<string, unknown>, problems: string[]) {
  if (!KEYBOARD_LAYOUT_IDS.includes(lesson.layout as KeyboardLayoutId)) {
    problems.push(`typing ${String(lesson.id)}: unknown layout ${String(lesson.layout)}`);
  }
  const homeRow = Array.isArray(lesson.homeRow) ? lesson.homeRow : [];
  const fingers = isRecord(lesson.fingers) ? lesson.fingers : {};
  for (const key of homeRow) {
    if (typeof key !== "string" || !(key in fingers)) {
      problems.push(`typing ${String(lesson.id)}: no finger guidance for ${String(key)}`);
    }
  }
  const lines = Array.isArray(lesson.lines) ? lesson.lines : [];
  for (const line of lines) {
    if (typeof line !== "string") continue;
    for (const ch of line.replace(/ /g, "")) {
      if (!homeRow.includes(ch)) problems.push(`typing ${String(lesson.id)}: "${line}" uses ${ch} outside the home row`);
    }
  }
}

function checkTypingCourse(course: unknown, problems: string[]): number {
  if (!isRecord(course)) {
    problems.push("typing course: missing");
    return 0;
  }
  if (course.layout !== "ch-de-qwertz") problems.push(`typing course: layout must be ch-de-qwertz, got ${String(course.layout)}`);
  const fingers = isRecord(course.fingers) ? course.fingers : {};
  if (fingers[" "] !== "Daumen") problems.push("typing course: the space bar must be assigned to the thumb");
  const home = isRecord(course.homePosition) ? course.homePosition : {};
  const left = Array.isArray(home.left) ? home.left : [];
  const right = Array.isArray(home.right) ? home.right : [];
  if (left.length !== 4 || right.length !== 4) problems.push("typing course: home position must name exactly four resting keys per hand");
  const progression = isRecord(course.progression) ? course.progression : {};
  if (typeof progression.minBursts !== "number" || progression.minBursts < 1 || typeof progression.minAccuracy !== "number" || progression.minAccuracy <= 0 || progression.minAccuracy > 1) {
    problems.push("typing course: progression needs minBursts ≥ 1 and 0 < minAccuracy ≤ 1");
  }
  const check = isRecord(course.alignmentCheck) ? course.alignmentCheck : {};
  const keys = Array.isArray(check.keys) ? check.keys : [];
  if (keys.length < 3) problems.push("typing course: alignment check needs at least three distinguishing keys");
  for (const key of keys) {
    if (!isRecord(key) || typeof key.prompt !== "string" || !isRecord(key.expected)) {
      problems.push("typing course: malformed alignment key");
      continue;
    }
    for (const layout of KEYBOARD_LAYOUT_IDS) {
      if (typeof key.expected[layout] !== "string" || Array.from(key.expected[layout] as string).length !== 1) problems.push(`typing course: alignment key ${String(key.id)} lacks a one-character expectation for ${layout}`);
    }
  }
  // Every layout must be distinguishable from every other by at least one key.
  for (const a of KEYBOARD_LAYOUT_IDS) {
    for (const b of KEYBOARD_LAYOUT_IDS) {
      if (a >= b) continue;
      const distinguishes = keys.some((key) => isRecord(key) && isRecord(key.expected) && key.expected[a] !== key.expected[b]);
      if (!distinguishes) problems.push(`typing course: alignment check cannot distinguish ${a} from ${b}`);
    }
  }
  const lessons = Array.isArray(course.lessons) ? course.lessons : [];
  const lessonIds = idsOf(lessons);
  sameSet(lessonIds, EXPECTED_TYPING_COURSE_IDS_V2, "typing course lessons", problems);
  let cumulative: string[] = [];
  for (const lesson of lessons) {
    if (!isRecord(lesson)) continue;
    const keys = Array.isArray(lesson.keys) ? (lesson.keys as unknown[]).filter((k): k is string => typeof k === "string") : [];
    const practiced = Array.isArray(lesson.practiced) ? (lesson.practiced as unknown[]).filter((k): k is string => typeof k === "string") : [];
    if (keys.length === 0) problems.push(`typing course ${String(lesson.id)}: introduces no keys`);
    if (practiced.join("") !== cumulative.join("")) problems.push(`typing course ${String(lesson.id)}: practiced keys must equal every key introduced before (${cumulative.join("")})`);
    for (const k of keys) {
      if (k !== " " && !(k in fingers)) problems.push(`typing course ${String(lesson.id)}: no finger guidance for ${k}`);
      if (cumulative.includes(k)) problems.push(`typing course ${String(lesson.id)}: ${k} was already introduced`);
    }
    const allowed = new Set([...cumulative, ...keys, " "]);
    const lines = Array.isArray(lesson.lines) ? lesson.lines : [];
    if (lines.length === 0) problems.push(`typing course ${String(lesson.id)}: no lines`);
    for (const line of lines) {
      if (typeof line !== "string") continue;
      for (const ch of Array.from(line)) if (!allowed.has(ch)) problems.push(`typing course ${String(lesson.id)}: "${line}" uses ${ch} before it was introduced`);
    }
    if (lesson.version !== 1) problems.push(`typing course ${String(lesson.id)}: version must be 1`);
    cumulative = [...cumulative, ...keys];
  }
  return lessons.length;
}

/**
 * Reconciles a parsed content document against the inventory of its declared
 * content version (1 or 2) and checks every scored item's arithmetic against
 * its stated answer, so a typo in the answer key cannot reach a child.
 * Deterministic: the same document always yields the same problems list.
 */
export function reconcileLearningContent(raw: unknown): ContentReconciliation {
  const problems: string[] = [];
  const counts = { math: 0, language: 0, typingLessons: 0, typingLabels: 0, typingCourse: 0, visits: 0 };
  if (!isRecord(raw)) return { ok: false, version: null, counts, problems: ["content is not an object"] };
  const version = typeof raw.contentVersion === "number" && SUPPORTED_CONTENT_VERSIONS.includes(raw.contentVersion) ? raw.contentVersion : null;
  if (version === null) problems.push(`contentVersion must be one of ${SUPPORTED_CONTENT_VERSIONS.join(", ")}, got ${String(raw.contentVersion)}`);
  if (raw.child !== "santiago") problems.push("content.child must be santiago for this build");
  const v2 = version === 2;

  const visitIds = idsOf(raw.visits);
  counts.visits = visitIds.length;
  sameSet(visitIds, v2 ? EXPECTED_VISIT_IDS_V2 : EXPECTED_VISIT_IDS_V1, "visits", problems);
  if (Array.isArray(raw.visits)) {
    for (const [id, expected] of Object.entries(EXPECTED_RETAINED_STAGES)) {
      const visit = raw.visits.find((v) => isRecord(v) && v.id === id);
      const stages = isRecord(visit) && Array.isArray(visit.stages) ? (visit.stages as unknown[]) : [];
      if (stages.join(",") !== expected.join(",")) problems.push(`visit ${id}: retained stage list is frozen (saved missions index it numerically); must be exactly ${expected.join(" → ")}`);
    }
  }
  if (v2 && Array.isArray(raw.visits)) {
    const v4 = raw.visits.find((v) => isRecord(v) && v.id === "v4");
    const stages = isRecord(v4) && Array.isArray(v4.stages) ? (v4.stages as unknown[]) : [];
    if (stages.join(",") !== EXPECTED_V4_STAGES.join(",")) problems.push(`visit v4: stages must be exactly ${EXPECTED_V4_STAGES.join(" → ")}`);
    const intro = isRecord(v4) && isRecord(v4.intro) ? v4.intro : null;
    if (!intro || typeof intro.who !== "string" || typeof intro.make !== "string" || typeof intro.done !== "string") problems.push("visit v4: intro must say who needs help, what is made and what counts as done");
  }

  const math = isRecord(raw.math) ? raw.math : null;
  const mathIds = idsOf(math?.items);
  counts.math = mathIds.length;
  sameSet(mathIds, v2 ? EXPECTED_MATH_ITEM_IDS_V2 : EXPECTED_MATH_ITEM_IDS, "math items", problems);
  if (Array.isArray(math?.items)) {
    for (const item of math.items) {
      if (!isRecord(item)) continue;
      if (!v2 && item.kind === "remainder") problems.push(`math ${String(item.id)}: remainder items exist only from content version 2`);
      checkMathItem(item, problems);
    }
  }

  if (v2 && Array.isArray(math?.items)) {
    const kinds = isRecord(math.recipientKinds) ? math.recipientKinds : null;
    for (const item of math.items) {
      const id = isRecord(item) ? String(item.id) : "?";
      const kind = kinds?.[id];
      if (kind !== "people" && kind !== "container") problems.push(`math ${id}: recipientKinds must say people or container (control wording)`);
    }
  }
  const language = isRecord(raw.language) ? raw.language : null;
  const segmentIds = idsOf(language?.segments);
  counts.language = segmentIds.length;
  sameSet(segmentIds, v2 ? EXPECTED_LANGUAGE_SEGMENT_IDS_V2 : EXPECTED_LANGUAGE_SEGMENT_IDS, "language segments", problems);
  if (Array.isArray(language?.segments)) {
    for (const segment of language.segments) if (isRecord(segment)) checkLanguageSegment(segment, problems);
  }

  const typing = isRecord(raw.typing) ? raw.typing : null;
  const lessonIds = idsOf(typing?.lessons);
  counts.typingLessons = lessonIds.length;
  sameSet(lessonIds, EXPECTED_TYPING_LESSON_IDS, "typing lessons", problems);
  if (Array.isArray(typing?.lessons)) {
    for (const lesson of typing.lessons) if (isRecord(lesson)) checkTypingLesson(lesson, problems);
  }
  const labelIds = idsOf(typing?.labelTasks);
  counts.typingLabels = labelIds.length;
  sameSet(labelIds, EXPECTED_TYPING_LABEL_IDS, "typing label tasks", problems);
  if (v2) counts.typingCourse = checkTypingCourse(typing?.course, problems);
  else if (typing && "course" in typing) problems.push("typing course exists only from content version 2");

  if (v2) {
    const transfer = isRecord(raw.writing) && isRecord(raw.writing.transfer) ? raw.writing.transfer : null;
    if (!transfer || transfer.id !== EXPECTED_TRANSFER_ID || transfer.version !== 1 || typeof transfer.prompt !== "string" || typeof transfer.instruction !== "string") problems.push(`writing.transfer: the fresh transfer check ${EXPECTED_TRANSFER_ID}/1 with prompt and instruction is required`);
    const dims = isRecord(raw.reflection) && Array.isArray(raw.reflection.dimensions) ? raw.reflection.dimensions : [];
    if (!isRecord(raw.reflection) || typeof raw.reflection.skipLabel !== "string") problems.push("reflection: difficulty must be optional (skipLabel) from content version 2");
    sameSet(dims.map((d) => (isRecord(d) ? String(d.id) : "?")), EXPECTED_FEEDBACK_DIMENSIONS, "reflection dimensions", problems);
    for (const d of dims) if (!isRecord(d) || typeof d.prompt !== "string" || typeof d.skipLabel !== "string" || !Array.isArray(d.options) || d.options.length < 2) problems.push("reflection dimensions: each needs a prompt, a skip label and at least two options");
    const station = isRecord(raw.station) ? raw.station : null;
    const themes = Array.isArray(station?.themes) ? station.themes : [];
    // Every theme-dependent language variant must name a real theme (or "none").
    const themeIds = new Set<string>(["none", ...themes.map((t) => (isRecord(t) ? String(t.id) : "?"))]);
    if (Array.isArray(raw.language && isRecord(raw.language) ? raw.language.segments : null)) {
      for (const seg of (raw.language as Record<string, unknown>).segments as unknown[]) {
        if (!isRecord(seg) || !Array.isArray(seg.steps)) continue;
        for (const step of seg.steps) if (isRecord(step) && isRecord(step.variants)) for (const key of Object.keys(step.variants)) if (!themeIds.has(key)) problems.push(`language ${String(seg.id)}/${String(step.id)}: variant ${key} is not a station theme`);
      }
    }
    const spots = Array.isArray(station?.spots) ? station.spots : [];
    if (themes.length < 2) problems.push("station: at least two themes so declining the observation theme has a coherent alternative");
    for (const t of themes) if (!isRecord(t) || typeof t.id !== "string" || typeof t.label !== "string" || typeof t.purpose !== "string") problems.push("station: malformed theme");
    if (spots.length < 2) problems.push("station: at least two spots");
    const writing = isRecord(raw.writing) && isRecord(raw.writing.spacing) ? raw.writing.spacing : null;
    const joins = Array.isArray(writing?.joins) ? writing.joins : [];
    if (joins.length === 0) problems.push("writing.spacing.joins: reviewed list missing");
    for (const j of joins) {
      if (!isRecord(j) || typeof j.joined !== "string" || typeof j.split !== "string") problems.push("writing.spacing.joins: malformed entry");
      else if (j.split.replace(/ /g, "") !== j.joined || j.joined !== j.joined.toLowerCase() || !j.split.includes(" ")) problems.push(`writing.spacing.joins: "${j.joined}" must be the lowercase, space-free form of "${j.split}"`);
    }
  }

  return { ok: problems.length === 0, version, counts, problems };
}

/** Narrow a reconciled document to the typed contract. Throws on any problem. */
export function asLearningContent(raw: unknown): LearningContent {
  const reconciliation = reconcileLearningContent(raw);
  if (!reconciliation.ok) {
    throw new Error(`learning content refused: ${reconciliation.problems.join("; ")}`);
  }
  return raw as LearningContent;
}

export function mathItem(content: LearningContent, id: MathItemId): MathItem {
  const item = content.math.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`math item ${id} missing`);
  return item;
}

export function hasMathItem(content: LearningContent, id: MathItemId): boolean {
  return content.math.items.some((entry) => entry.id === id);
}

export function languageSegment(content: LearningContent, id: LanguageSegmentId): LanguageSegment {
  const segment = content.language.segments.find((entry) => entry.id === id);
  if (!segment) throw new Error(`language segment ${id} missing`);
  return segment;
}

export function hasLanguageSegment(content: LearningContent, id: LanguageSegmentId): boolean {
  return content.language.segments.some((entry) => entry.id === id);
}

export function typingLessonForLayout(content: LearningContent, layout: KeyboardLayoutId | null): TypingLesson | null {
  if (!layout) return null;
  return content.typing.lessons.find((lesson) => lesson.layout === layout) ?? null;
}

/** The progressive course for a layout, or null (only ch-de-qwertz has one; never a fallback). */
export function typingCourseForLayout(content: LearningContent, layout: KeyboardLayoutId | null): TypingCourse | null {
  if (!layout || !content.typing.course || content.typing.course.layout !== layout) return null;
  return content.typing.course;
}

export function isKeyboardLayoutId(value: unknown): value is KeyboardLayoutId {
  return typeof value === "string" && (KEYBOARD_LAYOUT_IDS as readonly string[]).includes(value);
}

export function isScoredMathItemId(value: unknown): value is ScoredMathItemId {
  return value === "EQ-ENTRY" || value === "EQ-FRESH" || value === "EQ-RETURN" || value === "EQ-DELAY" || value === "EQ-STATION";
}

export function isLanguageSegmentId(value: unknown): value is LanguageSegmentId {
  return value === "LANG-EN-WATER" || value === "LANG-ES-AGUA" || value === "LANG-ES-STATION";
}

export function isVisitId(value: unknown): value is VisitId {
  return value === "v1" || value === "v2" || value === "v3" || value === "v4";
}
