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

export type VisitId = "v1" | "v2" | "v3" | "v4" | "v5" | "v6";

export type StageId =
  | "name-base"
  | "place-base"
  | "restore"
  | "EQ-ENTRY"
  | "EQ-FRESH"
  | "EQ-RETURN"
  | "EQ-DELAY"
  | "EQ-STATION"
  | "EQ-PIER"
  | "explain"
  | "LANG-EN-WATER"
  | "LANG-ES-AGUA"
  | "LANG-ES-STATION"
  | "LANG-EN-PIER"
  | "typing"
  | "typing-course"
  | "station-choice"
  | "station-build"
  | "pier-build"
  | "log-transfer"
  | "log"
  | "log-revise"
  | "summary"
  | "reflect"
  /** Content version 4 (Visit 5, 2026-10-10): the harbor chapter v6. */
  | "island"
  | "EQ-HARBOR"
  | "EQ-HARBOR-CHECK"
  | "LANG-ES-HARBOR"
  | "LANG-ES-HARBOR-CHECK"
  | "harbor-build"
  | "log-review";

export type MathItemId = "EQ-ENTRY" | "EQ-MODEL" | "EQ-FRESH" | "EQ-RETURN" | "EQ-DELAY" | "EQ-STATION" | "EQ-STATION-MODEL" | "EQ-PIER" | "EQ-HARBOR" | "EQ-HARBOR-MODEL" | "EQ-HARBOR-CHECK";
export type ScoredMathItemId = Exclude<MathItemId, "EQ-MODEL" | "EQ-STATION-MODEL" | "EQ-HARBOR-MODEL">;
export type LanguageSegmentId = "LANG-EN-WATER" | "LANG-ES-AGUA" | "LANG-ES-STATION" | "LANG-EN-PIER" | "LANG-ES-HARBOR" | "LANG-ES-HARBOR-CHECK";
export type KeyboardLayoutId = "ch-de-qwertz" | "de-qwertz" | "us-qwerty";

/**
 * Canonical math objectives as the state machine records them on attempts (correction ID27, 2026-10-11): equal sharing (visits
 * 1–3), the remainder items (station, pier) and the two PARTS of a quotient item (harbor, visit 5). The parent cockpit filters
 * and labels its math table from this map, never from a hard-coded objective name; old records keep their names.
 */
export const MATH_OBJECTIVES: Readonly<Record<string, { label: string; part: "A" | "B" | null }>> = {
  "equal-sharing": { label: "Gleichmässig teilen", part: null },
  "equal-sharing-with-remainder": { label: "Teilen mit Rest", part: null },
  "quotient-with-remainder": { label: "Teil A — volle Boote und Kisten übrig", part: "A" },
  "quotient-groups-needed": { label: "Teil B — Boote für alle Kisten", part: "B" },
};
export function isMathObjective(objective: string): boolean {
  return Object.prototype.hasOwnProperty.call(MATH_OBJECTIVES, objective);
}
export type TargetLanguage = "de" | "en" | "es";

export type MathItem = {
  id: MathItemId;
  version: number;
  purpose: string;
  scored: boolean;
  visit: VisitId;
  /**
   * `sharing` (default): quantity ÷ groups = answer. `remainder`: groups × perGroup used, the rest remains whole.
   * `quotient` (content v4): how many FULL groups of perGroup fit (full), what remains, and how many groups are needed
   * for everything (needed = full + 1 when something remains); `groups` is the number of groups needed (the trays).
   */
  kind?: "sharing" | "remainder" | "quotient";
  quantity: number;
  groups: number;
  /** Remainder / quotient items: how many fit in each group. */
  perGroup?: number;
  /** Remainder items: the two requested numbers. Quotient items add `full` and `needed` (used = full × perGroup). */
  answers?: { used: number; remaining: number; full?: number; needed?: number };
  /** Remainder items: the verb for the used part ("gepflanzt" for seedlings, "verbaut" for planks); default gepflanzt/Gepflanzt. */
  usedWord?: { past: string; label: string };
  /** Quotient items: the field labels of the three requested numbers. */
  quotientWords?: { fullLabel: string; remainingLabel: string; neededLabel: string };
  /** Quotient items: part B — the decision question (how many groups for ALL) and its clarification after a wrong first answer. */
  decisionPrompt?: string;
  decisionClarification?: string;
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

/** A fresh writing-transfer check bound to one visit (content v3 carries one per chapter: WRITE-TRANSFER-1 → v4, WRITE-TRANSFER-2 → v5). */
export type TransferDef = { id: string; version: number; visit: VisitId; prompt: string; instruction: string; note: string };

export type SpacingJoin = { joined: string; split: string };

/** Content v4: the self-authored German log sentence of a chapter (the captain's log of v6), reviewed by `writing.review`. */
export type LogDef = { id: string; version: number; visit: VisitId; prompt: string; instruction: string; note: string };

/** Content v4: the reviewed, deterministic writing review (lexicon and rules; the app's `family-learning-writing-review.ts` executes it). */
export type WritingReviewAspect = "meaning" | "completeness" | "grammar" | "spacing" | "capitalization" | "spelling" | "punctuation";
export type WritingReviewDef = {
  note: string;
  maxTeachingPoints: number;
  priority: WritingReviewAspect[];
  /** Lowercase stems/words that show the sentence speaks about what was built or transported. */
  taskWords: string[];
  /** Lowercase verb forms a complete sentence may carry. */
  verbs: string[];
  /** Lowercase subject words (pronouns, articles, names). */
  subjects: string[];
  /** Nouns the capitalisation check knows (capitalised written forms). */
  nouns: { lemma: string; forms: string[] }[];
  /** Reviewed common misspellings (lowercase) with the right form; `right: null` marks a form the review must NOT flag. */
  misspellings: { wrong: string; right: string | null }[];
  /** Lowercase function words / adjectives / numerals that are known and never flagged. */
  functionWords: string[];
};

/** Content v4: the harbor of visit v6 — destinations (a child choice), workplaces (free order) and their characters. */
export type HarborWorkplaceId = "typing" | "planning" | "closing";
export type HarborWorkplace = { id: HarborWorkplaceId; label: string; building: string; character: string; stages: StageId[]; required: boolean; afterAllOthers?: boolean };
export type HarborCharacter = { id: string; name: string; role: string; language: TargetLanguage; lines: { id: string; text: string; de: string | null }[] };
export type HarborDef = { note: string; destinations: { id: string; label: string; emoji: string }[]; workplaces: HarborWorkplace[]; characters: HarborCharacter[] };

/**
 * Content v4 (repair round 1): the explanation conversation. The dialogue is held by the isolated child assistant
 * (bridge); the app's `family-learning-reasoning.ts` builds each message (context, complete history, deterministic
 * findings, these rules), validates numeric claims and gates the recorded method. The strings below are the reviewed
 * lines the app itself may show (prompt, scaffold, teaching, fallbacks) — never a scripted judgement.
 */
export type ReasoningCriterionId = "strategy" | "quantities" | "meaning";
export type ReasoningCriterionDef = { id: ReasoningCriterionId; label: string; question: string };
export type ReasoningPromptDef = { id: string; text: string };
export type ReasoningDef = {
  id: string;
  version: number;
  note: string;
  /** Bounded exchanges: child turns per conversation. */
  maxChildTurns: number;
  /** Assessment reset: at most this many clarification prompts (from `prompts`) keep the explanation window unsupported. */
  maxClarifications: number;
  prompt: string;
  /** The reviewed criteria Nabu assesses (labelled as Nabu's assessment, never a deterministic verdict). */
  criteria: ReasoningCriterionDef[];
  /** The reviewed answer-free prompt bank: the model selects an id, the app renders the exact text. */
  prompts: ReasoningPromptDef[];
  /** Rules sent to the assistant with every message. */
  rules: string[];
  /** The strict reply schema sent to the assistant with every message (repair round 3: eight lines, ART, «citations»). */
  schema: string[];
  /** Appended in the last round. */
  lastRound: string;
  scaffold: string;
  counters: string;
  teach: string;
  afterTeach: string;
  fallback: { unavailable: string; withheld: string; continued: string; tooLong: string };
  levelLabels: Record<string, string>;
  methodLabels: Record<string, string>;
};

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
  writing?: { spacing: { note: string; rules: string[]; joins: SpacingJoin[] }; transfer?: { id: string; version: number; prompt: string; instruction: string; note: string }; transfers?: TransferDef[]; logs?: LogDef[]; review?: WritingReviewDef };
  /** Content version 3: the pier of visit v5 (two reviewed spots, a child choice). */
  pier?: { note: string; spots: { id: string; label: string; emoji: string }[] };
  /** Content version 4: the harbor of visit v6. */
  harbor?: HarborDef;
  /** Content version 4: the reviewed reasoning probe script. */
  reasoning?: ReasoningDef;
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
export const EXPECTED_V4_STAGES: readonly StageId[] = ["restore", "station-choice", "typing-course", "EQ-STATION", "explain", "LANG-ES-STATION", "station-build", "log", "log-revise", "log-transfer", "summary", "reflect"]
/**
 * Content version 3 (Visit 4, 2026-10-04): version 2 plus the pier chapter. The v4 stage list is now frozen too (saved
 * missions index it numerically); v5 adds the remainder item EQ-PIER, the English request LANG-EN-PIER, the pier build
 * and the second transfer check. Learner-visible label: "Besuch 4".
 */
export const EXPECTED_VISIT_IDS_V3: readonly VisitId[] = [...EXPECTED_VISIT_IDS_V2, "v5"];
export const EXPECTED_MATH_ITEM_IDS_V3: readonly MathItemId[] = [...EXPECTED_MATH_ITEM_IDS_V2, "EQ-PIER"];
export const EXPECTED_LANGUAGE_SEGMENT_IDS_V3: readonly LanguageSegmentId[] = [...EXPECTED_LANGUAGE_SEGMENT_IDS_V2, "LANG-EN-PIER"];
export const EXPECTED_V5_STAGES: readonly StageId[] = ["restore", "typing-course", "EQ-PIER", "explain", "LANG-EN-PIER", "pier-build", "log", "log-revise", "log-transfer", "summary", "reflect"];
export const EXPECTED_TRANSFER_ID_V5 = "WRITE-TRANSFER-2";
/**
 * Content version 4 (Visit 5, 2026-10-10): version 3 plus the harbor chapter. The v5 stage list is frozen too; v6 adds the
 * quotient items EQ-HARBOR / EQ-HARBOR-CHECK with the example EQ-HARBOR-MODEL, the Spanish supplier LANG-ES-HARBOR and its
 * closing recall LANG-ES-HARBOR-CHECK, the harbor plan, the captain's log WRITE-LOG-HARBOR with the writing review and the
 * reasoning probe script. Learner-visible label: "Besuch 5". The default stage order below is FROZEN; the child's actual
 * order is the per-visit route (typing first or planning first).
 */
export const EXPECTED_VISIT_IDS_V4: readonly VisitId[] = [...EXPECTED_VISIT_IDS_V3, "v6"];
export const EXPECTED_MATH_ITEM_IDS_V4: readonly MathItemId[] = [...EXPECTED_MATH_ITEM_IDS_V3, "EQ-HARBOR", "EQ-HARBOR-MODEL", "EQ-HARBOR-CHECK"];
export const EXPECTED_LANGUAGE_SEGMENT_IDS_V4: readonly LanguageSegmentId[] = [...EXPECTED_LANGUAGE_SEGMENT_IDS_V3, "LANG-ES-HARBOR", "LANG-ES-HARBOR-CHECK"];
export const EXPECTED_V6_STAGES: readonly StageId[] = ["restore", "island", "typing-course", "island", "EQ-HARBOR", "explain", "LANG-ES-HARBOR", "harbor-build", "log", "island", "EQ-HARBOR-CHECK", "LANG-ES-HARBOR-CHECK", "log-review", "summary", "reflect"];
export const EXPECTED_HARBOR_WORKPLACES: Readonly<Record<HarborWorkplaceId, readonly StageId[]>> = { typing: ["typing-course"], planning: ["EQ-HARBOR", "explain", "LANG-ES-HARBOR", "harbor-build", "log"], closing: ["EQ-HARBOR-CHECK", "LANG-ES-HARBOR-CHECK", "log-review"] };
export const EXPECTED_LOG_ID_V6 = "WRITE-LOG-HARBOR";
export const EXPECTED_REASONING_ID = "REASON-HARBOR";
export const WRITING_REVIEW_ASPECTS: readonly WritingReviewAspect[] = ["meaning", "completeness", "grammar", "spacing", "capitalization", "spelling", "punctuation"];
/** Stable identity of the fresh writing-transfer check (content v2, round 2). */
export const EXPECTED_TRANSFER_ID = "WRITE-TRANSFER-1";
export const EXPECTED_FEEDBACK_DIMENSIONS: readonly string[] = ["enjoyment", "clarity"];
export type RecipientKind = "people" | "container";
export const KEYBOARD_LAYOUT_IDS: readonly KeyboardLayoutId[] = ["ch-de-qwertz", "de-qwertz", "us-qwerty"];
export const SUPPORTED_CONTENT_VERSIONS: readonly number[] = [1, 2, 3, 4];

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
  if (item.kind === "quotient") {
    // Content v4: how many FULL groups fit (full), what remains (smaller than one group), and how many groups are needed
    // for everything (one more when something remains). `groups` = needed (the trays), `answer` = full.
    const perGroup = item.perGroup;
    const answers = isRecord(item.answers) ? item.answers : null;
    if (typeof perGroup !== "number" || perGroup <= 0 || !answers || typeof answers.full !== "number" || typeof answers.remaining !== "number" || typeof answers.needed !== "number" || typeof answers.used !== "number") {
      problems.push(`${label}: quotient item needs perGroup and answers {used, full, remaining, needed}`);
      return;
    }
    if (Math.floor(quantity / perGroup) !== answers.full) problems.push(`${label}: ${quantity} holds ${Math.floor(quantity / perGroup)} full groups of ${perGroup}, not ${answers.full}`);
    if (answers.full * perGroup !== answers.used) problems.push(`${label}: ${answers.full} × ${perGroup} is not ${answers.used}`);
    if (quantity - answers.used !== answers.remaining) problems.push(`${label}: ${quantity} − ${answers.used} is not ${answers.remaining}`);
    if (answers.remaining < 0 || answers.remaining >= perGroup) problems.push(`${label}: remainder ${answers.remaining} must be smaller than one group of ${perGroup}`);
    if (answers.needed !== answers.full + (answers.remaining > 0 ? 1 : 0)) problems.push(`${label}: ${answers.needed} groups are not needed for ${quantity} (full ${answers.full}, remaining ${answers.remaining})`);
    if (groups !== answers.needed) problems.push(`${label}: groups must equal the needed groups for a quotient item`);
    if (answer !== answers.full) problems.push(`${label}: answer must equal the full groups for a quotient item`);
    if (!isRecord(item.quotientWords) || typeof item.quotientWords.fullLabel !== "string" || typeof item.quotientWords.remainingLabel !== "string" || typeof item.quotientWords.neededLabel !== "string") problems.push(`${label}: quotient item needs quotientWords {fullLabel, remainingLabel, neededLabel}`);
    if (item.scored === true && (typeof item.decisionPrompt !== "string" || typeof item.decisionClarification !== "string")) problems.push(`${label}: scored quotient item needs decisionPrompt and decisionClarification`);
  } else if (item.kind === "remainder") {
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
  const teaching = id === "EQ-MODEL" || id === "EQ-STATION-MODEL" || id === "EQ-HARBOR-MODEL";
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

/** Content v4: the harbor chapter — frozen v6 stage list composed of the workplace blocks, destinations, characters, log, review and reasoning. */
function checkHarborChapter(raw: Record<string, unknown>, problems: string[]) {
  const visits = Array.isArray(raw.visits) ? raw.visits : [];
  const v5 = visits.find((v) => isRecord(v) && v.id === "v5");
  const v5Stages = isRecord(v5) && Array.isArray(v5.stages) ? (v5.stages as unknown[]) : [];
  if (v5Stages.join(",") !== EXPECTED_V5_STAGES.join(",")) problems.push(`visit v5: stage list is frozen from content version 4 on; must be exactly ${EXPECTED_V5_STAGES.join(" → ")}`);
  const v6 = visits.find((v) => isRecord(v) && v.id === "v6");
  const stages = isRecord(v6) && Array.isArray(v6.stages) ? (v6.stages as unknown[]) : [];
  if (stages.join(",") !== EXPECTED_V6_STAGES.join(",")) problems.push(`visit v6: stages must be exactly ${EXPECTED_V6_STAGES.join(" → ")}`);
  const intro = isRecord(v6) && isRecord(v6.intro) ? v6.intro : null;
  if (!intro || typeof intro.who !== "string" || typeof intro.make !== "string" || typeof intro.done !== "string") problems.push("visit v6: intro must say who needs help, what is made and what counts as done");
  const harbor = isRecord(raw.harbor) ? raw.harbor : null;
  if (!harbor) {
    problems.push("harbor: missing (content version 4)");
  } else {
    const destinations = Array.isArray(harbor.destinations) ? harbor.destinations : [];
    if (destinations.length < 2) problems.push("harbor: at least two reviewed destinations");
    for (const d of destinations) if (!isRecord(d) || typeof d.id !== "string" || typeof d.label !== "string" || typeof d.emoji !== "string") problems.push("harbor: malformed destination");
    const workplaces = Array.isArray(harbor.workplaces) ? harbor.workplaces : [];
    sameSet(idsOf(workplaces), Object.keys(EXPECTED_HARBOR_WORKPLACES), "harbor workplaces", problems);
    const characterIds = new Set(idsOf(Array.isArray(harbor.characters) ? harbor.characters : []));
    for (const w of workplaces) {
      if (!isRecord(w) || typeof w.id !== "string" || typeof w.label !== "string" || typeof w.building !== "string" || typeof w.character !== "string" || !Array.isArray(w.stages)) {
        problems.push("harbor: malformed workplace");
        continue;
      }
      const expected = EXPECTED_HARBOR_WORKPLACES[w.id as HarborWorkplaceId];
      if (expected && w.stages.join(",") !== expected.join(",")) problems.push(`harbor workplace ${w.id}: stages must be exactly ${expected.join(" → ")}`);
      if (!characterIds.has(w.character)) problems.push(`harbor workplace ${w.id}: character ${w.character} is not defined`);
      if (w.required !== true) problems.push(`harbor workplace ${w.id}: every workplace of the compact checklist is required`);
    }
    // The frozen default order is the composition restore → island → typing → island → planning → island → closing → summary → reflect.
    const composed = ["restore", "island", ...EXPECTED_HARBOR_WORKPLACES.typing, "island", ...EXPECTED_HARBOR_WORKPLACES.planning, "island", ...EXPECTED_HARBOR_WORKPLACES.closing, "summary", "reflect"];
    if (composed.join(",") !== EXPECTED_V6_STAGES.join(",")) problems.push("harbor: the frozen v6 stage list does not compose from the workplace blocks");
    const characters = Array.isArray(harbor.characters) ? harbor.characters : [];
    const languages = new Set<string>();
    for (const ch of characters) {
      if (!isRecord(ch) || typeof ch.id !== "string" || typeof ch.name !== "string" || typeof ch.role !== "string" || (ch.language !== "de" && ch.language !== "en" && ch.language !== "es") || !Array.isArray(ch.lines) || ch.lines.length === 0) {
        problems.push("harbor: malformed character");
        continue;
      }
      languages.add(ch.language);
      for (const line of ch.lines) {
        if (!isRecord(line) || typeof line.id !== "string" || typeof line.text !== "string" || !line.text.trim()) problems.push(`harbor character ${ch.id}: malformed line`);
        else if (ch.language !== "de" && typeof line.de !== "string") problems.push(`harbor character ${ch.id}: line ${String(line.id)} needs a German translation (recorded help)`);
      }
    }
    if (languages.size !== 3) problems.push("harbor: the three characters must speak German, English and Spanish (one each)");
  }
  const supplies = isRecord(raw.language) && isRecord(raw.language.supplyLabels) ? raw.language.supplyLabels : null;
  for (const key of ["cuerdas", "cajas"]) if (!supplies || !isRecord(supplies[key])) problems.push(`language.supplyLabels: ${key} (visit v6) missing`);
  const writing = isRecord(raw.writing) ? raw.writing : null;
  const logs = Array.isArray(writing?.logs) ? writing.logs : [];
  if (logs.length !== 1) problems.push("writing.logs: exactly one captain's log (v6)");
  const log = logs[0];
  if (!isRecord(log) || log.id !== EXPECTED_LOG_ID_V6 || log.version !== 1 || log.visit !== "v6" || typeof log.prompt !== "string" || typeof log.instruction !== "string") problems.push(`writing.logs: the v6 entry must be ${EXPECTED_LOG_ID_V6} (version 1, visit v6) with a prompt and an instruction`);
  const review = isRecord(writing?.review) ? writing.review : null;
  if (!review) problems.push("writing.review: missing (content version 4)");
  else {
    if (typeof review.maxTeachingPoints !== "number" || review.maxTeachingPoints < 1 || review.maxTeachingPoints > 2) problems.push("writing.review: maxTeachingPoints must be 1 or 2 (teach one or two points per visit)");
    const priority = Array.isArray(review.priority) ? review.priority : [];
    sameSet(priority.map(String), WRITING_REVIEW_ASPECTS, "writing.review.priority", problems);
    for (const key of ["taskWords", "verbs", "subjects", "functionWords"]) {
      const list = Array.isArray(review[key]) ? (review[key] as unknown[]) : [];
      if (list.length === 0 || list.some((w) => typeof w !== "string" || !w.trim() || w !== w.toLowerCase())) problems.push(`writing.review.${key}: non-empty list of lowercase words`);
    }
    const nouns = Array.isArray(review.nouns) ? review.nouns : [];
    if (nouns.length === 0) problems.push("writing.review.nouns: reviewed noun lexicon missing");
    for (const n of nouns) {
      if (!isRecord(n) || typeof n.lemma !== "string" || !Array.isArray(n.forms) || n.forms.length === 0) problems.push("writing.review.nouns: malformed entry");
      else for (const f of n.forms) if (typeof f !== "string" || f[0] !== f[0].toUpperCase()) problems.push(`writing.review.nouns: form "${String(f)}" must be capitalised`);
    }
    const misspellings = Array.isArray(review.misspellings) ? review.misspellings : [];
    for (const m of misspellings) {
      if (!isRecord(m) || typeof m.wrong !== "string" || m.wrong !== m.wrong.toLowerCase() || !(typeof m.right === "string" || m.right === null)) problems.push("writing.review.misspellings: malformed entry");
      else if (typeof m.right === "string" && /ß/.test(m.right)) problems.push(`writing.review.misspellings: "${m.right}" must use Swiss spelling (ss)`);
    }
  }
  const reasoning = isRecord(raw.reasoning) ? raw.reasoning : null;
  if (!reasoning) problems.push("reasoning: missing (content version 4)");
  else {
    if (reasoning.id !== EXPECTED_REASONING_ID || reasoning.version !== 5) problems.push(`reasoning: must be ${EXPECTED_REASONING_ID} version 5 (assessment reset: Nabu's per-criterion assessment with passages, prompt bank, support mode)`);
    const schemaLines: unknown[] = Array.isArray(reasoning.schema) ? reasoning.schema : [];
    if (schemaLines.length < 8 || !schemaLines.some((l) => typeof l === "string" && /^ANTWORT:/.test(l)) || !schemaLines.some((l) => typeof l === "string" && /^ART: klaerung/.test(l)) || !schemaLines.some((l) => typeof l === "string" && /^PROMPT:/.test(l)) || !["RECHENWEG", "MENGEN", "BEDEUTUNG", "WIDERSPRUCH"].every((k) => schemaLines.some((l) => typeof l === "string" && l.startsWith(`${k}:`)))) problems.push("reasoning.schema: the strict seven-line assessment schema (ANTWORT, ART, PROMPT, RECHENWEG, MENGEN, BEDEUTUNG, WIDERSPRUCH) is required");
    const criteria: unknown[] = Array.isArray(reasoning.criteria) ? reasoning.criteria : [];
    if (criteria.length !== 3 || !["strategy", "quantities", "meaning"].every((id) => criteria.some((cr) => isRecord(cr) && cr.id === id && typeof cr.label === "string" && typeof cr.question === "string"))) problems.push("reasoning.criteria: exactly the three reviewed criteria strategy, quantities, meaning");
    if (!Array.isArray(reasoning.prompts) || reasoning.prompts.length < 2 || reasoning.prompts.length > 6 || reasoning.prompts.some((p) => !isRecord(p) || typeof p.id !== "string" || !/^P[1-9]$/.test(p.id) || typeof p.text !== "string" || !p.text.trim() || /\d/.test(p.text))) problems.push("reasoning.prompts: two to six reviewed answer-free prompts P1..P9 (no digits)");
    if (typeof reasoning.maxClarifications !== "number" || reasoning.maxClarifications < 1 || reasoning.maxClarifications > 2) problems.push("reasoning.maxClarifications must be 1 or 2");
    if (!isRecord(reasoning.levelLabels) || !["demonstrated", "partial", "not-yet-demonstrated", "uncertain"].every((k) => typeof (reasoning.levelLabels as Record<string, unknown>)[k] === "string")) problems.push("reasoning.levelLabels: the four assessment levels");
    if (typeof reasoning.maxChildTurns !== "number" || reasoning.maxChildTurns < 3 || reasoning.maxChildTurns > 5) problems.push("reasoning: maxChildTurns must be 3 to 5 (bounded conversation)");
    for (const key of ["prompt", "lastRound", "scaffold", "counters", "teach", "afterTeach"]) if (typeof reasoning[key] !== "string" || !(reasoning[key] as string).trim()) problems.push(`reasoning.${key}: missing`);
    if (!Array.isArray(reasoning.rules) || reasoning.rules.length < 4 || reasoning.rules.some((r) => typeof r !== "string" || !r.trim())) problems.push("reasoning.rules: at least four reviewed rules for the assistant");
    if (Array.isArray(reasoning.rules) && !reasoning.rules.some((r) => typeof r === "string" && /Malnehmen/.test(r) && /nie/.test(r))) problems.push("reasoning.rules must state that multiplication is never presumed false");
    if (Array.isArray(reasoning.rules) && !reasoning.rules.some((r) => typeof r === "string" && /ART: klaerung/.test(r) && /PROMPT/.test(r))) problems.push("reasoning.rules must route clarifications through the prompt bank");
    if (Array.isArray(reasoning.rules) && !reasoning.rules.some((r) => typeof r === "string" && /ART: lehre/.test(r) && /Hilfe/.test(r))) problems.push("reasoning.rules must state that free teaching is recorded as help");
    if (Array.isArray(reasoning.rules) && !reasoning.rules.some((r) => typeof r === "string" && /unsicher/.test(r) && /falsch/.test(r))) problems.push("reasoning.rules must state that uncertainty is allowed and is not 'wrong'");
    const fallback = isRecord(reasoning.fallback) ? reasoning.fallback : null;
    for (const key of ["unavailable", "withheld", "continued", "tooLong"]) if (!fallback || typeof fallback[key] !== "string" || !(fallback[key] as string).trim()) problems.push(`reasoning.fallback.${key}: missing`);
    if (typeof reasoning.probes !== "undefined" || typeof reasoning.accept !== "undefined") problems.push("reasoning: a scripted probe/accept policy is not allowed (the dialogue is the assistant's)");
    const labels = isRecord(reasoning.methodLabels) ? reasoning.methodLabels : null;
    for (const key of ["explained-independently", "explained-after-probing", "explained-with-support", "not-yet-established", "unscored"]) if (!labels || typeof labels[key] !== "string") problems.push(`reasoning.methodLabels.${key}: missing`);
  }
}

/**
 * Reconciles a parsed content document against the inventory of its declared
 * content version (1 to 4) and checks every scored item's arithmetic against
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
  const v4 = version === 4;
  const v3 = version === 3 || v4; // every version-3 rule also holds for version 4
  const v2 = version === 2 || v3; // every version-2 rule also holds for version 3

  const visitIds = idsOf(raw.visits);
  counts.visits = visitIds.length;
  sameSet(visitIds, v4 ? EXPECTED_VISIT_IDS_V4 : v3 ? EXPECTED_VISIT_IDS_V3 : v2 ? EXPECTED_VISIT_IDS_V2 : EXPECTED_VISIT_IDS_V1, "visits", problems);
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
  if (v3 && Array.isArray(raw.visits)) {
    const v5 = raw.visits.find((v) => isRecord(v) && v.id === "v5");
    const stages = isRecord(v5) && Array.isArray(v5.stages) ? (v5.stages as unknown[]) : [];
    if (stages.join(",") !== EXPECTED_V5_STAGES.join(",")) problems.push(`visit v5: stages must be exactly ${EXPECTED_V5_STAGES.join(" → ")}`);
    const intro = isRecord(v5) && isRecord(v5.intro) ? v5.intro : null;
    if (!intro || typeof intro.who !== "string" || typeof intro.make !== "string" || typeof intro.done !== "string") problems.push("visit v5: intro must say who needs help, what is made and what counts as done");
    const pier = isRecord(raw.pier) ? raw.pier : null;
    const spots = Array.isArray(pier?.spots) ? pier.spots : [];
    if (spots.length < 2) problems.push("pier: at least two reviewed spots");
    for (const sp of spots) if (!isRecord(sp) || typeof sp.id !== "string" || typeof sp.label !== "string" || typeof sp.emoji !== "string") problems.push("pier: malformed spot");
    const transfers = isRecord(raw.writing) && Array.isArray(raw.writing.transfers) ? raw.writing.transfers : [];
    const byVisit = new Map<string, Record<string, unknown>>();
    for (const t of transfers) if (isRecord(t) && typeof t.visit === "string") byVisit.set(t.visit, t);
    const t4 = byVisit.get("v4");
    const t5 = byVisit.get("v5");
    const base = isRecord(raw.writing) && isRecord(raw.writing.transfer) ? raw.writing.transfer : null;
    if (!t4 || !base || t4.id !== EXPECTED_TRANSFER_ID || t4.prompt !== base.prompt || t4.instruction !== base.instruction || t4.version !== base.version) problems.push(`writing.transfers: the v4 entry must be ${EXPECTED_TRANSFER_ID} unchanged from writing.transfer`);
    if (!t5 || t5.id !== EXPECTED_TRANSFER_ID_V5 || t5.version !== 1 || typeof t5.prompt !== "string" || typeof t5.instruction !== "string") problems.push(`writing.transfers: the v5 entry must be ${EXPECTED_TRANSFER_ID_V5} (version 1) with a prompt and an instruction`);
    if (transfers.length !== 2) problems.push("writing.transfers: exactly one transfer check per chapter (v4, v5)");
    const supplies = isRecord(raw.language) && isRecord(raw.language.supplyLabels) ? raw.language.supplyLabels : null;
    for (const key of ["wood", "rope"]) if (!supplies || !isRecord(supplies[key])) problems.push(`language.supplyLabels: ${key} (visit v5) missing`);
  }
  if (v4 && Array.isArray(raw.visits)) checkHarborChapter(raw, problems);

  const math = isRecord(raw.math) ? raw.math : null;
  const mathIds = idsOf(math?.items);
  counts.math = mathIds.length;
  sameSet(mathIds, v4 ? EXPECTED_MATH_ITEM_IDS_V4 : v3 ? EXPECTED_MATH_ITEM_IDS_V3 : v2 ? EXPECTED_MATH_ITEM_IDS_V2 : EXPECTED_MATH_ITEM_IDS, "math items", problems);
  if (Array.isArray(math?.items)) {
    for (const item of math.items) {
      if (!isRecord(item)) continue;
      if (!v2 && item.kind === "remainder") problems.push(`math ${String(item.id)}: remainder items exist only from content version 2`);
      if (!v4 && item.kind === "quotient") problems.push(`math ${String(item.id)}: quotient items exist only from content version 4`);
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
  sameSet(segmentIds, v4 ? EXPECTED_LANGUAGE_SEGMENT_IDS_V4 : v3 ? EXPECTED_LANGUAGE_SEGMENT_IDS_V3 : v2 ? EXPECTED_LANGUAGE_SEGMENT_IDS_V2 : EXPECTED_LANGUAGE_SEGMENT_IDS, "language segments", problems);
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
  return value === "EQ-ENTRY" || value === "EQ-FRESH" || value === "EQ-RETURN" || value === "EQ-DELAY" || value === "EQ-STATION" || value === "EQ-PIER" || value === "EQ-HARBOR" || value === "EQ-HARBOR-CHECK";
}

export function isLanguageSegmentId(value: unknown): value is LanguageSegmentId {
  return value === "LANG-EN-WATER" || value === "LANG-ES-AGUA" || value === "LANG-ES-STATION" || value === "LANG-EN-PIER" || value === "LANG-ES-HARBOR" || value === "LANG-ES-HARBOR-CHECK";
}

export function isVisitId(value: unknown): value is VisitId {
  return value === "v1" || value === "v2" || value === "v3" || value === "v4" || value === "v5" || value === "v6";
}

export function isHarborWorkplaceId(value: unknown): value is HarborWorkplaceId {
  return value === "typing" || value === "planning" || value === "closing";
}

/** The self-authored log definition of a visit (content v4 binds the captain's log to v6), or null. */
export function logDefFor(content: LearningContent, visit: VisitId | null): LogDef | null {
  if (!visit || !content.writing?.logs) return null;
  return content.writing.logs.find((l) => l.visit === visit) ?? null;
}

/** The harbor character a workplace is kept by, or null. */
export function harborCharacter(content: LearningContent, id: string | null | undefined): HarborCharacter | null {
  if (!id || !content.harbor) return null;
  return content.harbor.characters.find((c) => c.id === id) ?? null;
}

/** The fresh transfer check of a visit: content v3 binds one per chapter; content v2 has the single v4 check. */
export function transferDefFor(content: LearningContent, visit: VisitId | null): TransferDef | null {
  if (!visit || !content.writing) return null;
  const bound = content.writing.transfers?.find((t) => t.visit === visit) ?? null;
  if (bound) return bound;
  if (visit === "v4" && content.writing.transfer) return { ...content.writing.transfer, visit: "v4" };
  return null;
}

/** The verb for the used part of a remainder item ("30 gepflanzt" / "42 verbaut"). */
export function usedWordOf(item: Pick<MathItem, "usedWord">): { past: string; label: string } {
  return item.usedWord ?? { past: "gepflanzt", label: "Gepflanzt" };
}
