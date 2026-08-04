"use client";

// Meal balance on /cooking — render the derived whole-meal review and apply
// the analyzer's own adjustment shapes as one-tap session patches.
//
// Two boundaries this component exists to hold (kitchen DESIGN.md §"Phase 4C",
// live-cooking DESIGN.md §3 rule 16):
//
// 1. The review stays *derived*. It is never stored; every apply re-reads the
//    session so the panel shows the server's recomputed review, not an
//    optimistic guess about what the change did.
// 2. Only session state changes. The three adjustment targets the analyzer can
//    emit — component status, seasoning, session note — all land in the
//    Cooking Session. There is no path here that edits a canonical recipe.
//
// The mapping itself (which findings to show, whether an adjustment applies to
// this session, and the patch it becomes) lives in
// `@/lib/meal-balance-actions`, so it is covered by unit tests instead of only
// being source-verified. What is left here is the network branch and the
// rendering.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NabuKicker, NabuSurface } from "@/components/ui/nabu";
import {
  buildSessionPatch,
  canApplySuggestion,
  suggestionKey,
  topFindings,
  topSuggestions,
} from "@/lib/meal-balance-actions";
import type {
  CoherenceSuggestion,
  MealCoherenceReview,
} from "@/lib/meal-coherence";
import type { RelatedRecipe } from "@/lib/cooking-session";

export function MealBalancePanel({
  sessionId,
  review: initialReview,
  relatedRecipes: initialRelatedRecipes,
}: {
  sessionId: string;
  review: MealCoherenceReview;
  relatedRecipes: RelatedRecipe[];
}) {
  const router = useRouter();
  const [review, setReview] = useState(initialReview);
  const [relatedRecipes, setRelatedRecipes] = useState(initialRelatedRecipes);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A coherent meal gets no panel at all — no findings, no empty box.
  if (review.findings.length === 0) return null;

  async function apply(suggestion: CoherenceSuggestion, key: string) {
    const patch = buildSessionPatch(suggestion, relatedRecipes, {
      now: new Date().toISOString(),
      token: Date.now().toString(36),
    });
    if (!patch || applying) return;

    setApplying(key);
    setError(null);
    setApplied(null);
    try {
      const res = await fetch(`/api/cooking/session/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Nothing changed, so nothing is reported as done.
        setError(data.error || `Could not apply that change (${res.status})`);
        return;
      }

      // Re-read the session: the review is derived per request, so the only
      // truthful post-apply state is the one the server recomputes.
      const readBack = await fetch(
        `/api/cooking/session/${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      if (readBack.ok) {
        const session = (await readBack.json()) as {
          coherence?: MealCoherenceReview;
          relatedRecipes?: RelatedRecipe[];
        };
        if (session.coherence) setReview(session.coherence);
        if (session.relatedRecipes) setRelatedRecipes(session.relatedRecipes);
      }
      setApplied(suggestion.summary);
      // The rest of the page renders from the session too (a set-aside
      // component moves out of the meal), so refresh the server render.
      router.refresh();
    } catch {
      setError("Network error — nothing was changed.");
    } finally {
      setApplying(null);
    }
  }

  const findings = topFindings(review);

  return (
    <NabuSurface className="space-y-4 p-5">
      <div>
        <NabuKicker>Meal balance</NabuKicker>
        <ul className="mt-2 space-y-1.5">
          {findings.map((finding) => (
            <li
              key={`${finding.kind}:${finding.lane ?? ""}:${finding.componentIds.join(",")}`}
              className="text-sm leading-relaxed text-secondary"
            >
              {finding.summary}
            </li>
          ))}
        </ul>
      </div>

      {review.suggestions.length > 0 && (
        <div className="space-y-2.5 border-t border-secondary pt-4">
          {topSuggestions(review).map((suggestion, index) => {
            const key = suggestionKey(suggestion, index);
            const applicable = canApplySuggestion(suggestion, relatedRecipes);
            return (
              <div
                key={key}
                className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
              >
                <p className="text-sm leading-relaxed text-tertiary">
                  {suggestion.summary}
                </p>
                {applicable && (
                  <button
                    type="button"
                    onClick={() => apply(suggestion, key)}
                    disabled={applying !== null}
                    className="shrink-0 self-start rounded-md border border-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:bg-secondary disabled:opacity-50 sm:self-auto"
                  >
                    {applying === key ? "Applying…" : "Apply tonight"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {applied && (
        <p className="text-xs text-tertiary">Applied to tonight: {applied}</p>
      )}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </NabuSurface>
  );
}
