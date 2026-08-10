/**
 * POST /api/meals/prepare  { week?, mode?: "prepare" | "watchdog" | "rollover" }
 * GET  /api/meals/prepare?week=<ISO-week>
 *
 * The runtime entry point for kitchen-owned weekly preparation:
 *
 *   Thursday 05:30 Europe/Zurich  → { mode: "prepare" }  (defaults to next week)
 *   Friday   06:00 Europe/Zurich  → { mode: "watchdog" } (repairs only if unhealthy)
 *   after a week ends             → { mode: "rollover" } (defaults to last week)
 *
 * Authenticated like every other trusted-runtime mutation: an authorized
 * household session *or* one valid `TRUSTED_RUNTIME_TOKEN` bearer. A missing
 * server token authorizes nothing (`lib/runtime-auth.ts`).
 *
 * Every POST answer echoes the mode that actually ran — the schedules verify a
 * run by the response alone, and an outcome that does not say which ritual
 * produced it cannot be verified (`lib/planner-preparation-response.ts`).
 *
 * Idempotent by construction. Each (week, mode) takes a DB-level claim, the
 * watchdog leaves a healthy shelf untouched, rollover promotion skips records
 * that were already promoted, and web discovery keeps its own duplicate
 * refusal. Re-running is safe; that is what makes it schedulable.
 *
 * No cron schedule is created here. This repo has no `vercel.json`/`vercel.ts`
 * config surface, so wiring the two triggers stays a deliberate follow-up.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardRuntimeWrite } from "@/lib/api-guards";
import {
  assessShelfHealth,
  nextWeekId,
  previousWeekId,
  prepareWeek,
  rolloverWeek,
  runWatchdog,
} from "@/lib/planner-preparation";
import {
  preparationResponseBody,
  preparationResponseStatus,
  resolvePreparationMode,
} from "@/lib/planner-preparation-response";
import { buildPreparationDeps, buildRolloverDeps } from "@/lib/planner-runtime";
import { claimPlannerPreparation, completePlannerPreparation, getPlannerPreparationRuns } from "@/lib/db";
import { loadMealPlan } from "@/lib/meals-persistence";

const WEEK_PATTERN = /^\d{4}-W\d{2}$/;

export async function POST(request: NextRequest) {
  const guard = await guardRuntimeWrite(request);
  if (guard.response) return guard.response;

  let body: { week?: unknown; mode?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is a valid "prepare next week" call.
  }

  const mode = resolvePreparationMode(body.mode);

  const now = new Date();
  const requestedWeek = typeof body.week === "string" ? body.week : undefined;
  if (requestedWeek && !WEEK_PATTERN.test(requestedWeek)) {
    return NextResponse.json({ error: "Invalid week format (expected YYYY-Wnn)" }, { status: 400 });
  }
  const week = requestedWeek ?? (mode === "rollover" ? previousWeekId(now) : nextWeekId(now));

  try {
    if (mode === "rollover") {
      const outcome = await rolloverWeek(week, {
        ...buildRolloverDeps(now),
        claim: claimPlannerPreparation,
        complete: completePlannerPreparation,
      });
      return NextResponse.json(preparationResponseBody(outcome, mode), {
        status: preparationResponseStatus(outcome),
      });
    }

    const deps = {
      ...buildPreparationDeps(now),
      claim: claimPlannerPreparation,
      complete: completePlannerPreparation,
    };
    const outcome = mode === "watchdog" ? await runWatchdog(week, deps) : await prepareWeek(week, deps);
    return NextResponse.json(preparationResponseBody(outcome, mode), {
      status: preparationResponseStatus(outcome),
    });
  } catch (error) {
    console.error(`Weekly preparation (${mode}) failed for ${week}:`, error);
    return NextResponse.json(
      { week, mode, status: "failed", error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * Read-only status: is the saved shelf healthy, and what did the last runs do?
 * Reads stay open, matching every other planner GET.
 */
export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week") ?? nextWeekId();
  if (!WEEK_PATTERN.test(week)) {
    return NextResponse.json({ error: "Invalid week format (expected YYYY-Wnn)" }, { status: 400 });
  }
  try {
    const [plan, runs] = await Promise.all([loadMealPlan(week), getPlannerPreparationRuns(week)]);
    const health = assessShelfHealth(plan, new Date());
    const items = plan?.candidateSet?.items ?? [];
    // Counted from the *stored* shelf rather than read back off the last run's
    // summary. A verifier asking "did web research reach this week's shelf?"
    // should be answered by the shelf, not by a report about it.
    const webSelected = items.filter((item) => (item as { origin?: string }).origin === "web").length;
    return NextResponse.json({
      week,
      healthy: health.healthy,
      problems: health.problems,
      shelfSize: items.length,
      webSelected,
      catalogSelected: items.length - webSelected,
      policyVersion: plan?.candidateSet?.policyVersion ?? null,
      generatedAt: plan?.candidateSet?.generatedAt ?? null,
      runs,
    });
  } catch (error) {
    console.error(`Failed to read preparation status for ${week}:`, error);
    return NextResponse.json({ error: "Failed to read preparation status" }, { status: 500 });
  }
}
