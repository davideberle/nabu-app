"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { CookingSession } from "@/lib/cooking";

type SessionResponse = { session: CookingSession | null };

export default function CookingPage() {
  const [session, setSession] = useState<CookingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`/api/cooking?date=${today}`);
    const data: SessionResponse = await res.json();
    setSession(data.session);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  async function handleStart() {
    setStarting(true);
    setError(null);
    const res = await fetch("/api/cooking/start", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to start session");
      if (res.status === 409 && data.session) {
        setSession(data.session);
      }
      setStarting(false);
      return;
    }
    setSession(data.session);
    setStarting(false);
  }

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
          <EmptyState
            onStart={handleStart}
            starting={starting}
            error={error}
          />
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
          Today&apos;s Recipe
        </h1>
        <div className="w-16" />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  onStart,
  starting,
  error,
}: {
  onStart: () => void;
  starting: boolean;
  error: string | null;
}) {
  return (
    <div className="text-center py-16 space-y-6">
      <div className="text-5xl">🍳</div>
      <h2 className="text-xl font-serif font-semibold text-zinc-900 dark:text-zinc-100">
        Nothing cooking yet
      </h2>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
        Start a cooking session from today&apos;s meal plan to see the recipe
        and track your progress step by step.
      </p>
      <button
        onClick={onStart}
        disabled={starting}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium transition-colors"
      >
        {starting ? "Starting..." : "Start from today\u2019s plan"}
      </button>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
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
  const steps = recipe.method ?? [];
  const isCompleted = session.status === "completed";

  return (
    <div className="space-y-8">
      {/* Recipe header */}
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
          <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
            {recipe.intro}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          {recipe.servings && <span>{recipe.servings}</span>}
          {recipe.time?.total && <span>{recipe.time.total} min</span>}
        </div>
      </div>

      {/* Ingredients */}
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
                  {typeof ing === "string"
                    ? ""
                    : ing.amount ?? ""}
                </span>
                <span>
                  {typeof ing === "string" ? ing : ing.item ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Method steps */}
      {steps.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Method
          </h3>
          <ol className="space-y-4">
            {steps.map((step, i) => {
              const isDone = i < session.currentStep;
              const isCurrent = i === session.currentStep && !isCompleted;
              return (
                <li key={i} className="flex gap-3 items-start group">
                  <button
                    onClick={() =>
                      onStepChange(isDone ? i : i + 1)
                    }
                    disabled={isCompleted}
                    className={`mt-0.5 shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                      isDone
                        ? "bg-amber-600 border-amber-600 text-white"
                        : isCurrent
                          ? "border-amber-500 text-amber-600 dark:text-amber-400"
                          : "border-zinc-300 dark:border-zinc-600 text-zinc-400 dark:text-zinc-500"
                    }`}
                    aria-label={isDone ? `Undo step ${i + 1}` : `Complete step ${i + 1}`}
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

      {/* Session actions */}
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
            disabled={session.currentStep < steps.length}
            className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            Mark as done
          </button>
        )}
      </div>
    </div>
  );
}
