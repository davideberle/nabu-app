"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";

// ----- types -----

type RecipeOption = {
  id: string;
  name: string;
  source?: { cookbook: string; author: string; chapter?: string };
  image?: string | null;
  dietary: string[];
  cuisine: string;
  time: { prep: number; cook: number; total: number } | null;
};

type DaySlot = {
  date: string;
  dayOfWeek: string;
  recipeId: string | null;
  recipeName: string | null;
};

type MealPlan = {
  week: string;
  days: DaySlot[];
  locked: boolean;
  createdAt: string;
};

type IngredientGroup = {
  recipeName: string;
  recipeId: string;
  ingredients: { item: string; amount: string }[];
};

// ----- date helpers -----

function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: d.getUTCFullYear(), week };
}

function getWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayOfW1 = new Date(jan4.getTime());
  mondayOfW1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const target = new Date(mondayOfW1.getTime());
  target.setUTCDate(mondayOfW1.getUTCDate() + (week - 1) * 7);
  return target;
}

function getWeekDates(
  year: number,
  week: number
): { date: string; dayOfWeek: string }[] {
  const monday = getWeekMonday(year, week);
  const offsets = [
    { offset: 0, day: "Monday" },
    { offset: 1, day: "Tuesday" },
    { offset: 2, day: "Wednesday" },
    { offset: 3, day: "Thursday" },
    { offset: 6, day: "Sunday" },
  ];
  return offsets.map(({ offset, day }) => {
    const d = new Date(monday.getTime());
    d.setUTCDate(d.getUTCDate() + offset);
    const dateStr = d.toISOString().split("T")[0];
    return { date: dateStr, dayOfWeek: day };
  });
}

function formatWeekId(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function formatDateShort(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

// ----- component -----

export default function MealsPage() {
  const now = new Date();
  const thisWeek = getISOWeek(now);
  const nextWeek = {
    year: thisWeek.year,
    week: thisWeek.week + 1,
  };

  const [activeTab, setActiveTab] = useState<"this" | "next">("this");
  const activeWeek = activeTab === "this" ? thisWeek : nextWeek;
  const weekId = formatWeekId(activeWeek.year, activeWeek.week);
  const weekDates = getWeekDates(activeWeek.year, activeWeek.week);

  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [weekdayOptions, setWeekdayOptions] = useState<RecipeOption[]>([]);
  const [weekendOptions, setWeekendOptions] = useState<RecipeOption[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeOption | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [ingredientGroups, setIngredientGroups] = useState<
    IngredientGroup[] | null
  >(null);
  const [showIngredients, setShowIngredients] = useState(false);

  // Build an empty plan structure
  const buildEmptyPlan = useCallback((): MealPlan => {
    return {
      week: weekId,
      days: weekDates.map((wd) => ({
        date: wd.date,
        dayOfWeek: wd.dayOfWeek,
        recipeId: null,
        recipeName: null,
      })),
      locked: false,
      createdAt: new Date().toISOString(),
    };
  }, [weekId, weekDates]);

  // Load existing plan when tab changes
  useEffect(() => {
    setWeekdayOptions([]);
    setWeekendOptions([]);
    setSelectedRecipe(null);
    setIngredientGroups(null);
    setShowIngredients(false);

    fetch(`/api/meals/plan?week=${weekId}`)
      .then((r) => r.json())
      .then((data: MealPlan | null) => {
        if (data && data.week) {
          setPlan(data);
        } else {
          setPlan(null);
        }
      })
      .catch(() => setPlan(null));
  }, [weekId]);

  // Generate meal options
  async function handleGenerate() {
    setLoading(true);
    try {
      const res = await fetch("/api/meals/generate");
      const data = await res.json();
      setWeekdayOptions(data.weekday);
      setWeekendOptions(data.weekend);
      if (!plan) {
        setPlan(buildEmptyPlan());
      }
    } catch (err) {
      console.error("Failed to generate options:", err);
    } finally {
      setLoading(false);
    }
  }

  // Assign recipe to a day slot
  function handleSlotClick(dayIndex: number) {
    if (!plan || plan.locked || !selectedRecipe) return;
    const newDays = [...plan.days];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      recipeId: selectedRecipe.id,
      recipeName: selectedRecipe.name,
    };
    setPlan({ ...plan, days: newDays });
    setSelectedRecipe(null);
  }

  // Clear a slot
  function handleClearSlot(dayIndex: number) {
    if (!plan || plan.locked) return;
    const newDays = [...plan.days];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      recipeId: null,
      recipeName: null,
    };
    setPlan({ ...plan, days: newDays });
  }

  // Lock plan
  async function handleLock() {
    if (!plan) return;
    const lockedPlan = { ...plan, locked: true };
    try {
      await fetch("/api/meals/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lockedPlan),
      });
      setPlan(lockedPlan);
    } catch (err) {
      console.error("Failed to save plan:", err);
    }
  }

  // Fetch ingredients
  async function handleViewIngredients() {
    if (!plan) return;
    const recipeIds = plan.days
      .map((d) => d.recipeId)
      .filter((id): id is string => id !== null);
    try {
      const res = await fetch("/api/meals/ingredients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeIds }),
      });
      const data = await res.json();
      setIngredientGroups(data.ingredients);
      setShowIngredients(true);
    } catch (err) {
      console.error("Failed to load ingredients:", err);
    }
  }

  const allSlotsFilled =
    plan !== null && plan.days.every((d) => d.recipeId !== null);
  const hasOptions = weekdayOptions.length > 0 || weekendOptions.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 text-sm"
            >
              &larr; Back
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-2xl">&#127869;</span>
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Meals
              </h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Week selector tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("this")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "this"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            This Week (W{thisWeek.week})
          </button>
          <button
            onClick={() => setActiveTab("next")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "next"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            Next Week (W{nextWeek.week})
          </button>
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {weekDates.map((wd, i) => {
            const slot = plan?.days[i] ?? null;
            const isFilled = slot?.recipeId !== null;
            const isSelectable = selectedRecipe && !plan?.locked;
            return (
              <div
                key={wd.date}
                onClick={() => isSelectable && handleSlotClick(i)}
                className={`rounded-lg border p-3 min-h-[120px] flex flex-col transition-colors ${
                  plan?.locked
                    ? "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                    : isSelectable
                      ? "cursor-pointer border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900"
                      : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {wd.dayOfWeek.slice(0, 3)}
                </div>
                <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">
                  {formatDateShort(wd.date)}
                </div>
                {isFilled ? (
                  <div className="flex-1 flex flex-col justify-between">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-3">
                      {slot?.recipeName}
                    </p>
                    {!plan?.locked && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearSlot(i);
                        }}
                        className="mt-1 text-xs text-zinc-400 hover:text-red-500 self-end"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-xs text-zinc-400 dark:text-zinc-600">
                      {isSelectable ? "Click to assign" : "Empty"}
                    </span>
                  </div>
                )}
                {plan?.locked && isFilled && (
                  <div className="mt-1 text-right">
                    <span className="text-xs text-zinc-400">&#128274;</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mb-6">
          {!plan?.locked && (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {loading
                ? "Generating..."
                : hasOptions
                  ? "Re-generate Options"
                  : "Generate Plan"}
            </button>
          )}
          {allSlotsFilled && !plan?.locked && (
            <button
              onClick={handleLock}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              &#128274; Lock Plan
            </button>
          )}
          {plan?.locked && (
            <button
              onClick={handleViewIngredients}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              View Ingredients
            </button>
          )}
        </div>

        {/* Selected recipe indicator */}
        {selectedRecipe && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 flex items-center justify-between">
            <span className="text-sm text-blue-700 dark:text-blue-300">
              Selected:{" "}
              <span className="font-medium">{selectedRecipe.name}</span> &mdash;
              click a day slot to assign
            </span>
            <button
              onClick={() => setSelectedRecipe(null)}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Recipe option cards */}
        {hasOptions && !plan?.locked && (
          <div className="space-y-6">
            {weekdayOptions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 uppercase tracking-wide">
                  Weekday Options
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {weekdayOptions.map((r) => (
                    <RecipeCard
                      key={r.id}
                      recipe={r}
                      isSelected={selectedRecipe?.id === r.id}
                      isAssigned={
                        plan?.days.some((d) => d.recipeId === r.id) ?? false
                      }
                      onSelect={() =>
                        setSelectedRecipe(
                          selectedRecipe?.id === r.id ? null : r
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            {weekendOptions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 uppercase tracking-wide">
                  Weekend Options
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {weekendOptions.map((r) => (
                    <RecipeCard
                      key={r.id}
                      recipe={r}
                      isSelected={selectedRecipe?.id === r.id}
                      isAssigned={
                        plan?.days.some((d) => d.recipeId === r.id) ?? false
                      }
                      onSelect={() =>
                        setSelectedRecipe(
                          selectedRecipe?.id === r.id ? null : r
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Ingredients panel */}
        {showIngredients && ingredientGroups && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                Ingredients
              </h2>
              <button
                onClick={() => setShowIngredients(false)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Hide
              </button>
            </div>
            <div className="space-y-4">
              {ingredientGroups.map((group) => (
                <div
                  key={group.recipeId}
                  className="rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4"
                >
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                    {group.recipeName}
                  </h3>
                  <ul className="space-y-1">
                    {group.ingredients.map((ing, idx) => (
                      <li
                        key={idx}
                        className="text-sm text-zinc-600 dark:text-zinc-400 flex justify-between"
                      >
                        <span>{ing.item}</span>
                        <span className="text-zinc-400 dark:text-zinc-500 ml-2">
                          {ing.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ----- RecipeCard sub-component -----

function RecipeCard({
  recipe,
  isSelected,
  isAssigned,
  onSelect,
}: {
  recipe: RecipeOption;
  isSelected: boolean;
  isAssigned: boolean;
  onSelect: () => void;
}) {
  const vegTags = recipe.dietary.filter(
    (t) => t === "vegan" || t === "vegetarian"
  );
  return (
    <button
      onClick={onSelect}
      disabled={isAssigned}
      className={`text-left p-3 rounded-lg border transition-colors ${
        isAssigned
          ? "opacity-50 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
          : isSelected
            ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-950 ring-2 ring-blue-500/30"
            : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1 line-clamp-2">
        {recipe.name}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
        {recipe.source?.cookbook}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {recipe.cuisine && recipe.cuisine !== "Other" && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {recipe.cuisine}
          </span>
        )}
        {vegTags.map((t) => (
          <span
            key={t}
            className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
          >
            {t}
          </span>
        ))}
        {recipe.time && recipe.time.total > 0 && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {recipe.time.total}min
          </span>
        )}
      </div>
      {isAssigned && (
        <p className="text-xs text-zinc-400 mt-1 italic">Assigned</p>
      )}
    </button>
  );
}
