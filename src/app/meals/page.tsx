"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { NabuBadge, NabuButton, NabuEmptyState, NabuHeader, NabuMain, NabuPageShell, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { getCourseTagColor } from "@/lib/tag-colors";
import { normalizeIngredient } from "@/lib/normalize-ingredients";

// ----- types -----

type RecipeOption = {
  id: string;
  name: string;
  source?: { cookbook: string; author: string; chapter?: string; publication?: string };
  image?: string | null;
  dietary: string[];
  cuisine: string;
  time: { prep: number; cook: number; total: number } | null;
  category: string;
  courseTags: string[];
  rationale?: string;
  recommended?: boolean;
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

type CandidateItem = {
  recipeId: string;
  recipeName: string;
  source?: { cookbook: string; author: string; chapter?: string; publication?: string } | null;
  image?: string | null;
  dietary: string[];
  cuisine: string;
  time: { prep: number; cook: number; total: number } | null;
  category: string;
  courseTags?: string[];
  bucket: string;
};

type CandidateDiagnostics = {
  poolSize: number;
  validatedSize: number;
  autoCorrected: { recipeId: string; recipeName: string; fixes: string[] }[];
  excluded: { recipeId: string; recipeName: string; reasons: string[] }[];
  bucketFill: Record<string, { target: number; filled: number }>;
  repairPasses: number;
  warnings: string[];
};

type CandidateSet = {
  generatedAt: string;
  policyVersion: string;
  bucketContract?: readonly number[];
  items: CandidateItem[];
  diagnostics?: CandidateDiagnostics;
};

type MealSlot = {
  main: { id: string; name: string };
  sides?: { id: string; name: string }[];
  serveWith?: string[];
};

type DaySlot = {
  date: string;
  dayOfWeek: string;
  type?: "weekday" | "weekend";
  planningState?: "open" | "assigned" | "meal" | "skipped";
  recipeId: string | null;
  recipeName: string | null;
  meal?: MealSlot | null;
};

type MealPlan = {
  week: string;
  status?: "draft" | "finalized";
  plannerVersion?: string;
  candidateSet?: CandidateSet | null;
  days: DaySlot[];
  context?: WeekContextItem[];
  notes?: string;
  locked: boolean;
  createdAt: string;
  updatedAt?: string;
};

type DayHistoryStatus =
  | "planned"
  | "cooked-as-planned"
  | "cooked-other"
  | "skipped"
  | null;

type DayHistory = {
  date: string;
  status: DayHistoryStatus;
  plannedRecipeId: string | null;
  plannedRecipeName: string | null;
  cookedRecipeId: string | null;
  cookedRecipeName: string | null;
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
    { offset: 4, day: "Friday" },
    { offset: 5, day: "Saturday" },
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

function parseWeekId(weekId: string): { year: number; week: number } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (week < 1 || week > 53) return null;
  return { year, week };
}

function offsetWeek(
  year: number,
  week: number,
  delta: number,
): { year: number; week: number } {
  const monday = getWeekMonday(year, week);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return getISOWeek(monday);
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

// Category colors now come from the shared tag-colors module.

// ----- time display helper -----

/** Round minutes to nearest 5, with a 10-min floor, for clean planner display. */
function formatPlannerTime(totalMin: number | undefined | null): string | null {
  if (!totalMin || totalMin <= 0) return null;
  const rounded = Math.round(totalMin / 5) * 5;
  const clamped = Math.max(10, rounded);
  if (clamped >= 90) {
    const hrs = clamped / 60;
    return hrs === Math.floor(hrs) ? `${hrs} hr` : `${hrs.toFixed(1)} hrs`;
  }
  return `${clamped} min`;
}


// ----- plan normalization -----

/**
 * Normalize a persisted plan so that `days` always contains exactly 7
 * well-formed DaySlot entries aligned to the canonical weekDates.
 * Tolerates null / undefined / partial entries in the persisted data.
 */
function normalizePlanDays(
  plan: MealPlan,
  weekDates: { date: string; dayOfWeek: string }[],
): MealPlan {
  const WEEKEND_DAYS = new Set(["Friday", "Saturday", "Sunday"]);
  const persisted = plan.days ?? [];

  // Build a lookup by date for persisted slots so we can match by date first.
  const byDate = new Map<string, DaySlot>();
  for (const slot of persisted) {
    if (slot && typeof slot === "object" && slot.date) {
      byDate.set(slot.date, slot);
    }
  }

  const days: DaySlot[] = weekDates.map((wd, i) => {
    // Prefer date-match, fall back to positional index.
    const saved = byDate.get(wd.date) ?? (persisted[i] && typeof persisted[i] === "object" ? persisted[i] : null);

    return {
      date: wd.date,
      dayOfWeek: wd.dayOfWeek,
      type: (WEEKEND_DAYS.has(wd.dayOfWeek) ? "weekend" : "weekday") as "weekday" | "weekend",
      planningState: saved?.planningState ?? "open",
      recipeId: saved?.recipeId ?? null,
      recipeName: saved?.recipeName ?? null,
      // Backfill meal from legacy recipeId/recipeName if absent
      meal: saved?.meal ?? (saved?.recipeId && saved?.recipeName
        ? { main: { id: saved.recipeId, name: saved.recipeName } }
        : null),
    };
  });

  return { ...plan, days };
}

// ----- persistence helpers -----

/** Immediately persist a plan to the server. */
async function savePlanNow(plan: MealPlan): Promise<void> {
  const res = await fetch("/api/meals/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!res.ok) {
    throw new Error(`Failed to save meal plan: ${res.status}`);
  }
}

/** Debounced autosave for non-critical changes (notes, context). */
function useAutosave(plan: MealPlan | null, delayMs = 1500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  const save = useCallback((p: MealPlan) => {
    const serialized = JSON.stringify(p);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;
    savePlanNow(p).catch((err) => console.error("Autosave failed:", err));
  }, []);

  useEffect(() => {
    if (!plan) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(plan), delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [plan, delayMs, save]);

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
  return (
    <Suspense>
      <MealsPageInner />
    </Suspense>
  );
}

function MealsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const now = new Date();
  const currentWeek = getISOWeek(now);
  const currentWeekId = formatWeekId(currentWeek.year, currentWeek.week);

  // Derive active week from URL ?week= param, falling back to current week
  const weekParam = searchParams.get("week");
  const parsedParam = weekParam ? parseWeekId(weekParam) : null;
  const activeWeek = parsedParam ?? currentWeek;
  const weekId = formatWeekId(activeWeek.year, activeWeek.week);
  const weekDates = getWeekDates(activeWeek.year, activeWeek.week);
  const isCurrentWeek = weekId === currentWeekId;
  const isPastWeek = !isCurrentWeek && weekDates[6].date < now.toISOString().split("T")[0];

  function getWeekHref(year: number, week: number): string {
    const id = formatWeekId(year, week);
    const cid = formatWeekId(currentWeek.year, currentWeek.week);
    return id === cid ? "/meals" : `/meals?week=${id}`;
  }

  function navigateToWeek(year: number, week: number) {
    router.push(getWeekHref(year, week));
  }

  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [candidates, setCandidates] = useState<RecipeOption[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [webInspirationLoading, setWebInspirationLoading] = useState(false);
  const [quickViewRecipe, setQuickViewRecipe] = useState<RecipeDetail | null>(null);
  const [quickViewLoading, setQuickViewLoading] = useState(false);
  const [showContextEditor, setShowContextEditor] = useState(false);
  const [planLoading, setPlanLoading] = useState(true);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "up" | "down">>({});
  const [dayHistory, setDayHistory] = useState<Record<string, DayHistory>>({});
  const [editingServeWith, setEditingServeWith] = useState<number | null>(null);
  const [cookedSlots, setCookedSlots] = useState<Set<string>>(new Set());
  const [markingCooked, setMarkingCooked] = useState<number | null>(null);
  const [expandingDay, setExpandingDay] = useState<number | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandComplements, setExpandComplements] = useState<{
    starters: RecipeOption[];
    sides: RecipeOption[];
    desserts: RecipeOption[];
  } | null>(null);

  // Autosave for notes/context changes only
  useAutosave(plan);

  // Load recipe feedback on mount
  useEffect(() => {
    fetch("/api/meals/feedback")
      .then((r) => r.json())
      .then((data: Record<string, "up" | "down">) => setFeedbackMap(data))
      .catch(() => {});
  }, []);

  const buildEmptyPlan = useCallback((): MealPlan => {
    const WEEKEND_DAYS = new Set(["Friday", "Saturday", "Sunday"]);
    return {
      week: weekId,
      status: "draft",
      plannerVersion: "vNext-1",
      candidateSet: null,
      days: weekDates.map((wd) => ({
        date: wd.date,
        dayOfWeek: wd.dayOfWeek,
        type: (WEEKEND_DAYS.has(wd.dayOfWeek) ? "weekend" : "weekday") as "weekday" | "weekend",
        planningState: "open" as const,
        recipeId: null,
        recipeName: null,
        meal: null,
      })),
      context: [],
      notes: "",
      locked: false,
      createdAt: new Date().toISOString(),
    };
  }, [weekId, weekDates]);

  // Load existing plan when week changes
  useEffect(() => {
    // Clear stale plan immediately to prevent autosave from writing
    // old/empty data over a saved plan while the fetch is in flight.
    setPlan(null);
    setPlanLoading(true);
    setCandidates([]);
    setSelectedRecipe(null);
    setShowContextEditor(false);
    setExpandingDay(null);
    setExpandComplements(null);

    let cancelled = false;
    fetch(`/api/meals/plan?week=${weekId}`)
      .then((r) => r.json())
      .then((data: MealPlan | null) => {
        if (cancelled) return;
        if (data && data.week) {
          const normalized = normalizePlanDays(data, getWeekDates(
            parseInt(data.week.split("-W")[0]),
            parseInt(data.week.split("-W")[1]),
          ));
          // Self-heal: persist repaired plan if days were malformed.
          const daysChanged = JSON.stringify(normalized.days) !== JSON.stringify(data.days);
          if (daysChanged) savePlanNow(normalized).catch(() => {});
          setPlan(normalized);
          // Restore saved candidates with full card data for stable reload,
          // then reconcile images against current canonical recipe data to
          // prevent stale persisted images from resurfacing.
          if (data.candidateSet?.items?.length) {
            const restored = data.candidateSet.items.map((c: CandidateItem) => ({
              id: c.recipeId,
              name: c.recipeName,
              source: c.source ?? undefined,
              image: c.image ?? null,
              dietary: c.dietary ?? [],
              cuisine: c.cuisine ?? "",
              time: c.time ?? null,
              category: c.category ?? "",
              courseTags: c.courseTags ?? [],
            }));
            setCandidates(restored);

            // Reconcile: fetch current canonical images and patch any stale ones
            const ids = restored.map((r: RecipeOption) => r.id).join(",");
            fetch(`/api/meals/lookup?ids=${encodeURIComponent(ids)}`)
              .then((lr) => lr.json())
              .then((lookup: Record<string, { image: string | null }>) => {
                if (cancelled) return;
                setCandidates((prev) =>
                  prev.map((r) => {
                    const canonical = lookup[r.id];
                    if (canonical && r.image !== canonical.image) {
                      return { ...r, image: canonical.image };
                    }
                    return r;
                  })
                );
              })
              .catch(() => { /* non-critical — stale image is cosmetic */ });
          }

          // Reconcile stored web inspirations that may not be in candidateSet
          fetch(`/api/meals/inspirations?week=${encodeURIComponent(weekId)}`)
            .then((r) => (r.ok ? r.json() : { candidates: [] }))
            .then((inspData: { candidates?: RecipeOption[] }) => {
              if (cancelled) return;
              const webCandidates = inspData.candidates ?? [];
              if (webCandidates.length === 0) return;

              const existingItems = normalized.candidateSet?.items ?? [];
              const existingIds = new Set(existingItems.map((c: CandidateItem) => c.recipeId));

              // Merge into visible candidates (dedup by id)
              setCandidates((prev) => {
                const prevIds = new Set(prev.map((r) => r.id));
                const novel = webCandidates.filter((r) => !prevIds.has(r.id));
                return novel.length > 0 ? [...prev, ...novel] : prev;
              });

              // Persist missing web inspirations into the candidateSet
              const missingItems: CandidateItem[] = webCandidates
                .filter((r) => !existingIds.has(r.id))
                .map((r) => ({
                  recipeId: r.id,
                  recipeName: r.name,
                  source: r.source ?? null,
                  image: r.image ?? null,
                  dietary: r.dietary,
                  cuisine: r.cuisine,
                  time: r.time,
                  category: r.category,
                  courseTags: r.courseTags,
                  bucket: "web-inspiration",
                }));

              if (missingItems.length > 0) {
                const repairedSet: CandidateSet = {
                  generatedAt: normalized.candidateSet?.generatedAt ?? new Date().toISOString(),
                  policyVersion: normalized.candidateSet?.policyVersion?.includes("+web")
                    ? normalized.candidateSet.policyVersion
                    : `${normalized.candidateSet?.policyVersion ?? "planner-v2.1"}+web`,
                  bucketContract: normalized.candidateSet?.bucketContract,
                  diagnostics: normalized.candidateSet?.diagnostics,
                  items: [...existingItems, ...missingItems],
                };
                const repairedPlan = { ...normalized, candidateSet: repairedSet };
                setPlan(repairedPlan);
                savePlanNow(repairedPlan).catch(() => {});
              }
            })
            .catch(() => { /* non-critical — web inspirations are supplementary */ });
        } else {
          setPlan(null);
        }
        // Load persisted feedback for this week
        fetch(`/api/meals/feedback?week=${weekId}`)
          .then((r) => r.json())
          .then((fbData: { feedback: { recipeId: string; feedback: "up" | "down" }[] }) => {
            if (cancelled) return;
            const map: Record<string, "up" | "down"> = {};
            for (const fb of fbData.feedback) map[fb.recipeId] = fb.feedback;
            setFeedbackMap(map);
          })
          .catch(() => { /* non-critical */ });
        // Load history projection for this week
        fetch(`/api/meals/history?week=${weekId}`)
          .then((r) => r.json())
          .then((histData: { days: DayHistory[] }) => {
            if (cancelled) return;
            const map: Record<string, DayHistory> = {};
            for (const d of histData.days) map[d.date] = d;
            setDayHistory(map);
          })
          .catch(() => { /* non-critical */ });
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });
    return () => { cancelled = true; };
  }, [weekId]);

  // Fetch cook events to determine cooked state for assigned days
  useEffect(() => {
    if (!plan) { setCookedSlots(new Set()); return; }
    const assignedIds = plan.days
      .filter((d) => d.recipeId)
      .map((d) => d.recipeId!);
    if (assignedIds.length === 0) { setCookedSlots(new Set()); return; }

    let cancelled = false;
    fetch("/api/cook-events")
      .then((r) => r.json())
      .then((events: { recipeId: string; cookedOn: string }[]) => {
        if (cancelled) return;
        const slotKeys = new Set<string>();
        for (const ev of events) {
          slotKeys.add(`${ev.recipeId}:${ev.cookedOn}`);
        }
        setCookedSlots(slotKeys);
      })
      .catch(() => { if (!cancelled) setCookedSlots(new Set()); });
    return () => { cancelled = true; };
  }, [plan?.week, plan?.days]);

  // Generate ~12 candidate mains for the week
  async function handleGenerate() {
    setLoading(true);
    setGenerateError(null);
    try {
      const params = new URLSearchParams();
      if (plan?.context?.length) {
        params.set("context", JSON.stringify(plan.context));
      }
      if (candidates.length > 0) {
        params.set("exclude", candidates.map((c) => c.id).join(","));
      }
      const res = await fetch(`/api/meals/generate?${params}`);
      if (!res.ok) {
        throw new Error(`Generation failed (${res.status})`);
      }
      const data = await res.json();
      const newCandidates: RecipeOption[] = data.candidates || [];
      if (newCandidates.length === 0) {
        throw new Error("No candidates returned");
      }
      setCandidates(newCandidates);

      // Persist the full candidateSet from the API (includes diagnostics)
      const candidateSet: CandidateSet = data.candidateSet ?? {
        generatedAt: new Date().toISOString(),
        policyVersion: "planner-v2.1",
        items: newCandidates.map((r) => ({
          recipeId: r.id,
          recipeName: r.name,
          source: r.source ?? null,
          image: r.image ?? null,
          dietary: r.dietary,
          cuisine: r.cuisine,
          time: r.time,
          category: r.category,
          courseTags: r.courseTags,
          bucket: "meat",
        })),
      };
      const updatedPlan = plan
        ? { ...plan, candidateSet }
        : { ...buildEmptyPlan(), candidateSet };
      setPlan(updatedPlan);
      await savePlanNow(updatedPlan);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate options";
      console.error("Failed to generate options:", err);
      setGenerateError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Add 3-4 trusted web inspirations to the current week's candidate set
  async function handleAddWebInspirations() {
    setWebInspirationLoading(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/meals/inspirations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: weekId, count: 4 }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Web inspiration import failed (${res.status})`);
      }
      const data = await res.json();
      const webCandidates: RecipeOption[] = data.candidates || [];
      if (webCandidates.length === 0) {
        throw new Error("No new web inspirations found");
      }

      const mergedCandidates = [
        ...candidates,
        ...webCandidates.filter((r) => !candidates.some((existing) => existing.id === r.id)),
      ];
      setCandidates(mergedCandidates);

      const basePlan = plan ?? buildEmptyPlan();
      const existingItems = basePlan.candidateSet?.items ?? [];
      const webItems: CandidateItem[] = webCandidates
        .filter((r) => !existingItems.some((item) => item.recipeId === r.id))
        .map((r) => ({
          recipeId: r.id,
          recipeName: r.name,
          source: r.source ?? null,
          image: r.image ?? null,
          dietary: r.dietary,
          cuisine: r.cuisine,
          time: r.time,
          category: r.category,
          courseTags: r.courseTags,
          bucket: "web-inspiration",
        }));

      const candidateSet: CandidateSet = {
        generatedAt: basePlan.candidateSet?.generatedAt ?? new Date().toISOString(),
        policyVersion: basePlan.candidateSet?.policyVersion
          ? `${basePlan.candidateSet.policyVersion}+web`
          : "planner-v2.1+web",
        bucketContract: basePlan.candidateSet?.bucketContract,
        diagnostics: basePlan.candidateSet?.diagnostics,
        items: [...existingItems, ...webItems],
      };
      const updatedPlan = { ...basePlan, candidateSet };
      setPlan(updatedPlan);
      await savePlanNow(updatedPlan);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add web inspirations";
      console.error("Failed to add web inspirations:", err);
      setGenerateError(msg);
    } finally {
      setWebInspirationLoading(false);
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

  // Assign recipe to a day slot — persists immediately
  function handleSlotClick(dayIndex: number) {
    if (!plan || planLoading) return;
    // No candidate selected — navigate to recipe page if assigned
    if (!selectedRecipe) {
      const slot = plan.days[dayIndex];
      if (slot?.recipeId) router.push(`/recipes/${slot.recipeId}`);
      return;
    }
    const newDays = [...plan.days];
    const existingMeal = newDays[dayIndex].meal;
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      recipeId: selectedRecipe.id,
      recipeName: selectedRecipe.name,
      planningState: "assigned",
      meal: {
        main: { id: selectedRecipe.id, name: selectedRecipe.name },
        sides: existingMeal?.sides,
        serveWith: existingMeal?.serveWith,
      },
    };
    const updatedPlan = { ...plan, days: newDays };
    setPlan(updatedPlan);
    savePlanNow(updatedPlan).catch((err) => console.error("Save failed:", err));
    setSelectedRecipe(null);
  }

  // Clear a day slot — persists immediately
  function handleClearSlot(dayIndex: number) {
    if (!plan) return;
    // Close expand panel if clearing the expanded day
    if (expandingDay === dayIndex) {
      setExpandingDay(null);
      setExpandComplements(null);
    }
    const newDays = [...plan.days];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      recipeId: null,
      recipeName: null,
      planningState: "open",
      meal: null,
    };
    const updatedPlan = { ...plan, days: newDays };
    setPlan(updatedPlan);
    savePlanNow(updatedPlan).catch((err) => console.error("Save failed:", err));
  }

  // Mark a past slot as cooked via cook-events API
  async function handleMarkCooked(dayIndex: number) {
    if (!plan) return;
    const slot = plan.days[dayIndex];
    if (!slot?.recipeId) return;
    setMarkingCooked(dayIndex);
    try {
      await fetch("/api/cook-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeId: slot.recipeId,
          cookedOn: slot.date,
          source: "meal-planner",
        }),
      });
      setCookedSlots((prev) => new Set(prev).add(`${slot.recipeId}:${slot.date}`));
    } catch (err) {
      console.error("Failed to mark cooked:", err);
    } finally {
      setMarkingCooked(null);
    }
  }

  // Update serveWith on an assigned day slot — persists immediately
  function handleServeWithChange(dayIndex: number, serveWith: string[]) {
    if (!plan) return;
    const slot = plan.days[dayIndex];
    if (!slot?.meal) return;
    const newDays = [...plan.days];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      meal: { ...slot.meal, serveWith: serveWith.length > 0 ? serveWith : undefined },
    };
    const updatedPlan = { ...plan, days: newDays };
    setPlan(updatedPlan);
    savePlanNow(updatedPlan).catch((err) => console.error("Save failed:", err));
  }

  // Toggle feedback for a candidate recipe
  async function handleFeedback(recipeId: string, value: "up" | "down") {
    const current = feedbackMap[recipeId];
    const next = current === value ? null : value;
    // Optimistic update
    setFeedbackMap((prev) => {
      const updated = { ...prev };
      if (next === null) delete updated[recipeId];
      else updated[recipeId] = next;
      return updated;
    });
    try {
      await fetch("/api/meals/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, feedback: next }),
      });
    } catch (err) {
      console.error("Failed to save feedback:", err);
      // Revert on failure
      setFeedbackMap((prev) => {
        const reverted = { ...prev };
        if (current) reverted[recipeId] = current;
        else delete reverted[recipeId];
        return reverted;
      });
    }
  }

  // ----- day expansion (Turn into meal) -----

  async function handleExpandDay(dayIndex: number) {
    if (!plan) return;
    const slot = plan.days[dayIndex];
    if (!slot?.recipeId) return;

    // Toggle off if already expanding this day
    if (expandingDay === dayIndex) {
      setExpandingDay(null);
      setExpandComplements(null);
      return;
    }

    setExpandingDay(dayIndex);
    setExpandLoading(true);
    setExpandComplements(null);
    try {
      const dayType = slot.type || "weekday";
      const res = await fetch(
        `/api/meals/expand?mainId=${encodeURIComponent(slot.recipeId)}&dayType=${dayType}`
      );
      const data = await res.json();
      setExpandComplements({
        starters: data.starters || [],
        sides: data.sides || [],
        desserts: data.desserts || [],
      });
    } catch (err) {
      console.error("Failed to load complements:", err);
      setExpandComplements({ starters: [], sides: [], desserts: [] });
    } finally {
      setExpandLoading(false);
    }
  }

  function handleAcceptComplement(dayIndex: number, complement: RecipeOption) {
    if (!plan) return;
    const slot = plan.days[dayIndex];
    if (!slot?.meal) return;

    const existingSides = slot.meal.sides || [];
    // Don't add duplicates
    if (existingSides.some((s) => s.id === complement.id)) return;

    const newSides = [...existingSides, { id: complement.id, name: complement.name }];
    const newDays = [...plan.days];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      planningState: "meal",
      meal: { ...slot.meal, sides: newSides },
    };
    const updatedPlan = { ...plan, days: newDays };
    setPlan(updatedPlan);
    savePlanNow(updatedPlan).catch((err) => console.error("Save failed:", err));
  }

  function handleRemoveComplement(dayIndex: number, complementId: string) {
    if (!plan) return;
    const slot = plan.days[dayIndex];
    if (!slot?.meal?.sides) return;

    const newSides = slot.meal.sides.filter((s) => s.id !== complementId);
    const newDays = [...plan.days];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      planningState: newSides.length > 0 ? "meal" : "assigned",
      meal: {
        ...slot.meal,
        sides: newSides.length > 0 ? newSides : undefined,
      },
    };
    const updatedPlan = { ...plan, days: newDays };
    setPlan(updatedPlan);
    savePlanNow(updatedPlan).catch((err) => console.error("Save failed:", err));
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

  const hasCandidates = candidates.length > 0;
  const contextItems = plan?.context || [];
  const hasContext = contextItems.length > 0 || (plan?.notes && plan.notes.trim().length > 0);
  const prevWeek = offsetWeek(activeWeek.year, activeWeek.week, -1);
  const nextWeek = offsetWeek(activeWeek.year, activeWeek.week, 1);
  const prevWeekHref = getWeekHref(prevWeek.year, prevWeek.week);
  const nextWeekHref = getWeekHref(nextWeek.year, nextWeek.week);

  // Find context items for a specific date
  function getContextForDate(date: string): WeekContextItem[] {
    return contextItems.filter((c) => c.date === date);
  }

  return (
    <NabuPageShell>
      <NabuHeader
        title="Meal Planner"
        eyebrow="Food workflow"
        subtitle={`${weekDates[0].dayOfWeek.slice(0, 3)} ${formatDateShort(weekDates[0].date)} – ${weekDates[6].dayOfWeek.slice(0, 3)} ${formatDateShort(weekDates[6].date)}`}
        backHref="/"
      />

      <NabuMain>
        {/* Week navigation */}
        <NabuSurface className="mb-8 p-3 sm:p-4">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <Link
              href={prevWeekHref}
              className="rounded-full p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label="Previous week"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0 text-center sm:min-w-40">
              <span className="block truncate text-sm font-medium text-stone-700 dark:text-stone-200">
                {weekDates[0].dayOfWeek.slice(0, 3)} {formatDateShort(weekDates[0].date)}
                {" \u2013 "}
                {weekDates[6].dayOfWeek.slice(0, 3)} {formatDateShort(weekDates[6].date)}
              </span>
              <span className="block truncate text-[11px] text-stone-400 dark:text-stone-500">
                {weekId}
                {isCurrentWeek && " \u00b7 This week"}
                {isPastWeek && " \u00b7 Past"}
              </span>
            </div>
            <Link
              href={nextWeekHref}
              className="rounded-full p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label="Next week"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            {!isCurrentWeek && (
              <button
                onClick={() => navigateToWeek(currentWeek.year, currentWeek.week)}
                className="col-span-3 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700 sm:col-span-1 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-200"
              >
                This week
              </button>
            )}
          </div>
        </NabuSurface>

        {/* Week context summary + toggle */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => {
                if (planLoading) return;
                if (!plan) setPlan(buildEmptyPlan());
                setShowContextEditor(!showContextEditor);
              }}
              disabled={planLoading}
              className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {showContextEditor ? "Hide notes" : "Week notes"}
              {hasContext && !showContextEditor && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300">
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

        {/* Calendar grid — 7-day week */}
        {planLoading ? (
          <div className="grid grid-cols-1 gap-3 mb-10 min-[380px]:grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            {weekDates.map((wd) => (
              <div
                key={wd.date}
                className="rounded-2xl bg-white dark:bg-stone-900 p-3.5 min-h-[120px] flex flex-col animate-pulse shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
              >
                <div className="h-3 w-8 rounded bg-stone-200 dark:bg-stone-700 mb-1" />
                <div className="h-2 w-10 rounded bg-stone-100 dark:bg-stone-800 mb-3" />
                <div className="flex-1 flex items-center justify-center">
                  <div className="h-3 w-16 rounded bg-stone-100 dark:bg-stone-800" />
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-3 mb-10 min-[380px]:grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          {weekDates.map((wd, i) => {
            const slot = plan?.days[i] ?? null;
            const isFilled = slot != null && slot.recipeId != null;
            const isSelectable = !!selectedRecipe;
            const dayContext = getContextForDate(wd.date);
            const isSkipped = dayContext.some(
              (c) => c.effect === "skip-meal"
            );
            const isWeekend = ["Friday", "Saturday", "Sunday"].includes(wd.dayOfWeek);
            const today = new Date().toISOString().split("T")[0];
            const isPast = wd.date < today;
            const hist = dayHistory[wd.date] ?? null;
            const isCooked = isFilled && cookedSlots.has(`${slot!.recipeId}:${wd.date}`);
            const isClickable = isSelectable ? !isSkipped : (isFilled && !isSkipped);
            return (
              <div
                key={wd.date}
                onClick={() => isClickable && handleSlotClick(i)}
                className={`rounded-xl border p-3 min-h-[110px] flex flex-col transition-all ${
                  isSkipped
                    ? "bg-stone-100/80 dark:bg-stone-900/60 opacity-50"
                    : isSelectable
                      ? "cursor-pointer border-amber-400 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-950/30 hover:bg-amber-50 dark:hover:bg-amber-900/30 shadow-sm"
                      : isCooked
                        ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50 shadow-sm cursor-pointer"
                        : isFilled
                          ? "bg-white dark:bg-stone-900 border-stone-300 dark:border-stone-700 shadow-sm cursor-pointer"
                          : "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800"
                }`}
              >
                <div className={`text-[11px] font-medium ${isWeekend ? "text-stone-600 dark:text-stone-300" : "text-stone-400 dark:text-stone-500"}`}>
                  {wd.dayOfWeek.slice(0, 3)}
                </div>
                <div className="text-[10px] text-stone-300 dark:text-stone-600 mb-1.5">
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
                {/* History status badge */}
                {hist?.status && (
                  <div className="mb-1">
                    {hist.status === "cooked-as-planned" && (
                      <NabuBadge tone="green" className="px-1.5 py-0.5 text-[9px]">Cooked</NabuBadge>
                    )}
                    {hist.status === "cooked-other" && (
                      <NabuBadge tone="blue" className="px-1.5 py-0.5 text-[9px]" title={hist.cookedRecipeName ? `Cooked: ${hist.cookedRecipeName}` : undefined}>Swapped</NabuBadge>
                    )}
                    {hist.status === "skipped" && !isSkipped && (
                      <NabuBadge className="px-1.5 py-0.5 text-[9px]">Skipped</NabuBadge>
                    )}
                    {hist.status === "planned" && (
                      <NabuBadge tone="amber" className="px-1.5 py-0.5 text-[9px]">Planned</NabuBadge>
                    )}
                  </div>
                )}
                {isSkipped ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-[11px] text-stone-300 dark:text-stone-600 italic">
                      Skipped
                    </span>
                  </div>
                ) : isFilled ? (
                  <div className="flex-1 flex flex-col justify-between">
                    <p className="text-[13px] font-serif text-stone-700 dark:text-stone-200 line-clamp-2 leading-snug">
                      {slot?.recipeName}
                    </p>
                    {isCooked && (
                      <span className="mt-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        Cooked
                      </span>
                    )}
                    {/* Accepted sides */}
                    {slot?.meal?.sides && slot.meal.sides.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {slot.meal.sides.map((side) => (
                          <div key={side.id} className="flex items-center gap-1">
                            <span className="text-[10px] text-violet-600 dark:text-violet-400 leading-tight line-clamp-1">
                              + {side.name}
                            </span>
                            {!isCooked && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveComplement(i, side.id);
                                }}
                                className="text-[10px] text-stone-300 dark:text-stone-600 hover:text-red-400 transition-colors shrink-0"
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Serve-with notes */}
                    {!isCooked && slot?.meal?.serveWith && slot.meal.serveWith.length > 0 && editingServeWith !== i && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingServeWith(i); }}
                        className="mt-1 text-[10px] text-stone-400 dark:text-stone-500 text-left leading-tight hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                      >
                        + {slot.meal.serveWith.join(", ")}
                      </button>
                    )}
                    {!isCooked && !slot?.meal?.serveWith?.length && editingServeWith !== i && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingServeWith(i); }}
                        className="mt-1 text-[10px] text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors text-left"
                      >
                        + serve with...
                      </button>
                    )}
                    {editingServeWith === i && (
                      <ServeWithEditor
                        value={slot?.meal?.serveWith ?? []}
                        onChange={(sw) => handleServeWithChange(i, sw)}
                        onClose={() => setEditingServeWith(null)}
                      />
                    )}
                    {!isCooked && (
                      <div className="mt-1 flex items-center justify-end gap-2 flex-wrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExpandDay(i);
                          }}
                          className={`text-[10px] transition-colors ${
                            expandingDay === i
                              ? "text-violet-600 dark:text-violet-400 font-medium"
                              : "text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
                          }`}
                        >
                          {expandingDay === i ? "close" : slot?.planningState === "meal" ? "edit meal" : "turn into meal"}
                        </button>
                        {isPast && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkCooked(i);
                            }}
                            disabled={markingCooked === i}
                            className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors disabled:opacity-50"
                          >
                            {markingCooked === i ? "saving..." : "mark cooked"}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearSlot(i);
                          }}
                          className="text-[10px] text-stone-400 hover:text-red-500 transition-colors"
                        >
                          clear
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-[11px] text-stone-300 dark:text-stone-600">
                      {isSelectable ? "Tap to assign" : "\u2014"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}

        {/* Complement picker — Turn into meal */}
        {expandingDay !== null && plan?.days[expandingDay]?.recipeId && (
          <ComplementPicker
            dayIndex={expandingDay}
            slot={plan.days[expandingDay]}
            complements={expandComplements}
            loading={expandLoading}
            acceptedSides={plan.days[expandingDay].meal?.sides || []}
            onAccept={(complement) => handleAcceptComplement(expandingDay, complement)}
            onRemove={(complementId) => handleRemoveComplement(expandingDay, complementId)}
            onClose={() => { setExpandingDay(null); setExpandComplements(null); }}
            onQuickView={handleQuickView}
          />
        )}

        {/* Empty state — no plan and no candidates yet */}
        {!planLoading && !plan && !hasCandidates && (
          <NabuEmptyState
            className="mb-8"
            title="No plan for this week yet"
            description={isPastWeek ? "No saved plan for this past week." : "Generate suggestions to start filling in your week."}
            action={!isPastWeek ? (
              <NabuButton onClick={() => handleGenerate()} disabled={loading}>
                {loading ? "Generating..." : "Generate suggestions"}
              </NabuButton>
            ) : null}
          />
        )}

        {/* Action buttons — generate (first time) or explicit regenerate */}
        <div className="flex flex-wrap items-center gap-3 mb-8">
          {!hasCandidates && !planLoading && plan && !isPastWeek && (
            <NabuButton onClick={() => handleGenerate()} disabled={loading}>
              {loading ? "Generating..." : "Generate suggestions"}
            </NabuButton>
          )}
          {hasCandidates && (
            <>
              {plan?.candidateSet?.generatedAt && (
                <span className="text-[11px] text-stone-400 dark:text-stone-500">
                  Generated {new Date(plan.candidateSet.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {plan.candidateSet.policyVersion && (
                    <span className="ml-1 text-stone-300 dark:text-stone-600">
                      ({plan.candidateSet.policyVersion})
                    </span>
                  )}
                </span>
              )}
              {!isPastWeek && (
                <>
                  <NabuButton
                    onClick={() => handleAddWebInspirations()}
                    disabled={webInspirationLoading}
                    tone="ghost"
                    size="sm"
                  >
                    {webInspirationLoading ? "Finding web ideas..." : "Add 3–4 web ideas"}
                  </NabuButton>
                  <NabuButton
                    onClick={() => handleGenerate()}
                    disabled={loading}
                    tone="ghost"
                    size="sm"
                  >
                    {loading ? "Regenerating..." : "Regenerate"}
                  </NabuButton>
                </>
              )}
            </>
          )}
        </div>

        {/* Generation error banner */}
        {generateError && (
          <div className="mb-6 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 flex items-center justify-between">
            <span className="text-sm text-red-600 dark:text-red-400">{generateError}</span>
            <button
              onClick={() => setGenerateError(null)}
              className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-200 transition-colors ml-3"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Selected recipe indicator */}
        {selectedRecipe && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl bg-amber-50/50 p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/20">
            <span className="min-w-0 text-sm text-stone-600 dark:text-stone-300">
              <span className="font-serif font-medium">{selectedRecipe.name}</span>
              <span className="text-stone-400 dark:text-stone-500 sm:ml-2">&mdash; tap a day to assign</span>
            </span>
            <button
              onClick={() => setSelectedRecipe(null)}
              className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Candidate mains */}
        {hasCandidates && (
          <div className="space-y-6">
            <NabuSectionHeader
              eyebrow="Suggestions"
              description="Pick a main, then tap a day. Assigned recipes stay visible but quiet."
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {candidates.map((r) => {
                  const isAssigned = plan?.days.some((d) => d?.recipeId === r.id) ?? false;
                  return (
                    <RecipeCard
                      key={r.id}
                      recipe={r}
                      isSelected={selectedRecipe?.id === r.id}
                      isAssigned={isAssigned}
                      feedback={feedbackMap[r.id] ?? null}
                      onSelect={() =>
                        setSelectedRecipe(
                          selectedRecipe?.id === r.id ? null : r
                        )
                      }
                      onQuickView={() => handleQuickView(r.id)}
                      onFeedback={(value) => handleFeedback(r.id, value)}
                    />
                  );
                })}
            </div>
          </div>
        )}
      </NabuMain>

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
    </NabuPageShell>
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
    <div className="min-w-0 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-5 dark:bg-stone-900 space-y-5">
      {/* Free-text notes */}
      <div>
        <label className="text-[11px] text-stone-400 dark:text-stone-500 uppercase tracking-widest block mb-1.5">
          Week Notes
        </label>
        <textarea
          value={plan.notes || ""}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={locked}
          placeholder="General notes for this week..."
          rows={2}
          className="w-full text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 px-3 py-2 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 disabled:opacity-50 resize-none"
        />
      </div>

      {/* Existing context items */}
      {(plan.context || []).length > 0 && (
        <div>
          <label className="text-[11px] text-stone-400 dark:text-stone-500 uppercase tracking-widest block mb-2">
            Context Items
          </label>
          <div className="space-y-2">
            {(plan.context || []).map((ctx) => (
              <div
                key={ctx.id}
                className="flex min-w-0 flex-wrap items-center gap-2 text-sm"
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
                <span className="text-stone-700 dark:text-stone-300 flex-1 min-w-0 truncate">
                  {ctx.note}
                </span>
                {ctx.effect && (
                  <span className="text-[10px] text-stone-400 shrink-0">
                    {ctx.effect}
                  </span>
                )}
                {!locked && (
                  <button
                    onClick={() => onRemoveContext(ctx.id)}
                    className="shrink-0 text-xs text-stone-400 hover:text-red-500 transition-colors"
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
          <label className="text-[11px] text-stone-400 dark:text-stone-500 uppercase tracking-widest block mb-2">
            Add Context
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto]">
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as WeekContextItem["kind"])}
              className="text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
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
              className="text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
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
              className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500"
            />
            <button
              onClick={handleAdd}
              disabled={!newNote.trim()}
              className="px-3 py-1.5 rounded-full text-sm font-medium bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-30 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- ServeWithEditor sub-component -----

function ServeWithEditor({
  value,
  onChange,
  onClose,
}: {
  value: string[];
  onChange: (items: string[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    const items = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange(items);
    onClose();
  }

  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onClose();
        }}
        onBlur={commit}
        placeholder="e.g. Rice, Flatbreads"
        className="w-full text-[11px] rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200 px-1.5 py-1 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400/40"
      />
    </div>
  );
}

// ----- RecipeCard sub-component -----

function RecipeCard({
  recipe,
  isSelected,
  isAssigned,
  feedback,
  onSelect,
  onQuickView,
  onFeedback,
}: {
  recipe: RecipeOption;
  isSelected: boolean;
  isAssigned: boolean;
  feedback: "up" | "down" | null;
  onSelect: () => void;
  onQuickView: () => void;
  onFeedback: (value: "up" | "down") => void;
}) {
  const isVeg = recipe.dietary.some(
    (t) => t === "vegan" || t === "vegetarian"
  );
  const isWebInspiration = recipe.source?.publication?.includes("Web inspiration") ?? false;

  return (
    <div
      className={`group rounded-2xl overflow-hidden transition-all ${
        isAssigned
          ? "opacity-40 grayscale pointer-events-none bg-white dark:bg-stone-900 shadow-sm"
          : isSelected
            ? "ring-2 ring-amber-500/40 shadow-md"
            : "bg-white dark:bg-stone-900 shadow-sm hover:shadow-md"
      }`}
    >
      {/* Image */}
      {recipe.image ? (
        <div
          className="relative aspect-[4/3] bg-stone-100 dark:bg-stone-800 overflow-hidden cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onQuickView(); }}
        >
          <Image
            src={recipe.image}
            alt={recipe.name}
            fill
            className="object-cover group-hover:scale-[1.03] transition-transform duration-700 ease-out"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        </div>
      ) : (
        <div className="aspect-[4/3] bg-gradient-to-br from-stone-100 to-stone-150 dark:from-stone-800 dark:to-stone-900 flex items-center justify-center">
          <span className="text-4xl opacity-10">&middot;</span>
        </div>
      )}

      <div className="p-4 pb-3.5">
        {/* Name */}
        <h3
          className="font-serif text-[15px] text-stone-700 dark:text-stone-200 leading-snug line-clamp-2 cursor-pointer hover:text-stone-500 dark:hover:text-stone-400 transition-colors"
          onClick={(e) => { e.stopPropagation(); onQuickView(); }}
        >
          {recipe.name}
        </h3>
        <div className="mt-1 flex items-center gap-2">
          <p className="text-[11px] text-stone-400 dark:text-stone-500 truncate italic">
            {isWebInspiration ? recipe.source?.publication : recipe.source?.cookbook}
          </p>
          {isWebInspiration && (
            <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300">
              web
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {formatPlannerTime(recipe.time?.total) && (
            <span className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-stone-50 dark:bg-stone-800 text-stone-400 dark:text-stone-500">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatPlannerTime(recipe.time?.total)}
            </span>
          )}
          {recipe.courseTags.map((tag) => (
            <span
              key={tag}
              className={`text-[10px] px-2 py-0.5 rounded-full ${getCourseTagColor(tag)}`}
            >
              {tag}
            </span>
          ))}
          {isVeg && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400">
              {recipe.dietary.includes("vegan") ? "vegan" : "vegetarian"}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickView();
              }}
              className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
            >
              View recipe
            </button>
            <span className="text-stone-200 dark:text-stone-700 mx-1">|</span>
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback("up"); }}
              title={feedback === "up" ? "Remove thumbs up" : "Thumbs up — welcome back"}
              className={`p-1 rounded transition-colors ${
                feedback === "up"
                  ? "text-emerald-500"
                  : "text-stone-300 dark:text-stone-600 hover:text-emerald-400"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill={feedback === "up" ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback("down"); }}
              title={feedback === "down" ? "Remove thumbs down" : "Thumbs down — do not suggest again"}
              className={`p-1 rounded transition-colors ${
                feedback === "down"
                  ? "text-red-400"
                  : "text-stone-300 dark:text-stone-600 hover:text-red-400"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill={feedback === "down" ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z" />
              </svg>
            </button>
          </div>
          <button
            onClick={onSelect}
            disabled={isAssigned}
            className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-colors ${
              isAssigned
                ? "text-stone-300 dark:text-stone-600 cursor-not-allowed"
                : isSelected
                  ? "bg-stone-700 dark:bg-stone-200 text-white dark:text-stone-900"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
            }`}
          >
            {isAssigned ? "Assigned" : isSelected ? "Selected" : "Add to plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- Complement Picker (Turn into meal) -----

function ComplementPicker({
  dayIndex,
  slot,
  complements,
  loading,
  acceptedSides,
  onAccept,
  onRemove,
  onClose,
  onQuickView,
}: {
  dayIndex: number;
  slot: DaySlot;
  complements: { starters: RecipeOption[]; sides: RecipeOption[]; desserts: RecipeOption[] } | null;
  loading: boolean;
  acceptedSides: { id: string; name: string }[];
  onAccept: (recipe: RecipeOption) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onQuickView: (recipeId: string) => void;
}) {
  const isWeekend = slot.type === "weekend";
  const acceptedIds = new Set(acceptedSides.map((s) => s.id));

  // Split into recommended picks vs alternatives
  const recStarter = complements?.starters.find((r) => r.recommended) ?? null;
  const recSide = complements?.sides.find((r) => r.recommended) ?? null;
  const recDessert = isWeekend ? (complements?.desserts.find((r) => r.recommended) ?? null) : null;
  const recommended = [recStarter, recSide, recDessert].filter(Boolean) as RecipeOption[];
  const recommendedIds = new Set(recommended.map((r) => r.id));

  const altStarters = complements?.starters.filter((r) => !r.recommended) ?? [];
  const altSides = complements?.sides.filter((r) => !r.recommended) ?? [];
  const altDesserts = isWeekend ? (complements?.desserts.filter((r) => !r.recommended) ?? []) : [];
  const hasAlternatives = altStarters.length > 0 || altSides.length > 0 || altDesserts.length > 0;

  const allRecommendedAccepted = recommended.length > 0 && recommended.every((r) => acceptedIds.has(r.id));

  function handleAddRecommended() {
    for (const r of recommended) {
      if (!acceptedIds.has(r.id)) onAccept(r);
    }
  }

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-800/50 bg-white dark:bg-stone-900 p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-stone-800 dark:text-stone-100">
            Turn into meal — {slot.dayOfWeek} {slot.recipeName && (
              <span className="font-serif text-stone-500 dark:text-stone-400">({slot.recipeName})</span>
            )}
          </h3>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
            Pick 1 starter + 1 side to round out the plate.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
        >
          Close
        </button>
      </div>

      {/* Accepted complements */}
      {acceptedSides.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {acceptedSides.map((side) => (
            <span
              key={side.id}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
            >
              {side.name}
              <button
                onClick={() => onRemove(side.id)}
                className="text-violet-400 hover:text-red-400 transition-colors"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center">
          <p className="text-sm text-stone-400 font-serif italic">Loading suggestions...</p>
        </div>
      ) : complements ? (
        <div className="space-y-5">
          {/* Recommended meal set */}
          {recommended.length > 0 && (
            <div>
              <h4 className="text-xs tracking-widest uppercase text-violet-500 dark:text-violet-400 mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                My pick
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recommended.map((r) => {
                  const isAccepted = acceptedIds.has(r.id);
                  const roleLabel = recStarter?.id === r.id ? "Starter" : recDessert?.id === r.id ? "Dessert" : "Side";
                  return (
                    <div
                      key={r.id}
                      className={`flex items-center gap-3 rounded-lg border-2 p-3 transition-all ${
                        isAccepted
                          ? "border-violet-400 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-950/20"
                          : "border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/10"
                      }`}
                    >
                      {r.image && (
                        <button
                          onClick={() => onQuickView(r.id)}
                          className="shrink-0 rounded-md overflow-hidden focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                          <Image
                            src={r.image}
                            alt={r.name}
                            width={56}
                            height={56}
                            className="rounded-md object-cover w-14 h-14"
                          />
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-violet-400 dark:text-violet-500 font-medium">{roleLabel}</span>
                        </div>
                        <button
                          onClick={() => onQuickView(r.id)}
                          className="text-sm font-serif text-stone-800 dark:text-stone-100 line-clamp-2 leading-snug text-left hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                        >
                          {r.name}
                        </button>
                        <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">
                          {r.source?.cookbook}
                        </p>
                        {r.rationale && (
                          <p className="text-[10px] italic text-violet-400 dark:text-violet-500 mt-0.5 line-clamp-2 leading-snug">
                            {r.rationale}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Add recommended button */}
              <button
                onClick={handleAddRecommended}
                disabled={allRecommendedAccepted}
                className={`mt-3 w-full sm:w-auto px-5 py-2 rounded-full text-sm font-medium transition-colors ${
                  allRecommendedAccepted
                    ? "bg-violet-200 dark:bg-violet-800 text-violet-400 dark:text-violet-500 cursor-not-allowed"
                    : "bg-violet-600 dark:bg-violet-500 text-white hover:bg-violet-700 dark:hover:bg-violet-400"
                }`}
              >
                {allRecommendedAccepted
                  ? "Added"
                  : `Add ${recommended.length === 1 ? "this" : `these ${recommended.length}`}`}
              </button>
            </div>
          )}

          {/* Alternatives — swappable options */}
          {hasAlternatives && (
            <div>
              <h4 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-2">
                Or swap in...
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {[...altStarters.map((r) => ({ ...r, _role: "Starter" as const })),
                  ...altSides.map((r) => ({ ...r, _role: "Side" as const })),
                  ...altDesserts.map((r) => ({ ...r, _role: "Dessert" as const })),
                ].map((r) => {
                  const isAccepted = acceptedIds.has(r.id);
                  return (
                    <div
                      key={r.id}
                      className={`flex items-center gap-2.5 rounded-lg border p-2 transition-all ${
                        isAccepted
                          ? "border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20"
                          : "border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700"
                      }`}
                    >
                      {r.image && (
                        <button
                          onClick={() => onQuickView(r.id)}
                          className="shrink-0 rounded-md overflow-hidden focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                          <Image
                            src={r.image}
                            alt={r.name}
                            width={40}
                            height={40}
                            className="rounded object-cover w-10 h-10"
                          />
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-[9px] uppercase tracking-wider text-stone-400 dark:text-stone-500">{r._role}</span>
                        <button
                          onClick={() => onQuickView(r.id)}
                          className="block text-xs font-serif text-stone-700 dark:text-stone-200 line-clamp-1 leading-snug text-left hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
                        >
                          {r.name}
                        </button>
                        {r.rationale && (
                          <p className="text-[9px] italic text-stone-400 dark:text-stone-500 mt-0.5 line-clamp-1">
                            {r.rationale}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => onAccept(r)}
                        disabled={isAccepted}
                        className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                          isAccepted
                            ? "bg-violet-200 dark:bg-violet-800 text-violet-500 dark:text-violet-400 cursor-not-allowed"
                            : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 hover:text-violet-700 dark:hover:text-violet-300"
                        }`}
                      >
                        {isAccepted ? "Added" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#f8f6f3] dark:bg-stone-900 rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {loading ? (
          <div className="p-12 text-center">
            <p className="text-sm text-stone-400 font-serif italic">Loading recipe...</p>
          </div>
        ) : recipe ? (
          <>
            {/* Hero image — generous height */}
            {recipe.image && (
              <div className="relative aspect-[16/10] sm:aspect-[16/9]">
                <Image
                  src={recipe.image}
                  alt={recipe.name}
                  fill
                  className="object-cover rounded-t-2xl"
                  sizes="(max-width: 672px) 100vw, 672px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                <button
                  onClick={onClose}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm text-white/80 flex items-center justify-center hover:bg-black/50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="absolute bottom-4 left-5 right-5">
                  <p className="text-xs tracking-widest uppercase text-white/60 mb-1">
                    {recipe.source?.cookbook}
                  </p>
                  <h2 className="text-xl sm:text-2xl font-serif text-white leading-snug drop-shadow-sm">
                    {recipe.name}
                  </h2>
                </div>
              </div>
            )}
            {!recipe.image && (
              <div className="px-6 pt-6 pb-4 flex items-start justify-between">
                <div>
                  <p className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-1">
                    {recipe.source?.cookbook}
                  </p>
                  <h2 className="text-xl font-serif text-stone-800 dark:text-stone-100">
                    {recipe.name}
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <div className="px-6 py-6 space-y-6">
              {/* Meta line */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-stone-400 dark:text-stone-500">
                {recipe.category && (
                  <span className="text-stone-500 dark:text-stone-400">{recipe.category}</span>
                )}
                {formatPlannerTime(recipe.time?.total) && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formatPlannerTime(recipe.time?.total)}
                  </span>
                )}
                {recipe.servings && (
                  <span>{recipe.servings}</span>
                )}
              </div>

              {/* Introduction */}
              {recipe.introduction && (
                <p className="text-stone-500 dark:text-stone-400 font-serif text-sm leading-relaxed italic">
                  {recipe.introduction}
                </p>
              )}

              {/* Divider */}
              <div className="flex justify-center">
                <div className="w-12 h-px bg-stone-200 dark:bg-stone-800" />
              </div>

              {/* Ingredients */}
              <div>
                <h3 className="text-[11px] tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-3">
                  Ingredients
                </h3>
                <ul className="space-y-1.5">
                  {recipe.ingredients.map((ing, idx) => {
                    const norm = normalizeIngredient(
                      ing.unit ? `${ing.amount} ${ing.unit}` : ing.amount,
                      ing.item,
                    );
                    return (
                      <li
                        key={idx}
                        className="text-sm text-stone-600 dark:text-stone-400 flex justify-between"
                      >
                        <span>{norm.item}</span>
                        <span className="text-stone-400 dark:text-stone-500 ml-3 tabular-nums shrink-0">
                          {norm.amount}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Method (preview — first 4 steps) */}
              <div>
                <h3 className="text-[11px] tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-3">
                  Method
                </h3>
                <ol className="space-y-3">
                  {recipe.method.slice(0, 4).map((step, idx) => (
                    <li
                      key={idx}
                      className="text-sm text-stone-600 dark:text-stone-400 flex gap-3"
                    >
                      <span className="text-lg font-serif text-stone-300 dark:text-stone-600 leading-none shrink-0 pt-0.5">
                        {idx + 1}
                      </span>
                      <span className="leading-relaxed line-clamp-3">{step}</span>
                    </li>
                  ))}
                </ol>
                {recipe.method.length > 4 && (
                  <p className="text-xs text-stone-400 mt-3 italic">
                    +{recipe.method.length - 4} more steps
                  </p>
                )}
              </div>

              {/* Tips */}
              {recipe.tips && (
                <div className="text-sm text-stone-500 dark:text-stone-400 bg-stone-100/60 dark:bg-stone-800/40 rounded-xl px-5 py-4">
                  <span className="text-[11px] tracking-widest uppercase text-stone-400 dark:text-stone-500">Tip</span>
                  <p className="mt-1.5 leading-relaxed">{recipe.tips}</p>
                </div>
              )}

              {/* Full recipe link */}
              <div className="pt-2 pb-1 text-center">
                <Link
                  href={`/recipes/${recipe.id}`}
                  className="text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 underline underline-offset-2 transition-colors"
                >
                  View full recipe
                </Link>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
