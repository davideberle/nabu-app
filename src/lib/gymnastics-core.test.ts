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
  archivedProgramIds,
  isGymnasticsSessionKey,
  parseProgressUpdate,
  sessionKeysOf,
  summarizeHistory,
  summarizeProgress,
  videosByMovement,
  type GymnasticsArchive,
  type GymnasticsHistoryRow,
  type GymnasticsProgram,
  type GymnasticsProgressRow,
  type GymnasticsSession,
  type GymnasticsSessionKey,
} from "./gymnastics-core.ts";

const PROGRAM: GymnasticsProgram = JSON.parse(
  readFileSync(new URL("../data/gymnastics-program.json", import.meta.url), "utf8"),
);

/** The shipped label sheet for retired blocks. Carries no completions. */
const ARCHIVE: GymnasticsArchive = JSON.parse(
  readFileSync(new URL("../data/gymnastics-archive.json", import.meta.url), "utf8"),
);

/**
 * Blocks this program replaced. Both were completed; progress is keyed by
 * programId in Turso, so a new id is what keeps their completions from marking
 * this block's sessions done.
 */
const RETIRED_PROGRAM_IDS = ["gym-kip-ttb-10wk-v1", "gym-link-two-kip-2wk-v1"];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function session(label: string): GymnasticsSession {
  return { label, goal: `goal ${label}`, blocks: [{ movement: "m", prescription: "1×1" }] };
}

/** A minimal program with an arbitrary week count and slot set. */
function programWith(
  slots: GymnasticsSessionKey[],
  weeks = 3,
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
// Session keys — the A/B slots are read from the program, never hard-coded
// ---------------------------------------------------------------------------

describe("sessionKeysOf", () => {
  it("returns the two slots of the current program", () => {
    deepStrictEqual(sessionKeysOf(PROGRAM), ["A", "B"]);
  });

  it("returns only the slots a program actually declares", () => {
    deepStrictEqual(sessionKeysOf(programWith(["A", "B", "C"])), ["A", "B", "C"]);
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
    // C existed in the retired 3-a-week block; this one has no Session C.
    equal(isGymnasticsSessionKey("C", keys), false);
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
    equal(summary.totalSessions, 6); // 3 weeks × A/B
    equal(summary.completedCount, 0);
    equal(summary.firstIncompleteWeek, 1);
  });

  it("stamps the current programId so retired progress cannot masquerade as current", () => {
    const summary = summarizeProgress(PROGRAM, []);
    equal(summary.programId, PROGRAM.programId);
    for (const retired of RETIRED_PROGRAM_IDS) ok(summary.programId !== retired);
  });

  it("ignores rows outside the current block's weeks and slots", () => {
    // Shape of leftovers from the retired blocks: a Session C slot, and weeks
    // past three from the 10-week block.
    const stale = [row(1, "C"), row(2, "C"), row(5, "A"), row(10, "B")];
    const summary = summarizeProgress(PROGRAM, [...stale, row(1, "A")]);
    equal(summary.completedCount, 1);
    equal(summary.totalSessions, 6);
    equal(summary.firstIncompleteWeek, 1);
  });

  it("does not report the block finished from a fully completed retired block", () => {
    // The 2-week × A/B/C block David completed, replayed against this program.
    const retiredRows = [1, 2].flatMap((w) =>
      (["A", "B", "C"] as GymnasticsSessionKey[]).map((s) => row(w, s)),
    );
    const summary = summarizeProgress(PROGRAM, retiredRows);
    equal(summary.firstIncompleteWeek, 3); // week 3 has no retired rows at all
    ok(summary.completedCount < summary.totalSessions);
  });

  it("counts a completed session and advances only when the week is full", () => {
    const partial = summarizeProgress(PROGRAM, [row(1, "A")]);
    equal(partial.completedCount, 1);
    equal(partial.firstIncompleteWeek, 1);

    const full = summarizeProgress(PROGRAM, [row(1, "A"), row(1, "B")]);
    equal(full.completedCount, 2);
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
// Training history — completed blocks, projected from stored rows only
// ---------------------------------------------------------------------------

describe("summarizeHistory", () => {
  const LINK = "gym-link-two-kip-2wk-v1";
  const TEN_WEEK = "gym-kip-ttb-10wk-v1";
  const CURRENT = "gym-kipping-capacity-3wk-v1";

  /** The shape of the shipped archive: labelled block, then the bare 10-week one. */
  const archive: GymnasticsArchive = {
    blocks: [
      {
        programId: LINK,
        title: "Link Two Kipping Pull-Ups",
        subtitle: "2-week focused kipping block",
        period: "27 July – 3 August 2026",
        outcome: "Linking stopped being the limiter.",
        sessions: [
          { week: 1, session: "A", label: "Find the return" },
          { week: 1, session: "B", label: "Consolidate the pair" },
          { week: 2, session: "C", label: "Quality test" },
        ],
      },
      {
        programId: TEN_WEEK,
        title: "Kipping, Butterfly & Toes-to-Bar",
        subtitle: "10-week gymnastics skill add-on",
        sessions: [],
      },
    ],
  };

  function hrow(
    programId: string,
    week: number,
    s: GymnasticsSessionKey,
    completed = true,
    extra: Partial<GymnasticsHistoryRow> = {},
  ): GymnasticsHistoryRow {
    return {
      programId,
      week,
      session: s,
      completed,
      completedAt: completed ? `2026-07-2${week}T12:00:00.000Z` : null,
      ...extra,
    };
  }

  it("groups completed rows under the block that owns them, in archive order", () => {
    const history = summarizeHistory(
      archive,
      [hrow(LINK, 1, "A"), hrow(LINK, 1, "B"), hrow(LINK, 2, "C")],
      CURRENT,
    );
    equal(history.length, 1);
    equal(history[0].programId, LINK);
    equal(history[0].title, "Link Two Kipping Pull-Ups");
    equal(history[0].completedCount, 3);
    deepStrictEqual(
      history[0].entries.map((e) => `${e.week}${e.session}`),
      ["1A", "1B", "2C"],
    );
  });

  // The production symptom this whole change exists to avoid: a single
  // untouched legacy row must never render as a training block that happened.
  it("drops the old unchecked 10-week row entirely", () => {
    const history = summarizeHistory(archive, [hrow(TEN_WEEK, 1, "A", false)], CURRENT);
    deepStrictEqual(history, []);
  });

  it("keeps the unchecked legacy row out even when another block has history", () => {
    const history = summarizeHistory(
      archive,
      [hrow(TEN_WEEK, 1, "A", false), hrow(LINK, 1, "A")],
      CURRENT,
    );
    equal(history.length, 1);
    equal(history[0].programId, LINK);
    ok(!history.some((b) => b.programId === TEN_WEEK));
  });

  it("shows the 10-week block only if a row of it was actually completed", () => {
    const history = summarizeHistory(archive, [hrow(TEN_WEEK, 3, "A")], CURRENT);
    equal(history.length, 1);
    equal(history[0].programId, TEN_WEEK);
    // No labelled slot for it, so the entry falls back to a plain description.
    equal(history[0].entries[0].label, "Week 3 · Session A");
  });

  it("never treats the current block as history, however complete it is", () => {
    const rows = [1, 2, 3].flatMap((w) =>
      (["A", "B"] as GymnasticsSessionKey[]).map((s) => hrow(CURRENT, w, s)),
    );
    deepStrictEqual(summarizeHistory(archive, rows, CURRENT), []);
  });

  it("drops rows from a program the archive cannot honestly title", () => {
    deepStrictEqual(summarizeHistory(archive, [hrow("gym-unknown-v9", 1, "A")], CURRENT), []);
  });

  it("carries the stored timestamp and note through untouched", () => {
    const [block] = summarizeHistory(
      archive,
      [
        hrow(LINK, 1, "A", true, {
          completedAt: "2026-07-27T12:00:00.000Z",
          note: "4×5 beat swings, four bridge rounds.",
        }),
      ],
      CURRENT,
    );
    equal(block.entries[0].completedAt, "2026-07-27T12:00:00.000Z");
    equal(block.entries[0].note, "4×5 beat swings, four bridge rounds.");
    equal(block.entries[0].label, "Find the return");
    equal(block.period, "27 July – 3 August 2026");
  });

  it("omits a note key entirely when the row has none", () => {
    const [block] = summarizeHistory(archive, [hrow(LINK, 1, "A")], CURRENT);
    equal("note" in block.entries[0], false);
  });

  it("sorts entries by week then slot regardless of row order", () => {
    const history = summarizeHistory(
      archive,
      [hrow(LINK, 2, "C"), hrow(LINK, 1, "B"), hrow(LINK, 1, "A")],
      CURRENT,
    );
    deepStrictEqual(
      history[0].entries.map((e) => `${e.week}${e.session}`),
      ["1A", "1B", "2C"],
    );
  });
});

describe("archivedProgramIds", () => {
  it("lists every archived block, most recent first, as the page renders them", () => {
    deepStrictEqual(archivedProgramIds(ARCHIVE, PROGRAM.programId), [
      "gym-link-two-kip-2wk-v1",
      "gym-kip-ttb-10wk-v1",
    ]);
  });

  it("excludes the current program even if the archive names it", () => {
    const ids = archivedProgramIds(
      { blocks: [{ programId: "x", title: "t", subtitle: "s", sessions: [] }, ...ARCHIVE.blocks] },
      "x",
    );
    equal(ids.includes("x"), false);
    equal(ids.length, ARCHIVE.blocks.length);
  });
});

// The shipped archive is the label sheet the history read depends on, so its
// contract with the live program and the retired ids is pinned here too.
describe("live archive", () => {
  it("describes both retired blocks and never the current one", () => {
    deepStrictEqual(
      ARCHIVE.blocks.map((b) => b.programId).slice().sort(),
      RETIRED_PROGRAM_IDS.slice().sort(),
    );
    ok(!ARCHIVE.blocks.some((b) => b.programId === PROGRAM.programId));
  });

  it("labels all six sessions of the completed focused block", () => {
    const link = ARCHIVE.blocks.find((b) => b.programId === "gym-link-two-kip-2wk-v1");
    ok(link);
    equal(link.sessions.length, 6);
    deepStrictEqual(
      link.sessions.map((s) => `${s.week}${s.session}`),
      ["1A", "1B", "1C", "2A", "2B", "2C"],
    );
  });

  it("records no completion of its own — that only lives in Turso", () => {
    for (const block of ARCHIVE.blocks) {
      for (const s of block.sessions) {
        equal("completed" in s, false);
        equal("completedAt" in s, false);
      }
    }
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
  const valid = { week: 1, session: "B", completed: true };

  it("accepts a well-formed toggle", () => {
    const result = parseProgressUpdate(valid, PROGRAM);
    ok(result.ok);
    deepStrictEqual(result.value, { week: 1, session: "B", completed: true });
  });

  it("accepts uncompleting", () => {
    const result = parseProgressUpdate({ ...valid, completed: false }, PROGRAM);
    ok(result.ok);
    equal(result.value.completed, false);
  });

  it("passes a string note through and drops a non-string one", () => {
    const withNote = parseProgressUpdate({ ...valid, note: "6 / 6 clean sets" }, PROGRAM);
    ok(withNote.ok);
    equal(withNote.value.note, "6 / 6 clean sets");

    const badNote = parseProgressUpdate({ ...valid, note: 42 }, PROGRAM);
    ok(badNote.ok);
    equal("note" in badNote.value, false);
  });

  it("accepts every week of this block and nothing beyond it", () => {
    for (const week of [1, 2, 3]) {
      ok(parseProgressUpdate({ ...valid, week }, PROGRAM).ok, `week ${week}`);
    }
    for (const week of [0, 4, 10, -1, 1.5, "1", null, undefined, NaN]) {
      const result = parseProgressUpdate({ ...valid, week }, PROGRAM);
      equal(result.ok, false);
      if (!result.ok) equal(result.error, "week must be an integer 1-3");
    }
  });

  it("accepts only the A/B slots this block declares", () => {
    for (const s of ["A", "B"]) {
      ok(parseProgressUpdate({ ...valid, session: s }, PROGRAM).ok, `session ${s}`);
    }
    // C came from the retired 3-a-week block and must not be writable now.
    for (const s of ["C", "D", "a", ""]) {
      const result = parseProgressUpdate({ ...valid, session: s }, PROGRAM);
      equal(result.ok, false);
      if (!result.ok) equal(result.error, "session must be one of A, B");
    }
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
    const shorter = programWith(["A"], 1);
    const week2 = parseProgressUpdate({ ...valid, week: 2, session: "A" }, shorter);
    equal(week2.ok, false);
    if (!week2.ok) equal(week2.error, "week must be an integer 1-1");

    const slotB = parseProgressUpdate({ ...valid, session: "B" }, shorter);
    equal(slotB.ok, false);
    if (!slotB.ok) equal(slotB.error, "session must be one of A");
  });
});

// ---------------------------------------------------------------------------
// The live block — the content contract the UI and Turso key off
// ---------------------------------------------------------------------------

describe("live program", () => {
  it("is a new program id, so completed retired progress stays hidden", () => {
    ok(PROGRAM.programId.length > 0);
    for (const retired of RETIRED_PROGRAM_IDS) ok(PROGRAM.programId !== retired, retired);
  });

  it("is 3 weeks × A/B = 6 sessions, consistently declared", () => {
    equal(PROGRAM.durationWeeks, 3);
    equal(PROGRAM.weeks.length, 3);
    equal(PROGRAM.sessionsPerWeek, 2);
    equal(PROGRAM.totalSessions, 6);
    equal(PROGRAM.totalSessions, PROGRAM.weeks.length * sessionKeysOf(PROGRAM).length);
    deepStrictEqual(
      PROGRAM.weeks.map((w) => w.week),
      [1, 2, 3],
    );
  });

  // The exact progression the Health Dashboard domain owns. The app renders it;
  // it does not get to drift from it.
  const PLAN = [
    { week: 1, session: "A", label: /repeat fours/i, prescription: "6×4", rest: /60[–-]75 seconds/, total: "24 full reps" },
    { week: 1, session: "B", label: /rhythm on the clock/i, prescription: "EMOM 8×3", total: "24 full reps" },
    { week: 2, session: "A", label: /introduce fives/i, prescription: "6×5", rest: /75[–-]90 seconds/, total: "30 full reps" },
    { week: 2, session: "B", label: /densify fours/i, prescription: "EMOM 8×4", total: "32 full reps" },
    { week: 3, session: "A", label: /accumulate fives/i, prescription: "8×5", rest: /60[–-]90 seconds/, total: "40 full reps" },
    { week: 3, session: "B", label: /fifty[- ]rep benchmark/i, prescription: "10×5 on a 90-second clock", total: "50 full reps" },
  ] as const;

  const sessionOf = (week: number, key: string) =>
    PROGRAM.weeks.find((w) => w.week === week)!.sessions[key as GymnasticsSessionKey];

  const textOf = (s: GymnasticsSession) =>
    [
      s.label,
      s.goal ?? "",
      ...s.blocks.map((b) => `${b.movement} ${b.prescription} ${b.note ?? ""}`),
      ...(s.notes ?? []),
    ].join(" ");

  for (const step of PLAN) {
    it(`week ${step.week} session ${step.session} prescribes ${step.prescription} for ${step.total}`, () => {
      const s = sessionOf(step.week, step.session);
      ok(s, `week ${step.week} session ${step.session} missing`);
      ok(step.label.test(s.label), `label "${s.label}" does not match ${step.label}`);
      ok(
        s.blocks.some((b) => b.prescription === step.prescription),
        `no block prescribes exactly "${step.prescription}"`,
      );
      ok(textOf(s).includes(step.total), `session total "${step.total}" missing`);
      if ("rest" in step && step.rest) {
        ok(step.rest.test(textOf(s)), `rest interval ${step.rest} missing`);
      }
    });
  }

  it("offers 7×4 when the fifth rep has to be forced", () => {
    const w2a = textOf(sessionOf(2, "A"));
    ok(/7×4/.test(w2a), "7×4 fallback missing");
    ok(/repeatedly needs extra pulling/i.test(w2a), "fallback trigger missing");
  });

  it("gates the fifty-rep benchmark on a clean week 3 session A", () => {
    const notes = (sessionOf(3, "B").notes ?? []).join(" ");
    ok(/only after week 3 session A is clean/i.test(notes), "benchmark gate missing");
    ok(/shoulders, elbows, grip, and hands/i.test(notes), "readiness check missing");
  });

  it("opens the block with 48 hours clear of dynamic pulling", () => {
    ok(/48 hours/.test(PROGRAM.spacingNote), "48h entry condition missing from spacingNote");
    ok(/48[–-]72 hours/.test(PROGRAM.spacingNote), "48–72h session spacing missing");
    equal(PROGRAM.spacingHours.min, 48);
    equal(PROGRAM.spacingHours.max, 72);
    ok(/48 hours/.test((sessionOf(1, "A").notes ?? []).join(" ")), "session 1 entry note missing");
  });

  it("runs the same warm-up in every session", () => {
    deepStrictEqual(PROGRAM.warmup.items, [
      "2×6 scap pull-ups",
      "2×5 controlled beat swings",
      "1 easy set of 3 linked kipping pull-ups",
    ]);
  });

  // Mirrors scripts/validate-gymnastics.mjs. Deliberately narrow: a bare
  // "link" only says reps were joined, so it does not satisfy the push-away /
  // descent / arch / backswing invariant on its own.
  const PRIMARY_SKILL = /push[- ]?away|\bdescent\b|\barch(?:ed|ing)?\b|\bbackswing\b/i;

  it("does not accept a bare 'link' as training the push-away", () => {
    equal(PRIMARY_SKILL.test("linked pull-ups, 3 sets of 5 links"), false);
  });

  it("holds the push-away in every session and adds no butterfly or chest-to-bar volume", () => {
    for (const week of PROGRAM.weeks) {
      for (const key of sessionKeysOf(PROGRAM)) {
        const text = textOf(week.sessions[key]);
        ok(
          PRIMARY_SKILL.test(text),
          `week ${week.week} session ${key} does not train the push-away`,
        );
        ok(
          !/butterfly|chest[- ]to[- ]bar/i.test(text),
          `week ${week.week} session ${key} contains excluded volume`,
        );
      }
    }
  });

  it("states the spacing, stop, regression, and exclusion rules the UI renders", () => {
    const rules = PROGRAM.sessionRules.items.join(" ");
    ok(/30 or more pulling reps/i.test(rules), "30+ pulling reps skip rule missing");
    ok(/push[- ]?away/i.test(rules) && /arm[- ]dominant/i.test(rules), "stop-the-set rule missing");
    ok(/two rhythm failures/i.test(rules), "move-back-one-step rule missing");
    ok(/butterfly/i.test(rules) && /chest[- ]to[- ]bar/i.test(rules), "exclusion missing");
    ok(/repeat a session/i.test(PROGRAM.progressionRule), "repeat-until-clean rule missing");
  });

  it("lists the four signals that end a set", () => {
    const stop = PROGRAM.prerequisites.stopRules.join(" ");
    ok(/push[- ]?away/i.test(stop), "push-away disappearing missing");
    ok(/arm[- ]dominant/i.test(stop), "arm-dominant kip missing");
    ok(/pain/i.test(stop), "pain missing");
    ok(/hot spot/i.test(stop), "hand hot spot missing");
    equal(PROGRAM.prerequisites.repCaps.perSession, 50);
  });

  it("scales the 50-pull-up WOD that arrives before the benchmark is earned", () => {
    const wod = [PROGRAM.wodScaling.title, PROGRAM.wodScaling.intro, ...PROGRAM.wodScaling.points].join(" ");
    ok(/\b50\b/.test(wod), "the 50-rep WOD is not named");
    ok(/from rep one/i.test(wod), "break-from-rep-one guidance missing");
    ok(/sets of three/i.test(wod), "sets of three for the unassisted portion missing");
    ok(/coach/i.test(wod), "coach-led volume/movement scaling missing");
    ok(/time domain/i.test(wod), "intended time domain missing");
  });

  it("holds chest-to-bar and butterfly behind explicit gates", () => {
    const c2b = PROGRAM.gates.items.find((g) => /chest[- ]to[- ]bar/i.test(g.skill));
    ok(c2b, "chest-to-bar gate missing");
    ok(/sets of five/i.test(c2b.requirement), "sets of five requirement missing");
    ok(/8[–-]10/.test(c2b.requirement), "8–10 clean kipping reps requirement missing");
    ok(/hard final pull/i.test(c2b.requirement), "no-hard-final-pull requirement missing");

    const butterfly = PROGRAM.gates.items.find((g) => /butterfly/i.test(g.skill));
    ok(butterfly, "butterfly gate missing");
    ok(/15[–-]20/.test(butterfly.requirement), "15–20 unbroken reps requirement missing");
    ok(/coach/i.test(butterfly.requirement), "coach observation requirement missing");
  });

  it("asks for clean sets, where the push-away went, and pain or hot spots", () => {
    const prompt = PROGRAM.feedbackPrompt.items.join(" ");
    ok(/sets? *\/ *sets/i.test(prompt), "clean sets / sets prescribed missing");
    ok(/push[- ]?away/i.test(prompt), "where the push-away went missing");
    ok(/pain/i.test(prompt) && /hot spots?/i.test(prompt), "pain / hand hot spots missing");
  });

  it("has no butterfly or chest-to-bar video groups", () => {
    for (const g of PROGRAM.videoGroups) {
      ok(!/butterfly|chest[- ]to[- ]bar/i.test(`${g.movement} ${g.label}`), g.label);
    }
    ok(PROGRAM.videos.length > 0);
  });

  it("carries no stale copy calling pair acquisition the current limiter", () => {
    const narrative = [
      PROGRAM.title,
      PROGRAM.subtitle,
      PROGRAM.summary,
      PROGRAM.primarySkill.cue,
      PROGRAM.primarySkill.failureSignal,
      PROGRAM.progressionRule,
      ...PROGRAM.prerequisites.mustHave,
    ].join(" ");
    ok(!/link(ing)? (two|a pair)|linked pair|pair attempts/i.test(narrative));
  });
});
