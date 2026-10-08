// Family-owned paid play persistence (GP-02/GP-03/GP-07/GP-09): isolated SQLite, concurrency, idempotency, compensation,
// single active lease, monotonic settlement. SYNTHETIC rows only. Run: npm test

import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import {
  LATE_TERMINAL_CORRECTION_SECONDS,
  chessQualifyingApproval,
  chessStatusFor,
  endPlayLease,
  ensurePlayTables,
  getLease,
  getLeaseStatus,
  getLeasesForPerson,
  lockChessIfIneligible,
  recordLeaseActivation,
  getPlayState,
  issuePlayLease,
  purchasePlayBlock,
  refundPlayPurchase,
  settlePlayLease,
} from "./family-play-db.ts";
import { DAILY_CHESS_GAME_ID, PLAY_PURCHASE_REWARD_ID, STUDIO_SCOPE_GAME_ID } from "./family-play.ts";
import { familyTodayInZurich } from "./date.ts";

const dir = mkdtempSync(join(tmpdir(), "family-play-db-"));
let n = 0;
const clients: Client[] = [];

async function fresh(opts: { santiagoCoins?: number; isabelCoins?: number } = {}): Promise<Client> {
  const client = createClient({ url: `file:${join(dir, `db-${(n += 1)}.sqlite`)}` });
  clients.push(client);
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute(`CREATE TABLE family_completions (person_id TEXT NOT NULL, routine_id TEXT NOT NULL, week TEXT NOT NULL, day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'done', note TEXT, challenge TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, credit_count INTEGER NOT NULL DEFAULT 1, awarded_points INTEGER, normalized_summary TEXT, approval_source TEXT, PRIMARY KEY (person_id, routine_id, week, day))`);
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
    await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 300, end: true, measuredAt: at(301).getTime(), now: at(301) }, client);
    await refundPlayPurchase({ purchaseId: purchase.purchase.id, reason: "ops", now: at(400) }, client);
    const state = await getPlayState("santiago", client);
    equal(state.remainingSeconds, 0);
    equal(state.allowance.grantedSeconds, 300);
    equal(state.allowance.consumedSeconds, 300);
  });
});

describe("leases — one consuming lease per child, shared across paid games (GP-03/GP-08)", () => {
  it("October 8: nothing is unmetered — paid play and the Studio editor need coin allowance; chess needs today's approval (never coins)", async () => {
    const client = await fresh();
    const paid = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(0) }, client);
    deepEqual(paid, { ok: false, reason: "no-allowance", remainingSeconds: 0 });
    const edit = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "edit", leaseId: id("lease"), takeover: true, deviceLabel: null, now: at(1) }, client);
    deepEqual(edit, { ok: false, reason: "no-allowance", remainingSeconds: 0 }, "no free editor");
    const chess = await issuePlayLease({ personId: "santiago", gameId: DAILY_CHESS_GAME_ID, mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(0) }, client);
    deepEqual(chess, { ok: false, reason: "chess-not-earned", remainingSeconds: 0 }, "7 coins in the wallet buy no chess");
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_chess_allowances")).rows[0].n), 0, "no grant row without eligibility");
  });

  it("the Studio editor lease is a metered lease on the paid allowance with the `*` game id, exclusive with play (one lease per child)", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-studio-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const studio = await issuePlayLease({ personId: "santiago", gameId: "ignored-when-editing", mode: "edit", leaseId: id("lease"), takeover: false, deviceLabel: "iPad", now: at(1) }, client);
    ok(studio.ok, JSON.stringify(studio));
    equal(studio.lease.gameId, STUDIO_SCOPE_GAME_ID);
    equal(studio.lease.mode, "edit");
    equal(studio.lease.metered, true);
    equal(studio.lease.budgetKind, "paid");
    equal(studio.lease.budgetSeconds, 900);
    // Play while editing is held (single lease), and vice versa after a takeover.
    const play = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "Mac", now: at(2) }, client);
    ok(!play.ok && play.reason === "lease-held");
    // Editing consumes the SAME allowance: 100 s of editing leaves 800 s for play.
    const settled = await settlePlayLease({ leaseId: studio.lease.id, consumedSeconds: 100, end: true, measuredAt: at(101).getTime(), now: at(101) }, client);
    ok(settled.ok && settled.remainingSeconds === 800);
    const next = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "Mac", now: at(102) }, client);
    ok(next.ok && next.lease.budgetSeconds === 800, JSON.stringify(next));
    // The status read tells the meter which budget it is (informational) and the paid remaining.
    const status = await getLeaseStatus(next.lease.id, client, at(103));
    equal(status?.budgetKind, "paid");
    equal(status?.remainingSeconds, 800);
  });

  it("the budget is the remaining allowance; a second device cannot take a parallel lease without takeover", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-gggggggg", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const ipad = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "iPad", now: at(1) }, client);
    ok(ipad.ok && ipad.lease.budgetSeconds === 900);
    const settled = await settlePlayLease({ leaseId: ipad.lease.id, consumedSeconds: 200, end: false, measuredAt: at(201).getTime(), now: at(201) }, client);
    ok(settled.ok && settled.remainingSeconds === 700);
    const mac = await issuePlayLease({ personId: "santiago", gameId: "other-paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "Mac", now: at(205) }, client);
    ok(!mac.ok && mac.reason === "lease-held" && mac.heldBy?.leaseId === ipad.lease.id);
    const takeover = await issuePlayLease({ personId: "santiago", gameId: "other-paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "Mac", now: at(206) }, client);
    // 700 remain, but the iPad may still report the 5 s since its last settlement: budget 695, reserve 5 (exact wall time, no slack).
    ok(takeover.ok && takeover.replaced === ipad.lease.id && takeover.lease.budgetSeconds === 695 && takeover.lease.reserveSeconds === 5, JSON.stringify(takeover));
    const leases = await getLeasesForPerson("santiago", client);
    deepEqual(leases.map((l) => l.state), ["ended", "active"]);
    equal(leases[0].endReason, "replaced-by-takeover");
    // A late report from the replaced lease is bounded by the cap frozen when Family ended it (200 settled + 5 s elapsed = 205)
    // plus the bounded overlap tolerance (15 s): claiming 250 is clamped to 220 and the 30 s beyond are refused and surfaced.
    const late = await settlePlayLease({ leaseId: ipad.lease.id, consumedSeconds: 250, end: true, measuredAt: at(230).getTime(), now: at(230) }, client);
    ok(late.ok && late.delta === 20 && late.lease.consumedSeconds === 220 && late.refusedSeconds === 30, JSON.stringify(late));
    equal((await getPlayState("santiago", client)).remainingSeconds, 680);
    // …and the successor's budget is reconciled to the real remaining allowance once the predecessor is final.
    const succ = (await getLeasesForPerson("santiago", client)).find((l) => l.id === takeover.lease.id)!;
    equal(succ.budgetSeconds, 680);
    equal(succ.reserveSeconds, 0);
  });

  it("GP-03 a takeover holds back the predecessor's possible unsettled time, so two devices never share more than the allowance", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-takeover-2", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const first = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "iPad", now: at(1) }, client);
    ok(first.ok);
    // 100 s settled, then 40 more seconds of play that the meter has NOT settled yet.
    await settlePlayLease({ leaseId: first.lease.id, consumedSeconds: 100, end: false, measuredAt: at(101).getTime(), now: at(101) }, client);
    const second = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "Mac", now: at(141) }, client);
    ok(second.ok);
    // remaining 800, but up to 40 s may still be reported by the iPad → successor budget 760, reserve 40
    equal(second.lease.budgetSeconds, 760);
    equal(second.lease.reserveSeconds, 40);
    equal(second.lease.predecessorId, first.lease.id);
    // The iPad's final report says it actually played 25 of those 40 seconds: the successor gets the 15 back.
    const final = await settlePlayLease({ leaseId: first.lease.id, consumedSeconds: 125, end: true, endReason: "ended", measuredAt: at(150).getTime(), now: at(150) }, client);
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
    const lateA = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 30, end: true, endReason: "left", measuredAt: at(31).getTime(), now: at(3601) }, client);
    ok(lateA.ok && lateA.delta === 30);
    const cAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === c.lease.id)!;
    equal(cAfter.budgetSeconds, 865);
    // C reports more than everything: clamped to its cap and to the allowance; the sum of accepted per-lease seconds never exceeds 900.
    const cFinal = await settlePlayLease({ leaseId: c.lease.id, consumedSeconds: 895, end: true, measuredAt: at(4000).getTime(), now: at(4000) }, client);
    ok(cFinal.ok);
    const total = Number((await client.execute("SELECT SUM(consumed_seconds) AS n FROM family_play_leases WHERE person_id = 'santiago'")).rows[0].n);
    ok(total <= 900, `total accepted ${total}`);
    // B's very late report is clamped to its frozen cap (5 s) and fits exactly the reserved room: the total lands on 900, never above.
    const lateB = await settlePlayLease({ leaseId: b.lease.id, consumedSeconds: 20, end: true, measuredAt: at(4100).getTime(), now: at(4100) }, client);
    ok(lateB.ok && lateB.delta === 5 && lateB.lease.consumedSeconds === 5, JSON.stringify(lateB));
    equal(Number((await client.execute("SELECT SUM(consumed_seconds) AS n FROM family_play_leases WHERE person_id = 'santiago'")).rows[0].n), 900);
    equal((await getPlayState("santiago", client)).remainingSeconds, 0);
  });

  it("GP-03/07 receipt time is not measurement time: delayed or duplicate reports never advance the watermark, genuine measured time is conserved and truncation is surfaced", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-watermark-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    // Timeline from the independent review: a 20 s reading measured at t=20 arrives late at t=100; A is released at 101;
    // A's valid final (100 s measured at 100) arrives at 102.
    const a = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "A", now: at(0) }, client);
    if (!a.ok) throw new Error("issue failed");
    await recordLeaseActivation(a.lease.id, at(0), client);
    const late20 = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 20, end: false, measuredAt: at(20).getTime(), now: at(100) }, client);
    ok(late20.ok && late20.lease.measuredAt === at(20).toISOString(), "watermark = measurement time (t=20), not arrival (t=100)");
    equal(await endPlayLease({ leaseId: a.lease.id, personId: "santiago", reason: "left", now: at(101) }, client), true);
    const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "B", now: at(101) }, client);
    if (!b.ok) throw new Error("issue failed");
    equal(b.lease.budgetSeconds, 900 - 101, "A may still report up to 101 s (measured 20 + 81 unreported): B gets 799");
    const final = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 100, end: true, measuredAt: at(100).getTime(), now: at(102) }, client);
    ok(final.ok && final.lease.consumedSeconds === 100 && final.refusedSeconds === 0, JSON.stringify(final));
    const bAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === b.lease.id)!;
    equal(bAfter.budgetSeconds, 800);
    ok(100 + bAfter.budgetSeconds <= 900);
    // Duplicate of an old reading arriving late: watermark unchanged, nothing discarded.
    const client2 = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-watermark-2", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client2);
    const d = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "D", now: at(0) }, client2);
    if (!d.ok) throw new Error("issue failed");
    await settlePlayLease({ leaseId: d.lease.id, consumedSeconds: 20, end: false, measuredAt: at(20).getTime(), now: at(20) }, client2);
    const dup = await settlePlayLease({ leaseId: d.lease.id, consumedSeconds: 20, end: false, measuredAt: at(20).getTime(), now: at(100) }, client2);
    ok(dup.ok && dup.delta === 0 && dup.lease.measuredAt === at(20).toISOString());
    await endPlayLease({ leaseId: d.lease.id, personId: "santiago", reason: "left", now: at(101) }, client2);
    const dFinal = await settlePlayLease({ leaseId: d.lease.id, consumedSeconds: 100, end: true, measuredAt: at(100).getTime(), now: at(102) }, client2);
    ok(dFinal.ok && dFinal.lease.consumedSeconds === 100, JSON.stringify(dFinal));
    // After the final report the cap is frozen at the accepted total. Inside the late-correction window a LATER
    // terminal report may still raise consumption (round 14: a frame's final observation delivered after the meter
    // had to finalize) — bounded by the ceiling that applied at finalization (101 here: cap at the end), the rest
    // refused and surfaced; the lease stays ended and final-settled.
    equal(dFinal.lease.fenceCapSeconds, 101, "the ceiling at finalization is remembered");
    const dOver = await settlePlayLease({ leaseId: d.lease.id, consumedSeconds: 500, end: true, now: at(103) }, client2);
    if (!dOver.ok) throw new Error("settle failed");
    ok(dOver.lease.consumedSeconds === 101 && dOver.refusedSeconds === 399 && dOver.lease.finalSettled && dOver.lease.state === "ended", JSON.stringify({ consumed: dOver.lease.consumedSeconds, refused: dOver.refusedSeconds }));
    // Beyond the window the lease is immutable: refused in full. The window is judged by the reading's own time
    // (`measuredAt`, the meter's observation instant, never later than now): a correction observed inside the window
    // but delivered after it is accepted; one observed after the window is refused even if delivered at once.
    const dLate = await settlePlayLease({ leaseId: d.lease.id, consumedSeconds: 500, end: true, now: at(101 + LATE_TERMINAL_CORRECTION_SECONDS + 1) }, client2);
    if (!dLate.ok) throw new Error("settle failed");
    ok(dLate.lease.consumedSeconds === 101 && dLate.refusedSeconds === 399, JSON.stringify({ consumed: dLate.lease.consumedSeconds, refused: dLate.refusedSeconds }));
    const e2 = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-watermark-3", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, e2);
    const f = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "F", now: at(0) }, e2);
    if (!f.ok) throw new Error("issue failed");
    await recordLeaseActivation(f.lease.id, at(0), e2);
    await endPlayLease({ leaseId: f.lease.id, personId: "santiago", reason: "left", now: at(10) }, e2);
    const fFinal = await settlePlayLease({ leaseId: f.lease.id, consumedSeconds: 2, end: true, measuredAt: at(10).getTime(), now: at(11) }, e2);
    ok(fFinal.ok && fFinal.lease.finalSettled);
    const observedInside = await settlePlayLease({ leaseId: f.lease.id, consumedSeconds: 3, end: true, measuredAt: at(10 + LATE_TERMINAL_CORRECTION_SECONDS).getTime(), now: at(10 + LATE_TERMINAL_CORRECTION_SECONDS + 40) }, e2);
    ok(observedInside.ok && observedInside.lease.consumedSeconds === 3, "observed at end+120 s inclusive, delivered 40 s later: accepted");
    const observedOutside = await settlePlayLease({ leaseId: f.lease.id, consumedSeconds: 4, end: true, measuredAt: at(10 + LATE_TERMINAL_CORRECTION_SECONDS).getTime() + 1, now: at(10 + LATE_TERMINAL_CORRECTION_SECONDS + 41) }, e2);
    ok(observedOutside.ok && observedOutside.lease.consumedSeconds === 3 && observedOutside.refusedSeconds === 1, "observed 1 ms past the window: refused in full");
    // A non-terminal report after finalization never corrects anything.
    const dInterim = await settlePlayLease({ leaseId: d.lease.id, consumedSeconds: 101, end: false, now: at(104) }, client2);
    ok(dInterim.ok && dInterim.delta === 0);
  });

  it("GP-03/07 bounded measured overlap after Family's end is charged to the child and taken from the successor, never refused and handed back", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-overlap-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const a = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "A", now: at(0) }, client);
    if (!a.ok) throw new Error("issue failed");
    await recordLeaseActivation(a.lease.id, at(0), client);
    // Family ends A at t=1; A's meter holds an authority window until t=2 (its status read at t=0), so the
    // end takes effect at t=2 and B is issued with 898 (A may lawfully still report up to its 2 s).
    equal(await endPlayLease({ leaseId: a.lease.id, personId: "santiago", reason: "left", now: at(1) }, client), true);
    const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "B", now: at(1) }, client);
    if (!b.ok) throw new Error("issue failed");
    equal(b.lease.budgetSeconds, 898);
    equal(b.handoverAt, at(2).toISOString(), "B is fenced by A's window");
    // A's meter genuinely measured 3 s (1 s of bounded overlap past the fence): accepted in full, B shrinks to 897 — total stays 900.
    const final = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 3, end: true, measuredAt: at(3).getTime(), now: at(4) }, client);
    if (!final.ok) throw new Error("settle failed");
    equal(final.lease.consumedSeconds, 3);
    equal(final.refusedSeconds, 0);
    const bAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === b.lease.id)!;
    equal(bAfter.budgetSeconds, 897);
    equal(3 + bAfter.budgetSeconds, 900);
    // An inflated report far beyond the tolerance is refused and surfaced; a report measured BEFORE the end gets no overlap at all.
    const client2 = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-overlap-2", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client2);
    const c = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "C", now: at(0) }, client2);
    if (!c.ok) throw new Error("issue failed");
    await endPlayLease({ leaseId: c.lease.id, personId: "santiago", reason: "left", now: at(1) }, client2);
    const bogus = await settlePlayLease({ leaseId: c.lease.id, consumedSeconds: 200, end: false, measuredAt: at(200).getTime(), now: at(201) }, client2);
    if (!bogus.ok) throw new Error("settle failed");
    equal(bogus.lease.consumedSeconds, 1 + 15);
    equal(bogus.refusedSeconds, 200 - 16);
    const d = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "D", now: at(300) }, client2);
    if (!d.ok) throw new Error("issue failed");
    await endPlayLease({ leaseId: d.lease.id, personId: "santiago", reason: "left", now: at(330) }, client2);
    const noMeasure = await settlePlayLease({ leaseId: d.lease.id, consumedSeconds: 900, end: true, now: at(2000) }, client2);
    if (!noMeasure.ok) throw new Error("settle failed");
    equal(noMeasure.lease.consumedSeconds, 30, "without a measurement time the frozen cap never grows");
  });

  it("GP-07 a parent refund revokes the usable budget at once: the live lease is ended and capped in the same transaction", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    const purchase = await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-refund-live", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    ok(purchase.ok);
    const lease = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: null, now: at(1) }, client);
    if (!lease.ok) throw new Error("issue failed");
    await recordLeaseActivation(lease.lease.id, at(1), client);
    await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 10, end: false, measuredAt: at(11).getTime(), now: at(11) }, client);
    const refund = await refundPlayPurchase({ purchaseId: purchase.purchase.id, reason: "parent", now: at(20) }, client);
    ok(refund.ok);
    const state = await getPlayState("santiago", client);
    equal(state.activeLease, null, "no usable lease survives the refund");
    const status = await getLeaseStatus(lease.lease.id, client);
    ok(status && status.state === "ended" && status.endReason === "refunded" && status.budgetSeconds === 10 && status.capSeconds === 10, JSON.stringify(status));
    // A late meter report for it cannot bill beyond the cap.
    const late = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 60, end: true, measuredAt: at(60).getTime(), now: at(61) }, client);
    ok(late.ok && late.lease.consumedSeconds === 10 && late.refusedSeconds === 50);
    equal(state.remainingSeconds, 0);
  });

  it("GP-03/08 authority fence: a Family-side end takes effect at the window's end, the successor is pending until then or until the predecessor's terminal report, and only one lease is ever runnable", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-fence-1", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client);
    const a = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "A", now: at(0) }, client);
    if (!a.ok) throw new Error("issue failed");
    // Before any status read nothing fences: an end would take effect at once.
    equal((await getLeaseStatus(a.lease.id, client, at(0)))!.authorizedForSeconds, null, "no window before the meter's first read");
    // The meter's status read at t=2 grants an exclusive window until t=4.
    await recordLeaseActivation(a.lease.id, at(2), client);
    const granted = (await getLeaseStatus(a.lease.id, client, at(2)))!;
    equal(granted.state, "active");
    equal(granted.authorizedForSeconds, 2);
    equal(granted.authorizedUntil, at(4).toISOString());
    // Family ends A at t=2.5 (release/takeover): effective at the fence t=4, cap frozen at 4 s.
    equal(await endPlayLease({ leaseId: a.lease.id, personId: "santiago", reason: "left", now: at(2.5) }, client), true);
    const aEnded = (await getLeasesForPerson("santiago", client)).find((l) => l.id === a.lease.id)!;
    equal(aEnded.endedAt, at(4).toISOString());
    equal(aEnded.capSeconds, 4);
    const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "B", now: at(2.5) }, client);
    if (!b.ok) throw new Error("issue failed");
    equal(b.handoverAt, at(4).toISOString());
    equal(b.lease.budgetSeconds, 896, "A may lawfully still report up to its fence");
    // Inside the window B is pending for the meter and gets NO window; A's status says ended at the fence.
    await recordLeaseActivation(b.lease.id, at(3), client);
    const pending = (await getLeaseStatus(b.lease.id, client, at(3)))!;
    equal(pending.state, "pending");
    equal(pending.startsAt, at(4).toISOString());
    equal(pending.authorizedForSeconds, null);
    const aStatus = (await getLeaseStatus(a.lease.id, client, at(3)))!;
    equal(aStatus.state, "ended");
    equal(aStatus.endedAt, at(4).toISOString());
    // Once the fence lapses B is active and gets its own window.
    await recordLeaseActivation(b.lease.id, at(4), client);
    const active = (await getLeaseStatus(b.lease.id, client, at(4)))!;
    equal(active.state, "active");
    equal(active.authorizedForSeconds, 2);
    // A's terminal report (4 s, measured at the fence) is accepted in full; totals are conserved.
    const final = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 4, end: true, endReason: "replaced", measuredAt: at(4).getTime(), now: at(7) }, client);
    if (!final.ok) throw new Error("settle failed");
    equal(final.refusedSeconds, 0);
    const bAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === b.lease.id)!;
    equal(4 + bAfter.budgetSeconds, 900);

    // Acknowledgement path: the predecessor's terminal report inside the window releases the fence at once.
    const client2 = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-fence-2", purchaseId: id("p"), redemptionId: id("r"), now: at(0) }, client2);
    const c = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: false, deviceLabel: "C", now: at(0) }, client2);
    if (!c.ok) throw new Error("issue failed");
    await recordLeaseActivation(c.lease.id, at(10), client2);
    const d = await issuePlayLease({ personId: "santiago", gameId: "paid-game", mode: "play", leaseId: id("lease"), takeover: true, deviceLabel: "D", now: at(10.5) }, client2);
    if (!d.ok) throw new Error("issue failed");
    equal(d.handoverAt, at(12).toISOString());
    equal((await getLeaseStatus(d.lease.id, client2, at(10.6)))!.state, "pending");
    const ack = await settlePlayLease({ leaseId: c.lease.id, consumedSeconds: 11, end: true, endReason: "replaced", measuredAt: at(10.6).getTime(), now: at(10.7) }, client2);
    if (!ack.ok) throw new Error("settle failed");
    equal(ack.lease.finalSettled, true);
    const dNow = (await getLeaseStatus(d.lease.id, client2, at(10.8)))!;
    equal(dNow.state, "active", "the predecessor's end was acknowledged: no fence remains");
    equal(dNow.startsAt, null);
    const dLease = (await getLeasesForPerson("santiago", client2)).find((l) => l.id === d.lease.id)!;
    equal(11 + dLease.budgetSeconds, 900);
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
    const lateA = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 30, end: true, measuredAt: at(31).getTime(), now: at(3600) }, client);
    ok(lateA.ok && lateA.delta === 30);
    const bAfter = (await getLeasesForPerson("santiago", client)).find((l) => l.id === b.lease.id)!;
    equal(bAfter.budgetSeconds, 870);
    equal((await getPlayState("santiago", client)).remainingSeconds, 870);
    // A's cap was frozen at release (30 s): a report claiming far more than it could have measured is clamped to that cap.
    const bogus = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 800, end: true, measuredAt: at(3700).getTime(), now: at(3700) }, client);
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
    const a = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 500, end: false, measuredAt: at(500).getTime(), now: at(500) }, client);
    const b = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 400, end: false, measuredAt: at(510).getTime(), now: at(510) }, client);
    ok(a.ok && b.ok && b.delta === 0 && b.lease.consumedSeconds === 500);
    const c = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 5000, end: false, measuredAt: at(900).getTime(), now: at(900) }, client);
    ok(c.ok && c.lease.state === "ended" && c.lease.consumedSeconds === 900 && c.remainingSeconds === 0);
    equal(c.lease.endReason, "exhausted");
    // A late/replayed report minutes after the end is accepted but can only move forward within the budget: nothing changes.
    const replay = await settlePlayLease({ leaseId: lease.lease.id, consumedSeconds: 900, end: true, measuredAt: at(1000).getTime(), now: at(1000) }, client);
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

// ---------------------------------------------------------------------------
// Daily chess allowance (DA-01..DA-03) — server date, trustworthy approval, one grant, no coins
// ---------------------------------------------------------------------------

describe("daily chess allowance (October 8, 2026)", () => {
  /** Fixed instants on Europe/Zurich wall dates: 2026-10-08 is a Thursday (ISO 2026-W41, day 3). */
  const NOON = new Date("2026-10-08T10:00:00.000Z"); // 12:00 Zurich (CEST)
  const LATE = new Date("2026-10-08T21:30:00.000Z"); // 23:30 Zurich
  const AFTER_MIDNIGHT = new Date("2026-10-08T22:00:01.000Z"); // 00:00:01 Zurich on the 9th
  async function approved(client: Client, person: string, week: string, day: number, routine = "s-kumon", over: { reviewedAt?: string | null; approvalSource?: string | null; status?: string } = {}) {
    await client.execute({
      sql: "INSERT OR REPLACE INTO family_completions (person_id, routine_id, week, day, status, created_at, reviewed_at, awarded_points, approval_source) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
      args: [person, routine, week, day, over.status ?? "done", "2026-10-08T06:00:00.000Z", over.reviewedAt === undefined ? "2026-10-08T07:00:00.000Z" : over.reviewedAt, over.approvalSource === undefined ? "parent-review" : over.approvalSource],
    });
  }
  const chessLease = (client: Client, now: Date, over: Partial<{ takeover: boolean; person: "santiago" | "isabel" }> = {}) =>
    issuePlayLease({ personId: over.person ?? "santiago", gameId: DAILY_CHESS_GAME_ID, mode: "play", leaseId: id("lease"), takeover: over.takeover ?? false, deviceLabel: null, now }, client);

  it("DA-01 the occurrence date decides: today's approval qualifies, yesterday's approved today does not, pending/hold/redo and self-marked done never do", async () => {
    const client = await fresh();
    deepEqual(familyTodayInZurich(NOON), { date: "2026-10-08", week: "2026-W41", day: 3 });
    equal(await chessQualifyingApproval(client, "santiago", NOON), null);
    await approved(client, "santiago", "2026-W41", 2, "s-piano"); // Wednesday, reviewed today
    equal(await chessQualifyingApproval(client, "santiago", NOON), null, "yesterday's activity approved today never unlocks today");
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { status: "pending_review", reviewedAt: null, approvalSource: null });
    equal(await chessQualifyingApproval(client, "santiago", NOON), null, "pending");
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { status: "on_hold", approvalSource: null });
    equal(await chessQualifyingApproval(client, "santiago", NOON), null, "on hold");
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { status: "redo", approvalSource: null });
    equal(await chessQualifyingApproval(client, "santiago", NOON), null, "redo");
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { reviewedAt: null, approvalSource: null });
    equal(await chessQualifyingApproval(client, "santiago", NOON), null, "self-marked done (no provenance) does not qualify");
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { reviewedAt: "2026-10-08T07:00:00.000Z", approvalSource: null });
    deepEqual(await chessQualifyingApproval(client, "santiago", NOON), { week: "2026-W41", routineId: "s-kumon", day: 3 }, "legacy parent review (reviewed_at) qualifies");
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { reviewedAt: null, approvalSource: "parent-assisted" });
    deepEqual(await chessQualifyingApproval(client, "santiago", NOON), { week: "2026-W41", routineId: "s-kumon", day: 3 }, "explicit marker qualifies");
    // The sibling's approval never counts for this child; a future day never counts.
    equal(await chessQualifyingApproval(client, "isabel", NOON), null);
    await approved(client, "isabel", "2026-W41", 4, "i-kumon");
    equal(await chessQualifyingApproval(client, "isabel", NOON), null, "tomorrow");
  });

  it("DA-02 exactly one 900 s grant per child and date: repeated leases, many activities and concurrent first entries never stack; zero coin movement", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await approved(client, "santiago", "2026-W41", 3, "s-kumon");
    await approved(client, "santiago", "2026-W41", 3, "s-piano");
    await approved(client, "santiago", "2026-W41", 3, "s-physio");
    const balanceBefore = (await getPlayState("santiago", client, NOON)).balance;
    const first = await chessLease(client, NOON);
    ok(first.ok, JSON.stringify(first));
    equal(first.lease.metered, true);
    equal(first.lease.budgetKind, "chess");
    equal(first.lease.budgetDate, "2026-10-08");
    equal(first.lease.budgetSeconds, 900);
    const again = await Promise.all([chessLease(client, NOON, { takeover: true }), chessLease(client, NOON, { takeover: true })]);
    ok(again.some((r) => r.ok), "a takeover re-issues on the same grant");
    const rows = await client.execute("SELECT person_id, date, granted_seconds, consumed_seconds FROM family_chess_allowances");
    deepEqual(rows.rows.map((r) => [r.person_id, r.date, Number(r.granted_seconds), Number(r.consumed_seconds)]), [["santiago", "2026-10-08", 900, 0]], "one row, 900 s, however many activities or entries");
    const state = await getPlayState("santiago", client, NOON);
    equal(state.balance, balanceBefore, "no coin debit");
    equal(state.remainingSeconds, 0, "the paid allowance is untouched");
    equal(state.chess.remainingSeconds, 900);
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_reward_redemptions")).rows[0].n), 0, "zero redemption rows");
    // Spending coins (a Studio purchase) changes nothing about chess.
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-chess-spend", purchaseId: id("p"), redemptionId: id("r"), now: NOON }, client);
    equal((await getPlayState("santiago", client, NOON)).chess.remainingSeconds, 900);
  });

  it("DA-03 chess settlement debits only the day's grant; the paid allowance and the sibling are untouched; remaining is shared across re-issued leases", async () => {
    const client = await fresh({ santiagoCoins: 7 });
    await purchasePlayBlock({ personId: "santiago", idempotencyKey: "key-chess-paid", purchaseId: id("p"), redemptionId: id("r"), now: NOON }, client);
    await approved(client, "santiago", "2026-W41", 3);
    const a = await chessLease(client, NOON);
    ok(a.ok);
    await recordLeaseActivation(a.lease.id, NOON, client);
    const settled = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 300, end: true, endReason: "left", measuredAt: NOON.getTime() + 300_000, now: new Date(NOON.getTime() + 300_000) }, client);
    ok(settled.ok && settled.delta === 300 && settled.remainingSeconds === 600, JSON.stringify(settled));
    const state = await getPlayState("santiago", client, new Date(NOON.getTime() + 301_000));
    equal(state.remainingSeconds, 900, "paid allowance untouched by chess");
    equal(state.chess.remainingSeconds, 600);
    equal((await getPlayState("isabel", client, NOON)).chess.remainingSeconds, 0);
    // A new lease the same day (reload / other device) continues on the remainder.
    const b = await chessLease(client, new Date(NOON.getTime() + 302_000));
    ok(b.ok && b.lease.budgetSeconds === 600, JSON.stringify(b));
    // Exhaustion: the last settlement ends it; nothing can mint a second grant today.
    const done = await settlePlayLease({ leaseId: b.lease.id, consumedSeconds: 600, end: true, endReason: "exhausted", measuredAt: NOON.getTime() + 902_000, now: new Date(NOON.getTime() + 902_000) }, client);
    ok(done.ok && done.remainingSeconds === 0);
    const c = await chessLease(client, new Date(NOON.getTime() + 903_000));
    deepEqual(c, { ok: false, reason: "no-allowance", remainingSeconds: 0 });
    equal((await getPlayState("santiago", client, LATE)).chess.consumedSeconds, 900);
  });

  it("DA-03 removing the last qualifying approval locks the live lease at the next authority read and via the explicit lock; requalifying restores only the unconsumed remainder", async () => {
    const client = await fresh();
    await approved(client, "santiago", "2026-W41", 3);
    const a = await chessLease(client, NOON);
    ok(a.ok);
    await recordLeaseActivation(a.lease.id, NOON, client);
    await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 120, end: false, measuredAt: NOON.getTime() + 120_000, now: new Date(NOON.getTime() + 120_000) }, client);
    // Parent holds the only approval: the explicit lock ends the lease with no coin transaction.
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { status: "on_hold", approvalSource: null });
    const t1 = new Date(NOON.getTime() + 130_000);
    equal(await lockChessIfIneligible("santiago", t1, client), "chess-locked");
    const locked = (await getLease(a.lease.id, client))!;
    equal(locked.state, "ended");
    equal(locked.endReason, "chess-locked");
    equal((await getPlayState("santiago", client, t1)).chess.remainingSeconds, 0, "no usable time while ineligible");
    equal((await getPlayState("santiago", client, t1)).chess.consumedSeconds, 120, "consumed seconds are never reset");
    deepEqual(await chessLease(client, t1), { ok: false, reason: "chess-not-earned", remainingSeconds: 0 });
    // The meter's late terminal report for the locked lease is still bounded and applied (no refund, no revival).
    const late = await settlePlayLease({ leaseId: a.lease.id, consumedSeconds: 125, end: true, measuredAt: t1.getTime(), now: new Date(t1.getTime() + 1000) }, client);
    ok(late.ok && late.lease.state === "ended" && late.lease.consumedSeconds >= 120 && late.lease.consumedSeconds <= 125, JSON.stringify(late));
    // Re-approval (or another approved activity today) restores only what is left — no new 900.
    await approved(client, "santiago", "2026-W41", 3, "s-piano");
    const t2 = new Date(NOON.getTime() + 200_000);
    const b = await chessLease(client, t2);
    ok(b.ok, JSON.stringify(b));
    ok(b.lease.budgetSeconds <= 780 && b.lease.budgetSeconds >= 775, `remainder only: ${b.lease.budgetSeconds}`);
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_chess_allowances WHERE person_id = 'santiago'")).rows[0].n), 1);
    // The signed status read enforces the same lock without the explicit call.
    await approved(client, "santiago", "2026-W41", 3, "s-piano", { status: "redo", approvalSource: null });
    await approved(client, "santiago", "2026-W41", 3, "s-kumon", { status: "redo", approvalSource: null });
    await recordLeaseActivation(b.lease.id, new Date(t2.getTime() + 5000), client);
    const status = await getLeaseStatus(b.lease.id, client, new Date(t2.getTime() + 5000));
    equal(status?.state, "ended");
    equal(status?.endReason, "chess-locked");
    equal(status?.authorizedForSeconds, null);
  });

  it("DA-01/DA-03 midnight in Zurich (not UTC) rotates the day: yesterday's lease ends on the first read after local midnight and today needs today's approval; the 23:30 grant is not carried over", async () => {
    const client = await fresh();
    await approved(client, "santiago", "2026-W41", 3);
    const a = await chessLease(client, LATE);
    ok(a.ok && a.lease.budgetDate === "2026-10-08");
    await recordLeaseActivation(a.lease.id, LATE, client);
    // Still the 8th in Zurich at 23:59:59 local (21:59:59Z): fine.
    const before = await getLeaseStatus(a.lease.id, client, new Date("2026-10-08T21:59:59.000Z"));
    equal(before?.state, "active");
    deepEqual(familyTodayInZurich(AFTER_MIDNIGHT), { date: "2026-10-09", week: "2026-W41", day: 4 });
    await recordLeaseActivation(a.lease.id, AFTER_MIDNIGHT, client);
    const after = await getLeaseStatus(a.lease.id, client, AFTER_MIDNIGHT);
    equal(after?.state, "ended");
    equal(after?.endReason, "day-ended");
    equal((await getPlayState("santiago", client, AFTER_MIDNIGHT)).chess.eligible, false, "the 9th needs the 9th's approval");
    deepEqual(await chessLease(client, AFTER_MIDNIGHT), { ok: false, reason: "chess-not-earned", remainingSeconds: 0 });
    await approved(client, "santiago", "2026-W41", 4, "s-piano");
    const b = await chessLease(client, new Date("2026-10-08T22:10:00.000Z"));
    ok(b.ok && b.lease.budgetDate === "2026-10-09" && b.lease.budgetSeconds === 900, JSON.stringify(b));
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_chess_allowances WHERE person_id = 'santiago'")).rows[0].n), 2, "one row per date");
  });

  it("DA-01 DST and ISO-week/year rollover edges are judged on the Zurich wall date", async () => {
    const client = await fresh();
    // 2026-10-25: clocks go back in Zurich (03:00 CEST → 02:00 CET). 00:30Z is 02:30 CEST = still the 25th; 23:30Z is 00:30 CET on the 26th.
    deepEqual(familyTodayInZurich(new Date("2026-10-25T00:30:00.000Z")), { date: "2026-10-25", week: "2026-W43", day: 6 });
    deepEqual(familyTodayInZurich(new Date("2026-10-25T23:30:00.000Z")), { date: "2026-10-26", week: "2026-W44", day: 0 });
    // New Year's Eve 2026 is ISO 2026-W53 day 3 (Thursday); 23:30Z is already 2027-01-01, ISO 2026-W53 day 4 (Friday).
    deepEqual(familyTodayInZurich(new Date("2026-12-31T12:00:00.000Z")), { date: "2026-12-31", week: "2026-W53", day: 3 });
    deepEqual(familyTodayInZurich(new Date("2026-12-31T23:30:00.000Z")), { date: "2027-01-01", week: "2026-W53", day: 4 });
    await approved(client, "santiago", "2026-W53", 3, "s-kumon");
    equal((await chessStatusFor(client, "santiago", new Date("2026-12-31T12:00:00.000Z"))).eligible, true);
    equal((await chessStatusFor(client, "santiago", new Date("2026-12-31T23:30:00.000Z"))).eligible, false, "the 1st of January needs its own approval");
    // A malformed identity (week 60, day 9) can never qualify even if it says done+reviewed.
    await client.execute({ sql: "INSERT INTO family_completions (person_id, routine_id, week, day, status, created_at, reviewed_at, awarded_points, approval_source) VALUES ('santiago', 's-physio', '2026-W60', 9, 'done', 'x', 'y', 1, 'parent-review')", args: [] });
    equal(await chessQualifyingApproval(client, "santiago", new Date("2026-12-31T23:30:00.000Z")), null);
  });
});
