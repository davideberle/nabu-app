#!/usr/bin/env node
/**
 * Repair/backfill persisted meal-plan records (Phase 3B).
 *
 * For every row in `meal_plans` this recomputes, via the PRODUCTION rules
 * imported from src/lib (never a local copy):
 *
 *  1. candidate bucket labels — `classifyPlannerBucket` is authoritative;
 *     persisted labels are overwritten when they disagree
 *  2. planner-facing candidate `recipeName`/`cuisine` — normalized from the
 *     resolved recipe (`normalizePlannerTitle` / `normalizePlannerCuisine`)
 *  3. day planning states — `normalizeDayPlanningStates`, so intentionally
 *     skipped days (dated skip-meal context) persist as `skipped` and stale
 *     skip markers on assigned days are cleared
 *
 * Candidates whose recipe fails the planner-main gate are REPORTED but kept
 * unless --drop-ineligible is passed; unresolvable recipe ids are always kept
 * unchanged (a repair must not invent or destroy facts).
 *
 * DRY-RUN IS THE DEFAULT — nothing is written without --write.
 *
 * Usage:
 *   node scripts/repair-meal-plans.mjs                     # dry-run, default DB
 *   node scripts/repair-meal-plans.mjs --db /tmp/copy.db   # dry-run, isolated copy
 *   node scripts/repair-meal-plans.mjs --write             # apply repairs
 *   node scripts/repair-meal-plans.mjs --drop-ineligible   # also drop gate-failing candidates
 *   node scripts/repair-meal-plans.mjs --json              # machine-readable summary
 *
 * The target database resolves in this order: --db <path>, then
 * TURSO_DATABASE_URL (+TURSO_AUTH_TOKEN), then the local nabu.db fallback.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import {
  classifyPlannerBucket,
  isMainPlannerCandidate,
  normalizePlannerCuisine,
  normalizePlannerTitle,
} from "../src/lib/meals.ts";
import { normalizeDayPlanningStates } from "../src/lib/meals-persistence.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");

function parseArgs(argv) {
  const args = { write: false, dropIneligible: false, json: false, db: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") args.write = true;
    else if (a === "--dry-run") args.write = false;
    else if (a === "--drop-ineligible") args.dropIneligible = true;
    else if (a === "--json") args.json = true;
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function buildUrl(args) {
  if (args.db) return `file:${args.db}`;
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const dir =
    process.env.NABU_DB_DIR ||
    (process.env.HOME
      ? `${process.env.HOME}/.openclaw/workspace/projects/companion-app/app`
      : "/tmp");
  return `file:${dir}/nabu.db`;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("See the header comment in scripts/repair-meal-plans.mjs for usage.");
  process.exit(0);
}

const url = buildUrl(args);
const client = createClient({
  url,
  authToken: args.db ? undefined : process.env.TURSO_AUTH_TOKEN,
});

const bundle = JSON.parse(
  readFileSync(join(appRoot, "src", "data", "recipes-bundle.json"), "utf8")
);
const bundleById = new Map(bundle.map((r) => [r.id, r]));

async function resolveRecipe(id) {
  const result = await client.execute({
    sql: "SELECT data FROM recipes WHERE id = ?",
    args: [id],
  });
  if (result.rows.length > 0) {
    try {
      return JSON.parse(result.rows[0]["data"]);
    } catch {
      return undefined;
    }
  }
  return bundleById.get(id);
}

const summary = {
  mode: args.write ? "write" : "dry-run",
  database: url.startsWith("file:") ? url : "turso",
  plansScanned: 0,
  plansNeedingRepair: 0,
  plansWritten: 0,
  bucketRelabels: [],
  metadataFixes: [],
  planningStateFixes: [],
  ineligibleCandidates: [],
  unresolvableCandidates: [],
};

const rows = await client.execute(
  "SELECT week, data FROM meal_plans ORDER BY week"
);

for (const row of rows.rows) {
  const week = row["week"];
  let plan;
  try {
    plan = JSON.parse(row["data"]);
  } catch {
    console.error(`! ${week}: unparseable plan JSON — skipped`);
    continue;
  }
  summary.plansScanned++;
  let changed = false;

  // 3. Day planning states — the exact production save-boundary rule.
  const normalized = normalizeDayPlanningStates(plan);
  if (normalized !== plan) {
    for (let i = 0; i < plan.days.length; i++) {
      const before = plan.days[i]?.planningState;
      const after = normalized.days[i]?.planningState;
      if (before !== after) {
        summary.planningStateFixes.push({ week, date: plan.days[i]?.date, from: before ?? null, to: after ?? null });
      }
    }
    plan = normalized;
    changed = true;
  }

  // 1 + 2. Candidate bucket labels and planner-facing metadata.
  const items = plan.candidateSet?.items;
  if (Array.isArray(items) && items.length > 0) {
    const repairedItems = [];
    for (const item of items) {
      if (!item || typeof item.recipeId !== "string" || !item.recipeId) {
        repairedItems.push(item);
        continue;
      }
      const recipe = await resolveRecipe(item.recipeId);
      if (!recipe) {
        summary.unresolvableCandidates.push({ week, recipeId: item.recipeId });
        repairedItems.push(item);
        continue;
      }

      if (!isMainPlannerCandidate(recipe)) {
        summary.ineligibleCandidates.push({ week, recipeId: item.recipeId, name: recipe.name });
        if (args.dropIneligible) {
          changed = true;
          continue;
        }
        repairedItems.push(item);
        continue;
      }

      const bucket = classifyPlannerBucket(recipe);
      const name = normalizePlannerTitle(recipe.name) || item.recipeName;
      const cuisine = item.cuisine !== undefined ? normalizePlannerCuisine(recipe) : undefined;

      const next = { ...item };
      if (item.bucket !== bucket) {
        summary.bucketRelabels.push({ week, recipeId: item.recipeId, from: item.bucket ?? null, to: bucket });
        next.bucket = bucket;
        changed = true;
      }
      if (name && item.recipeName !== name) {
        summary.metadataFixes.push({ week, recipeId: item.recipeId, field: "recipeName", from: item.recipeName ?? null, to: name });
        next.recipeName = name;
        changed = true;
      }
      if (cuisine !== undefined && item.cuisine !== cuisine) {
        summary.metadataFixes.push({ week, recipeId: item.recipeId, field: "cuisine", from: item.cuisine ?? null, to: cuisine });
        next.cuisine = cuisine;
        changed = true;
      }
      repairedItems.push(next);
    }
    plan = { ...plan, candidateSet: { ...plan.candidateSet, items: repairedItems } };
  }

  if (!changed) continue;
  summary.plansNeedingRepair++;

  if (args.write) {
    await client.execute({
      sql: "UPDATE meal_plans SET data = ?, updated_at = ? WHERE week = ?",
      args: [JSON.stringify(plan), new Date().toISOString(), week],
    });
    summary.plansWritten++;
  }
}

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\nRepair summary (${summary.mode}) against ${summary.database}`);
  console.log(`  plans scanned:          ${summary.plansScanned}`);
  console.log(`  plans needing repair:   ${summary.plansNeedingRepair}`);
  console.log(`  plans written:          ${summary.plansWritten}`);
  console.log(`  bucket relabels:        ${summary.bucketRelabels.length}`);
  for (const fix of summary.bucketRelabels) {
    console.log(`    ${fix.week} ${fix.recipeId}: ${fix.from ?? "∅"} → ${fix.to}`);
  }
  console.log(`  metadata fixes:         ${summary.metadataFixes.length}`);
  for (const fix of summary.metadataFixes) {
    console.log(`    ${fix.week} ${fix.recipeId}.${fix.field}: ${JSON.stringify(fix.from)} → ${JSON.stringify(fix.to)}`);
  }
  console.log(`  planning-state fixes:   ${summary.planningStateFixes.length}`);
  for (const fix of summary.planningStateFixes) {
    console.log(`    ${fix.week} ${fix.date}: ${fix.from ?? "∅"} → ${fix.to}`);
  }
  console.log(`  ineligible candidates:  ${summary.ineligibleCandidates.length}${args.dropIneligible ? " (dropped)" : " (kept — use --drop-ineligible to remove)"}`);
  for (const item of summary.ineligibleCandidates) {
    console.log(`    ${item.week} ${item.recipeId} (${item.name})`);
  }
  console.log(`  unresolvable candidates: ${summary.unresolvableCandidates.length} (kept unchanged)`);
  if (!args.write) {
    console.log("\nDry run — no rows were written. Re-run with --write to apply.");
  }
}

process.exit(0);
