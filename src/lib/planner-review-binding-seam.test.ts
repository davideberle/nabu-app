/**
 * Repair 5 — one content binding across review export, preparation and
 * hydration.
 *
 * Observed live on 2026-10-08 (W42): the weekly review export hashes the
 * persisted recipe, while the shelf hashed the render-QA copy. A deterministic
 * display fix (a metric unit moved out of the item name, a split fraction
 * rejoined) therefore changed the binding of an unchanged recipe and a paid
 * yes / no / uncertain result read as "unreviewed" on the shelf. The fixtures
 * below carry the four public payload shapes that were observed, trimmed to
 * the lines that trigger the fix.
 */
import { equal, notEqual, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hydrateShelfItems,
  prepareWeek,
  toCandidateItem,
  toShelfCandidate,
  type PreparationDeps,
} from "./planner-preparation.ts";
import { qaRecipeForShelf } from "./recipe-render-qa.ts";
import { classifyPlannerRole } from "./planner-roles.ts";
import {
  bindReviewResult,
  buildReviewBatch,
  buildReviewQuestions,
  buildReviewRequest,
  minimizeRecipeForReview,
  type CandidateReviewRecord,
  type ReviewVerdict,
} from "./planner-review.ts";
import type { ShelfCandidate } from "./planner-shelf.ts";
import type { MealPlan } from "./meals.ts";
import type { Recipe } from "./recipes.ts";

const NOW = new Date("2026-10-08T05:30:00.000Z");
const WEEK = "2026-W42";

function recipe(id: string, name: string, ingredients: Recipe["ingredients"]): Recipe {
  return {
    id,
    name,
    servings: "4",
    ingredients,
    method: ["Prepare the vegetables and the base.", "Cook everything together and serve hot."],
    category: { dish_type: ["main"], chapter: "" },
    image: `https://example.test/recipes/${id}.jpg`,
    time: { prep: 15, cook: 30, total: 45 },
  };
}

/** The four observed shapes: stranded "dl", three stranded "g", stranded "ml", a split mixed fraction. */
const SOURCE: Record<string, Recipe> = {
  gnocchi: recipe("seam-gnocchi", "Squash gnocchi with squash cream and mushrooms", [
    { item: "dl vegetable bouillon", amount: "2 ¼" },
    { item: "butternut squash, cubed", amount: "600", unit: "g" },
    { item: "gnocchi", amount: "500", unit: "g" },
    { item: "mushrooms, sliced", amount: "250", unit: "g" },
  ]),
  pasta: recipe("seam-pasta", "Creamy pumpkin pasta", [
    { item: "g pumpkin, peeled and cubed", amount: "500" },
    { item: "g pasta", amount: "300" },
    { item: "g parmesan, grated", amount: "50" },
    { item: "double cream", amount: "150", unit: "ml" },
  ]),
  fowl: recipe("seam-fowl", "One-pot roast guinea fowl", [
    { item: "ml chicken stock", amount: "300" },
    { item: "ml white wine", amount: "150" },
    { item: "guinea fowl", amount: "1" },
    { item: "shallots, peeled", amount: "6" },
  ]),
  bhaji: recipe("seam-bhaji", "Alu chi bhaji", [
    { item: "½ cups hot water (divided)", amount: "3" },
    { item: "oil", amount: "2", unit: "teaspoons" },
    { item: "besan (gram flour)", amount: "3", unit: "tablespoons" },
    { item: "colocasia leaves, sliced", amount: "8" },
  ]),
};

function rawHash(raw: Recipe): string {
  const minimized = minimizeRecipeForReview(raw);
  if (!minimized.ok) throw new Error(`${raw.id} must minimize`);
  return minimized.contentSha256;
}

/** The runtime path: render QA for traits and display, the persisted source for the binding. */
function viaRuntime(raw: Recipe, origin: "web" | "catalog"): ShelfCandidate {
  const role = classifyPlannerRole(raw);
  const checked = qaRecipeForShelf(raw, { role: role.role });
  ok(checked.ok, `${raw.id} passes render QA`);
  ok(checked.fixes.length > 0, `${raw.id} exercises a QA fix`);
  const sourceName = { "seam-gnocchi": "FOOBY", "seam-pasta": "BBC Good Food", "seam-fowl": "BBC Good Food", "seam-bhaji": "Ministry of Curry" }[raw.id] ?? "Fixture";
  return toShelfCandidate(checked.recipe, { origin, discovery: origin === "web" ? "search" : "catalog", week: WEEK, sourceName, contentSource: raw }, NOW);
}

/** A persisted record built the way import builds one, bound to the persisted source. */
function record(raw: Recipe, verdict: ReviewVerdict): CandidateReviewRecord {
  const minimized = minimizeRecipeForReview(raw);
  if (!minimized.ok) throw new Error("fixture must minimize");
  const main = verdict === "yes" ? 0.9 : verdict === "no" ? 0.03 : 0.4;
  const answers: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(buildReviewQuestions())) {
    answers[key] = question.type === "noul"
      ? { type: "noul", noul: key === "content_sufficient" ? 0.95 : 0.02 }
      : {
          type: "choice",
          choice: key === "meal_role" ? (verdict === "yes" ? "main" : verdict === "no" ? "side" : "uncertain") : "finished_dish",
          confidence: verdict === "uncertain" ? 0.5 : 0.95,
          probabilities: key === "meal_role" ? { main, side: verdict === "uncertain" ? 0.35 : 1 - main, ...(verdict === "uncertain" ? { uncertain: 0.25 } : {}) } : { finished_dish: 1 },
        };
  }
  const bound = bindReviewResult({
    recipeId: raw.id,
    payload: minimized.payload,
    requestSha256: buildReviewRequest(minimized.payload).requestSha256,
    response: { model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers, usage: { cost: 0.0001, input_tokens: 100, output_tokens: 20 } },
    responseSha256: "fixture",
    source: "fixture",
    reviewedAt: NOW.toISOString(),
  });
  if (!bound.ok) throw new Error(bound.problems.join("; "));
  equal(bound.record.interpretation.verdict, verdict, `fixture answers interpret as ${verdict}`);
  return bound.record;
}

function reviewsFor(records: readonly CandidateReviewRecord[]): Map<string, CandidateReviewRecord> {
  return new Map(records.map((r) => [`${r.recipeId}:${r.contentSha256}`, r]));
}

function harness(web: ShelfCandidate[], reviews: Map<string, CandidateReviewRecord>) {
  const saved: MealPlan[] = [];
  const deps: PreparationDeps = {
    now: NOW,
    loadPlan: async () => null,
    savePlan: async (plan) => {
      saved.push(plan);
      return { ok: true, plan };
    },
    ensureWebInspirations: async () => ({ status: "ready" }),
    loadWebCandidates: async () => web,
    loadCatalogCandidates: async () => [],
    loadReviews: async (bindings) => {
      const out = new Map<string, CandidateReviewRecord>();
      for (const b of bindings) {
        const hit = reviews.get(`${b.recipeId}:${b.contentSha256}`);
        if (hit) out.set(`${b.recipeId}:${b.contentSha256}`, hit);
      }
      return out;
    },
    claim: async () => true,
    complete: async () => {},
  };
  return { deps, saved };
}

describe("review binding seam (repair 5)", () => {
  it("each observed shape changes its hash under render QA, and the shelf binds to the persisted source like the export does", () => {
    for (const raw of Object.values(SOURCE)) {
      const role = classifyPlannerRole(raw);
      const checked = qaRecipeForShelf(raw, { role: role.role });
      const qa = minimizeRecipeForReview(checked.recipe);
      ok(qa.ok);
      const source = rawHash(raw);
      notEqual(qa.contentSha256, source, `${raw.id}: the QA copy hashes differently (the seam)`);
      const candidate = viaRuntime(raw, "web");
      equal(candidate.contentSha256, source, `${raw.id}: the shelf binds to the persisted source`);
      const batch = buildReviewBatch({ week: WEEK, candidates: [{ recipeId: raw.id, origin: "web", recipe: { name: raw.name, servings: raw.servings, ingredients: raw.ingredients } }], existing: () => null });
      equal(batch.items[0]?.contentSha256, source, `${raw.id}: the export hashes the same bytes`);
      // The QA'd copy still carries the fix for display: unit relocated / fraction rejoined.
      ok(checked.recipe.ingredients.every((i) => typeof i === "string" || !/^(g|kg|ml|l|dl|cl)\b/i.test(String(i.item))), `${raw.id}: display copy has no stranded unit`);
    }
  });

  it("preparation attaches yes, no and uncertain results bound to the persisted source; the no holds, the uncertain stays visible", async () => {
    const web = [viaRuntime(SOURCE.gnocchi, "web"), viaRuntime(SOURCE.pasta, "web"), viaRuntime(SOURCE.fowl, "web"), viaRuntime(SOURCE.bhaji, "web")];
    const reviews = reviewsFor([record(SOURCE.gnocchi, "yes"), record(SOURCE.pasta, "no"), record(SOURCE.fowl, "uncertain"), record(SOURCE.bhaji, "yes")]);
    const h = harness(web, reviews);
    const outcome = await prepareWeek(WEEK, h.deps);
    equal(outcome.status, "prepared");
    const byId = new Map(h.saved[0].candidateSet!.items.map((i) => [i.recipeId, i]));
    equal(byId.get("seam-gnocchi")?.review?.state, "checked-pass");
    equal(byId.get("seam-bhaji")?.review?.state, "checked-pass");
    equal(byId.get("seam-fowl")?.review?.state, "uncertain");
    ok(!byId.has("seam-pasta"), "a no holds the idea out of the automatic shelf");
    ok(outcome.held?.some((x) => x.recipeId === "seam-pasta"));
    for (const item of byId.values()) equal(item.contentSha256, rawHash(SOURCE[item.recipeId.replace("seam-", "")]), `${item.recipeId} stores the source binding`);
    equal(outcome.reviewStates?.unreviewed ?? 0, 0, "nothing reviewed reads as unreviewed");
  });

  it("an actual ingredient edit invalidates: neither the old yes nor the old no applies to the new source", async () => {
    const editedAmount = { ...SOURCE.gnocchi, ingredients: [{ item: "dl vegetable bouillon", amount: "3" }, ...SOURCE.gnocchi.ingredients.slice(1)] };
    const editedItem = { ...SOURCE.pasta, ingredients: [{ item: "g pumpkin, peeled and cubed", amount: "500" }, { item: "g pasta", amount: "300" }, { item: "g pecorino, grated", amount: "50" }, { item: "double cream", amount: "150", unit: "ml" }] };
    const web = [viaRuntime(editedAmount, "web"), viaRuntime(editedItem, "web")];
    notEqual(web[0].contentSha256, rawHash(SOURCE.gnocchi));
    notEqual(web[1].contentSha256, rawHash(SOURCE.pasta));
    const reviews = reviewsFor([record(SOURCE.gnocchi, "yes"), record(SOURCE.pasta, "no")]);
    const h = harness(web, reviews);
    const outcome = await prepareWeek(WEEK, h.deps);
    equal(outcome.status, "prepared");
    const byId = new Map(h.saved[0].candidateSet!.items.map((i) => [i.recipeId, i]));
    equal(byId.get("seam-gnocchi")?.review?.state, "unreviewed", "the old yes does not rescue changed content");
    equal(byId.get("seam-pasta")?.review?.state, "unreviewed", "the old no does not hold changed content either; it is simply unreviewed");
    equal(outcome.held?.length ?? 0, 0);
  });

  it("an unchanged source reuses the paid record: no new request is exported", () => {
    const records = reviewsFor([record(SOURCE.fowl, "uncertain"), record(SOURCE.bhaji, "no")]);
    const batch = buildReviewBatch({
      week: WEEK,
      candidates: [SOURCE.fowl, SOURCE.bhaji, SOURCE.gnocchi].map((raw) => ({ recipeId: raw.id, origin: "web" as const, recipe: { name: raw.name, servings: raw.servings, ingredients: raw.ingredients } })),
      existing: (id, sha) => records.get(`${id}:${sha}`) ?? null,
    });
    equal(batch.reused.length, 2);
    equal(batch.reused.find((r) => r.recipeId === "seam-fowl")?.verdict, "uncertain");
    equal(batch.reused.find((r) => r.recipeId === "seam-bhaji")?.verdict, "no");
    equal(batch.items.length, 1);
    equal(batch.items[0].recipeId, "seam-gnocchi");
  });

  it("GET/save hydration re-binds against the persisted source and keeps a no and an uncertain", async () => {
    const prepared = [viaRuntime(SOURCE.gnocchi, "web"), viaRuntime(SOURCE.pasta, "web"), viaRuntime(SOURCE.fowl, "web")];
    // What a saved plan carries: items with whatever summary was stored, re-resolved on read.
    const items = prepared.map((c) => ({ ...toCandidateItem({ ...c, reason: "", assigned: false }), review: { state: "unreviewed" as const, reason: "stored before the review landed" } }));
    const reviews = reviewsFor([record(SOURCE.gnocchi, "yes"), record(SOURCE.pasta, "no"), record(SOURCE.fowl, "uncertain")]);
    const resolveRecipe = async (id: string) => Object.values(SOURCE).find((r) => r.id === id);
    const hydrated = await hydrateShelfItems(items, new Set(), resolveRecipe, NOW, { week: WEEK, reviews });
    const byId = new Map(hydrated.map((i) => [i.recipeId, i]));
    equal(byId.get("seam-gnocchi")?.review?.state, "checked-pass");
    equal(byId.get("seam-pasta")?.review?.state, "checked-hold");
    equal(byId.get("seam-fowl")?.review?.state, "uncertain");
    for (const raw of [SOURCE.gnocchi, SOURCE.pasta, SOURCE.fowl]) equal(byId.get(raw.id)?.contentSha256, rawHash(raw));
    // The same read with the review store unavailable keeps the outage label, never a pass.
    const outage = await hydrateShelfItems(items, new Set(), resolveRecipe, NOW, { week: WEEK, resolveReviews: async () => { throw new Error("store unavailable"); }, providerStatus: { kind: "provider-unavailable", reason: "fixture" } });
    ok(outage.every((i) => i.review?.state !== "checked-pass"));
  });

  it("negative control: a candidate hashed from the QA copy never matches the paid record", async () => {
    const raw = SOURCE.gnocchi;
    const checked = qaRecipeForShelf(raw, { role: "main" });
    const mistaken = toShelfCandidate(checked.recipe, { origin: "web", discovery: "search", week: WEEK }, NOW);
    notEqual(mistaken.contentSha256, rawHash(raw));
    const h = harness([mistaken], reviewsFor([record(raw, "no")]));
    await prepareWeek(WEEK, h.deps);
    equal(h.saved[0].candidateSet!.items[0]?.review?.state, "unreviewed", "this is the live defect: the hold would be lost");
  });
});
