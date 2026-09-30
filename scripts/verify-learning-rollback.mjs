// Release rollback gate (independent repair, 2026-09-30).
//
// Shows two things on isolated file databases, without touching production:
//   1. The previous production build (git 62a5dc42) is NOT a safe rollback
//      target once a chapter-4 record exists: its state module throws
//      "unknown visit v4" for such a mission (function-level and DB-level).
//   2. The candidate's forward-repair rollback IS safe: the same build served
//      with FAMILY_LEARNING_CONTENT_CAP=1 (version-1 content) renders the
//      child view and the parent evidence without throwing, offers nothing in
//      place of the parked chapter, rewrites nothing, and after removing the
//      cap the chapter resumes at the same stage and revision.
//
//   node scripts/verify-learning-rollback.mjs [--baseline 62a5dc42] [--out /tmp/dir]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASELINE = opt("--baseline", "62a5dc4221f3dbf8af8cad73826a8cb545222401");
const OUT = opt("--out", fs.mkdtempSync(path.join(os.tmpdir(), "learning-rollback-")));
fs.mkdirSync(OUT, { recursive: true });
const app = path.resolve(new URL(".", import.meta.url).pathname, "..");
const require = createRequire(path.join(app, "package.json"));
const { createClient } = require("@libsql/client");

// --- baseline modules straight from git (never from the working tree)
const baseDir = path.join(OUT, "baseline");
fs.mkdirSync(baseDir, { recursive: true });
execFileSync("sh", ["-c", `git -C "${app}" archive ${BASELINE} src/lib src/data/family-learning | tar -x -C "${baseDir}"`]);
const baseState = await import(path.join(baseDir, "src/lib/family-learning-state.ts"));
const baseContent = await import(path.join(baseDir, "src/lib/family-learning-content.ts"));
const baseDb = await import(path.join(baseDir, "src/lib/family-learning-db.ts"));
const baseV1 = baseContent.asLearningContent(JSON.parse(fs.readFileSync(path.join(baseDir, "src/data/family-learning/content/santiago-expedition-v1.json"), "utf8")));

// --- candidate modules from the working tree
const cState = await import(path.join(app, "src/lib/family-learning-state.ts"));
const cContent = await import(path.join(app, "src/lib/family-learning-content.ts"));
const cDb = await import(path.join(app, "src/lib/family-learning-db.ts"));
const v1 = cContent.asLearningContent(JSON.parse(fs.readFileSync(path.join(app, "src/data/family-learning/content/santiago-expedition-v1.json"), "utf8")));
const v2 = cContent.asLearningContent(JSON.parse(fs.readFileSync(path.join(app, "src/data/family-learning/content/santiago-expedition-v2.json"), "utf8")));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
};
const attempt = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// Build a mission that has started chapter 4 (v1+v2 completed under v1 content, then v4 under v2) in a fresh file DB through the candidate's real DB functions.
const dbPath = path.join(OUT, "nabu.db");
const client = createClient({ url: `file:${dbPath}` });
await cDb.ensureLearningTables(client);
let k = 0;
let t = Date.now() - 3 * 3600000;
const now = () => new Date((t += 60000));
async function step(op, content) {
  const view = await cDb.readChildView(client, "santiago", content, now());
  const out = await cDb.applyMutation(client, { child: "santiago", op, idempotencyKey: `rb-${(k += 1)}`, expectedRevision: view.revision }, content, now);
  if (out.status !== "applied") throw new Error(`${op.op}: ${out.status}`);
  return out;
}
for (const op of [
  { op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" },
  { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
  { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" },
  { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" },
  { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
  { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" },
]) await step(op, v1);
await cDb.writeParentSetting(client, "santiago", "keyboard_layout", "ch-de-qwertz");
for (const op of [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }]) await step(op, v2);
const before = await cDb.readChildView(client, "santiago", v2, now());
check("fixture: chapter 4 started under version-2 content (stage typing-course)", before.visit?.id === "v4" && before.visit.stage === "typing-course", { revision: before.revision, stage: before.visit?.stage });
const rowBefore = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);

// 1. Baseline build against this data: function-level and DB-level.
const state = await cDb.loadMissionState(client, "santiago", v2.contentId);
const baseFn = attempt(() => baseState.currentStage(state, baseV1));
check("HAZARD (documented): baseline currentStage throws for a started chapter 4", !baseFn.ok && /unknown visit v4/.test(baseFn.error), baseFn);
let baseDbResult;
try {
  await baseDb.readChildView(client, "santiago", baseV1, now());
  baseDbResult = { ok: true };
} catch (e) {
  baseDbResult = { ok: false, error: e.message };
}
check("HAZARD (documented): baseline readChildView on the candidate database throws — redeploying 62a5dc42 is not a rollback once v4 data exists", !baseDbResult.ok && /unknown visit v4/.test(baseDbResult.error), baseDbResult);
const rowAfterBaseline = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
check("the failed baseline read wrote nothing", rowAfterBaseline === rowBefore);

// 2. Candidate under the content cap (version-1 content): parked, readable, unchanged.
const capped = await cDb.readChildView(client, "santiago", v1, now());
check("cap: child view renders under v1 content without throwing; the chapter is parked (nothing offered instead)", capped.visit === null && capped.next.visit === null && capped.next.reason === "chapter-unavailable" && /nicht verfügbar/.test(capped.nextStep), { next: capped.next, nextStep: capped.nextStep, contentVersion: capped.contentVersion });
const evidence = await cDb.readEvidence(client, "santiago", v2.contentId, undefined, v1);
check("cap: parent evidence readable under v1 content; completions for v1/v2 present, v4 records intact, no new completion invented", evidence.state !== null && evidence.completions.length === 2 && evidence.state.visits.length === 3 && evidence.state.station.theme === "turtles", { completions: evidence.completions.map((c) => c.visitId), visits: evidence.state?.visits.map((v) => v.id) });
const rowAfterCap = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
check("cap: reads under v1 content rewrite nothing (state row byte-identical, no downgrade)", rowAfterCap === rowBefore);
const refused = await cDb.applyMutation(client, { child: "santiago", op: { op: "typing-course-continue" }, idempotencyKey: "rb-cap-1", expectedRevision: capped.revision }, v1, now);
check("cap: a chapter-4 op under v1 content is refused (stage not active), never applied", refused.status === "refused", refused.status);
const startRefused = await cDb.applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "rb-cap-2", expectedRevision: capped.revision }, v1, now);
check("cap: nothing else can be started while the chapter is parked", startRefused.status === "refused", startRefused.status);

// 3. Cap removed: chapter 4 resumes exactly.
const resumed = await cDb.readChildView(client, "santiago", v2, now());
check("cap removed: chapter 4 resumes at the same stage and revision with the same choice", resumed.visit?.id === "v4" && resumed.visit.stage === "typing-course" && resumed.revision === before.revision && resumed.station.theme === "turtles", { revision: resumed.revision, stage: resumed.visit?.stage });
const cont = await step({ op: "typing-course-continue" }, v2);
check("cap removed: the next op applies normally", cont.status === "applied" && cont.view.visit.stage === "EQ-STATION");

client.close();
const passed = results.filter((r) => r.ok).length;
const receipt = { baseline: BASELINE, out: OUT, passed, total: results.length, results };
fs.writeFileSync(path.join(OUT, "rollback-results.json"), JSON.stringify(receipt, null, 2));
console.log(`${passed}/${results.length} rollback checks passed; evidence in ${OUT}`);
process.exit(passed === results.length ? 0 : 1);
