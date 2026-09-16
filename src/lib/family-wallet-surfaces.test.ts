import { doesNotMatch, match } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("family wallet consumer contract", () => {
  const rewards = source("../app/family/(shell)/rewards/client.tsx");
  const person = source("../app/family/dashboard/[person]/client.tsx");
  const overview = source("../app/family/dashboard/client.tsx");
  const assistant = source("../app/family/(shell)/assistant/client.tsx");

  for (const [name, consumer] of [
    ["child Rewards", rewards],
    ["person board", person],
    ["overview", overview],
    ["child Home", assistant],
  ] as const) {
    it(`${name} reads the authenticated permanent-wallet projection`, () => {
      match(consumer, /fetch\("\/api\/family\/wallet"\)/);
    });
  }

  it("redemption clients omit viewed week so the server stamps today", () => {
    match(rewards, /JSON\.stringify\(\{ personId: child, rewardId \}\)/);
    match(person, /JSON\.stringify\(\{ personId, rewardId \}\)/);
    doesNotMatch(rewards, /personId: child, rewardId, week/);
    doesNotMatch(person, /personId, rewardId, week: weekNav\.weekId/);
  });

  it("preserves both redemption buttons' double-submit guards", () => {
    match(rewards, /if \(!child \|\| redeemingReward\) return/);
    match(person, /if \(redeemingReward\) return/);
    match(rewards, /disabled=\{!canAfford \|\| redeemingReward !== null\}/);
  });

  it("keeps weekly completion context separate from wallet balance", () => {
    match(rewards, /weekPoints\(child, completions, resolveShellRoutines\(config\)\)/);
    match(rewards, /walletProjection\?\.wallets\[child\]/);
    match(person, /weekPoints\(personId, completionList, resolvedRoutines\)/);
    match(person, /walletProjection\?\.wallets\[personId\]/);
  });
});
