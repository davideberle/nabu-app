// Hidden web staging: reversible Keep persisted across reloads, rollover
// promotion with true source provenance, expiry that keeps its fingerprint,
// and staging staying out of My Recipes and recipe search.
//
// Runs against a real libsql file database in a temp directory — the same
// production code path db.ts uses — with only the recipe corpus supplied by
// hand (the default resolver needs the `@/`-aliased bundle plain node cannot
// load).
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NABU_DB_DIR = mkdtempSync(join(tmpdir(), "planner-staging-test-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it, before } from "node:test";
import {
  applyKeep,
  canonicalUrlKey,
  fingerprintFor,
  isFingerprintDuplicate,
  isRetained,
  isStagedRecipe,
  normalizedTitleKey,
  planRollover,
  promotedRecipe,
  STAGING_RETENTION_WEEKS,
  type StagedWebRecipe,
} from "./planner-staging.ts";
import {
  expireStagedWebRecipe,
  getAllMyRecipes,
  getDb,
  getStagedWebRecipes,
  getStagingFingerprints,
  getMyRecipe,
  promoteStagedWebRecipe,
  recordWebInspiration,
  setWebInspirationKeep,
} from "./db.ts";
import { isMainPlannerCandidate } from "./meals-core.ts";
import type { Recipe } from "./recipes.ts";

const WEEK = "2026-W33";
const NOW = new Date("2026-08-13T06:00:00.000Z");
const weeksAgo = (n: number) => new Date(NOW.getTime() - n * 7 * 86_400_000);

function stagedRecipe(id: string, name: string): Recipe {
  return {
    id,
    name,
    servings: "4",
    source: { cookbook: "My Recipes", author: "FOOBY", publication: "FOOBY · Web inspiration" },
    ingredients: [{ item: "a", amount: "1" }, { item: "b", amount: "1" }, { item: "c", amount: "1" }],
    method: ["One.", "Two."],
    category: { dish_type: ["main"], chapter: "" },
    visibility: "planner-candidate",
    image: "/recipes/x.jpg",
  };
}

function record(overrides: Partial<StagedWebRecipe> = {}): StagedWebRecipe {
  return {
    recipeId: "staged-1",
    week: WEEK,
    sourceUrl: "https://fooby.ch/en/recipes/1/aubergine-bake",
    sourceName: "FOOBY",
    importedAt: NOW.toISOString(),
    keptAt: null,
    promotedAt: null,
    recipeName: "Aubergine Bake",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure policy
// ---------------------------------------------------------------------------

describe("Keep is reversible retention intent", () => {
  it("sets and clears keptAt without touching anything else", () => {
    const base = record();
    const kept = applyKeep(base, true, NOW);
    equal(kept.keptAt, NOW.toISOString());
    equal(kept.promotedAt, null, "Keep is not promotion");

    const unkept = applyKeep(kept, false, NOW);
    equal(unkept.keptAt, null);
  });

  it("treats assignment as retention, with or without a Keep press", () => {
    equal(isRetained(record(), new Set()), false);
    equal(isRetained(record({ keptAt: NOW.toISOString() }), new Set()), true);
    equal(isRetained(record(), new Set(["staged-1"])), true);
  });
});

describe("rollover decisions", () => {
  it("promotes kept and assigned records, expires stale unkept ones", () => {
    const plan = planRollover({
      records: [
        record({ recipeId: "kept", keptAt: NOW.toISOString() }),
        record({ recipeId: "assigned" }),
        record({ recipeId: "old", importedAt: weeksAgo(STAGING_RETENTION_WEEKS + 1).toISOString() }),
        record({ recipeId: "fresh", importedAt: weeksAgo(1).toISOString() }),
      ],
      assignedRecipeIds: new Set(["assigned"]),
      now: NOW,
    });

    deepStrictEqual(plan.promote.map((d) => d.record.recipeId).sort(), ["assigned", "kept"]);
    deepStrictEqual(plan.expire.map((d) => d.record.recipeId), ["old"]);
    deepStrictEqual(plan.retain.map((d) => d.record.recipeId), ["fresh"]);
    equal(plan.promote.find((d) => d.record.recipeId === "assigned")?.reason, "assigned to a day");
  });

  it("keeps an unkept record inside the retention window", () => {
    const plan = planRollover({
      records: [record({ importedAt: weeksAgo(STAGING_RETENTION_WEEKS - 1).toISOString() })],
      assignedRecipeIds: new Set(),
      now: NOW,
    });
    equal(plan.expire.length, 0);
    equal(plan.retain.length, 1);
  });

  it("is idempotent — an already-promoted record is not promoted twice", () => {
    const plan = planRollover({
      records: [record({ keptAt: NOW.toISOString(), promotedAt: NOW.toISOString() })],
      assignedRecipeIds: new Set(),
      now: NOW,
    });
    equal(plan.promote.length, 0);
    equal(plan.retain[0].reason, "already promoted");
  });
});

describe("duplicate fingerprints survive expiry", () => {
  it("normalizes urls and titles", () => {
    equal(
      canonicalUrlKey("https://WWW.Fooby.ch/en/recipes/1/x/?utm=1#top"),
      "https://fooby.ch/en/recipes/1/x",
    );
    equal(normalizedTitleKey("Aubergine  Bake — Grandma's!"), "aubergine bake grandma s");
  });

  it("re-detects the same page after the staging record is gone", () => {
    const fingerprint = fingerprintFor(record(), NOW);
    equal(
      isFingerprintDuplicate(
        { url: "https://www.fooby.ch/en/recipes/1/aubergine-bake?ref=weekly", title: "Something Else" },
        [fingerprint],
      ),
      true,
    );
    equal(
      isFingerprintDuplicate({ url: "https://fooby.ch/en/recipes/99/other", title: "Aubergine Bake" }, [fingerprint]),
      true,
      "a re-slugged page with the same title is still a duplicate",
    );
    equal(
      isFingerprintDuplicate({ url: "https://fooby.ch/en/recipes/99/other", title: "Lentil Soup" }, [fingerprint]),
      false,
    );
  });
});

describe("promotion preserves the real source", () => {
  it("drops the staging visibility and keeps FOOBY as the publication", () => {
    const promoted = promotedRecipe(stagedRecipe("aubergine-bake", "Aubergine Bake"), record());
    equal(promoted.visibility, "personal", "curated, not hidden");
    equal(promoted.source?.cookbook, "FOOBY", "not 'My Recipes'");
    equal(promoted.source?.publication, "FOOBY");
    equal(isStagedRecipe(promoted), false);
  });

  it("keeps a promoted light meal usable as a dinner", () => {
    // A substantial wrap qualifies as a dinner while it is staged. Promotion
    // must not be what disqualifies it — the recipe did not change, only where
    // it lives, and being kept/assigned is a stronger signal than being staged.
    const wrap: Recipe = {
      ...stagedRecipe("halloumi-wrap", "Grilled Halloumi and Chickpea Wrap"),
      ingredients: [
        { item: "halloumi", amount: "250 g" },
        { item: "chickpeas", amount: "1 tin" },
        { item: "flatbread", amount: "4" },
        { item: "tomato", amount: "2" },
        { item: "cucumber", amount: "1" },
        { item: "yoghurt", amount: "150 g" },
      ],
    };
    equal(isMainPlannerCandidate(wrap), true, "dinner-capable while staged");
    const promoted = promotedRecipe(wrap, record({ recipeId: "halloumi-wrap" }));
    equal(isStagedRecipe(promoted), false, "and no longer hidden");
    equal(isMainPlannerCandidate(promoted), true, "still dinner-capable after promotion");
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("staging persistence", () => {
  before(async () => {
    const client = await getDb();
    for (const [id, name] of [
      ["kept-web", "Kept Aubergine Bake"],
      ["assigned-web", "Assigned Lentil Stew"],
      ["expiring-web", "Forgotten Fennel Gratin"],
      ["toggle-web", "Toggle Tomato Tart"],
    ] as const) {
      await client.execute({
        sql: "INSERT OR REPLACE INTO recipes (id, data, created_at) VALUES (?, ?, ?)",
        args: [id, JSON.stringify(stagedRecipe(id, name)), NOW.toISOString()],
      });
    }
    await recordWebInspiration("kept-web", WEEK, "https://fooby.ch/en/recipes/1/kept", "FOOBY", "editorial");
    await recordWebInspiration("assigned-web", WEEK, "https://cookieandkate.com/assigned/", "Cookie and Kate", "editorial");
    await recordWebInspiration("expiring-web", WEEK, "https://fooby.ch/en/recipes/3/expiring", "FOOBY", "search");
    await recordWebInspiration("toggle-web", WEEK, "https://fooby.ch/en/recipes/4/toggle", "FOOBY", "editorial");
  });

  it("hides staged recipes from My Recipes and from recipe search", async () => {
    // `getAllMyRecipes()` is the projection both My Recipes and recipe search
    // read (`recipes.ts::getAllRecipes` composes it with the static bundle, and
    // `searchRecipes` only ever ranks what it is handed). Excluding staging
    // here is therefore the whole guarantee. recipes.ts itself cannot be loaded
    // by plain node — it imports the `@/`-aliased bundle.
    const visible = await getAllMyRecipes();
    ok(!visible.some((r) => r.id === "kept-web"), "staging never appears in My Recipes");
    ok(!visible.some((r) => r.visibility === "planner-candidate"), "nothing staged is browsable");
    // Still resolvable by id, so planner cards and quick view work.
    ok(await getMyRecipe("kept-web"));
  });

  it("persists Keep across reloads, and un-keeps again", async () => {
    const kept = await setWebInspirationKeep("toggle-web", true, NOW);
    equal(kept?.keptAt, NOW.toISOString());

    const reloaded = (await getStagedWebRecipes([WEEK])).find((r) => r.recipeId === "toggle-web");
    equal(Boolean(reloaded?.keptAt), true, "Keep survives a fresh read");

    await setWebInspirationKeep("toggle-web", false, NOW);
    const afterUnkeep = (await getStagedWebRecipes([WEEK])).find((r) => r.recipeId === "toggle-web");
    equal(afterUnkeep?.keptAt, null);
  });

  it("records how each idea was discovered", async () => {
    const staged = await getStagedWebRecipes([WEEK]);
    equal(staged.find((r) => r.recipeId === "kept-web")?.discovery, "editorial");
    equal(staged.find((r) => r.recipeId === "expiring-web")?.discovery, "search");
  });

  it("refuses Keep for a recipe that is not staged web inspiration", async () => {
    equal(await setWebInspirationKeep("not-a-thing", true, NOW), null);
  });

  it("promotes a kept record into My Recipes under its real source", async () => {
    await setWebInspirationKeep("kept-web", true, NOW);
    const staged = (await getStagedWebRecipes([WEEK])).find((r) => r.recipeId === "kept-web")!;
    equal(await promoteStagedWebRecipe(staged, NOW), true);

    const promoted = await getMyRecipe("kept-web");
    equal(promoted?.visibility, "personal", "curated, and no longer hidden staging");
    equal(promoted?.source?.cookbook, "FOOBY");

    const visible = await getAllMyRecipes();
    ok(visible.some((r) => r.id === "kept-web"), "it is a normal My Recipe now, so it is browsable and searchable");

    const after = (await getStagedWebRecipes([WEEK])).find((r) => r.recipeId === "kept-web");
    ok(after?.promotedAt, "promotion is recorded so a re-run skips it");
  });

  it("promotes an assigned record even without a Keep press", async () => {
    const staged = (await getStagedWebRecipes([WEEK])).find((r) => r.recipeId === "assigned-web")!;
    equal(staged.keptAt, null);
    const plan = planRollover({ records: [staged], assignedRecipeIds: new Set(["assigned-web"]), now: NOW });
    equal(plan.promote.length, 1);
    await promoteStagedWebRecipe(plan.promote[0].record, NOW);
    equal((await getMyRecipe("assigned-web"))?.visibility, "personal");
    ok(
      (await getAllMyRecipes()).some((r) => r.id === "assigned-web"),
      "promotion by assignment is browsable too",
    );
  });

  it("expires an unkept record but keeps its fingerprint", async () => {
    const staged = (await getStagedWebRecipes([WEEK])).find((r) => r.recipeId === "expiring-web")!;
    await expireStagedWebRecipe(staged, NOW);

    equal(await getMyRecipe("expiring-web"), undefined, "the hidden recipe row is gone");
    ok(
      !(await getStagedWebRecipes([WEEK])).some((r) => r.recipeId === "expiring-web"),
      "and so is the provenance row",
    );

    const fingerprints = await getStagingFingerprints();
    equal(
      isFingerprintDuplicate({ url: "https://fooby.ch/en/recipes/3/expiring", title: "" }, fingerprints),
      true,
      "the same page is not rediscovered next week",
    );
  });

  it("never deletes a recipe that was already promoted", async () => {
    const promoted = await getMyRecipe("kept-web");
    ok(promoted);
    await expireStagedWebRecipe(
      record({ recipeId: "kept-web", sourceUrl: "https://fooby.ch/en/recipes/1/kept" }),
      NOW,
    );
    ok(await getMyRecipe("kept-web"), "a promoted recipe is David's and survives expiry");
  });
});
