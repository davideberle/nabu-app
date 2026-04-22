"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { CookingSession, TonightPlan } from "@/lib/cooking";

type SessionResponse = { session: CookingSession | null };

// ---------------------------------------------------------------------------
// Method cleanup heuristic — merge broken fragments into real steps
// ---------------------------------------------------------------------------

function mergeMethodFragments(steps: string[]): string[] {
  if (steps.length === 0) return steps;

  const merged: string[] = [];
  for (const step of steps) {
    const trimmed = step.trim();
    if (!trimmed) continue;

    if (merged.length === 0) {
      merged.push(trimmed);
      continue;
    }

    const prev = merged[merged.length - 1];
    const startsLowercase = /^[a-z]/.test(trimmed);
    const prevEndsWithContinuation =
      /(?:,|;|:|\band\b|\bor\b|\bthe\b|\bwith\b|\bof\b|\bfor\b|\bto\b|\bin\b|\ba\b|\ban\b)\s*$/i.test(
        prev
      );
    const prevLacksEndPunctuation = !/[.!?)"]\s*$/.test(prev);
    const isShortFragment = trimmed.length < 35;

    // Merge when: starts lowercase, or previous clearly continues, or both
    // are short fragments that look like parts of the same thought
    if (
      startsLowercase ||
      (prevEndsWithContinuation && isShortFragment) ||
      (prevLacksEndPunctuation && isShortFragment && !startsWithVerb(trimmed))
    ) {
      merged[merged.length - 1] = prev + " " + trimmed;
    } else {
      merged.push(trimmed);
    }
  }
  return merged;
}

function startsWithVerb(text: string): boolean {
  // Common cooking-instruction opening verbs
  return /^(Add|Bake|Beat|Blend|Boil|Bring|Broil|Brown|Brush|Chop|Combine|Cook|Cover|Cut|Dice|Drain|Fold|Fry|Garnish|Grate|Grill|Heat|Knead|Layer|Let|Marinate|Melt|Mix|Oil|Peel|Place|Pour|Preheat|Press|Put|Reduce|Remove|Rinse|Roast|Roll|Season|Serve|Set|Simmer|Slice|Soak|Spread|Sprinkle|Stir|Strain|Taste|Toast|Top|Toss|Transfer|Trim|Turn|Wash|Whisk|Wipe)\b/i.test(
    text
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CookingPage() {
  const [session, setSession] = useState<CookingSession | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`/api/cooking?date=${today}`);
    const data: SessionResponse = await res.json();
    setSession(data.session);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSession();
    const interval = setInterval(() => {
      fetchSession();
    }, 12_000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  async function handleStepChange(step: number) {
    if (!session) return;
    setSession({ ...session, currentStep: step });
    await fetch("/api/cooking", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.id, currentStep: step }),
    });
  }

  async function handleComplete() {
    if (!session) return;
    await fetch("/api/cooking", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.id, status: "completed" }),
    });
    setSession({ ...session, status: "completed" });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <Header />
        <main className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-zinc-500 dark:text-zinc-400">Loading...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header />
      <main className="max-w-2xl mx-auto px-4 py-8">
        {session ? (
          <ActiveSession
            session={session}
            onStepChange={handleStepChange}
            onComplete={handleComplete}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-sm"
          >
            &larr; Home
          </Link>
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Tonight&apos;s Cooking
        </h1>
        <div className="w-16" />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="text-center py-16 space-y-6">
      <div className="text-5xl">🍳</div>
      <h2 className="text-xl font-serif font-semibold text-zinc-900 dark:text-zinc-100">
        Nothing planned for today
      </h2>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
        Assign a recipe in the{" "}
        <Link
          href="/meals"
          className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          meal planner
        </Link>{" "}
        and it will appear here automatically.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tonight's Plan — the main actionable cooking section
// ---------------------------------------------------------------------------

function TonightPlanBlock({ tonight }: { tonight: TonightPlan }) {
  // Categorize sections for structured rendering
  const stepSections = tonight.sections.filter((s) =>
    /step|method|cook|instruction|make|do this/i.test(s.title)
  );
  const otherSections = tonight.sections.filter(
    (s) => !/step|method|cook|instruction|make|do this/i.test(s.title)
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
          Tonight&apos;s Plan
        </h3>
        {tonight.updatedAt && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            updated{" "}
            {new Date(tonight.updatedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {tonight.summary && (
        <p className="text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed">
          {tonight.summary}
        </p>
      )}

      {/* Render step-like sections as numbered steps */}
      {stepSections.map((section, i) => (
        <div key={`steps-${i}`} className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {section.title}
          </h4>
          <ol className="space-y-2.5">
            {section.items.map((item, j) => (
              <li key={j} className="flex gap-3 items-start">
                <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-xs font-bold text-amber-700 dark:text-amber-400">
                  {j + 1}
                </span>
                <span className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed pt-0.5">
                  {item}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {/* Render non-step sections (sides, notes, watch-outs) as bullet lists */}
      {otherSections.map((section, i) => (
        <div key={`other-${i}`} className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {section.title}
          </h4>
          <ul className="space-y-1">
            {section.items.map((item, j) => (
              <li
                key={j}
                className="text-sm text-zinc-700 dark:text-zinc-300 pl-3 relative before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-300 dark:before:bg-amber-700"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* If no sections categorized as steps, render all as the old style */}
      {stepSections.length === 0 &&
        otherSections.length === 0 &&
        tonight.sections.map((section, i) => (
          <div key={i} className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              {section.title}
            </h4>
            <ul className="space-y-1">
              {section.items.map((item, j) => (
                <li
                  key={j}
                  className="text-sm text-zinc-700 dark:text-zinc-300 pl-3 relative before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-300 dark:before:bg-amber-700"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active session view
// ---------------------------------------------------------------------------

function ActiveSession({
  session,
  onStepChange,
  onComplete,
}: {
  session: CookingSession;
  onStepChange: (step: number) => void;
  onComplete: () => void;
}) {
  const recipe = session.recipeData;
  const rawSteps = recipe.method ?? [];
  const steps = mergeMethodFragments(rawSteps);
  const isCompleted = session.status === "completed";
  const hasTonight = !!session.tonight;

  // Adjust currentStep when merge reduced step count
  const effectiveStep = Math.min(session.currentStep, steps.length);

  return (
    <div className="space-y-8">
      {/* ---- Dish identity hero ---- */}
      <div className="space-y-3">
        {recipe.image && (
          <div className="relative aspect-[16/9] rounded-xl overflow-hidden bg-zinc-200 dark:bg-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={recipe.image}
              alt={recipe.name}
              className="object-cover w-full h-full"
            />
          </div>
        )}
        <h2 className="text-2xl font-serif font-semibold text-zinc-900 dark:text-zinc-100">
          {recipe.name}
        </h2>
        {recipe.intro && (
          <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed whitespace-pre-line">
            {recipe.intro}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          {recipe.servings && <span>{recipe.servings}</span>}
          {recipe.time?.total && <span>{recipe.time.total} min</span>}
          {recipe.source?.cookbook && (
            <span className="italic">{recipe.source.cookbook}</span>
          )}
        </div>
        {session.serveWith && session.serveWith.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Serve with:
            </span>
            {session.serveWith.map((item, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
              >
                {item}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ---- Tonight's plan — primary cooking section ---- */}
      {hasTonight && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 p-5">
          <TonightPlanBlock tonight={session.tonight!} />
        </div>
      )}

      {/* ---- Divider when both tonight + original exist ---- */}
      {hasTonight && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-zinc-50 dark:bg-zinc-950 px-3 text-xs uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              Original recipe
            </span>
          </div>
        </div>
      )}

      {/* ---- Ingredients ---- */}
      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Ingredients
          </h3>
          <ul className="space-y-1.5">
            {recipe.ingredients.map((ing, i) => (
              <li
                key={i}
                className="text-sm text-zinc-700 dark:text-zinc-300 flex gap-2"
              >
                <span className="text-zinc-400 dark:text-zinc-500 min-w-[4rem] text-right shrink-0">
                  {typeof ing === "string" ? "" : ing.amount ?? ""}
                </span>
                <span>
                  {typeof ing === "string" ? ing : ing.item ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Method steps (with fragment merging) ---- */}
      {steps.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Method
          </h3>
          <ol className="space-y-4">
            {steps.map((step, i) => {
              const isDone = i < effectiveStep;
              const isCurrent = i === effectiveStep && !isCompleted;
              return (
                <li key={i} className="flex gap-3 items-start group">
                  <button
                    onClick={() => onStepChange(isDone ? i : i + 1)}
                    disabled={isCompleted}
                    className={`mt-0.5 shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                      isDone
                        ? "bg-amber-600 border-amber-600 text-white"
                        : isCurrent
                          ? "border-amber-500 text-amber-600 dark:text-amber-400"
                          : "border-zinc-300 dark:border-zinc-600 text-zinc-400 dark:text-zinc-500"
                    }`}
                    aria-label={
                      isDone ? `Undo step ${i + 1}` : `Complete step ${i + 1}`
                    }
                  >
                    {isDone ? "\u2713" : i + 1}
                  </button>
                  <p
                    className={`text-sm leading-relaxed pt-1 ${
                      isDone
                        ? "text-zinc-400 dark:text-zinc-500 line-through"
                        : isCurrent
                          ? "text-zinc-900 dark:text-zinc-100 font-medium"
                          : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {step}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* ---- Tips ---- */}
      {recipe.tips && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Tips
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-line">
            {recipe.tips}
          </p>
        </div>
      )}

      {/* ---- Session actions ---- */}
      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
        {isCompleted ? (
          <div className="text-center py-4">
            <p className="text-amber-600 dark:text-amber-400 font-medium">
              Done — enjoy your meal!
            </p>
          </div>
        ) : (
          <button
            onClick={onComplete}
            disabled={effectiveStep < steps.length}
            className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            Mark as done
          </button>
        )}
      </div>
    </div>
  );
}
