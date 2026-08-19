// Tests for the one-off backfill that records the two sessions which closed
// the retired `gym-kipping-capacity-3wk-v1` block:
//
//   - W2 B, 2026-08-15 — the grips-confirmed descending ladder;
//   - W3 B, 2026-08-18 — the fifty-rep WOD application.
//
// Two things are pinned here, because the script is run once, by hand, against
// production:
//
//   1. the *contract* — exactly two evidence-backed rows, under the retired
//      program id, with the historical completion dates rather than "now",
//      and NO row for W3 A (the clean-forty gate was never trained);
//   2. the *behaviour* — run against a real in-memory libSQL database seeded
//      with production's actual state (three completed kipping rows plus the
//      legacy 10-week leftover), twice. Re-running must converge, must never
//      touch the pre-existing completions, and must leave W3 A absent.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { readFileSync } from "node:fs";
import { equal, deepStrictEqual, match, ok, throws } from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import {
  ARCHIVED_PROGRAM_ID,
  BACKFILL_ROWS,
  UPSERT_SQL,
  applyBackfill,
  argsFor,
  assertNotCurrentProgram,
  planBackfill,
  rowMatches,
} from "../../scripts/lib/gymnastics-capacity-close.mjs";

/** The live block, read from the projection the script itself reads. */
const CURRENT_PROGRAM_ID: string = JSON.parse(
  readFileSync(new URL("../data/gymnastics-program.json", import.meta.url), "utf8"),
).programId;

/** The dates David reported, in the order the sessions were trained. */
const EVIDENCE = [
  { week: 2, session: "B", date: "2026-08-15" },
  { week: 3, session: "B", date: "2026-08-18" },
];

/** What production already holds for the retired kipping block. */
const EXISTING_KIPPING_ROWS = [
  { week: 1, session: "A", completedAt: "2026-08-04T13:51:39.042Z", note: "6×4 with 60-second rests — 24 linked reps." },
  { week: 1, session: "B", completedAt: "2026-08-06T08:06:24.515Z", note: "1×6, then 4×5 — 26 linked reps in 5:45." },
  { week: 2, session: "A", completedAt: "2026-08-10T16:04:20.359Z", note: "8×5 EMOM for 40 reps. Kip disappeared on rep 40." },
];

const clients: Client[] = [];

/** A fresh in-memory database, seeded with production's current state. */
async function freshDb(): Promise<Client> {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.execute(`CREATE TABLE health_gymnastics_progress (
    program_id   TEXT NOT NULL,
    week         INTEGER NOT NULL,
    session      TEXT NOT NULL,
    completed    INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    note         TEXT,
    PRIMARY KEY (program_id, week, session)
  )`);
  // The untouched legacy 10-week row.
  await client.execute({
    sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed) VALUES (?, 1, 'A', 0)",
    args: ["gym-kip-ttb-10wk-v1"],
  });
  // The three kipping-capacity completions production already holds.
  for (const row of EXISTING_KIPPING_ROWS) {
    await client.execute({
      sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed, completed_at, note) VALUES (?, ?, ?, 1, ?, ?)",
      args: [ARCHIVED_PROGRAM_ID, row.week, row.session, row.completedAt, row.note],
    });
  }
  return client;
}

after(() => {
  for (const client of clients) client.close();
});

async function rowsFor(client: Client, programId: string) {
  const result = await client.execute({
    sql: "SELECT week, session, completed, completed_at, note FROM health_gymnastics_progress WHERE program_id = ? ORDER BY week, session",
    args: [programId],
  });
  return result.rows as unknown as {
    week: number;
    session: string;
    completed: number;
    completed_at: string | null;
    note: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Contract — what the script would write
// ---------------------------------------------------------------------------

describe("capacity-close backfill contract", () => {
  it("carries exactly the two closing sessions, in order, and no W3 A", () => {
    equal(BACKFILL_ROWS.length, 2);
    deepStrictEqual(
      BACKFILL_ROWS.map((r) => ({ week: r.week, session: r.session, date: r.date })),
      EVIDENCE,
    );
    ok(!BACKFILL_ROWS.some((r) => r.week === 3 && r.session === "A"));
  });

  it("targets the retired kipping block, never the live toes-to-bar one", () => {
    equal(ARCHIVED_PROGRAM_ID, "gym-kipping-capacity-3wk-v1");
    ok(ARCHIVED_PROGRAM_ID !== CURRENT_PROGRAM_ID);
    for (const row of BACKFILL_ROWS) {
      equal(argsFor(row)[0], ARCHIVED_PROGRAM_ID);
    }
  });

  it("preserves each session's own date instead of stamping today", () => {
    for (const row of BACKFILL_ROWS) {
      equal(row.completedAt, `${row.date}T12:00:00.000Z`);
    }
    equal(new Set(BACKFILL_ROWS.map((r) => r.completedAt)).size, 2);
  });

  it("carries the real training story in every note", () => {
    const [ladder, application] = BACKFILL_ROWS;
    match(ladder.note, /8\/7\/6\/5\/4\/3\/2/);
    match(ladder.note, /35 reps/);
    match(ladder.note, /grips/i);
    match(application.note, /6×5 plus 5×4 in 8:15/);
    match(application.note, /clean-forty gate/i);
  });

  it("upserts on the natural key and writes the historical timestamp verbatim", () => {
    match(UPSERT_SQL, /ON CONFLICT \(program_id, week, session\) DO UPDATE/);
    match(UPSERT_SQL, /completed_at = excluded\.completed_at/);
    ok(!/CURRENT_TIMESTAMP|datetime\(|'now'/i.test(UPSERT_SQL), UPSERT_SQL);
  });

  it("refuses to run while the kipping block is still the live one", () => {
    throws(() => assertNotCurrentProgram(ARCHIVED_PROGRAM_ID), /Refusing to backfill/);
    assertNotCurrentProgram(CURRENT_PROGRAM_ID); // does not throw
  });
});

describe("capacity-close planBackfill", () => {
  const stored = (row: (typeof BACKFILL_ROWS)[number]) => ({
    week: row.week,
    session: row.session,
    completed: 1,
    completed_at: row.completedAt,
    note: row.note,
  });

  it("plans two inserts against production's current state", () => {
    deepStrictEqual(
      planBackfill(
        EXISTING_KIPPING_ROWS.map((r) => ({
          week: r.week,
          session: r.session,
          completed: 1,
          completed_at: r.completedAt,
          note: r.note,
        })),
      ).map((s) => s.action),
      ["insert", "insert"],
    );
  });

  it("plans nothing once the rows are already correct", () => {
    deepStrictEqual(
      planBackfill(BACKFILL_ROWS.map(stored)).map((s) => s.action),
      ["unchanged", "unchanged"],
    );
  });

  it("plans an update for a row stored with a wrong date or note", () => {
    const drifted = BACKFILL_ROWS.map(stored);
    drifted[0].completed_at = "2026-08-19T09:00:00.000Z"; // stamped today by mistake
    deepStrictEqual(
      planBackfill(drifted).map((s) => s.action),
      ["update", "unchanged"],
    );
    equal(rowMatches(stored(BACKFILL_ROWS[1]), BACKFILL_ROWS[1]), true);
    equal(rowMatches(undefined, BACKFILL_ROWS[0]), false);
  });
});

// ---------------------------------------------------------------------------
// Behaviour — against a real database, the way it will be run
// ---------------------------------------------------------------------------

describe("capacity-close applyBackfill", () => {
  it("writes nothing in dry-run mode but reports the full plan", async () => {
    const client = await freshDb();
    const result = await applyBackfill(client, { write: false });
    equal(result.insert, 2);
    equal(result.update, 0);
    equal(result.unchanged, 0);
    equal((await rowsFor(client, ARCHIVED_PROGRAM_ID)).length, 3); // untouched
  });

  it("records the ladder and the application with their own dates", async () => {
    const client = await freshDb();
    await applyBackfill(client, { write: true });

    const rows = await rowsFor(client, ARCHIVED_PROGRAM_ID);
    equal(rows.length, 5); // 3 existing + 2 backfilled — and no W3 A
    const w2b = rows.find((r) => r.week === 2 && r.session === "B");
    const w3b = rows.find((r) => r.week === 3 && r.session === "B");
    equal(w2b?.completed_at, "2026-08-15T12:00:00.000Z");
    equal(w3b?.completed_at, "2026-08-18T12:00:00.000Z");
    ok(!rows.some((r) => r.week === 3 && r.session === "A"));
  });

  it("never touches the three completions production already holds", async () => {
    const client = await freshDb();
    await applyBackfill(client, { write: true });
    const rows = await rowsFor(client, ARCHIVED_PROGRAM_ID);
    for (const existing of EXISTING_KIPPING_ROWS) {
      const stored = rows.find(
        (r) => r.week === existing.week && r.session === existing.session,
      );
      equal(stored?.completed, 1);
      equal(stored?.completed_at, existing.completedAt);
      equal(stored?.note, existing.note);
    }
  });

  it("is idempotent: a second run changes nothing and adds no duplicates", async () => {
    const client = await freshDb();
    await applyBackfill(client, { write: true });
    const first = await rowsFor(client, ARCHIVED_PROGRAM_ID);

    const second = await applyBackfill(client, { write: true });
    equal(second.insert, 0);
    equal(second.update, 0);
    equal(second.unchanged, 2);
    deepStrictEqual(await rowsFor(client, ARCHIVED_PROGRAM_ID), first);
  });

  it("leaves the live toes-to-bar block completely alone", async () => {
    const client = await freshDb();
    // David has ticked one session of the live block by hand.
    await client.execute({
      sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed, completed_at, note) VALUES (?, 1, 'A', 1, ?, ?)",
      args: [CURRENT_PROGRAM_ID, "2026-08-24T16:00:00.000Z", "baseline done"],
    });

    await applyBackfill(client, { write: true });
    await applyBackfill(client, { write: true });

    deepStrictEqual(await rowsFor(client, CURRENT_PROGRAM_ID), [
      {
        week: 1,
        session: "A",
        completed: 1,
        completed_at: "2026-08-24T16:00:00.000Z",
        note: "baseline done",
      },
    ]);
  });

  it("does not complete the untouched legacy 10-week row", async () => {
    const client = await freshDb();
    await applyBackfill(client, { write: true });
    const legacy = await rowsFor(client, "gym-kip-ttb-10wk-v1");
    equal(legacy.length, 1);
    equal(legacy[0].completed, 0);
    equal(legacy[0].completed_at, null);
  });
});
