// Contract tests for the Cooking Session write/read boundary.
//
// These model exactly what the routes do, in order:
//
//   POST /api/cooking/session   → validateSessionBody, then persist
//   GET  /api/cooking/session   → load, then derive the coherence review
//   GET  /api/cooking/session/:id → the same
//
// The property being pinned is the one the independent verifier found broken:
// **no body that POST accepts may make either GET fail.** Before validation,
// `anchor: "chicken"` was accepted, stored, and then made every read of that
// row throw inside `resolveMainDish` → both GETs returned 500 permanently.
//
// The route handlers themselves cannot be imported here (they resolve the `@/`
// alias and pull in the bundled recipe JSON, which a plain `node --test` run
// cannot load), so the two pure decisions the routes delegate to are composed
// in the same order the routes compose them.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSessionCoherenceSafely,
  validateSessionBody,
  type CookingSession,
} from "./cooking-session.ts";

/** No recipe lookup: components participate by title, as production allows. */
const noRecipes = async () => null;

/** A production-shaped session, as the Telegram runtime posts one. */
function productionBody(): Record<string, unknown> {
  return {
    id: "cook_2026-08-02_lamb",
    date: "2026-08-02",
    status: "active",
    source: "telegram",
    mealPlanRef: { week: "2026-W32", day: "Sunday" },
    anchor: {
      type: "kitchen-recipe",
      recipeId: "slow-roast-lamb-shoulder",
      title: "Slow-roast lamb shoulder",
      provenance: { source: "kitchen", author: "Ottolenghi" },
    },
    main: { title: "Slow-roast lamb shoulder", recipeId: "slow-roast-lamb-shoulder", setBy: "meal-plan" },
    heroImage: null,
    relatedRecipes: [
      { kind: "side", recipeId: "cg-cucumber-raita", title: "Cucumber raita" },
      { kind: "dessert", recipeId: "rhubarb-tart", title: "Rhubarb tart", status: "deferred" },
    ],
    preparationOrder: ["cg-cucumber-raita", "main"],
    serveWith: ["Flatbreads", "Riesling"],
    servings: { base: "6", current: "8" },
    ingredients: {
      base: [
        { amount: "2", item: "kg lamb shoulder" },
        { amount: "4", item: "garlic cloves, crushed" },
      ],
      session: [{ amount: "1", item: "extra lemon" }],
    },
    method: { base: ["Marinate overnight.", "Roast low for 5 hours."], session: ["Rest 30 minutes."] },
    adaptations: [
      {
        id: "adapt-1",
        kind: "guest-scaling",
        summary: "Scaled to 8 for guests",
        messageSource: "telegram",
        createdAt: "2026-08-02T09:00:00.000Z",
      },
    ],
    coachCards: { nextMove: "Preheat", upgrade: null, shortcut: null, wine: "Riesling" },
    story: { text: "A Sunday standby." },
    notes: "Kids get it unspiced.",
    createdAt: "2026-08-02T08:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
  };
}

/** Bodies a hostile or buggy caller could send. None may be persisted. */
const HOSTILE_BODIES: [string, unknown][] = [
  ["string anchor", { ...productionBody(), anchor: "chicken" }],
  ["numeric anchor", { ...productionBody(), anchor: 42 }],
  ["array anchor", { ...productionBody(), anchor: ["chicken"] }],
  ["null anchor", { ...productionBody(), anchor: null }],
  ["anchor with no title", { ...productionBody(), anchor: { type: "kitchen-recipe" } }],
  ["anchor with a blank title", { ...productionBody(), anchor: { title: "   " } }],
  ["anchor with a numeric title", { ...productionBody(), anchor: { title: 7 } }],
  ["string related recipe", { ...productionBody(), relatedRecipes: ["raita"] }],
  ["related recipe with no title", { ...productionBody(), relatedRecipes: [{ recipeId: "x" }] }],
  ["related recipe with no id", { ...productionBody(), relatedRecipes: [{ title: "Raita" }] }],
  ["string serveWith", { ...productionBody(), serveWith: "Flatbreads" }],
  ["object in serveWith", { ...productionBody(), serveWith: [{ dish: "Flatbreads" }] }],
  ["string method.base", { ...productionBody(), method: { base: "Roast it", session: [] } }],
  ["ingredient with no item", { ...productionBody(), ingredients: { base: [{ amount: "2" }], session: [] } }],
  ["string ingredients", { ...productionBody(), ingredients: "2 kg lamb" }],
  ["string coachCards", { ...productionBody(), coachCards: "none" }],
  ["adaptation with no summary", { ...productionBody(), adaptations: [{ id: "a", kind: "servings" }] }],
  ["unknown status", { ...productionBody(), status: "cooking" }],
  ["unknown source", { ...productionBody(), source: "carrier-pigeon" }],
  ["unknown component status", {
    ...productionBody(),
    relatedRecipes: [{ kind: "side", recipeId: "x", title: "X", status: "maybe" }],
  }],
  ["string preparation order", { ...productionBody(), preparationOrder: "main" }],
  ["blank preparation reference", { ...productionBody(), preparationOrder: ["main", " "] }],
  ["duplicate preparation reference", { ...productionBody(), preparationOrder: ["main", "main"] }],
  ["missing id", { ...productionBody(), id: "" }],
  ["non-date date", { ...productionBody(), date: "sometime Sunday" }],
  ["not an object", "cook_2026-08-02_lamb"],
  ["an array", [productionBody()]],
  ["null", null],
];

describe("POST accepts a production-shaped session", () => {
  it("validates and keeps every field the cook needs", () => {
    const result = validateSessionBody(productionBody());
    ok(result.ok);
    if (!result.ok) return;
    const session = result.session;
    equal(session.id, "cook_2026-08-02_lamb");
    equal(session.anchor.title, "Slow-roast lamb shoulder");
    equal(session.anchor.provenance.source, "kitchen");
    equal(session.relatedRecipes.length, 2);
    equal(session.relatedRecipes[1].status, "deferred");
    equal(session.preparationOrder?.join(","), "cg-cucumber-raita,main");
    equal(session.servings.current, "8");
    equal(session.adaptations[0].kind, "guest-scaling");
    equal(session.coachCards.wine, "Riesling");
    equal(session.notes, "Kids get it unspiced.");
  });

  it("and the stored session then reviews cleanly on both GET routes", async () => {
    const result = validateSessionBody(productionBody());
    ok(result.ok);
    if (!result.ok) return;
    const { review, error } = await resolveSessionCoherenceSafely(result.session, noRecipes);
    equal(error, null);
    ok(review);
  });
});

describe("POST rejects every hostile body", () => {
  for (const [label, body] of HOSTILE_BODIES) {
    it(`rejects ${label} with an actionable message`, () => {
      const result = validateSessionBody(body);
      equal(result.ok, false, `${label} must not be accepted`);
      if (result.ok) return;
      ok(result.error.length > 0);
    });
  }

  it("means no accepted body can break the review", async () => {
    // The invariant, stated directly: for every candidate body, either POST
    // refuses it, or the review of what POST would store succeeds.
    for (const [label, body] of [...HOSTILE_BODIES, ["valid", productionBody()] as [string, unknown]]) {
      const result = validateSessionBody(body);
      if (!result.ok) continue;
      const { error } = await resolveSessionCoherenceSafely(result.session, noRecipes);
      equal(error, null, `${label} was accepted but its review failed: ${error}`);
    }
  });
});

describe("GET degrades gracefully for a malformed historical row", () => {
  // Rows written before POST validated bodies are already in the database.
  // A read of one must report the failure, not throw — and must not pretend
  // the row is fine, because it needs repairing.
  it("reports the failure instead of throwing", async () => {
    const broken = { ...productionBody(), anchor: "chicken" } as unknown as CookingSession;
    const { review, error } = await resolveSessionCoherenceSafely(broken, noRecipes);
    equal(review, null);
    ok(error, "a malformed row must surface an error, not a silent empty review");
  });

  it("still reviews a merely sparse historical row", async () => {
    // Sparse is not malformed: an old row with no components still reviews.
    const sparse = {
      id: "cook_2025-03-01_old",
      date: "2025-03-01",
      status: "completed",
      source: "ad-hoc",
      anchor: { type: "kitchen-recipe", title: "Roast chicken", provenance: { source: "kitchen" } },
      relatedRecipes: [],
      serveWith: [],
      servings: { base: "4", current: "4" },
      ingredients: { base: [{ amount: "1", item: "chicken" }], session: [] },
      method: { base: ["Roast it."], session: [] },
      adaptations: [],
      coachCards: { nextMove: null, upgrade: null, shortcut: null, wine: null },
      notes: "",
      createdAt: "2025-03-01T00:00:00.000Z",
      updatedAt: "2025-03-01T00:00:00.000Z",
    } as unknown as CookingSession;
    const { review, error } = await resolveSessionCoherenceSafely(sparse, noRecipes);
    equal(error, null);
    ok(review);
  });
});
