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

const DEFAULT_BREAKFAST = "One doppio macchiato with oat milk";

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
  // 1. Live Cooking session — an explicit session main wins over the anchor
  if (cookingSession) {
    const label =
      cookingSession.main?.title ||
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
// Alcohol day status
// ---------------------------------------------------------------------------

/**
 * The primary weekly signal: was a day a confirmed alcohol day, a confirmed
 * alcohol-free day, or is there no evidence either way?
 *
 * The absence of an alcohol event is NOT evidence of an alcohol-free day.
 * Confirming an alcohol-free day requires explicit day-state storage with
 * provenance (a later phase), so until that exists a day without events must
 * read as `unknown`, never as `alcohol_free`.
 */
export type AlcoholDayStatus = "alcohol" | "alcohol_free" | "unknown";

export function getAlcoholDayStatus(events: HealthAlcoholEvent[]): AlcoholDayStatus {
  return events.length > 0 ? "alcohol" : "unknown";
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
  alcohol: {
    events: HealthAlcoholEvent[];
    count: number;
    status: AlcoholDayStatus;
    confidence: DataConfidence;
  };
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
      status: getAlcoholDayStatus(alcoholEvents),
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
  /** Days with confirmed alcohol evidence. */
  alcoholDays: number;
  /** Days explicitly confirmed alcohol-free. Never inferred from missing data. */
  alcoholFreeDays: number;
  /** Days with no alcohol evidence either way. */
  unknownAlcoholDays: number;
  /** Total logged drink events across the window. */
  alcoholDrinks: number;
  sleepLogged: number;
  averageSleepHours: number | null;
  meditationDays: number;
  meditationStreak: number;
};

export function buildWeekSummary(days: HealthDaySnapshot[]): HealthWeekSummary {
  let alcoholDays = 0;
  let alcoholFreeDays = 0;
  let unknownAlcoholDays = 0;
  let alcoholDrinks = 0;
  let sleepLogged = 0;
  let totalSleepHours = 0;
  let meditationDays = 0;
  let currentStreak = 0;
  let maxStreak = 0;

  // Process days in chronological order for streak calculation
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  for (const day of sorted) {
    alcoholDrinks += day.alcohol.count;
    if (day.alcohol.status === "alcohol") alcoholDays++;
    else if (day.alcohol.status === "alcohol_free") alcoholFreeDays++;
    else unknownAlcoholDays++;

    if (day.sleep.report) {
      sleepLogged++;
      if (day.sleep.report.hours) totalSleepHours += day.sleep.report.hours;
    }

    if (day.meditation.log?.completed) {
      meditationDays++;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  return {
    days: sorted,
    alcoholDays,
    alcoholFreeDays,
    unknownAlcoholDays,
    alcoholDrinks,
    sleepLogged,
    averageSleepHours: sleepLogged > 0 ? Math.round((totalSleepHours / sleepLogged) * 10) / 10 : null,
    meditationDays,
    meditationStreak: maxStreak,
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
