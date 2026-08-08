// Thursday preparation, the Friday watchdog, and week rollover.
//
// Every data dependency is injected, so this drives the real orchestration
// without a database, the recipe bundle, or the network.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessShelfHealth,
  assignedRecipeIdsForPlan,
  catalogExclusionIds,
  hydrateShelfItems,
  nextWeekId,
  prepareWeek,
  previousWeekId,
  rolloverWeek,
  runWatchdog,
  toShelfCandidate,
  weekSpanEndingAt,
  SHELF_STALE_DAYS,
  type PlanSaveOutcome,
  type PreparationDeps,
  type RolloverDeps,
} from "./planner-preparation.ts";
import { SHELF_POLICY_VERSION, type ShelfCandidate, type ShelfTraits } from "./planner-shelf.ts";
import { recordUnselectedExposure, type ExposureRecord } from "./planner-exposure.ts";
import type { StagedWebRecipe } from "./planner-staging.ts";
import type { MealPlan } from "./meals.ts";
import type { Recipe } from "./recipes.ts";

const NOW = new Date("2026-08-13T05:30:00.000Z"); // a Thursday
const WEEK = "2026-W34";

function traits(overrides: Partial<ShelfTraits> = {}): ShelfTraits {
  return {
    shape: "other",
    protein: "vegetarian",
    starch: "none",
    effort: "medium",
    weekdayFit: true,
    weekendFit: true,
    vegetableDense: true,
    seasonalLocal: false,
    longHaul: false,
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<ShelfCandidate> = {}): ShelfCandidate {
  return {
    recipeId: id,
    recipeName: `Recipe ${id}`,
    origin: "catalog",
    discovery: "catalog",
    role: "main",
    bucket: "vegetarian",
    cuisine: "Other",
    image: "/recipes/x.jpg",
    traits: traits(),
    ...overrides,
  };
}

function catalogPool(size = 24): ShelfCandidate[] {
  const shapes = ["soup", "salad", "stew-curry", "bowl", "roast-bake", "grill", "stir-fry", "other"] as const;
  const proteins = ["vegan", "vegetarian", "fish", "vegetarian", "meat", "vegan", "vegetarian", "vegan"] as const;
  const efforts = ["quick", "medium", "project", "quick", "medium", "quick", "quick", "medium"] as const;
  const cuisines = ["Italian", "Indian", "Greek", "Swiss", "Thai", "Mexican", "French", "Japanese"];
  return Array.from({ length: size }, (_, i) =>
    candidate(`catalog-${i}`, {
      traits: traits({
        shape: shapes[i % shapes.length],
        protein: proteins[i % proteins.length],
        effort: efforts[i % efforts.length],
        seasonalLocal: i % 3 === 0,
      }),
      cuisine: cuisines[i % cuisines.length],
    }),
  );
}

function emptyPlan(week = WEEK): MealPlan {
  return {
    week,
    status: "draft",
    plannerVersion: "vNext-1",
    candidateSet: null,
    days: [
      { date: "2026-08-17", dayOfWeek: "Monday", type: "weekday", planningState: "open", recipeId: null, recipeName: null },
      { date: "2026-08-18", dayOfWeek: "Tuesday", type: "weekday", planningState: "open", recipeId: null, recipeName: null },
    ],
    context: [],
    notes: "",
    locked: false,
    createdAt: NOW.toISOString(),
  };
}

type Harness = {
  deps: PreparationDeps;
  saved: MealPlan[];
  ensureCalls: number;
  claims: string[];
  completions: { week: string; kind: string; status: string }[];
};

function harness(options: {
  plan?: MealPlan | null;
  web?: ShelfCandidate[];
  catalog?: ShelfCandidate[];
  claimResult?: boolean;
  ensure?: () => Promise<{ status: string; accepted?: number; error?: string }>;
  /** Stands in for the real save boundary: refusal, or a sanitized rewrite. */
  save?: (plan: MealPlan) => Promise<PlanSaveOutcome>;
} = {}): Harness {
  const state = { plan: options.plan === undefined ? emptyPlan() : options.plan };
  const h: Harness = {
    saved: [],
    ensureCalls: 0,
    claims: [],
    completions: [],
    deps: {} as PreparationDeps,
  };
  h.deps = {
    now: NOW,
    loadPlan: async () => state.plan,
    savePlan: async (plan) => {
      const outcome = options.save ? await options.save(plan) : { ok: true as const, plan };
      if (outcome.ok) {
        h.saved.push(outcome.plan);
        state.plan = outcome.plan;
      }
      return outcome;
    },
    ensureWebInspirations: async () => {
      h.ensureCalls += 1;
      return options.ensure ? options.ensure() : { status: "succeeded", accepted: 3 };
    },
    loadWebCandidates: async () => options.web ?? [],
    loadCatalogCandidates: async () => options.catalog ?? catalogPool(),
    claim: async (week, kind) => {
      h.claims.push(`${week}:${kind}`);
      return options.claimResult ?? true;
    },
    complete: async (week, kind, status) => {
      h.completions.push({ week, kind, status });
    },
  };
  return h;
}

// ---------------------------------------------------------------------------
// Shelf health
// ---------------------------------------------------------------------------

describe("shelf health", () => {
  function healthyPlan(): MealPlan {
    return {
      ...emptyPlan(),
      candidateSet: {
        generatedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
        policyVersion: SHELF_POLICY_VERSION,
        items: Array.from({ length: 13 }, (_, i) => ({
          recipeId: `r-${i}`,
          recipeName: `R ${i}`,
          dietary: [],
          cuisine: "Other",
          time: null,
          category: "main",
          courseTags: [],
          bucket: "vegetarian" as const,
        })),
      },
    };
  }

  it("accepts a full, current, correctly-versioned set", () => {
    const health = assessShelfHealth(healthyPlan(), NOW);
    equal(health.healthy, true);
    deepStrictEqual(health.problems, []);
  });

  it("rejects a missing plan or an empty set", () => {
    equal(assessShelfHealth(null, NOW).healthy, false);
    equal(assessShelfHealth({ ...emptyPlan(), candidateSet: null }, NOW).healthy, false);
    equal(
      assessShelfHealth(
        { ...emptyPlan(), candidateSet: { generatedAt: NOW.toISOString(), policyVersion: SHELF_POLICY_VERSION, items: [] } },
        NOW,
      ).healthy,
      false,
    );
  });

  it("rejects a short set", () => {
    const plan = healthyPlan();
    plan.candidateSet!.items = plan.candidateSet!.items.slice(0, 5);
    const health = assessShelfHealth(plan, NOW);
    equal(health.healthy, false);
    ok(health.problems.some((p) => p.includes("only 5 ideas")));
  });

  it("rejects a stale set", () => {
    const plan = healthyPlan();
    plan.candidateSet!.generatedAt = new Date(NOW.getTime() - (SHELF_STALE_DAYS + 2) * 86_400_000).toISOString();
    const health = assessShelfHealth(plan, NOW);
    equal(health.healthy, false);
    ok(health.problems.some((p) => p.includes("older than")));
  });

  it("rejects a set written under an older policy", () => {
    const plan = healthyPlan();
    plan.candidateSet!.policyVersion = "planner-v2.2";
    equal(assessShelfHealth(plan, NOW).healthy, false);
  });

  it("rejects a set with a malformed item", () => {
    const plan = healthyPlan();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plan.candidateSet!.items as any)[0] = { recipeName: "no id" };
    equal(assessShelfHealth(plan, NOW).healthy, false);
  });
});

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

describe("weekly preparation", () => {
  it("runs discovery, assembles a shelf, and persists it", async () => {
    const h = harness({
      web: [
        candidate("web-1", { origin: "web", discovery: "editorial", sourceName: "FOOBY" }),
        candidate("web-2", { origin: "web", discovery: "editorial", sourceName: "Cookie and Kate" }),
      ],
    });
    const outcome = await prepareWeek(WEEK, h.deps);

    equal(outcome.status, "prepared");
    equal(h.ensureCalls, 1);
    equal(h.saved.length, 1);
    const set = h.saved[0].candidateSet!;
    equal(set.policyVersion, SHELF_POLICY_VERSION);
    ok(set.items.length >= 12 && set.items.length <= 14);
    ok(set.shelfDiagnostics, "diagnostics are persisted with the shelf");
    deepStrictEqual(h.completions, [{ week: WEEK, kind: "prepare", status: "succeeded" }]);
  });

  it("creates the week record when none exists yet", async () => {
    const h = harness({ plan: null });
    await prepareWeek(WEEK, h.deps);
    equal(h.saved[0].week, WEEK);
    equal(h.saved[0].days.length, 7, "a prepared week always has seven day slots");
  });

  it("keeps assigned days fixed and pins their recipes as disabled cards", async () => {
    const plan = emptyPlan();
    plan.days[0] = { ...plan.days[0], planningState: "assigned", recipeId: "catalog-3", recipeName: "Recipe catalog-3" };
    const h = harness({ plan });

    await prepareWeek(WEEK, h.deps);
    const saved = h.saved[0];
    equal(saved.days[0].recipeId, "catalog-3", "the assignment is untouched");
    const pinned = saved.candidateSet!.items.find((i) => i.recipeId === "catalog-3");
    ok(pinned, "the assigned recipe stays visible on the shelf");
    equal(pinned!.reason, "Assigned to a day this week");
  });

  it("prepares anyway when web discovery fails", async () => {
    const h = harness({ ensure: async () => ({ status: "failed", error: "surface blocked" }) });
    const outcome = await prepareWeek(WEEK, h.deps);
    equal(outcome.status, "prepared");
    ok((outcome.shelfSize ?? 0) >= 12, "the catalog covers the week on its own");
  });

  it("does nothing when the claim is lost, so two runs cannot collide", async () => {
    const h = harness({ claimResult: false });
    const outcome = await prepareWeek(WEEK, h.deps);
    equal(outcome.status, "claim-not-acquired");
    equal(h.saved.length, 0);
    equal(h.ensureCalls, 0);
  });

  it("reports a failure instead of throwing, and records it", async () => {
    const h = harness();
    h.deps.loadCatalogCandidates = async () => { throw new Error("catalog unavailable"); };
    const outcome = await prepareWeek(WEEK, h.deps);
    equal(outcome.status, "failed");
    equal(outcome.error, "catalog unavailable");
    deepStrictEqual(h.completions, [{ week: WEEK, kind: "prepare", status: "failed" }]);
  });

  it("reports a failure when the save boundary refuses the write", async () => {
    // A locked week is the standing case: the plan is protected, so nothing is
    // written — and preparation must not claim it prepared a shelf.
    const h = harness({ save: async () => ({ ok: false, reason: "locked" }) });
    const outcome = await prepareWeek(WEEK, h.deps);

    equal(outcome.status, "failed");
    ok(outcome.error?.includes("locked"), "the refusal reason is reported");
    equal(outcome.shelfSize, undefined, "no shelf size is claimed for a week that was not written");
    equal(h.saved.length, 0);
    deepStrictEqual(h.completions, [{ week: WEEK, kind: "prepare", status: "failed" }]);
  });

  it("reports what the save actually stored, not what was assembled", async () => {
    // The save boundary sanitizes: recently cooked, recently planned and
    // thumbs-downed candidates are dropped on the way to disk. If preparation
    // reported the assembled size, a week could be left short while the run log
    // and the status endpoint both said it was full.
    const h = harness({
      save: async (plan) => ({
        ok: true,
        plan: {
          ...plan,
          candidateSet: { ...plan.candidateSet!, items: plan.candidateSet!.items.slice(0, 3) },
        },
      }),
    });
    const outcome = await prepareWeek(WEEK, h.deps);

    equal(outcome.status, "prepared");
    equal(outcome.shelfSize, 3, "the stored count, not the assembled one");
    equal(outcome.healthy, false, "a set sanitized down to three ideas is not healthy");
    ok(
      outcome.warnings?.some((w) => w.includes("saved shelf: only 3 ideas")),
      "and the run says why",
    );
    equal(h.saved[0].candidateSet!.items.length, 3);
  });

  it("is idempotent: re-running produces the same shelf", async () => {
    const h1 = harness();
    await prepareWeek(WEEK, h1.deps);
    const h2 = harness({ plan: h1.saved[0] });
    await prepareWeek(WEEK, h2.deps);
    deepStrictEqual(
      h2.saved[0].candidateSet!.items.map((i) => i.recipeId),
      h1.saved[0].candidateSet!.items.map((i) => i.recipeId),
    );
  });
});

// ---------------------------------------------------------------------------
// Catalog eligibility
// ---------------------------------------------------------------------------

describe("catalog exclusions", () => {
  function staged(recipeId: string, promotedAt: string | null): StagedWebRecipe {
    return {
      recipeId,
      week: "2026-W30",
      sourceUrl: `https://fooby.ch/${recipeId}`,
      sourceName: "FOOBY",
      importedAt: NOW.toISOString(),
      keptAt: promotedAt ? NOW.toISOString() : null,
      promotedAt,
    };
  }

  it("excludes staging that is still staging", () => {
    const excluded = catalogExclusionIds({
      recentlyCooked: [],
      recentlyPlanned: [],
      negativeFeedback: [],
      legacyOffered: [],
      exposureExcluded: [],
      staged: [staged("still-hidden", null)],
    });
    deepStrictEqual([...excluded], ["still-hidden"]);
  });

  it("keeps a promoted web recipe eligible for gap-fill", () => {
    // Promotion turns the recipe into a normal My Recipe; the provenance row
    // stays behind only to record where it came from. Treating that row as
    // staging forever would make every web idea he kept permanently
    // unofferable — the catalog would shrink by exactly his favourites.
    const excluded = catalogExclusionIds({
      recentlyCooked: [],
      recentlyPlanned: [],
      negativeFeedback: [],
      legacyOffered: [],
      exposureExcluded: [],
      staged: [staged("kept-and-promoted", NOW.toISOString()), staged("still-hidden", null)],
    });
    equal(excluded.has("kept-and-promoted"), false, "a promoted recipe is David's, not staging");
    equal(excluded.has("still-hidden"), true);
  });

  it("still layers recency, legacy-offered and exposure exclusions", () => {
    const excluded = catalogExclusionIds({
      recentlyCooked: ["cooked"],
      recentlyPlanned: ["planned"],
      negativeFeedback: ["thumbed-down"],
      legacyOffered: ["offered-under-old-policy"],
      exposureExcluded: ["on-cooldown"],
      staged: [staged("promoted", NOW.toISOString())],
    });
    deepStrictEqual(
      [...excluded].sort(),
      ["cooked", "offered-under-old-policy", "on-cooldown", "planned", "thumbed-down"],
    );
  });
});

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

describe("Friday watchdog", () => {
  it("leaves a healthy saved shelf completely untouched", async () => {
    const prepared = harness();
    await prepareWeek(WEEK, prepared.deps);

    const h = harness({ plan: prepared.saved[0] });
    const outcome = await runWatchdog(WEEK, h.deps);

    equal(outcome.status, "already-healthy");
    equal(h.saved.length, 0, "nothing is written");
    equal(h.ensureCalls, 0, "and no discovery runs");
    deepStrictEqual(h.completions, [{ week: WEEK, kind: "watchdog", status: "succeeded" }]);
  });

  it("repairs an empty week", async () => {
    const h = harness({ plan: emptyPlan() });
    const outcome = await runWatchdog(WEEK, h.deps);
    equal(outcome.status, "repaired");
    ok((outcome.shelfSize ?? 0) >= 12);
    ok(outcome.warnings?.some((w) => w.includes("no saved candidate set")));
  });

  it("repairs a short week and says why", async () => {
    const prepared = harness();
    await prepareWeek(WEEK, prepared.deps);
    const short = { ...prepared.saved[0] };
    short.candidateSet = { ...short.candidateSet!, items: short.candidateSet!.items.slice(0, 4) };

    const h = harness({ plan: short });
    const outcome = await runWatchdog(WEEK, h.deps);
    equal(outcome.status, "repaired");
    ok(outcome.warnings?.some((w) => w.includes("only 4 ideas")));
    ok((h.saved[0].candidateSet?.items.length ?? 0) >= 12);
  });

  it("running twice in a row is a no-op the second time", async () => {
    const first = harness({ plan: emptyPlan() });
    await runWatchdog(WEEK, first.deps);

    const second = harness({ plan: first.saved[0] });
    const outcome = await runWatchdog(WEEK, second.deps);
    equal(outcome.status, "already-healthy");
    equal(second.saved.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

describe("week rollover", () => {
  function rolloverHarness(options: {
    plan: MealPlan;
    staged: StagedWebRecipe[];
    /** Records only the age query returns, i.e. older than the week window. */
    overdueStaged?: StagedWebRecipe[];
    exposure?: Map<string, ExposureRecord>;
    assignedAcrossWindow?: Set<string>;
    assignedSince?: Set<string>;
    /** Durable counted-weeks ledger, keyed by week. Shared across runs. */
    countedWeeks?: Map<string, Set<string>>;
  }) {
    const promoted: string[] = [];
    const expired: string[] = [];
    const written: ExposureRecord[] = [];
    const stagedWeeksRequested: string[][] = [];
    const expirableBefore: Date[] = [];
    const assignedSinceRequested: string[] = [];
    // One shared exposure table that persists across runs, exactly as the
    // database does — the whole point of the re-run assertions below.
    const stored = options.exposure ?? new Map<string, ExposureRecord>();
    // The ledger is a table, not a field on the record: a selection clears the
    // record but never these rows, which is the whole point of it existing.
    const ledger = options.countedWeeks ?? new Map<string, Set<string>>();
    const deps: RolloverDeps = {
      now: NOW,
      loadPlan: async () => options.plan,
      loadStagedRecipes: async (weeks) => { stagedWeeksRequested.push(weeks); return options.staged; },
      loadExpirableStagedRecipes: async (before) => {
        expirableBefore.push(before);
        return options.overdueStaged ?? [];
      },
      loadAssignedRecipeIds: async () => options.assignedAcrossWindow ?? new Set<string>(),
      loadAssignedRecipeIdsSince: async (fromWeek) => {
        assignedSinceRequested.push(fromWeek);
        return options.assignedSince ?? new Set<string>();
      },
      loadExposureRecords: async () => new Map(stored),
      saveExposure: async (records) => {
        written.push(...records);
        for (const record of records) stored.set(record.recipeId, record);
      },
      loadCountedExposureIds: async (week) => new Set(ledger.get(week) ?? []),
      saveCountedExposureIds: async (week, recipeIds) => {
        const forWeek = ledger.get(week) ?? new Set<string>();
        for (const id of recipeIds) forWeek.add(id);
        ledger.set(week, forWeek);
      },
      promote: async (record) => { promoted.push(record.recipeId); return true; },
      expire: async (record) => { expired.push(record.recipeId); },
    };
    return { deps, promoted, expired, written, stored, ledger, stagedWeeksRequested, expirableBefore, assignedSinceRequested };
  }

  function planWithShelf(assignedId: string): MealPlan {
    const plan = emptyPlan("2026-W33");
    plan.days[0] = { ...plan.days[0], planningState: "assigned", recipeId: assignedId, recipeName: "Assigned" };
    plan.candidateSet = {
      generatedAt: NOW.toISOString(),
      policyVersion: SHELF_POLICY_VERSION,
      items: [
        { recipeId: assignedId, recipeName: "Assigned", dietary: [], cuisine: "Other", time: null, category: "main", courseTags: [], bucket: "vegetarian", origin: "catalog" },
        { recipeId: "ignored-catalog", recipeName: "Ignored", dietary: [], cuisine: "Other", time: null, category: "main", courseTags: [], bucket: "vegetarian", origin: "catalog" },
        { recipeId: "ignored-web", recipeName: "Ignored Web", dietary: [], cuisine: "Other", time: null, category: "main", courseTags: [], bucket: "vegetarian", origin: "web" },
      ],
    };
    return plan;
  }

  it("promotes kept and assigned web ideas and expires stale unkept ones", async () => {
    const staged: StagedWebRecipe[] = [
      { recipeId: "kept-web", week: "2026-W33", sourceUrl: "https://fooby.ch/1", sourceName: "FOOBY", importedAt: NOW.toISOString(), keptAt: NOW.toISOString(), promotedAt: null },
      { recipeId: "assigned-web", week: "2026-W33", sourceUrl: "https://fooby.ch/2", sourceName: "FOOBY", importedAt: NOW.toISOString(), keptAt: null, promotedAt: null },
      { recipeId: "stale-web", week: "2026-W33", sourceUrl: "https://fooby.ch/3", sourceName: "FOOBY", importedAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(), keptAt: null, promotedAt: null },
    ];
    const h = rolloverHarness({ plan: planWithShelf("assigned-web"), staged });
    const outcome = await rolloverWeek("2026-W33", h.deps);

    equal(outcome.status, "rolled-over");
    deepStrictEqual(h.promoted.sort(), ["assigned-web", "kept-web"]);
    deepStrictEqual(h.expired, ["stale-web"]);
  });

  it("records an exposure for every catalog idea shown and not chosen", async () => {
    const h = rolloverHarness({ plan: planWithShelf("catalog-assigned"), staged: [] });
    await rolloverWeek("2026-W33", h.deps);

    const exposed = h.written.filter((r) => r.exposureCount > 0).map((r) => r.recipeId);
    deepStrictEqual(exposed, ["ignored-catalog"]);
    ok(!exposed.includes("ignored-web"), "web ideas are handled by staging expiry, not exposure");
    ok(!exposed.includes("catalog-assigned"), "a chosen recipe was not ignored");
  });

  it("escalates a second ignored appearance to suppression", async () => {
    const prior = new Map<string, ExposureRecord>([
      ["ignored-catalog", recordUnselectedExposure(null, "ignored-catalog", new Date(NOW.getTime() - 200 * 86_400_000))],
    ]);
    const h = rolloverHarness({ plan: planWithShelf("catalog-assigned"), staged: [], exposure: prior });
    await rolloverWeek("2026-W33", h.deps);

    const record = h.written.find((r) => r.recipeId === "ignored-catalog");
    equal(record?.exposureCount, 2);
    equal(record?.suppressed, true);
  });

  it("looks at the whole retention window, not just the week being rolled over", async () => {
    const h = rolloverHarness({ plan: planWithShelf("x"), staged: [] });
    await rolloverWeek("2026-W33", h.deps);
    const weeks = h.stagedWeeksRequested[0];
    ok(weeks.includes("2026-W33"));
    ok(weeks.length > 10, "expiry spans the retention window, so the read must too");
  });

  it("never expires staging that is assigned in an earlier week", async () => {
    const old: StagedWebRecipe = {
      recipeId: "assigned-long-ago",
      week: "2026-W20",
      sourceUrl: "https://fooby.ch/9",
      sourceName: "FOOBY",
      importedAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
      keptAt: null,
      promotedAt: null,
    };
    const h = rolloverHarness({
      plan: planWithShelf("something-else"),
      staged: [old],
      assignedAcrossWindow: new Set(["assigned-long-ago"]),
    });
    await rolloverWeek("2026-W33", h.deps);
    deepStrictEqual(h.expired, [], "an assignment in another week still counts as retention");
    deepStrictEqual(h.promoted, ["assigned-long-ago"]);
  });

  it("re-running the same week never turns one ignored idea into two strikes", async () => {
    const h = rolloverHarness({ plan: planWithShelf("catalog-assigned"), staged: [] });

    const first = await rolloverWeek("2026-W33", h.deps);
    equal(first.exposuresRecorded, 1);
    equal(h.stored.get("ignored-catalog")?.exposureCount, 1);
    equal(h.stored.get("ignored-catalog")?.lastCountedWeek, "2026-W33");

    // A retry after a crash, a manual re-trigger, a lost claim row: same week,
    // same shelf, and the strike must not escalate.
    const second = await rolloverWeek("2026-W33", h.deps);
    equal(second.status, "rolled-over");
    equal(second.exposuresRecorded, 0, "nothing new is written");
    equal(second.exposuresAlreadyCounted, 1);
    equal(h.stored.get("ignored-catalog")?.exposureCount, 1, "still exactly one strike");
    equal(h.stored.get("ignored-catalog")?.suppressed, false, "and it is not suppressed");

    // A different week's shelf ignoring it again is a real second strike.
    const nextWeek = rolloverHarness({
      plan: { ...planWithShelf("catalog-assigned"), week: "2026-W34" },
      staged: [],
      exposure: h.stored,
    });
    await rolloverWeek("2026-W34", nextWeek.deps);
    equal(h.stored.get("ignored-catalog")?.exposureCount, 2);
    equal(h.stored.get("ignored-catalog")?.suppressed, true);
  });

  it("an out-of-order re-run cannot reapply a strike a later week already cleared", async () => {
    // W40 shows it and he passes; W41 he cooks it, which clears the strike —
    // and clears the record's own `lastCountedWeek` marker with it. Re-running
    // W40 after that (a backfill, a manual re-trigger, a replayed job) used to
    // find a record that no longer remembered W40 and write the strike again,
    // silently undoing a choice he had made. The counted-weeks ledger is what
    // remembers, because a selection has no business rewriting which weeks were
    // already processed.
    const exposure = new Map<string, ExposureRecord>();
    const ledger = new Map<string, Set<string>>();

    const w40 = rolloverHarness({
      plan: { ...planWithShelf("catalog-assigned"), week: "2026-W40" },
      staged: [],
      exposure,
      countedWeeks: ledger,
    });
    await rolloverWeek("2026-W40", w40.deps);
    equal(exposure.get("ignored-catalog")?.exposureCount, 1, "W40: shown and ignored");
    deepStrictEqual([...(ledger.get("2026-W40") ?? [])], ["ignored-catalog"]);

    // W41: he actually cooks it. The strike and the marker both go.
    const w41 = rolloverHarness({
      plan: { ...planWithShelf("ignored-catalog"), week: "2026-W41" },
      staged: [],
      exposure,
      countedWeeks: ledger,
    });
    await rolloverWeek("2026-W41", w41.deps);
    equal(exposure.get("ignored-catalog")?.exposureCount, 0, "W41: choosing it clears the strike");
    equal(exposure.get("ignored-catalog")?.lastCountedWeek, null, "and the marker with it");

    // The re-run that used to double back on that.
    const rerun = rolloverHarness({
      plan: { ...planWithShelf("catalog-assigned"), week: "2026-W40" },
      staged: [],
      exposure,
      countedWeeks: ledger,
    });
    const outcome = await rolloverWeek("2026-W40", rerun.deps);
    equal(outcome.status, "rolled-over");
    equal(outcome.exposuresRecorded, 0, "W40 is finished; it writes nothing");
    equal(outcome.exposuresAlreadyCounted, 1);
    equal(exposure.get("ignored-catalog")?.exposureCount, 0, "still cleared");
    equal(exposure.get("ignored-catalog")?.suppressed, false);

    // A genuinely new week ignoring it is still a real strike — the ledger
    // makes re-runs safe, it does not make the recipe immune.
    const w42 = rolloverHarness({
      plan: { ...planWithShelf("catalog-assigned"), week: "2026-W42" },
      staged: [],
      exposure,
      countedWeeks: ledger,
    });
    const later = await rolloverWeek("2026-W42", w42.deps);
    equal(later.exposuresRecorded, 1);
    equal(exposure.get("ignored-catalog")?.exposureCount, 1, "counting starts again from the cleared state");
    equal(exposure.get("ignored-catalog")?.lastCountedWeek, "2026-W42");
    deepStrictEqual([...(ledger.get("2026-W42") ?? [])], ["ignored-catalog"]);
  });

  it("lifts suppression when a suppressed recipe is searched out and assigned", async () => {
    // "off-shelf": the automatic shelf never offered it, because it was
    // suppressed. He searched for it and cooked it anyway, which is exactly the
    // explicit ask the policy says restores it.
    const suppressed = recordUnselectedExposure(
      recordUnselectedExposure(null, "beet-risotto", new Date(NOW.getTime() - 300 * 86_400_000), "2026-W10"),
      "beet-risotto",
      new Date(NOW.getTime() - 100 * 86_400_000),
      "2026-W24",
    );
    equal(suppressed.suppressed, true);

    const plan = planWithShelf("catalog-assigned");
    plan.days[1] = { ...plan.days[1], planningState: "assigned", recipeId: "beet-risotto", recipeName: "Beet Risotto" };
    ok(
      !plan.candidateSet!.items.some((i) => i.recipeId === "beet-risotto"),
      "the shelf really did not offer it",
    );

    const h = rolloverHarness({
      plan,
      staged: [],
      exposure: new Map([["beet-risotto", suppressed]]),
    });
    await rolloverWeek("2026-W33", h.deps);

    const after = h.stored.get("beet-risotto");
    equal(after?.suppressed, false, "cooking it is the explicit ask that clears it");
    equal(after?.exposureCount, 0);
    equal(after?.lastCountedWeek, null);
    ok(
      !h.written.some((r) => r.recipeId === "beet-risotto" && r.exposureCount > 0),
      "an assigned recipe is never counted as an exposure",
    );
  });

  it("reads overdue staging by age, not only by the recent-week window", async () => {
    const leaked: StagedWebRecipe = {
      recipeId: "leaked-web",
      week: "2025-W40",
      sourceUrl: "https://fooby.ch/en/recipes/8/leaked",
      sourceName: "FOOBY",
      importedAt: new Date(NOW.getTime() - 500 * 86_400_000).toISOString(),
      keptAt: null,
      promotedAt: null,
    };
    const h = rolloverHarness({ plan: planWithShelf("x"), staged: [], overdueStaged: [leaked] });
    await rolloverWeek("2026-W33", h.deps);

    deepStrictEqual(h.expired, ["leaked-web"], "a missed rollover older than the window still expires");
    equal(h.expirableBefore.length, 1);
    ok(h.expirableBefore[0].getTime() < NOW.getTime(), "the age cutoff is in the past");
  });

  it("never expires staging that is assigned to a future week", async () => {
    const forNextMonth: StagedWebRecipe = {
      recipeId: "planned-ahead",
      week: "2026-W20",
      sourceUrl: "https://fooby.ch/en/recipes/7/ahead",
      sourceName: "FOOBY",
      importedAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
      keptAt: null,
      promotedAt: null,
    };
    const h = rolloverHarness({
      plan: planWithShelf("something-else"),
      staged: [],
      overdueStaged: [forNextMonth],
      assignedSince: new Set(["planned-ahead"]),
    });
    await rolloverWeek("2026-W33", h.deps);

    deepStrictEqual(h.expired, [], "a future assignment is retention just like a past one");
    deepStrictEqual(h.promoted, ["planned-ahead"]);
    ok(
      h.assignedSinceRequested[0] < "2026-W33",
      "the forward-looking read starts at the oldest retained week",
    );
  });

  it("clears exposure memory for a recipe that was finally chosen", async () => {
    const prior = new Map<string, ExposureRecord>([
      ["chosen", recordUnselectedExposure(null, "chosen", new Date(NOW.getTime() - 10 * 86_400_000))],
    ]);
    const plan = planWithShelf("chosen");
    const h = rolloverHarness({ plan, staged: [], exposure: prior });
    await rolloverWeek("2026-W33", h.deps);

    const cleared = h.written.find((r) => r.recipeId === "chosen");
    equal(cleared?.exposureCount, 0);
    equal(cleared?.suppressed, false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("helpers", () => {
  it("targets next week on Thursday and last week for rollover", () => {
    equal(nextWeekId(new Date("2026-08-13T05:30:00.000Z")), "2026-W34");
    equal(previousWeekId(new Date("2026-08-13T05:30:00.000Z")), "2026-W32");
  });

  it("builds a week span that crosses a year boundary correctly", () => {
    deepStrictEqual(weekSpanEndingAt("2026-W02", 4), ["2026-W02", "2026-W01", "2025-W52", "2025-W51"]);
  });

  it("collects assigned ids from mains, sides and brunch", () => {
    const plan = emptyPlan();
    plan.days[0] = {
      ...plan.days[0],
      planningState: "meal",
      recipeId: "main-1",
      recipeName: "Main",
      meal: { main: { id: "main-1", name: "Main" }, sides: [{ id: "side-1", name: "Side" }] },
    };
    plan.days[1] = {
      ...plan.days[1],
      planningState: "assigned",
      recipeId: null,
      recipeName: null,
      brunch: { main: { id: "brunch-1", name: "Brunch" } },
    };
    deepStrictEqual([...assignedRecipeIdsForPlan(plan)].sort(), ["brunch-1", "main-1", "side-1"]);
  });

  it("ignores open and skipped days", () => {
    const plan = emptyPlan();
    plan.days[0] = { ...plan.days[0], planningState: "skipped", recipeId: "not-really", recipeName: "x" };
    deepStrictEqual([...assignedRecipeIdsForPlan(plan)], []);
  });

  it("classifies a recipe into a shelf candidate", () => {
    const recipe: Recipe = {
      id: "lentil-stew",
      name: "Winter Lentil Stew",
      servings: "4",
      ingredients: [{ item: "lentils", amount: "300 g" }, { item: "carrot", amount: "2" }, { item: "leek", amount: "1" }],
      method: ["Sweat.", "Simmer."],
      category: { dish_type: ["main"], chapter: "" },
      time: { total: 45 },
      dietary: ["vegan"],
      image: "/recipes/lentil.jpg",
    };
    const shelfCandidate = toShelfCandidate(recipe, { origin: "catalog", discovery: "catalog" }, NOW);
    equal(shelfCandidate.role, "main");
    equal(shelfCandidate.traits.shape, "stew-curry");
    equal(shelfCandidate.traits.protein, "vegan");
    equal(shelfCandidate.traits.starch, "legume");
  });

  it("hydrates a legacy candidate set by re-resolving its recipes", async () => {
    const legacy = [
      { recipeId: "legacy-1", recipeName: "Legacy One", bucket: "vegetarian", cuisine: "Italian" },
      { recipeId: "gone", recipeName: "Deleted Recipe" },
    ];
    const resolve = async (id: string): Promise<Recipe | undefined> =>
      id === "legacy-1"
        ? {
            id, name: "Legacy One", servings: "4",
            ingredients: [{ item: "pasta", amount: "300 g" }, { item: "tomato", amount: "4" }, { item: "basil", amount: "" }],
            method: ["One.", "Two."],
            category: { dish_type: ["main"], chapter: "" },
          }
        : undefined;

    const items = await hydrateShelfItems(legacy, new Set(["legacy-1"]), resolve, NOW);
    equal(items.length, 2, "an unresolvable card is kept, not silently dropped");
    equal(items[0].traits.starch, "pasta", "traits are re-derived rather than invented");
    equal(items[0].assigned, true);
    equal(items[1].recipeId, "gone");
  });
});
