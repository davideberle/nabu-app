// The local-runtime handoff: the Kitchen importer stages a week on David's
// Mac, and the deployed app assembles the shelf from what it finds.
//
// The bug these tests exist for: production ran `execFile` on the importer
// inside a Vercel function, got nothing, and reported a healthy twelve-item
// shelf with `webSelected: 0`. Two halves have to hold — the local write must
// really land in `web_recipe_inspirations`, and the deployed runtime must never
// spawn and must say so when nothing was staged.
//
// The staging half runs against a real libsql file database through the exact
// function the importer calls. Run with: npm test

import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Point db.ts at an isolated database before any getDb() call happens.
const TEST_DB_DIR = mkdtempSync(join(tmpdir(), "weekly-web-staging-test-"));
process.env.NABU_DB_DIR = TEST_DB_DIR;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
// The importer resolves the same database from these two variables.
delete process.env.KITCHEN_INSPIRATION_IMPORTER_COMMAND;
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;

import { equal, ok, deepStrictEqual, rejects, match, throws } from "node:assert/strict";
import { describe, it, before, after } from "node:test";

import {
  buildWebInspirationUpsert,
  isRichWebInspirationSchema,
  normalizeDiscovery,
} from "./web-inspiration-provenance.ts";
import {
  IMPORTER_UNSUPPORTED_MESSAGE,
  importerRuntimeSupported,
  recordEligibleImports,
  resolveWebInspirations,
  runInspirationImporter,
  type ImporterReport,
  type InspirationProvenanceSets,
} from "./meal-inspirations.ts";
import { getDb, getWebInspirationsForWeek, getStagedWebRecipes, getMyRecipe } from "./db.ts";
import { prepareWeek, toShelfCandidate, type PreparationDeps } from "./planner-preparation.ts";
import { SHELF_POLICY_VERSION, type ShelfCandidate, type ShelfTraits } from "./planner-shelf.ts";
import type { MealPlan } from "./meals.ts";
import type { Recipe } from "./recipes.ts";

// The importer is a sibling script, not a lib module; this is the production
// write path, called exactly as the importer calls it.
import {
  recordWebInspirationProvenance,
  closeAppDbClient,
} from "../../scripts/weekly-inspirations.mjs";

const WEEK = "2026-W34";
const NOW = new Date("2026-08-13T05:30:00.000Z");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function webRecipe(id: string, name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    servings: "serves 4",
    image: `/recipes/${id}.jpg`,
    visibility: "planner-candidate",
    ingredients: [
      { item: "chicken thighs", amount: "600 g" },
      { item: "onion", amount: "1" },
      { item: "rice", amount: "300 g" },
      { item: "olive oil", amount: "2 tbsp" },
    ],
    method: ["Brown the chicken.", "Simmer with the rice.", "Rest and serve."],
    time: { prep: 15, cook: 30, total: 45 },
    category: { dish_type: ["main"], chapter: "" },
    ...extra,
  };
}

function pairingRecipe(id: string, name: string): Recipe {
  return {
    id,
    name,
    servings: "serves 4",
    image: `/recipes/${id}.jpg`,
    visibility: "planner-candidate",
    ingredients: [
      { item: "broccolini", amount: "400 g" },
      { item: "olive oil", amount: "2 tbsp" },
      { item: "lemon", amount: "1" },
      { item: "chilli flakes", amount: "1 tsp" },
    ],
    method: ["Blanch the broccolini.", "Char in a hot pan.", "Dress with lemon."],
    time: { prep: 10, cook: 0, total: 10 },
    category: { dish_type: ["side"], chapter: "" },
  };
}

async function seedRecipe(recipe: Recipe): Promise<void> {
  const client = await getDb();
  await client.execute({
    sql: `INSERT INTO recipes (id, data, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    args: [recipe.id, JSON.stringify(recipe), NOW.toISOString()],
  });
}

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

/** A catalog pool wide enough that gap-fill can reach the shelf target. */
function catalogPool(size = 24): ShelfCandidate[] {
  const shapes = ["soup", "salad", "stew-curry", "bowl", "roast-bake", "grill", "stir-fry", "other"] as const;
  const proteins = ["vegan", "vegetarian", "fish", "vegetarian", "meat", "vegan", "vegetarian", "vegan"] as const;
  const efforts = ["quick", "medium", "project", "quick", "medium", "quick", "quick", "medium"] as const;
  const cuisines = ["Italian", "Indian", "Greek", "Swiss", "Thai", "Mexican", "French", "Japanese"];
  return Array.from({ length: size }, (_, i) => ({
    recipeId: `catalog-${i}`,
    recipeName: `Catalog ${i}`,
    origin: "catalog" as const,
    discovery: "catalog" as const,
    role: "main" as const,
    bucket: "vegetarian" as const,
    cuisine: cuisines[i % cuisines.length],
    image: "/recipes/catalog.jpg",
    traits: traits({
      shape: shapes[i % shapes.length],
      protein: proteins[i % proteins.length],
      effort: efforts[i % efforts.length],
      seasonalLocal: i % 3 === 0,
    }),
  }));
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

// ---------------------------------------------------------------------------
// The shared provenance statement
// ---------------------------------------------------------------------------

describe("web inspiration provenance statement", () => {
  const input = {
    recipeId: "miso-aubergine",
    week: WEEK,
    sourceUrl: "https://fooby.ch/en/recipes/miso-aubergine",
    sourceName: "FOOBY",
    discovery: "editorial" as const,
    recipeName: "Miso aubergine",
    image: "/recipes/miso-aubergine.jpg",
  };

  it("writes the compact schema keyed by recipe_id", () => {
    const columns = new Set(["recipe_id", "week", "source_url", "source_name", "imported_at", "discovery"]);
    equal(isRichWebInspirationSchema(columns), false);
    const statement = buildWebInspirationUpsert(columns, input, { id: "uuid-1", now: "2026-08-13T05:30:00.000Z" });
    match(statement.sql, /ON CONFLICT \(recipe_id\) DO UPDATE/);
    ok(statement.args.includes("miso-aubergine"));
    ok(statement.args.includes("editorial"));
  });

  it("writes the rich production schema keyed by source_url", () => {
    const columns = new Set(["id", "week", "recipe_id", "recipe_name", "source_name", "source_url", "image", "status", "provenance_json", "created_at", "updated_at", "imported_at", "discovery"]);
    equal(isRichWebInspirationSchema(columns), true);
    const statement = buildWebInspirationUpsert(columns, input, { id: "uuid-1", now: "2026-08-13T05:30:00.000Z" });
    match(statement.sql, /ON CONFLICT \(source_url\) DO UPDATE/);
    ok(statement.args.includes("Miso aubergine"));
  });

  it("never writes the retention columns, on either schema", () => {
    for (const columns of [
      new Set(["recipe_id", "week", "source_url", "source_name", "imported_at", "discovery", "kept_at", "promoted_at"]),
      new Set(["id", "week", "recipe_id", "recipe_name", "source_name", "source_url", "image", "status", "provenance_json", "created_at", "updated_at", "imported_at", "discovery", "kept_at", "promoted_at"]),
    ]) {
      const statement = buildWebInspirationUpsert(columns, input, { id: "uuid-1", now: "x" });
      equal(/kept_at/.test(statement.sql), false, "a re-import must not touch Keep");
      equal(/promoted_at/.test(statement.sql), false, "a re-import must not promote");
    }
  });

  it("treats anything that is not 'editorial' as a search discovery", () => {
    equal(normalizeDiscovery("editorial"), "editorial");
    equal(normalizeDiscovery("search"), "search");
    equal(normalizeDiscovery(undefined), "search");
    equal(normalizeDiscovery("curated-by-vibes"), "search");
  });
});

// ---------------------------------------------------------------------------
// Local staging against a real database
// ---------------------------------------------------------------------------

describe("local importer staging (real database)", () => {
  const MAIN = webRecipe("harissa-chicken-traybake", "Harissa chicken traybake");
  const SECOND = webRecipe("lentil-ragu", "Lentil ragù", {
    ingredients: [
      { item: "puy lentils", amount: "300 g" },
      { item: "tomato passata", amount: "500 g" },
      { item: "carrot", amount: "2" },
      { item: "pappardelle", amount: "400 g" },
    ],
  });
  const PAIRING = pairingRecipe("charred-broccolini", "Charred broccolini with lemon");

  before(async () => {
    // Opening the app database runs the real migrations, so the table the
    // importer writes to is the table the app reads from.
    await getDb();
    await seedRecipe(MAIN);
    await seedRecipe(SECOND);
    await seedRecipe(PAIRING);
  });

  after(async () => {
    await closeAppDbClient();
  });

  it("records week provenance the app can read back", async () => {
    await recordWebInspirationProvenance({
      recipeId: MAIN.id,
      week: WEEK,
      sourceUrl: "https://fooby.ch/en/recipes/harissa-chicken-traybake",
      sourceName: "FOOBY",
      discovery: "editorial",
      recipeName: MAIN.name,
      image: MAIN.image,
    });

    const rows = await getWebInspirationsForWeek(WEEK);
    equal(rows.length, 1);
    equal(rows[0].recipe_id, MAIN.id);
    equal(rows[0].source_url, "https://fooby.ch/en/recipes/harissa-chicken-traybake");
    equal(rows[0].source_name, "FOOBY");
    ok(rows[0].imported_at, "provenance carries an import timestamp");

    const staged = await getStagedWebRecipes([WEEK]);
    equal(staged.length, 1);
    equal(staged[0].discovery, "editorial", "discovery mode survives the write");
    equal(staged[0].keptAt, null);
    equal(staged[0].promotedAt, null, "import never promotes into My Recipes");
  });

  it("leaves the recipe hidden from My Recipes at import time", async () => {
    const stored = await getMyRecipe(MAIN.id);
    ok(stored);
    equal(stored?.visibility, "planner-candidate");
  });

  it("is idempotent on retry and does not undo a Keep", async () => {
    const client = await getDb();
    await client.execute({
      sql: "UPDATE web_recipe_inspirations SET kept_at = ? WHERE recipe_id = ?",
      args: ["2026-08-14T10:00:00.000Z", MAIN.id],
    });

    // The same week staged again — the ordinary retry after a flaky scrape.
    await recordWebInspirationProvenance({
      recipeId: MAIN.id,
      week: WEEK,
      sourceUrl: "https://fooby.ch/en/recipes/harissa-chicken-traybake",
      sourceName: "FOOBY",
      discovery: "editorial",
      recipeName: MAIN.name,
      image: MAIN.image,
    });

    const rows = await getWebInspirationsForWeek(WEEK);
    equal(rows.length, 1, "a retry upserts, it does not append");
    const staged = await getStagedWebRecipes([WEEK]);
    equal(staged[0].keptAt, "2026-08-14T10:00:00.000Z", "Keep survives a re-import");
  });

  it("stages pairings alongside mains, and keeps them distinguishable", async () => {
    await recordWebInspirationProvenance({
      recipeId: SECOND.id,
      week: WEEK,
      sourceUrl: "https://www.bbcgoodfood.com/recipes/lentil-ragu",
      sourceName: "BBC Good Food",
      discovery: "search",
      recipeName: SECOND.name,
      image: SECOND.image,
    });
    await recordWebInspirationProvenance({
      recipeId: PAIRING.id,
      week: WEEK,
      sourceUrl: "https://fooby.ch/en/recipes/charred-broccolini",
      sourceName: "FOOBY",
      discovery: "editorial",
      recipeName: PAIRING.name,
      image: PAIRING.image,
    });

    const rows = await getWebInspirationsForWeek(WEEK);
    equal(rows.length, 3);

    // Provenance itself does not encode the role — the classifier does, on the
    // recipe as stored — so the split is verified where the planner makes it.
    const { classifyPlannerRole } = await import("./planner-roles.ts");
    const roles = new Map<string, string>();
    for (const row of rows) {
      const recipe = await getMyRecipe(row.recipe_id);
      roles.set(row.recipe_id, recipe ? classifyPlannerRole(recipe).role : "missing");
    }
    ok(["main", "light-meal"].includes(roles.get(MAIN.id)!), `main was ${roles.get(MAIN.id)}`);
    ok(["main", "light-meal"].includes(roles.get(SECOND.id)!), `second was ${roles.get(SECOND.id)}`);
    equal(roles.get(PAIRING.id), "pairing", "a side dish is never a dinner main");
  });

  it("preserves the real source, never flattening it to 'Web inspiration'", async () => {
    const rows = await getWebInspirationsForWeek(WEEK);
    const bySource = new Map(rows.map((row) => [row.recipe_id, row.source_name]));
    equal(bySource.get(MAIN.id), "FOOBY");
    equal(bySource.get(SECOND.id), "BBC Good Food");
  });
});

// ---------------------------------------------------------------------------
// Vercel: no child process, and no pretending
// ---------------------------------------------------------------------------

describe("importer runtime support", () => {
  it("is unsupported on Vercel", () => {
    equal(importerRuntimeSupported({ VERCEL: "1" }), false);
    equal(importerRuntimeSupported({ VERCEL_ENV: "production" }), false);
  });

  it("is supported locally", () => {
    equal(importerRuntimeSupported({}), true);
  });

  it("honours an explicit importer command as a deliberate override", () => {
    equal(importerRuntimeSupported({ VERCEL: "1", KITCHEN_INSPIRATION_IMPORTER_COMMAND: "node fake.mjs" }), true);
  });

  it("refuses to spawn on Vercel rather than failing as an empty import", async () => {
    let spawned = 0;
    const exec = async () => {
      spawned += 1;
      return { stdout: "{}", stderr: "" };
    };
    await rejects(
      () => runInspirationImporter(WEEK, 8, { exec, env: { VERCEL: "1" } }),
      /cannot run in this runtime/,
    );
    equal(spawned, 0, "no child process may be started on Vercel");
  });

  it("still spawns where the importer is genuinely supported", async () => {
    let spawned = 0;
    const exec = async () => {
      spawned += 1;
      return { stdout: JSON.stringify({ imported: [], pairings: [] }), stderr: "" };
    };
    const run = await runInspirationImporter(WEEK, 8, { exec, env: {} });
    equal(spawned, 1);
    deepStrictEqual(run.report, { imported: [], pairings: [] });
  });
});

describe("resolveWebInspirations", () => {
  it("reports web-not-staged on Vercel when nothing is staged", async () => {
    const result = await resolveWebInspirations("2099-W01", 8, {
      loadStoredCount: async () => 0,
      env: { VERCEL: "1" },
    });
    equal(result.status, "web-not-staged");
    ok("reason" in result && result.reason.includes("prepare-weekly-shelf"));
  });

  it("uses what the local runtime already staged, without running anything", async () => {
    let ran = 0;
    const result = await resolveWebInspirations("2099-W01", 8, {
      loadStoredCount: async () => 5,
      env: { VERCEL: "1" },
      exec: async () => {
        ran += 1;
        return { stdout: "{}", stderr: "" };
      },
    });
    deepStrictEqual(result, { status: "already-staged", staged: 5 });
    equal(ran, 0);
  });

  it("runs the importer where that is supported and nothing is staged", async () => {
    const result = await resolveWebInspirations("2099-W01", 2, {
      loadStoredCount: async () => 0,
      env: {},
      claim: async () => true,
      complete: async () => {},
      exec: async () => ({
        stdout: JSON.stringify({ imported: [], pairings: [] }),
        stderr: "",
      }),
      resolveMyRecipe: async () => undefined,
      recordProvenance: async () => {},
    });
    equal(result.status, "succeeded");
  });
});

describe("prepareWeek with unstaged web ideas", () => {
  function deps(overrides: Partial<PreparationDeps> = {}): PreparationDeps & { saved: MealPlan[] } {
    const saved: MealPlan[] = [];
    return {
      saved,
      now: NOW,
      loadPlan: async () => emptyPlan(),
      savePlan: async (plan) => {
        saved.push(plan);
        return { ok: true, plan };
      },
      ensureWebInspirations: async () => ({
        status: "web-not-staged",
        reason: "nothing staged and this runtime cannot run the importer",
      }),
      loadWebCandidates: async () => [],
      loadCatalogCandidates: async () => catalogPool(),
      ...overrides,
    } as PreparationDeps & { saved: MealPlan[] };
  }

  it("falls back to the catalog but says research did not happen", async () => {
    const d = deps();
    const outcome = await prepareWeek(WEEK, d);

    equal(outcome.status, "prepared");
    equal(outcome.webStatus, "web-not-staged");
    equal(outcome.webSelected, 0);
    ok((outcome.catalogSelected ?? 0) > 0, "the catalog still fills the shelf");
    ok(
      outcome.warnings?.some((w) => w.startsWith("web-not-staged:")),
      `expected a web-not-staged warning, got ${JSON.stringify(outcome.warnings)}`,
    );
  });

  it("reports a clean web status when the week was staged", async () => {
    const d = deps({
      ensureWebInspirations: async () => ({ status: "already-staged", staged: 6 }),
    });
    const outcome = await prepareWeek(WEEK, d);
    equal(outcome.webStatus, "already-staged");
    equal(
      outcome.warnings?.some((w) => w.startsWith("web-not-staged:")),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// End to end: local staging → prepare → webSelected > 0
// ---------------------------------------------------------------------------

describe("local staging feeds the prepared shelf", () => {
  const E2E_WEEK = "2026-W35";
  const STAGED = [
    webRecipe("gochujang-pork-noodles", "Gochujang pork noodles"),
    webRecipe("saffron-fish-stew", "Saffron fish stew", {
      ingredients: [
        { item: "cod fillet", amount: "600 g" },
        { item: "fennel", amount: "1" },
        { item: "potatoes", amount: "500 g" },
        { item: "saffron", amount: "1 pinch" },
      ],
    }),
    webRecipe("smoky-bean-cassoulet", "Smoky bean cassoulet", {
      ingredients: [
        { item: "white beans", amount: "500 g" },
        { item: "leek", amount: "2" },
        { item: "smoked paprika", amount: "1 tbsp" },
        { item: "sourdough", amount: "4 slices" },
      ],
    }),
  ];
  const STAGED_PAIRING = pairingRecipe("charred-greens", "Charred greens with lemon");

  before(async () => {
    await getDb();
    for (const recipe of [...STAGED, STAGED_PAIRING]) await seedRecipe(recipe);

    // Exactly what the local ritual does: stage the week, mains and pairing
    // alike, each with its real source and discovery mode.
    for (const [index, recipe] of STAGED.entries()) {
      await recordWebInspirationProvenance({
        recipeId: recipe.id,
        week: E2E_WEEK,
        sourceUrl: `https://fooby.ch/en/recipes/${recipe.id}`,
        sourceName: index === 0 ? "FOOBY" : "BBC Good Food",
        discovery: index === 0 ? "editorial" : "search",
        recipeName: recipe.name,
        image: recipe.image,
      });
    }
    await recordWebInspirationProvenance({
      recipeId: STAGED_PAIRING.id,
      week: E2E_WEEK,
      sourceUrl: `https://fooby.ch/en/recipes/${STAGED_PAIRING.id}`,
      sourceName: "FOOBY",
      discovery: "editorial",
      recipeName: STAGED_PAIRING.name,
      image: STAGED_PAIRING.image,
    });
  });

  after(async () => {
    await closeAppDbClient();
  });

  /** The real read path `planner-runtime.loadWebCandidatesForWeek` performs. */
  async function loadWebCandidates(week: string): Promise<ShelfCandidate[]> {
    const inspirations = await getWebInspirationsForWeek(week);
    const staged = await getStagedWebRecipes([week]);
    const discoveryById = new Map(staged.map((record) => [record.recipeId, record.discovery ?? null]));
    const candidates: ShelfCandidate[] = [];
    let rank = 0;
    for (const inspiration of inspirations) {
      const recipe = await getMyRecipe(inspiration.recipe_id);
      if (!recipe) continue;
      candidates.push(
        toShelfCandidate(
          recipe,
          {
            origin: "web",
            discovery: discoveryById.get(inspiration.recipe_id) === "editorial" ? "editorial" : "search",
            sourceName: inspiration.source_name,
            rank: rank++,
          },
          NOW,
        ),
      );
    }
    return candidates;
  }

  it("puts staged web ideas on the shelf and reports webSelected > 0", async () => {
    const saved: MealPlan[] = [];
    const outcome = await prepareWeek(E2E_WEEK, {
      now: NOW,
      loadPlan: async () => emptyPlan(E2E_WEEK),
      savePlan: async (plan) => {
        saved.push(plan);
        return { ok: true, plan };
      },
      // The deployed runtime's behaviour: find what was staged, run nothing.
      ensureWebInspirations: async (week) =>
        resolveWebInspirations(week, 8, {
          loadStoredCount: async (w) => (await getWebInspirationsForWeek(w)).length,
          env: { VERCEL: "1" },
        }),
      loadWebCandidates: (week) =>
        loadWebCandidates(week).then((c) => c.filter((x) => x.role === "main" || x.role === "light-meal")),
      loadCatalogCandidates: async () => catalogPool(),
    });

    equal(outcome.status, "prepared");
    equal(outcome.webStatus, "already-staged");
    ok((outcome.webSelected ?? 0) > 0, `expected web ideas on the shelf, got ${outcome.webSelected}`);
    equal(
      outcome.warnings?.some((w) => w.startsWith("web-not-staged:")),
      false,
      "a staged week must not be reported as unstaged",
    );

    const stored = saved.at(-1)!;
    equal(stored.candidateSet?.policyVersion, SHELF_POLICY_VERSION);
    const webItems = (stored.candidateSet?.items ?? []).filter((item) => item.origin === "web");
    ok(webItems.length > 0);
    ok(
      webItems.every((item) => item.source?.cookbook && item.source.cookbook !== "Web inspiration"),
      "each web card keeps its real publication",
    );
    ok(
      (stored.candidateSet?.items ?? []).every((item) => item.recipeId !== STAGED_PAIRING.id),
      "a pairing never occupies a main slot",
    );
  });
});

// ---------------------------------------------------------------------------
// Pairing vs main at the app's recording boundary
// ---------------------------------------------------------------------------

describe("recordEligibleImports keeps pairings out of the main set", () => {
  function provenance(): InspirationProvenanceSets {
    return {
      currentRecipeIds: new Set(),
      currentSourceUrls: new Set(),
      recentRecipeIds: new Set(),
      recentSourceUrls: new Set(),
    };
  }

  const report: ImporterReport = {
    imported: [{ id: "main-one", url: "https://fooby.ch/a", source: "FOOBY", discovery: "editorial" }],
    pairings: [{ id: "pairing-one", url: "https://fooby.ch/b", source: "FOOBY", discovery: "editorial" }],
  };

  const recipes: Record<string, Recipe> = {
    "main-one": webRecipe("main-one", "Braised short ribs"),
    "pairing-one": pairingRecipe("pairing-one", "Shaved fennel salad"),
  };

  it("splits the two and records provenance for both", async () => {
    const recorded: string[] = [];
    const result = await recordEligibleImports("2026-W40", report, new Set(), provenance(), {
      resolveMyRecipe: async (id) => recipes[id],
      recordProvenance: async (id) => {
        recorded.push(id);
      },
    });

    deepStrictEqual(result.accepted.map((a) => a.recipe.id), ["main-one"]);
    deepStrictEqual(result.pairings.map((a) => a.recipe.id), ["pairing-one"]);
    deepStrictEqual(recorded.sort(), ["main-one", "pairing-one"]);
    equal(result.accepted[0].discovery, "editorial");
  });

  it("refuses a duplicate URL already used in a recent week", async () => {
    const sets = provenance();
    sets.recentSourceUrls.add("https://fooby.ch/a");
    const result = await recordEligibleImports("2026-W40", report, new Set(), sets, {
      resolveMyRecipe: async (id) => recipes[id],
      recordProvenance: async () => {},
    });
    deepStrictEqual(result.skippedDuplicates, ["main-one"]);
    equal(result.accepted.length, 0);
  });
});

describe("the unsupported-runtime message names the local handoff", () => {
  it("points at the ritual script rather than at an error code", () => {
    match(IMPORTER_UNSUPPORTED_MESSAGE, /prepare-weekly-shelf\.mjs/);
  });
});

// ---------------------------------------------------------------------------
// The ritual script's env flag
// ---------------------------------------------------------------------------

// `--env-file` is Node's own option. Node consumes it before argv reaches the
// script — even written after the script path — and exits 9 with a bare
// `node: <path>: not found`. So the helper's own "run `vercel env pull` first"
// error could never fire on the one mistake it exists for. The flag is `--env`.
describe("prepare-weekly-shelf env flag", () => {
  const SCRIPT = fileURLToPath(new URL("../../scripts/prepare-weekly-shelf.mjs", import.meta.url));
  const MISSING_ENV = join(TEST_DB_DIR, "not-pulled.env");

  /** Run the ritual script, capturing both streams and the exit code. */
  function runScript(args: string[]): Promise<{ code: number; output: string }> {
    return new Promise((resolveRun) => {
      execFile(process.execPath, [SCRIPT, ...args], { timeout: 30_000 }, (error, stdout, stderr) => {
        const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolveRun({ code, output: `${stdout}${stderr}` });
      });
    });
  }

  it("reads the env file path from --env", async () => {
    const { parseArgs } = await import("../../scripts/prepare-weekly-shelf.mjs");
    equal(parseArgs(["--env", "config/.env.vercel"]).envFile, resolve("config/.env.vercel"));
  });

  it("rejects --env with no path instead of crashing on undefined", async () => {
    const { parseArgs } = await import("../../scripts/prepare-weekly-shelf.mjs");
    throws(() => parseArgs(["--env"]), /--env needs a value/);
  });

  it("names --env-file rather than offering it as an alias", async () => {
    const { parseArgs } = await import("../../scripts/prepare-weekly-shelf.mjs");
    throws(() => parseArgs(["--env-file", "x"]), /Use --env/);
  });

  it("gives the friendly error when the --env path does not exist", async () => {
    const { code, output } = await runScript(["--env", MISSING_ENV]);
    equal(code, 1, `expected the script's own failure, got:\n${output}`);
    match(output, /Could not read/);
    match(output, /vercel env pull/, "the message says how to produce the file");
    match(output, new RegExp(MISSING_ENV.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("under the old --env-file name the path never reaches the script at all", async () => {
    const { output } = await runScript(["--env-file", MISSING_ENV]);
    ok(
      !/vercel env pull/.test(output),
      `Node owns --env-file, so the script cannot explain the mistake; got:\n${output}`,
    );
  });
});
