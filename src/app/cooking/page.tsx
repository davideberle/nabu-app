"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type {
  CookingSession,
  CookingFeedback,
  TonightPlan,
  RecipeHistory,
} from "@/lib/cooking";

type SessionResponse = {
  session: CookingSession | null;
  history?: RecipeHistory | null;
};

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
  return /^(Add|Bake|Beat|Blend|Boil|Bring|Broil|Brown|Brush|Chop|Combine|Cook|Cover|Cut|Dice|Drain|Fold|Fry|Garnish|Grate|Grill|Heat|Knead|Layer|Let|Marinate|Melt|Mix|Oil|Peel|Place|Pour|Preheat|Press|Put|Reduce|Remove|Rinse|Roast|Roll|Season|Serve|Set|Simmer|Slice|Soak|Spread|Sprinkle|Stir|Strain|Taste|Toast|Top|Toss|Transfer|Trim|Turn|Wash|Whisk|Wipe)\b/i.test(
    text
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CookingPage() {
  const [session, setSession] = useState<CookingSession | null>(null);
  const [history, setHistory] = useState<RecipeHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`/api/cooking?date=${today}`);
    const data: SessionResponse = await res.json();
    setSession(data.session);
    setHistory(data.history ?? null);
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

  async function handleFeedback(feedback: CookingFeedback) {
    if (!session) return;
    await fetch("/api/cooking", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.id, feedback }),
    });
    setSession({ ...session, feedback });
    fetchSession();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f6f3] dark:bg-stone-950">
        <Header />
        <main className="max-w-2xl mx-auto px-5 py-16 text-center">
          <p className="text-stone-400 dark:text-stone-500 text-sm">Loading...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f6f3] dark:bg-stone-950">
      <Header />
      <main className="max-w-2xl mx-auto px-5 py-8">
        {session ? (
          <ActiveSession
            session={session}
            history={history}
            onStepChange={handleStepChange}
            onComplete={handleComplete}
            onFeedback={handleFeedback}
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
    <header className="border-b border-stone-200/80 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 backdrop-blur-sm">
      <div className="max-w-2xl mx-auto px-5 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-lg font-serif text-stone-800 dark:text-stone-100">
          Cooking
        </h1>
        <div className="w-5" />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="text-center py-20 space-y-5">
      <h2 className="text-xl font-serif text-stone-700 dark:text-stone-200">
        Nothing planned for today
      </h2>
      <p className="text-sm text-stone-400 dark:text-stone-500 max-w-xs mx-auto leading-relaxed">
        Assign a recipe in the{" "}
        <Link
          href="/meals"
          className="underline underline-offset-2 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
        >
          meal planner
        </Link>{" "}
        and it will appear here automatically.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active session — unified meal flow
// ---------------------------------------------------------------------------

function ActiveSession({
  session,
  history,
  onStepChange,
  onComplete,
  onFeedback,
}: {
  session: CookingSession;
  history: RecipeHistory | null;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onFeedback: (feedback: CookingFeedback) => void;
}) {
  const recipe = session.recipeData;
  const rawSteps = recipe.method ?? [];
  const steps = mergeMethodFragments(rawSteps);
  const isCompleted = session.status === "completed";
  const hasTonight = !!session.tonight;
  const effectiveStep = Math.min(session.currentStep, steps.length);

  return (
    <div className="space-y-0">
      {/* ================================================================
          HERO — dish identity, companions, and history as one surface
          ================================================================ */}
      <section className="pb-10">
        {recipe.image && (
          <div className="relative aspect-[16/9] rounded-2xl overflow-hidden bg-stone-200 dark:bg-stone-800 mb-6 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={recipe.image}
              alt={recipe.name}
              className="object-cover w-full h-full"
            />
          </div>
        )}

        <h2 className="text-2xl sm:text-3xl font-serif text-stone-800 dark:text-stone-100 leading-snug">
          {recipe.name}
        </h2>

        {/* Subtle meta line */}
        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-stone-400 dark:text-stone-500">
          {recipe.servings && <span>{recipe.servings}</span>}
          {recipe.time?.total && (
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {recipe.time.total} min
            </span>
          )}
          {recipe.source?.cookbook && (
            <span className="italic">{recipe.source.cookbook}</span>
          )}
        </div>

        {/* Serve with — integrated as quiet companion tags */}
        {session.serveWith && session.serveWith.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500">
              Serve with
            </span>
            {session.serveWith.map((item, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
              >
                {item}
              </span>
            ))}
          </div>
        )}

        {/* Intro */}
        {recipe.intro && (
          <p className="mt-5 text-sm text-stone-500 dark:text-stone-400 leading-relaxed font-serif italic">
            {recipe.intro}
          </p>
        )}

        {/* History — subtle inline, not a card */}
        {history && (
          <div className="mt-4 text-xs text-stone-400 dark:text-stone-500 flex items-center gap-2">
            <span>
              Cooked {history.totalCooks} {history.totalCooks === 1 ? "time" : "times"}
            </span>
            <span className="text-stone-300 dark:text-stone-700">&middot;</span>
            <span>last {history.lastCooked}</span>
            {history.recentFeedback.length > 0 && (
              <>
                <span className="text-stone-300 dark:text-stone-700">&middot;</span>
                <span className="capitalize">
                  {history.recentFeedback[0].verdict.replace("-", " ")}
                </span>
              </>
            )}
          </div>
        )}
      </section>

      {/* ================================================================
          TONIGHT'S PLAN — flows as the primary cooking section
          ================================================================ */}
      {hasTonight && (
        <section className="pb-10">
          <TonightPlanBlock tonight={session.tonight!} />
          {/* Quiet transition to original recipe */}
          <div className="flex justify-center pt-10">
            <div className="w-12 h-px bg-stone-200 dark:bg-stone-800" />
          </div>
          <p className="text-center text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500 mt-4 mb-2">
            Original recipe
          </p>
        </section>
      )}

      {/* ================================================================
          INGREDIENTS — clean list
          ================================================================ */}
      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <section className="pb-10">
          <h3 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-4">
            Ingredients
          </h3>
          <ul className="space-y-2">
            {recipe.ingredients.map((ing, i) => (
              <li
                key={i}
                className="text-sm text-stone-600 dark:text-stone-300 flex gap-3"
              >
                <span className="text-stone-400 dark:text-stone-500 min-w-[4.5rem] text-right shrink-0 tabular-nums">
                  {typeof ing === "string" ? "" : ing.amount ?? ""}
                </span>
                <span>{typeof ing === "string" ? ing : ing.item ?? ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ================================================================
          METHOD — step-by-step with progress
          ================================================================ */}
      {steps.length > 0 && (
        <section className="pb-10">
          <h3 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-5">
            Method
          </h3>
          <ol className="space-y-5">
            {steps.map((step, i) => {
              const isDone = i < effectiveStep;
              const isCurrent = i === effectiveStep && !isCompleted;
              return (
                <li key={i} className="flex gap-4 items-start">
                  <button
                    onClick={() => onStepChange(isDone ? i : i + 1)}
                    disabled={isCompleted}
                    className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                      isDone
                        ? "bg-stone-700 dark:bg-stone-300 text-white dark:text-stone-900"
                        : isCurrent
                          ? "border-2 border-stone-400 dark:border-stone-500 text-stone-600 dark:text-stone-300"
                          : "border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-600"
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
                        ? "text-stone-300 dark:text-stone-600 line-through"
                        : isCurrent
                          ? "text-stone-800 dark:text-stone-100"
                          : "text-stone-500 dark:text-stone-400"
                    }`}
                  >
                    {step}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ================================================================
          TIPS — quiet aside
          ================================================================ */}
      {recipe.tips && (
        <section className="pb-10">
          <div className="rounded-xl bg-stone-100/60 dark:bg-stone-900/40 px-5 py-4">
            <p className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-2">
              Tip
            </p>
            <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">
              {recipe.tips}
            </p>
          </div>
        </section>
      )}

      {/* ================================================================
          SESSION ACTIONS — completion + feedback
          ================================================================ */}
      <section className="pt-4 border-t border-stone-200/60 dark:border-stone-800">
        {isCompleted ? (
          <div className="space-y-8">
            <p className="text-center text-sm text-stone-500 dark:text-stone-400">
              Done — enjoy your meal
            </p>
            <FeedbackBlock
              existingFeedback={session.feedback}
              onSubmit={onFeedback}
            />
          </div>
        ) : (
          <button
            onClick={onComplete}
            disabled={effectiveStep < steps.length}
            className="w-full py-3 rounded-xl bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 text-sm font-medium hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Mark as done
          </button>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tonight's Plan — flows as editorial content
// ---------------------------------------------------------------------------

function TonightPlanBlock({ tonight }: { tonight: TonightPlan }) {
  const stepSections = tonight.sections.filter((s) =>
    /step|method|cook|instruction|make|do this/i.test(s.title)
  );
  const otherSections = tonight.sections.filter(
    (s) => !/step|method|cook|instruction|make|do this/i.test(s.title)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500">
          Tonight&apos;s Plan
        </h3>
        {tonight.updatedAt && (
          <span className="text-[11px] text-stone-300 dark:text-stone-600">
            {new Date(tonight.updatedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {tonight.summary && (
        <p className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed">
          {tonight.summary}
        </p>
      )}

      {/* Step-like sections */}
      {stepSections.map((section, i) => (
        <div key={`steps-${i}`} className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500">
            {section.title}
          </h4>
          <ol className="space-y-3">
            {section.items.map((item, j) => (
              <li key={j} className="flex gap-3 items-start">
                <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-[11px] font-medium text-stone-500 dark:text-stone-400">
                  {j + 1}
                </span>
                <span className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed pt-0.5">
                  {item}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {/* Other sections (sides, notes, etc.) — quiet supplementary items */}
      {otherSections.map((section, i) => (
        <div key={`other-${i}`} className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500">
            {section.title}
          </h4>
          <ul className="space-y-1.5">
            {section.items.map((item, j) => (
              <li
                key={j}
                className="text-sm text-stone-500 dark:text-stone-400 pl-4 relative before:absolute before:left-0 before:top-[9px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-stone-300 dark:before:bg-stone-700"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Fallback for unsorted sections */}
      {stepSections.length === 0 &&
        otherSections.length === 0 &&
        tonight.sections.map((section, i) => (
          <div key={i} className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500">
              {section.title}
            </h4>
            <ul className="space-y-1.5">
              {section.items.map((item, j) => (
                <li
                  key={j}
                  className="text-sm text-stone-500 dark:text-stone-400 pl-4 relative before:absolute before:left-0 before:top-[9px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-stone-300 dark:before:bg-stone-700"
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
// Post-cook feedback
// ---------------------------------------------------------------------------

const VERDICT_LABELS: Record<CookingFeedback["verdict"], string> = {
  great: "Great",
  good: "Good",
  okay: "Okay",
  "not-again": "Not again",
};

const VERDICT_OPTIONS: { value: CookingFeedback["verdict"]; label: string }[] =
  [
    { value: "great", label: "Great" },
    { value: "good", label: "Good" },
    { value: "okay", label: "Okay" },
    { value: "not-again", label: "Not again" },
  ];

function FeedbackBlock({
  existingFeedback,
  onSubmit,
}: {
  existingFeedback?: CookingFeedback;
  onSubmit: (feedback: CookingFeedback) => void;
}) {
  const [verdict, setVerdict] = useState<CookingFeedback["verdict"] | null>(
    existingFeedback?.verdict ?? null
  );
  const [wouldCookAgain, setWouldCookAgain] = useState(
    existingFeedback?.wouldCookAgain ?? true
  );
  const [notes, setNotes] = useState(existingFeedback?.notes ?? "");
  const [keepForNextTime, setKeepForNextTime] = useState(
    existingFeedback?.keepForNextTime?.join("\n") ?? ""
  );
  const [changeNextTime, setChangeNextTime] = useState(
    existingFeedback?.changeNextTime?.join("\n") ?? ""
  );
  const [saved, setSaved] = useState(!!existingFeedback);

  function handleSubmit() {
    if (!verdict) return;
    const keepLines = keepForNextTime
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const changeLines = changeNextTime
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    onSubmit({
      verdict,
      wouldCookAgain,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(keepLines.length ? { keepForNextTime: keepLines } : {}),
      ...(changeLines.length ? { changeNextTime: changeLines } : {}),
      capturedAt: new Date().toISOString(),
    });
    setSaved(true);
  }

  if (saved && existingFeedback) {
    return (
      <div className="rounded-xl bg-stone-100/60 dark:bg-stone-900/40 p-5 space-y-3">
        <h3 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500">
          Your feedback
        </h3>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          <span className="font-medium">
            {VERDICT_LABELS[existingFeedback.verdict]}
          </span>
          {" — "}
          {existingFeedback.wouldCookAgain
            ? "would cook again"
            : "probably not again"}
        </p>
        {existingFeedback.notes && (
          <p className="text-xs text-stone-400 dark:text-stone-500">
            {existingFeedback.notes}
          </p>
        )}
        <button
          onClick={() => setSaved(false)}
          className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 underline underline-offset-2 transition-colors"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-stone-100/60 dark:bg-stone-900/40 p-5 space-y-5">
      <h3 className="text-[11px] uppercase tracking-widest text-stone-400 dark:text-stone-500">
        How was it?
      </h3>

      {/* Verdict */}
      <div className="flex gap-2">
        {VERDICT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setVerdict(opt.value)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              verdict === opt.value
                ? "bg-stone-700 dark:bg-stone-200 text-white dark:text-stone-900"
                : "bg-stone-200/60 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Would cook again */}
      <label className="flex items-center gap-2.5 text-sm text-stone-600 dark:text-stone-300">
        <input
          type="checkbox"
          checked={wouldCookAgain}
          onChange={(e) => setWouldCookAgain(e.target.checked)}
          className="rounded border-stone-300 dark:border-stone-600 text-stone-700 focus:ring-stone-500"
        />
        Would cook again
      </label>

      {/* Notes */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Any notes? (optional)"
        rows={2}
        className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm text-stone-700 dark:text-stone-200 p-3 placeholder:text-stone-400 dark:placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400 resize-none"
      />

      {/* Keep / change */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-stone-400 dark:text-stone-500 block mb-1.5">
            Keep next time
          </label>
          <textarea
            value={keepForNextTime}
            onChange={(e) => setKeepForNextTime(e.target.value)}
            placeholder="One per line"
            rows={2}
            className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs text-stone-700 dark:text-stone-200 p-2.5 placeholder:text-stone-400 dark:placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400 resize-none"
          />
        </div>
        <div>
          <label className="text-[11px] text-stone-400 dark:text-stone-500 block mb-1.5">
            Change next time
          </label>
          <textarea
            value={changeNextTime}
            onChange={(e) => setChangeNextTime(e.target.value)}
            placeholder="One per line"
            rows={2}
            className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs text-stone-700 dark:text-stone-200 p-2.5 placeholder:text-stone-400 dark:placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400 resize-none"
          />
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!verdict}
        className="w-full py-2.5 rounded-xl bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 text-sm font-medium hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Save feedback
      </button>
    </div>
  );
}
