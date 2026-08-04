// Tests for the one-off backfill that restores the six completed sessions of
// `gym-link-two-kip-2wk-v1` to `health_gymnastics_progress`.
//
// Two things are pinned here, because the script is run once, by hand, against
// production:
//
//   1. the *contract* — exactly six evidence-backed rows, under the retired
//      program id, with the historical completion date rather than "now";
//   2. the *behaviour* — run against a real in-memory libSQL database, the same
//      client type production uses, twice, plus a third run with a stale row
//      already present. Re-running must converge, not duplicate, and must never
//      touch the current capacity block.
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
} from "../../scripts/lib/gymnastics-history-backfill.mjs";

/** The live block, read from the projection the script itself reads. */
const CURRENT_PROGRAM_ID: string = JSON.parse(
  readFileSync(new URL("../data/gymnastics-program.json", import.meta.url), "utf8"),
).programId;

/** The dates David reported, in the order the block was trained. */
const EVIDENCE = [
  { week: 1, session: "A", date: "2026-07-27" },
  { week: 1, session: "B", date: "2026-07-28" },
  { week: 1, session: "C", date: "2026-07-30" },
  { week: 2, session: "A", date: "2026-08-01" },
  { week: 2, session: "B", date: "2026-08-02" },
  { week: 2, session: "C", date: "2026-08-03" },
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
  // Exactly what production holds today: one untouched legacy row, nothing else.
  await client.execute({
    sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed) VALUES (?, 1, 'A', 0)",
    args: ["gym-kip-ttb-10wk-v1"],
  });
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

describe("backfill contract", () => {
  it("carries exactly the six reported sessions, in order", () => {
    equal(BACKFILL_ROWS.length, 6);
    deepStrictEqual(
      BACKFILL_ROWS.map((r) => ({ week: r.week, session: r.session, date: r.date })),
      EVIDENCE,
    );
  });

  it("targets the retired block, never the live one", () => {
    equal(ARCHIVED_PROGRAM_ID, "gym-link-two-kip-2wk-v1");
    ok(ARCHIVED_PROGRAM_ID !== CURRENT_PROGRAM_ID);
    for (const row of BACKFILL_ROWS) {
      equal(argsFor(row)[0], ARCHIVED_PROGRAM_ID);
    }
  });

  it("preserves each session's own date instead of stamping today", () => {
    for (const row of BACKFILL_ROWS) {
      ok(
        row.completedAt.startsWith(row.date),
        `${row.week}${row.session} completedAt ${row.completedAt} is not on ${row.date}`,
      );
      // Midday UTC, so the instant lands on the right calendar day whether it is
      // read back in UTC or in Europe/Zurich.
      equal(row.completedAt, `${row.date}T12:00:00.000Z`);
    }
    // Six distinct instants — not one shared "now".
    equal(new Set(BACKFILL_ROWS.map((r) => r.completedAt)).size, 6);
  });

  it("carries a real note for every session", () => {
    for (const row of BACKFILL_ROWS) {
      ok(row.note.length > 20, `${row.week}${row.session} note too thin`);
    }
  });

  it("passes args in the order the upsert declares them", () => {
    const [row] = BACKFILL_ROWS;
    deepStrictEqual(argsFor(row), [
      ARCHIVED_PROGRAM_ID,
      row.week,
      row.session,
      row.completedAt,
      row.note,
    ]);
  });

  it("upserts on the natural key and writes the historical timestamp verbatim", () => {
    match(UPSERT_SQL, /ON CONFLICT \(program_id, week, session\) DO UPDATE/);
    match(UPSERT_SQL, /completed_at = excluded\.completed_at/);
    // No clock anywhere: `now`/CURRENT_TIMESTAMP would flatten history to today.
    ok(!/CURRENT_TIMESTAMP|datetime\(|'now'/i.test(UPSERT_SQL), UPSERT_SQL);
  });

  it("refuses to run when the retired id is somehow the live one", () => {
    throws(() => assertNotCurrentProgram(ARCHIVED_PROGRAM_ID), /Refusing to backfill/);
    assertNotCurrentProgram(CURRENT_PROGRAM_ID); // does not throw
  });
});

describe("planBackfill", () => {
  const stored = (row: (typeof BACKFILL_ROWS)[number]) => ({
    week: row.week,
    session: row.session,
    completed: 1,
    completed_at: row.completedAt,
    note: row.note,
  });

  it("plans six inserts against an empty block", () => {
    deepStrictEqual(
      planBackfill([]).map((s) => s.action),
      Array(6).fill("insert"),
    );
  });

  it("plans nothing once the rows are already correct", () => {
    deepStrictEqual(
      planBackfill(BACKFILL_ROWS.map(stored)).map((s) => s.action),
      Array(6).fill("unchanged"),
    );
  });

  it("plans an update for a row stored with a wrong date, note, or flag", () => {
    const drifted = BACKFILL_ROWS.map(stored);
    drifted[0].completed_at = "2026-08-04T09:00:00.000Z"; // stamped today by mistake
    drifted[1].note = "";
    drifted[2].completed = 0;
    deepStrictEqual(
      planBackfill(drifted).map((s) => s.action),
      ["update", "update", "update", "unchanged", "unchanged", "unchanged"],
    );
  });

  it("treats a completed=1 row matching in every field as already done", () => {
    equal(rowMatches(stored(BACKFILL_ROWS[0]), BACKFILL_ROWS[0]), true);
    equal(rowMatches(undefined, BACKFILL_ROWS[0]), false);
  });
});

// ---------------------------------------------------------------------------
// Behaviour — against a real database, the way it will be run
// ---------------------------------------------------------------------------

describe("applyBackfill", () => {
  it("writes nothing in dry-run mode but reports the full plan", async () => {
    const client = await freshDb();
    const result = await applyBackfill(client, { write: false });
    equal(result.insert, 6);
    equal(result.update, 0);
    equal(result.unchanged, 0);
    deepStrictEqual(await rowsFor(client, ARCHIVED_PROGRAM_ID), []);
  });

  it("restores the six sessions with their own dates and notes", async () => {
    const client = await freshDb();
    await applyBackfill(client, { write: true });

    const rows = await rowsFor(client, ARCHIVED_PROGRAM_ID);
    equal(rows.length, 6);
    deepStrictEqual(
      rows.map((r) => ({ week: r.week, session: r.session, date: r.completed_at?.slice(0, 10) })),
      EVIDENCE.map((e) => ({ week: e.week, session: e.session, date: e.date })),
    );
    for (const r of rows) {
      equal(r.completed, 1);
      ok(r.note && r.note.length > 20);
    }
  });

  it("is idempotent: a second run changes nothing and adds no duplicates", async () => {
    const client = await freshDb();
    await applyBackfill(client, { write: true });
    const first = await rowsFor(client, ARCHIVED_PROGRAM_ID);

    const second = await applyBackfill(client, { write: true });
    equal(second.insert, 0);
    equal(second.update, 0);
    equal(second.unchanged, 6);
    deepStrictEqual(await rowsFor(client, ARCHIVED_PROGRAM_ID), first);
  });

  it("repairs a row that was stored with today's timestamp, without touching the rest", async () => {
    const client = await freshDb();
    await applyBackfill(client, { write: true });
    await client.execute({
      sql: "UPDATE health_gymnastics_progress SET completed_at = ? WHERE program_id = ? AND week = 1 AND session = 'A'",
      args: ["2026-08-04T09:00:00.000Z", ARCHIVED_PROGRAM_ID],
    });

    const result = await applyBackfill(client, { write: true });
    equal(result.update, 1);
    equal(result.unchanged, 5);
    const rows = await rowsFor(client, ARCHIVED_PROGRAM_ID);
    equal(rows.length, 6);
    equal(rows[0].completed_at, "2026-07-27T12:00:00.000Z");
  });

  it("leaves the current capacity block completely alone", async () => {
    const client = await freshDb();
    // David has ticked one session of the live block by hand.
    await client.execute({
      sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed, completed_at, note) VALUES (?, 1, 'A', 1, ?, ?)",
      args: [CURRENT_PROGRAM_ID, "2026-08-04T16:00:00.000Z", "6×4, clean"],
    });

    await applyBackfill(client, { write: true });
    await applyBackfill(client, { write: true });

    deepStrictEqual(await rowsFor(client, CURRENT_PROGRAM_ID), [
      {
        week: 1,
        session: "A",
        completed: 1,
        completed_at: "2026-08-04T16:00:00.000Z",
        note: "6×4, clean",
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

  it("creates the table when the block has never been written at all", async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    const result = await applyBackfill(client, { write: true });
    equal(result.insert, 6);
    equal((await rowsFor(client, ARCHIVED_PROGRAM_ID)).length, 6);
  });
});
