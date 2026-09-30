// Follow-on rollback gate (2026-09-30): the released build `e772c1b8` must be
// able to read every row this candidate writes (no schema change, no
// MissionState field), and the candidate must keep the release's cap rollback
// (ROLLBACK-CONTRACT §2) while never offering the retired v3.
//
//   node scripts/verify-learning-followon-rollback.mjs [--baseline e772c1b8] [--out /tmp/dir]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASELINE = opt("--baseline", "e772c1b8c251e16a176886681520ae337df58a0d");
const OUT = opt("--out", fs.mkdtempSync(path.join(os.tmpdir(), "learning-followon-rollback-")));
fs.mkdirSync(OUT, { recursive: true });
const app = path.resolve(new URL(".", import.meta.url).pathname, "..");
const require = createRequire(path.join(app, "package.json"));
const { createClient } = require("@libsql/client");

const baseDir = path.join(OUT, "baseline");
fs.mkdirSync(baseDir, { recursive: true });
execFileSync("sh", ["-c", `git -C "${app}" archive ${BASELINE} src/lib src/data/family-learning | tar -x -C "${baseDir}"`]);
const baseState = await import(path.join(baseDir, "src/lib/family-learning-state.ts"));
const baseContent = await import(path.join(baseDir, "src/lib/family-learning-content.ts"));
const baseDb = await import(path.join(baseDir, "src/lib/family-learning-db.ts"));
const baseV2 = baseContent.asLearningContent(JSON.parse(fs.readFileSync(path.join(baseDir, "src/data/family-learning/content/santiago-expedition-v2.json"), "utf8")));

const cContent = await import(path.join(app, "src/lib/family-learning-content.ts"));
const cDb = await import(path.join(app, "src/lib/family-learning-db.ts"));
const cVoc = await import(path.join(app, "src/lib/family-learning-vocabulary.ts"));
const v1 = cContent.asLearningContent(JSON.parse(fs.readFileSync(path.join(app, "src/data/family-learning/content/santiago-expedition-v1.json"), "utf8")));
const v2 = cContent.asLearningContent(JSON.parse(fs.readFileSync(path.join(app, "src/data/family-learning/content/santiago-expedition-v2.json"), "utf8")));
const inventory = cVoc.asVocabularyInventory(JSON.parse(fs.readFileSync(path.join(app, "src/data/family-learning/content/vocabulary-inventory-v1.json"), "utf8")), v2);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
};

// Content parity: the baseline's content files are byte-identical to the candidate's mirrors (only the inventory is new).
for (const rel of ["content/santiago-expedition-v1.json", "content/santiago-expedition-v2.json", "schema.sql"]) {
  const a = fs.readFileSync(path.join(baseDir, "src/data/family-learning", rel));
  const b = fs.readFileSync(path.join(app, "src/data/family-learning", rel));
  check(`content parity: ${rel} unchanged since ${BASELINE.slice(0, 8)}`, a.equals(b));
}
check("schema: no new statements (the candidate adds no table)", JSON.stringify((await import(path.join(baseDir, "src/data/family-learning/schema.generated.ts"))).FAMILY_LEARNING_SCHEMA_STATEMENTS) === JSON.stringify((await import(path.join(app, "src/data/family-learning/schema.generated.ts"))).FAMILY_LEARNING_SCHEMA_STATEMENTS));

// Candidate writes a full history: production-shaped v1/v2 with language, then the chapter to completion.
const dbPath = path.join(OUT, "nabu.db");
const client = createClient({ url: `file:${dbPath}` });
await cDb.ensureLearningTables(client);
let k = 0;
let t = Date.UTC(2026, 8, 29, 13, 28, 0);
const now = () => new Date((t += 60000));
async function step(op, content) {
  const view = await cDb.readChildView(client, "santiago", content, now(), { timeZone: "Europe/Zurich", vocabulary: inventory });
  const out = await cDb.applyMutation(client, { child: "santiago", op, idempotencyKey: `fr-${(k += 1)}`, expectedRevision: view.revision, context: { erasureGeneration: view.erasureGeneration, visit: view.visit ? { id: view.visit.id, startedAt: view.visit.startedAt } : null } }, content, now, { timeZone: "Europe/Zurich", vocabulary: inventory });
  if (out.status !== "applied") throw new Error(`${op.op}: ${out.status} ${out.message ?? ""}`);
  return out;
}
const lang = (segmentId, stepId, response, modality) => ({ op: "language-step", segmentId, stepId, response, modality });
for (const op of [
  { op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" },
  { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
  { op: "explain", text: "Ich habe geteilt.", modality: "typed" },
  lang("LANG-EN-WATER", "listen", "", "listen"), lang("LANG-EN-WATER", "pick", "water", "word-choice"), lang("LANG-EN-WATER", "produce", "water", "typed"), lang("LANG-EN-WATER", "reuse", "tools", "word-choice"),
  { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" },
  { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
  lang("LANG-ES-AGUA", "listen", "", "listen"), lang("LANG-ES-AGUA", "pick", "agua", "word-choice"), lang("LANG-ES-AGUA", "produce", "agua", "typed"), lang("LANG-ES-AGUA", "reuse", "herramientas", "word-choice"),
  { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" },
]) await step(op, v1);
const twoVisits = await cDb.readChildView(client, "santiago", v2, now(), { timeZone: "Europe/Zurich", vocabulary: inventory });
check("candidate: after two visits the chapter is offered as Visit 3 (v4), never v3, no date", twoVisits.next.visit === "v4" && twoVisits.next.ordinal === 3 && twoVisits.next.availableAt === null && twoVisits.delayedCheck?.status === "retired", twoVisits.next);
t = Date.UTC(2026, 9, 6, 9, 0, 0); // past the former due date
const later = await cDb.readChildView(client, "santiago", v2, now(), { timeZone: "Europe/Zurich", vocabulary: inventory });
check("candidate: past the former due date (6 Oct) still the chapter, never v3", later.next.visit === "v4" && later.delayedCheck?.status === "retired");

// 1. Baseline reads the candidate-written two-visit row (before v4): same next, no throw, nothing written.
const rowA = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
let baseView;
try {
  baseView = await baseDb.readChildView(client, "santiago", baseV2, now());
} catch (e) {
  baseView = { error: e.message };
}
// Behavioural rollback only: the released build applies ITS rule to the same rows (past the former due date it offers the
// old v3 again). That is the documented consequence of redeploying it — a rule change, never a read failure or data hazard.
check(`baseline ${BASELINE.slice(0, 8)}: reads the candidate-written two-visit row without throwing (it applies its own old rule: v3 or v4)`, !baseView.error && (baseView.next?.visit === "v4" || baseView.next?.visit === "v3"), baseView.error ?? baseView.next);
const rowA2 = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
check("baseline read wrote nothing to the mission row", rowA === rowA2);

// 2. Candidate completes the chapter; baseline reads the finished row and the parent evidence.
for (const op of [
  { op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }, { op: "skip-stage", stage: "typing-course", reason: "child" },
  { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" },
  lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara", "typed"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice"),
  { op: "build-station", spot: "rocks" }, { op: "save-log", text: "Die Station steht." }, { op: "skip-stage", stage: "log-revise", reason: "child" }, { op: "skip-stage", stage: "log-transfer", reason: "child" }, { op: "summary-seen" },
  { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } },
]) await step(op, v2);
const done = await cDb.readChildView(client, "santiago", v2, now(), { timeZone: "Europe/Zurich", vocabulary: inventory });
check("candidate: chapter finished — all visits done, strip total 3, Visit 3 label, no v3 record", done.next.reason === "all-visits-done" && done.progress.completedTotal === 3 && done.progress.completed[2].label === "Besuch 3 — Die Beobachtungsstation" && !done.progress.completed.some((c) => c.visit === "v3"), done.progress.completed.map((c) => [c.visit, c.ordinal]));
const rowB = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
const stateKeys = Object.keys(JSON.parse(rowB)).sort();
check("candidate row has exactly the released state keys (no new MissionState field)", JSON.stringify(stateKeys) === JSON.stringify(["base", "child", "contentVersion", "createdAt", "currentVisit", "explanations", "language", "logRevisions", "math", "missionId", "modelShownAt", "pages", "revision", "station", "stationModelShownAt", "teachingFirstAt", "transfers", "typing", "updatedAt", "upgradedAt", "visits"]), stateKeys);
let baseDone;
try {
  baseDone = await baseDb.readChildView(client, "santiago", baseV2, now());
} catch (e) {
  baseDone = { error: e.message };
}
check("baseline reads the finished-chapter row without throwing", !baseDone.error && baseDone.visit === null, baseDone.error ?? { next: baseDone.next });
let baseEvidence;
try {
  baseEvidence = await baseDb.readEvidence(client, "santiago", baseV2.contentId, undefined, baseV2);
} catch (e) {
  baseEvidence = { error: e.message };
}
check("baseline parent evidence reads every row (3 completions, the candidate's reviews at the same REVIEW_VERSION, no refresh needed)", !baseEvidence.error && baseEvidence.completions.length === 3 && baseEvidence.completions.every((c) => c.derivation.status === "current"), baseEvidence.error ?? baseEvidence.completions?.map((c) => [c.visitId, c.derivation.status]));
const rowB2 = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
const reviewsB2 = JSON.stringify((await client.execute("SELECT completion_id, review_json FROM family_learning_completions WHERE child_id = 'santiago' ORDER BY completion_id")).rows);
check("baseline reads wrote nothing (state row byte-identical)", rowB === rowB2);
const candidateEvidence = await cDb.readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
const reviewsB3 = JSON.stringify((await client.execute("SELECT completion_id, review_json FROM family_learning_completions WHERE child_id = 'santiago' ORDER BY completion_id")).rows);
check("candidate evidence read after the baseline read rewrites no review (byte-identical review rows)", reviewsB2 === reviewsB3 && candidateEvidence.vocabulary.observations.length === 12, { observations: candidateEvidence.vocabulary?.observations.length });

// 3. Cap rollback on the candidate (finished chapter): parked/complete, nothing offered, nothing written.
const capped = await cDb.readChildView(client, "santiago", v1, now(), { timeZone: "Europe/Zurich", vocabulary: inventory });
check("cap (v1 content): finished chapter → nothing further offered (no-further-visit-served), never v3, strip total 3", capped.next.visit === null && capped.next.reason === "no-further-visit-served" && capped.progress.completedTotal === 3 && capped.delayedCheck?.status === "retired", capped.next);
const rowC = String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
check("cap read wrote nothing", rowC === rowB);
const cappedEvidence = await cDb.readEvidence(client, "santiago", v2.contentId, undefined, v1, inventory);
check("cap: parent evidence readable; ledger serves only the v1 contexts (station words: no opportunity)", cappedEvidence.completions.length === 3 && cappedEvidence.vocabulary.entries.find((e) => e.entryId === "ES-LAMPARA").dimensions.recognition.status === "no-opportunity");

client.close();
const passed = results.filter((r) => r.ok).length;
fs.writeFileSync(path.join(OUT, "followon-rollback-results.json"), JSON.stringify({ baseline: BASELINE, out: OUT, passed, total: results.length, results }, null, 2));
console.log(`${passed}/${results.length} follow-on rollback checks passed; evidence in ${OUT}`);
process.exit(passed === results.length ? 0 : 1);
