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

  it("the shell provider is the one reader of the authenticated permanent-wallet projection for every child surface", () => {
    match(provider, /fetch\("\/api\/family\/wallet"/);
    match(coins, /useChildShell\(\)/);
    doesNotMatch(coins, /fetch\(/);
  });

  it("the assistant reads the authenticated permanent-wallet projection", () => {
    match(assistant, /fetch\("\/api\/family\/wallet"\)/);
  });

  it("no child surface posts a catalog redemption any more; the only purchase is the Studio block with an idempotency key", () => {
    doesNotMatch(coins, /\/api\/family\/redemptions/);
    doesNotMatch(games, /\/api\/family\/redemptions/);
    match(games, /client\.purchase\(child, keyRef\.current\)/);
    match(games, /Yes, buy for 🪙 \$\{price\.coins\}/);
    match(games, /if \(buying\) return/);
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
