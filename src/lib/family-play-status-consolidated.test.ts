// AR01 (planner, October 26 17:08): the consolidated meter status read (readLeaseStatusForMeter) against the former
// recordLeaseActivation + getLeaseStatus pair on CLONED databases (VACUUM INTO) for every lease state the meter can ask
// about — same answer, same rows in every play table. Database round trips are counted at the client boundary the way
// the installed HTTP client sends them (@libsql/client 0.17.2, lib-esm/hrana.js + http.js: one request per execute /
// transaction batch / commit / rollback; the BEGIN rides with the first statement). A failure injected into the
// second batch must roll everything back, and a retry must then match. Observations go to CONSOLIDATED_GATE_OBSERVATIONS.
import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client, type Transaction } from "@libsql/client";
import { endPlayLease, ensurePlayTables, getLeaseStatus, issuePlayLease, readLeaseStatusForMeter, recordLeaseActivation, settlePlayLease } from "./family-play-db.ts";
import { DAILY_CHESS_GAME_ID } from "./family-play.ts";

const dir = mkdtempSync(join(tmpdir(), "family-status-consolidated-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const file = () => join(dir, `db-${(n += 1)}.sqlite`);
const NOW = new Date("2026-10-08T10:00:00.000Z"); // 12:00 Zurich, ISO 2026-W41 day 3
const at = (ms: number) => new Date(NOW.getTime() + ms);

async function base(path: string): Promise<Client> {
  const client = createClient({ url: `file:${path}` });
  await client.execute("CREATE TABLE family_completions (person_id TEXT NOT NULL, routine_id TEXT NOT NULL, week TEXT NOT NULL, day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'done', note TEXT, challenge TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, credit_count INTEGER NOT NULL DEFAULT 1, awarded_points INTEGER, normalized_summary TEXT, approval_source TEXT, PRIMARY KEY (person_id, routine_id, week, day))");
  await client.execute("CREATE TABLE family_reward_redemptions (id TEXT PRIMARY KEY, person_id TEXT, reward_id TEXT, week TEXT, created_at TEXT, charged_points INTEGER)");
  await ensurePlayTables(client);
  await client.execute({ sql: "INSERT INTO family_play_allowances VALUES ('santiago', 900, 0, ?)", args: [NOW.toISOString()] });
  return client;
}
const approveToday = (c: Client) => c.execute({ sql: "INSERT INTO family_completions (person_id, routine_id, week, day, status, created_at, reviewed_at, awarded_points, approval_source) VALUES ('santiago', 's-kumon', '2026-W41', 3, 'done', '2026-10-08T06:00:00.000Z', '2026-10-08T07:00:00.000Z', 1, 'parent-review')" });
const issue = async (c: Client, leaseId: string, now: Date, gameId = "deimos-rising", takeover = false) => {
  const r = await issuePlayLease({ personId: "santiago", gameId, mode: "play", leaseId, takeover, deviceLabel: "computer", now }, c);
  ok(r.ok, JSON.stringify(r));
};
async function dump(c: Client) {
  const out: Record<string, unknown[]> = {};
  for (const [t, key] of [["family_play_leases", "id"], ["family_play_allowances", "person_id"], ["family_chess_allowances", "person_id, date"]]) out[t] = (await c.execute(`SELECT * FROM ${t} ORDER BY ${key}`)).rows.map((r) => ({ ...r }));
  return out;
}

/** Counts database requests as the HTTP client sends them; `failOnBatch` makes the n-th transaction batch throw. */
function counting(raw: Client, opts: { failOnBatch?: number } = {}) {
  const counter = { requests: 0, batches: 0 };
  const wrapTx = (tx: Transaction) => new Proxy(tx, {
    get(t, k) {
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      if (k === "batch") return async (stmts: unknown) => { counter.requests += 1; counter.batches += 1; if (opts.failOnBatch === counter.batches) throw new Error("injected failure"); return (v as (s: unknown) => unknown).call(t, stmts); };
      if (k === "execute" || k === "commit" || k === "rollback") return (...a: unknown[]) => { counter.requests += 1; return (v as (...x: unknown[]) => unknown).apply(t, a); };
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  const client = new Proxy(raw, {
    get(t, k) {
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      if (k === "execute" || k === "batch") return (...a: unknown[]) => { counter.requests += 1; return (v as (...x: unknown[]) => unknown).apply(t, a); };
      if (k === "transaction") return async (...a: unknown[]) => wrapTx(await (v as (...x: unknown[]) => Promise<Transaction>).apply(t, a));
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  }) as Client;
  return { client, counter };
}

type Scenario = { name: string; leaseId: string; seed: (c: Client) => Promise<void> };
const scenarios: Scenario[] = [
  { name: "active-first-read", leaseId: "lease-ar01-first", seed: async (c) => issue(c, "lease-ar01-first", at(-10_000)) },
  { name: "active-warm", leaseId: "lease-ar01-warm", seed: async (c) => { await issue(c, "lease-ar01-warm", at(-10_000)); await recordLeaseActivation("lease-ar01-warm", at(-1_000), c); } },
  { name: "pending-handover", leaseId: "lease-ar01-B", seed: async (c) => { await issue(c, "lease-ar01-A", at(-20_000)); await recordLeaseActivation("lease-ar01-A", at(-1_000), c); await issue(c, "lease-ar01-B", at(-500), "deimos-rising", true); } },
  { name: "ended-never-activated", leaseId: "lease-ar01-left", seed: async (c) => { await issue(c, "lease-ar01-left", at(-30_000)); await endPlayLease({ leaseId: "lease-ar01-left", personId: "santiago", reason: "left", now: at(-20_000) }, c); } },
  { name: "ended-activated-unsettled", leaseId: "lease-ar01-rel", seed: async (c) => { await issue(c, "lease-ar01-rel", at(-60_000)); await recordLeaseActivation("lease-ar01-rel", at(-50_000), c); await endPlayLease({ leaseId: "lease-ar01-rel", personId: "santiago", reason: "left", now: at(-20_000) }, c); await issue(c, "lease-ar01-next", at(-5_000)); } },
  { name: "final-settled", leaseId: "lease-ar01-done", seed: async (c) => { await issue(c, "lease-ar01-done", at(-60_000)); await recordLeaseActivation("lease-ar01-done", at(-50_000), c); await settlePlayLease({ leaseId: "lease-ar01-done", consumedSeconds: 10, end: true, endReason: "left", measuredAt: at(-30_000).getTime(), now: at(-30_000) }, c); } },
  { name: "exhausted", leaseId: "lease-ar01-exh", seed: async (c) => { await issue(c, "lease-ar01-exh", at(-1_000_000)); await recordLeaseActivation("lease-ar01-exh", at(-999_000), c); await settlePlayLease({ leaseId: "lease-ar01-exh", consumedSeconds: 900, end: false, measuredAt: at(-60_000).getTime(), now: at(-60_000) }, c); } },
  { name: "chess-active", leaseId: "lease-ar01-chess", seed: async (c) => { await approveToday(c); await issue(c, "lease-ar01-paid-old", at(-90_000)); await recordLeaseActivation("lease-ar01-paid-old", at(-80_000), c); await endPlayLease({ leaseId: "lease-ar01-paid-old", personId: "santiago", reason: "left", now: at(-70_000) }, c); await issue(c, "lease-ar01-chess", at(-10_000), DAILY_CHESS_GAME_ID); await recordLeaseActivation("lease-ar01-chess", at(-2_000), c); } },
  { name: "chess-day-ended", leaseId: "lease-ar01-chess-y", seed: async (c) => { await c.execute("INSERT INTO family_completions (person_id, routine_id, week, day, status, created_at, reviewed_at, awarded_points, approval_source) VALUES ('santiago', 's-kumon', '2026-W41', 2, 'done', '2026-10-07T06:00:00.000Z', '2026-10-07T07:00:00.000Z', 1, 'parent-review')"); await issue(c, "lease-ar01-chess-y", new Date("2026-10-07T20:00:00.000Z"), DAILY_CHESS_GAME_ID); await recordLeaseActivation("lease-ar01-chess-y", new Date("2026-10-07T20:00:01.000Z"), c); } },
  { name: "unknown-lease", leaseId: "lease-ar01-nobody", seed: async (c) => { await issue(c, "lease-ar01-someone", at(-10_000)); } },
];

const observations: Record<string, unknown> = {};
describe("AR01 consolidated meter status read = former two-step read (cloned databases)", () => {
  after(() => {
    if (process.env.CONSOLIDATED_GATE_OBSERVATIONS) writeFileSync(process.env.CONSOLIDATED_GATE_OBSERVATIONS, `${JSON.stringify({ AR01: observations }, null, 2)}\n`);
  });

  it("every state: same answer and same rows; warm active read 12 → 3 database requests; injected failure rolls back, retry matches", async () => {
    let answersEqualAll = true;
    let rowsEqualAll = true;
    const perState: Record<string, unknown> = {};
    for (const s of scenarios) {
      const seedPath = file();
      const seed = await base(seedPath);
      await s.seed(seed);
      const oldPath = file();
      const newPath = file();
      await seed.execute({ sql: "VACUUM INTO ?", args: [oldPath] });
      await seed.execute({ sql: "VACUUM INTO ?", args: [newPath] });
      seed.close();
      const oldRaw = createClient({ url: `file:${oldPath}` });
      const newRaw = createClient({ url: `file:${newPath}` });
      const o = counting(oldRaw);
      const m = counting(newRaw);
      await ensurePlayTables(o.client);
      await ensurePlayTables(m.client);
      o.counter.requests = 0;
      m.counter.requests = 0;
      await recordLeaseActivation(s.leaseId, NOW, o.client);
      const oldAnswer = await getLeaseStatus(s.leaseId, o.client, NOW);
      const newAnswer = await readLeaseStatusForMeter(s.leaseId, NOW, m.client);
      const answersEqual = JSON.stringify(oldAnswer) === JSON.stringify(newAnswer);
      const rowsEqual = JSON.stringify(await dump(oldRaw)) === JSON.stringify(await dump(newRaw));
      if (!answersEqual) deepEqual(newAnswer, oldAnswer, s.name);
      if (!rowsEqual) deepEqual(await dump(newRaw), await dump(oldRaw), s.name);
      answersEqualAll &&= answersEqual;
      rowsEqualAll &&= rowsEqual;
      perState[s.name] = { state: newAnswer?.state ?? null, oldRequests: o.counter.requests, newRequests: m.counter.requests };
      oldRaw.close();
      newRaw.close();
    }
    // Injected failure in the second batch (active warm): nothing persists; a retry then matches the former read.
    const s = scenarios[1];
    const seedPath = file();
    const seed = await base(seedPath);
    await s.seed(seed);
    const [failPath, refPath] = [file(), file()];
    await seed.execute({ sql: "VACUUM INTO ?", args: [failPath] });
    await seed.execute({ sql: "VACUUM INTO ?", args: [refPath] });
    seed.close();
    const failRaw = createClient({ url: `file:${failPath}` });
    const refRaw = createClient({ url: `file:${refPath}` });
    const before = JSON.stringify(await dump(failRaw));
    const faulty = counting(failRaw, { failOnBatch: 2 });
    await rejects(readLeaseStatusForMeter(s.leaseId, NOW, faulty.client), /injected failure/);
    const failedTransactionRolledBack = JSON.stringify(await dump(failRaw)) === before;
    const retry = await readLeaseStatusForMeter(s.leaseId, NOW, failRaw);
    await recordLeaseActivation(s.leaseId, NOW, refRaw);
    const reference = await getLeaseStatus(s.leaseId, refRaw, NOW);
    const retryAfterFailureEqual = JSON.stringify(retry) === JSON.stringify(reference) && JSON.stringify(await dump(failRaw)) === JSON.stringify(await dump(refRaw));
    failRaw.close();
    refRaw.close();
    const warm = perState["active-warm"] as { oldRequests: number; newRequests: number };
    Object.assign(observations, {
      statesCompared: scenarios.length,
      states: scenarios.map((x) => x.name).join(","),
      answersEqualAll,
      rowsEqualAll,
      activeWarmRoundTripsBefore: warm.oldRequests,
      activeWarmRoundTripsAfter: warm.newRequests,
      failedTransactionRolledBack,
      retryAfterFailureEqual,
      perState,
    });
    equal(warm.newRequests, 3);
    ok(failedTransactionRolledBack && retryAfterFailureEqual);
  });
});
