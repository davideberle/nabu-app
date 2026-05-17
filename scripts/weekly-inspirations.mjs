#!/usr/bin/env node
/**
 * VENDORED BRIDGE — deployed copy of kitchen-owned importer.
 * Source of truth: projects/kitchen/web-inspiration/weekly-inspirations.mjs
 * This copy exists so the Companion App can run the importer in production
 * without requiring the kitchen project to be co-deployed.
 *
 * Kitchen-owned weekly web inspiration importer.
 *
 * Goal: find 3-4 trusted web recipes for a week, skip duplicates already in
 * the kitchen/app library, extract structured recipe data from JSON-LD, and
 * optionally stage/import them as Kitchen recipes + Companion App My Recipes.
 *
 * Default mode is dry-run. Writes require explicit flags.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Vendored location: scripts/ is inside the app root
const APP_DIR = path.resolve(__dirname, "..");
const WORKSPACE_DIR = path.resolve(APP_DIR, "../../..");
const KITCHEN_DIR = path.join(WORKSPACE_DIR, "projects/kitchen");
const KITCHEN_RECIPES_DIR = path.join(KITCHEN_DIR, "recipes");
const APP_PUBLIC_RECIPES_DIR = path.join(APP_DIR, "public/recipes");
const APP_BUNDLE_PATH = path.join(APP_DIR, "src/data/recipes-bundle.json");

export const TRUSTED_SOURCES = [
  {
    name: "Love & Lemons",
    host: "www.loveandlemons.com",
    cuisine: "Modern Vegetarian",
    priority: 1,
    strategy: "wordpress",
  },
  {
    name: "Cookie and Kate",
    host: "cookieandkate.com",
    cuisine: "Modern Vegetarian",
    priority: 2,
    strategy: "wordpress",
  },
  {
    name: "Ministry of Curry",
    host: "ministryofcurry.com",
    cuisine: "Indian",
    priority: 3,
    strategy: "wordpress",
  },
  {
    name: "Indian Healthy Recipes",
    host: "www.indianhealthyrecipes.com",
    cuisine: "Indian",
    priority: 4,
    strategy: "wordpress",
  },
  {
    name: "The Greek Foodie",
    host: "thegreekfoodie.com",
    cuisine: "Greek",
    priority: 5,
    strategy: "wordpress",
  },
  {
    name: "The Foodie Takes Flight",
    host: "thefoodietakesflight.com",
    cuisine: "Asian Vegan",
    priority: 6,
    strategy: "wordpress",
  },
  {
    name: "Forks Over Knives",
    host: "www.forksoverknives.com",
    cuisine: "Plant-Based",
    priority: 7,
    strategy: "wordpress",
  },
  {
    name: "Serious Eats",
    host: "www.seriouseats.com",
    cuisine: "Global",
    priority: 8,
    strategy: "homepage-search",
  },
];

const TRUSTED_HOSTS = new Set(TRUSTED_SOURCES.map((s) => s.host));
const DEFAULT_COUNT = 4;
const USER_AGENT = "NabuKitchenWeeklyInspiration/0.1 (+https://app.davideberle.com)";

function usage() {
  return `Usage:
  node projects/kitchen/web-inspiration/weekly-inspirations.mjs [options]

Options:
  --query <text>              Search query. Default: season-aware dinner query.
  --week <YYYY-Www>           Week id for provenance. Default: current ISO week.
  --count <n>                 Number of inspirations. Default: ${DEFAULT_COUNT}.
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
  const discovered = opts.urls.length > 0
    ? opts.urls.map((url) => ({ url, source: sourceForUrl(url) })).filter((c) => c.source)
    : await searchTrustedSources(opts.query, opts.count * 6, sourceFilter);

  const report = {
    week: opts.week,
    query: opts.query,
    requestedCount: opts.count,
    dryRun: !(opts.writeKitchen || opts.writeAppFiles || opts.writeAppDb),
    considered: discovered.length,
    imported: [],
    skipped: [],
    errors: [],
  };

  const picked = [];
  const seenUrls = new Set();
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

      const html = await fetchText(candidate.url);
      const extracted = extractRecipeFromHtml(html, candidate.url, source);
      if (!extracted) {
        report.skipped.push({ url: candidate.url, reason: "no recipe JSON-LD found" });
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
        url: candidate.url,
        image,
        kitchenPath: path.relative(WORKSPACE_DIR, path.join(KITCHEN_RECIPES_DIR, slug, "recipe.json")),
        appDb: !!opts.writeAppDb,
      };
      report.imported.push(imported);
      picked.push(imported);

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

export async function searchTrustedSources(query, limit = 24, sources = TRUSTED_SOURCES) {
  const perSource = Math.max(3, Math.ceil(limit / Math.max(1, sources.length)));
  const all = [];
  for (const source of sources.sort((a, b) => a.priority - b.priority)) {
    try {
      const results = await searchSource(source, query, perSource);
      all.push(...results.map((r) => ({ ...r, source })));
    } catch {
      // One source failing should not kill the weekly run.
    }
  }

  const seen = new Set();
  return all
    .filter((r) => r.url && isProbablyRecipeUrl(r.url))
    .filter((r) => {
      const key = normalizeUrl(r.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function searchSource(source, query, limit) {
  if (source.strategy === "wordpress") {
    return searchWordPress(source, query, limit);
  }
  return searchHomepageLinks(source, query, limit);
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

export function extractRecipeFromHtml(html, url, source) {
  const jsonLdBlocks = extractJsonLd(html);
  for (const block of jsonLdBlocks) {
    const recipes = findRecipeObjects(block);
    for (const recipe of recipes) {
      const normalized = normalizeRecipeLd(recipe, url, source);
      if (normalized) return normalized;
    }
  }
  return null;
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

function normalizeRecipeLd(recipe, url, source) {
  const name = cleanText(firstString(recipe.name));
  const ingredients = arrayOfStrings(recipe.recipeIngredient);
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
    ingredients,
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
    const text = cleanText(value.text || value.name || "");
    if (text) steps.push(prefix ? `${prefix}: ${text}` : text);
    if (value.itemListElement) visit(value.itemListElement, prefix);
  };
  visit(instructions);
  return [...new Set(steps)].filter((s) => s.length > 8);
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
      ingredients: extracted.ingredients.map((item) => ({ item, amount: null, unit: "" })),
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
  return {
    id: slug,
    name: extracted.name,
    source: {
      cookbook: "My Recipes",
      author: extracted.author || extracted.source.name,
      publication: `${extracted.source.name} · Web inspiration`,
    },
    cuisine: extracted.cuisine || inferCuisine(extracted.name, extracted.source),
    category: {
      dish_type: inferDishTypes(extracted),
      chapter: "",
      meal_role: "main",
    },
    servings: formatServings(extracted.yieldText, extracted.servings),
    time,
    intro: extracted.description || `Weekly web inspiration from ${extracted.source.name}.`,
    introduction: extracted.description || null,
    tips: `Source: ${extracted.url}. Imported as weekly web inspiration for ${week}.`,
    ingredients: extracted.ingredients.map((item) => ({
      item,
      amount: "",
      unit: "",
      group: "Ingredients",
    })),
    method: extracted.method,
    dietary: extracted.dietary,
    tags: {
      dietary: extracted.dietary,
      season: inferSeasons(extracted),
    },
    image,
    mealRole: "main",
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

function inferDishTypes(extracted) {
  const text = `${extracted.name} ${extracted.category ?? ""}`.toLowerCase();
  if (text.includes("soup") || text.includes("stew")) return ["soup", "main"];
  if (text.includes("salad")) return ["salad", "main"];
  if (text.includes("pasta") || text.includes("noodle")) return ["main", "pasta"];
  if (text.includes("curry") || text.includes("dal") || text.includes("dhal")) return ["main", "curry"];
  return ["main"];
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
  await client.execute({
    sql: `INSERT INTO recipes (id, data, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    args: [recipe.id, JSON.stringify(recipe), new Date().toISOString()],
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

  return known;
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
