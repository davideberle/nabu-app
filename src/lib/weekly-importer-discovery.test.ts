// The scheduled importer's discovery and gates, offline (Kitchen DESIGN.md
// §4.3.1). WP03: a zero-yield FOOBY editorial surface invokes the targeted
// FOOBY fallback exactly once; weak, duplicate and non-main pages cannot
// survive the gates; per-source stage counts explain every zero. Also the
// September 25 discovery-budget repair, retained on the release base.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
// The importer is plain ESM; it is loaded directly so the test exercises the
// exact file the Thursday job runs.
import {
  AUTOMATIC_SOURCES,
  SourceStages,
  discoverCandidates,
  extractRecipeFromHtml,
  isProbablyRecipeUrl,
  iterateDiscoveryCandidates,
  queryForLane,
  toCompanionRecipe,
} from "../../scripts/weekly-inspirations.mjs";
import { classifyPlannerRole } from "./planner-roles.ts";
import { buildDiscoveryPlan, findSourceById } from "./planner-sources.ts";
import type { Recipe } from "./recipes.ts";

const NOW = new Date("2026-10-08T05:30:00.000Z"); // a Thursday in October
type Source = (typeof AUTOMATIC_SOURCES)[number];
const byId = (id: string): Source => AUTOMATIC_SOURCES.find((s: Source) => s.id === id)!;

describe("registry: the FOOBY dead end is closed", () => {
  it("a zero-yield tier-A source with a registry fallback gets exactly one targeted step, others none", () => {
    const steps = buildDiscoveryPlan({ now: NOW, zeroYieldSourceIds: ["fooby", "bbc-good-food"] });
    const fallbacks = steps.filter((step) => step.mode === "targeted-fallback");
    deepStrictEqual(fallbacks.map((step) => step.source.id), ["fooby"]);
    ok(!steps.some((step) => step.mode === "search"), "no lane search without a named gap");
    ok(findSourceById("fooby")?.targetedFallback);
    equal(findSourceById("fooby")?.targetedFallback?.target.max, 3);
    equal(findSourceById("bbc-good-food")?.targetedFallback, undefined);
  });

  it("without the zero-yield signal the plan is unchanged: tier-A editorial sources never search", () => {
    const steps = buildDiscoveryPlan({ now: NOW, laneGaps: ["swiss-seasonal"] });
    ok(!steps.some((step) => step.source.id === "fooby" && step.mode !== "editorial"));
  });
});

describe("discovery: zero-yield FOOBY editorial fixture (WP03)", () => {
  it("invokes the FOOBY targeted fallback once with a seasonal query and records the stages", async () => {
    const searches: { source: string; query: string; limit: number }[] = [];
    const stages = new SourceStages();
    const candidates = await discoverCandidates("fall vegetarian dinner recipe", 24, {
      now: NOW,
      stages,
      sources: [byId("fooby"), byId("cookie-and-kate")],
      readEditorial: async (_step: unknown, source: Source) =>
        source.id === "fooby"
          ? [{ url: "https://fooby.ch/en/recipes.html" }, { url: "https://fooby.ch/en/recipes/12345/old-known.html" }]
          : [{ url: "https://cookieandkate.com/pumpkin-chili-recipe/" }],
      knownSourceUrls: new Set(["https://fooby.ch/en/recipes/12345/old-known.html"]),
      search: async (source: Source, query: string, limit: number) => {
        searches.push({ source: source.id, query, limit });
        return [
          { url: "https://fooby.ch/en/recipes/20001/squash-gratin.html" },
          { url: "https://fooby.ch/en/recipes/20002/kale-rosti.html" },
          { url: "https://little.fooby.ch/en/recipes/20003/kids.html" },
        ];
      },
      eligibleLanes: () => new Set(),
      eligibleSources: () => new Set(),
    });
    deepStrictEqual(searches.map((s) => [s.source, s.query]), [["fooby", "squash"]], "one FOOBY fallback, seasonal query, no fan-out");
    const fooby = candidates.filter((c: { source: Source }) => c.source.id === "fooby").map((c: { url: string }) => c.url);
    deepStrictEqual(fooby, ["https://fooby.ch/en/recipes/20001/squash-gratin.html", "https://fooby.ch/en/recipes/20002/kale-rosti.html"]);
    const report = stages.report();
    const stage = report.find((s: { sourceId: string }) => s.sourceId === "fooby")!;
    equal(stage.editorialSurfaces, 1);
    equal(stage.editorialLinks, 2, "the navigation page and the known URL were both offered");
    equal(stage.usableLinks, 0, "neither was usable: that is the recorded zero");
    equal(stage.fallbackSearched, true);
    equal(stage.fallbackLinks, 2);
    equal(stage.zeroYield, true, "no main has survived yet; selection happens in the import loop");
  });

  it("does not fall back for a source whose editorial surface already yielded a qualified main", async () => {
    const searches: string[] = [];
    const covered = new Set<string>();
    const coveredLanes = new Set<string>();
    for await (const candidate of iterateDiscoveryCandidates("fall vegetarian dinner recipe", 12, {
      now: NOW,
      sources: [byId("fooby")],
      readEditorial: async () => [{ url: "https://fooby.ch/en/recipes/30001/pumpkin-soup.html" }],
      search: async (source: Source) => {
        searches.push(source.id);
        return [];
      },
      eligibleLanes: () => coveredLanes,
      eligibleSources: () => covered,
    })) {
      // The import loop would have qualified this one; feed the signal back.
      covered.add((candidate as { source: Source }).source.id);
      coveredLanes.add((candidate as { source: Source }).source.lane);
    }
    deepStrictEqual(searches, [], "a qualified editorial main means no fallback call");
  });

  it("keeps the September 25 budget repair: known and navigation links never consume the queue", async () => {
    const known = new Set(Array.from({ length: 200 }, (_, i) => `https://cookieandkate.com/known-${i}`));
    const candidates = await discoverCandidates("fall dinner", 12, {
      now: NOW,
      sources: [byId("cookie-and-kate")],
      knownSourceUrls: known,
      readEditorial: async () => [
        ...Array.from({ length: 200 }, (_, i) => ({ url: `https://cookieandkate.com/known-${i}/` })),
        ...Array.from({ length: 200 }, (_, i) => ({ url: `https://cookieandkate.com/category/${i}/` })),
        { url: "https://cookieandkate.com/fresh-squash-dinner/" },
      ],
      search: async () => {
        throw new Error("editorial-only source must not get a generic search");
      },
    });
    deepStrictEqual(candidates.map((c: { url: string }) => c.url), ["https://cookieandkate.com/fresh-squash-dinner/"]);
    equal(queryForLane("swiss-seasonal", "fall vegetarian dinner recipe"), "squash");
    equal(queryForLane("swiss-seasonal", "pumpkin curry"), "pumpkin curry", "explicit requests pass through");
  });

  it("URL hygiene rejects FOOBY navigation and kids pages but keeps recipe pages", () => {
    for (const url of ["https://fooby.ch/en/recipes.html", "https://fooby.ch/en.html", "https://little.fooby.ch/en/recipes/1/kids.html", "http://fooby.ch/en/recipes/1/x.html"]) {
      equal(isProbablyRecipeUrl(url), false, url);
    }
    equal(isProbablyRecipeUrl("https://fooby.ch/en/recipes/12345/squash-curry.html"), true);
  });
});

describe("gates: weak, duplicate and non-main pages cannot become mains (WP03, WP04)", () => {
  const fooby = byId("fooby");
  const page = (ld: Record<string, unknown>) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", ...ld })}</script>`;
  const stored = (ld: Record<string, unknown>, slug = "fixture"): Recipe => {
    const extracted = extractRecipeFromHtml(page(ld), `https://fooby.ch/en/recipes/1/${slug}.html`, fooby);
    ok(extracted, "fixture must extract");
    return toCompanionRecipe(extracted, { slug, week: "2026-W42", image: "https://example.test/p.jpg" }) as Recipe;
  };
  const base = {
    recipeIngredient: ["800 g pumpkin", "200 g kale", "1 onion", "200 ml cream"],
    recipeInstructions: ["Roast the pumpkin with the onion.", "Wilt the kale, fold in the cream and bake."],
    recipeYield: "4 servings",
    totalTime: "PT45M",
  };

  it("a side, a condiment and an incomplete method are refused regardless of any opinion", () => {
    equal(classifyPlannerRole(stored({ ...base, name: "Pumpkin wedges", recipeCategory: "Side dish" })).role, "pairing");
    equal(classifyPlannerRole(stored({ ...base, name: "Pumpkin seed pesto", recipeCategory: "Sauce" })).role, "reject");
    // An incomplete page (one ingredient, one bare step) never reaches the role
    // gate: the structural extractor refuses it first.
    equal(extractRecipeFromHtml(page({ ...base, name: "Pumpkin and kale gratin", recipeInstructions: ["Bake."], recipeIngredient: ["pumpkin"] }), "https://fooby.ch/en/recipes/1/thin.html", fooby), null);
    // A declared main with no protein/starch anchor is a substantial light meal: still dinner-eligible, honestly labelled.
    const gratin = classifyPlannerRole(stored({ ...base, name: "Pumpkin and kale gratin", recipeCategory: "Main course" }));
    ok(gratin.mainEligible && (gratin.role === "main" || gratin.role === "light-meal"), gratin.role);
  });

  it("an extraction without usable structure is refused before any role check", () => {
    equal(extractRecipeFromHtml("<html><body>no recipe here</body></html>", "https://fooby.ch/en/recipes/1/x.html", fooby), null);
  });
});
