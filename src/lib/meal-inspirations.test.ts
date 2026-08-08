// Integration tests for weekly web-inspiration ensure/import orchestration
// (Phase 3B). Run with: npm test  (node --test; Node 24 strips types natively)
//
// A real libsql file database in a temp directory backs the provenance and
// claim tables; only the importer child process is faked (a canned report),
// so duplicate refusal, provenance upserts, and claim idempotency are the
// production code paths.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point db.ts at an isolated database before any getDb() call happens.
process.env.NABU_DB_DIR = mkdtempSync(join(tmpdir(), "meal-inspirations-test-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
// Pin the default tracker-only list for the auto-ensure access cases.
delete process.env.IPAD_TRACKER_ONLY_EMAILS;

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it, before } from "node:test";
import {
  DEFAULT_WEB_INSPIRATION_COUNT,
  ensureWeeklyInspirations,
  recordEligibleImports,
  getInspirationExclusionIds,
  getInspirationProvenanceSets,
  shouldAutoEnsureWeeklyInspirations,
} from "./meal-inspirations.ts";
import { evaluatePlannerWriteAccess } from "./access.ts";
import { getDb, getWebInspirationsForWeek } from "./db.ts";
import type { Recipe } from "./recipes.ts";

const WEEK = "2026-W31";

function makeRecipe(id: string, name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    servings: "4",
    ingredients: [
      { item: "onion", amount: "1" },
      { item: "olive oil", amount: "2 tbsp" },
      { item: "salt", amount: "" },
    ],
    method: ["Step one.", "Step two."],
    category: { dish_type: ["main"], chapter: "" },
    ...extra,
  };
}

const CANNED_REPORT = {
  imported: [
    { id: "web-a", url: "https://fooby.ch/en/recipes/web-a", source: "FOOBY" },
    { id: "web-condiment", url: "https://fooby.ch/en/recipes/web-condiment", source: "FOOBY" },
    { id: "web-missing", url: "https://example.com/web-missing", source: "Example" },
  ],
  errors: [],
  skipped: [],
};

const fakeExec = async () => ({ stdout: JSON.stringify(CANNED_REPORT), stderr: "" });

before(async () => {
  const client = await getDb();
  const now = new Date().toISOString();
  const seed = [
    makeRecipe("web-a", "Grilled Halloumi Bowls", { visibility: "planner-candidate" }),
    makeRecipe("web-condiment", "Quick pickle brine", {
      visibility: "planner-candidate",
      category: { dish_type: ["condiment"], chapter: "" },
    }),
  ];
  for (const recipe of seed) {
    await client.execute({
      sql: "INSERT INTO recipes (id, data, created_at) VALUES (?, ?, ?)",
      args: [recipe.id, JSON.stringify(recipe), now],
    });
  }
});

describe("ensureWeeklyInspirations", () => {
  it("imports, gates, and records provenance exactly once for a fresh week", async () => {
    const result = await ensureWeeklyInspirations(WEEK, 8, { exec: fakeExec });
    equal(result.status, "succeeded");
    if (result.status === "succeeded") {
      equal(result.accepted, 1, "only the planner-main FOOBY import is accepted");
    }

    const stored = await getWebInspirationsForWeek(WEEK);
    deepStrictEqual(stored.map((row) => row.recipe_id), ["web-a"]);
  });

  it("is idempotent: the claim blocks an immediate retry entirely", async () => {
    let execCalled = false;
    const result = await ensureWeeklyInspirations(WEEK, 8, {
      exec: async () => {
        execCalled = true;
        return fakeExec();
      },
    });
    equal(result.status, "claim-not-acquired");
    equal(execCalled, false, "importer is not run while the claim is held");
  });

  it("re-running the import path never duplicates provenance rows", async () => {
    // Bypass the claim to simulate a retry after the cooldown with the same
    // importer output: the current-week provenance dedup rejects every entry.
    const result = await ensureWeeklyInspirations(WEEK, 8, {
      exec: fakeExec,
      claim: async () => true,
      complete: async () => {},
    });
    equal(result.status, "succeeded");
    if (result.status === "succeeded") {
      equal(result.accepted, 0, "already-recorded ideas are skipped as duplicates");
      equal(result.skippedDuplicates, 1, "web-a counted as duplicate");
    }

    const stored = await getWebInspirationsForWeek(WEEK);
    deepStrictEqual(stored.map((row) => row.recipe_id), ["web-a"], "still exactly one provenance row");
  });

  it("records a failed run and reports the error", async () => {
    const result = await ensureWeeklyInspirations("2026-W36", 8, {
      exec: async () => {
        throw new Error("network down");
      },
    });
    equal(result.status, "failed");
    if (result.status === "failed") {
      ok(result.error.includes("network down"));
    }
    const client = await getDb();
    const row = await client.execute({
      sql: "SELECT status FROM weekly_inspiration_ensure_runs WHERE week = ?",
      args: ["2026-W36"],
    });
    equal(row.rows[0]?.["status"], "failed");
  });
});

describe("shouldAutoEnsureWeeklyInspirations (GET auto-ensure gate)", () => {
  // Fixed "today" so the current/past/future cases cannot drift with the clock.
  const CURRENT = "2026-W31";
  const base = {
    week: CURRENT,
    storedCount: 0,
    ensureParam: null,
    authorizedForEnsure: true,
    currentWeek: CURRENT,
  };

  it("pins the documented default weekly inspiration count", () => {
    equal(DEFAULT_WEB_INSPIRATION_COUNT, 8);
  });

  it("never ensures for an anonymous request — no claim/import writes", () => {
    const anonymous = evaluatePlannerWriteAccess(null);
    equal(anonymous.allowed, false);
    equal(
      shouldAutoEnsureWeeklyInspirations({ ...base, authorizedForEnsure: anonymous.allowed }),
      false,
    );
  });

  it("never ensures for a tracker-only session", () => {
    const tracker = evaluatePlannerWriteAccess({ user: { email: "assistant@davideberle.com" } });
    equal(tracker.allowed, false);
    equal(
      shouldAutoEnsureWeeklyInspirations({ ...base, authorizedForEnsure: tracker.allowed }),
      false,
    );
  });

  it("ensures a fresh current week for the canonical authorized session", () => {
    const admin = evaluatePlannerWriteAccess({ user: { email: "info@davideberle.com" } });
    equal(admin.allowed, true);
    equal(
      shouldAutoEnsureWeeklyInspirations({ ...base, authorizedForEnsure: admin.allowed }),
      true,
    );
  });

  it("ensures future weeks but never past weeks", () => {
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, week: "2026-W32" }), true);
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, week: "2027-W01" }), true);
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, week: "2026-W30" }), false);
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, week: "2025-W52" }), false);
  });

  it("honors ensure=0 for read-only verification", () => {
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, ensureParam: "0" }), false);
  });

  it("does not re-ensure a week that already has stored inspirations", () => {
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, storedCount: 1 }), false);
  });

  it("rejects malformed week ids", () => {
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, week: "2026-W1" }), false);
    equal(shouldAutoEnsureWeeklyInspirations({ ...base, week: "not-a-week" }), false);
  });
});

describe("recordEligibleImports", () => {
  it("skips non-main imports and reports missing My Recipes", async () => {
    const exclusionIds = await getInspirationExclusionIds("2026-W37");
    const provenance = await getInspirationProvenanceSets("2026-W37");
    const result = await recordEligibleImports("2026-W37", CANNED_REPORT, exclusionIds, provenance);
    deepStrictEqual(result.accepted.map((a) => a.recipe.id), ["web-a"]);
    deepStrictEqual(result.skippedNonMain, ["web-condiment"]);
    deepStrictEqual(result.missingMyRecipeIds, ["web-missing"]);
  });

  it("skips recipes and source URLs already used in recent prior weeks", async () => {
    const exclusionIds = await getInspirationExclusionIds("2026-W38");
    const provenance = await getInspirationProvenanceSets("2026-W38");
    // WEEK (2026-W31) is not within 2026-W38's five-week lookback, so seed the
    // sets directly to model a recent prior week.
    provenance.recentSourceUrls.add("https://fooby.ch/en/recipes/web-a");
    const result = await recordEligibleImports("2026-W38", CANNED_REPORT, exclusionIds, provenance);
    deepStrictEqual(result.accepted, []);
    ok(result.skippedDuplicates.includes("web-a"));
  });
});
