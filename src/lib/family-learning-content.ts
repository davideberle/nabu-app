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
// inventory below is the contract, and a content file that does not match it
// exactly is refused rather than partially served.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";

export type VisitId = "v1" | "v2" | "v3";

export type StageId =
  | "name-base"
  | "place-base"
  | "restore"
  | "EQ-ENTRY"
  | "EQ-FRESH"
  | "EQ-RETURN"
  | "EQ-DELAY"
  | "explain"
  | "LANG-EN-WATER"
  | "LANG-ES-AGUA"
  | "typing"
  | "log"
  | "reflect";

export type MathItemId = "EQ-ENTRY" | "EQ-MODEL" | "EQ-FRESH" | "EQ-RETURN" | "EQ-DELAY";
export type ScoredMathItemId = Exclude<MathItemId, "EQ-MODEL">;
export type LanguageSegmentId = "LANG-EN-WATER" | "LANG-ES-AGUA";
export type KeyboardLayoutId = "ch-de-qwertz" | "de-qwertz" | "us-qwerty";
export type TargetLanguage = "de" | "en" | "es";

export type MathItem = {
  id: MathItemId;
  version: number;
  purpose: string;
  scored: boolean;
  visit: VisitId;
  quantity: number;
  groups: number;
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

export type TypingLabelTask = {
  id: string;
  version: number;
  visit: VisitId;
  instruction: string;
  target?: string;
  targetFrom?: "baseName";
};

export type LearningContent = {
  contentId: string;
  contentVersion: number;
  child: ChildId;
  reviewed: { status: string; note: string };
  theme: { defaultTitle: string; defaultHook: string; note: string };
  anchorLanguage: "de";
  visitBudgetMinutes: { min: number; max: number };
  visits: { id: VisitId; title: string; stages: StageId[]; minDaysAfterTeaching?: number }[];
  locations: { id: string; label: string; emoji: string }[];
  math: {
    objective: string;
    items: MathItem[];
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
    labelTasks: TypingLabelTask[];
  };
  reflection: { prompt: string; options: { id: string; label: string }[] };
  retention: { policy: string };
};

/** The contract inventory for content version 1, by stable ID. */
export const EXPECTED_MATH_ITEM_IDS: readonly MathItemId[] = [
  "EQ-ENTRY",
  "EQ-MODEL",
  "EQ-FRESH",
  "EQ-RETURN",
  "EQ-DELAY",
];
export const EXPECTED_LANGUAGE_SEGMENT_IDS: readonly LanguageSegmentId[] = [
  "LANG-EN-WATER",
  "LANG-ES-AGUA",
];
export const EXPECTED_TYPING_LESSON_IDS: readonly string[] = [
  "TYPE-CH-QWERTZ-HOME",
  "TYPE-DE-QWERTZ-HOME",
  "TYPE-US-QWERTY-HOME",
];
export const EXPECTED_TYPING_LABEL_IDS: readonly string[] = ["TYPE-LABEL-BASE", "TYPE-LABEL-GARDEN"];
export const KEYBOARD_LAYOUT_IDS: readonly KeyboardLayoutId[] = ["ch-de-qwertz", "de-qwertz", "us-qwerty"];

export type ContentReconciliation = {
  ok: boolean;
  counts: { math: number; language: number; typingLessons: number; typingLabels: number };
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

/**
 * Reconciles a parsed content document against the version-1 inventory and
 * checks every scored item's arithmetic against its stated answer, so a typo
 * in the answer key cannot reach a child. Deterministic: the same document
 * always yields the same problems list.
 */
export function reconcileLearningContent(raw: unknown): ContentReconciliation {
  const problems: string[] = [];
  const counts = { math: 0, language: 0, typingLessons: 0, typingLabels: 0 };
  if (!isRecord(raw)) return { ok: false, counts, problems: ["content is not an object"] };
  if (raw.contentVersion !== 1) problems.push(`contentVersion must be 1, got ${String(raw.contentVersion)}`);
  if (raw.child !== "santiago") problems.push("content.child must be santiago for this build");

  const math = isRecord(raw.math) ? raw.math : null;
  const mathIds = idsOf(math?.items);
  counts.math = mathIds.length;
  sameSet(mathIds, EXPECTED_MATH_ITEM_IDS, "math items", problems);
  if (Array.isArray(math?.items)) {
    for (const item of math.items) {
      if (!isRecord(item)) continue;
      const { id, quantity, groups, answer, scored, version, prompt } = item;
      if (typeof quantity !== "number" || typeof groups !== "number" || typeof answer !== "number") {
        problems.push(`math ${String(id)}: quantity/groups/answer must be numbers`);
        continue;
      }
      if (groups <= 0 || quantity % groups !== 0 || quantity / groups !== answer) {
        problems.push(`math ${String(id)}: ${quantity} ÷ ${groups} is not ${answer}`);
      }
      if (version !== 1) problems.push(`math ${String(id)}: version must be 1`);
      if (typeof prompt !== "string" || !prompt.trim()) problems.push(`math ${String(id)}: prompt missing`);
      if (id === "EQ-MODEL" && scored !== false) problems.push("EQ-MODEL must be unscored");
      if (id !== "EQ-MODEL" && scored !== true) problems.push(`math ${String(id)} must be scored`);
    }
  }

  const language = isRecord(raw.language) ? raw.language : null;
  const segmentIds = idsOf(language?.segments);
  counts.language = segmentIds.length;
  sameSet(segmentIds, EXPECTED_LANGUAGE_SEGMENT_IDS, "language segments", problems);
  if (Array.isArray(language?.segments)) {
    for (const segment of language.segments) {
      if (!isRecord(segment)) continue;
      if (segment.language !== "en" && segment.language !== "es") {
        problems.push(`language ${String(segment.id)}: language must be en or es`);
      }
      const steps = Array.isArray(segment.steps) ? segment.steps : [];
      if (steps.length === 0) problems.push(`language ${String(segment.id)}: no steps`);
      for (const step of steps) {
        if (!isRecord(step)) continue;
        if (step.kind === "pick-supply") {
          const options = Array.isArray(step.options) ? step.options : [];
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
        }
      }
    }
  }

  const typing = isRecord(raw.typing) ? raw.typing : null;
  const lessonIds = idsOf(typing?.lessons);
  counts.typingLessons = lessonIds.length;
  sameSet(lessonIds, EXPECTED_TYPING_LESSON_IDS, "typing lessons", problems);
  if (Array.isArray(typing?.lessons)) {
    for (const lesson of typing.lessons) {
      if (!isRecord(lesson)) continue;
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
  }
  const labelIds = idsOf(typing?.labelTasks);
  counts.typingLabels = labelIds.length;
  sameSet(labelIds, EXPECTED_TYPING_LABEL_IDS, "typing label tasks", problems);

  return { ok: problems.length === 0, counts, problems };
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

export function languageSegment(content: LearningContent, id: LanguageSegmentId): LanguageSegment {
  const segment = content.language.segments.find((entry) => entry.id === id);
  if (!segment) throw new Error(`language segment ${id} missing`);
  return segment;
}

export function typingLessonForLayout(
  content: LearningContent,
  layout: KeyboardLayoutId | null,
): TypingLesson | null {
  if (!layout) return null;
  return content.typing.lessons.find((lesson) => lesson.layout === layout) ?? null;
}

export function isKeyboardLayoutId(value: unknown): value is KeyboardLayoutId {
  return typeof value === "string" && (KEYBOARD_LAYOUT_IDS as readonly string[]).includes(value);
}

export function isScoredMathItemId(value: unknown): value is ScoredMathItemId {
  return value === "EQ-ENTRY" || value === "EQ-FRESH" || value === "EQ-RETURN" || value === "EQ-DELAY";
}
