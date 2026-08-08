// The combined 12–14 idea shelf: web-first selection, catalog gap-fill,
// duplication limits, assigned pinning, and targeted replacement.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleWeeklyShelf,
  applyTargetedReplacement,
  canAdmit,
  coverageGaps,
  deriveShelfTraits,
  measureCoverage,
  SHELF_LIMITS,
  SHELF_POLICY_VERSION,
  type ShelfCandidate,
  type ShelfItem,
  type ShelfTraits,
} from "./planner-shelf.ts";
import { SHELF_TARGET } from "./planner-sources.ts";

const NOW = new Date("2026-08-08T05:30:00.000Z"); // summer

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

let seq = 0;
function candidate(overrides: Partial<ShelfCandidate> = {}): ShelfCandidate {
  seq += 1;
  const id = overrides.recipeId ?? `recipe-${seq}`;
  return {
    recipeId: id,
    recipeName: overrides.recipeName ?? `Recipe ${id}`,
    origin: "catalog",
    discovery: "catalog",
    sourceName: null,
    role: "main",
    bucket: "vegetarian",
    cuisine: "Other",
    image: "/recipes/x.jpg",
    traits: traits(),
    ...overrides,
  };
}

function web(source: string, overrides: Partial<ShelfCandidate> = {}): ShelfCandidate {
  return candidate({ origin: "web", discovery: "editorial", sourceName: source, ...overrides });
}

/** A varied catalog pool big enough to fill any shelf. */
function catalogPool(size = 20): ShelfCandidate[] {
  const shapes = ["soup", "salad", "stew-curry", "bowl", "roast-bake", "grill", "stir-fry", "other"] as const;
  const proteins = ["vegan", "vegetarian", "fish", "vegetarian", "meat", "vegan", "vegetarian", "vegan"] as const;
  const efforts = ["quick", "medium", "project", "quick", "medium", "quick", "quick", "medium"] as const;
  const cuisines = ["Italian", "Indian", "Greek", "Swiss", "Thai", "Mexican", "French", "Japanese"];
  return Array.from({ length: size }, (_, i) =>
    candidate({
      recipeId: `catalog-${i}`,
      recipeName: `Catalog ${i}`,
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

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

describe("trait derivation", () => {
  it("reads shape, starch, protein and effort off a real recipe shape", () => {
    const derived = deriveShelfTraits(
      {
        name: "Rigatoni with Courgette and Basil",
        time: { total: 30 },
        ingredients: [
          { item: "rigatoni" }, { item: "courgette" }, { item: "tomato" },
          { item: "basil" }, { item: "parmesan" }, { item: "garlic" },
        ],
      },
      NOW,
    );
    equal(derived.shape, "pasta");
    equal(derived.starch, "pasta");
    equal(derived.protein, "vegetarian");
    equal(derived.effort, "quick");
    equal(derived.vegetableDense, true);
    equal(derived.seasonalLocal, true, "courgette/tomato/basil are summer produce");
  });

  it("flags long-haul-led produce without banning it", () => {
    const derived = deriveShelfTraits(
      { name: "Mango and Avocado Salad", ingredients: [{ item: "mango" }, { item: "avocado" }, { item: "lime" }] },
      NOW,
    );
    equal(derived.longHaul, true);
  });

  it("classifies a long braise as a weekend project", () => {
    const derived = deriveShelfTraits(
      {
        name: "Slow-braised Beef Shin",
        time: { total: 210 },
        ingredients: [{ item: "beef shin" }, { item: "onion" }, { item: "carrot" }],
      },
      NOW,
    );
    equal(derived.effort, "project");
    equal(derived.protein, "meat");
    equal(derived.weekdayFit, false);
    equal(derived.weekendFit, true);
  });
});

// ---------------------------------------------------------------------------
// Admission rules
// ---------------------------------------------------------------------------

describe("set-level admission rules", () => {
  it("never admits a pairing into a main slot", () => {
    const verdict = canAdmit(candidate({ role: "pairing" }), []);
    equal(verdict.ok, false);
    ok(!verdict.ok && /pairing/.test(verdict.reason));
  });

  it("caps pasta at two across the whole shelf", () => {
    const pasta = () => candidate({ traits: traits({ starch: "pasta", shape: "pasta" }) });
    const shelf = [pasta(), pasta()];
    const verdict = canAdmit(pasta(), shelf);
    equal(verdict.ok, false);
    ok(!verdict.ok && verdict.reason.includes("pasta"));
    equal(SHELF_LIMITS.maxPasta, 2);
  });

  it("caps one cuisine at three", () => {
    const greek = () => candidate({ cuisine: "Greek" });
    const verdict = canAdmit(greek(), [greek(), greek(), greek()]);
    equal(verdict.ok, false);
    ok(!verdict.ok && verdict.reason.includes("Greek"));
  });

  it("applies the registry source cap to web ideas", () => {
    const fooby = () => web("FOOBY");
    equal(canAdmit(fooby(), [fooby(), fooby()]).ok, true, "a third FOOBY idea is allowed");
    const fourth = canAdmit(fooby(), [fooby(), fooby(), fooby()]);
    equal(fourth.ok, false, "a fourth is not");

    const kate = () => web("Cookie and Kate");
    const third = canAdmit(kate(), [kate(), kate()]);
    equal(third.ok, false, "a normal source stops at two");
  });

  it("bounds meat, fish and long-haul lanes", () => {
    const meat = () => candidate({ traits: traits({ protein: "meat" }) });
    equal(canAdmit(meat(), [meat(), meat()]).ok, false);

    const fish = () => candidate({ traits: traits({ protein: "fish" }) });
    equal(canAdmit(fish(), [fish(), fish()]).ok, false);

    const longHaul = () => candidate({ traits: traits({ longHaul: true }) });
    equal(canAdmit(longHaul(), [longHaul(), longHaul()]).ok, false);
  });

  it("refuses a duplicate", () => {
    const one = candidate({ recipeId: "same" });
    equal(canAdmit(candidate({ recipeId: "same" }), [one]).ok, false);
  });
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

describe("web-first assembly with catalog gap-fill", () => {
  it("builds one combined 12–14 idea shelf", () => {
    const shelf = assembleWeeklyShelf({
      web: [
        web("FOOBY", { traits: traits({ shape: "salad", protein: "vegan", effort: "quick", seasonalLocal: true }) }),
        web("FOOBY", { traits: traits({ shape: "bowl", protein: "vegetarian" }) }),
        web("Cookie and Kate", { traits: traits({ shape: "stew-curry", protein: "vegan" }), cuisine: "Indian" }),
        web("Serious Eats", { traits: traits({ shape: "grill", protein: "meat" }), cuisine: "American" }),
        web("BBC Good Food", { traits: traits({ shape: "roast-bake", protein: "vegetarian" }), cuisine: "European" }),
      ],
      catalog: catalogPool(24),
    });

    ok(shelf.items.length >= SHELF_TARGET.min, `expected >= ${SHELF_TARGET.min}, got ${shelf.items.length}`);
    ok(shelf.items.length <= SHELF_TARGET.max, `expected <= ${SHELF_TARGET.max}, got ${shelf.items.length}`);
    equal(shelf.diagnostics.policyVersion, SHELF_POLICY_VERSION);
    ok(shelf.diagnostics.webSelected >= 5 && shelf.diagnostics.webSelected <= 7);
    ok(shelf.diagnostics.catalogSelected > 0, "the catalog fills the rest");
  });

  it("takes the strongest web ideas first, then fills only real gaps", () => {
    const shelf = assembleWeeklyShelf({
      web: [
        web("FOOBY", { recipeId: "web-pasta-1", traits: traits({ shape: "pasta", starch: "pasta" }), cuisine: "Italian" }),
        web("FOOBY", { recipeId: "web-pasta-2", traits: traits({ shape: "pasta", starch: "pasta" }), cuisine: "Italian" }),
        web("Cookie and Kate", { recipeId: "web-veg", traits: traits({ protein: "vegan", effort: "quick" }) }),
      ],
      catalog: [
        candidate({ recipeId: "cat-pasta", traits: traits({ shape: "pasta", starch: "pasta" }), cuisine: "Italian" }),
        ...catalogPool(20),
      ],
    });

    const ids = shelf.items.map((i) => i.recipeId);
    ok(ids.includes("web-pasta-1") && ids.includes("web-pasta-2"), "both web pasta ideas survive");
    ok(!ids.includes("cat-pasta"), "the catalog adds no third pasta");
  });

  it("adds catalog pasta when the web set brought none", () => {
    const shelf = assembleWeeklyShelf({
      web: [web("FOOBY", { traits: traits({ shape: "salad", protein: "vegan" }) })],
      catalog: [
        candidate({ recipeId: "cat-pasta", traits: traits({ shape: "pasta", starch: "pasta" }), cuisine: "Italian" }),
        ...catalogPool(20),
      ],
    });
    const pasta = shelf.items.filter((i) => i.traits.starch === "pasta");
    ok(pasta.length <= SHELF_LIMITS.maxPasta);
  });

  it("respects every duplication limit in the assembled shelf", () => {
    const shelf = assembleWeeklyShelf({
      web: [
        web("FOOBY"), web("FOOBY"), web("FOOBY"), web("FOOBY"), web("FOOBY"),
        web("Cookie and Kate"), web("Cookie and Kate"), web("Cookie and Kate"),
      ],
      catalog: catalogPool(24),
    });
    const coverage = measureCoverage(shelf.items);
    equal(coverage.sources["FOOBY"] ?? 0, 3, "FOOBY contributes no more than three");
    ok((coverage.sources["Cookie and Kate"] ?? 0) <= 2);
    ok((coverage.starches.pasta ?? 0) <= SHELF_LIMITS.maxPasta);
    ok(coverage.proteins.meat <= SHELF_LIMITS.maxMeat);
    ok(coverage.proteins.fish <= SHELF_LIMITS.maxFish);
    ok(coverage.longHaul <= SHELF_LIMITS.maxLongHaul);
    for (const [cuisine, count] of Object.entries(coverage.cuisines)) {
      if (cuisine === "Other") continue;
      ok(count <= SHELF_LIMITS.maxPerCuisine, `${cuisine} appears ${count} times`);
    }
  });

  it("is plant-forward and keeps meat occasional", () => {
    const shelf = assembleWeeklyShelf({ web: [], catalog: catalogPool(30) });
    const coverage = measureCoverage(shelf.items);
    ok(
      coverage.plantForwardShare >= SHELF_LIMITS.minPlantForwardShare,
      `plant-forward share was ${coverage.plantForwardShare}`,
    );
    ok(coverage.proteins.meat <= SHELF_LIMITS.maxMeat);
  });

  it("contributes zero web ideas when the editorial week is weak", () => {
    const shelf = assembleWeeklyShelf({
      web: [
        web("FOOBY", { role: "pairing" }),
        web("Serious Eats", { role: "pairing" }),
      ],
      catalog: catalogPool(20),
    });
    equal(shelf.diagnostics.webSelected, 0, "no FOOBY quota is forced");
    ok(shelf.items.length >= SHELF_TARGET.min, "the catalog covers the whole week instead");
    ok(shelf.diagnostics.warnings.some((w) => w.includes("qualified web ideas")));
  });

  it("keeps pairings as reserves, never as shelf items", () => {
    const pairing = web("FOOBY", { recipeId: "watermelon", role: "pairing" });
    const shelf = assembleWeeklyShelf({
      web: [pairing],
      catalog: catalogPool(20),
      pairings: [pairing],
    });
    ok(!shelf.items.some((i) => i.recipeId === "watermelon"));
    deepStrictEqual(shelf.reserves.map((r) => r.recipeId), ["watermelon"]);
  });

  it("pins assigned recipes so they stay visible, and marks them assigned", () => {
    const assignedWeb = web("FOOBY", { recipeId: "assigned-web" });
    const assignedCatalog = candidate({ recipeId: "assigned-catalog" });
    const shelf = assembleWeeklyShelf({
      web: [assignedWeb, web("Cookie and Kate")],
      catalog: [assignedCatalog, ...catalogPool(20)],
      assignedRecipeIds: new Set(["assigned-web", "assigned-catalog"]),
    });

    const pinned = shelf.items.filter((i) => i.assigned).map((i) => i.recipeId);
    deepStrictEqual(pinned.sort(), ["assigned-catalog", "assigned-web"]);
    equal(shelf.diagnostics.assignedPinned, 2);
    ok(shelf.items.every((i) => !i.assigned || i.reason === "Assigned to a day this week"));
  });

  it("explains every card without the UI having to guess", () => {
    const shelf = assembleWeeklyShelf({
      web: [web("FOOBY"), web("Cookie and Kate", { discovery: "search" })],
      catalog: catalogPool(20),
    });
    ok(shelf.items.every((item) => item.reason.length > 0));
    ok(shelf.items.some((item) => item.reason.startsWith("Editor-curated pick")));
    ok(shelf.items.some((item) => item.reason.startsWith("Targeted web find")));
  });

  it("is deterministic for the same pool", () => {
    const input = { web: [web("FOOBY", { recipeId: "w1" }), web("Serious Eats", { recipeId: "w2" })], catalog: catalogPool(20) };
    const a = assembleWeeklyShelf(input).items.map((i) => i.recipeId);
    const b = assembleWeeklyShelf(input).items.map((i) => i.recipeId);
    deepStrictEqual(a, b);
  });
});

describe("coverage gaps", () => {
  it("names the missing lanes rather than a bucket quota", () => {
    const gaps = coverageGaps(
      measureCoverage([
        candidate({ traits: traits({ protein: "meat", shape: "roast-bake", effort: "project" }) }),
        candidate({ traits: traits({ protein: "meat", shape: "grill", effort: "project" }) }),
      ]),
    );
    ok(gaps.includes("plant-forward"));
    ok(gaps.includes("fish"));
    ok(gaps.includes("soup"));
    ok(gaps.includes("quick-weekday"));
  });
});

// ---------------------------------------------------------------------------
// Targeted replacement
// ---------------------------------------------------------------------------

describe("targeted replacement", () => {
  function shelfWithAssignments(): ShelfItem[] {
    return [
      { ...candidate({ recipeId: "assigned-meat", traits: traits({ protein: "meat" }) }), reason: "Assigned to a day this week", assigned: true },
      { ...candidate({ recipeId: "free-meat", traits: traits({ protein: "meat" }) }), reason: "From your recipe book", assigned: false },
      { ...candidate({ recipeId: "free-veg-1" }), reason: "From your recipe book", assigned: false },
      { ...candidate({ recipeId: "free-veg-2" }), reason: "From your recipe book", assigned: false },
      ...catalogPool(9).map((c) => ({ ...c, reason: "From your recipe book", assigned: false })),
    ];
  }

  it("never removes an assigned recipe, even when named explicitly", () => {
    const result = applyTargetedReplacement(shelfWithAssignments(), {
      removeRecipeIds: ["assigned-meat"],
      replacements: [candidate({ recipeId: "fresh-veg" })],
      wish: "less meat this week",
    });
    deepStrictEqual(result.protectedAssigned, ["assigned-meat"]);
    ok(result.shelf.some((i) => i.recipeId === "assigned-meat"));
    deepStrictEqual(result.removed, []);
  });

  it("replaces only unassigned ideas that match the wish", () => {
    const before = shelfWithAssignments();
    const result = applyTargetedReplacement(before, {
      dropWhere: { protein: "meat" },
      replacements: [candidate({ recipeId: "fresh-veg", traits: traits({ protein: "vegan" }) })],
      wish: "no more meat",
    });
    const removedIds = result.removed.map((r) => r.recipeId);
    ok(removedIds.includes("free-meat"), "the unassigned meat idea goes");
    ok(
      removedIds.every((id) => before.find((i) => i.recipeId === id)?.traits.protein === "meat"),
      "only matching ideas are removed",
    );
    ok(
      removedIds.every((id) => before.find((i) => i.recipeId === id)?.assigned === false),
      "nothing assigned is removed",
    );
    ok(result.protectedAssigned.includes("assigned-meat"));
    ok(result.shelf.some((i) => i.recipeId === "fresh-veg"));
    ok(result.added.every((i) => i.reason === "Swapped in for: no more meat"));
  });

  it("leaves untouched cards exactly as they were", () => {
    const before = shelfWithAssignments();
    const result = applyTargetedReplacement(before, {
      removeRecipeIds: ["free-veg-1"],
      replacements: [candidate({ recipeId: "fresh" })],
    });
    const untouched = before.filter((i) => i.recipeId !== "free-veg-1");
    for (const item of untouched) {
      const after = result.shelf.find((i) => i.recipeId === item.recipeId);
      ok(after, `${item.recipeId} must survive`);
      equal(after?.reason, item.reason);
      equal(after?.assigned, item.assigned);
    }
  });

  it("revalidates the set instead of accepting any replacement", () => {
    const pastaShelf: ShelfItem[] = [
      { ...candidate({ recipeId: "p1", traits: traits({ starch: "pasta" }) }), reason: "", assigned: false },
      { ...candidate({ recipeId: "p2", traits: traits({ starch: "pasta" }) }), reason: "", assigned: false },
      { ...candidate({ recipeId: "drop-me" }), reason: "", assigned: false },
    ];
    const result = applyTargetedReplacement(pastaShelf, {
      removeRecipeIds: ["drop-me"],
      replacements: [candidate({ recipeId: "p3", traits: traits({ starch: "pasta" }) })],
    });
    ok(!result.shelf.some((i) => i.recipeId === "p3"), "a third pasta is still refused");
    ok(result.warnings.some((w) => w.includes("replacement")));
  });

  it("adds nothing when the only named idea is assigned", () => {
    const before = shelfWithAssignments();
    const result = applyTargetedReplacement(before, {
      removeRecipeIds: ["assigned-meat"],
      replacements: [candidate({ recipeId: "fresh-veg" }), candidate({ recipeId: "fresh-veg-2" })],
      wish: "less meat this week",
    });

    deepStrictEqual(result.removed, []);
    deepStrictEqual(result.added, [], "nothing left, so nothing comes in");
    deepStrictEqual(
      result.shelf.map((i) => i.recipeId),
      before.map((i) => i.recipeId),
      "the shelf is untouched",
    );
    ok(
      !result.shelf.some((i) => i.reason.startsWith("Swapped in")),
      "and no card claims to be a swap that never happened",
    );
    ok(result.warnings.some((w) => w.includes("assigned to a day")), "it says why nothing changed");
  });

  it("adds nothing when dropWhere matches only assigned ideas", () => {
    const before: ShelfItem[] = [
      { ...candidate({ recipeId: "assigned-fish", traits: traits({ protein: "fish" }) }), reason: "Assigned to a day this week", assigned: true },
      ...catalogPool(16).map((c) => ({ ...c, reason: "From your recipe book", assigned: false })),
    ].filter((item, index) => index === 0 || item.traits.protein !== "fish");

    const result = applyTargetedReplacement(before, {
      dropWhere: { protein: "fish" },
      replacements: [candidate({ recipeId: "fresh-veg", traits: traits({ protein: "vegan" }) })],
      wish: "no fish",
    });

    deepStrictEqual(result.removed, []);
    deepStrictEqual(result.protectedAssigned, ["assigned-fish"]);
    deepStrictEqual(result.added, []);
    deepStrictEqual(result.shelf.map((i) => i.recipeId), before.map((i) => i.recipeId));
  });

  it("still tops a genuinely short shelf up to the minimum, without calling it a swap", () => {
    const short: ShelfItem[] = [
      { ...candidate({ recipeId: "assigned-meat", traits: traits({ protein: "meat" }) }), reason: "Assigned to a day this week", assigned: true },
      ...catalogPool(4).map((c) => ({ ...c, reason: "From your recipe book", assigned: false })),
    ];
    const result = applyTargetedReplacement(short, {
      removeRecipeIds: ["assigned-meat"],
      replacements: catalogPool(20).map((c, i) => ({ ...c, recipeId: `fill-${i}` })),
      wish: "less meat",
    });

    deepStrictEqual(result.removed, []);
    ok(result.added.length > 0, "a five-idea shelf is short and is topped up");
    equal(result.shelf.length, 12, "but only as far as the minimum, never to the maximum");
    ok(
      result.added.every((i) => i.reason === "From your recipe book to round out the week"),
      "topping up is not a swap and does not borrow the wish",
    );
  });

  it("reports when it could not refill the shelf", () => {
    const result = applyTargetedReplacement(shelfWithAssignments(), {
      dropWhere: { protein: "vegetarian" },
      replacements: [],
    });
    ok(result.removed.length > 0);
    ok(result.warnings.length > 0, "a silent shrink would read as success");
  });
});
