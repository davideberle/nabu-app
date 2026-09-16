import { match, doesNotMatch } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const database = readFileSync(new URL("./family-db.ts", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./family-wallet-ledger.ts", import.meta.url), "utf8");
const wallet = readFileSync(new URL("./family-wallet.ts", import.meta.url), "utf8");

describe("durable family wallet storage", () => {
  it("persists immutable credit and debit amounts and backfills only the real wallet era", () => {
    match(database, /awarded_points INTEGER/);
    match(database, /charged_points INTEGER/);
    match(database, /week >= \? AND status = 'done' AND awarded_points IS NULL/);
    match(database, /week >= \? AND charged_points IS NULL/);
    match(database, /args: \[FAMILY_WALLET_EPOCH_WEEK\]/);
  });

  it("snapshots approval once, deliberately resnapshots a credit correction, and snapshots redemption cost", () => {
    match(ledger, /COALESCE\(awarded_points, \?\)/);
    match(database, /family_completions\.awarded_points IS NOT NULL/);
    match(database, /THEN family_completions\.awarded_points/);
    match(database, /SET credit_count = \?, awarded_points = \?, reviewed_at = \?/);
    match(ledger, /INSERT INTO family_reward_redemptions/);
    match(ledger, /SELECT \?, \?, \?, \?, \?, \?/);
    match(database, /reward\.costPoints|chargedPoints/);
  });

  it("projects only stored event amounts and cannot reprice from current definitions", () => {
    match(wallet, /row\.awardedPoints/);
    match(wallet, /row\.chargedPoints/);
    doesNotMatch(wallet, /routineDefinitions|rewardDefinitions|weekPoints/);
  });

  it("keeps undo semantics as event deletion, which removes a credit or refunds a debit", () => {
    match(database, /DELETE FROM family_completions WHERE week = \?/);
    match(database, /DELETE FROM family_reward_redemptions WHERE id = \?/);
  });
});
