#!/usr/bin/env node
// Targeted verification for meal-planner eligibility, bucket classification,
// season filtering, metadata normalization, and save-boundary sanitation.
//
// Phase 3B rule: this script imports and exercises the PRODUCTION safety gate
// and classifier from src/lib/meals.ts (backed by meals-core.ts) instead of
// maintaining a divergent copy — if production behavior drifts, these checks
// fail. It is read-only: no database module is imported and nothing is
// written.
//
// Run: node scripts/verify-meals.mjs

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  isMainPlannerCandidate,
  classifyPlannerBucket,
  selectCandidateMains,
  sanitizeCandidateItems,
  normalizePlannerCuisine,
  normalizePlannerTitle,
  plannerPolicy,
  DEFAULT_PLANNER_POLICY,
  CANDIDATE_BUCKET_CONTRACT,
  CANDIDATE_BUCKET_ORDER,
  _isDinnerWorthy as isDinnerWorthy,
  _isWeekendMainWorthy as isWeekendMainWorthy,
  _recipeSeason as recipeSeason,
  _filterBySeason as filterBySeason,
} from "../src/lib/meals.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(
  readFileSync(join(__dirname, "..", "src", "data", "recipes-bundle.json"), "utf8")
);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function find(id) {
  return bundle.find((r) => r.id === id);
}

// ---- Specific recipe checks (production gate) ----

console.log("\n1. Moroccan Mashed Potatoes → must be side, not dinner-worthy");
const mmp = find("moroccan-mashed-potatoes");
assert(mmp, "recipe found");
assert(mmp.category.dish_type.includes("side"), "dish_type is side");
assert(!isDinnerWorthy(mmp), "not dinner-worthy");
assert(!isWeekendMainWorthy(mmp), "not weekend-main-worthy");

console.log("\n2. Tulsi–cinnamon Fruit Bowl → must be breakfast, not dinner-worthy");
const tfb = find("tulsi-cinnamon-fruit-bowl");
assert(tfb, "recipe found");
assert(tfb.category.dish_type.includes("breakfast"), "dish_type is breakfast");
assert(!isDinnerWorthy(tfb), "not dinner-worthy");
assert(!isWeekendMainWorthy(tfb), "not weekend-main-worthy");

console.log("\n3. Smoked fish, fennel, and mango salad → salad, not weekend main");
const sfl = find("smoked-fish-fennel-and-mango-salad");
assert(sfl, "recipe found");
assert(sfl.category.dish_type.includes("salad"), "dish_type is salad");
assert(!sfl.category.dish_type.includes("main"), "not tagged as main");
const sflDietary = sfl.tags?.dietary ?? sfl.dietary ?? [];
assert(!sflDietary.includes("vegetarian"), "not marked vegetarian (has seafood)");
assert(!sflDietary.includes("vegan"), "not marked vegan (has seafood)");
assert(isDinnerWorthy(sfl), "still dinner-worthy (salad is ok for weekday)");
assert(!isWeekendMainWorthy(sfl), "not weekend-main-worthy");

console.log("\n4. Orecchiette with Escarole → fall season, excluded in spring");
const ore = find("orecchiette-with-escarole-nduja-and-burrata");
assert(ore, "recipe found");
assert(recipeSeason(ore) === "fall", `season detected as fall (got: ${recipeSeason(ore)})`);
const springFiltered = filterBySeason([ore], new Date("2026-04-15"));
assert(springFiltered.length === 0, "excluded from spring meal plans");
const fallFiltered = filterBySeason([ore], new Date("2026-10-15"));
assert(fallFiltered.length === 1, "included in fall meal plans");

console.log("\n5. Punjabi Lobia Masala → image nulled by cleanup (73deb4ed)");
const plm = find("punjabi-lobia-masala");
assert(plm, "recipe found");
assert(plm.image === null || plm.image === undefined, `image is null (got: ${plm.image})`);

console.log("\n6. Plain Congee → breakfast, not dinner-worthy");
const pc = find("plain-congee");
assert(pc, "recipe found");
assert(pc.category.dish_type.includes("breakfast"), "dish_type is breakfast");
assert(!isDinnerWorthy(pc), "not dinner-worthy");
assert(!isWeekendMainWorthy(pc), "not weekend-main-worthy");

console.log("\n6b. Pickled Mustard Greens → condiment, not dinner-worthy");
const pmg = find("pickled-mustard-greens");
assert(pmg, "recipe found");
assert(pmg.category.dish_type.includes("condiment"), `dish_type is condiment (got: ${JSON.stringify(pmg.category.dish_type)})`);
assert(pmg.category.meal_role === "side", `meal_role is side (got: ${pmg.category.meal_role})`);
assert(!isDinnerWorthy(pmg), "not dinner-worthy");
assert(!isWeekendMainWorthy(pmg), "not weekend-main-worthy");
assert(pmg.image === null || pmg.image === undefined, `image is null (got: ${pmg.image})`);

console.log("\n6c. Aluvati → image nulled (illustrative)");
const alu = find("aluvati");
assert(alu, "recipe found");
assert(alu.image === null || alu.image === undefined, `image is null (got: ${alu.image})`);

console.log("\n6d. Triple-grain Herbed Salad Bowl → image nulled");
const tghsb = find("triple-grain-herbed-salad-bowl");
assert(tghsb, "recipe found");
assert(tghsb.image === null || tghsb.image === undefined, `image is null (got: ${tghsb.image})`);

console.log("\n6e. Hominy and Spinach in Tomato-Garlic Broth → image nulled (wrong image)");
const hominy = find("hominy-and-spinach-in-tomato-garlic-broth");
assert(hominy, "recipe found");
assert(hominy.image === null || hominy.image === undefined, `image is null (got: ${hominy.image})`);

console.log("\n6f. Celtuce Salad with Spring Onion Oil → image nulled (wrong image)");
const celtuce = find("celtuce-salad-with-spring-onion-oil");
assert(celtuce, "recipe found");
assert(celtuce.image === null || celtuce.image === undefined, `image is null (got: ${celtuce.image})`);

// ---- Broader sanity checks ----

console.log("\n7. Weekend-main pool is a strict subset of dinner pool");
const dinnerPool = bundle.filter(isDinnerWorthy);
const weekendPool = bundle.filter(isWeekendMainWorthy);
assert(weekendPool.length < dinnerPool.length, `weekend pool (${weekendPool.length}) < dinner pool (${dinnerPool.length})`);
assert(weekendPool.every((r) => dinnerPool.some((d) => d.id === r.id)), "every weekend-main is also dinner-worthy");

console.log("\n8. Spring season filtering excludes fall-tagged recipes");
const springPool = filterBySeason(dinnerPool, new Date("2026-04-15"));
const fallRecipesInSpring = springPool.filter((r) => recipeSeason(r) === "fall");
assert(fallRecipesInSpring.length === 0, `no fall recipes in spring pool (was ${fallRecipesInSpring.length})`);

// ---- Phase 3B: authoritative bucket classification regressions ----

console.log("\n9. Bucket regressions pin the audit's misclassification cases");
const vichyssoise = find("asparagus-vichyssoise");
assert(vichyssoise, "asparagus-vichyssoise found in bundle");
assert(
  classifyPlannerBucket(vichyssoise) === "soup",
  `Asparagus vichyssoise classifies as soup (got: ${vichyssoise && classifyPlannerBucket(vichyssoise)})`
);
const turkeyPho = find("smoked-turkey-pho");
assert(turkeyPho, "smoked-turkey-pho found in bundle");
assert(
  classifyPlannerBucket(turkeyPho) === "meat",
  `Smoked Turkey Pho classifies as meat (got: ${turkeyPho && classifyPlannerBucket(turkeyPho)})`
);

// ---- Phase 3B: production candidate pipeline (no local simulation) ----

console.log("\n10. Production selectCandidateMains fills the contract in order");
const gated = selectCandidateMains(bundle, new Set(), {});
const expectedTotal = CANDIDATE_BUCKET_CONTRACT.reduce((a, b) => a + b, 0);
assert(gated.candidates.length === expectedTotal, `total candidates = ${gated.candidates.length} (expected ${expectedTotal})`);
for (let i = 0; i < CANDIDATE_BUCKET_ORDER.length; i++) {
  const bucket = CANDIDATE_BUCKET_ORDER[i];
  const fill = gated.diagnostics.bucketFill[bucket];
  assert(fill.filled >= fill.target, `bucket "${bucket}" filled ${fill.filled}/${fill.target}`);
}
let orderCorrect = true;
let idx = 0;
for (let i = 0; i < CANDIDATE_BUCKET_ORDER.length; i++) {
  for (let j = 0; j < CANDIDATE_BUCKET_CONTRACT[i]; j++) {
    if (gated.candidates[idx]?.bucket !== CANDIDATE_BUCKET_ORDER[i]) orderCorrect = false;
    idx++;
  }
}
assert(orderCorrect, "candidates are in contract bucket order (salad→soup→veg→fish→meat)");
assert(
  gated.candidates.every(({ recipe, bucket }) => classifyPlannerBucket(recipe) === bucket),
  "every returned bucket label matches the authoritative classifier"
);
assert(
  gated.candidates.every(({ recipe }) => isMainPlannerCandidate(recipe)),
  "every returned candidate passes the planner-main gate"
);

console.log("\n11. Exclusions are honored by the production pipeline");
const firstId = gated.candidates[0]?.recipe.id;
const rerun = selectCandidateMains(bundle, new Set([firstId]), {});
assert(
  rerun.candidates.every(({ recipe }) => recipe.id !== firstId),
  `excluded recipe "${firstId}" does not reappear`
);

// ---- Phase 3B: save-boundary sanitation ----

console.log("\n12. sanitizeCandidateItems enforces recent/negative exclusions");
const items = [
  { recipeId: "fresh-ok" },
  { recipeId: "cooked-recently" },
  { recipeId: "planned-recently" },
  { recipeId: "offered-recently" },
  { recipeId: "thumbs-downed" },
  { recipeId: "assigned-this-week" },
  { recipeId: "fresh-ok" },
];
const sanitized = sanitizeCandidateItems(
  items,
  new Set(["assigned-this-week"]),
  {
    recentlyCooked: new Set(["cooked-recently", "assigned-this-week"]),
    recentlyPlanned: new Set(["planned-recently"]),
    recentlyOffered: new Set(["offered-recently"]),
    negativeFeedback: new Set(["thumbs-downed"]),
  },
);
const keptIds = sanitized.items.map((i) => i.recipeId);
assert(keptIds.includes("fresh-ok"), "clean candidate is kept");
assert(!keptIds.includes("cooked-recently"), "recently cooked candidate removed");
assert(!keptIds.includes("planned-recently"), "recently planned candidate removed");
assert(!keptIds.includes("offered-recently"), "recently offered candidate removed");
assert(!keptIds.includes("thumbs-downed"), "negative-feedback candidate removed");
assert(keptIds.includes("assigned-this-week"), "assigned candidate kept (visible-but-disabled)");
assert(keptIds.filter((id) => id === "fresh-ok").length === 1, "duplicate candidate collapsed");
assert(sanitized.removed.length === 5, `removed count = ${sanitized.removed.length} (expected 5: 4 exclusions + 1 duplicate)`);

// ---- Phase 3B: planner-facing metadata normalization ----

console.log("\n13. Metadata normalization is deterministic and non-inventive");
assert(normalizePlannerTitle("  Salade   Niçoise ​ ") === "Salade Niçoise", "title collapses whitespace + zero-width chars");
assert(normalizePlannerTitle(42) === "", "non-string title degrades to empty, not invented");
const cuisineProbe = { name: "x", ingredients: [], method: [], servings: "" };
assert(normalizePlannerCuisine({ ...cuisineProbe, cuisine: ["  swiss "] }) === "Swiss", "array cuisine → canonical casing");
assert(normalizePlannerCuisine({ ...cuisineProbe, cuisine: "international, mediterranean" }) === "International", "multi-value cuisine → first segment");
assert(normalizePlannerCuisine({ ...cuisineProbe, cuisine: "", source: { cookbook: "Persiana", author: "" } }) === "Middle Eastern", "empty cuisine falls back to cookbook mapping");
assert(normalizePlannerCuisine(cuisineProbe) === "Other", "no data → Other, nothing invented");

console.log("\n14. Planner policy windows are configured");
// Literal pins on purpose: comparing against DEFAULT_PLANNER_POLICY would
// still pass if the exported defaults drifted from the documented windows.
const policy = plannerPolicy({});
assert(policy.recentlyCookedDays === 45, `recentlyCookedDays default is 45 (got ${policy.recentlyCookedDays})`);
assert(policy.recentWeeksLookback === 5, `recentWeeksLookback default is 5 (got ${policy.recentWeeksLookback})`);
assert(policy.negativeFeedbackDays === 60, `negativeFeedbackDays default is 60 (got ${policy.negativeFeedbackDays})`);
assert(
  DEFAULT_PLANNER_POLICY.recentlyCookedDays === 45 &&
    DEFAULT_PLANNER_POLICY.recentWeeksLookback === 5 &&
    DEFAULT_PLANNER_POLICY.negativeFeedbackDays === 60,
  "DEFAULT_PLANNER_POLICY matches the documented 45/5/60 windows",
);
const overridden = plannerPolicy({ PLANNER_NEGATIVE_FEEDBACK_DAYS: "90" });
assert(overridden.negativeFeedbackDays === 90, "negative window is env-configurable");

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
