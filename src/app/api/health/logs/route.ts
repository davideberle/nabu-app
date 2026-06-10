import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import {
  getDailyLog,
  getDailyLogsForRange,
  upsertDailyLog,
  getAlcoholEventsForRange,
  getSleepReportsForRange,
  getMeditationLogsForRange,
} from "@/lib/health-db";
import {
  buildDaySnapshot,
  buildWeekSummary,
  resolveDinnerFromKitchen,
  getZurichToday,
  getDateRange,
} from "@/lib/health";
import { getCookingSessionForDate, getSessionsForDateRange } from "@/lib/cooking";
import { loadMealPlan } from "@/lib/meals-persistence";
import { getISOWeek } from "@/lib/meals";

function weekIdForDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const { year, week } = getISOWeek(d);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * GET /api/health/logs?date=YYYY-MM-DD
 *   Returns the day snapshot for a single date.
 *
 * GET /api/health/logs?range=7
 *   Returns today + rolling N-day summary.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const range = searchParams.get("range");

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }
    const log = await getDailyLog(date);
    const alcohol = await getAlcoholEventsForRange(date, date);
    const sleep = (await getSleepReportsForRange(date, date))[0] ?? null;
    const meditation = (await getMeditationLogsForRange(date, date))[0] ?? null;

    // Resolve dinner from Kitchen data when not manually logged
    let inferredDinner = null;
    if (!log?.dinnerSummary) {
      const [cookingSession, mealPlan] = await Promise.all([
        getCookingSessionForDate(date),
        loadMealPlan(weekIdForDate(date)),
      ]);
      inferredDinner = resolveDinnerFromKitchen(cookingSession, mealPlan, date);
    }

    const snapshot = buildDaySnapshot(date, log, alcohol, sleep, meditation, inferredDinner);
    return NextResponse.json(snapshot);
  }

  // Default: rolling summary
  const days = range ? parseInt(range, 10) : 7;
  if (isNaN(days) || days < 1 || days > 30) {
    return NextResponse.json({ error: "range must be 1-30" }, { status: 400 });
  }

  const today = getZurichToday();
  const dates = getDateRange(today, days);
  const from = dates[0];
  const to = dates[dates.length - 1];

  const [logs, alcohol, sleepReports, meditationLogs, cookingSessions] = await Promise.all([
    getDailyLogsForRange(from, to),
    getAlcoholEventsForRange(from, to),
    getSleepReportsForRange(from, to),
    getMeditationLogsForRange(from, to),
    getSessionsForDateRange(from, to),
  ]);

  const logMap = new Map(logs.map((l) => [l.date, l]));
  const alcoholMap = new Map<string, typeof alcohol>();
  for (const e of alcohol) {
    const arr = alcoholMap.get(e.date) ?? [];
    arr.push(e);
    alcoholMap.set(e.date, arr);
  }
  const sleepMap = new Map(sleepReports.map((s) => [s.date, s]));
  const meditationMap = new Map(meditationLogs.map((m) => [m.date, m]));
  const cookingMap = new Map(cookingSessions.map((s) => [s.date, s]));

  // Load meal plans for weeks that cover the date range (deduplicated)
  const weekIds = [...new Set(dates.map(weekIdForDate))];
  const mealPlans = await Promise.all(weekIds.map(loadMealPlan));
  const mealPlanMap = new Map(
    weekIds.map((id, i) => [id, mealPlans[i]]),
  );

  const snapshots = dates.map((d) => {
    const log = logMap.get(d) ?? null;
    let inferredDinner = null;
    if (!log?.dinnerSummary) {
      inferredDinner = resolveDinnerFromKitchen(
        cookingMap.get(d) ?? null,
        mealPlanMap.get(weekIdForDate(d)) ?? null,
        d,
      );
    }
    return buildDaySnapshot(
      d,
      log,
      alcoholMap.get(d) ?? [],
      sleepMap.get(d) ?? null,
      meditationMap.get(d) ?? null,
      inferredDinner,
    );
  });

  const summary = buildWeekSummary(snapshots);
  return NextResponse.json({ today, summary });
}

/**
 * POST /api/health/logs
 * Body: { date, breakfastOverride?, lunchNote?, dinnerSource?, dinnerSummary?, dayNote? }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { date, breakfastOverride, lunchNote, dinnerSource, dinnerSummary, dayNote } = body;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400 });
  }

  await upsertDailyLog({
    date,
    ...(typeof breakfastOverride === "string" ? { breakfastOverride } : {}),
    ...(typeof lunchNote === "string" ? { lunchNote } : {}),
    ...(typeof dinnerSource === "string" ? { dinnerSource } : {}),
    ...(typeof dinnerSummary === "string" ? { dinnerSummary } : {}),
    ...(typeof dayNote === "string" ? { dayNote } : {}),
  });

  return NextResponse.json({ ok: true });
}
