#!/usr/bin/env node
// Apply only deterministic, high-confidence image repairs from an audit artifact.
//   node scripts/audit/apply-image-repairs.mjs --audit docs/audits/recipe-image-audit.json [--dry-run] [--out docs/audits/recipe-image-repairs.json]
// Rule R1: an assigned local image whose smallest side is < 150px cannot be a recipe
// photograph (visually confirmed 2026-09-16: dietary icon strips / glyphs). The app
// recipe's image is set to null. The asset file is left in place (orphan) for traceability.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { selectRepairs } from "./audit-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true] : []).filter(Boolean));
const audit = JSON.parse(readFileSync(resolve(args.audit || join(APP_ROOT, "docs", "audits", "recipe-image-audit.json")), "utf8"));
const OUT = resolve(args.out || join(APP_ROOT, "docs", "audits", "recipe-image-repairs.json"));
const repairs = selectRepairs(audit);
const applied = [];
for (const r of repairs) {
  const p = join(APP_ROOT, "src", "data", "recipes", `${r.recipeId}.json`);
  const rec = JSON.parse(readFileSync(p, "utf8"));
  if (rec.image !== r.image) { console.error(`skip ${r.recipeId}: image is now ${rec.image}`); continue; }
  if (!args["dry-run"]) { rec.image = null; writeFileSync(p, JSON.stringify(rec, null, 2) + "\n"); }
  applied.push(r);
}
const record = { appliedAt: new Date().toISOString(), dryRun: !!args["dry-run"], rule: "R1 min-side<150px assigned image is not a photograph -> image:null", count: applied.length, repairs: applied };
if (!args["dry-run"]) writeFileSync(OUT, JSON.stringify(record, null, 1));
console.log(JSON.stringify({ selected: repairs.length, applied: applied.length, dryRun: !!args["dry-run"], out: OUT }));
