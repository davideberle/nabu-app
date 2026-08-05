// Unit tests for the pure health-domain projections.
// Run with: npm test  (node --test; Node 24 strips types natively)
//
// `health.ts` carries only type-level imports, so the test runner needs no
// path-alias or DB setup. These tests pin the two Phase 2 guarantees:
// missing alcohol evidence reads as unknown (never alcohol-free), and the
// breakfast default is the doppio macchiato, not the retired flat white.

import { doesNotMatch, equal, match, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDaySnapshot,
  buildWeekSummary,
  getAlcoholDayStatus,
  getBreakfastLabel,
  resolveDinnerFromKitchen,
  type HealthDaySnapshot,
} from "./health.ts";
import type { HealthAlcoholEvent } from "./health-db.ts";
import type { CookingSession } from "./cooking.ts";
import type { MealPlan } from "./meals.ts";

function drink(date: string, drinkType = "wine"): HealthAlcoholEvent {
  return {
    id: `evt-${date}-${drinkType}`,
    date,
    drinkType,
    createdAt: `${date}T20:00:00.000Z`,
  };
}

function emptyDay(date: string): HealthDaySnapshot {
  return buildDaySnapshot(date, null, [], null, null, null);
}

describe("alcohol day status", () => {
  it("treats a day without alcohol evidence as unknown, never alcohol-free", () => {
    equal(getAlcoholDayStatus([]), "unknown");

    const snapshot = emptyDay("2026-08-03");
    equal(snapshot.alcohol.status, "unknown");
    equal(snapshot.alcohol.confidence, "missing");
  });

  it("treats a day with logged events as a confirmed alcohol day", () => {
    equal(getAlcoholDayStatus([drink("2026-08-01")]), "alcohol");

    const snapshot = buildDaySnapshot("2026-08-01", null, [drink("2026-08-01")], null, null, null);
    equal(snapshot.alcohol.status, "alcohol");
    equal(snapshot.alcohol.confidence, "logged");
  });
});

describe("week summary", () => {
  it("never counts missing alcohol data as alcohol-free days", () => {
    const days = [
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ].map(emptyDay);

    const summary = buildWeekSummary(days);
    equal(summary.alcoholFreeDays, 0);
    equal(summary.alcoholDays, 0);
    equal(summary.unknownAlcoholDays, 7);
  });

  it("separates confirmed alcohol days from unknown days", () => {
    const days = [
      buildDaySnapshot("2026-08-01", null, [drink("2026-08-01"), drink("2026-08-01", "beer")], null, null, null),
      emptyDay("2026-08-02"),
      emptyDay("2026-08-03"),
    ];

    const summary = buildWeekSummary(days);
    equal(summary.alcoholDays, 1);
    equal(summary.alcoholFreeDays, 0);
    equal(summary.unknownAlcoholDays, 2);
    equal(summary.alcoholDrinks, 2);
  });

  it("no longer exposes a manual data-completeness score", () => {
    const summary = buildWeekSummary([emptyDay("2026-08-03")]);
    ok(!("dataCompleteness" in summary));
  });
});

describe("breakfast default", () => {
  it("defaults to one doppio macchiato with oat milk as an open assumption", () => {
    const { label, confidence } = getBreakfastLabel(null);
    match(label, /doppio macchiato/i);
    match(label, /oat milk/i);
    doesNotMatch(label, /flat white/i);
    equal(confidence, "assumed");
  });

  it("keeps an explicit override as logged", () => {
    const { label, confidence } = getBreakfastLabel({
      date: "2026-08-03",
      breakfastOverride: "Birthday breakfast",
      createdAt: "2026-08-03T06:00:00.000Z",
      updatedAt: "2026-08-03T06:00:00.000Z",
    });
    equal(label, "Birthday breakfast");
    equal(confidence, "logged");
  });
});

describe("dinner resolution", () => {
  const session = {
    main: { title: "Lingcod with fennel" },
    anchor: { title: "Lingcod anchor" },
  } as unknown as CookingSession;

  const plan = {
    days: [{ date: "2026-08-03", recipeName: "Gyros night" }],
  } as unknown as MealPlan;

  it("prefers the Live Cooking session over the meal plan", () => {
    const dinner = resolveDinnerFromKitchen(session, plan, "2026-08-03");
    equal(dinner?.label, "Lingcod with fennel");
    equal(dinner?.source, "live-cooking");
  });

  it("falls back to the meal plan, then to nothing", () => {
    const fromPlan = resolveDinnerFromKitchen(null, plan, "2026-08-03");
    equal(fromPlan?.label, "Gyros night");
    equal(fromPlan?.source, "meal-plan");

    equal(resolveDinnerFromKitchen(null, null, "2026-08-03"), null);
  });
});
