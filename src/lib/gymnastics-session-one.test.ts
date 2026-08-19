// Tests for the one-off script that records week 1 session A of the live
// kipping-capacity block in `health_gymnastics_progress`.
//
// Two things are pinned here, because the script is run by hand against
// production:
//
//   1. the *contract* — one row, under the program id the projection actually
//      ships, carrying the reported completion instant and the details of the
//      session the rest of the block was adapted from;
//   2. the *behaviour* — run against a real in-memory libSQL database, twice,
//      plus a run over a stale row and a run beside unrelated rows. A dry run
//      writes nothing, a second run reports `unchanged`, and no row outside
//      week 1 session A of the current block is ever touched.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { readFileSync } from "node:fs";
import { equal, deepStrictEqual, match, ok, throws } from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import {
  CURRENT_PROGRAM_ID,
  SESSION_ROW,
  UPSERT_SQL,
  applyRecord,
  argsFor,
  assertCurrentProgram,
  planRecord,
  rowMatches,
} from "../../scripts/lib/gymnastics-session-one.mjs";

/** The block the app actually ships, read the way the script reads it. */
const PROJECTION_PROGRAM_ID: string = JSON.parse(
  readFileSync(new URL("../data/gymnastics-program.json", import.meta.url), "utf8"),
).programId;

/** A row from another block, to prove the script's scope holds. */
const NEIGHBOUR = {
  programId: "gym-link-two-kip-2wk-v1",
  week: 1,
  session: "A",
  completedAt: "2026-07-27T12:00:00.000Z",
  note: "a retired block's session",
};

const clients: Client[] = [];

/** A fresh in-memory database holding rows this script must not disturb. */
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
  // A restored retired-block row, and a later session of the *current* block
  // that David has not trained — neither may change.
  await client.execute({
    sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed, completed_at, note) VALUES (?, ?, ?, 1, ?, ?)",
    args: [NEIGHBOUR.programId, NEIGHBOUR.week, NEIGHBOUR.session, NEIGHBOUR.completedAt, NEIGHBOUR.note],
  });
  await client.execute({
    sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed) VALUES (?, 1, 'B', 0)",
    args: [CURRENT_PROGRAM_ID],
  });
  return client;
}

after(() => {
  for (const client of clients) client.close();
});

async function allRows(client: Client) {
  const result = await client.execute(
    "SELECT program_id, week, session, completed, completed_at, note FROM health_gymnastics_progress ORDER BY program_id, week, session",
  );
  return result.rows as unknown as {
    program_id: string;
    week: number;
    session: string;
    completed: number;
    completed_at: string | null;
    note: string | null;
  }[];
}

const targetRow = (rows: Awaited<ReturnType<typeof allRows>>) =>
  rows.find(
    (r) =>
      r.program_id === CURRENT_PROGRAM_ID &&
      r.week === SESSION_ROW.week &&
      r.session === SESSION_ROW.session,
  );

// ---------------------------------------------------------------------------
// Contract — what the script would write
// ---------------------------------------------------------------------------

describe("session-one record contract", () => {
  it("refuses to run now that its block has been retired by the projection", () => {
    // The kipping-capacity block closed on 2026-08-18 and the projection now
    // ships the toes-to-bar block — so the guard the script was built with
    // must make the CLI refuse to run, keeping this one-off script inert.
    equal(CURRENT_PROGRAM_ID, "gym-kipping-capacity-3wk-v1");
    ok(CURRENT_PROGRAM_ID !== PROJECTION_PROGRAM_ID);
    throws(() => assertCurrentProgram(PROJECTION_PROGRAM_ID), /Refusing to record/);
    throws(() => assertCurrentProgram("gym-something-later-v2"), /Refusing to record/);
    assertCurrentProgram(CURRENT_PROGRAM_ID); // its own block would still pass
  });

  it("is week 1 session A, stamped with the reported instant", () => {
    equal(SESSION_ROW.week, 1);
    equal(SESSION_ROW.session, "A");
    equal(SESSION_ROW.completedAt, "2026-08-04T13:51:39.042Z");
  });

  // The whole remaining progression was derived from these details, so a note
  // that loses them makes the adapted plan unreadable later.
  it("keeps the reported detail the rest of the block was adapted from", () => {
    match(SESSION_ROW.note, /6×4/);
    match(SESSION_ROW.note, /60-second rests/);
    match(SESSION_ROW.note, /about 5:30/);
    match(SESSION_ROW.note, /felt fine and comfortable/i);
    match(SESSION_ROW.note, /two more sets of four were still in reserve/i);
  });

  it("binds every argument to the one row, and marks it completed", () => {
    deepStrictEqual(argsFor(), [
      CURRENT_PROGRAM_ID,
      1,
      "A",
      "2026-08-04T13:51:39.042Z",
      SESSION_ROW.note,
    ]);
    match(UPSERT_SQL, /ON CONFLICT \(program_id, week, session\) DO UPDATE/);
    match(UPSERT_SQL, /completed = 1/);
  });

  it("plans insert, update, or unchanged from what is already stored", () => {
    equal(planRecord(undefined).action, "insert");
    equal(
      planRecord({
        completed: 1,
        completed_at: SESSION_ROW.completedAt,
        note: SESSION_ROW.note,
      }).action,
      "unchanged",
    );
    equal(
      planRecord({ completed: 1, completed_at: "2026-08-05T09:00:00.000Z", note: SESSION_ROW.note })
        .action,
      "update",
    );
    equal(rowMatches(undefined), false);
    equal(rowMatches({ completed: 0, completed_at: SESSION_ROW.completedAt, note: SESSION_ROW.note }), false);
  });
});

// ---------------------------------------------------------------------------
// Behaviour — against a real libSQL database
// ---------------------------------------------------------------------------

describe("session-one record behaviour", () => {
  it("writes nothing on a dry run, and reports what --write would do", async () => {
    const client = await freshDb();
    const before = await allRows(client);

    const step = await applyRecord(client, { write: false });

    equal(step.action, "insert");
    deepStrictEqual(await allRows(client), before);
  });

  it("inserts the row, then reports unchanged on a second run", async () => {
    const client = await freshDb();

    equal((await applyRecord(client, { write: true })).action, "insert");
    const first = targetRow(await allRows(client));
    ok(first, "row was not written");
    equal(first.completed, 1);
    equal(first.completed_at, SESSION_ROW.completedAt);
    equal(first.note, SESSION_ROW.note);

    equal((await applyRecord(client, { write: true })).action, "unchanged");
    equal((await allRows(client)).length, 3, "a re-run duplicated the row");
  });

  it("repairs a row stamped with the wrong instant", async () => {
    const client = await freshDb();
    await client.execute({
      sql: "INSERT INTO health_gymnastics_progress (program_id, week, session, completed, completed_at, note) VALUES (?, 1, 'A', 1, ?, ?)",
      args: [CURRENT_PROGRAM_ID, "2026-08-06T10:00:00.000Z", "stamped when the row was ticked"],
    });

    equal((await applyRecord(client, { write: true })).action, "update");
    const row = targetRow(await allRows(client));
    equal(row?.completed_at, SESSION_ROW.completedAt);
    equal(row?.note, SESSION_ROW.note);
  });

  it("leaves every other row exactly as it found it", async () => {
    const client = await freshDb();
    await applyRecord(client, { write: true });
    const rows = await allRows(client);

    const neighbour = rows.find((r) => r.program_id === NEIGHBOUR.programId);
    equal(neighbour?.completed_at, NEIGHBOUR.completedAt);
    equal(neighbour?.note, NEIGHBOUR.note);

    // Session 1 B of the current block is untrained and must stay that way.
    const untrained = rows.find(
      (r) => r.program_id === CURRENT_PROGRAM_ID && r.session === "B",
    );
    equal(untrained?.completed, 0);
    equal(untrained?.completed_at, null);
  });
});
