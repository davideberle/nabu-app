// Persisted planned-week round-trip through the canonical save boundary
// (REPAIR-1 R4/R5; WP04, WP05, WP07, WP08). A real libsql file database in a
// temp directory, the production saveMealPlan/loadMealPlan path, the
// persisted review tables, and only the recipe resolver injected.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NABU_DB_DIR = mkdtempSync(join(tmpdir(), "planner-save-binding-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

import { equal, ok } from "node:assert/strict";
import { describe, it, before } from "node:test";
import { saveMealPlan, loadMealPlan } from "./meals-persistence.ts";
import { getDb, saveCandidateReviews, savePlannerReviewRun } from "./db.ts";
import { toCandidateItem, toShelfCandidate } from "./planner-preparation.ts";
import { qaRecipeForShelf } from "./recipe-render-qa.ts";
import { SHELF_POLICY_VERSION } from "./planner-shelf.ts";
import { bindReviewResult, buildReviewQuestions, buildReviewRequest, minimizeRecipeForReview, PLANNER_REVIEW_MODEL, PLANNER_REVIEW_RUBRIC_SHA256, type CandidateReviewRecord } from "./planner-review.ts";
import type { MealPlan } from "./meals.ts";
import type { Recipe } from "./recipes.ts";

const NOW = new Date("2026-10-08T05:30:00.000Z"); // October by the clock
const WEEK = "2026-W49"; // a December week

function recipe(id: string, name: string, ingredients: Recipe["ingredients"]): Recipe {
  return {
    id,
    name,
    servings: "4",
    ingredients,
    method: ["Prepare all the ingredients carefully.", "Cook everything until it is ready to serve."],
    category: { dish_type: ["main"], chapter: "" },
    image: `/recipes/${id}.jpg`,
    time: { total: 40 },
  };
}

const RECIPES: Record<string, Recipe> = {
  gratin: recipe("gratin", "Pumpkin gratin", [{ item: "pumpkin", amount: "800", unit: "g" }, { item: "cream", amount: "200", unit: "ml" }, { item: "gruyère", amount: "100", unit: "g" }]),
  salad: recipe("salad", "Tomato salad plate", [{ item: "ripe tomatoes", amount: "600", unit: "g" }, { item: "mozzarella", amount: "250", unit: "g" }, { item: "basil", amount: "1", unit: "bunch" }]),
  stew: recipe("stew", "Lentil and chard stew", [{ item: "lentils", amount: "300", unit: "g" }, { item: "chard", amount: "300", unit: "g" }, { item: "stock", amount: "1", unit: "l" }]),
  // Observed live shape (W42, FOOBY): the unit sits in the item name; render QA moves it. The binding must not move with it.
  bouillon: recipe("bouillon", "Squash gnocchi with squash cream", [{ item: "dl vegetable bouillon", amount: "2 ¼" }, { item: "squash", amount: "600", unit: "g" }, { item: "gnocchi", amount: "500", unit: "g" }]),
};
const resolveRecipe = async (id: string) => RECIPES[id];

/** A persisted record built the way the import path builds one: bound answers, real request digest. */
function record(id: string, verdict: "yes" | "no", overrides: Partial<CandidateReviewRecord> = {}): CandidateReviewRecord {
  const minimized = minimizeRecipeForReview(RECIPES[id]);
  if (!minimized.ok) throw new Error("fixture must minimize");
  const main = verdict === "yes" ? 0.9 : 0.03;
  const answers: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(buildReviewQuestions())) {
    answers[key] = question.type === "noul"
      ? { type: "noul", noul: key === "content_sufficient" ? 0.95 : 0.02 }
      : { type: "choice", choice: key === "meal_role" ? (verdict === "yes" ? "main" : "side") : "finished_dish", confidence: 0.95, probabilities: key === "meal_role" ? { main, side: 1 - main } : { finished_dish: 1 } };
  }
  const bound = bindReviewResult({
    recipeId: id,
    payload: minimized.payload,
    requestSha256: buildReviewRequest(minimized.payload).requestSha256,
    response: { model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers, usage: { cost: 0.0001, input_tokens: 100, output_tokens: 20 } },
    responseSha256: "s",
    source: "fixture",
    reviewedAt: NOW.toISOString(),
  });
  if (!bound.ok) throw new Error(bound.problems.join("; "));
  return { ...bound.record, ...overrides };
}

function planFor(week: string, items: MealPlan["candidateSet"] extends infer S ? (S extends { items: infer I } ? I : never) : never): MealPlan {
  return {
    week,
    status: "draft",
    plannerVersion: "vNext-1",
    candidateSet: { generatedAt: NOW.toISOString(), policyVersion: SHELF_POLICY_VERSION, items },
    days: [],
    context: [],
    notes: "",
    locked: false,
    createdAt: NOW.toISOString(),
  };
}

before(async () => {
  await getDb();
});

describe("save boundary binding (R4/R5)", () => {
  it("keeps the planned December month through a save in October, and ranks pumpkin as stored, not fresh", async () => {
    const prepared = toShelfCandidate(RECIPES.gratin, { origin: "catalog", discovery: "catalog", week: WEEK }, NOW);
    equal(prepared.seasonality?.month, 12);
    const result = await saveMealPlan(planFor(WEEK, [toCandidateItem({ ...prepared, reason: "", assigned: false })]), { resolveRecipe });
    ok(result.ok);
    const stored = await loadMealPlan(WEEK);
    const item = stored!.candidateSet!.items[0];
    equal(item.seasonality?.month, 12, "the save boundary re-hydrates against the planned week, not the clock");
    equal(item.traits?.season, "storage");
    equal(item.seasonality?.status, "storage");
  });

  it("drops a stale pass written under another rubric and applies a persisted hold on save", async () => {
    const salad = toShelfCandidate(RECIPES.salad, { origin: "catalog", discovery: "catalog", week: WEEK }, NOW);
    const stew = toShelfCandidate(RECIPES.stew, { origin: "catalog", discovery: "catalog", week: WEEK }, NOW);
    // A persisted hold for the salad plate (current rubric/model).
    await saveCandidateReviews([record("salad", "no")]);
    const stalePass = { ...toCandidateItem({ ...salad, reason: "", assigned: false }), review: { state: "checked-pass" as const, reason: "old", contentSha256: salad.contentSha256, rubricSha256: "old-rubric", modelRequested: "old-model", interpretationVersion: "planner-review-0" } };
    const unreviewedStew = toCandidateItem({ ...stew, reason: "", assigned: false });
    const result = await saveMealPlan(planFor("2026-W50", [stalePass, unreviewedStew]), { resolveRecipe });
    ok(result.ok);
    const stored = await loadMealPlan("2026-W50");
    const byId = new Map(stored!.candidateSet!.items.map((i) => [i.recipeId, i]));
    equal(byId.get("salad")?.review?.state, "checked-hold", "the persisted hold is the authority, the stale pass is gone");
    equal(byId.get("stew")?.review?.state, "unreviewed");
  });

  it("labels unreviewed ideas provider-unavailable after a failed review run, never checked", async () => {
    await savePlannerReviewRun({ week: "2026-W51", runId: "failed-run", startedAt: NOW.toISOString(), status: "failed", usage: { calls: 2, succeeded: 0, failed: 2, deferred: 0, reused: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, overBudget: false }, detail: "HTTP 503" });
    const stew = toShelfCandidate(RECIPES.stew, { origin: "catalog", discovery: "catalog", week: "2026-W51" }, NOW);
    const result = await saveMealPlan(planFor("2026-W51", [toCandidateItem({ ...stew, reason: "", assigned: false })]), { resolveRecipe });
    ok(result.ok);
    const stored = await loadMealPlan("2026-W51");
    equal(stored!.candidateSet!.items[0].review?.state, "provider-unavailable");
  });

  it("repair 5: a record bound to the persisted source survives render QA through save and read, for a yes and then a no", async () => {
    const raw = RECIPES.bouillon;
    const checked = qaRecipeForShelf(raw, { role: "main" });
    ok(checked.ok && checked.fixes.some((f) => f.code === "stranded-unit"), "the fixture exercises the QA seam");
    const prepared = toShelfCandidate(checked.recipe, { origin: "web", discovery: "search", week: "2026-W53", contentSource: raw }, NOW);
    const source = minimizeRecipeForReview(raw);
    ok(source.ok);
    equal(prepared.contentSha256, source.contentSha256, "the shelf binding is the persisted source, as exported");
    await saveCandidateReviews([record("bouillon", "yes")]);
    const first = await saveMealPlan(planFor("2026-W53", [toCandidateItem({ ...prepared, reason: "", assigned: false })]), { resolveRecipe });
    ok(first.ok);
    equal((await loadMealPlan("2026-W53"))!.candidateSet!.items[0].review?.state, "checked-pass");
    // A later no for the same source is the authority on the next read.
    await saveCandidateReviews([record("bouillon", "no")]);
    const second = await saveMealPlan(planFor("2026-W53", [toCandidateItem({ ...prepared, reason: "", assigned: false })]), { resolveRecipe });
    ok(second.ok);
    equal((await loadMealPlan("2026-W53"))!.candidateSet!.items[0].review?.state, "checked-hold");
  });

  it("a current pass survives the round trip and carries its binding", async () => {
    await saveCandidateReviews([record("gratin", "yes")]);
    const gratin = toShelfCandidate(RECIPES.gratin, { origin: "catalog", discovery: "catalog", week: "2026-W52" }, NOW);
    const result = await saveMealPlan(planFor("2026-W52", [toCandidateItem({ ...gratin, reason: "", assigned: false })]), { resolveRecipe });
    ok(result.ok);
    const stored = await loadMealPlan("2026-W52");
    const review = stored!.candidateSet!.items[0].review!;
    equal(review.state, "checked-pass");
    equal(review.rubricSha256, PLANNER_REVIEW_RUBRIC_SHA256);
    equal(review.modelRequested, PLANNER_REVIEW_MODEL);
    equal(review.interpretationVersion, "planner-review-1");
  });
});
