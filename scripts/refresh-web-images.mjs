#!/usr/bin/env node
/**
 * Refresh the persisted image of a week's already-staged web ideas.
 *
 * Why this exists. The image-ingestion fix (Kitchen DESIGN.md §4.3, "Shelf
 * presentation contract") changes which rendition a *new* import picks. It does
 * nothing for a week that is already staged — 2026-W33 was persisted with
 * Cookie and Kate thumbnails at 225x225 and BBC Good Food crops at 440x400, and
 * the only way to improve those with the existing tooling would be to reroll
 * the shelf, which would move David's assignments and lose the week.
 *
 * So this does exactly one thing: for each staged web recipe of one week, look
 * at the source page again, pick the largest trustworthy rendition of the same
 * photograph, and — only if it is genuinely bigger than what is stored —
 * replace the stored image. Nothing else about the week is touched: no
 * candidate is added, removed or reordered, no day assignment moves, no
 * provenance is rewritten beyond the image it points at.
 *
 * Safety properties this run depends on:
 *
 *   dry-run by default    writes require --yes
 *   fails closed          a missing auth token, a missing blob token for a
 *                         blob-hosted image, or an untrusted source URL stops
 *                         the run rather than degrading it
 *   idempotent            a second run measures the same images, finds nothing
 *                         larger, and reports `unchanged`
 *   atomic per recipe     the recipe row, the provenance row and the week's
 *                         candidate item are updated in one batch, guarded by
 *                         the plan's `updated_at` so a concurrent planner save
 *                         is never clobbered
 *
 * Usage:
 *   node scripts/refresh-web-images.mjs --week 2026-W33
 *   node scripts/refresh-web-images.mjs --week 2026-W33 --yes --json
 *   node scripts/refresh-web-images.mjs --week 2026-W33 --recipe some-slug --yes
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertTrustedUrl,
  closeAppDbClient,
  downloadImageCandidate,
  extractRecipeFromHtml,
  fetchText,
  getAppDbClient,
  sourceForUrl,
  storeRecipeImageBytes,
} from "./weekly-inspirations.mjs";
import {
  collectImageCandidates,
  selectRecipeImage,
} from "../src/lib/recipe-image-selection.ts";
import { readImageDimensions } from "../src/lib/image-dimensions.ts";

const WEEK_PATTERN = /^\d{4}-W\d{2}$/;
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PUBLIC_RECIPES_DIR = path.join(APP_DIR, "public/recipes");

function usage() {
  return `Usage:
  node scripts/refresh-web-images.mjs --week <YYYY-Www> [options]

Options:
  --week <YYYY-Www>   Week whose staged web ideas should be re-imaged. Required.
  --recipe <id>       Limit to one staged recipe. May be repeated.
  --yes               Perform writes. Without it the run is a dry run.
  --json              Print a machine-readable report.
  --help              Show this help.

Dry-run is the default: it still fetches and measures, so the report tells you
exactly what a --yes run would change.`;
}

function parseArgs(argv) {
  const args = { week: "", recipes: [], yes: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--week") args.week = argv[++i];
    else if (a === "--recipe") args.recipes.push(argv[++i]);
    else if (a === "--yes") args.yes = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.help) return args;
  if (!WEEK_PATTERN.test(String(args.week))) {
    throw new Error(`--week must look like YYYY-Www, got: ${args.week || "(missing)"}`);
  }
  return args;
}

/**
 * Refuse to run at all rather than run half-configured.
 *
 * A remote database without its auth token, or a blob-hosted image with no blob
 * token, are both states where "carry on" means writing something wrong into
 * production — a local `/recipes/…` path into a Turso row that Vercel cannot
 * serve, for instance.
 */
function assertEnvironment({ write }) {
  if (process.env.TURSO_DATABASE_URL && !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("TURSO_DATABASE_URL is set without TURSO_AUTH_TOKEN — refusing to run.");
  }
  if (write && process.env.TURSO_DATABASE_URL && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "Writing against a remote database needs BLOB_READ_WRITE_TOKEN so images land in Blob storage, not public/.",
    );
  }
}

async function tableColumns(client, table) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(info.rows.map((row) => String(row.name)));
}

/** The week's staged web ideas, on either shape of the provenance table. */
async function loadStagedForWeek(client, week, only) {
  const columns = await tableColumns(client, "web_recipe_inspirations");
  if (columns.size === 0) return { rows: [], columns };
  const result = await client.execute({
    sql: "SELECT * FROM web_recipe_inspirations WHERE week = ?",
    args: [week],
  });
  const rows = result.rows
    .map((row) => ({
      recipeId: String(row.recipe_id ?? ""),
      sourceUrl: String(row.source_url ?? ""),
      sourceName: String(row.source_name ?? ""),
      image: row.image == null ? null : String(row.image),
    }))
    .filter((row) => row.recipeId && row.sourceUrl)
    .filter((row) => only.length === 0 || only.includes(row.recipeId))
    .sort((a, b) => a.recipeId.localeCompare(b.recipeId));
  return { rows, columns };
}

/**
 * Measure what is stored today, so "bigger" is a fact and not an assumption.
 *
 * Both storage shapes are read: a Blob URL over the network, and a local
 * `/recipes/…` path off disk. Reading the local one matters for idempotence —
 * an unmeasurable stored image counts as 0×0, and the run would then rewrite a
 * perfectly good file on every pass.
 */
async function measureStoredImage(image) {
  if (!image) return null;
  if (/^https:\/\//.test(image)) {
    const downloaded = await downloadImageCandidate(image).catch(() => null);
    return downloaded ? readImageDimensions(downloaded.bytes) : null;
  }
  const local = /^\/recipes\/([\w.-]+)$/.exec(image);
  if (!local) return null;
  try {
    const bytes = await fs.readFile(path.join(APP_PUBLIC_RECIPES_DIR, local[1]));
    return readImageDimensions(bytes);
  } catch {
    return null;
  }
}

/** Candidates for the same photograph, from the live source page. */
async function candidatesForSource(sourceUrl) {
  assertTrustedUrl(sourceUrl);
  const source = sourceForUrl(sourceUrl);
  const html = await fetchText(sourceUrl);
  const extracted = extractRecipeFromHtml(html, sourceUrl, source);
  if (extracted?.imageCandidates?.length) return extracted.imageCandidates;
  // The page may have been restructured since the import. Open Graph alone is
  // still the page's own claim about its picture, and every candidate is still
  // dimension-checked before anything is stored.
  return collectImageCandidates({ html, pageUrl: sourceUrl });
}

/**
 * Rewrite one candidate item's image inside a persisted week, leaving every
 * other byte of the plan alone.
 *
 * Returns null when the plan does not mention the recipe, which is a normal
 * outcome: a staged idea that never made the visible shelf still gets its
 * recipe row refreshed.
 */
function planWithRefreshedImage(plan, recipeId, image) {
  const items = plan?.candidateSet?.items;
  if (!Array.isArray(items)) return null;
  let changed = false;
  const next = items.map((item) => {
    if (item?.recipeId !== recipeId || item.image === image) return item;
    changed = true;
    return { ...item, image };
  });
  if (!changed) return null;
  return { ...plan, candidateSet: { ...plan.candidateSet, items: next } };
}

async function refreshWeek(opts) {
  assertEnvironment({ write: opts.yes });
  const client = getAppDbClient();

  const { rows: staged, columns: provenanceColumns } = await loadStagedForWeek(client, opts.week, opts.recipes);
  const recipeColumns = await tableColumns(client, "recipes");

  const planRow = await client.execute({
    sql: "SELECT data, updated_at FROM meal_plans WHERE week = ?",
    args: [opts.week],
  });
  const planData = planRow.rows.length > 0 ? String(planRow.rows[0].data) : null;
  const planUpdatedAt = planRow.rows.length > 0 ? planRow.rows[0].updated_at ?? null : null;

  const report = {
    week: opts.week,
    dryRun: !opts.yes,
    staged: staged.length,
    refreshed: [],
    unchanged: [],
    skipped: [],
    errors: [],
  };

  for (const record of staged) {
    try {
      const recipeRow = await client.execute({
        sql: "SELECT data FROM recipes WHERE id = ?",
        args: [record.recipeId],
      });
      if (recipeRow.rows.length === 0) {
        report.skipped.push({ recipeId: record.recipeId, reason: "no recipe row" });
        continue;
      }
      const recipe = JSON.parse(String(recipeRow.rows[0].data));
      const storedSize = await measureStoredImage(recipe.image);

      const candidates = await candidatesForSource(record.sourceUrl);
      const selection = await selectRecipeImage(candidates, downloadImageCandidate);
      if (!selection.chosen) {
        report.skipped.push({
          recipeId: record.recipeId,
          reason: "no rendition cleared the card floor",
          considered: selection.considered,
        });
        continue;
      }

      const chosen = selection.chosen;
      const storedWidth = storedSize?.width ?? 0;
      const storedHeight = storedSize?.height ?? 0;
      // Strictly larger in both directions. Equal-or-smaller is left alone, and
      // that is what makes a second run a no-op.
      if (chosen.width <= storedWidth && chosen.height <= storedHeight) {
        report.unchanged.push({
          recipeId: record.recipeId,
          stored: storedSize ? `${storedWidth}x${storedHeight}` : "unmeasured",
          best: `${chosen.width}x${chosen.height}`,
        });
        continue;
      }

      const entry = {
        recipeId: record.recipeId,
        source: record.sourceName,
        from: storedSize ? `${storedWidth}x${storedHeight}` : "unmeasured",
        to: `${chosen.width}x${chosen.height}`,
        imageSource: chosen.url,
        previousImage: recipe.image ?? null,
      };

      if (!opts.yes) {
        report.refreshed.push({ ...entry, applied: false });
        continue;
      }

      const image = await storeRecipeImageBytes(record.recipeId, chosen.bytes, chosen.contentType, chosen.url);

      // One batch. The recipe row, the provenance image and the week's card all
      // describe the same fact; a partial write would leave the shelf showing a
      // thumbnail for an image that is no longer there.
      const statements = [];

      // Provenance keeps its source url, name, discovery and Keep state — only
      // the denormalized image pointer moves.
      recipe.image = image;
      const recipeSets = ["data = ?"];
      const recipeArgs = [JSON.stringify(recipe)];
      if (recipeColumns.has("updated_at")) {
        recipeSets.push("updated_at = ?");
        recipeArgs.push(new Date().toISOString());
      }
      statements.push({
        sql: `UPDATE recipes SET ${recipeSets.join(", ")} WHERE id = ?`,
        args: [...recipeArgs, record.recipeId],
      });

      if (provenanceColumns.has("image")) {
        statements.push({
          sql: "UPDATE web_recipe_inspirations SET image = ? WHERE recipe_id = ? AND week = ?",
          args: [image, record.recipeId, opts.week],
        });
      }

      const nextPlan = planData ? planWithRefreshedImage(JSON.parse(planData), record.recipeId, image) : null;
      if (nextPlan) {
        // Guarded by `updated_at` and deliberately not bumping it: the week's
        // meaning has not changed, only the picture on one card, and a planner
        // save that landed since this run started must win.
        statements.push({
          sql: "UPDATE meal_plans SET data = ? WHERE week = ? AND updated_at IS ?",
          args: [JSON.stringify(nextPlan), opts.week, planUpdatedAt],
        });
      }

      const results = await client.batch(statements, "write");
      const planStatementIndex = nextPlan ? statements.length - 1 : -1;
      const planUpdated = planStatementIndex >= 0 ? (results[planStatementIndex]?.rowsAffected ?? 0) > 0 : false;
      if (nextPlan && !planUpdated) {
        report.errors.push({
          recipeId: record.recipeId,
          message: "the week was saved by someone else while this ran — re-run to update its card",
        });
      }

      report.refreshed.push({ ...entry, applied: true, image, planCardUpdated: planUpdated });
    } catch (error) {
      report.errors.push({
        recipeId: record.recipeId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${usage()}`);
    process.exit(1);
  }
  if (args.help) {
    console.log(usage());
    return;
  }

  let report;
  try {
    report = await refreshWeek(args);
  } finally {
    await closeAppDbClient();
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.dryRun ? "DRY RUN — " : ""}week ${report.week}: ${report.staged} staged web idea(s)`);
    for (const entry of report.refreshed) {
      console.log(`  ${entry.applied ? "refreshed" : "would refresh"} ${entry.recipeId}: ${entry.from} → ${entry.to}`);
      console.log(`    from ${entry.imageSource}`);
    }
    for (const entry of report.unchanged) {
      console.log(`  unchanged ${entry.recipeId}: stored ${entry.stored}, best available ${entry.best}`);
    }
    for (const entry of report.skipped) {
      console.log(`  skipped ${entry.recipeId}: ${entry.reason}`);
    }
    for (const entry of report.errors) {
      console.error(`  ERROR ${entry.recipeId}: ${entry.message}`);
    }
  }

  process.exit(report.errors.length > 0 ? 1 : 0);
}

// Only run when this file *is* the entry point, so the pure helpers below can
// be imported by `node --test` without the script executing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { parseArgs, planWithRefreshedImage, assertEnvironment, refreshWeek };
