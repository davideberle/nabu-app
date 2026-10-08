// Unit tests for the Family Child Shell contract: strict child-id
// normalization, UI-owned selection persistence, the three-destination
// navigation, week identity, reward definitions, and the
// fail-closed game-identity seam.
// Run with: npm test  (node --test; Node strips types natively)

import { deepStrictEqual, doesNotThrow, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHILD_SHELL_STORAGE_KEY,
  approvedGameLibrary,
  childGameIdentity,
  childShellDestinationHref,
  childShellDestinations,
  childShellWeekInfo,
  normalizeChildId,
  readStoredChild,
  resolveShellRewards,
  resolveShellRoutines,
  storeSelectedChild,
  type ChildShellStorage,
  activeShellDestination,
  childShellHeaderDestinations,
  guardedPlayHref,
} from "./family-child-shell.ts";
import { isChildId } from "./family-assistant-turn.ts";

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
  it("address every child surface, with Home first and the legacy paths unchanged (DESIGN §7.5)", () => {
    deepStrictEqual(
      childShellDestinations.map((d) => d.id),
      ["home", "assistant", "record", "activity", "rewards", "learn", "games", "listen"],
    );
    deepStrictEqual(
      childShellDestinations.map((d) => d.path),
      [
        "/family/home",
        "/family/assistant",
        "/family/assistant/record",
        "/family/activity",
        "/family/rewards",
        "/family/learn",
        "/family/games",
        "/family/listen",
      ],
    );
    // The persistent header shows Home only; everything else is reached from Home.
    deepStrictEqual(childShellHeaderDestinations.map((d) => d.id), ["home"]);
    equal(childShellDestinations.find((d) => d.id === "home")!.label, "Home");
    // October 8, 2026: the weekly grid is retired; /family/rewards is the Coins surface, not a shop.
    equal(childShellDestinations.some((d) => d.path === "/family/plan"), false);
    equal(childShellDestinations.find((d) => d.id === "rewards")!.label, "Coins");
  });

  it("maps every pathname to its destination", () => {
    equal(activeShellDestination("/family/home"), "home");
    equal(activeShellDestination("/family/activity"), "activity");
    equal(activeShellDestination("/family/games/edit"), "games");
    equal(activeShellDestination("/family/assistant/record"), "record");
    equal(activeShellDestination("/family/assistant"), "assistant");
    equal(activeShellDestination("/family/learn/mission"), "learn");
    equal(activeShellDestination("/family/plan"), "activity", "legacy plan URLs belong to Activity");
  });

  it("builds hrefs that carry the validated child", () => {
    equal(
      childShellDestinationHref("assistant", "santiago"),
      "/family/assistant?child=santiago",
    );
    equal(
      childShellDestinationHref("activity", "isabel", "2026-W34"),
      "/family/activity?child=isabel&week=2026-W34",
    );
    // Coins carries no week: there is no weekly view of the wallet (UI-03).
    equal(
      childShellDestinationHref("rewards", "santiago", "2026-W34"),
      "/family/rewards?child=santiago",
    );
  });

  it("drops invalid child and week values instead of forwarding them", () => {
    equal(childShellDestinationHref("activity", "Santiago", "2026-W34"), "/family/activity?week=2026-W34");
    equal(childShellDestinationHref("activity", null, "2026-W34"), "/family/activity?week=2026-W34");
    equal(childShellDestinationHref("activity", "isabel", "banana"), "/family/activity?child=isabel");
    equal(childShellDestinationHref("activity", "isabel", "2026-W3"), "/family/activity?child=isabel");
    equal(childShellDestinationHref("rewards", 42, null), "/family/rewards");
  });

  it("never carries a week on the Assistant or Home destinations", () => {
    equal(
      childShellDestinationHref("assistant", "isabel", "2026-W34"),
      "/family/assistant?child=isabel",
    );
    equal(childShellDestinationHref("home", "isabel", "2026-W34"), "/family/home?child=isabel");
    equal(childShellDestinationHref("activity", "isabel", "2026-W34"), "/family/activity?child=isabel&week=2026-W34");
  });

  it("builds guarded play/edit hrefs only from a validated identity and a stable game id", () => {
    const identity = childGameIdentity("santiago")!;
    equal(guardedPlayHref(identity, "6bd56478-5ea0-4f2a-a2db-be8549a88d05"), "/family/games/play?game=6bd56478-5ea0-4f2a-a2db-be8549a88d05&child=santiago");
    equal(guardedPlayHref(identity, "own-1", "edit"), "/family/games/edit?game=own-1&child=santiago");
    equal(guardedPlayHref(identity, "../etc"), "/family/games?child=santiago");
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

  it("no destination builds week navigation any more (the weekly grid and weekly shop are retired)", () => {
    equal(info.weekId, "2026-W34");
  });
});

// ---------------------------------------------------------------------------
// Reward projection — the person-board wallet math
// ---------------------------------------------------------------------------

const EMPTY_CONFIG = { routineOverrides: {}, rewardOverrides: {} };

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
    // §7.5.1). Since October 8, 2026 it launches through the guarded play
    // surface on the daily chess lease; the bundle is embedded and gated.
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
    equal(chess.hrefFor(santi), "/family/games/play?game=adaptive-chess-coach&child=santiago");
    equal(chess.hrefFor(isabel), "/family/games/play?game=adaptive-chess-coach&child=isabel");
  });
});
