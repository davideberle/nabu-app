// Contract tests for the POST /api/meals/prepare response shape.
//
// The route handler itself cannot be imported here — it resolves the `@/` alias
// and pulls in `next/server`, which a plain `node --test` run cannot load. So
// the decisions the route delegates to are composed in exactly the order the
// route composes them:
//
//   POST → resolvePreparationMode(body.mode)
//        → prepareWeek | runWatchdog | rolloverWeek
//        → preparationResponseBody(outcome, mode) at preparationResponseStatus
//
// The property pinned here is the one the scheduled ritual found broken:
// **every answer names the mode that ran.** Rollover returned HTTP 200 with
// status "rolled-over" and no `mode`, so strict validation rejected a run that
// had succeeded. That is asserted for all three modes, for the default, and on
// every non-error outcome each mode can produce — including a refused claim.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, deepEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  preparationResponseBody,
  preparationResponseStatus,
  resolvePreparationMode,
  type PreparationMode,
} from "./planner-preparation-response.ts";
import type { PreparationOutcome, RolloverOutcome } from "./planner-preparation.ts";

/** The route, minus the orchestration and the NextResponse wrapper. */
function post(
  body: { mode?: unknown },
  run: (mode: PreparationMode) => PreparationOutcome | RolloverOutcome,
): { status: number; body: Record<string, unknown> } {
  const mode = resolvePreparationMode(body.mode);
  const outcome = run(mode);
  return { status: preparationResponseStatus(outcome), body: preparationResponseBody(outcome, mode) };
}

const rollover = (status: RolloverOutcome["status"], error?: string): RolloverOutcome => ({
  week: "2026-W31",
  status,
  promoted: [],
  expired: [],
  retained: 0,
  exposuresRecorded: 0,
  exposuresCleared: 0,
  ...(error ? { error } : {}),
});

const preparation = (
  kind: PreparationOutcome["kind"],
  status: PreparationOutcome["status"],
): PreparationOutcome => ({ week: "2026-W33", kind, status, shelfSize: 12, healthy: true });

describe("POST /api/meals/prepare response contract", () => {
  it("echoes rollover on the success the ritual could not verify", () => {
    const res = post({ mode: "rollover" }, () => rollover("rolled-over"));
    equal(res.status, 200);
    equal(res.body.mode, "rollover");
    equal(res.body.status, "rolled-over");
  });

  it("echoes the effective mode on every non-error outcome of every mode", () => {
    const outcomes: Array<[unknown, PreparationMode, PreparationOutcome | RolloverOutcome]> = [
      [undefined, "prepare", preparation("prepare", "prepared")],
      [{}, "prepare", preparation("prepare", "prepared")],
      ["nonsense", "prepare", preparation("prepare", "prepared")],
      ["prepare", "prepare", preparation("prepare", "prepared")],
      ["prepare", "prepare", preparation("prepare", "claim-not-acquired")],
      ["watchdog", "watchdog", preparation("watchdog", "already-healthy")],
      ["watchdog", "watchdog", preparation("watchdog", "repaired")],
      ["watchdog", "watchdog", preparation("watchdog", "claim-not-acquired")],
      ["rollover", "rollover", rollover("rolled-over")],
      ["rollover", "rollover", rollover("claim-not-acquired")],
    ];

    for (const [requested, effective, outcome] of outcomes) {
      const res = post({ mode: requested }, () => outcome);
      equal(res.body.mode, effective, `mode ${String(requested)} / ${outcome.status}`);
      equal(res.status, 200, `mode ${String(requested)} / ${outcome.status}`);
    }
  });

  it("names the mode on failures too, and keeps them 500", () => {
    for (const outcome of [preparation("prepare", "failed"), rollover("failed", "boom")]) {
      const mode = "kind" in outcome ? outcome.kind : "rollover";
      const res = post({ mode }, () => outcome);
      equal(res.status, 500);
      equal(res.body.mode, mode);
    }
  });

  it("adds the mode without disturbing the outcome the kitchen returned", () => {
    const outcome = rollover("rolled-over");
    const res = post({ mode: "rollover" }, () => outcome);
    const { mode, ...rest } = res.body;
    equal(mode, "rollover");
    deepEqual(rest, { ...outcome });
    deepEqual(outcome, rollover("rolled-over"), "the outcome must not be mutated");
  });

  it("reports the mode it ran, not the one that was asked for", () => {
    // A typo must not make the response claim a rollover happened.
    const res = post({ mode: "Rollover" }, () => preparation("prepare", "prepared"));
    equal(res.body.mode, "prepare");
    equal(resolvePreparationMode(null), "prepare");
    equal(resolvePreparationMode(["rollover"]), "prepare");
  });
});
