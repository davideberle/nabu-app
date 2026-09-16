import { match, doesNotMatch } from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(
  new URL("../app/api/family/redemptions/route.ts", import.meta.url),
  "utf8",
);

describe("family redemption balance enforcement", () => {
  it("enforces the server-owned cumulative wallet projection", () => {
    match(routeSource, /getFamilyWalletProjection\(\)/);
    match(routeSource, /walletProjection\.wallets\[personId\]\?\.balance/);
    doesNotMatch(routeSource, /getCompletionsForWeek/);
  });

  it("stamps the actual current week and rejects attempted backdating", () => {
    match(routeSource, /resolveRedemptionWeek\(week\)/);
    match(routeSource, /if \(!redemptionWeek\.ok\)/);
    match(routeSource, /redemptionWeek\.week,\s+reward\.costPoints,/);
  });
});
