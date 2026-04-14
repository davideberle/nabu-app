"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback, useRef } from "react";

// ----- types -----

type RecipeOption = {
  id: string;
  name: string;
  source?: { cookbook: string; author: string; chapter?: string };
  image?: string | null;
  dietary: string[];
  cuisine: string;
  time: { prep: number; cook: number; total: number } | null;
  category: string;
};

type WeekendMealCombo = {
  main: RecipeOption;
  sides: RecipeOption[];
};

type RecipeDetail = RecipeOption & {
  introduction?: string | null;
  tips?: string | null;
  servings?: string;
  ingredients: { item: string; amount: string; unit?: string; group?: string | null }[];
  method: string[];
};

type WeekContextItem = {
  id: string;
  date?: string;
  kind: "restaurant" | "guests" | "quick" | "skip" | "leftovers" | "custom";
  note: string;
  effect?: "skip-meal" | "guest-friendly" | "quick-meal" | "light-meal";
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
  context?: WeekContextItem[];
  notes?: string;
  locked: boolean;
  createdAt: string;
  updatedAt?: string;
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

// ----- context kind labels -----

const CONTEXT_KIND_OPTIONS: { value: WeekContextItem["kind"]; label: string }[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "guests", label: "Guests" },
  { value: "quick", label: "Quick meal" },
  { value: "skip", label: "Skip" },
  { value: "leftovers", label: "Leftovers" },
  { value: "custom", label: "Other" },
];

const KIND_TO_EFFECT: Record<string, WeekContextItem["effect"]> = {
  restaurant: "skip-meal",
  skip: "skip-meal",
  guests: "guest-friendly",
  quick: "quick-meal",
  leftovers: "skip-meal",
};

const KIND_COLORS: Record<string, string> = {
  restaurant: "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300",
  guests: "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300",
  quick: "bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300",
  skip: "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300",
  leftovers: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
  custom: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
};

// ----- category colors -----

const CATEGORY_COLORS: Record<string, string> = {
  Pasta: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300",
  Curry: "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300",
  Soup: "bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300",
  Salad: "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300",
  Bowl: "bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300",
  "Stir-Fry": "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
  Tagine: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300",
  Rice: "bg-lime-100 dark:bg-lime-900 text-lime-700 dark:text-lime-300",
  Roast: "bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300",
  Grill: "bg-fuchsia-100 dark:bg-fuchsia-900 text-fuchsia-700 dark:text-fuchsia-300",
  Main: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
};

// ----- autosave hook -----

function useAutosave(plan: MealPlan | null, delayMs = 1500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  const save = useCallback((p: MealPlan) => {
    const serialized = JSON.stringify(p);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;
    fetch("/api/meals/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!plan || plan.locked) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(plan), delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [plan, delayMs, save]);

  // Reset last-saved ref when week changes
  const weekRef = useRef(plan?.week);
  useEffect(() => {
    if (plan?.week !== weekRef.current) {
      weekRef.current = plan?.week;
      lastSavedRef.current = "";
    }
  }, [plan?.week]);
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
  const [weekendMeals, setWeekendMeals] = useState<WeekendMealCombo[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ingredientGroups, setIngredientGroups] = useState<IngredientGroup[] | null>(null);
  const [showIngredients, setShowIngredients] = useState(false);
  const [quickViewRecipe, setQuickViewRecipe] = useState<RecipeDetail | null>(null);
  const [quickViewLoading, setQuickViewLoading] = useState(false);
  const [showContextEditor, setShowContextEditor] = useState(false);

  // Track all shown recipe IDs for "Show More" exclusion
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());

  // Autosave drafts
  useAutosave(plan);

  const buildEmptyPlan = useCallback((): MealPlan => {
    return {
      week: weekId,
      days: weekDates.map((wd) => ({
        date: wd.date,
        dayOfWeek: wd.dayOfWeek,
        recipeId: null,
        recipeName: null,
      })),
      context: [],
      notes: "",
      locked: false,
      createdAt: new Date().toISOString(),
    };
  }, [weekId, weekDates]);

  // Load existing plan when tab changes
  useEffect(() => {
    setWeekdayOptions([]);
    setWeekendOptions([]);
    setWeekendMeals([]);
    setSelectedRecipe(null);
    setIngredientGroups(null);
    setShowIngredients(false);
    setShownIds(new Set());
    setShowContextEditor(false);

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

  // Generate meal options (initial)
  async function handleGenerate() {
    setLoading(true);
    try {
      const contextParam = plan?.context?.length
        ? `&context=${encodeURIComponent(JSON.stringify(plan.context))}`
        : "";
      const res = await fetch(`/api/meals/generate?${contextParam}`);
      const data = await res.json();
      setWeekdayOptions(data.weekday);
      setWeekendOptions(data.weekend);
      setWeekendMeals(data.weekendMeals || []);
      const ids = new Set<string>();
      [...data.weekday, ...data.weekend].forEach((r: RecipeOption) => ids.add(r.id));
      setShownIds(ids);
      if (!plan) {
        setPlan(buildEmptyPlan());
      }
    } catch (err) {
      console.error("Failed to generate options:", err);
    } finally {
      setLoading(false);
    }
  }

  // Show More — appends more options
  async function handleShowMore() {
    setLoadingMore(true);
    try {
      const excludeParam = [...shownIds].join(",");
      const res = await fetch(`/api/meals/generate?exclude=${excludeParam}`);
      const data = await res.json();
      const newWeekday: RecipeOption[] = data.weekday || [];
      const newWeekend: RecipeOption[] = data.weekend || [];
      const newMeals: WeekendMealCombo[] = data.weekendMeals || [];

      setWeekdayOptions((prev) => [...prev, ...newWeekday]);
      setWeekendOptions((prev) => [...prev, ...newWeekend]);
      setWeekendMeals((prev) => [...prev, ...newMeals]);

      setShownIds((prev) => {
        const updated = new Set(prev);
        [...newWeekday, ...newWeekend].forEach((r: RecipeOption) => updated.add(r.id));
        return updated;
      });
    } catch (err) {
      console.error("Failed to load more options:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  // Quick View — fetch full recipe detail
  async function handleQuickView(recipeId: string) {
    setQuickViewLoading(true);
    try {
      const res = await fetch("/api/meals/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: recipeId }),
      });
      const data = await res.json();
      setQuickViewRecipe(data);
    } catch (err) {
      console.error("Failed to load recipe:", err);
    } finally {
      setQuickViewLoading(false);
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

  // ----- context/notes helpers -----

  function handleNotesChange(notes: string) {
    if (!plan || plan.locked) return;
    setPlan({ ...plan, notes });
  }

  function handleAddContext(item: Omit<WeekContextItem, "id">) {
    if (!plan || plan.locked) return;
    const newItem: WeekContextItem = {
      ...item,
      id: `ctx_${Date.now()}`,
      effect: item.effect || KIND_TO_EFFECT[item.kind],
    };
    setPlan({ ...plan, context: [...(plan.context || []), newItem] });
  }

  function handleRemoveContext(id: string) {
    if (!plan || plan.locked) return;
    setPlan({
      ...plan,
      context: (plan.context || []).filter((c) => c.id !== id),
    });
  }

  const allSlotsFilled =
    plan !== null && plan.days.every((d) => d.recipeId !== null);
  const hasOptions = weekdayOptions.length > 0 || weekendOptions.length > 0;
  const contextItems = plan?.context || [];
  const hasContext = contextItems.length > 0 || (plan?.notes && plan.notes.trim().length > 0);

  // Find context items for a specific date
  function getContextForDate(date: string): WeekContextItem[] {
    return contextItems.filter((c) => c.date === date);
  }

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

        {/* Week context summary + toggle */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => {
                if (!plan) setPlan(buildEmptyPlan());
                setShowContextEditor(!showContextEditor);
              }}
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
            >
              <span className="text-base">&#128221;</span>
              {showContextEditor ? "Hide week notes" : "Week notes & context"}
              {hasContext && !showContextEditor && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                  {contextItems.length + (plan?.notes?.trim() ? 1 : 0)}
                </span>
              )}
            </button>
          </div>

          {/* Inline context badges on calendar days */}
          {!showContextEditor && contextItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {contextItems.map((ctx) => (
                <span
                  key={ctx.id}
                  className={`text-xs px-2 py-0.5 rounded-full ${KIND_COLORS[ctx.kind] || KIND_COLORS.custom}`}
                >
                  {ctx.date ? `${formatDateShort(ctx.date)}: ` : ""}{ctx.note}
                </span>
              ))}
            </div>
          )}

          {/* Context editor */}
          {showContextEditor && (
            <WeekContextEditor
              plan={plan || buildEmptyPlan()}
              weekDates={weekDates}
              onNotesChange={handleNotesChange}
              onAddContext={handleAddContext}
              onRemoveContext={handleRemoveContext}
              locked={plan?.locked ?? false}
            />
          )}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {weekDates.map((wd, i) => {
            const slot = plan?.days[i] ?? null;
            const isFilled = slot?.recipeId !== null;
            const isSelectable = selectedRecipe && !plan?.locked;
            const dayContext = getContextForDate(wd.date);
            const isSkipped = dayContext.some(
              (c) => c.effect === "skip-meal"
            );
            return (
              <div
                key={wd.date}
                onClick={() => isSelectable && !isSkipped && handleSlotClick(i)}
                className={`rounded-lg border p-3 min-h-[120px] flex flex-col transition-colors ${
                  isSkipped
                    ? "bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 opacity-60"
                    : plan?.locked
                      ? "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                      : isSelectable
                        ? "cursor-pointer border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900"
                        : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {wd.dayOfWeek.slice(0, 3)}
                </div>
                <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">
                  {formatDateShort(wd.date)}
                </div>
                {/* Context badges for this day */}
                {dayContext.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {dayContext.map((ctx) => (
                      <span
                        key={ctx.id}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${KIND_COLORS[ctx.kind] || KIND_COLORS.custom}`}
                      >
                        {CONTEXT_KIND_OPTIONS.find((o) => o.value === ctx.kind)?.label || ctx.kind}
                      </span>
                    ))}
                  </div>
                )}
                {isSkipped ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">
                      Skipped
                    </span>
                  </div>
                ) : isFilled ? (
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
          {!plan?.locked && !hasOptions && (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {loading ? "Generating..." : "Generate Options"}
            </button>
          )}
          {!plan?.locked && hasOptions && (
            <button
              onClick={handleShowMore}
              disabled={loadingMore}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 dark:hover:border-zinc-500 disabled:opacity-50 transition-colors"
            >
              {loadingMore ? "Loading..." : "Show More"}
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
          <div className="space-y-8">
            {/* Weekday options */}
            {weekdayOptions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 uppercase tracking-wide">
                  Weekday Options
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                      onQuickView={() => handleQuickView(r.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Weekend: Build a Meal */}
            {weekendMeals.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 uppercase tracking-wide">
                  Weekend &mdash; Build a Meal
                </h2>
                <div className="space-y-4">
                  {weekendMeals.map((combo) => (
                    <WeekendMealCard
                      key={combo.main.id}
                      combo={combo}
                      isSelected={selectedRecipe?.id === combo.main.id}
                      isAssigned={
                        plan?.days.some((d) => d.recipeId === combo.main.id) ?? false
                      }
                      onSelectMain={() =>
                        setSelectedRecipe(
                          selectedRecipe?.id === combo.main.id ? null : combo.main
                        )
                      }
                      onQuickView={(id) => handleQuickView(id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Fallback: plain weekend options if no combos */}
            {weekendMeals.length === 0 && weekendOptions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 uppercase tracking-wide">
                  Weekend Options
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                      onQuickView={() => handleQuickView(r.id)}
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

      {/* Quick View Modal */}
      {(quickViewRecipe || quickViewLoading) && (
        <QuickViewModal
          recipe={quickViewRecipe}
          loading={quickViewLoading}
          onClose={() => {
            setQuickViewRecipe(null);
            setQuickViewLoading(false);
          }}
        />
      )}
    </div>
  );
}

// ----- Week Context Editor -----

function WeekContextEditor({
  plan,
  weekDates,
  onNotesChange,
  onAddContext,
  onRemoveContext,
  locked,
}: {
  plan: MealPlan;
  weekDates: { date: string; dayOfWeek: string }[];
  onNotesChange: (notes: string) => void;
  onAddContext: (item: Omit<WeekContextItem, "id">) => void;
  onRemoveContext: (id: string) => void;
  locked: boolean;
}) {
  const [newKind, setNewKind] = useState<WeekContextItem["kind"]>("restaurant");
  const [newDate, setNewDate] = useState("");
  const [newNote, setNewNote] = useState("");

  function handleAdd() {
    if (!newNote.trim()) return;
    onAddContext({
      date: newDate || undefined,
      kind: newKind,
      note: newNote.trim(),
    });
    setNewNote("");
    setNewDate("");
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
      {/* Free-text notes */}
      <div>
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide block mb-1">
          Week Notes
        </label>
        <textarea
          value={plan.notes || ""}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={locked}
          placeholder="General notes for this week..."
          rows={2}
          className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-2 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 disabled:opacity-50 resize-none"
        />
      </div>

      {/* Existing context items */}
      {(plan.context || []).length > 0 && (
        <div>
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide block mb-2">
            Context Items
          </label>
          <div className="space-y-2">
            {(plan.context || []).map((ctx) => (
              <div
                key={ctx.id}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${KIND_COLORS[ctx.kind] || KIND_COLORS.custom}`}
                >
                  {CONTEXT_KIND_OPTIONS.find((o) => o.value === ctx.kind)?.label || ctx.kind}
                </span>
                {ctx.date && (
                  <span className="text-xs text-zinc-400 shrink-0">
                    {formatDateShort(ctx.date)}
                  </span>
                )}
                <span className="text-zinc-700 dark:text-zinc-300 flex-1 min-w-0 truncate">
                  {ctx.note}
                </span>
                {ctx.effect && (
                  <span className="text-[10px] text-zinc-400 shrink-0">
                    {ctx.effect}
                  </span>
                )}
                {!locked && (
                  <button
                    onClick={() => onRemoveContext(ctx.id)}
                    className="shrink-0 text-xs text-zinc-400 hover:text-red-500 transition-colors"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add new context item */}
      {!locked && (
        <div>
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide block mb-2">
            Add Context
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as WeekContextItem["kind"])}
              className="text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {CONTEXT_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="">Any day</option>
              {weekDates.map((wd) => (
                <option key={wd.date} value={wd.date}>
                  {wd.dayOfWeek.slice(0, 3)} {formatDateShort(wd.date)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Note..."
              className="flex-1 min-w-[120px] text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-1.5 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              onClick={handleAdd}
              disabled={!newNote.trim()}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-30 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- RecipeCard sub-component -----

function RecipeCard({
  recipe,
  isSelected,
  isAssigned,
  onSelect,
  onQuickView,
}: {
  recipe: RecipeOption;
  isSelected: boolean;
  isAssigned: boolean;
  onSelect: () => void;
  onQuickView: () => void;
}) {
  const vegTags = recipe.dietary.filter(
    (t) => t === "vegan" || t === "vegetarian"
  );
  const catColors = CATEGORY_COLORS[recipe.category] || CATEGORY_COLORS.Main;

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        isAssigned
          ? "opacity-50 border-zinc-200 dark:border-zinc-700"
          : isSelected
            ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30"
            : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      {/* Image */}
      {recipe.image ? (
        <div className="relative h-36 bg-zinc-100 dark:bg-zinc-800">
          <Image
            src={recipe.image}
            alt={recipe.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        </div>
      ) : (
        <div className="h-20 bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center">
          <span className="text-3xl opacity-30">&#127869;</span>
        </div>
      )}

      <div className="p-3">
        {/* Category badge + cuisine */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${catColors}`}
          >
            {recipe.category}
          </span>
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
        </div>

        {/* Name */}
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1 line-clamp-2">
          {recipe.name}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
          {recipe.source?.cookbook}
        </p>

        {/* Time + actions */}
        <div className="flex items-center justify-between">
          {recipe.time && recipe.time.total > 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {recipe.time.total}min
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickView();
              }}
              className="text-xs px-2 py-1 rounded text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Quick View
            </button>
            <button
              onClick={onSelect}
              disabled={isAssigned}
              className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
                isAssigned
                  ? "text-zinc-400 cursor-not-allowed"
                  : isSelected
                    ? "bg-blue-500 text-white"
                    : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
              }`}
            >
              {isAssigned ? "Assigned" : isSelected ? "Selected" : "Select"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Weekend Meal Card (Build a Meal) -----

function WeekendMealCard({
  combo,
  isSelected,
  isAssigned,
  onSelectMain,
  onQuickView,
}: {
  combo: WeekendMealCombo;
  isSelected: boolean;
  isAssigned: boolean;
  onSelectMain: () => void;
  onQuickView: (id: string) => void;
}) {
  const { main, sides } = combo;
  const vegTags = main.dietary.filter(
    (t) => t === "vegan" || t === "vegetarian"
  );
  const catColors = CATEGORY_COLORS[main.category] || CATEGORY_COLORS.Main;

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        isAssigned
          ? "opacity-50 border-zinc-200 dark:border-zinc-700"
          : isSelected
            ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30"
            : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Main dish */}
        <div className="flex-1 flex">
          {main.image ? (
            <div className="relative w-32 sm:w-40 shrink-0 bg-zinc-100 dark:bg-zinc-800">
              <Image
                src={main.image}
                alt={main.name}
                fill
                className="object-cover"
                sizes="160px"
              />
            </div>
          ) : (
            <div className="w-20 shrink-0 bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center">
              <span className="text-2xl opacity-30">&#127869;</span>
            </div>
          )}
          <div className="p-3 flex-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 mb-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catColors}`}>
                {main.category}
              </span>
              {main.cuisine && main.cuisine !== "Other" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  {main.cuisine}
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
            </div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2">
              {main.name}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {main.source?.cookbook}
            </p>
            <div className="flex items-center gap-2 mt-2">
              {main.time && main.time.total > 0 && (
                <span className="text-xs text-zinc-400">{main.time.total}min</span>
              )}
              <button
                onClick={() => onQuickView(main.id)}
                className="text-xs px-2 py-1 rounded text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Quick View
              </button>
              <button
                onClick={onSelectMain}
                disabled={isAssigned}
                className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
                  isAssigned
                    ? "text-zinc-400 cursor-not-allowed"
                    : isSelected
                      ? "bg-blue-500 text-white"
                      : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                }`}
              >
                {isAssigned ? "Assigned" : isSelected ? "Selected" : "Select"}
              </button>
            </div>
          </div>
        </div>

        {/* Suggested sides */}
        {sides.length > 0 && (
          <div className="sm:w-56 border-t sm:border-t-0 sm:border-l border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
              Suggested sides
            </p>
            <ul className="space-y-1.5">
              {sides.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-1">
                  <span className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-1">
                    {s.name}
                  </span>
                  <button
                    onClick={() => onQuickView(s.id)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0"
                  >
                    view
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Quick View Modal -----

function QuickViewModal({
  recipe,
  loading,
  onClose,
}: {
  recipe: RecipeDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center">
            <p className="text-sm text-zinc-500">Loading recipe...</p>
          </div>
        ) : recipe ? (
          <>
            {/* Header with image */}
            {recipe.image && (
              <div className="relative h-48 sm:h-56">
                <Image
                  src={recipe.image}
                  alt={recipe.name}
                  fill
                  className="object-cover rounded-t-xl"
                  sizes="(max-width: 672px) 100vw, 672px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <button
                  onClick={onClose}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                >
                  &times;
                </button>
                <div className="absolute bottom-3 left-4 right-4">
                  <h2 className="text-lg font-semibold text-white drop-shadow-sm">
                    {recipe.name}
                  </h2>
                  <p className="text-sm text-white/80">
                    {recipe.source?.cookbook}
                  </p>
                </div>
              </div>
            )}
            {!recipe.image && (
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {recipe.name}
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {recipe.source?.cookbook}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none"
                >
                  &times;
                </button>
              </div>
            )}

            <div className="p-4 space-y-4">
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    CATEGORY_COLORS[recipe.category] || CATEGORY_COLORS.Main
                  }`}
                >
                  {recipe.category}
                </span>
                {recipe.cuisine && recipe.cuisine !== "Other" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    {recipe.cuisine}
                  </span>
                )}
                {recipe.time && recipe.time.total > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    {recipe.time.total}min
                  </span>
                )}
                {recipe.servings && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    {recipe.servings}
                  </span>
                )}
              </div>

              {/* Introduction */}
              {recipe.introduction && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400 italic">
                  {recipe.introduction}
                </p>
              )}

              {/* Ingredients */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                  Ingredients
                </h3>
                <ul className="space-y-1">
                  {recipe.ingredients.map((ing, idx) => (
                    <li
                      key={idx}
                      className="text-sm text-zinc-600 dark:text-zinc-400 flex gap-2"
                    >
                      <span className="text-zinc-400 dark:text-zinc-500 shrink-0 w-16 text-right">
                        {ing.amount}
                      </span>
                      <span>
                        {ing.unit ? `${ing.unit} ` : ""}
                        {ing.item}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Method (preview — first 4 steps) */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                  Method
                </h3>
                <ol className="space-y-2">
                  {recipe.method.slice(0, 4).map((step, idx) => (
                    <li
                      key={idx}
                      className="text-sm text-zinc-600 dark:text-zinc-400 flex gap-2"
                    >
                      <span className="text-zinc-400 dark:text-zinc-500 shrink-0 font-medium">
                        {idx + 1}.
                      </span>
                      <span className="line-clamp-3">{step}</span>
                    </li>
                  ))}
                </ol>
                {recipe.method.length > 4 && (
                  <p className="text-xs text-zinc-400 mt-2">
                    +{recipe.method.length - 4} more steps...
                  </p>
                )}
              </div>

              {/* Tips */}
              {recipe.tips && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                  <span className="font-medium">Tip:</span> {recipe.tips}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
