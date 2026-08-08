// Exposure memory: one ignored appearance costs 12 weeks, a second ends
// automatic suggestion until David explicitly asks.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPOSURE_COOLDOWN_WEEKS,
  EXPOSURE_SUPPRESSION_THRESHOLD,
  clearExposureOnSelection,
  diffShelfExposure,
  exposureState,
  isSuggestable,
  recordUnselectedExposure,
  resetExposure,
  suppressedRecipeIds,
  type ExposureRecord,
} from "./planner-exposure.ts";

const T0 = new Date("2026-01-05T06:00:00.000Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

describe("first unselected exposure", () => {
  it("starts a 12-week cooldown", () => {
    const record = recordUnselectedExposure(null, "kohlrabi-curry", T0);
    equal(record.exposureCount, 1);
    equal(record.suppressed, false);
    ok(record.cooldownUntil);
    equal(EXPOSURE_COOLDOWN_WEEKS, 12);
    equal(
      Date.parse(record.cooldownUntil!) - T0.getTime(),
      12 * 7 * 86_400_000,
      "cooldown is exactly 12 weeks",
    );
  });

  it("keeps the recipe out of automatic suggestion for the whole window", () => {
    const record = recordUnselectedExposure(null, "kohlrabi-curry", T0);
    equal(exposureState(record, days(1)), "cooldown");
    equal(exposureState(record, days(83)), "cooldown");
    equal(isSuggestable(record, days(83)), false);
  });

  it("lets it come back once the cooldown passes", () => {
    const record = recordUnselectedExposure(null, "kohlrabi-curry", T0);
    equal(exposureState(record, days(85)), "available");
    equal(isSuggestable(record, days(85)), true);
  });

  it("never blocks an explicit search or request", () => {
    const record = recordUnselectedExposure(null, "kohlrabi-curry", T0);
    equal(isSuggestable(record, days(1), "explicit"), true);
  });
});

describe("second unselected exposure", () => {
  it("suppresses the recipe from automatic suggestion entirely", () => {
    const first = recordUnselectedExposure(null, "beet-risotto", T0);
    const second = recordUnselectedExposure(first, "beet-risotto", days(90));
    equal(second.exposureCount, EXPOSURE_SUPPRESSION_THRESHOLD);
    equal(second.suppressed, true);
    equal(second.cooldownUntil, null, "there is no clock to wait out any more");
    equal(exposureState(second, days(91)), "suppressed");
    equal(exposureState(second, days(4000)), "suppressed", "time alone never restores it");
    equal(isSuggestable(second, days(4000)), false);
  });

  it("keeps it reachable by explicit search or request", () => {
    const first = recordUnselectedExposure(null, "beet-risotto", T0);
    const second = recordUnselectedExposure(first, "beet-risotto", days(90));
    equal(isSuggestable(second, days(4000), "explicit"), true);
  });

  it("preserves the first-exposure timestamp", () => {
    const first = recordUnselectedExposure(null, "beet-risotto", T0);
    const second = recordUnselectedExposure(first, "beet-risotto", days(90));
    equal(second.firstExposedAt, first.firstExposedAt);
    equal(second.lastExposedAt, days(90).toISOString());
  });
});

describe("clearing exposure", () => {
  it("selection wipes the memory — the recipe was chosen, not ignored", () => {
    const first = recordUnselectedExposure(null, "beet-risotto", T0);
    const cleared = clearExposureOnSelection(first, days(2));
    ok(cleared);
    equal(cleared!.exposureCount, 0);
    equal(cleared!.suppressed, false);
    equal(cleared!.cooldownUntil, null);
    equal(exposureState(cleared, days(3)), "available");
  });

  it("selection un-suppresses a twice-ignored recipe", () => {
    const second = recordUnselectedExposure(
      recordUnselectedExposure(null, "beet-risotto", T0),
      "beet-risotto",
      days(90),
    );
    const cleared = clearExposureOnSelection(second, days(91));
    equal(cleared!.suppressed, false);
  });

  it("returns null when there is nothing to clear, so no write happens", () => {
    equal(clearExposureOnSelection(null, T0), null);
  });

  it("an explicit reset restores a suppressed recipe", () => {
    const second = recordUnselectedExposure(
      recordUnselectedExposure(null, "beet-risotto", T0),
      "beet-risotto",
      days(90),
    );
    const reset = resetExposure(second, "beet-risotto", days(120));
    equal(reset.suppressed, false);
    equal(reset.exposureCount, 0);
    equal(isSuggestable(reset, days(121)), true);
  });
});

describe("shelf outcome diffing", () => {
  const existing = new Map<string, ExposureRecord>();

  it("records an exposure for everything shown and not chosen", () => {
    const diff = diffShelfExposure(
      ["shown-a", "shown-b", "chosen-c"],
      new Set(["chosen-c"]),
      existing,
      T0,
    );
    deepStrictEqual(diff.exposed.map((r) => r.recipeId).sort(), ["shown-a", "shown-b"]);
    deepStrictEqual(diff.cleared, [], "a first-time choice has no memory to clear");
  });

  it("clears memory for a recipe that was finally chosen", () => {
    const prior = new Map<string, ExposureRecord>([
      ["chosen-c", recordUnselectedExposure(null, "chosen-c", T0)],
    ]);
    const diff = diffShelfExposure(["chosen-c"], new Set(["chosen-c"]), prior, days(1));
    deepStrictEqual(diff.exposed, []);
    equal(diff.cleared.length, 1);
    equal(diff.cleared[0].exposureCount, 0);
  });

  it("counts a recipe once per shelf even if it appears twice", () => {
    const diff = diffShelfExposure(["dup", "dup"], new Set(), new Map(), T0);
    equal(diff.exposed.length, 1);
    equal(diff.exposed[0].exposureCount, 1);
  });

  it("escalates across two different weeks", () => {
    const week1 = diffShelfExposure(["repeat"], new Set(), new Map(), T0);
    const after1 = new Map([[ "repeat", week1.exposed[0] ]]);
    const week2 = diffShelfExposure(["repeat"], new Set(), after1, days(7));
    equal(week2.exposed[0].exposureCount, 2);
    equal(week2.exposed[0].suppressed, true);
  });

  it("counts a re-run of the same week only once", () => {
    const first = diffShelfExposure(["repeat"], new Set(), new Map(), T0, { countedWeek: "2026-W02" });
    equal(first.exposed[0].exposureCount, 1);
    equal(first.exposed[0].lastCountedWeek, "2026-W02");

    const stored = new Map([["repeat", first.exposed[0]]]);
    const rerun = diffShelfExposure(["repeat"], new Set(), stored, days(1), { countedWeek: "2026-W02" });
    deepStrictEqual(rerun.exposed, [], "a retry writes nothing at all");
    deepStrictEqual(rerun.alreadyCounted, ["repeat"]);

    const nextWeek = diffShelfExposure(["repeat"], new Set(), stored, days(7), { countedWeek: "2026-W03" });
    equal(nextWeek.exposed[0].exposureCount, 2, "a genuinely new week is still a second strike");
    equal(nextWeek.exposed[0].suppressed, true);
  });

  it("reports what it counted, so the caller can extend the ledger", () => {
    const diff = diffShelfExposure(["a", "b", "chosen"], new Set(["chosen"]), new Map(), T0, {
      countedWeek: "2026-W40",
    });
    deepStrictEqual(diff.newlyCounted.sort(), ["a", "b"]);

    const withoutWeek = diffShelfExposure(["a"], new Set(), new Map(), T0);
    deepStrictEqual(withoutWeek.newlyCounted, [], "no week, nothing to write to a per-week ledger");
  });

  it("skips a week the ledger has already counted, even with a cleared record", () => {
    // The record's own marker is gone — a later week's selection cleared the
    // strike and the marker together. The ledger is the only thing that still
    // knows W40 was processed, and it is what stops a re-run from reapplying a
    // strike David already answered by cooking the recipe.
    const cleared = clearExposureOnSelection(
      recordUnselectedExposure(null, "salsify-gratin", T0, "2026-W40"),
      days(7),
    );
    equal(cleared!.lastCountedWeek, null);

    const rerun = diffShelfExposure(
      ["salsify-gratin"],
      new Set(),
      new Map([["salsify-gratin", cleared!]]),
      days(8),
      { countedWeek: "2026-W40", countedRecipeIds: new Set(["salsify-gratin"]) },
    );
    deepStrictEqual(rerun.exposed, [], "the re-run writes nothing");
    deepStrictEqual(rerun.alreadyCounted, ["salsify-gratin"]);

    // `countedRecipeIds` is the ledger *for the week being counted*, so W42
    // starts empty however many weeks W40 has behind it.
    const laterWeek = diffShelfExposure(
      ["salsify-gratin"],
      new Set(),
      new Map([["salsify-gratin", cleared!]]),
      days(21),
      { countedWeek: "2026-W42", countedRecipeIds: new Set<string>() },
    );
    equal(laterWeek.exposed[0]?.exposureCount, 1, "a week the ledger has not counted still counts");
    deepStrictEqual(laterWeek.newlyCounted, ["salsify-gratin"]);
  });

  it("still clears a suppressed recipe on a re-run of the same week", () => {
    const suppressed = recordUnselectedExposure(
      recordUnselectedExposure(null, "beet-risotto", T0, "2026-W01"),
      "beet-risotto",
      days(7),
      "2026-W02",
    );
    const stored = new Map([["beet-risotto", suppressed]]);
    const diff = diffShelfExposure(["beet-risotto"], new Set(["beet-risotto"]), stored, days(8), {
      countedWeek: "2026-W02",
    });
    equal(diff.cleared.length, 1, "choosing it is never skipped as already counted");
    equal(diff.cleared[0].suppressed, false);
    equal(diff.cleared[0].lastCountedWeek, null);
  });
});

describe("suppressedRecipeIds", () => {
  it("collects everything the automatic shelf must not offer", () => {
    const cooling = recordUnselectedExposure(null, "cooling", T0);
    const suppressed = recordUnselectedExposure(
      recordUnselectedExposure(null, "gone", T0),
      "gone",
      days(1),
    );
    const available = resetExposure(null, "fine", T0);
    const ids = suppressedRecipeIds([cooling, suppressed, available], days(2));
    deepStrictEqual([...ids].sort(), ["cooling", "gone"]);
  });
});
