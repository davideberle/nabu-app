/**
 * The response contract of POST /api/meals/prepare.
 *
 * The route resolves a mode, runs the matching kitchen orchestration, and hands
 * the outcome back as JSON. The orchestration outcomes were never shaped for
 * that wire: `PreparationOutcome` carries `kind`, and `RolloverOutcome` carries
 * nothing identifying the run at all. So the scheduled rollover ritual posted
 * `{"mode":"rollover"}`, got HTTP 200 / `"rolled-over"` back with no `mode`,
 * and strictly rejected a run that had in fact succeeded.
 *
 * The fix is a wire concern, not a kitchen one, so it lives here rather than in
 * `planner-preparation.ts`: **every answer echoes the effective mode**, on the
 * success paths, on `claim-not-acquired`, and on `failed`. The echo is the
 * mode the route actually ran, not the one the caller asked for — an
 * unrecognized `mode` falls back to `prepare` and the response says `prepare`.
 *
 * These are pure so the contract is testable without `next/server`.
 */

import type { PreparationOutcome, RolloverOutcome } from "./planner-preparation.ts";

export type PreparationMode = "prepare" | "watchdog" | "rollover";

const MODES: readonly PreparationMode[] = ["prepare", "watchdog", "rollover"];

/**
 * The mode the route will run. An absent, malformed, or unknown `mode` is the
 * valid "prepare next week" call the schedules and the empty body both rely on.
 */
export function resolvePreparationMode(mode: unknown): PreparationMode {
  return MODES.includes(mode as PreparationMode) ? (mode as PreparationMode) : "prepare";
}

/** Only `failed` is a server error; a refused claim is a legitimate no-op. */
export function preparationResponseStatus(outcome: { status: string }): 200 | 500 {
  return outcome.status === "failed" ? 500 : 200;
}

/**
 * The JSON body, with the effective mode echoed. `mode` is written last on
 * purpose: it is the route's answer about what it ran, and nothing an outcome
 * carries may shadow it.
 */
export function preparationResponseBody<T extends PreparationOutcome | RolloverOutcome>(
  outcome: T,
  mode: PreparationMode,
): T & { mode: PreparationMode } {
  return { ...outcome, mode };
}
