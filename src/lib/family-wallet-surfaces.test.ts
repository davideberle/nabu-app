import { doesNotMatch, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("family wallet consumer contract (October 8, 2026)", () => {
  const coins = source("../app/family/(shell)/rewards/client.tsx");
  const provider = source("../components/family/child-shell-provider.tsx");
  const assistant = source("../app/family/(shell)/assistant/client.tsx");
  const parent = source("../app/family/parent/client.tsx");
  const games = source("../app/family/(shell)/games/client.tsx");
  const redeem = source("../components/family/coin-redeem.tsx");

  it("the shell provider is the one reader of the authenticated permanent-wallet projection for every child surface", () => {
    match(provider, /fetch\("\/api\/family\/wallet"/);
    match(coins, /useChildShell\(\)/);
    doesNotMatch(coins, /fetch\(/);
  });

  it("the assistant reads the authenticated permanent-wallet projection", () => {
    match(assistant, /fetch\("\/api\/family\/wallet"\)/);
  });

  it("no child surface posts a catalog redemption any more; the only purchases are the Studio block and (November 1, 2026) the chess block, each confirmed with an idempotency key", () => {
    doesNotMatch(coins, /\/api\/family\/redemptions/);
    doesNotMatch(games, /\/api\/family\/redemptions/);
    doesNotMatch(redeem, /\/api\/family\/redemptions/);
    // November 18, 2026: the one purchase flow lives in the shared redeem rows, used by Games and Coins.
    match(redeem, /client\.purchase\(child, keyRef\.current, undefined, kind\)/);
    match(redeem, /Ja, kaufen für 🪙 \$\{row\.coins\}/);
    match(redeem, /onClick=\{\(\) => buy\(row\.kind\)\} disabled=\{buying\}/);
    match(redeem, /onClick=\{\(\) => openConfirm\(row\.kind\)\}/);
    match(redeem, /if \(buying\) return/);
    match(redeem, /if \(inFlight\.current\) return/);
    match(redeem, /disabled=\{!affordable\}/);
    for (const surface of [games, coins]) {
      match(surface, /useCoinPurchase\(child, client, onSettled\)/);
      match(surface, /<CoinRedeemRows state=\{state\.state\} purchase=\{purchase\}( playHref=\{playHref\})? \/>/);
      doesNotMatch(surface, /client\.purchase\(/);
    }
  });

  it("the shared purchase flow keeps the key on a network failure and drops it on success, refusal and cancel", () => {
    const buy = redeem.slice(redeem.indexOf("const buy = useCallback"), redeem.indexOf("return { confirming"));
    match(buy, /if \(!keyRef\.current\) keyRef\.current = newIdempotencyKey\(\)/);
    const tail = buy.slice(buy.lastIndexOf('failure === "insufficient"'));
    doesNotMatch(tail.slice(tail.indexOf("return;\n    }")), /keyRef\.current = null/);
    match(redeem, /const cancel = useCallback\(\(\) => \{\n    setConfirming\(null\);\n    keyRef\.current = null;/);
  });

  it("the parent tools undo spending by redemption id (play purchases refund exactly once through the same route)", () => {
    match(parent, /method: "DELETE", headers: \{ "Content-Type": "application\/json" \}, body: JSON\.stringify\(\{ id: r\.id \}\)/);
    ok(parent.includes("PLAY_PURCHASE_REWARD_ID"));
  });

  it("Coins shows W, E and S from the projection and never a weekly number", () => {
    match(coins, /data-wallet-balance/);
    match(coins, /data-wallet-earned/);
    match(coins, /data-wallet-spent/);
    doesNotMatch(coins.replace(/^\s*\/\/.*$/gm, ""), /weekPoints|this week/);
  });
});
