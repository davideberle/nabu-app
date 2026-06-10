/**
 * Health domain helpers — summary projections, assumptions, and confidence labels.
 *
 * This file owns the meaning of a health day, breakfast defaults, confidence
 * levels, and rolling-window summaries. It does NOT own UI rendering or DB
 * access; those live in the page and health-db.ts respectively.
 *
 * Domain semantics are owned by projects/health-dashboard/.
 */

import type {
  HealthDailyLog,
  HealthAlcoholEvent,
  HealthSleepReport,
  HealthMeditationLog,
} from "./health-db";
import type { CookingSession } from "./cooking";
import type { MealPlan } from "./meals";

// ---------------------------------------------------------------------------
// Confidence labels
// ---------------------------------------------------------------------------

export type DataConfidence = "logged" | "assumed" | "missing";

// ---------------------------------------------------------------------------
// Breakfast assumption
// ---------------------------------------------------------------------------

const DEFAULT_BREAKFAST = "Flat white with oat milk";

export function getBreakfastLabel(log: HealthDailyLog | null): {
  label: string;
  confidence: DataConfidence;
} {
  if (log?.breakfastOverride) {
    return { label: log.breakfastOverride, confidence: "logged" };
  }
  return { label: DEFAULT_BREAKFAST, confidence: "assumed" };
}

// ---------------------------------------------------------------------------
// Dinner context resolution from Kitchen data
// ---------------------------------------------------------------------------

export type DinnerContext = {
  label: string;
  source: string;
};

/**
 * Resolve dinner context from existing Kitchen / Live Cooking data.
 *
 * Priority:
 *  1. Active or completed cooking session for the date.
 *  2. Meal plan assignment for the date.
 *  3. null if neither exists.
 */
export function resolveDinnerFromKitchen(
  cookingSession: CookingSession | null,
  mealPlan: MealPlan | null,
  date: string,
): DinnerContext | null {
  // 1. Live Cooking session
  if (cookingSession) {
    const label =
      cookingSession.anchor.title ||
      cookingSession.anchor.provenance?.source ||
      "Cooking session";
    return { label, source: "live-cooking" };
  }

  // 2. Meal plan for this date
  if (mealPlan) {
    const day = mealPlan.days.find((d) => d.date === date);
    if (day) {
      const name =
        day.meal?.main?.name ?? day.brunch?.main?.name ?? day.recipeName;
      if (name) {
        return { label: name, source: "meal-plan" };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Per-day health snapshot
// ---------------------------------------------------------------------------

export type HealthDaySnapshot = {
  date: string;
  dayOfWeek: string;
  breakfast: { label: string; confidence: DataConfidence };
  lunch: { label: string | null; confidence: DataConfidence };
  dinner: { label: string | null; source: string | null; confidence: DataConfidence };
  alcohol: { events: HealthAlcoholEvent[]; count: number; confidence: DataConfidence };
  sleep: { report: HealthSleepReport | null; confidence: DataConfidence };
  meditation: { log: HealthMeditationLog | null; confidence: DataConfidence };
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildDaySnapshot(
  date: string,
  log: HealthDailyLog | null,
  alcoholEvents: HealthAlcoholEvent[],
  sleepReport: HealthSleepReport | null,
  meditationLog: HealthMeditationLog | null,
  inferredDinner?: DinnerContext | null,
): HealthDaySnapshot {
  const d = new Date(date + "T12:00:00");

  // Dinner: logged > inferred from kitchen > missing
  let dinner: HealthDaySnapshot["dinner"];
  if (log?.dinnerSummary) {
    dinner = { label: log.dinnerSummary, source: log.dinnerSource ?? null, confidence: "logged" };
  } else if (inferredDinner) {
    dinner = { label: inferredDinner.label, source: inferredDinner.source, confidence: "assumed" };
  } else {
    dinner = { label: null, source: null, confidence: "missing" };
  }

  return {
    date,
    dayOfWeek: WEEKDAYS[d.getDay()],
    breakfast: getBreakfastLabel(log),
    lunch: {
      label: log?.lunchNote ?? null,
      confidence: log?.lunchNote ? "logged" : "missing",
    },
    dinner,
    alcohol: {
      events: alcoholEvents,
      count: alcoholEvents.length,
      confidence: alcoholEvents.length > 0 ? "logged" : "missing",
    },
    sleep: {
      report: sleepReport,
      confidence: sleepReport ? "logged" : "missing",
    },
    meditation: {
      log: meditationLog,
      confidence: meditationLog ? "logged" : "missing",
    },
  };
}

// ---------------------------------------------------------------------------
// Rolling 7-day summary
// ---------------------------------------------------------------------------

export type HealthWeekSummary = {
  days: HealthDaySnapshot[];
  alcoholDrinks: number;
  alcoholFreeDays: number;
  sleepLogged: number;
  averageSleepHours: number | null;
  meditationDays: number;
  meditationStreak: number;
  dataCompleteness: number; // 0–100
};

export function buildWeekSummary(days: HealthDaySnapshot[]): HealthWeekSummary {
  let alcoholDrinks = 0;
  let alcoholFreeDays = 0;
  let sleepLogged = 0;
  let totalSleepHours = 0;
  let meditationDays = 0;
  let currentStreak = 0;
  let maxStreak = 0;

  let loggedSignals = 0;
  const totalSignals = days.length * 4; // alcohol, sleep, meditation, lunch

  // Process days in chronological order for streak calculation
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  for (const day of sorted) {
    alcoholDrinks += day.alcohol.count;
    if (day.alcohol.count === 0) alcoholFreeDays++;

    if (day.sleep.report) {
      sleepLogged++;
      loggedSignals++;
      if (day.sleep.report.hours) totalSleepHours += day.sleep.report.hours;
    }

    if (day.meditation.log?.completed) {
      meditationDays++;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
      loggedSignals++;
    } else {
      currentStreak = 0;
    }

    if (day.alcohol.confidence === "logged") loggedSignals++;
    if (day.lunch.confidence === "logged") loggedSignals++;
  }

  return {
    days: sorted,
    alcoholDrinks,
    alcoholFreeDays,
    sleepLogged,
    averageSleepHours: sleepLogged > 0 ? Math.round((totalSleepHours / sleepLogged) * 10) / 10 : null,
    meditationDays,
    meditationStreak: maxStreak,
    dataCompleteness: totalSignals > 0 ? Math.round((loggedSignals / totalSignals) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Get today's date in Zurich local time as YYYY-MM-DD. */
export function getZurichToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
}

/** Get an array of YYYY-MM-DD strings for the last N days ending at `endDate`. */
export function getDateRange(endDate: string, days: number): string[] {
  const dates: string[] = [];
  const end = new Date(endDate + "T12:00:00");
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

/** Format a date as a short label, e.g. "Mon 10 Jun". */
export function formatShortDate(date: string): string {
  const d = new Date(date + "T12:00:00");
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}
