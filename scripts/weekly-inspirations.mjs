#!/usr/bin/env node
/**
 * VENDORED BRIDGE — deployed copy of kitchen-owned importer.
 * Source of truth: projects/kitchen/web-inspiration/weekly-inspirations.mjs
 * This copy exists so the Companion App can run the importer in production
 * without requiring the kitchen project to be co-deployed.
 *
 * Kitchen-owned weekly web inspiration importer.
 *
 * Goal: find a FOOBY-led set of trusted web recipes for a week, skip
 * duplicates already in the kitchen/app library, extract structured recipe
 * data from JSON-LD, and optionally stage/import them as Kitchen recipes +
 * Companion App My Recipes.
 *
 * Default mode is dry-run. Writes require explicit flags.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// Canonical Kitchen source registry (tier, editorial surface, cadence, cap,
// extraction strategy). Node strips the types; the module is dependency-free.
import {
  PLANNER_SOURCES,
  buildDiscoveryPlan,
  findSourceByUrl,
} from "../src/lib/planner-sources.ts";
import { classifyPlannerRole } from "../src/lib/planner-roles.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Vendored location: scripts/ is inside the app root
const APP_DIR = path.resolve(__dirname, "..");
const WORKSPACE_DIR = path.resolve(APP_DIR, "../../..");
const KITCHEN_DIR = path.join(WORKSPACE_DIR, "projects/kitchen");
const KITCHEN_RECIPES_DIR = path.join(KITCHEN_DIR, "recipes");
const APP_PUBLIC_RECIPES_DIR = path.join(APP_DIR, "public/recipes");
const APP_BUNDLE_PATH = path.join(APP_DIR, "src/data/recipes-bundle.json");

/**
 * The trusted-source roster is no longer defined here.
 *
 * It is the Kitchen-owned registry in
 * `projects/kitchen/web-inspiration/source-registry.json`, projected into the
 * deployable `src/lib/planner-sources.ts`. That replaced the old drift where
 * this file and `kitchen/recipe-sources.json` named different sites.
 *
 * The shape below is the importer's view of a registry entry: same identity,
 * plus the `strategy` field the search adapters switch on.
 */
function toImporterSource(source) {
  return {
    id: source.id,
    name: source.name,
    host: source.host,
    cuisine: source.cuisine,
    tier: source.tier,
    lane: source.lane,
    automatic: source.automatic,
    visibleCap: source.visibleCap,
    strategy: source.searchStrategy,
    editorialSurfaces: source.editorialSurfaces,
    extraction: source.extraction,
  };
}

export const TRUSTED_SOURCES = PLANNER_SOURCES.map(toImporterSource);
export const AUTOMATIC_SOURCES = TRUSTED_SOURCES.filter((s) => s.automatic);

const TRUSTED_HOSTS = new Set(TRUSTED_SOURCES.map((s) => s.host));
const DEFAULT_COUNT = 8;
/** Pairing/serve-with ideas staged per week. They never occupy a main slot. */
const MAX_PAIRING_IMPORTS = 3;
const USER_AGENT = "NabuKitchenWeeklyInspiration/0.1 (+https://app.davideberle.com)";

function usage() {
  return `Usage:
  node projects/kitchen/web-inspiration/weekly-inspirations.mjs [options]

Options:
  --query <text>              Search query. Default: season-aware dinner query.
  --week <YYYY-Www>           Week id for provenance. Default: current ISO week.
  --count <n>                 Number of inspirations. Default: ${DEFAULT_COUNT} (aims for 4-6 FOOBY + 2-3 other sources).
  --source <host-or-name>     Limit to one trusted source. May be repeated.
  --url <recipe-url>          Import explicit trusted recipe URL. May be repeated.
  --write-kitchen             Save Kitchen recipe JSON under projects/kitchen/recipes/<slug>/recipe.json.
  --write-app-files           Download images to companion-app/app/public/recipes and set image to /recipes/<slug>.<ext>.
  --write-app-db              Upsert into Companion App My Recipes writable DB.
  --yes                       Required with any write flag.
  --json                      Print machine-readable JSON report.
  --help                      Show this help.

Dry-run is the default and performs no filesystem/DB writes.`;
}

function parseArgs(argv) {
  const args = {
    query: defaultQuery(),
    week: currentIsoWeekId(),
    count: DEFAULT_COUNT,
    sources: [],
    urls: [],
    writeKitchen: false,
    writeAppFiles: false,
    writeAppDb: false,
    yes: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query") args.query = argv[++i];
    else if (a === "--week") args.week = argv[++i];
    else if (a === "--count") args.count = Number.parseInt(argv[++i], 10);
    else if (a === "--source") args.sources.push(argv[++i]);
    else if (a === "--url") args.urls.push(argv[++i]);
    else if (a === "--write-kitchen") args.writeKitchen = true;
    else if (a === "--write-app-files") args.writeAppFiles = true;
    else if (a === "--write-app-db") args.writeAppDb = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }

  if (!Number.isFinite(args.count) || args.count < 1 || args.count > 12) {
    throw new Error("--count must be a number from 1 to 12");
  }
  if ((args.writeKitchen || args.writeAppFiles || args.writeAppDb) && !args.yes) {
    throw new Error("Write flags require --yes. Run dry-run first, then opt in explicitly.");
  }
  if (args.writeAppDb && !args.writeAppFiles) {
    throw new Error("--write-app-db requires --write-app-files so every My Recipe has a persisted image.");
  }
  return args;
}

export async function runWeeklyInspirations(options = {}) {
  const opts = {
    query: defaultQuery(),
    week: currentIsoWeekId(),
    count: DEFAULT_COUNT,
    sources: [],
    urls: [],
    writeKitchen: false,
    writeAppFiles: false,
    writeAppDb: false,
    ...options,
  };

  const known = await loadKnownRecipes();
  const sourceFilter = buildSourceFilter(opts.sources);
  const discoveryLimit = Math.max(opts.count * 12, 72);
  const discovered = opts.urls.length > 0
    ? opts.urls.map((url) => ({ url, source: sourceForUrl(url), discovery: "search" })).filter((c) => c.source)
    : await discoverCandidates(opts.query, discoveryLimit, { sources: sourceFilter });

  const report = {
    week: opts.week,
    query: opts.query,
    requestedCount: opts.count,
    dryRun: !(opts.writeKitchen || opts.writeAppFiles || opts.writeAppDb),
    considered: discovered.length,
    discoveryLimit,
    imported: [],
    pairings: [],
    skipped: [],
    errors: [],
  };

  const picked = [];
  const seenUrls = new Set();
  // Per-source ceilings come from the Kitchen registry (FOOBY 3, most others 2,
  // The Greek Foodie 1). They are caps, never quotas: a source that offers
  // nothing usable contributes nothing.
  const perSourceCount = new Map();
  let pairingCount = 0;

  for (const candidate of discovered) {
    if (picked.length >= opts.count) break;
    if (!candidate?.url || seenUrls.has(candidate.url)) continue;
    seenUrls.add(candidate.url);

    try {
      assertTrustedUrl(candidate.url);
      const source = candidate.source ?? sourceForUrl(candidate.url);
      if (!source) {
        report.skipped.push({ url: candidate.url, reason: "not a trusted source" });
        continue;
      }

      const used = perSourceCount.get(source.host) ?? 0;
      const cap = source.visibleCap ?? 2;
      if (used >= cap) {
        report.skipped.push({ url: candidate.url, reason: `source cap reached (${source.name}: ${cap})` });
        continue;
      }

      const html = await fetchText(candidate.url);
      const extracted = extractRecipeFromHtml(html, candidate.url, source);
      if (!extracted) {
        report.skipped.push({ url: candidate.url, reason: "no usable recipe structure found" });
        continue;
      }

      const duplicate = findDuplicate(extracted, known);
      if (duplicate) {
        report.skipped.push({
          url: candidate.url,
          name: extracted.name,
          reason: "duplicate",
          duplicate,
        });
        continue;
      }

      const slug = uniqueSlug(slugify(extracted.name), known.ids);

      // Role classification runs on the recipe as it will actually be stored,
      // using the production classifier — the same function the app applies to
      // catalog recipes. Editorial prominence gets a candidate this far and no
      // further.
      const role = classifyPlannerRole(
        toCompanionRecipe(extracted, { slug, week: opts.week, image: extracted.image ?? null }),
      );
      if (role.role === "reject") {
        report.skipped.push({
          url: candidate.url,
          name: extracted.name,
          reason: "non-main",
          role: role.role,
          roleCategory: role.category,
          roleReasons: role.reasons,
          dishTypes: inferDishTypes(extracted),
        });
        continue;
      }
      const isPairing = role.role === "pairing";
      if (isPairing && pairingCount >= MAX_PAIRING_IMPORTS) {
        report.skipped.push({ url: candidate.url, name: extracted.name, reason: "pairing cap reached" });
        continue;
      }

      const image = opts.writeAppFiles
        ? await persistRecipeImage(extracted.image, slug)
        : imagePathForDryRun(extracted.image, slug);

      if (!image) {
        report.skipped.push({
          url: candidate.url,
          name: extracted.name,
          reason: "missing usable image",
        });
        continue;
      }

      const kitchenRecipe = toKitchenRecipe(extracted, {
        slug,
        week: opts.week,
        persistedImage: opts.writeAppFiles,
      });
      const companionRecipe = toCompanionRecipe(extracted, {
        slug,
        week: opts.week,
        image,
      });

      if (opts.writeKitchen) {
        await saveKitchenRecipe(kitchenRecipe, slug);
      }
      if (opts.writeAppDb) {
        await upsertMyRecipe(companionRecipe);
      }

      const imported = {
        id: slug,
        name: extracted.name,
        source: source.name,
        sourceId: source.id,
        url: candidate.url,
        image,
        discovery: candidate.discovery === "editorial" ? "editorial" : "search",
        role: role.role,
        roleCategory: role.category,
        kitchenPath: path.relative(WORKSPACE_DIR, path.join(KITCHEN_RECIPES_DIR, slug, "recipe.json")),
        appDb: !!opts.writeAppDb,
      };

      // A pairing is staged so the planner can offer it as a serve-with idea,
      // but it never counts toward the main target and never fills a main slot.
      if (isPairing) {
        report.pairings.push(imported);
        pairingCount += 1;
      } else {
        report.imported.push(imported);
        picked.push(imported);
        perSourceCount.set(source.host, used + 1);
      }

      known.ids.add(slug);
      known.normalizedTitles.add(normalizeTitle(extracted.name));
      known.sourceUrls.add(normalizeUrl(candidate.url));
    } catch (err) {
      report.errors.push({
        url: candidate?.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

function buildSourceFilter(filters) {
  if (!filters || filters.length === 0) return TRUSTED_SOURCES;
  const norm = filters.map((f) => String(f).toLowerCase());
  return TRUSTED_SOURCES.filter((s) =>
    norm.some((f) => s.host.toLowerCase().includes(f) || s.name.toLowerCase().includes(f))
  );
}

function sourceForUrl(url) {
  try {
    const host = new URL(url).host.replace(/^m\./, "www.");
    return TRUSTED_SOURCES.find((s) => s.host === host || `www.${s.host}` === host || s.host === host.replace(/^www\./, ""));
  } catch {
    return null;
  }
}

function assertTrustedUrl(url) {
  const parsed = new URL(url);
  const host = parsed.host.replace(/^m\./, "www.");
  const source = sourceForUrl(url);
  if (!source || !TRUSTED_HOSTS.has(source.host)) {
    throw new Error(`Untrusted recipe URL: ${host}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Recipe URL must use https: ${url}`);
  }
}

/**
 * Ordered weekly discovery: editorial surfaces first, targeted search second.
 *
 * This is the behaviour AC1 asks for and the old implementation did not have.
 * Previously every source got the same generic seasonal query and the first
 * parseable pages won. Now:
 *
 *   1. every tier-A editorial surface is read (FOOBY's "Inspiration for this
 *      week", the monthly editor collections), plus seasonally relevant tier-B
 *      surfaces. Those candidates are marked `discovery: "editorial"`
 *   2. the lanes those candidates already cover are measured
 *   3. only the *uncovered* lanes justify a targeted search step, which is what
 *      opens tier C at all
 *
 * A source contributes nothing when its surface is broken or its picks do not
 * qualify. There is no FOOBY quota: its cap is a ceiling applied later, during
 * selection.
 */
export async function discoverCandidates(query, limit = 24, options = {}) {
  const now = options.now ?? new Date();
  const sourceFilter = options.sources ?? null;
  const allow = sourceFilter ? new Set(sourceFilter.map((s) => s.host)) : null;
  const keep = (step) => !allow || allow.has(step.source.host);

  const editorialSteps = buildDiscoveryPlan({ now }).filter((step) => step.mode === "editorial").filter(keep);
  const editorial = [];
  const byHost = new Map();

  for (const step of editorialSteps) {
    const source = toImporterSource(step.source);
    let links = [];
    try {
      links = await scrapeEditorialSurface(step, source);
    } catch {
      // A broken editorial surface reduces this source's yield for the week.
      // It must never fail the run.
    }
    for (const link of links) {
      if (!link?.url || !isProbablyRecipeUrl(link.url)) continue;
      const candidate = { ...link, source, discovery: "editorial" };
      editorial.push(candidate);
      if (!byHost.has(source.host)) byHost.set(source.host, []);
      byHost.get(source.host).push(candidate);
    }
  }

  // Which lanes did the editorial pool actually cover?
  const coveredLanes = new Set(editorial.map((c) => c.source.lane));
  const laneGaps = [
    ...new Set(
      PLANNER_SOURCES
        .filter((source) => source.automatic && !coveredLanes.has(source.lane))
        .map((source) => source.lane),
    ),
  ];

  const searchCandidates = [];
  if (editorial.length < limit && laneGaps.length > 0) {
    const searchSteps = buildDiscoveryPlan({ now, laneGaps }).filter((step) => step.mode === "search").filter(keep);
    const perSource = Math.max(4, Math.ceil(limit / Math.max(1, searchSteps.length)));
    for (const step of searchSteps) {
      const source = toImporterSource(step.source);
      try {
        const results = await searchSource(source, query, perSource);
        for (const result of results) {
          if (!result?.url || !isProbablyRecipeUrl(result.url)) continue;
          const candidate = { ...result, source, discovery: "search" };
          searchCandidates.push(candidate);
          if (!byHost.has(source.host)) byHost.set(source.host, []);
          byHost.get(source.host).push(candidate);
        }
      } catch {
        // One source failing must not kill the weekly run.
      }
    }
  }

  // Interleave by host inside each phase so no single site fronts the queue.
  const ordered = [
    ...interleaveBySource(editorial, (c) => c.source.host),
    ...interleaveBySource(searchCandidates, (c) => c.source.host),
  ];

  const seen = new Set();
  return ordered
    .filter((r) => {
      const key = normalizeUrl(r.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/** Backwards-compatible alias; discovery is registry-driven now. */
export async function searchTrustedSources(query, limit = 24, sources = TRUSTED_SOURCES) {
  return discoverCandidates(query, limit, { sources });
}

/**
 * Read one editorial surface and return its recipe links.
 *
 * A `homepage-section` surface anchors on its marker text and only scans the
 * following chunk, so unrelated page sections cannot leak in. A `collection`
 * surface scans the whole page but keeps only links that match the registry's
 * link pattern and belong to the same source — a collection page must never be
 * imported as if it were a recipe.
 */
async function scrapeEditorialSurface(step, source) {
  const url = step.url ?? step.surface?.url;
  if (!url) return [];
  const html = await fetchText(url).catch(() => "");
  if (!html) return [];

  let scope = html;
  if (step.surface?.marker) {
    const idx = html.indexOf(step.surface.marker);
    if (idx === -1) return [];
    scope = html.slice(idx, idx + 12000);
  }

  const linkPattern = step.surface?.linkPattern ? new RegExp(step.surface.linkPattern, "i") : null;
  const results = [];
  const seen = new Set();
  for (const match of scope.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = absolutizeUrl(match[1], url);
    if (!href) continue;
    if (normalizeUrl(href) === normalizeUrl(url)) continue;
    const key = normalizeUrl(href);
    if (seen.has(key)) continue;
    const linkSource = findSourceByUrl(href);
    if (!linkSource || linkSource.host !== source.host) continue;
    if (linkPattern && !linkPattern.test(href)) continue;
    seen.add(key);
    results.push({ title: decodeHtml(stripTags(match[2])).trim(), url: href });
  }
  return results;
}

/**
 * Round-robin interleave arrays so no single bucket dominates the front.
 * Pure helper -- exported for testing.
 */
export function roundRobinInterleave(buckets) {
  const result = [];
  const iterators = buckets.map((arr) => ({ arr, idx: 0 }));
  let progress = true;
  while (progress) {
    progress = false;
    for (const it of iterators) {
      if (it.idx < it.arr.length) {
        result.push(it.arr[it.idx++]);
        progress = true;
      }
    }
  }
  return result;
}

/**
 * Re-order candidates so sources are balanced (round-robin by source key).
 * Pure helper -- exported for testing.
 */
export function interleaveBySource(candidates, sourceKey = (c) => c.source) {
  const bySource = new Map();
  for (const c of candidates) {
    const key = typeof sourceKey === "function" ? sourceKey(c) : c[sourceKey];
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(c);
  }
  return roundRobinInterleave([...bySource.values()]);
}

async function searchSource(source, query, limit) {
  if (source.strategy === "wordpress") {
    return searchWordPress(source, query, limit);
  }
  if (source.strategy === "fooby-json") {
    return searchFooby(source, query, limit);
  }
  return searchHomepageLinks(source, query, limit);
}

async function searchFooby(source, query, limit) {
  // FOOBY's search treats "recipe" literally and over-weights kid/baking pages.
  // The endpoint is already scoped to recipes, so use the seasonal food terms.
  const foobyQuery = query.replace(/\brecipes?\b/gi, "").replace(/\s+/g, " ").trim() || query;
  const url = `https://fooby.ch/hawaii_search.sri?lang=en&treffertyp=rezepte&query=${encodeURIComponent(foobyQuery)}`;
  const data = await fetchJson(url).catch(() => null);
  if (!data) return [];
  const results = Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];
  return results
    .filter((r) => {
      const href = r.url || r.link;
      if (!href) return false;
      // Only keep main fooby.ch recipes; skip little.fooby.ch (kids) and other subdomains.
      try { return new URL(href.startsWith("http") ? href : `https://fooby.ch${href}`).host === "fooby.ch"; } catch { return false; }
    })
    .slice(0, limit)
    .map((r) => {
      const href = r.url || r.link;
      const fullUrl = href.startsWith("http") ? href : `https://fooby.ch${href.startsWith("/") ? "" : "/"}${href}`;
      return { title: r.title || "", url: fullUrl };
    });
}

async function searchWordPress(source, query, limit) {
  const base = `https://${source.host}`;
  const endpoints = [
    `${base}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&subtype=post&per_page=${limit}`,
    `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=${limit}`,
  ];

  for (const endpoint of endpoints) {
    const res = await fetchJson(endpoint).catch(() => null);
    if (Array.isArray(res) && res.length > 0) {
      return res
        .map((item) => ({
          title: decodeHtml(stripTags(item.title?.rendered ?? item.title ?? "")),
          url: item.url || item.link,
        }))
        .filter((r) => r.url);
    }
  }
  return [];
}

async function searchHomepageLinks(source, query, limit) {
  const searchUrl = `https://${source.host}/search?q=${encodeURIComponent(query)}`;
  const html = await fetchText(searchUrl).catch(() => "");
  if (!html) return [];
  const links = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ url: absolutizeUrl(m[1], `https://${source.host}`), title: decodeHtml(stripTags(m[2])) }))
    .filter((r) => r.url && sourceForUrl(r.url));
  return links.slice(0, limit);
}

function isProbablyRecipeUrl(url) {
  try {
    const u = new URL(url);
    if (!sourceForUrl(url)) return false;
    const p = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (p === "" || p === "/" || p.includes("/category/") || p.includes("/tag/") || p.includes("/author/")) return false;
    if (p.includes("/shop") || p.includes("/about") || p.includes("/privacy")) return false;
    if (p.includes("/page/")) return false;
    // Reject roundup / list pages — these have no recipe JSON-LD but
    // dominate WP search results for broad queries like "spring dinner".
    const slug = p.split("/").filter(Boolean).pop() || "";
    if (/^\d+-/.test(slug)) return false;                       // "29-vegan-dinner-recipes"
    if (/-ideas$|-recipes$|-roundup$|-collection$/.test(slug)) return false;  // "spring-dinner-ideas"
    if (/best-.*-recipes|easy-.*-ideas/.test(slug)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract a recipe from a page.
 *
 * Structured extraction stays preferred: Recipe JSON-LD is tried first and
 * wins whenever it is complete. Only when it is unusable does a source-specific
 * fallback run, and only for sources the registry gives one to.
 *
 * FOOBY needs this. Its featured pages *do* ship Recipe JSON-LD, but with the
 * whole preparation collapsed into a single `HowToStep`, which the structured
 * path correctly refuses for a main. The page's own embedded `recipeJSON`
 * carries the real per-section steps, grouped ingredients with quantities,
 * times and servings — so the fallback reads that and merges the JSON-LD
 * metadata (category, cuisine, keywords, diet) back on top.
 */
export function extractRecipeFromHtml(html, url, source) {
  const jsonLdBlocks = extractJsonLd(html);
  let rawRecipeLd = null;
  for (const block of jsonLdBlocks) {
    const recipes = findRecipeObjects(block);
    for (const recipe of recipes) {
      if (!rawRecipeLd) rawRecipeLd = recipe;
      const normalized = normalizeRecipeLd(recipe, url, source, html);
      if (normalized) return normalized;
    }
  }

  if (source?.extraction?.fallback === "fooby-embedded-json") {
    return extractFoobyRecipe(html, url, source, rawRecipeLd);
  }
  return null;
}

/** Read the `var recipeJSON = {...};` payload FOOBY renders on every recipe. */
export function parseFoobyRecipeJson(html) {
  const marker = html.indexOf("var recipeJSON");
  if (marker === -1) return null;
  const start = html.indexOf("{", marker);
  if (start === -1) return null;

  // Brace-count to the matching close, skipping braces inside strings so a
  // step containing "{" cannot truncate the payload.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function foobyIngredientText(ingredient) {
  const amount =
    typeof ingredient?.amount === "number" && ingredient.amount > 0
      ? String(Number.isInteger(ingredient.amount) ? ingredient.amount : ingredient.amount)
      : "";
  const unit = cleanText(ingredient?.unit ?? "");
  const desc = cleanText(ingredient?.text ?? "");
  return [amount, unit, desc].filter(Boolean).join(" ").trim();
}

function foobyMinutes(value) {
  const match = String(value ?? "").match(/(\d+)\s*(h|std|hour|min)/i);
  if (!match) return 0;
  const n = Number.parseInt(match[1], 10);
  return /^(h|std|hour)/i.test(match[2]) ? n * 60 : n;
}

function metaContent(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, "i");
  return cleanText(html.match(re)?.[1] ?? "");
}

/**
 * Source-specific FOOBY extraction.
 *
 * Deliberately accepts a single method step: FOOBY writes short recipes as one
 * well-formed instruction with fully structured, grouped, quantified
 * ingredients. That is a real recipe, and the role classifier — not the
 * extractor — decides whether it can be a dinner main. Anything with fewer than
 * three ingredients or no instruction at all is still refused.
 */
export function extractFoobyRecipe(html, url, source, rawRecipeLd = null) {
  const payload = parseFoobyRecipeJson(html);
  if (!payload) return null;

  const name = cleanText(payload.name ?? metaContent(html, "og:title"));
  const items = Array.isArray(payload.items) ? payload.items : [];

  const ingredientEntries = [];
  const method = [];
  for (const item of items) {
    const group = cleanText(item?.title ?? "");
    for (const ingredient of Array.isArray(item?.ingredients) ? item.ingredients : []) {
      const text = foobyIngredientText(ingredient);
      if (text) ingredientEntries.push({ text, group: group || null });
    }
    const step = cleanText(item?.step ?? "");
    if (step) method.push(group && group.toLowerCase() !== step.toLowerCase() ? `${group}: ${step}` : step);
  }

  if (!name || ingredientEntries.length < 3 || method.length < 1) return null;

  const image =
    payload.images?.large ||
    payload.images?.medium ||
    normalizeImage(rawRecipeLd?.image) ||
    metaContent(html, "og:image") ||
    null;

  const prepMinutes = foobyMinutes(payload.time?.timeActive);
  const totalMinutes = foobyMinutes(payload.time?.timeTotal) || prepMinutes;
  const servings = Number.isFinite(payload.amount) && payload.amount > 0 ? payload.amount : 4;

  return {
    name,
    url,
    source,
    author: normalizeAuthor(rawRecipeLd?.author) || source.name,
    description: cleanText(firstString(rawRecipeLd?.description)) || metaContent(html, "description"),
    image,
    yieldText: normalizeYield(rawRecipeLd?.recipeYield) || `serves ${servings}`,
    servings,
    prepMinutes,
    cookMinutes: Math.max(0, totalMinutes - prepMinutes),
    totalMinutes,
    ingredients: ingredientEntries.map((entry) => entry.text),
    ingredientEntries,
    method,
    cuisine: firstString(rawRecipeLd?.recipeCuisine) || source.cuisine || inferCuisine(name, source),
    category: firstString(rawRecipeLd?.recipeCategory),
    keywords: normalizeKeywords(rawRecipeLd?.keywords),
    dietary: normalizeDietary(rawRecipeLd?.suitableForDiet),
    extractedBy: "fooby-embedded-json",
  };
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script\b(?=[^>]*type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json))[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const raw = decodeHtml(match[1].trim());
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some sites include invalid JSON-LD; ignore rather than guessing.
    }
  }
  return blocks;
}

function findRecipeObjects(node) {
  const out = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    const type = value["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => String(t).toLowerCase() === "recipe")) out.push(value);
    if (Array.isArray(value["@graph"])) visit(value["@graph"]);
    if (Array.isArray(value.mainEntity)) visit(value.mainEntity);
  };
  visit(node);
  return out;
}

function normalizeRecipeLd(recipe, url, source, html = "") {
  const name = cleanText(firstString(recipe.name));
  const ingredients = arrayOfStrings(recipe.recipeIngredient);
  const foobyIngredientEntries = source?.strategy === "fooby-json"
    ? extractFoobyIngredientEntries(html)
    : [];
  const ingredientEntries = foobyIngredientEntries.length >= ingredients.length
    ? foobyIngredientEntries
    : ingredients.map((text) => ({ text, group: null }));
  const method = normalizeInstructions(recipe.recipeInstructions);
  if (!name || ingredients.length < 3 || method.length < 2) return null;

  return {
    name,
    url,
    source,
    author: normalizeAuthor(recipe.author) || source.name,
    description: cleanText(firstString(recipe.description)),
    image: normalizeImage(recipe.image),
    yieldText: normalizeYield(recipe.recipeYield),
    servings: parseServings(recipe.recipeYield),
    prepMinutes: parseDurationMinutes(recipe.prepTime),
    cookMinutes: parseDurationMinutes(recipe.cookTime),
    totalMinutes: parseDurationMinutes(recipe.totalTime),
    ingredients: ingredientEntries.map((entry) => entry.text),
    ingredientEntries,
    method,
    cuisine: firstString(recipe.recipeCuisine) || source.cuisine || inferCuisine(name, source),
    category: firstString(recipe.recipeCategory),
    keywords: normalizeKeywords(recipe.keywords),
    dietary: normalizeDietary(recipe.suitableForDiet),
  };
}

function normalizeInstructions(instructions) {
  if (!instructions) return [];
  const steps = [];
  const visit = (value, prefix = "") => {
    if (!value) return;
    if (typeof value === "string") {
      const text = cleanText(value);
      if (text) steps.push(prefix ? `${prefix}: ${text}` : text);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, prefix);
      return;
    }
    if (typeof value !== "object") return;
    const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] ?? "");
    if (/HowToSection/i.test(type) && value.itemListElement) {
      const sectionName = cleanText(value.name ?? "");
      visit(value.itemListElement, sectionName);
      return;
    }
    const sectionOrStepName = cleanText(value.name ?? "");
    const text = cleanText(value.text || value.name || "");
    if (text) {
      const shouldPrefixStep =
        !prefix &&
        sectionOrStepName &&
        sectionOrStepName !== text &&
        sectionOrStepName.length <= 48 &&
        !text.toLowerCase().startsWith(sectionOrStepName.toLowerCase());
      steps.push(prefix ? `${prefix}: ${text}` : shouldPrefixStep ? `${sectionOrStepName}: ${text}` : text);
    }
    if (value.itemListElement) visit(value.itemListElement, prefix);
  };
  visit(instructions);
  return [...new Set(steps)].filter((s) => s.length > 8);
}

function extractFoobyIngredientEntries(html) {
  if (!html || !html.includes("recipe-ingredientlist__ingredient-wrapper")) return [];
  const entries = [];
  const sections = html.split(/<p class="heading--h3">/g).slice(1);
  for (const section of sections) {
    const headingEnd = section.indexOf("</p>");
    if (headingEnd === -1) continue;
    const group = cleanText(section.slice(0, headingEnd));
    if (!group) continue;

    const wrapperRe = /<div class="recipe-ingredientlist__ingredient-wrapper">([\s\S]*?)<\/div>/g;
    for (const match of section.matchAll(wrapperRe)) {
      const block = match[1];
      const quantity = cleanText(block.match(/<span class="recipe-ingredientlist__ingredient-quantity">([\s\S]*?)<\/span>\s*<span class="recipe-ingredientlist__ingredient-desc">/)?.[1] ?? "");
      const desc = cleanText(block.match(/<span class="recipe-ingredientlist__ingredient-desc">([\s\S]*?)<\/span>/)?.[1] ?? "");
      const text = [quantity, desc].filter(Boolean).join(" ");
      if (text) entries.push({ text, group });
    }
  }
  return entries;
}

function normalizeImage(image) {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return normalizeImage(image[0]);
  if (typeof image === "object") return image.url || image.contentUrl || null;
  return null;
}

function normalizeAuthor(author) {
  if (!author) return null;
  if (typeof author === "string") return cleanText(author);
  if (Array.isArray(author)) return author.map(normalizeAuthor).filter(Boolean).join(", ");
  if (typeof author === "object") return cleanText(author.name ?? "");
  return null;
}

function normalizeYield(recipeYield) {
  if (!recipeYield) return "";
  if (Array.isArray(recipeYield)) return cleanText(recipeYield[0] ?? "");
  return cleanText(recipeYield);
}

function parseServings(recipeYield) {
  const text = normalizeYield(recipeYield);
  const m = text.match(/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : 4;
}

function parseDurationMinutes(value) {
  if (!value || typeof value !== "string") return 0;
  const iso = value.match(/^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?$/i) || value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (iso) return (Number.parseInt(iso[1] || "0", 10) * 60) + Number.parseInt(iso[2] || "0", 10);
  const minutes = value.match(/(\d+)\s*(?:min|minute)/i);
  if (minutes) return Number.parseInt(minutes[1], 10);
  const hours = value.match(/(\d+)\s*(?:hr|hour)/i);
  if (hours) return Number.parseInt(hours[1], 10) * 60;
  return 0;
}

function normalizeKeywords(keywords) {
  if (!keywords) return [];
  if (Array.isArray(keywords)) return keywords.map(cleanText).filter(Boolean);
  return String(keywords).split(",").map(cleanText).filter(Boolean);
}

function normalizeDietary(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  const tags = [];
  if (/vegan/i.test(text)) tags.push("vegan");
  if (/vegetarian/i.test(text) && !tags.includes("vegan")) tags.push("vegetarian");
  if (/gluten.?free/i.test(text)) tags.push("gluten-free");
  return tags;
}

export function toKitchenRecipe(extracted, { slug, week, persistedImage = false }) {
  return {
    id: slug,
    name: extracted.name,
    category: "dinner",
    cuisine: extracted.cuisine || inferCuisine(extracted.name, extracted.source),
    source: {
      url: extracted.url,
      brand: extracted.source.name,
      author: extracted.author,
      ...(extracted.image ? { image: extracted.image, imageNote: persistedImage ? "remote — downloaded to companion app image storage" : "remote — not downloaded" } : {}),
    },
    servings: extracted.servings || 4,
    time: normalizeTimeObject(extracted),
    season: inferSeasons(extracted),
    tags: [...new Set(["web-inspiration", "weekly-inspiration", week, ...extracted.dietary, ...extracted.keywords.slice(0, 6)].filter(Boolean))],
    ingredients: {
      ingredients: (extracted.ingredientEntries ?? extracted.ingredients.map((text) => ({ text, group: null })))
        .map((entry) => ({ item: entry.text, amount: null, unit: "", ...(entry.group ? { group: entry.group } : {}) })),
    },
    steps: extracted.method,
    notes: [
      extracted.description,
      extracted.yieldText ? `Original yield: ${extracted.yieldText}.` : null,
      `Imported as weekly web inspiration for ${week}.`,
    ].filter(Boolean).join("\n\n"),
    goesWith: [],
    rating: null,
    cooked_on: [],
  };
}

export function toCompanionRecipe(extracted, { slug, week, image }) {
  const time = normalizeTimeObject(extracted);
  const dishTypes = inferDishTypes(extracted);
  const mealRole = inferMealRole(extracted);
  return {
    id: slug,
    name: extracted.name,
    source: {
      cookbook: "My Recipes",
      author: extracted.author || extracted.source.name,
      publication: `${extracted.source.name} · Web inspiration`,
      url: extracted.url,
    },
    cuisine: extracted.cuisine || inferCuisine(extracted.name, extracted.source),
    category: {
      dish_type: dishTypes,
      chapter: "",
      meal_role: mealRole,
    },
    servings: formatServings(extracted.yieldText, extracted.servings),
    time,
    intro: extracted.description || `Weekly web inspiration from ${extracted.source.name}.`,
    introduction: extracted.description || null,
    tips: `Source: ${extracted.url}. Imported as weekly web inspiration for ${week}.`,
    ingredients: (extracted.ingredientEntries ?? extracted.ingredients.map((text) => ({ text, group: null })))
      .map((entry) => ({
        ...parseIngredientLine(entry.text),
        group: entry.group || "Ingredients",
      })),
    method: extracted.method,
    dietary: extracted.dietary,
    tags: {
      dietary: extracted.dietary,
      season: inferSeasons(extracted),
    },
    visibility: "planner-candidate",
    image,
    mealRole,
  };
}

function normalizeTimeObject(extracted) {
  const prep = extracted.prepMinutes || 0;
  const cook = extracted.cookMinutes || 0;
  const total = extracted.totalMinutes || prep + cook || 0;
  return {
    ...(prep ? { prep } : {}),
    ...(cook ? { cook } : {}),
    ...(total ? { total } : {}),
  };
}

/**
 * What the source itself says the dish is.
 *
 * This used to be ignored: `recipeCategory` was concatenated into one text blob
 * and only matched by dish-name keywords, so FOOBY's featured "starter" salad
 * was inferred as a `main`. The declared category is data, not a guess, and it
 * now decides first. Only when a page declares nothing do the name heuristics
 * run.
 */
function dishTypesFromDeclaredCategory(category) {
  const declared = String(category ?? "").toLowerCase().trim();
  if (!declared) return null;
  if (/\b(dessert|sweets?|s(ü|ue)ss|patisserie|pastry)\b/.test(declared)) return ["dessert"];
  if (/\b(drink|drinks|beverage|cocktail|getr(ä|ae)nk)\b/.test(declared)) return ["drink"];
  if (/\b(bak(e|ing)|bread|brot|geb(ä|ae)ck)\b/.test(declared)) return ["baking"];
  if (/\b(breakfast|brunch|fr(ü|ue)hst(ü|ue)ck)\b/.test(declared)) return ["breakfast"];
  if (/\b(snack|apero|ap(é|e)ritif|finger food)\b/.test(declared)) return ["snack"];
  if (/\b(condiment|sauce|dressing|dip|chutney|pickle)\b/.test(declared)) return ["condiment", "side"];
  if (/\b(starter|appetiz|appetis|vorspeise|entr(é|e)e froide)\b/.test(declared)) return ["starter"];
  if (/\b(side|side dish|beilage)\b/.test(declared)) return ["side"];
  if (/\b(salad|salat)\b/.test(declared)) return ["salad"];
  if (/\b(soup|suppe)\b/.test(declared)) return ["soup", "main"];
  if (/\b(main|main course|main dish|dinner|supper|hauptgang|hauptspeise)\b/.test(declared)) return ["main"];
  return null;
}

function inferDishTypes(extracted) {
  const declared = dishTypesFromDeclaredCategory(extracted.category);
  if (declared) return declared;

  const text = `${extracted.name}`.toLowerCase();
  if (/chutney|pickle|relish|raita|salsa/.test(text)) return ["condiment", "side"];
  if (/shrikhand|dessert|cake|pie|pudding|mousse|sorbet|ice cream|cobbler|parfait|babka/.test(text)) return ["dessert"];
  if (/\bdip\b|hummus|guacamole/.test(text)) return ["dip", "side"];
  if (/\b(smoothie|juice|spritz|cocktail|lemonade|iced tea)\b/.test(text)) return ["drink"];
  if (/asparagus stir fry|stir[- ]?fried asparagus/.test(text)) return ["side", "vegetable"];
  if (text.includes("soup") || text.includes("stew")) return ["soup", "main"];
  if (text.includes("salad")) return ["salad", "main"];
  if (text.includes("pasta") || text.includes("noodle")) return ["main", "pasta"];
  if (text.includes("curry") || text.includes("dal") || text.includes("dhal")) return ["main", "curry"];
  return ["main"];
}

function inferMealRole(extracted) {
  const types = inferDishTypes(extracted);
  if (types.includes("dessert")) return "dessert";
  if (types.includes("drink")) return "drink";
  if (types.includes("baking")) return "baking";
  if (types.includes("breakfast")) return "breakfast";
  if (types.includes("snack")) return "snack";
  if (types.includes("dip")) return "dip";
  if (types.includes("condiment")) return "condiment";
  if (types.includes("starter") && !types.includes("main")) return "starter";
  if (types.includes("side") && !types.includes("main")) return "side";
  return "main";
}

function parseIngredientLine(value) {
  const original = cleanText(value);
  if (!original) return { item: "", amount: "", unit: "" };

  const amountPattern = "(?:\\d+\\/\\d+|\\d+\\.\\d+|\\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|a|an)";
  const mixedAmountPattern = `(?:${amountPattern})(?:\\s+(?:to|-|–|—)\\s*(?:${amountPattern}))?(?:\\s+(?:${amountPattern}))?`;
  const unitPattern = "(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lb|lbs|pounds?|g|grams?|kg|cm|ml|l|liters?|cloves?|cans?|tins?|bunch(?:es)?|sprigs?|pinch(?:es)?|packet(?:s)?)";
  const match = original.match(new RegExp(`^(${mixedAmountPattern})(?:\\s+(${unitPattern})\\b)?\\s*(?:of\\s+)?(.+)$`, "i"));
  if (!match) return { item: original, amount: "", unit: "" };

  const amount = cleanText(match[1]);
  const unit = cleanText(match[2] ?? "");
  const item = cleanText(match[3]);
  if (!item || item.length < 2) return { item: original, amount: "", unit: "" };
  return { item, amount, unit };
}

function inferCuisine(name, source) {
  const text = `${name} ${source?.name ?? ""}`.toLowerCase();
  if (/greek|souvlaki|spanakopita|tzatziki/.test(text)) return "Greek";
  if (/curry|dal|dhal|masala|indian|ministry/.test(text)) return "Indian";
  if (/tofu|noodle|ramen|asian|flight/.test(text)) return "Asian";
  if (/vegan|vegetarian|cookie|lemons|forks/.test(text)) return "Modern Vegetarian";
  return source?.cuisine || "Other";
}

function inferSeasons(extracted) {
  const text = `${extracted.name} ${extracted.description ?? ""} ${extracted.keywords.join(" ")}`.toLowerCase();
  const seasons = [];
  if (/spring|asparagus|pea|fava|wild garlic/.test(text)) seasons.push("spring");
  if (/summer|zucchini|tomato|corn|peach|watermelon/.test(text)) seasons.push("summer");
  if (/autumn|fall|pumpkin|squash|apple|cranberry/.test(text)) seasons.push("fall");
  if (/winter|root vegetable|parsnip|braised|stew/.test(text)) seasons.push("winter");
  return seasons.length ? seasons : ["all"];
}

function formatServings(yieldText, parsed) {
  if (yieldText) return yieldText.match(/^serves\b/i) ? capitalize(yieldText) : yieldText;
  if (parsed) return `serves ${parsed}`;
  return "serves 4";
}

async function saveKitchenRecipe(recipe, slug) {
  const dir = path.join(KITCHEN_RECIPES_DIR, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "recipe.json"), `${JSON.stringify(recipe, null, 2)}\n`, "utf8");
}

async function persistRecipeImage(imageUrl, slug) {
  if (!imageUrl || !/^https:\/\//.test(imageUrl)) return null;
  const res = await fetch(imageUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1024) return null;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return uploadImageToVercelBlob(slug, bytes, contentType);
  }

  const ext = extensionForContentType(contentType, imageUrl);
  await fs.mkdir(APP_PUBLIC_RECIPES_DIR, { recursive: true });
  const dest = path.join(APP_PUBLIC_RECIPES_DIR, `${slug}.${ext}`);
  await fs.writeFile(dest, bytes);
  return `/recipes/${slug}.${ext}`;
}

async function uploadImageToVercelBlob(slug, bytes, contentType) {
  const ext = extensionForContentType(contentType, `${slug}.jpg`);
  const requireFromApp = createRequire(path.join(APP_DIR, "package.json"));
  const { put } = requireFromApp("@vercel/blob");
  const result = await put(`recipes/${slug}.${ext}`, bytes, {
    access: "public",
    contentType,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return result.url;
}

function imagePathForDryRun(imageUrl, slug) {
  if (!imageUrl) return null;
  return `/recipes/${slug}.${extensionForContentType("", imageUrl)}`;
}

function extensionForContentType(contentType, imageUrl) {
  const lower = contentType.toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  const pathExt = new URL(imageUrl).pathname.match(/\.([a-z0-9]{3,4})$/i)?.[1]?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(pathExt)) return pathExt === "jpeg" ? "jpg" : pathExt;
  return "jpg";
}

async function upsertMyRecipe(recipe) {
  const hasLocalImage = recipe.image && recipe.image.startsWith("/recipes/");
  const hasBlobImage = recipe.image && /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(recipe.image);
  if (!hasLocalImage && !hasBlobImage) {
    throw new Error(`Refusing to import ${recipe.id}: image must be a local /recipes/ path or a Vercel Blob URL, got: ${recipe.image || "(none)"}`);
  }
  const requireFromApp = createRequire(path.join(APP_DIR, "package.json"));
  const { createClient } = requireFromApp("@libsql/client");
  const url = process.env.TURSO_DATABASE_URL || `file:${process.env.NABU_DB_DIR || APP_DIR}/nabu.db`;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url, authToken });
  await client.execute(`
    CREATE TABLE IF NOT EXISTS recipes (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  const tableInfo = await client.execute("PRAGMA table_info(recipes)");
  const columns = new Set(tableInfo.rows.map((row) => String(row.name)));
  const now = new Date().toISOString();
  const insertColumns = ["id", "data", "created_at"];
  const insertArgs = [recipe.id, JSON.stringify(recipe), now];
  const updateSets = ["data = excluded.data"];

  // Production has a newer recipes schema with derived columns alongside JSON data.
  // Keep this vendored importer tolerant of both the old local schema and live Turso.
  if (columns.has("name")) {
    insertColumns.splice(1, 0, "name");
    insertArgs.splice(1, 0, recipe.name);
    updateSets.push("name = excluded.name");
  }
  if (columns.has("updated_at")) {
    insertColumns.push("updated_at");
    insertArgs.push(now);
    updateSets.push("updated_at = excluded.updated_at");
  }

  await client.execute({
    sql: `INSERT INTO recipes (${insertColumns.join(", ")})
          VALUES (${insertColumns.map(() => "?").join(", ")})
          ON CONFLICT(id) DO UPDATE SET ${updateSets.join(", ")}`,
    args: insertArgs,
  });
  client.close?.();
}

export async function loadKnownRecipes() {
  const known = {
    ids: new Set(),
    normalizedTitles: new Set(),
    sourceUrls: new Set(),
  };

  await readJsonIfExists(APP_BUNDLE_PATH).then((recipes) => {
    if (Array.isArray(recipes)) {
      for (const r of recipes) addKnownRecipe(known, r);
    }
  });

  await loadKitchenRecipeJsons(KITCHEN_RECIPES_DIR).then((recipes) => {
    for (const r of recipes) addKnownRecipe(known, r);
  });

  await loadKnownRecipesFromAppDb(known);

  return known;
}

async function loadKnownRecipesFromAppDb(known) {
  const url = process.env.TURSO_DATABASE_URL || (process.env.NABU_DB_DIR ? `file:${process.env.NABU_DB_DIR}/nabu.db` : null);
  if (!url) return;
  try {
    const requireFromApp = createRequire(path.join(APP_DIR, "package.json"));
    const { createClient } = requireFromApp("@libsql/client");
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

    const recipes = await client.execute("SELECT data FROM recipes");
    for (const row of recipes.rows) {
      try {
        addKnownRecipe(known, JSON.parse(row.data));
      } catch {
        // Ignore one malformed runtime recipe.
      }
    }

    try {
      const inspirations = await client.execute("SELECT source_url FROM web_recipe_inspirations");
      for (const row of inspirations.rows) {
        if (row.source_url) known.sourceUrls.add(normalizeUrl(String(row.source_url)));
      }
    } catch {
      // Older local DBs may not have the provenance table yet.
    }

    client.close?.();
  } catch {
    // DB lookup is best-effort; static bundle + kitchen JSON still protect most duplicates.
  }
}

async function loadKitchenRecipeJsons(dir) {
  const out = [];
  async function walk(current, depth = 0) {
    if (depth > 3) return;
    let entries = [];
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.name === "recipe.json" || (depth <= 2 && entry.name.endsWith(".json"))) {
        const data = await readJsonIfExists(full);
        if (data && typeof data === "object") out.push(data);
      }
    }
  }
  await walk(dir);
  return out;
}

function addKnownRecipe(known, recipe) {
  if (!recipe || typeof recipe !== "object") return;
  if (recipe.id) known.ids.add(String(recipe.id));
  if (recipe.name) known.normalizedTitles.add(normalizeTitle(recipe.name));
  const url = recipe.source?.url || recipe.sourceUrl || recipe.url;
  if (url) known.sourceUrls.add(normalizeUrl(url));
}

function findDuplicate(extracted, known) {
  const title = normalizeTitle(extracted.name);
  const url = normalizeUrl(extracted.url);
  if (known.sourceUrls.has(url)) return { by: "sourceUrl", value: extracted.url };
  if (known.normalizedTitles.has(title)) return { by: "title", value: extracted.name };
  return null;
}

function uniqueSlug(base, ids) {
  let slug = base || "web-inspiration";
  let n = 2;
  while (ids.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

function slugify(str) {
  return String(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeTitle(str) {
  return cleanText(str).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return String(url || "").trim();
  }
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function absolutizeUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function arrayOfStrings(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map(firstString).map(cleanText).filter(Boolean);
}

function firstString(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return firstString(value[0]);
  if (typeof value === "object") return firstString(value.name || value.text || value.url || value["@id"]);
  return "";
}

function cleanText(value) {
  return decodeHtml(stripTags(String(value ?? ""))).replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, " ");
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function defaultQuery(now = new Date()) {
  const month = now.getMonth();
  // Include "recipe" to bias WP search toward individual recipe posts
  // instead of roundup/list articles.
  if (month >= 2 && month <= 4) return "spring vegetarian dinner recipe";
  if (month >= 5 && month <= 7) return "summer vegetarian dinner recipe";
  if (month >= 8 && month <= 10) return "fall vegetarian dinner recipe";
  return "winter vegetarian dinner recipe";
}

function currentIsoWeekId(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    const report = await runWeeklyInspirations(args);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanReport(report);
    }
    process.exit(report.imported.length > 0 || report.dryRun ? 0 : 1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function printHumanReport(report) {
  console.log(`${report.dryRun ? "Dry-run" : "Run"}: weekly web inspirations for ${report.week}`);
  console.log(`Query: ${report.query}`);
  console.log(`Imported/staged: ${report.imported.length}/${report.requestedCount}`);
  for (const item of report.imported) {
    console.log(`  + ${item.name} (${item.source})`);
    console.log(`    ${item.url}`);
    console.log(`    image: ${item.image}`);
  }
  if (report.skipped.length) {
    console.log(`Skipped: ${report.skipped.length}`);
    for (const s of report.skipped.slice(0, 8)) {
      console.log(`  - ${s.name || s.url}: ${s.reason}`);
    }
  }
  if (report.errors.length) {
    console.log(`Errors: ${report.errors.length}`);
    for (const e of report.errors.slice(0, 8)) console.log(`  ! ${e.url}: ${e.message}`);
  }
}
