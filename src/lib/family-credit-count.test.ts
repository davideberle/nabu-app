import { equal } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completionCreditCount,
  routineProgress,
  weekPoints,
  weekSummary,
  type CompletionRecord,
} from "../data/family-routines.ts";

const kumon: CompletionRecord = {
  personId: "isabel",
  routineId: "i-kumon",
  day: 6,
  status: "done",
  creditCount: 4,
};

describe("completion credit counts", () => {
  it("counts multiple completed sheets as separate points and progress", () => {
    equal(completionCreditCount(kumon), 4);
    equal(weekPoints("isabel", [kumon]), 4);
    equal(routineProgress("isabel", "i-kumon", [kumon]).done, 4);
    equal(weekSummary("isabel", [kumon]).done, 4);
  });

  it("keeps legacy and malformed rows at one unit", () => {
    equal(completionCreditCount({ ...kumon, creditCount: undefined }), 1);
    equal(completionCreditCount({ ...kumon, creditCount: 0 }), 1);
    equal(completionCreditCount({ ...kumon, creditCount: 99 }), 1);
  });
});
