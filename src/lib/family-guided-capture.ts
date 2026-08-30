// ---------------------------------------------------------------------------
// Guided Activity Capture — the Family-owned category → routine contract for
// the child Home's "Record something I did" flow (Family DESIGN.md Phase R7,
// family-assistant DESIGN.md §2.1).
//
// The child chooses one of exactly six activity categories, hears/reads a
// task-specific prompt, records through the existing Scribe v2 path, reviews
// the editable transcript, and submits. Every guided submission enters
// `pending_review` — the category resolves to a real Family routine id so the
// submission lands on the same completion identity the Plan board, wallet and
// parent queue already use, and no coin exists before approval.
//
// Pure and client-safe: no React, no DOM, no server imports. Loaded directly
// by `node --test` (hence the explicit `.ts` extension on relative imports).
// ---------------------------------------------------------------------------

import {
  routineDefinitions,
  type RoutineDefinition,
} from "../data/family-routines.ts";
import type { ChildId } from "./family-assistant-turn.ts";

export type GuidedCategoryId =
  | "kumon"
  | "piano"
  | "exercise"
  | "physio"
  | "household"
  | "bonus";

export type GuidedCategory = {
  id: GuidedCategoryId;
  /** Child-readable button label. */
  label: string;
  /** Decorative icon (aria-hidden in the UI). */
  icon: string;
  /**
   * The task-specific prompt, shown on screen and spoken aloud before the
   * child records. One question, no lecture.
   */
  prompt: string;
};

/** Exactly the six approved categories, in display order. */
export const guidedCategories: readonly GuidedCategory[] = [
  {
    id: "kumon",
    label: "Kumon",
    icon: "✏️",
    prompt: "Tell me about your Kumon — which worksheets did you do, and how did it go?",
  },
  {
    id: "piano",
    label: "Piano",
    icon: "🎹",
    prompt: "What did you practice on the piano? Tell me the piece and how it went.",
  },
  {
    id: "exercise",
    label: "Exercise",
    icon: "🤸",
    prompt: "What sport or exercise did you do? Tell me about it.",
  },
  {
    id: "physio",
    label: "Physio",
    icon: "🏃",
    prompt: "Which physio exercises did you do, and how many?",
  },
  {
    id: "household",
    label: "Household",
    icon: "🍽️",
    prompt: "How did you help in the household? Tell me what you did.",
  },
  {
    id: "bonus",
    label: "Bonus",
    icon: "⭐",
    prompt: "What extra thing did you do today? Tell me about it.",
  },
];

export function isGuidedCategoryId(value: unknown): value is GuidedCategoryId {
  return guidedCategories.some((category) => category.id === value);
}

export function guidedCategoryById(id: string | null | undefined): GuidedCategory | null {
  return guidedCategories.find((category) => category.id === id) ?? null;
}

/**
 * Family-owned mapping from guided category to the per-child routine id the
 * submission is recorded against. Kept explicit (no string templating) so a
 * routine rename in the seed data breaks this table loudly, not silently.
 */
const GUIDED_ROUTINE_IDS: Record<ChildId, Record<GuidedCategoryId, string>> = {
  santiago: {
    kumon: "s-kumon",
    piano: "s-piano",
    exercise: "s-exercise",
    physio: "s-physio",
    household: "s-table-dinner",
    bonus: "s-extra-bonus",
  },
  isabel: {
    kumon: "i-kumon",
    piano: "i-piano",
    exercise: "i-exercise",
    physio: "i-physio",
    household: "i-dinner",
    bonus: "i-extra-bonus",
  },
};

/**
 * Resolve the routine a guided submission belongs to. Null only if the seed
 * data and this table have drifted apart — the test suite asserts every
 * mapping resolves for both children, so a null here is a broken build, not a
 * runtime branch.
 */
export function guidedRoutineFor(
  child: ChildId,
  category: GuidedCategoryId,
): RoutineDefinition | null {
  const routineId = GUIDED_ROUTINE_IDS[child]?.[category];
  if (!routineId) return null;
  return routineDefinitions.find((routine) => routine.id === routineId) ?? null;
}

/**
 * The `challenge` line stored with a guided submission, so the parent queue
 * shows how the transcript was captured. Deliberately constant per category:
 * it must never carry model output or invented judgement.
 */
export function guidedSubmissionChallenge(category: GuidedCategory): string {
  return `Recorded with the guided "${category.label}" flow`;
}
