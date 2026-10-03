#!/usr/bin/env node
// Build-boundary verification of the reviewed planner evidence ledger against
// the deployable recipe records (Kitchen DESIGN.md §4.1 "Reviewed planner
// evidence"). Runs in `prebuild`; fails closed.
//
//   - every category correction: the record exists and carries exactly the
//     reviewed category (meal_role, dish_type, and chapter when pinned);
//   - every category hold (keep / unresolved): the record still carries its
//     original category — a hold is never silently relabelled;
//   - every planner exception: the record exists, declares the reviewed role,
//     and its full projected digest equals the attested digest. A content edit
//     without a fresh review stops the build here instead of activating a
//     stale exception (or silently losing it) in production.
//
// Run: node scripts/check-planner-evidence.mjs

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReviewedPlannerEvidenceRegistry,
  canonicalRecipeDigest,
} from "../src/lib/planner-evidence.ts";

const here = dirname(fileURLToPath(import.meta.url));
const recipesDir = resolve(here, "..", "src", "data", "recipes");
const mirror = resolve(here, "..", "src", "data", "kitchen", "reviewed-planner-evidence.json");

const registry = assertReviewedPlannerEvidenceRegistry(JSON.parse(readFileSync(mirror, "utf8")));
const problems = [];

function loadRecord(id) {
  const path = join(recipesDir, `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameCategory(actual, expected) {
  if (!actual || typeof actual !== "object") return false;
  if (actual.meal_role !== expected.meal_role) return false;
  if (JSON.stringify(actual.dish_type) !== JSON.stringify(expected.dish_type)) return false;
  if (expected.chapter !== undefined && actual.chapter !== expected.chapter) return false;
  return true;
}

for (const entry of registry.categoryCorrections) {
  const record = loadRecord(entry.id);
  if (!record) problems.push(`correction ${entry.id}: deployable record missing`);
  else if (!sameCategory(record.category, entry.category)) {
    problems.push(`correction ${entry.id}: category ${JSON.stringify(record.category)} is not the reviewed ${JSON.stringify(entry.category)}`);
  }
}
for (const entry of registry.categoryHolds) {
  const record = loadRecord(entry.id);
  if (!record) problems.push(`hold ${entry.id}: deployable record missing`);
  else if (!sameCategory(record.category, entry.category)) {
    problems.push(`hold ${entry.id} (${entry.decision}): category changed to ${JSON.stringify(record.category)} without review`);
  }
}
for (const entry of registry.plannerExceptions) {
  const record = loadRecord(entry.id);
  if (!record) {
    problems.push(`exception ${entry.id}: deployable record missing`);
    continue;
  }
  if (record.category?.meal_role !== entry.reviewedRole) {
    problems.push(`exception ${entry.id}: record declares meal_role ${record.category?.meal_role}, reviewed ${entry.reviewedRole}`);
  }
  const digest = canonicalRecipeDigest(record);
  if (digest !== entry.projectedRecipeSha256) {
    problems.push(`exception ${entry.id}: projected record digest ${digest} ≠ attested ${entry.projectedRecipeSha256} (content changed since review)`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`check-planner-evidence: ${problem}`);
  process.exit(1);
}
console.log(
  `check-planner-evidence: OK — ${registry.categoryCorrections.length} corrections, ${registry.categoryHolds.length} holds, ${registry.plannerExceptions.length} exceptions verified against src/data/recipes.`,
);
