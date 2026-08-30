// Unit tests for the Family Child Shell contract: strict child-id
// normalization, UI-owned selection persistence, the three-destination
// navigation, week identity, the reward wallet projection, and the
// fail-closed game-identity seam.
// Run with: npm test  (node --test; Node strips types natively)

import { deepStrictEqual, doesNotThrow, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHILD_SHELL_STORAGE_KEY,
  approvedGameLibrary,
  buildPlanWeekNav,
  buildRewardsWeekNav,
  childGameIdentity,
  childShellDestinationHref,
  childShellDestinations,
  childShellWeekInfo,
  computeChildWallet,
  normalizeChildId,
  readStoredChild,
  resolveShellRewards,
  resolveShellRoutines,
  storeSelectedChild,
  type ChildShellStorage,
} from "./family-child-shell.ts";
import { isChildId } from "./family-assistant-turn.ts";
import type { CompletionRecord } from "../data/family-routines.ts";

// ---------------------------------------------------------------------------
// Child identity
// ---------------------------------------------------------------------------

describe("normalizeChildId", () => {
  it("accepts exactly the two children", () => {
    equal(normalizeChildId("santiago"), "santiago");
    equal(normalizeChildId("isabel"), "isabel");
  });

  it("rejects everything else — no trimming, case-folding or coercion", () => {
    for (const value of [
      "Santiago",
      "ISABEL",
      " santiago",
      "isabel ",
      "santiago\n",
      "david",
      "marisol",
      "main",
      "santiago,isabel",
      "../santiago",
      "",
      null,
      undefined,
      42,
      true,
      {},
      ["santiago"],
    ]) {
      equal(normalizeChildId(value), null, JSON.stringify(value));
    }
  });

  it("agrees with the canonical transport allowlist (isChildId)", () => {
    for (const value of ["santiago", "isabel", "Santiago", "david", "", null, 7]) {
      equal(normalizeChildId(value), isChildId(value) ? value : null);
    }
  });
});

// ---------------------------------------------------------------------------
// Selection persistence
// ---------------------------------------------------------------------------

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const calls: string[] = [];
  const storage: ChildShellStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      calls.push(`set:${key}=${value}`);
      store.set(key, value);
    },
    removeItem: (key) => {
      calls.push(`remove:${key}`);
      store.delete(key);
    },
  };
  return { storage, store, calls };
}

describe("selection persistence", () => {
  it("round-trips a valid child", () => {
    const { storage, store } = fakeStorage();
    storeSelectedChild(storage, "isabel");
    equal(store.get(CHILD_SHELL_STORAGE_KEY), "isabel");
    equal(readStoredChild(storage), "isabel");
  });

  it("never stores an invalid value — it clears the key instead", () => {
    const { storage, store, calls } = fakeStorage({
      [CHILD_SHELL_STORAGE_KEY]: "santiago",
    });
    storeSelectedChild(storage, "david");
    equal(store.has(CHILD_SHELL_STORAGE_KEY), false);
    ok(calls.includes(`remove:${CHILD_SHELL_STORAGE_KEY}`));
  });

  it("reads junk in storage as no selection", () => {
    const { storage } = fakeStorage({ [CHILD_SHELL_STORAGE_KEY]: "Santiago" });
    equal(readStoredChild(storage), null);
  });

  it("survives an unavailable or throwing storage", () => {
    equal(readStoredChild(null), null);
    doesNotThrow(() => storeSelectedChild(null, "santiago"));
    const throwing: ChildShellStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    equal(readStoredChild(throwing), null);
    doesNotThrow(() => storeSelectedChild(throwing, "santiago"));
  });
});

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

describe("shell destinations", () => {
  it("are exactly Home, Plan and Rewards", () => {
    deepStrictEqual(
      childShellDestinations.map((d) => d.id),
      ["assistant", "plan", "rewards"],
    );
    // The first destination's child-facing label is Home
    // (family-assistant DESIGN.md §2.1) while its id and path stay
    // `assistant` / `/family/assistant` so deep links and the installed PWA
    // are untouched.
    deepStrictEqual(
      childShellDestinations.map((d) => d.label),
      ["Home", "Plan", "Rewards"],
    );
    deepStrictEqual(
      childShellDestinations.map((d) => d.path),
      ["/family/assistant", "/family/plan", "/family/rewards"],
    );
  });

  it("builds hrefs that carry the validated child", () => {
    equal(
      childShellDestinationHref("assistant", "santiago"),
      "/family/assistant?child=santiago",
    );
    equal(
      childShellDestinationHref("plan", "isabel", "2026-W34"),
      "/family/plan?child=isabel&week=2026-W34",
    );
    equal(
      childShellDestinationHref("rewards", "santiago", "2026-W34"),
      "/family/rewards?child=santiago&week=2026-W34",
    );
  });

  it("drops invalid child and week values instead of forwarding them", () => {
    equal(childShellDestinationHref("plan", "Santiago", "2026-W34"), "/family/plan?week=2026-W34");
    equal(childShellDestinationHref("plan", null, "2026-W34"), "/family/plan?week=2026-W34");
    equal(childShellDestinationHref("plan", "isabel", "banana"), "/family/plan?child=isabel");
    equal(childShellDestinationHref("plan", "isabel", "2026-W3"), "/family/plan?child=isabel");
    equal(childShellDestinationHref("rewards", 42, null), "/family/rewards");
  });

  it("never carries a week on the Assistant destination", () => {
    equal(
      childShellDestinationHref("assistant", "isabel", "2026-W34"),
      "/family/assistant?child=isabel",
    );
  });
});

// ---------------------------------------------------------------------------
// Week identity and Plan/Rewards navigation
// ---------------------------------------------------------------------------

describe("childShellWeekInfo", () => {
  // 2026-08-17 is the Monday of ISO week 2026-W34 — the post-vacation
  // restart week named in the family docs.
  const now = new Date(2026, 7, 17, 12, 0, 0);

  it("resolves an explicit week with prev/next identity", () => {
    const info = childShellWeekInfo("2026-W30", now);
    equal(info.weekId, "2026-W30");
    equal(info.currentWeekId, "2026-W34");
    equal(info.prevWeekId, "2026-W29");
    equal(info.nextWeekId, "2026-W31");
    ok(info.rangeLabel.length > 0);
  });

  it("falls back to the current week for absent or invalid params", () => {
    equal(childShellWeekInfo(undefined, now).weekId, "2026-W34");
    equal(childShellWeekInfo("banana", now).weekId, "2026-W34");
    equal(childShellWeekInfo("2026-W99", now).weekId, "2026-W34");
  });
});

describe("plan and rewards week navigation", () => {
  const info = {
    weekId: "2026-W34",
    currentWeekId: "2026-W34",
    rangeLabel: "Mon 08-17 - Sun 08-23",
    prevWeekId: "2026-W33",
    nextWeekId: "2026-W35",
  };

  it("keeps every Plan href inside the shell and scoped to the child", () => {
    const nav = buildPlanWeekNav(info, "santiago");
    equal(nav.prevHref, "/family/plan?child=santiago&week=2026-W33");
    equal(nav.currentHref, "/family/plan?child=santiago&week=2026-W34");
    equal(nav.nextHref, "/family/plan?child=santiago&week=2026-W35");
    equal(nav.overviewHref, "/family/dashboard?week=2026-W34");
    equal(nav.weekId, "2026-W34");
    equal(nav.rangeLabel, info.rangeLabel);
  });

  it("does the same for Rewards", () => {
    const nav = buildRewardsWeekNav(info, "isabel");
    equal(nav.prevHref, "/family/rewards?child=isabel&week=2026-W33");
    equal(nav.nextHref, "/family/rewards?child=isabel&week=2026-W35");
  });
});

// ---------------------------------------------------------------------------
// Reward projection — the person-board wallet math
// ---------------------------------------------------------------------------

const EMPTY_CONFIG = { routineOverrides: {}, rewardOverrides: {} };

const completion = (
  routineId: string,
  personId: string,
  day: number,
  // Accepts arbitrary status strings on purpose: stored completion rows may
  // carry statuses this build's CompletionStatus does not model (for example
  // review states from an older deployment), and the wallet must count only
  // exact `done` rows rather than trusting the type at the storage boundary.
  status: string = "done",
): CompletionRecord => ({ routineId, personId, day, status } as CompletionRecord);

describe("resolveShellRoutines / resolveShellRewards", () => {
  it("returns the full seed definitions for an empty config", () => {
    ok(resolveShellRoutines(EMPTY_CONFIG).some((r) => r.id === "s-kumon"));
    ok(resolveShellRewards(EMPTY_CONFIG).some((r) => r.id === "friends"));
  });

  it("applies overrides with family-db semantics", () => {
    const routines = resolveShellRoutines({
      routineOverrides: {
        "s-kumon": { points: 5 },
        // `weeklyTarget` uses presence semantics so an explicit null clears
        // the target (mirrors family-db.ts#resolveRoutines).
        "s-piano": { weeklyTarget: null },
        "s-physio": { enabled: false },
      },
      rewardOverrides: {},
    });
    equal(routines.find((r) => r.id === "s-kumon")?.points, 5);
    equal(routines.find((r) => r.id === "s-piano")?.weeklyTarget, null);
    equal(routines.find((r) => r.id === "s-physio"), undefined);

    const rewards = resolveShellRewards({
      routineOverrides: {},
      rewardOverrides: {
        friends: { costPoints: 1 },
        "mini-game": { enabled: false },
      },
    });
    equal(rewards.find((r) => r.id === "friends")?.costPoints, 1);
    equal(rewards.find((r) => r.id === "mini-game"), undefined);
  });
});

describe("computeChildWallet", () => {
  const completions = [
    completion("s-kumon", "santiago", 0),
    completion("s-piano", "santiago", 0),
    completion("s-physio", "santiago", 1, "pending_review"),
    completion("s-table-dinner", "santiago", 2, "on_hold"),
    completion("i-kumon", "isabel", 0),
    completion("no-such-routine", "santiago", 3),
  ];
  const redemptions = [
    { personId: "santiago", rewardId: "friends" },
    { personId: "isabel", rewardId: "friends" },
  ];

  it("counts only the child's done completions and own redemptions", () => {
    const wallet = computeChildWallet("santiago", completions, redemptions, EMPTY_CONFIG);
    // s-kumon + s-piano (1pt each); pending/on-hold and unknown ids earn 0.
    equal(wallet.earned, 2);
    // one `friends` redemption at seed cost 3; Isabel's is not Santiago's.
    equal(wallet.spent, 3);
    equal(wallet.balance, -1);
    deepStrictEqual(wallet.redeemedCounts, { friends: 1 });
  });

  it("projects nothing across siblings", () => {
    const wallet = computeChildWallet("isabel", completions, redemptions, EMPTY_CONFIG);
    equal(wallet.earned, 1);
    deepStrictEqual(wallet.redeemedCounts, { friends: 1 });
    equal(wallet.spent, 3);
  });

  it("respects config overrides exactly like the board and the API", () => {
    const wallet = computeChildWallet("santiago", completions, redemptions, {
      routineOverrides: { "s-kumon": { points: 5 } },
      rewardOverrides: { friends: { costPoints: 1 } },
    });
    equal(wallet.earned, 6);
    equal(wallet.spent, 1);
    equal(wallet.balance, 5);
  });

  it("treats a disabled reward's past redemptions as costless, like the board", () => {
    const wallet = computeChildWallet("santiago", completions, redemptions, {
      routineOverrides: {},
      rewardOverrides: { friends: { enabled: false } },
    });
    equal(wallet.spent, 0);
    equal(wallet.balance, 2);
  });

  it("is zero across the board for an empty week", () => {
    const wallet = computeChildWallet("santiago", [], [], EMPTY_CONFIG);
    deepStrictEqual(wallet, { earned: 0, spent: 0, balance: 0, redeemedCounts: {} });
  });
});

// ---------------------------------------------------------------------------
// Game seam — fail closed
// ---------------------------------------------------------------------------

describe("game identity seam", () => {
  it("derives an identity only from a valid selected child", () => {
    deepStrictEqual(childGameIdentity("santiago"), { childId: "santiago" });
    deepStrictEqual(childGameIdentity("isabel"), { childId: "isabel" });
  });

  it("fails closed for everything else — a child cannot name a sibling id", () => {
    for (const value of ["Santiago", "isabel ", "david", "", null, undefined, 1, {}]) {
      equal(childGameIdentity(value), null, JSON.stringify(value));
    }
  });

  it("ships the Adaptive Chess Coach pilot as the first approved game", () => {
    // The first real Game Studio integration (family-assistant/DESIGN.md
    // §7.5.1). It has its own launch route (/family/rewards/chess), the
    // vendored bundle under public/games, and the middleware allowlist entry.
    const chess = approvedGameLibrary.find((g) => g.gameId === "adaptive-chess-coach");
    equal(!!chess, true);
    equal(typeof chess!.title, "string");
    equal(typeof chess!.tagline, "string");
  });

  it("builds the launch href only from a validated identity (no free-form id)", () => {
    const chess = approvedGameLibrary.find((g) => g.gameId === "adaptive-chess-coach")!;
    // hrefFor takes a ChildGameIdentity, which can only be produced by
    // childGameIdentity() from a valid selected child — so the launched child
    // is always one of the real ids, never a browser-crafted string.
    const santi = childGameIdentity("santiago")!;
    const isabel = childGameIdentity("isabel")!;
    equal(chess.hrefFor(santi), "/family/rewards/chess?child=santiago");
    equal(chess.hrefFor(isabel), "/family/rewards/chess?child=isabel");
  });
});
