// The content-bound semantic second opinion (Kitchen DESIGN.md §4.3.1).
// WP04 (no model-granted eligibility), WP05 (binding and reuse), WP06
// (minimization / negative excluded-content test), WP07 (outage ≠ pass),
// WP09 (corrections need source evidence; overrides untouched).
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual, notEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  bindReviewResult,
  buildReviewBatch,
  buildReviewQuestions,
  buildReviewRequest,
  combineEligibility,
  encodeReviewJson,
  interpretReviewAnswers,
  minimizeRecipeForReview,
  proposeTagCorrection,
  reviewMatches,
  summarizeReviewUsage,
  taxonomyConflicts,
  validateMinimizedPayload,
  validateReviewResponse,
  PLANNER_REVIEW_LIMITS,
  PLANNER_REVIEW_MODEL,
  PLANNER_REVIEW_RUBRIC_SHA256,
  type CandidateReviewRecord,
  type JevAnswer,
} from "./planner-review.ts";
import type { Recipe } from "./recipes.ts";

/** Typed answers in the shape the Decisions API returns. */
function answers(input: { main: number; role?: string; sufficient?: number; form?: string; physical?: Record<string, number> }): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {};
  for (const key of Object.keys(buildReviewQuestions())) {
    if (key.startsWith("dish_")) out[key] = { type: "noul", noul: input.physical?.[key.slice(5)] ?? 0.02 };
  }
  const role = input.role ?? (input.main >= 0.5 ? "main" : "side");
  const probabilities: Record<string, number> = { main: input.main, side: 0, starter: 0, dessert: 0, breakfast: 0, drink: 0, component: 0, snack: 0, condiment: 0, uncertain: 0 };
  if (role !== "main") probabilities[role] = Math.max(0, 1 - input.main);
  out.recipe_form = { type: "choice", choice: input.form ?? "finished_dish", confidence: 1, probabilities: { finished_dish: 1, standalone_preparation: 0, uncertain: 0 } };
  out.meal_role = { type: "choice", choice: role, confidence: probabilities[role], probabilities };
  out.content_sufficient = { type: "noul", noul: input.sufficient ?? 0.95 };
  return out;
}

function response(input: Parameters<typeof answers>[0], model = "typesafe/jev-1.13-20260917") {
  return { id: "gen-dec-test", model, provider: "TypeSafe", answers: answers(input), usage: { input_tokens: 2000, output_tokens: 300, cost: 0.0001 } };
}

function record(recipeId: string, contentSha256: string, main: number, role?: string): CandidateReviewRecord {
  const bound = bindReviewResult({
    recipeId,
    payload: { name: recipeId, servings: "serves 4", ingredients: [{ item: "a" }, { item: "b" }, { item: "c" }] },
    response: response({ main, role }),
    responseSha256: "r",
    requestSha256: buildReviewRequest({ name: recipeId, servings: "serves 4", ingredients: [{ item: "a" }, { item: "b" }, { item: "c" }] }).requestSha256,
    source: "weekly-review",
    reviewedAt: "2026-10-08T00:00:00.000Z",
  });
  if (!bound.ok) throw new Error(bound.problems.join("; "));
  return { ...bound.record, contentSha256 };
}

describe("minimization and privacy (WP06)", () => {
  it("projects only name, servings and ingredient item/amount/unit", () => {
    const recipe = {
      name: "Lentil stew",
      servings: "serves 4",
      ingredients: [{ item: "red lentils", amount: "250", unit: "g", original: "250g red lentils", group: "Base" }],
      method: ["Simmer everything."],
      intro: "David's Tuesday favourite",
      tips: "Santiago likes it with bread",
      madeHistory: [{ date: "2026-09-01", note: "too salty" }],
    } as unknown as Recipe;
    const result = minimizeRecipeForReview(recipe);
    ok(result.ok);
    deepStrictEqual(result.payload, { name: "Lentil stew", servings: "serves 4", ingredients: [{ item: "red lentils", amount: "250", unit: "g" }] });
    const encoded = encodeReviewJson(result.payload);
    ok(!encoded.includes("David") && !encoded.includes("Santiago") && !encoded.includes("salty") && !encoded.includes("Simmer"));
  });

  it("excludes content that carries private markers, URLs or first-person text rather than sending it", () => {
    const named = minimizeRecipeForReview({ name: "Claudia's soup", servings: "4", ingredients: [{ item: "leeks", amount: "2" }] } as Recipe);
    ok(!named.ok && named.reasons.some((r) => r.includes("private marker")));
    const url = minimizeRecipeForReview({ name: "Soup", servings: "4", ingredients: [{ item: "see https://example.com/soup", amount: "" }] } as Recipe);
    ok(!url.ok);
    const narrative = minimizeRecipeForReview({ name: "Soup we love", servings: "4", ingredients: [{ item: "leeks", amount: "2" }] } as Recipe);
    ok(!narrative.ok && narrative.reasons[0].startsWith("needs manual review"));
    const merged = minimizeRecipeForReview({ name: "Soup", servings: "4", ingredients: Array.from({ length: 51 }, (_, i) => ({ item: `thing ${i}`, amount: "1" })) } as Recipe);
    ok(!merged.ok && merged.reasons.some((r) => r.includes("over 50")));
  });

  it("re-validates a payload about to leave and refuses stray fields", () => {
    deepStrictEqual(validateMinimizedPayload({ name: "Soup", servings: null, ingredients: [{ item: "leeks", amount: "2" }] }), []);
    ok(validateMinimizedPayload({ name: "Soup", servings: null, ingredients: [{ item: "leeks" }], notes: "x" }).length > 0);
    ok(validateMinimizedPayload({ name: "Soup", servings: null, ingredients: [{ item: "leeks", original: "2 leeks" }] }).length > 0);
  });
});

describe("binding (WP05)", () => {
  it("reproduces the frozen Jev v2 executor request bytes for a real catalog record", () => {
    // stuffed-onions: payload and request hashes recorded by the v2 run on 2026-10-01.
    const recipe = JSON.parse(readFileSync(new URL("../data/recipes/stuffed-onions.json", import.meta.url), "utf8")) as Recipe;
    const minimized = minimizeRecipeForReview(recipe);
    ok(minimized.ok);
    equal(minimized.contentSha256, "174e7b74307dc4da7ef130b1102a9e65b7eb5d4417354fe7a71e946f107b4750", "payload_sha256 recorded by the v2 run");
    const { requestSha256, request } = buildReviewRequest(minimized.payload);
    equal(request.model, PLANNER_REVIEW_MODEL);
    equal(Object.keys(request.questions).length, 14);
    equal(PLANNER_REVIEW_RUBRIC_SHA256, "826f3fb08e94ce59508e07158755e0feca65e2965889f765418d54c9ecf68d6e");
    equal(requestSha256, "1644f57851605b26e2644826201dbf488cdedae0f60d43ea1aea81a8b8fd6633", "request_sha256 recorded by the v2 run");
  });

  it("a review is reusable only for the same id, content, rubric and model", () => {
    const review = record("soup", "c1", 0.9);
    ok(reviewMatches(review, { recipeId: "soup", contentSha256: "c1" }));
    ok(!reviewMatches(review, { recipeId: "soup", contentSha256: "c2" }), "edited content invalidates");
    ok(!reviewMatches(review, { recipeId: "stew", contentSha256: "c1" }));
    ok(!reviewMatches({ ...review, rubricSha256: "other" }, { recipeId: "soup", contentSha256: "c1" }), "rubric change invalidates");
    ok(!reviewMatches({ ...review, modelRequested: "typesafe/jev-2" }, { recipeId: "soup", contentSha256: "c1" }));
    ok(!reviewMatches(null, { recipeId: "soup", contentSha256: "c1" }));
  });

  it("refuses to bind a response to a different request, provider or model", () => {
    const payload = { name: "Soup", servings: "4", ingredients: [{ item: "leeks", amount: "2" }, { item: "potato", amount: "2" }, { item: "stock", amount: "1 l" }] };
    const { requestSha256 } = buildReviewRequest(payload);
    const wrongHash = bindReviewResult({ recipeId: "soup", payload, response: response({ main: 0.9 }), responseSha256: "r", requestSha256: "0".repeat(64), source: "weekly-review", reviewedAt: "t" });
    ok(!wrongHash.ok);
    const wrongProvider = bindReviewResult({ recipeId: "soup", payload, response: { ...response({ main: 0.9 }), provider: "Other" }, responseSha256: "r", requestSha256, source: "weekly-review", reviewedAt: "t" });
    ok(!wrongProvider.ok);
    const wrongModel = bindReviewResult({ recipeId: "soup", payload, response: response({ main: 0.9 }, "openai/gpt-x"), responseSha256: "r", requestSha256, source: "weekly-review", reviewedAt: "t" });
    ok(!wrongModel.ok);
    const missingAnswer = response({ main: 0.9 });
    delete (missingAnswer.answers as Record<string, unknown>).content_sufficient;
    ok(validateReviewResponse(missingAnswer).length > 0);
    const good = bindReviewResult({ recipeId: "soup", payload, response: response({ main: 0.9 }), responseSha256: "r", requestSha256, source: "weekly-review", reviewedAt: "t" });
    ok(good.ok && good.record.modelResolved === "typesafe/jev-1.13-20260917");
  });
});

describe("interpretation", () => {
  it("yes needs a confident main; no needs a confident other role; the rest is uncertain", () => {
    equal(interpretReviewAnswers(answers({ main: 0.9 })).verdict, "yes");
    equal(interpretReviewAnswers(answers({ main: 0.05, role: "condiment" })).verdict, "no");
    equal(interpretReviewAnswers(answers({ main: 0.28, role: "starter" })).verdict, "uncertain");
    equal(interpretReviewAnswers(answers({ main: 0.55 })).verdict, "uncertain", "between thresholds");
    equal(interpretReviewAnswers(answers({ main: 0.9, sufficient: 0.3 })).verdict, "uncertain", "insufficient content never passes");
    equal(interpretReviewAnswers(answers({ main: 0.05, role: "component", form: "standalone_preparation" })).verdict, "no");
    equal(interpretReviewAnswers(answers({ main: 0.9, form: "uncertain" })).verdict, "uncertain");
  });
});

describe("combination with the deterministic gates (WP04, WP07)", () => {
  it("a positive opinion cannot grant eligibility to a side, condiment or incomplete record", () => {
    for (const reason of ["declared side", "declared condiment", "not enough recipe structure"]) {
      const decision = combineEligibility({ deterministicMainEligible: false, deterministicReasons: [reason], availability: { kind: "record", record: record("x", "c", 0.99) } });
      equal(decision.eligible, false, reason);
      equal(decision.review.state, "checked-pass", "the opinion is recorded honestly, it just decides nothing");
      ok(decision.reasons.some((r) => r.includes("cannot grant")));
    }
  });

  it("a clear negative opinion holds a deterministic pass, reviewably", () => {
    const decision = combineEligibility({ deterministicMainEligible: true, availability: { kind: "record", record: record("raita", "c", 0.03, "condiment") } });
    equal(decision.eligible, false);
    equal(decision.review.state, "checked-hold");
  });

  it("uncertainty, no review, a privacy exclusion and an outage are four distinct non-pass states", () => {
    const uncertain = combineEligibility({ deterministicMainEligible: true, availability: { kind: "record", record: record("salad", "c", 0.28, "starter") } });
    equal(uncertain.review.state, "uncertain");
    equal(uncertain.eligible, true, "the deterministic answer stays in force");
    const none = combineEligibility({ deterministicMainEligible: true, availability: { kind: "none" } });
    equal(none.review.state, "unreviewed");
    const excluded = combineEligibility({ deterministicMainEligible: true, availability: { kind: "excluded", reason: "private marker" } });
    equal(excluded.review.state, "excluded-private");
    const outage = combineEligibility({ deterministicMainEligible: true, availability: { kind: "provider-unavailable", reason: "HTTP 503" } });
    equal(outage.review.state, "provider-unavailable");
    equal(outage.eligible, true, "an outage keeps a valid shelf; it does not grant or remove a pass");
    notEqual(outage.review.state, "checked-pass");
  });
});

describe("batch assembly and budgets (WP05, WP06, WP07)", () => {
  const web = (id: string): Parameters<typeof buildReviewBatch>[0]["candidates"][number] => ({
    recipeId: id,
    origin: "web",
    recipe: { name: `Web ${id}`, servings: "4", ingredients: [{ item: "leeks", amount: "2" }, { item: "potato", amount: "2" }, { item: "stock", amount: "1 l" }] },
  });

  it("sends screened web imports, reuses bound results, never auto-sends unreviewed catalog content", () => {
    const existing = new Map<string, CandidateReviewRecord>();
    const reusable = web("reused");
    const minimized = minimizeRecipeForReview(reusable.recipe);
    ok(minimized.ok);
    existing.set(`reused:${minimized.contentSha256}`, record("reused", minimized.contentSha256, 0.9));
    const batch = buildReviewBatch({
      week: "2026-W42",
      candidates: [
        web("fresh-1"),
        reusable,
        { recipeId: "cookbook", origin: "catalog", recipe: { name: "Book stew", servings: "4", ingredients: [{ item: "beans", amount: "400 g" }] } },
        { recipeId: "private", origin: "web", recipe: { name: "David's stew", servings: "4", ingredients: [{ item: "beans", amount: "400 g" }] } },
      ],
      existing: (id, sha) => existing.get(`${id}:${sha}`) ?? null,
    });
    deepStrictEqual(batch.items.map((item) => item.recipeId), ["fresh-1"]);
    deepStrictEqual(batch.reused.map((item) => item.recipeId), ["reused"]);
    deepStrictEqual(batch.needsOwnerReview.map((item) => item.recipeId), ["cookbook"]);
    deepStrictEqual(batch.excluded.map((item) => item.recipeId), ["private"]);
    equal(batch.model, PLANNER_REVIEW_MODEL);
    equal(batch.endpoint, "https://openrouter.ai/api/alpha/decisions");
    const wire = encodeReviewJson(batch.items[0].request);
    ok(!wire.includes("David"), "excluded content never reaches the wire");
    equal(batch.items[0].requestSha256, buildReviewRequest(batch.items[0].payload).requestSha256);
  });

  it("applies the call budget and records what was deferred", () => {
    const batch = buildReviewBatch({ week: "w", candidates: Array.from({ length: 5 }, (_, i) => web(`w${i}`)), existing: () => null, limits: { maxCallsPerRun: 3 } });
    equal(batch.items.length, 3);
    equal(batch.deferred.length, 2);
  });

  it("usage is inspectable and over-budget is a named condition", () => {
    const records = [record("a", "c", 0.9), record("b", "c", 0.9)];
    const usage = summarizeReviewUsage({ records, failed: 1, reused: 4 });
    equal(usage.calls, 3);
    equal(usage.reused, 4);
    ok(Math.abs(usage.costUsd - 0.0002) < 1e-9);
    equal(usage.overBudget, false);
    equal(summarizeReviewUsage({ records, failed: PLANNER_REVIEW_LIMITS.maxCallsPerRun, reused: 0 }).overBudget, true);
  });
});

describe("tag corrections (WP09)", () => {
  const raita = { id: "cg-cucumber-raita", category: { dish_type: ["condiment"], chapter: "Accompaniments", meal_role: "condiment" } } as unknown as Recipe;
  const stampedMain = { id: "green-chutney", category: { dish_type: ["main"], meal_role: "main" } } as unknown as Recipe;
  const condimentOpinion = interpretReviewAnswers(answers({ main: 0.03, role: "condiment", physical: { condiment: 0.95 } }));

  it("a model disagreement becomes a proposal, never a write", () => {
    const conflicts = taxonomyConflicts(stampedMain, condimentOpinion);
    ok(conflicts.some((c) => c.field === "meal_role" && c.model === "condiment"));
    ok(conflicts.some((c) => c.field === "dish_type" && c.model === "condiment"));
    ok(conflicts.every((c) => c.requires === "independent-source-evidence"));
    const held = proposeTagCorrection({ recipe: stampedMain, recordSha256: "h1", conflict: conflicts[0], evidence: null, protectedIds: new Set() });
    ok(!held.ok && held.held);
  });

  it("stale or incomplete evidence is held; current source evidence yields a reversible proposal", () => {
    const conflict = taxonomyConflicts(stampedMain, condimentOpinion)[0];
    const evidence = { owner: "projects/kitchen", recordSha256: "h1", pointer: "p. 212, serving line", quote: "Serve a spoonful alongside grilled meats.", reviewer: "Nabu", reviewedAt: "2026-10-08" };
    const stale = proposeTagCorrection({ recipe: stampedMain, recordSha256: "h2", conflict, evidence, protectedIds: new Set() });
    ok(!stale.ok);
    const incomplete = proposeTagCorrection({ recipe: stampedMain, recordSha256: "h1", conflict, evidence: { ...evidence, quote: " " }, protectedIds: new Set() });
    ok(!incomplete.ok);
    const proposal = proposeTagCorrection({ recipe: stampedMain, recordSha256: "h1", conflict, evidence, protectedIds: new Set() });
    ok(proposal.ok);
    deepStrictEqual(proposal.proposal.before, ["main"]);
    deepStrictEqual(proposal.proposal.after, ["condiment"]);
    deepStrictEqual(proposal.proposal.reversible.restore, { field: "meal_role", value: ["main"] });
  });

  it("cg-cucumber-raita and other saved overrides are never touched", () => {
    const conflict = { field: "meal_role" as const, stored: ["condiment"], model: "side", probability: 0.9, requires: "independent-source-evidence" as const };
    const evidence = { owner: "projects/kitchen", recordSha256: "h1", pointer: "p. 1", quote: "x", reviewer: "Nabu", reviewedAt: "2026-10-08" };
    const outcome = proposeTagCorrection({ recipe: raita, recordSha256: "h1", conflict, evidence, protectedIds: new Set(["cg-cucumber-raita"]) });
    ok(!outcome.ok && outcome.reason.includes("override"));
  });
});
