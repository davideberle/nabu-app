// Family-owned paid-play policy (GP-01..GP-08): pure rules, fake clock. Run: npm test

import { deepEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FREE_GAME_IDS,
  PLAY_BLOCK_COINS,
  PLAY_BLOCK_SECONDS,
  PLAY_GRACE_SECONDS,
  PLAY_WARN_SECONDS,
  allowanceRemaining,
  applySettlement,
  decideLeaseIssue,
  formatPlayClock,
  isValidIdempotencyKey,
  leaseIsAlive,
  playPriceFor,
  projectPlayPhase,
  type PlayLease,
} from "./family-play.ts";

const lease = (over: Partial<PlayLease> = {}): PlayLease => ({
  id: "lease-00000001",
  personId: "santiago",
  gameId: "6bd56478",
  mode: "play",
  metered: true,
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
  ...over,
});

describe("GP-01 price policy", () => {
  it("chess is free, every other approved game is 3 coins for 15 active minutes", () => {
    deepEqual(FREE_GAME_IDS, ["adaptive-chess-coach"]);
    deepEqual(playPriceFor("adaptive-chess-coach"), { kind: "free" });
    deepEqual(playPriceFor("6bd56478-5ea0-4f2a-a2db-be8549a88d05"), { kind: "metered", coins: 3, seconds: 900 });
    equal(PLAY_BLOCK_COINS, 3);
    equal(PLAY_BLOCK_SECONDS, 900);
  });
  it("edit mode is always free, even for a paid game", () => {
    deepEqual(playPriceFor("6bd56478-5ea0-4f2a-a2db-be8549a88d05", "edit"), { kind: "free" });
  });
  it("warning and grace constants match the accepted policy", () => {
    equal(PLAY_WARN_SECONDS, 120);
    equal(PLAY_GRACE_SECONDS, 30);
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
    deepEqual(decideLeaseIssue({ price: { kind: "metered", coins: 3, seconds: 900 }, remainingSeconds: 0, existing: null, takeover: false, now }), { ok: false, reason: "no-allowance" });
  });
  it("a free game needs no allowance", () => {
    deepEqual(decideLeaseIssue({ price: { kind: "free" }, remainingSeconds: 0, existing: null, takeover: false, now }), { ok: true, replaces: null });
  });
  it("a live lease on another device blocks a second one unless the child takes over", () => {
    const held = lease({ lastSettledAt: "2026-10-04T10:04:30.000Z", deviceLabel: "iPad" });
    const blocked = decideLeaseIssue({ price: { kind: "metered", coins: 3, seconds: 900 }, remainingSeconds: 600, existing: held, takeover: false, now });
    deepEqual(blocked, { ok: false, reason: "lease-held", heldBy: { leaseId: held.id, gameId: held.gameId, deviceLabel: "iPad" } });
    deepEqual(decideLeaseIssue({ price: { kind: "metered", coins: 3, seconds: 900 }, remainingSeconds: 600, existing: held, takeover: true, now }), { ok: true, replaces: held.id });
  });
  it("a stale lease (no settlement for ten minutes) is replaced silently", () => {
    const stale = lease({ issuedAt: "2026-10-04T09:00:00.000Z", lastSettledAt: "2026-10-04T09:30:00.000Z" });
    equal(leaseIsAlive(stale, now), false);
    deepEqual(decideLeaseIssue({ price: { kind: "metered", coins: 3, seconds: 900 }, remainingSeconds: 600, existing: stale, takeover: false, now }), { ok: true, replaces: stale.id });
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
