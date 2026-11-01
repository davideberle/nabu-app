// Family-owned paid-play policy (GP-01..GP-08): pure rules, fake clock. Run: npm test

import { deepEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHESS_BLOCK_COINS,
  CHESS_BLOCK_SECONDS,
  CHESS_PURCHASE_REWARD_ID,
  PLAY_BLOCK_COINS,
  PLAY_PURCHASE_REWARD_ID,
  PLAY_BLOCK_SECONDS,
  PLAY_GRACE_SECONDS,
  PLAY_WARN_SECONDS,
  RETIRED_REWARD_IDS,
  STUDIO_SCOPE_GAME_ID,
  allowanceRemaining,
  applySettlement,
  blockFor,
  budgetKindFor,
  decideLeaseIssue,
  formatPlayClock,
  isParentApproved,
  isRetiredRewardId,
  isValidCalendarDate,
  isValidIdempotencyKey,
  leaseIsAlive,
  occurrenceDateOf,
  playPriceFor,
  projectPlayPhase,
  type PlayLease,
} from "./family-play.ts";

const lease = (over: Partial<PlayLease> = {}): PlayLease => ({
  id: "lease-00000001",
  personId: "santiago",
  gameId: "6bd56478",
  fenceCapSeconds: null,
  mode: "play",
  metered: true,
  budgetKind: "paid",
  budgetDate: null,
  budgetSeconds: 900,
  consumedSeconds: 0,
  state: "active",
  issuedAt: "2026-10-04T10:00:00.000Z",
  lastSettledAt: null,
  endedAt: null,
  endReason: null,
  deviceLabel: null,
  predecessorId: null,
  reserveSeconds: 0,
  capSeconds: 900,
  finalSettled: false,
  activatedAt: null,
  measuredAt: null,
  authorityUntil: null,
  ...over,
});

describe("access policy — price and budget (October 8; chess price November 1, 2026)", () => {
  it("chess in play mode is 1 coin for 15 minutes on its own allowance; every other game is 3 coins for 15 minutes", () => {
    deepEqual(playPriceFor("adaptive-chess-coach"), { kind: "chess", coins: 1, seconds: 900 });
    deepEqual(playPriceFor("6bd56478-5ea0-4f2a-a2db-be8549a88d05"), { kind: "metered", coins: 3, seconds: 900 });
    equal(PLAY_BLOCK_COINS, 3);
    equal(PLAY_BLOCK_SECONDS, 900);
    equal(CHESS_BLOCK_COINS, 1);
    equal(CHESS_BLOCK_SECONDS, 900);
  });
  it("each block has its own wallet reward id: chess never reuses the Studio block's", () => {
    deepEqual(blockFor("chess"), { coins: 1, seconds: 900, rewardId: CHESS_PURCHASE_REWARD_ID });
    deepEqual(blockFor("paid"), { coins: 3, seconds: 900, rewardId: PLAY_PURCHASE_REWARD_ID });
    ok((CHESS_PURCHASE_REWARD_ID as string) !== PLAY_PURCHASE_REWARD_ID);
  });
  it("editing is PAID: edit mode of any game — and the id-less studio sentinel — is the same 3-coin block (no free editor)", () => {
    deepEqual(playPriceFor("6bd56478-5ea0-4f2a-a2db-be8549a88d05", "edit"), { kind: "metered", coins: 3, seconds: 900 });
    deepEqual(playPriceFor(STUDIO_SCOPE_GAME_ID, "edit"), { kind: "metered", coins: 3, seconds: 900 });
    deepEqual(playPriceFor("adaptive-chess-coach", "edit"), { kind: "metered", coins: 3, seconds: 900 });
    equal(STUDIO_SCOPE_GAME_ID, "*");
  });
  it("budgets never mix: chess play → chess budget, everything else → paid", () => {
    equal(budgetKindFor("adaptive-chess-coach", "play"), "chess");
    equal(budgetKindFor("adaptive-chess-coach", "edit"), "paid");
    equal(budgetKindFor("*", "edit"), "paid");
    equal(budgetKindFor("6bd56478", "play"), "paid");
  });
  it("warning and grace constants match the accepted policy", () => {
    equal(PLAY_WARN_SECONDS, 120);
    equal(PLAY_GRACE_SECONDS, 30);
  });
});

describe("retired rewards", () => {
  it("names exactly the five retired catalog ids and nothing else", () => {
    deepEqual([...RETIRED_REWARD_IDS].sort(), ["afternoon-excursion", "friends", "mini-game", "movie-night", "proper-trip"]);
    for (const id of RETIRED_REWARD_IDS) ok(isRetiredRewardId(id));
    ok(!isRetiredRewardId("game-play-15min"));
    ok(!isRetiredRewardId(null));
    ok(!isRetiredRewardId("Friends"));
  });
});

describe("occurrence date and parent-approval provenance (DA-01/PR-02)", () => {
  it("derives the calendar date from ISO week + Monday-zero day, refusing malformed identities", () => {
    equal(occurrenceDateOf("2026-W41", 0), "2026-10-05");
    equal(occurrenceDateOf("2026-W41", 3), "2026-10-08");
    equal(occurrenceDateOf("2026-W41", 6), "2026-10-11");
    equal(occurrenceDateOf("2026-W01", 0), "2025-12-29");
    equal(occurrenceDateOf("2027-W53", 0), null, "2027 has 52 ISO weeks");
    equal(occurrenceDateOf("2026-W53", 3), "2026-12-31", "2026 and 2020 have 53");
    equal(occurrenceDateOf("2020-W53", 3), "2020-12-31");
    equal(occurrenceDateOf("2026-W41", 7), null);
    equal(occurrenceDateOf("2026-W41", -1), null);
    equal(occurrenceDateOf("2026-41", 1), null);
    equal(occurrenceDateOf("2026-W00", 1), null);
    equal(occurrenceDateOf("2026-W41", 1.5), null);
  });
  it("validates calendar dates strictly", () => {
    ok(isValidCalendarDate("2026-10-08"));
    ok(!isValidCalendarDate("2026-02-30"));
    ok(!isValidCalendarDate("2026-10-8"));
    ok(!isValidCalendarDate(20261008));
  });
  it("trusts only the explicit marker or a legacy review timestamp on a done row — never a self-marked done", () => {
    ok(isParentApproved({ status: "done", reviewedAt: null, approvalSource: "parent-review" }));
    ok(isParentApproved({ status: "done", reviewedAt: null, approvalSource: "parent-assisted" }));
    ok(isParentApproved({ status: "done", reviewedAt: "2026-10-08T07:00:00.000Z", approvalSource: null }));
    ok(!isParentApproved({ status: "done", reviewedAt: null, approvalSource: null }), "self-marked done");
    ok(!isParentApproved({ status: "done", reviewedAt: "", approvalSource: null }));
    ok(!isParentApproved({ status: "done", reviewedAt: null, approvalSource: "child" }));
    ok(!isParentApproved({ status: "pending_review", reviewedAt: "2026-10-08T07:00:00.000Z", approvalSource: "parent-review" }));
    ok(!isParentApproved({ status: "on_hold", reviewedAt: "2026-10-08T07:00:00.000Z", approvalSource: null }));
  });
});

describe("allowance", () => {
  it("remaining never goes negative and is zero without a row", () => {
    equal(allowanceRemaining(null), 0);
    equal(allowanceRemaining({ grantedSeconds: 900, consumedSeconds: 100 }), 800);
    equal(allowanceRemaining({ grantedSeconds: 900, consumedSeconds: 950 }), 0);
  });
});

describe("settlement is monotonic and bounded (GP-02/GP-07)", () => {
  it("applies only forward progress", () => {
    deepEqual(applySettlement(lease({ consumedSeconds: 100 }), 160), { consumedSeconds: 160, delta: 60, exhausted: false });
    deepEqual(applySettlement(lease({ consumedSeconds: 100 }), 40), { consumedSeconds: 100, delta: 0, exhausted: false });
  });
  it("clamps at the lease budget and reports exhaustion", () => {
    deepEqual(applySettlement(lease({ consumedSeconds: 880 }), 5000), { consumedSeconds: 900, delta: 20, exhausted: true });
  });
  it("ignores junk and never meters an unmetered lease", () => {
    deepEqual(applySettlement(lease({ consumedSeconds: 10 }), Number.NaN), { consumedSeconds: 10, delta: 0, exhausted: false });
    deepEqual(applySettlement(lease({ metered: false }), 500), { consumedSeconds: 0, delta: 0, exhausted: false });
  });
});

describe("one consuming lease per child (GP-03)", () => {
  const now = new Date("2026-10-04T10:05:00.000Z");
  it("refuses a metered lease without allowance", () => {
    deepEqual(decideLeaseIssue({ remainingSeconds: 0, existing: null, takeover: false, now }), { ok: false, reason: "no-allowance" });
    deepEqual(decideLeaseIssue({ remainingSeconds: 1, existing: null, takeover: false, now }), { ok: true, replaces: null });
  });
  it("a live lease on another device blocks a second one unless the child takes over", () => {
    const held = lease({ lastSettledAt: "2026-10-04T10:04:30.000Z", deviceLabel: "iPad" });
    const blocked = decideLeaseIssue({ remainingSeconds: 600, existing: held, takeover: false, now });
    deepEqual(blocked, { ok: false, reason: "lease-held", heldBy: { leaseId: held.id, gameId: held.gameId, deviceLabel: "iPad" } });
    deepEqual(decideLeaseIssue({ remainingSeconds: 600, existing: held, takeover: true, now }), { ok: true, replaces: held.id });
  });
  it("a stale lease (no settlement for ten minutes) is replaced silently", () => {
    const stale = lease({ issuedAt: "2026-10-04T09:00:00.000Z", lastSettledAt: "2026-10-04T09:30:00.000Z" });
    equal(leaseIsAlive(stale, now), false);
    deepEqual(decideLeaseIssue({ remainingSeconds: 600, existing: stale, takeover: false, now }), { ok: true, replaces: stale.id });
  });
});

describe("child-facing clock projection (GP-05/GP-06)", () => {
  it("names the phases from server numbers only", () => {
    equal(projectPlayPhase({ metered: true, remainingSeconds: 500, graceRemainingSeconds: null }), "playing");
    equal(projectPlayPhase({ metered: true, remainingSeconds: 120, graceRemainingSeconds: null }), "warning");
    equal(projectPlayPhase({ metered: true, remainingSeconds: 0, graceRemainingSeconds: 12 }), "grace");
    equal(projectPlayPhase({ metered: true, remainingSeconds: 0, graceRemainingSeconds: 0 }), "exhausted");
    equal(projectPlayPhase({ metered: false, remainingSeconds: 0, graceRemainingSeconds: null }), "unmetered");
  });
  it("formats m:ss", () => {
    equal(formatPlayClock(900), "15:00");
    equal(formatPlayClock(119), "1:59");
    equal(formatPlayClock(-3), "0:00");
  });
});

describe("idempotency keys", () => {
  it("accepts opaque client keys and rejects junk", () => {
    ok(isValidIdempotencyKey("3b1f0f6e-5b8e-4a4c-9a2e-0c6a1d2e3f4a"));
    ok(!isValidIdempotencyKey("short"));
    ok(!isValidIdempotencyKey("has space key"));
    ok(!isValidIdempotencyKey(42));
  });
});
