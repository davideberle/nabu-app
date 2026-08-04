// The /cooking meal-balance mapping: derived review → session patch.
//
// Kitchen DESIGN.md §"Phase 4C" draws two boundaries this module holds, and it
// is separate from `app/cooking/meal-balance.tsx` so both are testable without
// React or a network:
//
// 1. Only session state changes. The three adjustment targets the analyzer can
//    emit — component status, seasoning, session note — all land in the Cooking
//    Session. There is no shape here that edits a canonical recipe.
// 2. Fail closed. An adjustment this module does not understand, or one aimed
//    at a component the session does not list, produces **no patch** — the UI
//    renders it as guidance rather than as a button that would silently do
//    nothing or write the wrong thing.

// Explicit .ts extensions: this module is loaded directly by `node --test`,
// whose ESM resolver does not add extensions.
import type {
  CoherenceSuggestion,
  MealCoherenceReview,
} from "./meal-coherence.ts";
import type { RelatedRecipe, SessionPatch } from "./cooking-session.ts";

const SEVERITY_RANK = { major: 3, minor: 2, info: 1 } as const;

/** How many findings and suggestions the panel shows. */
export const MAX_FINDINGS = 2;
export const MAX_SUGGESTIONS = 3;

/**
 * Findings worth interrupting a cook for: the most serious first, capped.
 *
 * The sort is stable within a severity, so a re-read of the same review shows
 * the same two findings in the same order rather than shuffling under the
 * cook's hand.
 */
export function topFindings(review: MealCoherenceReview): MealCoherenceReview["findings"] {
  return [...review.findings]
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity] ||
        a.index - b.index,
    )
    .slice(0, MAX_FINDINGS)
    .map((entry) => entry.finding);
}

/** The suggestions the panel offers, capped in the analyzer's own order. */
export function topSuggestions(review: MealCoherenceReview): CoherenceSuggestion[] {
  return review.suggestions.slice(0, MAX_SUGGESTIONS);
}

/** Stable React key for one suggestion at one position. */
export function suggestionKey(suggestion: CoherenceSuggestion, index: number): string {
  return `${suggestion.kind}:${suggestion.adjustment.target}:${index}`;
}

/**
 * Can this adjustment be expressed against *this* session?
 *
 * A component-status change for something the session does not list cannot: the
 * patch would name a component that is not there. Those render as guidance
 * without a button rather than as a control that does nothing.
 */
export function canApplySuggestion(
  suggestion: CoherenceSuggestion,
  relatedRecipes: RelatedRecipe[],
): boolean {
  const adjustment = suggestion?.adjustment;
  if (!adjustment) return false;
  if (adjustment.target === "component-status") {
    return relatedRecipes.some((r) => r.recipeId === adjustment.componentId);
  }
  return adjustment.target === "seasoning" || adjustment.target === "session-note";
}

/**
 * Deterministic inputs the caller supplies instead of the module reading a
 * clock: the same suggestion with the same stamp must produce the same patch.
 */
export type PatchStamp = {
  /** ISO timestamp recorded on a created adaptation. */
  now: string;
  /** Short suffix that makes a created adaptation id unique. */
  token: string;
};

/**
 * Turn one analyzer adjustment into a session patch, or `null` when it cannot
 * be applied.
 *
 * Component status → a `relatedRecipes` patch that changes **only** the named
 * component's status and preserves every other component verbatim.
 * Seasoning → a session adaptation plus a visible note; tonight's cooking, not
 * a recipe edit, so the component's own recipe is untouched.
 * Session note → an appended note.
 * Anything else → `null`.
 */
export function buildSessionPatch(
  suggestion: CoherenceSuggestion,
  relatedRecipes: RelatedRecipe[],
  stamp: PatchStamp,
): SessionPatch | null {
  if (!canApplySuggestion(suggestion, relatedRecipes)) return null;
  const adjustment = suggestion.adjustment;

  if (adjustment.target === "session-note") {
    const text = adjustment.text?.trim();
    return text ? { appendNotes: text } : null;
  }

  if (adjustment.target === "component-status") {
    return {
      relatedRecipes: relatedRecipes.map((r) =>
        r.recipeId === adjustment.componentId ? { ...r, status: adjustment.status } : r,
      ),
    };
  }

  if (adjustment.target === "seasoning") {
    const summary = suggestion.summary?.trim();
    if (!summary) return null;
    return {
      adaptations: [
        {
          id: `coherence-${adjustment.componentId}-${stamp.token}`,
          kind: "ingredient-substitution",
          summary,
          messageSource: "app",
          createdAt: stamp.now,
        },
      ],
      appendNotes: summary,
    };
  }

  // Unknown target: fail closed rather than guess at a shape.
  return null;
}
