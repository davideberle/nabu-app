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
  composeSessionFeedbackNote,
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
 * Blocks this program replaced. Progress is keyed by programId in Turso, so a
 * new id is what keeps their completions from marking this block's sessions
 * done.
 */
const RETIRED_PROGRAM_IDS = [
  "gym-kip-ttb-10wk-v1",
  "gym-link-two-kip-2wk-v1",
  "gym-kipping-capacity-3wk-v1",
];

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
  it("returns the single weekly slot of the current program", () => {
    deepStrictEqual(sessionKeysOf(PROGRAM), ["A"]);
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
    // B and C existed in retired blocks; this one runs a single weekly session.
    equal(isGymnasticsSessionKey("B", keys), false);
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
    equal(summary.totalSessions, 8); // 8 weeks × A
    equal(summary.completedCount, 0);
    equal(summary.firstIncompleteWeek, 1);
  });

  it("stamps the current programId so retired progress cannot masquerade as current", () => {
    const summary = summarizeProgress(PROGRAM, []);
    equal(summary.programId, PROGRAM.programId);
    for (const retired of RETIRED_PROGRAM_IDS) ok(summary.programId !== retired);
  });

  it("ignores rows outside the current block's weeks and slots", () => {
    // Shape of leftovers from the retired blocks: B and C slots, and weeks
    // past eight from the 10-week block.
    const stale = [row(1, "C"), row(2, "B"), row(9, "A"), row(10, "B")];
    const summary = summarizeProgress(PROGRAM, [...stale, row(1, "A")]);
    equal(summary.completedCount, 1);
    equal(summary.totalSessions, 8);
    equal(summary.firstIncompleteWeek, 2);
  });

  it("does not report the block finished from a fully completed retired block", () => {
    // The 3-week × A/B capacity block David completed, replayed against this
    // program: its A rows overlap weeks 1-3, its B rows hit no slot at all.
    const retiredRows = [1, 2, 3].flatMap((w) =>
      (["A", "B"] as GymnasticsSessionKey[]).map((s) => row(w, s)),
    );
    const summary = summarizeProgress(PROGRAM, retiredRows);
    equal(summary.firstIncompleteWeek, 4); // week 4 has no retired rows at all
    ok(summary.completedCount < summary.totalSessions);
  });

  it("counts a completed session and advances only past completed weeks", () => {
    const partial = summarizeProgress(PROGRAM, [row(2, "A")]);
    equal(partial.completedCount, 1);
    equal(partial.firstIncompleteWeek, 1);

    const full = summarizeProgress(PROGRAM, [row(1, "A"), row(2, "A")]);
    equal(full.completedCount, 2);
    equal(full.firstIncompleteWeek, 3);
  });

  it("reports completion past the last week when every session is done", () => {
    const all = PROGRAM.weeks.flatMap((w) =>
      sessionKeysOf(PROGRAM).map((s) => row(w.week, s)),
    );
    const summary = summarizeProgress(PROGRAM, all);
    equal(summary.completedCount, 8);
    equal(summary.firstIncompleteWeek, PROGRAM.durationWeeks + 1);
  });

  it("treats an explicitly uncompleted row as incomplete", () => {
    const summary = summarizeProgress(PROGRAM, [row(1, "A", false)]);
    equal(summary.completedCount, 0);
    equal(summary.byWeek[1]?.A?.completed, false);
  });

  it("indexes rows by week and slot", () => {
    const summary = summarizeProgress(PROGRAM, [row(2, "A")]);
    equal(summary.byWeek[2]?.A?.completedAt, "2026-07-27T10:00:00Z");
    equal(summary.byWeek[3]?.A, undefined);
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
      "gym-kipping-capacity-3wk-v1",
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
  it("describes all three retired blocks and never the current one", () => {
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

  it("labels all six sessions of the retired kipping-capacity block", () => {
    const capacity = ARCHIVE.blocks.find(
      (b) => b.programId === "gym-kipping-capacity-3wk-v1",
    );
    ok(capacity);
    equal(capacity.sessions.length, 6);
    deepStrictEqual(
      capacity.sessions.map((s) => `${s.week}${s.session}`),
      ["1A", "1B", "2A", "2B", "3A", "3B"],
    );
    // The labels only title what Turso rows may later show; W3 A has no
    // completed row, so labelling it here never makes it read as trained.
    ok(capacity.sessions.every((s) => s.label.length > 0));
    ok(capacity.period?.includes("August 2026"));
    ok(/50-rep WOD application/.test(capacity.outcome ?? ""));
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
  const valid = { week: 1, session: "A", completed: true };

  it("accepts a well-formed toggle", () => {
    const result = parseProgressUpdate(valid, PROGRAM);
    ok(result.ok);
    deepStrictEqual(result.value, { week: 1, session: "A", completed: true });
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
    for (const week of [1, 2, 3, 4, 5, 6, 7, 8]) {
      ok(parseProgressUpdate({ ...valid, week }, PROGRAM).ok, `week ${week}`);
    }
    for (const week of [0, 9, 10, -1, 1.5, "1", null, undefined, NaN]) {
      const result = parseProgressUpdate({ ...valid, week }, PROGRAM);
      equal(result.ok, false);
      if (!result.ok) equal(result.error, "week must be an integer 1-8");
    }
  });

  it("accepts only the single A slot this block declares", () => {
    ok(parseProgressUpdate({ ...valid, session: "A" }, PROGRAM).ok);
    // B and C came from retired blocks and must not be writable now.
    for (const s of ["B", "C", "D", "a", ""]) {
      const result = parseProgressUpdate({ ...valid, session: s }, PROGRAM);
      equal(result.ok, false);
      if (!result.ok) equal(result.error, "session must be one of A");
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
    equal(PROGRAM.programId, "gym-ttb-mayhem-scaled-8wk-v1");
    for (const retired of RETIRED_PROGRAM_IDS) ok(PROGRAM.programId !== retired, retired);
  });

  it("is 8 weeks × one weekly session, consistently declared", () => {
    equal(PROGRAM.durationWeeks, 8);
    equal(PROGRAM.weeks.length, 8);
    equal(PROGRAM.sessionsPerWeek, 1);
    equal(PROGRAM.totalSessions, 8);
    equal(PROGRAM.totalSessions, PROGRAM.weeks.length * sessionKeysOf(PROGRAM).length);
    deepStrictEqual(
      PROGRAM.weeks.map((w) => w.week),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  });

  const sessionOf = (week: number) =>
    PROGRAM.weeks.find((w) => w.week === week)!.sessions.A!;

  const textOf = (s: GymnasticsSession) =>
    [
      s.label,
      s.goal ?? "",
      ...s.blocks.map((b) => `${b.movement} ${b.prescription} ${b.note ?? ""}`),
      ...(s.notes ?? []),
      ...(s.primer ?? []),
      ...(s.qualityRules ?? []),
      ...(s.stopRules ?? []),
      s.wodAdjustment ?? "",
      ...(s.feedback ?? []),
    ].join(" ");

  const sourceTextOf = (s: GymnasticsSession) => JSON.stringify(s.source ?? {});

  // Every week must carry the full individualized contract: primer, scaled
  // blocks, quality/contact rules, stop rules, WOD adjustment, feedback, and
  // the original Mayhem prescription as visible provenance.
  it("carries the full per-week contract on all eight weeks", () => {
    for (const week of PROGRAM.weeks) {
      const s = week.sessions.A!;
      const where = `week ${week.week}`;
      ok(s.primer && s.primer.length > 0, `${where} primer missing`);
      ok(s.blocks.length > 0, `${where} blocks missing`);
      ok(s.qualityRules && s.qualityRules.length > 0, `${where} quality rules missing`);
      ok(s.stopRules && s.stopRules.length > 0, `${where} stop rules missing`);
      ok(!!s.wodAdjustment, `${where} WOD adjustment missing`);
      ok(s.feedback && s.feedback.length > 0, `${where} feedback missing`);
      ok(!!s.source && s.source.options.length > 0, `${where} source provenance missing`);
      ok(/Mayhem/i.test(s.source!.title), `${where} source does not name Mayhem`);

      const quality = (s.qualityRules ?? []).join(" ");
      ok(/both feet/i.test(quality), `${where} contact standard missing`);
      ok(/inside the hands/i.test(quality), `${where} hand-position standard missing`);
      ok(/near contact/i.test(quality), `${where} near-contact separation missing`);

      const stop = (s.stopRules ?? []).join(" ");
      ok(/shoulder/i.test(stop), `${where} shoulder stop rule missing`);
      ok(/return swing/i.test(stop), `${where} return-swing stop rule missing`);
      ok(/grip/i.test(stop), `${where} grip stop rule missing`);

      const feedback = (s.feedback ?? []).join(" ");
      ok(/full contact/i.test(feedback), `${where} full-contact capture missing`);
      ok(/near contact/i.test(feedback), `${where} near-contact capture missing`);
      ok(/set breakdown|per set|sets/i.test(feedback), `${where} set-breakdown capture missing`);
      ok(/fatigue/i.test(feedback), `${where} fatigue capture missing`);
      ok(/return swing/i.test(feedback), `${where} return-swing capture missing`);
    }
  });

  // The Mayhem source, week by week — the numbers the screenshots actually
  // show must survive in the provenance, and only as provenance.
  const SOURCE_PINS: [number, RegExp[]][] = [
    [1, [/50 Toes to Bar/, /75 Toes to Bar/, /7\/5 Calorie Ski/i, /10 minutes/i, /retest on week 10/i]],
    [2, [/18\/15 Calorie Ski/i, /Cap at 100/i, /1:15/]],
    [3, [/50 Double Unders/i, /15 Toes to Bar for Time/i, /10–12/, /Rest 2 minutes/i]],
    [4, [/5 Wall Walk/i, /35 Toes to Bar/, /50 GHD Sit Ups/i, /50 Toes to Bar/, /total time with rest/i]],
    [5, [/10 Minute AMRAP/i, /8\/6 Cal Ski/i, /12\/10 Calorie Ski/i, /unbroken each segment/i]],
    [6, [/3-3-3-4 Intervals/, /15\/12 Cal Ski/i, /15 Box Jump \(24\/20\)/i, /Max Toes to Bar/i]],
    [7, [/15\/12 Calorie Row \+ 15 Toes to Ring/i, /15\/12 Calorie Bike \+ 15 Toes to Bar/i, /15\/12 Calorie Ski \+ 15 GHD Sit Ups/i, /20\/16 Calorie Row/i]],
    [8, [/20 Minute EMOM/i, /Odd Minutes: 30 sec Max Calorie Ski/i, /Log reps in notes/i]],
  ];

  for (const [week, pins] of SOURCE_PINS) {
    it(`week ${week} preserves its Mayhem source prescription`, () => {
      const text = sourceTextOf(sessionOf(week));
      for (const pin of pins) ok(pin.test(text), `week ${week} source missing ${pin}`);
    });
  }

  it("marks week 7's cropped advanced option incomplete instead of reconstructing it", () => {
    const advanced = sessionOf(7).source!.options.find((o) => /advanced/i.test(o.label));
    ok(advanced, "advanced option missing");
    ok(!!advanced!.incomplete && /cropped/i.test(advanced!.incomplete));
    // Nothing beyond the surviving fragment may appear.
    deepStrictEqual(advanced!.lines, ["3 Rounds", "20/16 Calorie Row", "…"]);
  });

  it("invents no week 9 or week 10 content beyond the source's retest mention", () => {
    for (const week of PROGRAM.weeks) {
      const text = `${textOf(week.sessions.A!)} ${sourceTextOf(week.sessions.A!)}`;
      const allowed =
        /retest on week 10|no week 9 or week 10|week 9 or week 10 screenshots|no week 9 or week 10 material/gi;
      const stripped = text.replace(allowed, "");
      ok(!/week ?9|week ?10/i.test(stripped), `week ${week.week} invents week 9/10 content`);
    }
  });

  it("never prescribes the Mayhem Rx volume as the actionable lane", () => {
    // No David-lane block may ask for the source's 15+ toes-to-bar sets or the
    // 50/75-rep tests: the lane caps live at 6 quality reps per set and 30
    // dynamic attempts per session.
    for (const week of PROGRAM.weeks) {
      for (const block of week.sessions.A!.blocks) {
        ok(
          !/^(15|35|50|75|100) Toes to Bar/i.test(block.prescription),
          `week ${week.week} block "${block.prescription}" ships an Rx dose`,
        );
      }
    }
    equal(PROGRAM.prerequisites.repCaps.perSession, 30);
    ok(/hanging attempts/i.test(PROGRAM.prerequisites.repCaps.label ?? ""));
  });

  it("trains contact acquisition and the return swing in every week", () => {
    const PRIMARY_SKILL =
      /toe flick|late knee[- ]extension|return swing|push(?:es|ed)? the bar away|hollow[- ]to[- ]arch/i;
    for (const week of PROGRAM.weeks) {
      const text = textOf(week.sessions.A!);
      ok(PRIMARY_SKILL.test(text), `week ${week.week} does not train the contact skill`);
      ok(
        !/butterfly|chest[- ]to[- ]bar/i.test(text),
        `week ${week.week} contains excluded volume`,
      );
    }
  });

  it("opens only after the 17–21 August FMD and full refeed", () => {
    ok(/17[–-]21 August FMD/.test(PROGRAM.summary), "summary misses the FMD window");
    ok(/refeed/i.test(PROGRAM.summary), "summary misses the refeed");
    ok(/FMD/.test(PROGRAM.spacingNote) && /refeed/i.test(PROGRAM.spacingNote));
    ok(/FMD/.test(PROGRAM.prerequisites.mustHave.join(" ")));
    const week1Notes = (sessionOf(1).notes ?? []).join(" ");
    ok(/FMD/.test(week1Notes) && /refeed/i.test(week1Notes));
  });

  it("states the verified 18 August starting evidence", () => {
    ok(/knees[- ]to[- ]elbows/i.test(PROGRAM.summary), "starting point missing from summary");
    const mustHave = PROGRAM.prerequisites.mustHave.join(" ");
    ok(/18 August/.test(mustHave), "18 August verification missing");
    ok(/grips/i.test(mustHave), "grip setup evidence missing");
  });

  it("makes the Mayhem numbers source context, never the target", () => {
    const rules = PROGRAM.sessionRules.items.join(" ");
    ok(/source context, not the day's target/i.test(rules));
    ok(/both feet/i.test(rules) && /inside the hands/i.test(rules));
    ok(/near contact/i.test(rules));
    ok(/never buy back failed technique/i.test(rules));
    ok(/butterfly/i.test(rules) && /chest[- ]to[- ]bar/i.test(rules));
  });

  it("gates progress on contact quality, not the calendar", () => {
    ok(/contact quality/i.test(PROGRAM.progressionRule));
    ok(/repeat a week/i.test(PROGRAM.progressionRule));
  });

  it("reconciles the weekly dose against WOD pulling/hanging/GHD volume", () => {
    const wod = [PROGRAM.wodScaling.title, PROGRAM.wodScaling.intro, ...PROGRAM.wodScaling.points].join(" ");
    ok(/pulling|hanging/i.test(wod) && /GHD/i.test(wod));
    ok(/48 hours/.test(wod));
    ok(/coach/i.test(wod));
    ok(/maintenance/i.test(wod), "kipping pull-ups must stay WOD maintenance");
    for (const week of PROGRAM.weeks) {
      ok(!!week.sessions.A!.wodAdjustment, `week ${week.week} lacks its own WOD adjustment`);
    }
  });

  it("keeps chest-to-bar as separate low-volume technique work and butterfly deferred", () => {
    const c2b = PROGRAM.gates.items.find((g) => /chest[- ]to[- ]bar/i.test(g.skill));
    ok(c2b, "chest-to-bar gate missing");
    ok(/low-volume/i.test(c2b!.requirement));
    ok(/never appended|never mixed/i.test(c2b!.requirement));

    const butterfly = PROGRAM.gates.items.find((g) => /butterfly/i.test(g.skill));
    ok(butterfly, "butterfly gate missing");
    ok(/15[–-]20/.test(butterfly!.requirement));
    ok(/coach/i.test(butterfly!.requirement));
  });

  it("keeps dynamic attempts off the 80 cm home bar", () => {
    const card = PROGRAM.homeBarSubstitutions;
    const text = [card.title, card.intro, ...card.points].join(" ");
    ok(/80 cm/.test(text));
    ok(/hollow[- ]to[- ]arch/i.test(text));
    ok(/knee raises/i.test(text));
    ok(/No kipping toes-to-bar attempts/i.test(text));
  });

  it("asks for contacts, sets, fatigue, return swing, and pain after each session", () => {
    const prompt = PROGRAM.feedbackPrompt.items.join(" ");
    ok(/full contacts/i.test(prompt));
    ok(/near contacts/i.test(prompt));
    ok(/set breakdown/i.test(prompt));
    ok(/grip fatigue/i.test(prompt));
    ok(/return swing/i.test(prompt));
    ok(/pain/i.test(prompt));
  });

  it("groups its movement references as contact and return-swing lanes", () => {
    deepStrictEqual(
      PROGRAM.videoGroups.map((g) => g.movement),
      ["contact", "return"],
    );
    for (const g of PROGRAM.videoGroups) {
      ok(!/butterfly|chest[- ]to[- ]bar/i.test(`${g.movement} ${g.label}`), g.label);
    }
    ok(PROGRAM.videos.length > 0);
    ok(PROGRAM.videos.some((v) => /Toes/i.test(v.title)), "no toes-to-bar reference video");
  });

  it("carries no stale copy from the closed kipping-capacity block", () => {
    const narrative = [
      PROGRAM.title,
      PROGRAM.subtitle,
      PROGRAM.summary,
      PROGRAM.primarySkill.cue,
      PROGRAM.primarySkill.failureSignal,
      PROGRAM.progressionRule,
      ...PROGRAM.prerequisites.mustHave,
    ].join(" ");
    ok(!/clean[- ]forty|50-rep application|kipping capacity/i.test(narrative));
  });
});

// ---------------------------------------------------------------------------
// Structured session feedback serialization
// ---------------------------------------------------------------------------

describe("composeSessionFeedbackNote", () => {
  const empty = {
    fullContacts: null,
    nearContacts: null,
    setBreakdown: "",
    fatigue: null,
    returnSwing: null,
    extra: "",
  } as const;

  it("serializes a full report in the block's capture order", () => {
    equal(
      composeSessionFeedbackNote({
        fullContacts: 9,
        nearContacts: 4,
        setBreakdown: "3/3/2/2",
        fatigue: "noticeable",
        returnSwing: "intact",
        extra: "left palm hot spot late",
      }),
      "Full contacts 9 · Near contacts 4 · Sets 3/3/2/2 · Shoulder/grip fatigue noticeable · Return swing intact — left palm hot spot late",
    );
  });

  it("keeps a zero count — zero contacts is a real result, not a blank", () => {
    equal(
      composeSessionFeedbackNote({ ...empty, fullContacts: 0, nearContacts: 6 }),
      "Full contacts 0 · Near contacts 6",
    );
  });

  it("omits empty fields instead of writing placeholders", () => {
    equal(
      composeSessionFeedbackNote({ ...empty, returnSwing: "lost" }),
      "Return swing lost",
    );
  });

  it("returns an empty string for an all-empty form so callers refuse the save", () => {
    equal(composeSessionFeedbackNote({ ...empty }), "");
  });

  it("uses the free-text alone when it is the only content", () => {
    equal(composeSessionFeedbackNote({ ...empty, extra: "skipped — WOD had TTB" }), "skipped — WOD had TTB");
  });

  it("trims the set breakdown and free text", () => {
    equal(
      composeSessionFeedbackNote({ ...empty, setBreakdown: "  2/2/2  ", extra: "  fine  " }),
      "Sets 2/2/2 — fine",
    );
  });
});
