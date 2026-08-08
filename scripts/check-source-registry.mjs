#!/usr/bin/env node
/**
 * Guard: the deployable source registry must match the Kitchen-owned canonical
 * file it is a projection of.
 *
 * Canonical: projects/kitchen/web-inspiration/source-registry.json
 * Projection: src/lib/planner-sources.ts
 *
 * The projection exists because Vercel does not have the kitchen project
 * checked out. This check is what stops the two from drifting apart again —
 * which is exactly how the old importer allowlist and recipe-sources.json ended
 * up naming different sites.
 *
 * When the kitchen project is not present (a Vercel build, a fresh clone of
 * just this app), the check reports that and exits 0 rather than failing a
 * build over a file it cannot see.
 *
 * Run: node scripts/check-source-registry.mjs
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { PLANNER_SOURCES, SOURCE_REGISTRY_VERSION, SHELF_TARGET, WEB_TARGET } from "../src/lib/planner-sources.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, "..");
const WORKSPACE_DIR = resolve(APP_DIR, "../../..");
const CANONICAL = join(WORKSPACE_DIR, "projects/kitchen/web-inspiration/source-registry.json");

if (!existsSync(CANONICAL)) {
  console.log(`source-registry: kitchen project not present at ${CANONICAL} — skipping projection check.`);
  process.exit(0);
}

const canonical = JSON.parse(readFileSync(CANONICAL, "utf8"));
const problems = [];

if (canonical.registryVersion !== SOURCE_REGISTRY_VERSION) {
  problems.push(
    `registryVersion mismatch: kitchen "${canonical.registryVersion}" vs projection "${SOURCE_REGISTRY_VERSION}"`,
  );
}
if (canonical.policy?.shelfTarget?.min !== SHELF_TARGET.min || canonical.policy?.shelfTarget?.max !== SHELF_TARGET.max) {
  problems.push("shelfTarget mismatch between kitchen policy and projection");
}
if (canonical.policy?.webTarget?.min !== WEB_TARGET.min || canonical.policy?.webTarget?.max !== WEB_TARGET.max) {
  problems.push("webTarget mismatch between kitchen policy and projection");
}

/**
 * Every field that changes what discovery actually *does*. A URL match alone
 * is not enough: a drifted `marker`, `linkPattern`, `extraction.fallback` or
 * seasonal window changes behaviour while the two files still look identical
 * to a shallow check.
 */
const BEHAVIOUR_FIELDS = [
  "name",
  "host",
  "tier",
  "lane",
  "cuisine",
  "cadence",
  "visibleCap",
  "automatic",
  "searchStrategy",
  "extraction",
  "seasons",
];

/** Editorial surfaces, compared whole and in order. */
function normalizeSurfaces(surfaces) {
  return (surfaces ?? []).map((surface) => ({
    kind: surface?.kind ?? null,
    url: surface?.url ?? null,
    marker: surface?.marker ?? null,
    linkPattern: surface?.linkPattern ?? null,
  }));
}

const byId = new Map(PLANNER_SOURCES.map((source) => [source.id, source]));
for (const source of canonical.sources ?? []) {
  const projected = byId.get(source.id);
  if (!projected) {
    problems.push(`missing from projection: ${source.id}`);
    continue;
  }
  byId.delete(source.id);
  for (const field of BEHAVIOUR_FIELDS) {
    // `undefined` and an absent key mean the same thing on both sides.
    const kitchen = JSON.stringify(source[field] ?? null);
    const mirror = JSON.stringify(projected[field] ?? null);
    if (kitchen !== mirror) {
      problems.push(`${source.id}.${field}: kitchen ${kitchen} vs projection ${mirror}`);
    }
  }
  const canonicalSurfaces = JSON.stringify(normalizeSurfaces(source.editorialSurfaces));
  const projectedSurfaces = JSON.stringify(normalizeSurfaces(projected.editorialSurfaces));
  if (canonicalSurfaces !== projectedSurfaces) {
    problems.push(
      `${source.id}.editorialSurfaces differ (kind/url/marker/linkPattern): kitchen ${canonicalSurfaces} vs projection ${projectedSurfaces}`,
    );
  }
}
for (const id of byId.keys()) {
  problems.push(`present in projection but not in the kitchen registry: ${id}`);
}

if (problems.length > 0) {
  console.error("source-registry: projection is out of sync with the Kitchen registry.\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nUpdate projects/kitchen/web-inspiration/source-registry.json first, then src/lib/planner-sources.ts.");
  process.exit(1);
}

console.log(`source-registry: projection matches the Kitchen registry (${canonical.sources.length} sources, ${SOURCE_REGISTRY_VERSION}).`);
