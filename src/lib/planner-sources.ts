/**
 * Canonical web-discovery source registry — Companion App projection.
 *
 * SYNCHRONIZED PROJECTION. The policy is Kitchen-owned and lives in
 * `projects/kitchen/web-inspiration/source-registry.json`. This module is the
 * deployable copy (Vercel does not have the kitchen project checked out) and is
 * verified against the canonical file by `scripts/check-source-registry.mjs`.
 * Change the Kitchen file first, then re-sync here.
 *
 * This registry replaces the two rosters that used to disagree: the runtime
 * allowlist inside `scripts/weekly-inspirations.mjs` and the human preference
 * note in `kitchen/recipe-sources.json`. It is a trust boundary *and* a
 * discovery plan: tier, editorial surface, cadence, extraction strategy, lane,
 * and visible cap.
 *
 * Dependency-free on purpose: `scripts/weekly-inspirations.mjs` and
 * `node --test` both load this file directly (Node strips the types), so it
 * must not import the `@/` alias, the recipe bundle, or any runtime module.
 */

export type SourceTier = "A" | "B" | "C" | "manual";

export type EditorialSurface = {
  kind: "homepage-section" | "collection";
  /** May contain `{monthLower}`, `{month}` or `{year}` placeholders. */
  url: string;
  /** Text marker that anchors the editorial section inside the page. */
  marker?: string;
  /** Regex source: links must match to count as recipe links from this surface. */
  linkPattern?: string;
};

export type PlannerSource = {
  id: string;
  name: string;
  host: string;
  tier: SourceTier;
  lane: string;
  cuisine: string;
  cadence: "weekly" | "monthly" | "seasonal" | "targeted" | "manual";
  /** Ceiling on how many of this source's ideas may be visible. Never a quota. */
  visibleCap: number;
  /** False for manual-only sources: automatic weekly discovery must skip them. */
  automatic: boolean;
  seasons?: readonly ("spring" | "summer" | "fall" | "winter")[];
  editorialSurfaces: readonly EditorialSurface[];
  searchStrategy: "fooby-json" | "wordpress" | "homepage-search";
  extraction: { primary: "json-ld"; fallback?: "fooby-embedded-json" };
  notes: string;
};

export const SOURCE_REGISTRY_VERSION = "kitchen-sources-1";

/** Combined shelf size the weekly preparation aims for. */
export const SHELF_TARGET = { min: 12, max: 14 } as const;
/** How many qualified web ideas normally survive into the shelf. */
export const WEB_TARGET = { min: 5, max: 7 } as const;
/** Cap applied to a source the registry does not name. */
export const DEFAULT_VISIBLE_CAP = 2;

export const PLANNER_SOURCES: readonly PlannerSource[] = [
  {
    id: "fooby",
    name: "FOOBY",
    host: "fooby.ch",
    tier: "A",
    lane: "swiss-seasonal",
    cuisine: "Swiss",
    cadence: "weekly",
    visibleCap: 3,
    automatic: true,
    editorialSurfaces: [
      {
        kind: "homepage-section",
        url: "https://fooby.ch/en.html",
        marker: "Inspiration for this week",
        linkPattern: "/en/recipes/\\d+/",
      },
    ],
    searchStrategy: "fooby-json",
    extraction: { primary: "json-ld", fallback: "fooby-embedded-json" },
    notes:
      "Swiss/seasonal anchor. Featured pages regularly ship Recipe JSON-LD with one collapsed instruction step, which structured extraction rejects; the source-specific fallback reads the page's own embedded recipeJSON. Cap is a ceiling, never a quota.",
  },
  {
    id: "serious-eats",
    name: "Serious Eats",
    host: "www.seriouseats.com",
    tier: "A",
    lane: "global-technique",
    cuisine: "Global",
    cadence: "monthly",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [
      {
        kind: "collection",
        url: "https://www.seriouseats.com/what-our-editors-are-excited-to-cook-this-month-11759483",
        linkPattern: "-recipe-\\d+|-\\d{7,}$",
      },
    ],
    searchStrategy: "homepage-search",
    extraction: { primary: "json-ld" },
    notes:
      "Import recipe pages only, never the collection page itself. Direct fetch can be blocked; a failed surface reduces yield rather than failing the run.",
  },
  {
    id: "love-and-lemons",
    name: "Love & Lemons",
    host: "www.loveandlemons.com",
    tier: "A",
    lane: "modern-vegetarian",
    cuisine: "Modern Vegetarian",
    cadence: "monthly",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [{ kind: "collection", url: "https://www.loveandlemons.com/cooking-club/" }],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes: "One explicitly selected seasonal vegetarian recipe per month. Shares the modern-vegetarian lane with Cookie and Kate.",
  },
  {
    id: "cookie-and-kate",
    name: "Cookie and Kate",
    host: "cookieandkate.com",
    tier: "A",
    lane: "modern-vegetarian",
    cuisine: "Modern Vegetarian",
    cadence: "monthly",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [{ kind: "collection", url: "https://cookieandkate.com/what-to-cook-this-{monthLower}/" }],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes:
      "Produce-led vegetarian shortlist. The page deliberately mixes mains, sides, drinks and desserts, so meal-role classification is mandatory on every link.",
  },
  {
    id: "bbc-good-food",
    name: "BBC Good Food",
    host: "www.bbcgoodfood.com",
    tier: "A",
    lane: "european-seasonal",
    cuisine: "European",
    cadence: "monthly",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [
      { kind: "collection", url: "https://www.bbcgoodfood.com/recipes/collection/{monthLower}-recipes", linkPattern: "/recipes/" },
      { kind: "collection", url: "https://www.bbcgoodfood.com/seasonal-calendar/all", linkPattern: "/recipes/" },
    ],
    searchStrategy: "homepage-search",
    extraction: { primary: "json-ld" },
    notes: "Retain only direct recipe pages from the collection adapter.",
  },
  {
    id: "essen-und-trinken",
    name: "Essen & Trinken",
    host: "www.essen-und-trinken.de",
    tier: "A",
    lane: "german-seasonal",
    cuisine: "German",
    cadence: "monthly",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [{ kind: "collection", url: "https://www.essen-und-trinken.de/rezepte/saisonal", linkPattern: "/rezepte/" }],
    searchStrategy: "homepage-search",
    extraction: { primary: "json-ld" },
    notes: "German/European seasonality. Preferred over community databases for the local seasonal lane.",
  },
  {
    id: "the-greek-foodie",
    name: "The Greek Foodie",
    host: "thegreekfoodie.com",
    tier: "B",
    lane: "mediterranean",
    cuisine: "Greek",
    cadence: "seasonal",
    visibleCap: 1,
    automatic: true,
    seasons: ["spring", "summer"],
    editorialSurfaces: [{ kind: "collection", url: "https://thegreekfoodie.com/category/summer/" }],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes: "Mediterranean lane. Maximum one visible idea unless explicitly requested.",
  },
  {
    id: "forks-over-knives",
    name: "Forks Over Knives",
    host: "www.forksoverknives.com",
    tier: "B",
    lane: "plant-health",
    cuisine: "Plant-Based",
    cadence: "seasonal",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [{ kind: "collection", url: "https://www.forksoverknives.com/recipes/", linkPattern: "/recipes/" }],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes: "Reject how-to, success-story, dessert and collection pages after discovery.",
  },
  {
    id: "ministry-of-curry",
    name: "Ministry of Curry",
    host: "ministryofcurry.com",
    tier: "C",
    lane: "indian",
    cuisine: "Indian",
    cadence: "targeted",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes: "No verified recurring editor-pick series. Shares one Indian lane with Indian Healthy Recipes.",
  },
  {
    id: "the-foodie-takes-flight",
    name: "The Foodie Takes Flight",
    host: "thefoodietakesflight.com",
    tier: "C",
    lane: "asian-vegan",
    cuisine: "Asian Vegan",
    cadence: "targeted",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes: "Useful for a missing quick/vegan/Asian lane. Do not add another noodle/rice dish when the week already has one.",
  },
  {
    id: "indian-healthy-recipes",
    name: "Indian Healthy Recipes",
    host: "www.indianhealthyrecipes.com",
    tier: "C",
    lane: "indian",
    cuisine: "Indian",
    cadence: "targeted",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes: "Broad database, not a curated series. The main gate must exclude drinks, sweets, breakfasts and components.",
  },
  {
    id: "kitchen-stories",
    name: "Kitchen Stories",
    host: "www.kitchenstories.com",
    tier: "C",
    lane: "global-technique",
    cuisine: "Modern European",
    cadence: "targeted",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [],
    searchStrategy: "homepage-search",
    extraction: { primary: "json-ld" },
    notes: "No reliably current recurring surface was verified. Do not treat old story dates as current picks.",
  },
  {
    id: "leites-culinaria",
    name: "Leite's Culinaria",
    host: "leitesculinaria.com",
    tier: "C",
    lane: "european-seasonal",
    cuisine: "European",
    cadence: "targeted",
    visibleCap: 2,
    automatic: true,
    editorialSurfaces: [],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes:
      "Professionally tested, but surfaced late-summer collections are old or have broken collection URLs. Recipe-page fallback only until a current stable editorial feed is verified.",
  },
  {
    id: "crumb-snatched",
    name: "Crumb-Snatched",
    host: "www.crumbsnatched.com",
    tier: "C",
    lane: "heritage-technique",
    cuisine: "Portuguese",
    cadence: "targeted",
    visibleCap: 1,
    automatic: true,
    editorialSurfaces: [],
    searchStrategy: "wordpress",
    extraction: { primary: "json-ld" },
    notes: "Use for an explicit cuisine/heritage gap, not weekly automatic discovery.",
  },
  {
    id: "chefkoch",
    name: "Chefkoch",
    host: "www.chefkoch.de",
    tier: "manual",
    lane: "community",
    cuisine: "German",
    cadence: "manual",
    visibleCap: 1,
    automatic: false,
    editorialSurfaces: [],
    searchStrategy: "homepage-search",
    extraction: { primary: "json-ld" },
    notes:
      "High volume, variable authorship and testing. Excluded from automatic imports; usable only when David explicitly asks for community ideas.",
  },
];

const TIER_RANK: Record<SourceTier, number> = { A: 0, B: 1, C: 2, manual: 3 };

/** Sources allowed in automatic weekly discovery, ordered A → B → C. */
export function automaticSources(): PlannerSource[] {
  return PLANNER_SOURCES.filter((source) => source.automatic).sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.id.localeCompare(b.id),
  );
}

export function sourcesForTier(tier: SourceTier): PlannerSource[] {
  return PLANNER_SOURCES.filter((source) => source.tier === tier);
}

export function findSourceById(id: string): PlannerSource | undefined {
  return PLANNER_SOURCES.find((source) => source.id === id);
}

/** Resolve a URL's host to a registry source. `m.`/`www.` variants included. */
export function findSourceByUrl(url: string): PlannerSource | undefined {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase().replace(/^m\./, "www.");
  } catch {
    return undefined;
  }
  const bare = host.replace(/^www\./, "");
  return PLANNER_SOURCES.find(
    (source) => source.host === host || source.host === bare || source.host.replace(/^www\./, "") === bare,
  );
}

/** True when the URL belongs to a source automatic discovery may import from. */
export function isAutomaticallyTrustedUrl(url: string): boolean {
  const source = findSourceByUrl(url);
  return Boolean(source?.automatic);
}

/**
 * Visible-idea ceiling for a source name/id/host. Unknown sources fall back to
 * the default cap rather than being uncapped — an unrecognized publication must
 * never be able to fill the shelf.
 */
export function visibleCapForSource(nameOrIdOrHost: string | null | undefined): number {
  if (!nameOrIdOrHost) return DEFAULT_VISIBLE_CAP;
  const needle = nameOrIdOrHost.toLowerCase();
  const match = PLANNER_SOURCES.find(
    (source) =>
      source.id === needle ||
      source.name.toLowerCase() === needle ||
      source.host === needle ||
      needle.includes(source.name.toLowerCase()) ||
      needle.includes(source.host),
  );
  return match ? match.visibleCap : DEFAULT_VISIBLE_CAP;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Fill `{monthLower}` / `{month}` / `{year}` in an editorial surface URL. */
export function resolveSurfaceUrl(surface: EditorialSurface, now = new Date()): string {
  const monthLower = MONTHS[now.getUTCMonth()];
  return surface.url
    .replace(/\{monthLower\}/g, monthLower)
    .replace(/\{month\}/g, monthLower.charAt(0).toUpperCase() + monthLower.slice(1))
    .replace(/\{year\}/g, String(now.getUTCFullYear()));
}

function seasonFor(now: Date): "spring" | "summer" | "fall" | "winter" {
  const m = now.getUTCMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "fall";
  return "winter";
}

export type DiscoveryStep = {
  source: PlannerSource;
  /** `editorial` reads a curated surface; `search` issues a targeted query. */
  mode: "editorial" | "search";
  surface?: EditorialSurface;
  /** Concrete URL for an editorial step (placeholders already resolved). */
  url?: string;
};

export type DiscoveryPlanOptions = {
  now?: Date;
  /**
   * Concrete lane gaps that justify tier C. Empty means "no gap known yet", and
   * the plan then contains no tier-C search steps at all — the weekly run scores
   * the editorial pool first and asks again.
   */
  laneGaps?: readonly string[];
  /** Include a manual-only source because David explicitly asked for it. */
  includeManualSourceIds?: readonly string[];
};

/**
 * The ordered weekly discovery plan.
 *
 * Editorial first: every tier-A surface, then seasonally relevant tier-B
 * surfaces. Search steps exist only for sources that have no editorial surface
 * *and* whose lane is a named gap — which is what stops the old behaviour of
 * firing one generic query at every site and taking the first parseable page.
 */
export function buildDiscoveryPlan(options: DiscoveryPlanOptions = {}): DiscoveryStep[] {
  const now = options.now ?? new Date();
  const season = seasonFor(now);
  const laneGaps = new Set(options.laneGaps ?? []);
  const manual = new Set(options.includeManualSourceIds ?? []);
  const steps: DiscoveryStep[] = [];

  const eligible = PLANNER_SOURCES.filter((source) => source.automatic || manual.has(source.id));

  for (const tier of ["A", "B", "C"] as const) {
    for (const source of eligible.filter((s) => s.tier === tier)) {
      if (tier === "B" && source.seasons && !source.seasons.includes(season)) continue;
      for (const surface of source.editorialSurfaces) {
        steps.push({ source, mode: "editorial", surface, url: resolveSurfaceUrl(surface, now) });
      }
    }
  }

  // Manual sources reached only through an explicit request, and only by search.
  for (const source of eligible) {
    if (source.tier === "manual" && manual.has(source.id)) {
      steps.push({ source, mode: "search" });
    }
  }

  // Tier C is opened only against a concrete lane gap. Tier A/B sources with no
  // editorial surface of their own may also be searched to close a named gap.
  if (laneGaps.size > 0) {
    for (const source of eligible) {
      if (source.tier === "manual") continue;
      if (!laneGaps.has(source.lane)) continue;
      if (source.tier !== "C" && source.editorialSurfaces.length > 0) continue;
      steps.push({ source, mode: "search" });
    }
  }

  return steps;
}
