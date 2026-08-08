// The Kitchen-owned source registry and the weekly discovery plan.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLANNER_SOURCES,
  automaticSources,
  buildDiscoveryPlan,
  findSourceById,
  findSourceByUrl,
  isAutomaticallyTrustedUrl,
  resolveSurfaceUrl,
  sourcesForTier,
  visibleCapForSource,
  DEFAULT_VISIBLE_CAP,
  SHELF_TARGET,
  WEB_TARGET,
} from "./planner-sources.ts";

// A fixed date so month-templated surfaces and seasonal tiers are deterministic.
const AUGUST = new Date("2026-08-08T05:30:00.000Z"); // summer
const JANUARY = new Date("2026-01-14T05:30:00.000Z"); // winter

describe("source registry shape", () => {
  it("is one registry with no duplicate ids or hosts", () => {
    const ids = new Set(PLANNER_SOURCES.map((s) => s.id));
    const hosts = new Set(PLANNER_SOURCES.map((s) => s.host));
    equal(ids.size, PLANNER_SOURCES.length);
    equal(hosts.size, PLANNER_SOURCES.length);
  });

  it("names every audited tier", () => {
    ok(sourcesForTier("A").length >= 6, "tier A holds the editorial sources");
    ok(sourcesForTier("B").length >= 2);
    ok(sourcesForTier("C").length >= 4);
    deepStrictEqual(
      sourcesForTier("manual").map((s) => s.id),
      ["chefkoch"],
      "Chefkoch is the manual-only source",
    );
  });

  it("keeps manual-only sources out of automatic discovery", () => {
    ok(!automaticSources().some((s) => s.id === "chefkoch"));
    equal(isAutomaticallyTrustedUrl("https://www.chefkoch.de/rezepte/123/x.html"), false);
  });

  it("orders automatic sources A before B before C", () => {
    const tiers = automaticSources().map((s) => s.tier);
    const rank = { A: 0, B: 1, C: 2, manual: 3 } as const;
    for (let i = 1; i < tiers.length; i++) {
      ok(rank[tiers[i]] >= rank[tiers[i - 1]], `${tiers[i - 1]} must not follow ${tiers[i]}`);
    }
  });
});

describe("visible caps", () => {
  it("caps FOOBY at three visible ideas", () => {
    equal(findSourceById("fooby")?.visibleCap, 3);
    equal(visibleCapForSource("FOOBY"), 3);
    equal(visibleCapForSource("fooby.ch"), 3);
    equal(visibleCapForSource("FOOBY · Web inspiration"), 3);
  });

  it("caps a normal non-FOOBY source at two and The Greek Foodie at one", () => {
    equal(visibleCapForSource("Cookie and Kate"), 2);
    equal(visibleCapForSource("The Greek Foodie"), 1);
  });

  it("falls back to the default cap for an unrecognized publication", () => {
    equal(visibleCapForSource("Some Random Blog"), DEFAULT_VISIBLE_CAP);
    equal(visibleCapForSource(null), DEFAULT_VISIBLE_CAP);
  });

  it("no source may fill the shelf on its own", () => {
    for (const source of PLANNER_SOURCES) {
      ok(source.visibleCap < WEB_TARGET.min, `${source.id} cap must stay below the web target`);
      ok(source.visibleCap < SHELF_TARGET.min);
    }
  });
});

describe("url resolution", () => {
  it("resolves www and bare hosts to the same source", () => {
    equal(findSourceByUrl("https://fooby.ch/en/recipes/29338/x")?.id, "fooby");
    equal(findSourceByUrl("https://www.fooby.ch/en/recipes/29338/x")?.id, "fooby");
    equal(findSourceByUrl("https://cookieandkate.com/thing/")?.id, "cookie-and-kate");
    equal(findSourceByUrl("https://www.cookieandkate.com/thing/")?.id, "cookie-and-kate");
  });

  it("refuses an unknown host and malformed input", () => {
    equal(findSourceByUrl("https://example.com/recipe"), undefined);
    equal(findSourceByUrl("not a url"), undefined);
  });
});

describe("discovery plan", () => {
  it("checks editorial surfaces first and issues no search step by default", () => {
    const plan = buildDiscoveryPlan({ now: AUGUST });
    ok(plan.length > 0);
    ok(
      plan.every((step) => step.mode === "editorial"),
      "with no named lane gap, discovery is purely editorial",
    );
  });

  it("reads every tier-A editorial surface before any tier-B surface", () => {
    const plan = buildDiscoveryPlan({ now: AUGUST });
    const lastA = plan.map((s) => s.source.tier).lastIndexOf("A");
    const firstB = plan.map((s) => s.source.tier).indexOf("B");
    ok(firstB === -1 || firstB > lastA, "tier B must follow tier A");
  });

  it("starts with FOOBY's weekly editorial surface", () => {
    const first = buildDiscoveryPlan({ now: AUGUST })[0];
    equal(first.source.id, "fooby");
    equal(first.surface?.marker, "Inspiration for this week");
  });

  it("does not send one generic query to every source", () => {
    const plan = buildDiscoveryPlan({ now: AUGUST, laneGaps: ["indian"] });
    const searched = plan.filter((step) => step.mode === "search").map((step) => step.source.id);
    ok(searched.length > 0, "a named gap opens targeted search");
    ok(
      searched.every((id) => findSourceById(id)?.lane === "indian"),
      "only sources in the gap lane are queried",
    );
    ok(searched.length < automaticSources().length, "not every source is queried");
  });

  it("opens tier C only against a concrete lane gap", () => {
    const noGap = buildDiscoveryPlan({ now: AUGUST });
    ok(!noGap.some((step) => step.source.tier === "C"));

    const withGap = buildDiscoveryPlan({ now: AUGUST, laneGaps: ["asian-vegan"] });
    ok(withGap.some((step) => step.source.tier === "C" && step.mode === "search"));
  });

  it("skips an out-of-season tier-B source", () => {
    const summer = buildDiscoveryPlan({ now: AUGUST }).map((s) => s.source.id);
    const winter = buildDiscoveryPlan({ now: JANUARY }).map((s) => s.source.id);
    ok(summer.includes("the-greek-foodie"), "Mediterranean lane is seasonally relevant in August");
    ok(!winter.includes("the-greek-foodie"), "and is skipped in January");
  });

  it("reaches a manual-only source only when explicitly requested", () => {
    ok(!buildDiscoveryPlan({ now: AUGUST }).some((s) => s.source.id === "chefkoch"));
    const requested = buildDiscoveryPlan({ now: AUGUST, includeManualSourceIds: ["chefkoch"] });
    const step = requested.find((s) => s.source.id === "chefkoch");
    ok(step, "an explicit request reaches Chefkoch");
    equal(step?.mode, "search");
  });

  it("resolves month placeholders in editorial surface urls", () => {
    const kate = findSourceById("cookie-and-kate");
    ok(kate);
    equal(
      resolveSurfaceUrl(kate.editorialSurfaces[0], AUGUST),
      "https://cookieandkate.com/what-to-cook-this-august/",
    );
    equal(
      resolveSurfaceUrl(kate.editorialSurfaces[0], JANUARY),
      "https://cookieandkate.com/what-to-cook-this-january/",
    );
  });

  it("gives every planned editorial step a concrete url", () => {
    for (const step of buildDiscoveryPlan({ now: AUGUST })) {
      if (step.mode !== "editorial") continue;
      ok(step.url?.startsWith("https://"), `${step.source.id} needs a resolved surface url`);
      ok(!step.url?.includes("{"), "no unresolved placeholder may reach the fetcher");
    }
  });
});
