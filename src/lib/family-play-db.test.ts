// Family-owned paid play persistence (GP-02/GP-03/GP-07/GP-09): isolated SQLite, concurrency, idempotency, compensation,
// single active lease, monotonic settlement. SYNTHETIC rows only. Run: npm test

import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import {
  endPlayLease,
  ensurePlayTables,
  getLeaseStatus,
  getLeasesForPerson,
  recordLeaseActivation,
  getPlayState,
  issuePlayLease,
  purchasePlayBlock,
  refundPlayPurchase,
  settlePlayLease,
} from "./family-play-db.ts";
import { PLAY_PURCHASE_REWARD_ID } from "./family-play.ts";

const dir = mkdtempSync(join(tmpdir(), "family-play-db-"));
let n = 0;
const clients: Client[] = [];

async function fresh(opts: { santiagoCoins?: number; isabelCoins?: number } = {}): Promise<Client> {
  const client = createClient({ url: `file:${join(dir, `db-${(n += 1)}.sqlite`)}` });
  clients.push(client);
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute(`CREATE TABLE family_completions (person_id TEXT NOT NULL, routine_id TEXT NOT NULL, week TEXT NOT NULL, day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'done', note TEXT, challenge TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, credit_count INTEGER NOT NULL DEFAULT 1, awarded_points INTEGER, normalized_summary TEXT, PRIMARY KEY (person_id, routine_id, week, day))`);
  await client.execute(`CREATE TABLE family_reward_redemptions (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, reward_id TEXT NOT NULL, week TEXT NOT NULL, created_at TEXT NOT NULL, charged_points INTEGER)`);
  await ensurePlayTables(client);
  const seed = async (person: string, coins: number) => {
    for (let i = 0; i < coins; i += 1) {
      await client.execute({ sql: "INSERT INTO family_completions (person_id, routine_id, week, day, status, created_at, awarded_points) VALUES (?, 'fixture', '2026-W40', ?, 'done', '2026-09-28T10:00:00.000Z', 1)", args: [person, i % 7 === 0 ? 0 : i] }).catch(async () => {
        await client.execute({ sql: "UPDATE family_completions SET awarded_points = awarded_points + 1 WHERE person_id = ? AND routine_id = 'fixture' AND week = '2026-W40' AND day = 0", args: [person] });
      });
    }
  };
  await seed("santiago", opts.santiagoCoins ?? 7);
  await seed("isabel", opts.isabelCoins ?? 2);
  return client;
}

after(() => {
  for (const client of clients) client.close();
  rmSync(dir, { recursive: true, force: true });
});

let ids = 0;
const id = (p: string) => `${p}-${String((ids += 1)).padStart(8, "0")}`;
const T0 = Date.UTC(2026, 9, 4, 10, 0, 0);
const at = (sec: number) => new Date(T0 + sec * 1000);

describe("purchase — one atomic debit + durable grant (GP-02)", () => {
  it("debits 3 coins as a wallet redemption row and grants 900 seconds in one transaction", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    const before = await getPlayState("santiago", client);
    equal(before.balance, 7);
    equal(before.remainingSeconds, 0);
    const out = await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-aaaaaaaa", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    ok(out.ok && !out.replayed);
    equal(out.balance, 4);
    equal(out.remainingSeconds, 900);
    const rows = await client.execute("SELECT reward_id, charged_points FROM family_reward_redemptions");
    deepEqual(rows.rows.map((r) => [r.reward_id, Number(r.charged_points)]), [[PLAY_PURCHASE_REWARD_ID, 3]]);
    const after = await getPlayState("santiago", client);
    equal(after.balance, 4);
    equal(after.remainingSeconds, 900);
  });

  it("insufficient funds leaves no debit, no purchase and no grant", async () => {
    const client = await fresh({ isabelCoins: 2 });
    const out = await purchasePlayBlock({ personId: "isabel", idempotencyKey: "key-bbbbbbbb", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    deepEqual(out, { ok: false, reason: "insufficient-funds", balance: 2, remainingSeconds: 0 });
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_reward_redemptions")).rows[0].n), 0);
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_play_purchases")).rows[0].n), 0);
    equal((await getPlayState("isabel", client)).remainingSeconds, 0);
  });

  it("a retry with the same idempotency key replays the committed purchase without a second charge", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    const first = await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-cccccccc", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const second = await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-cccccccc", purchaseId: id("p"), redemptionId: id("r"), now: at(5) }, client);
    ok(first.ok && second.ok && second.replayed);
    equal(second.purchase.id, first.purchase.id);
    equal(second.balance, 4);
    equal(second.remainingSeconds, 900);
  });

  it("concurrent purchases with a balance for only one commit exactly one debit", async () => {
    const client = await fresh({ santiagoCoins: 4 });
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        purchasePlayBlock({ personId: "santiago", idempotencyKey: `key-concurrent-${i}`, purchaseId: id("p"), redemptionId: id("r"), now: at(i) }, client),
      ),
    );
    const committed = attempts.filter((a) => a.ok && !a.replayed);
    equal(committed.length, 1);
    ok(attempts.filter((a) => !a.ok).every((a) => !a.ok && (a.reason === "insufficient-funds" || a.reason === "conflict")));
    const state = await getPlayState("santiago", client);
    equal(state.balance, 1);
    equal(state.remainingSeconds, 900);
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_reward_redemptions")).rows[0].n), 1);
  });

  it("the same key fired concurrently also charges once", async () => {
    const client = await fresh({ santiagoCoins: 9 });
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-samekey-1", purchaseId: id("p"), redemptionId: id("r"), now: at(i) }, client),
      ),
    );
    const committed = attempts.filter((a) => a.ok && !a.replayed);
    equal(committed.length, 1);
    const state = await getPlayState("santiago", client);
    equal(state.balance, 6);
    equal(state.remainingSeconds, 900);
  });

  it("allowance is per child: a sibling's purchase never funds the other", async () => {
    const client = await fresh({ santiagoCoins: 7, isabelCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-dddddddd", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    equal((await getPlayState("isabel", client)).remainingSeconds, 0);
    equal((await getPlayState("isabel", client)).balance, 7);
  });
});

describe("compensation — exactly once (GP-07)", () => {
  it("refunds a committed purchase once: debit row removed, unconsumed grant withdrawn, second refund is a no-op", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    const purchase = await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-eeeeeeee", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    ok(purchase.ok);
    const first = await refundPlayPurchase({ purchaseId: purchase.purchase.id, reason: "issuance failed", now: at(10) }, client);
    ok(first.ok && first.purchase.state === "refunded");
    const state = await getPlayState("santiago", client);
    equal(state.balance, 7);
    equal(state.remainingSeconds, 0);
    deepEqual(await refundPlayPurchase({ purchaseId: purchase.purchase.id, reason: "again", now: at(11) }, client), { ok: false, reason: "already-refunded" });
    equal((await getPlayState("santiago", client)).balance, 7);
    deepEqual(await refundPlayPurchase({ purchaseId: "missing", reason: "x" }, client), { ok: false, reason: "not-found" });
  });

  it("a refund after partial consumption keeps the consumed part accounted (no negative remaining)", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    const purchase = await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-ffffffff", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    ok(purchase.ok);
    const lease = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "desk", now: at(1) }, client);
    ok(lease.ok);
    await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 300, end: true, now: at(301) }, client);
    await refundPlayPurchase({ purchaseId: purchase.purchase.id, reason: "ops", now: at(400) }, client);
    const state = await getPlayState("santiago", client);
    equal(state.remainingSeconds, 0);
    equal(state.allowance.grantedSeconds, 300);
    equal(state.allowance.consumedSeconds, 300);
  });
});

describe("leases — one consuming lease per child, shared across paid games (GP-03/GP-08)", () => {
  it("refuses a metered lease without allowance and grants a free one", async () => {
    const client = await fresh();
    const paid = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(0) }, client);
    deepEqual(paid, { ok: false, reason: "no-allowance", remainingSeconds: 0 });
    const chess = await issuePlayLease({ personId: "santiago", gameId: "adaptive-chess-coach", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(0) }, client);
    ok(chess.ok && !chess.lease.metered && chess.lease.budgetSeconds === 0);
    const edit = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "edit", leaseId: id("lease"), takeover: true, deviceLabel: null, now: at(1) }, client);
    ok(edit.ok && !edit.lease.metered);
  });

  it("the budget is the remaining allowance; a second device cannot take a parallel lease without takeover", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-gggggggg", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const ipad = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "iPad", now: at(1) }, client);
    ok(ipad.ok && ipad.lease.budgetSeconds === 900);
    const settled = await settlePlayLease({ leaseId: ipad.lease.id, consumedSeconds: 200, end: false, now: at(201) }, client);
    ok(settled.ok && settled.remainingSeconds === 700);
    const mac = await issuePlayLease({ personId: "santiago", gameId: "other-paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "Mac", now: at(205) }, client);
    ok(!mac.ok && mac.reason === "lease-held" && mac.heldBy?.leaseId === ipad.lease.id);
    const takeover = await issuePlayLease({ personId: "santiago", gameId: "other-paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "Mac", now: at(206) }, client);
    // 700 remain, but the iPad may still report the 5 s since its last settlement: budget 695, reserve 5 (exact wall time, no slack).
    ok(takeover.ok && takeover.replaced === ipad.lease.id && takeover.lease.budgetSeconds === 695 && takeover.lease.reserveSeconds === 5, JSON.stringify(takeover));
    const leases = await getLeasesForPerson("santiago", client);
    deepEqual(leases.map((l) => l.state), ["ended", "active"]);
    equal(leases[0].endReason, "replaced-by-takeover");
    // A late report from the replaced lease is bounded by the cap frozen when Family ended it (200 settled + 5 s elapsed = 205):
    // claiming 250 is clamped to 205, so the iPad can never bill more than it could lawfully have measured.
    const late = await settlePlayLease({ leaseId: ipad.lease.id, consumedSeconds: 250, end: true, now: at(230) }, client);
    ok(late.ok && late.delta === 5 && late.lease.consumedSeconds === 205, JSON.stringify(late));
    equal((await getPlayState("santiago", client)).remainingSeconds, 695);
    // …and the successor's budget is reconciled to the real remaining allowance once the predecessor is final.
    const succ = (await getLeasesForPerson("santiago", client)).find((l) => l.id === takeover.lease.id)!;
    equal(succ.budgetSeconds, 695);
    equal(succ.reserveSeconds, 0);
  });

  it("GP-03 a takeover holds back the predecessor's possible unsettled time, so two devices never share more than the allowance", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-takeover-2", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const first = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "iPad", now: at(1) }, client);
    ok(first.ok);
    // 100 s settled, then 40 more seconds of play that the meter has NOT settled yet.
    await settlePlayLease({ leaseId: first.lease.id, consumedSeconds: 100, end: false, now: at(101) }, client);
    const second = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "Mac", now: at(141) }, client);
    ok(second.ok);
    // remaining 800, but up to 40 s may still be reported by the iPad → successor budget 760, reserve 40
    equal(second.lease.budgetSeconds, 760);
    equal(second.lease.reserveSeconds, 40);
    equal(second.lease.predecessorId, first.lease.id);
    // The iPad's final report says it actually played 25 of those 40 seconds: the successor gets the 15 back.
    const final = await settlePlayLease({ leaseId: first.lease.id, consumedSeconds: 125, end: true, endReason: "ended", now: at(150) }, client);
    ok(final.ok && final.delta === 25);
    const succ = (await getLeasesForPerson("santiago", client)).find((l) => l.id === second.lease.id)!;
    equal(succ.budgetSeconds, 775);
    equal(succ.reserveSeconds, 0);
    equal((await getPlayState("santiago", client)).remainingSeconds, 775);
    // Sum of what both devices could ever consume never exceeds the purchase.
    ok(125 + succ.budgetSeconds <= 900);
  });

  it("GP-03/07 conservation over a chain A→B→C: ancestor reserves persist, a late ancestor report shrinks the live cap, totals never exceed the grant", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-chain-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const a = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "A", now: at(1) }, client);
    const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "B", now: at(31) }, client);
    const c = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "C", now: at(36) }, client);
    if (!a.ok || !b.ok || !c.ok) throw new Error("lease issue failed");
    // A never settled: it may still report its 30 s; B likewise its 5 s. C must leave both untouched — ancestors included.
    equal(b.lease.budgetSeconds, 870);
    equal(c.lease.budgetSeconds, 865);
    // A's late final report (an hour later) is applied within its frozen cap; B's 5 s stay reserved (no expiry) so C is 865, not 870.
    const lateA = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 30, end: true, endReason: "left", now: at(3601) }, client);
    ok(lateA.ok && lateA.delta === 30);
    const cAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === c.lease.id)!;
    equal(cAfter.budgetSeconds, 865);
    // C reports more than everything: clamped to its cap and to the allowance; the sum of accepted per-lease seconds never exceeds 900.
    const cFinal = await settlePlayLease({ leaseId: c.lease.id, consumedSeconds: 895, end: true, now: at(4000) }, client);
    ok(cFinal.ok);
    const total = Number((await client.execute("SELECT SUM(consumed_seconds) AS n FROM family_play_leases WHERE person_id = 'santiago'")).rows[0].n);
    ok(total <= 900, `total accepted ${total}`);
    // B's very late report is clamped to its frozen cap (5 s) and fits exactly the reserved room: the total lands on 900, never above.
    const lateB = await settlePlayLease({ leaseId: b.lease.id, consumedSeconds: 20, end: true, now: at(4100) }, client);
    ok(lateB.ok && lateB.delta === 5 && lateB.lease.consumedSeconds === 5, JSON.stringify(lateB));
    equal(Number((await client.execute("SELECT SUM(consumed_seconds) AS n FROM family_play_leases WHERE person_id = 'santiago'")).rows[0].n), 900);
    equal((await getPlayState("santiago", client)).remainingSeconds, 0);
  });

  it("GP-03 a never-activated lease releases its reserve once the meter's status read proves it can no longer report", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-neveract-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const a = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "A", now: at(1) }, client);
    // The frame never loaded on A; ten minutes later the child plays on B.
    const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "B", now: at(601) }, client);
    if (!a.ok || !b.ok) throw new Error("issue failed");
    equal(b.lease.budgetSeconds, 300, "A's unknown 600 s are reserved until Family knows A never ran");
    // The adapter validates B (status read): Family learns A was never activated and releases its reserve.
    await recordLeaseActivation(b.lease.id, at(602), client);
    const bAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === b.lease.id)!;
    equal(bAfter.budgetSeconds, 900);
    equal(bAfter.reserveSeconds, 0);
    // An activated-then-replaced lease keeps its reserve until its meter reports.
    await recordLeaseActivation(b.lease.id, at(603), client);
    const c = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "C", now: at(650) }, client);
    if (!c.ok) throw new Error("issue failed");
    equal(c.lease.budgetSeconds, 900 - 49, "B ran from 601 to 650: 49 s reserved");
    await recordLeaseActivation(c.lease.id, at(651), client);
    equal((await getLeasesForPerson("santiago", client)).find((l) => l.id === c.lease.id)!.budgetSeconds, 900 - 49, "B was activated: its reserve stays until it reports");
  });

  it("GP-03/07 an ordinary release followed by a fresh lease reserves the released meter's pending report", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-release-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const a = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "A", now: at(1) }, client);
    if (!a.ok) throw new Error("lease issue failed");
    equal(await endPlayLease({ leaseId: a.lease.id, personId: "santiago", reason: "left", now: at(31) }, client), true);
    const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "B", now: at(31) }, client);
    if (!b.ok) throw new Error("lease issue failed");
    ok(b.lease.budgetSeconds <= 870, `B ${b.lease.budgetSeconds}`);
    const lateA = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 30, end: true, now: at(3600) }, client);
    ok(lateA.ok && lateA.delta === 30);
    const bAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === b.lease.id)!;
    equal(bAfter.budgetSeconds, 870);
    equal((await getPlayState("santiago", client)).remainingSeconds, 870);
    // A's cap was frozen at release (30 s): a report claiming far more than it could have measured is clamped to that cap.
    const bogus = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 800, end: true, now: at(3700) }, client);
    if (!bogus.ok) throw new Error("settle failed");
    equal(bogus.lease.consumedSeconds, 30);
  });

  it("GP-07 a report that arrives long after a lease ended (offline/restart) is applied, bounded, and the status read reflects it", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-late-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const lease = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(1) }, client);
    ok(lease.ok);
    equal(await endPlayLease({ leaseId: lease.lease.id, personId: "santiago", reason: "released", now: at(60) }, client), true);
    const late = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 50, end: true, now: at(60 + 3600) }, client);
    ok(late.ok && late.delta === 50 && late.lease.state === "ended");
    const status = await getLeaseStatus(lease.lease.id, client);
    ok(status && status.state === "ended" && status.consumedSeconds === 50 && status.remainingSeconds === 850);
    equal(await getLeaseStatus("lease-nope", client), null);
  });

  it("settlement is monotonic, exhaustion ends the lease, and the allowance never goes below zero", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-hhhhhhhh", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const lease = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(1) }, client);
    ok(lease.ok);
    const a = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 500, end: false, now: at(500) }, client);
    const b = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 400, end: false, now: at(510) }, client);
    ok(a.ok && b.ok && b.delta === 0 && b.lease.consumedSeconds === 500);
    const c = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 5000, end: false, now: at(900) }, client);
    ok(c.ok && c.lease.state === "ended" && c.lease.consumedSeconds === 900 && c.remainingSeconds === 0);
    equal(c.lease.endReason, "exhausted");
    // A late/replayed report minutes after the end is accepted but can only move forward within the budget: nothing changes.
    const replay = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 900, end: true, now: at(1000) }, client);
    ok(replay.ok && replay.delta === 0 && replay.lease.state === "ended");
    equal((await getPlayState("santiago", client)).remainingSeconds, 0);
    deepEqual(await settlePlayLease({ leaseId: "nope", consumedSeconds: 1, end: false }, client), { ok: false, reason: "not-found" });
  });

  it("a child may end only their own lease; a stale lease is replaced on the next issue", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-iiiiiiii", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const lease = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(1) }, client);
    ok(lease.ok);
    equal(await endPlayLease({ leaseId: lease.lease.id, personId: "isabel", reason: "sibling", now: at(2) }, client), false);
    equal(await endPlayLease({ leaseId: lease.lease.id, personId: "santiago", reason: "left", now: at(3) }, client), true);
    const again = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(4) }, client);
    ok(again.ok && again.replaced === null);
    const stale = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "later", now: at(4 + 11 * 60) }, client);
    ok(stale.ok && stale.replaced === again.lease.id);
  });

  it("existing wallet history is untouched by play tables (GP-09): completions and non-play redemptions keep their rows", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await client.execute("INSERT INTO family_reward_redemptions (id, person_id, reward_id, week, created_at, charged_points) VALUES ('old-1', 'santiago', 'mini-game', '2026-W38', '2026-09-20T10:00:00.000Z', 2)");
    const before = await client.execute("SELECT COUNT(*) AS n FROM family_completions");
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-jjjjjjjj", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const after = await client.execute("SELECT COUNT(*) AS n FROM family_completions");
    equal(Number(after.rows[0].n), Number(before.rows[0].n));
    const old = await client.execute("SELECT charged_points FROM family_reward_redemptions WHERE id = 'old-1'");
    equal(Number(old.rows[0].charged_points), 2);
    equal((await getPlayState("santiago", client)).balance, 7 - 2 - 3);
  });
});
