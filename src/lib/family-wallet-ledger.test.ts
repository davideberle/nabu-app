import { deepStrictEqual, equal } from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import {
  insertRedemptionIfAffordable,
  transitionCompletionStatus,
} from "./family-wallet-ledger.ts";

const clients: Client[] = [];

async function freshLedger(): Promise<Client> {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.execute(`CREATE TABLE family_completions (
    person_id TEXT NOT NULL,
    routine_id TEXT NOT NULL,
    week TEXT NOT NULL,
    day INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT,
    reviewed_at TEXT,
    awarded_points INTEGER,
    PRIMARY KEY (person_id, routine_id, week, day)
  )`);
  await client.execute(`CREATE TABLE family_reward_redemptions (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    reward_id TEXT NOT NULL,
    week TEXT NOT NULL,
    created_at TEXT NOT NULL,
    charged_points INTEGER
  )`);
  return client;
}

after(() => {
  for (const client of clients) client.close();
});

const identity = {
  week: "2026-W37",
  personId: "isabel",
  routineId: "i-kumon",
  day: 0,
};

async function completionSnapshot(client: Client) {
  const result = await client.execute({
    sql: `SELECT status, awarded_points FROM family_completions
          WHERE person_id = ? AND routine_id = ? AND week = ? AND day = ?`,
    args: [identity.personId, identity.routineId, identity.week, identity.day],
  });
  return {
    status: String(result.rows[0].status),
    awardedPoints: result.rows[0].awarded_points === null
      ? null
      : Number(result.rows[0].awarded_points),
  };
}

describe("completion award snapshots", () => {
  it("keeps null before first approval, then preserves the award through hold and reapproval", async () => {
    const client = await freshLedger();
    await client.execute({
      sql: `INSERT INTO family_completions
              (person_id, routine_id, week, day, status, created_at, awarded_points)
            VALUES (?, ?, ?, ?, 'pending_review', 'submitted-1', NULL)`,
      args: [identity.personId, identity.routineId, identity.week, identity.day],
    });

    equal(await transitionCompletionStatus(client, identity, "on_hold", 4, "review-1"), true);
    deepStrictEqual(await completionSnapshot(client), { status: "on_hold", awardedPoints: null });

    equal(await transitionCompletionStatus(client, identity, "done", 4, "review-2"), true);
    deepStrictEqual(await completionSnapshot(client), { status: "done", awardedPoints: 4 });

    equal(await transitionCompletionStatus(client, identity, "on_hold", 99, "review-3"), true);
    deepStrictEqual(await completionSnapshot(client), { status: "on_hold", awardedPoints: 4 });
    equal(await transitionCompletionStatus(client, identity, "done", 99, "review-4"), true);
    deepStrictEqual(await completionSnapshot(client), { status: "done", awardedPoints: 4 });
  });

  it("preserves the original award through redo and reapproval after repricing or disabling", async () => {
    const client = await freshLedger();
    await client.execute({
      sql: `INSERT INTO family_completions
              (person_id, routine_id, week, day, status, created_at, awarded_points)
            VALUES (?, ?, ?, ?, 'done', 'submitted-2', 4)`,
      args: [identity.personId, identity.routineId, identity.week, identity.day],
    });

    equal(await transitionCompletionStatus(client, identity, "redo", 4, "review-1"), true);
    deepStrictEqual(await completionSnapshot(client), { status: "redo", awardedPoints: 4 });

    // 40 represents a later price change; 0 represents a disabled definition.
    equal(await transitionCompletionStatus(client, identity, "done", 40, "review-2"), true);
    deepStrictEqual(await completionSnapshot(client), { status: "done", awardedPoints: 4 });
    equal(await transitionCompletionStatus(client, identity, "redo", 0, "review-3"), true);
    equal(await transitionCompletionStatus(client, identity, "done", 0, "review-4"), true);
    deepStrictEqual(await completionSnapshot(client), { status: "done", awardedPoints: 4 });
  });
});

function redemption(id: string, chargedPoints: number) {
  return {
    id,
    personId: "isabel",
    rewardId: "friends",
    week: "2026-W38",
    createdAt: `2026-09-16T10:00:0${id}.000Z`,
    chargedPoints,
  };
}

async function balance(client: Client): Promise<number> {
  const result = await client.execute(`SELECT
    COALESCE((SELECT SUM(awarded_points) FROM family_completions
      WHERE person_id = 'isabel' AND week >= '2026-W34' AND status = 'done'), 0)
    - COALESCE((SELECT SUM(charged_points) FROM family_reward_redemptions
      WHERE person_id = 'isabel' AND week >= '2026-W34'), 0) AS balance`);
  return Number(result.rows[0].balance);
}

describe("atomic redemption admission", () => {
  it("rejects insufficient funds and admits only one of two concurrent debits", async () => {
    const client = await freshLedger();
    await client.execute({
      sql: `INSERT INTO family_completions
              (person_id, routine_id, week, day, status, created_at, awarded_points)
            VALUES ('isabel', 'i-kumon', '2026-W37', 0, 'done', 'submitted', 5)`,
      args: [],
    });

    equal(await insertRedemptionIfAffordable(client, redemption("0", 6), "2026-W34"), false);
    const results = await Promise.all([
      insertRedemptionIfAffordable(client, redemption("1", 4), "2026-W34"),
      insertRedemptionIfAffordable(client, redemption("2", 4), "2026-W34"),
    ]);
    deepStrictEqual(results.sort(), [false, true]);
    equal(await balance(client), 1);
  });

  it("allows repeat redemptions only while each debit remains affordable", async () => {
    const client = await freshLedger();
    await client.execute(`INSERT INTO family_completions
      (person_id, routine_id, week, day, status, created_at, awarded_points)
      VALUES ('isabel', 'i-kumon', '2026-W37', 0, 'done', 'submitted', 8)`);

    equal(await insertRedemptionIfAffordable(client, redemption("3", 4), "2026-W34"), true);
    equal(await insertRedemptionIfAffordable(client, redemption("4", 4), "2026-W34"), true);
    equal(await insertRedemptionIfAffordable(client, redemption("5", 4), "2026-W34"), false);
    equal(await balance(client), 0);
  });
});
