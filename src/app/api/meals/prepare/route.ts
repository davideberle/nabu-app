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
import { buildPreparationDeps, buildRolloverDeps } from "@/lib/planner-runtime";
import { claimPlannerPreparation, completePlannerPreparation, getPlannerPreparationRuns } from "@/lib/db";
import { loadMealPlan } from "@/lib/meals-persistence";

const WEEK_PATTERN = /^\d{4}-W\d{2}$/;
type Mode = "prepare" | "watchdog" | "rollover";

export async function POST(request: NextRequest) {
  const guard = await guardRuntimeWrite(request);
  if (guard.response) return guard.response;

  let body: { week?: unknown; mode?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is a valid "prepare next week" call.
  }

  const mode: Mode =
    body.mode === "watchdog" || body.mode === "rollover" || body.mode === "prepare"
      ? body.mode
      : "prepare";

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
      return NextResponse.json(outcome, { status: outcome.status === "failed" ? 500 : 200 });
    }

    const deps = {
      ...buildPreparationDeps(now),
      claim: claimPlannerPreparation,
      complete: completePlannerPreparation,
    };
    const outcome = mode === "watchdog" ? await runWatchdog(week, deps) : await prepareWeek(week, deps);
    return NextResponse.json(outcome, { status: outcome.status === "failed" ? 500 : 200 });
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
    return NextResponse.json({
      week,
      healthy: health.healthy,
      problems: health.problems,
      shelfSize: plan?.candidateSet?.items?.length ?? 0,
      policyVersion: plan?.candidateSet?.policyVersion ?? null,
      generatedAt: plan?.candidateSet?.generatedAt ?? null,
      runs,
    });
  } catch (error) {
    console.error(`Failed to read preparation status for ${week}:`, error);
    return NextResponse.json({ error: "Failed to read preparation status" }, { status: 500 });
  }
}
