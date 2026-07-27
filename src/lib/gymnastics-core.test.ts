// Unit tests for the pure gymnastics program projections and API validation.
// Run with: npm test  (node --test; Node 24 strips types natively)
//
// These exercise `gymnastics-core.ts` directly — it carries no `@/` imports on
// purpose, so the test runner needs no path-alias resolution. The real program
// JSON is read from disk so the helpers are also pinned against live content.

import { readFileSync } from "node:fs";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GYMNASTICS_SLOT_ORDER,
  isGymnasticsSessionKey,
  parseProgressUpdate,
  sessionKeysOf,
  summarizeProgress,
  videosByMovement,
  type GymnasticsProgram,
  type GymnasticsProgressRow,
  type GymnasticsSession,
  type GymnasticsSessionKey,
} from "./gymnastics-core.ts";

const PROGRAM: GymnasticsProgram = JSON.parse(
  readFileSync(new URL("../data/gymnastics-program.json", import.meta.url), "utf8"),
);

/** The 10-week A/B block this program replaced. Progress must not carry over. */
const RETIRED_PROGRAM_ID = "gym-kip-ttb-10wk-v1";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function session(label: string): GymnasticsSession {
  return { label, goal: `goal ${label}`, blocks: [{ movement: "m", prescription: "1×1" }] };
}

/** A minimal program with an arbitrary week count and slot set. */
function programWith(
  slots: GymnasticsSessionKey[],
  weeks = 2,
  overrides: Partial<GymnasticsProgram> = {},
): GymnasticsProgram {
  const sessions = Object.fromEntries(
    slots.map((s) => [s, session(s)]),
  ) as GymnasticsProgram["weeks"][number]["sessions"];

  return {
    ...PROGRAM,
    programId: "test-program",
    durationWeeks: weeks,
    sessionsPerWeek: slots.length,
    totalSessions: weeks * slots.length,
    weeks: Array.from({ length: weeks }, (_, i) => ({
      week: i + 1,
      phase: `phase ${i + 1}`,
      focus: `focus ${i + 1}`,
      sessions,
    })),
    ...overrides,
  };
}

function row(
  week: number,
  s: GymnasticsSessionKey,
  completed = true,
): GymnasticsProgressRow {
  return { week, session: s, completed, completedAt: completed ? "2026-07-27T10:00:00Z" : null };
}

// ---------------------------------------------------------------------------
// Session keys — the A/B/C slots are read from the program, never hard-coded
// ---------------------------------------------------------------------------

describe("sessionKeysOf", () => {
  it("returns the three slots of the current program", () => {
    deepStrictEqual(sessionKeysOf(PROGRAM), ["A", "B", "C"]);
  });

  it("returns only the slots a program actually declares", () => {
    deepStrictEqual(sessionKeysOf(programWith(["A", "B"])), ["A", "B"]);
    deepStrictEqual(sessionKeysOf(programWith(["A"])), ["A"]);
  });

  it("keeps display order regardless of key order in the JSON", () => {
    const scrambled = programWith(["C", "A", "B"]);
    deepStrictEqual(sessionKeysOf(scrambled), GYMNASTICS_SLOT_ORDER);
  });

  it("skips a gap in the middle of the slot order", () => {
    deepStrictEqual(sessionKeysOf(programWith(["A", "C"])), ["A", "C"]);
  });

  it("returns nothing for a program with no weeks", () => {
    deepStrictEqual(sessionKeysOf({ ...PROGRAM, weeks: [] }), []);
  });
});

describe("isGymnasticsSessionKey", () => {
  const keys = sessionKeysOf(PROGRAM);

  it("accepts every slot the program declares", () => {
    for (const k of keys) ok(isGymnasticsSessionKey(k, keys));
  });

  it("rejects a slot the program does not declare", () => {
    equal(isGymnasticsSessionKey("D", keys), false);
    equal(isGymnasticsSessionKey("C", ["A", "B"]), false);
  });

  it("rejects non-string and look-alike values", () => {
    for (const v of ["a", "", " A", 0, null, undefined, ["A"], { session: "A" }]) {
      equal(isGymnasticsSessionKey(v, keys), false);
    }
  });
});

// ---------------------------------------------------------------------------
// Progress summary
// ---------------------------------------------------------------------------

describe("summarizeProgress", () => {
  it("sizes the block from the program, not from stored rows", () => {
    const summary = summarizeProgress(PROGRAM, []);
    equal(summary.totalSessions, 6); // 2 weeks × A/B/C
    equal(summary.completedCount, 0);
    equal(summary.firstIncompleteWeek, 1);
  });

  it("stamps the current programId so old progress cannot masquerade as current", () => {
    const summary = summarizeProgress(PROGRAM, []);
    equal(summary.programId, PROGRAM.programId);
    ok(summary.programId !== RETIRED_PROGRAM_ID);
  });

  it("ignores rows outside the current block's weeks and slots", () => {
    // Shape of leftovers from the retired 10-week A/B program.
    const stale = [row(5, "A"), row(9, "B"), row(10, "A")];
    const summary = summarizeProgress(PROGRAM, [...stale, row(1, "A")]);
    equal(summary.completedCount, 1);
    equal(summary.totalSessions, 6);
    equal(summary.firstIncompleteWeek, 1);
  });

  it("counts a completed session and advances only when the week is full", () => {
    const week1 = [row(1, "A"), row(1, "B")];
    equal(summarizeProgress(PROGRAM, week1).firstIncompleteWeek, 1);

    const full = summarizeProgress(PROGRAM, [...week1, row(1, "C")]);
    equal(full.completedCount, 3);
    equal(full.firstIncompleteWeek, 2);
  });

  it("reports completion past the last week when every session is done", () => {
    const all = PROGRAM.weeks.flatMap((w) =>
      sessionKeysOf(PROGRAM).map((s) => row(w.week, s)),
    );
    const summary = summarizeProgress(PROGRAM, all);
    equal(summary.completedCount, 6);
    equal(summary.firstIncompleteWeek, PROGRAM.durationWeeks + 1);
  });

  it("treats an explicitly uncompleted row as incomplete", () => {
    const summary = summarizeProgress(PROGRAM, [row(1, "A", false)]);
    equal(summary.completedCount, 0);
    equal(summary.byWeek[1]?.A?.completed, false);
  });

  it("indexes rows by week and slot", () => {
    const summary = summarizeProgress(PROGRAM, [row(2, "B")]);
    equal(summary.byWeek[2]?.B?.completedAt, "2026-07-27T10:00:00Z");
    equal(summary.byWeek[2]?.A, undefined);
  });

  it("follows a program with a different shape without code changes", () => {
    const summary = summarizeProgress(programWith(["A", "B"], 4), [row(1, "A")]);
    equal(summary.totalSessions, 8);
    equal(summary.completedCount, 1);
    equal(summary.firstIncompleteWeek, 1);
  });
});

// ---------------------------------------------------------------------------
// Video grouping
// ---------------------------------------------------------------------------

describe("videosByMovement", () => {
  it("groups the real program's videos in declared order", () => {
    const groups = videosByMovement(PROGRAM);
    deepStrictEqual(
      groups.map((g) => g.movement),
      PROGRAM.videoGroups.map((g) => g.movement),
    );
    ok(groups.every((g) => g.videos.length > 0));
    equal(
      groups.reduce((n, g) => n + g.videos.length, 0),
      PROGRAM.videos.length,
    );
  });

  it("carries the group label and keeps source video order", () => {
    const [first] = videosByMovement(PROGRAM);
    equal(first.label, PROGRAM.videoGroups[0].label);
    deepStrictEqual(
      first.videos.map((v) => v.id),
      PROGRAM.videos.filter((v) => v.movement === first.movement).map((v) => v.id),
    );
  });

  it("drops declared groups that have no videos", () => {
    const withEmpty = {
      ...PROGRAM,
      videoGroups: [...PROGRAM.videoGroups, { movement: "ghost", label: "Ghost" }],
    };
    ok(!videosByMovement(withEmpty).some((g) => g.movement === "ghost"));
  });

  it("omits videos whose movement has no declared group", () => {
    const orphan = { ...PROGRAM.videos[0], id: "orphan", movement: "unlisted" };
    const groups = videosByMovement({ ...PROGRAM, videos: [...PROGRAM.videos, orphan] });
    ok(!groups.flatMap((g) => g.videos).some((v) => v.id === "orphan"));
  });
});

// ---------------------------------------------------------------------------
// API payload validation
// ---------------------------------------------------------------------------

describe("parseProgressUpdate", () => {
  const valid = { week: 1, session: "C", completed: true };

  it("accepts a well-formed toggle", () => {
    const result = parseProgressUpdate(valid, PROGRAM);
    ok(result.ok);
    deepStrictEqual(result.value, { week: 1, session: "C", completed: true });
  });

  it("accepts uncompleting", () => {
    const result = parseProgressUpdate({ ...valid, completed: false }, PROGRAM);
    ok(result.ok);
    equal(result.value.completed, false);
  });

  it("passes a string note through and drops a non-string one", () => {
    const withNote = parseProgressUpdate({ ...valid, note: "4 / 7 clean pairs" }, PROGRAM);
    ok(withNote.ok);
    equal(withNote.value.note, "4 / 7 clean pairs");

    const badNote = parseProgressUpdate({ ...valid, note: 42 }, PROGRAM);
    ok(badNote.ok);
    equal("note" in badNote.value, false);
  });

  it("bounds the week by the program's duration", () => {
    for (const week of [0, 3, -1, 1.5, "1", null, undefined, NaN]) {
      const result = parseProgressUpdate({ ...valid, week }, PROGRAM);
      equal(result.ok, false);
      if (!result.ok) equal(result.error, "week must be an integer 1-2");
    }
    ok(parseProgressUpdate({ ...valid, week: 2 }, PROGRAM).ok);
  });

  it("rejects a session slot the program does not declare", () => {
    const result = parseProgressUpdate({ ...valid, session: "D" }, PROGRAM);
    equal(result.ok, false);
    if (!result.ok) equal(result.error, "session must be one of A, B, C");
  });

  it("requires a boolean completed", () => {
    for (const completed of ["true", 1, null, undefined]) {
      const result = parseProgressUpdate({ ...valid, completed }, PROGRAM);
      equal(result.ok, false);
      if (!result.ok) equal(result.error, "completed (boolean) required");
    }
  });

  it("rejects non-object bodies", () => {
    for (const body of [null, undefined, "week=1", 7, [valid]]) {
      const result = parseProgressUpdate(body, PROGRAM);
      equal(result.ok, false);
      if (!result.ok) equal(result.error, "body must be a JSON object");
    }
  });

  it("derives its limits from the program it is given", () => {
    const shorter = programWith(["A", "B"], 1);
    const week2 = parseProgressUpdate({ ...valid, week: 2, session: "A" }, shorter);
    equal(week2.ok, false);
    if (!week2.ok) equal(week2.error, "week must be an integer 1-1");

    const slotC = parseProgressUpdate({ ...valid, session: "C" }, shorter);
    equal(slotC.ok, false);
    if (!slotC.ok) equal(slotC.error, "session must be one of A, B");
  });
});

// ---------------------------------------------------------------------------
// The live block — the content contract the UI and Turso key off
// ---------------------------------------------------------------------------

describe("live program", () => {
  it("is a new program id, so retired 10-week progress stays hidden", () => {
    ok(PROGRAM.programId.length > 0);
    ok(PROGRAM.programId !== RETIRED_PROGRAM_ID);
  });

  it("is 2 weeks × A/B/C = 6 sessions, consistently declared", () => {
    equal(PROGRAM.durationWeeks, 2);
    equal(PROGRAM.weeks.length, 2);
    equal(PROGRAM.sessionsPerWeek, 3);
    equal(PROGRAM.totalSessions, 6);
    equal(PROGRAM.totalSessions, PROGRAM.weeks.length * sessionKeysOf(PROGRAM).length);
  });

  // Mirrors scripts/validate-gymnastics.mjs. Deliberately narrow: a bare
  // "link" only says two reps were joined, so it does not satisfy the
  // push-away / descent / arch / backswing invariant on its own.
  const PRIMARY_SKILL = /push[- ]?away|\bdescent\b|\barch(?:ed|ing)?\b|\bbackswing\b/i;

  it("does not accept a bare 'link' as training the push-away", () => {
    equal(PRIMARY_SKILL.test("linked pull-ups, 3 sets of 2 links"), false);
  });

  it("trains the push-away back to the arch in every session", () => {
    for (const week of PROGRAM.weeks) {
      for (const key of sessionKeysOf(PROGRAM)) {
        const s = week.sessions[key];
        const text = [
          s.goal ?? "",
          ...s.blocks.map((b) => `${b.movement} ${b.note ?? ""}`),
          ...(s.notes ?? []),
        ].join(" ");
        ok(
          PRIMARY_SKILL.test(text),
          `week ${week.week} session ${key} does not train the push-away`,
        );
        ok(
          !/butterfly|toes[- ]to[- ]bar/i.test(text),
          `week ${week.week} session ${key} contains retired volume`,
        );
      }
    }
  });

  it("places week 1 session A after the bench + box-jump WOD with a fatigue fallback", () => {
    const notes = (PROGRAM.weeks.find((w) => w.week === 1)?.sessions.A.notes ?? []).join(" ");
    ok(/bench/i.test(notes) && /box[- ]jump/i.test(notes), "missing WOD placement");
    ok(/shoulders?, grip,? and timing|crisp/i.test(notes), "missing readiness condition");
    ok(/fallback|fatigue|cooked|tired/i.test(notes), "missing conservative fatigue fallback");
  });

  it("surfaces the rep cap, rest, and stop rule the UI renders", () => {
    equal(PROGRAM.prerequisites.repCaps.perSession, 20);
    const rules = PROGRAM.sessionRules.items.join(" ");
    ok(/\b20\b/.test(rules), "20-rep dynamic cap missing");
    ok(/60[–-]90/.test(rules), "60–90s rest missing");
    ok(/two consecutive/i.test(rules), "two-consecutive-miss stop rule missing");
    ok(/butterfly/i.test(rules) && /toes[- ]to[- ]bar/i.test(rules), "exclusion missing");
  });

  it("asks for pairs/attempts, where the rhythm failed, and pain or hot spots", () => {
    const prompt = PROGRAM.feedbackPrompt.items.join(" ");
    ok(/pairs? *\/ *attempts/i.test(prompt), "clean pairs / attempts missing");
    ok(/top.*descent.*backswing/i.test(prompt), "rhythm failure point missing");
    ok(/pain/i.test(prompt) && /hot spots?/i.test(prompt), "pain / hand hot spots missing");
  });

  it("has no butterfly or toes-to-bar video groups", () => {
    for (const g of PROGRAM.videoGroups) {
      ok(!/butterfly|toes[- ]to[- ]bar/i.test(`${g.movement} ${g.label}`), g.label);
    }
  });
});
