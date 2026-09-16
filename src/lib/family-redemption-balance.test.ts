import { match, doesNotMatch } from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(
  new URL("../app/api/family/redemptions/route.ts", import.meta.url),
  "utf8",
);
const ledgerSource = readFileSync(new URL("./family-wallet-ledger.ts", import.meta.url), "utf8");

describe("family redemption balance enforcement", () => {
  it("enforces cumulative balance in the same statement that inserts the debit", () => {
    match(routeSource, /createRedemptionIfAffordable/);
    match(ledgerSource, /INSERT INTO family_reward_redemptions/);
    match(ledgerSource, /SUM\(awarded_points\)/);
    match(ledgerSource, /SUM\(charged_points\)/);
    match(ledgerSource, /status = 'done'/);
    match(ledgerSource, /rowsAffected === 1/);
    doesNotMatch(routeSource, /walletProjection/);
    doesNotMatch(routeSource, /getCompletionsForWeek/);
  });

  it("stamps the actual current week and rejects attempted backdating", () => {
    match(routeSource, /resolveRedemptionWeek\(week\)/);
    match(routeSource, /if \(!redemptionWeek\.ok\)/);
    match(routeSource, /redemptionWeek\.week,\s+reward\.costPoints,/);
  });
});
