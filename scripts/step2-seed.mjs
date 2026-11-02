#!/usr/bin/env node
// Step 2 A (2026-11-02): seeds an ISOLATED local learning database with SYNTHETIC records shaped like the children's real
// history — the same objective ids, task ids, visits and evidence mix per objective (from the id-only fixture
// src/lib/family-learning-skill-ladder.fixture.json plus the evidence counts read alongside it), on a synthetic calendar.
// Answers are placeholders («fixture»), never a child's text. Never production. Usage: node scripts/step2-seed.mjs --dir <db-dir>
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { asLearningContent } from "../src/lib/family-learning-content.ts";
import { asIsabelContent } from "../src/lib/family-learning-isabel.ts";
import { ensureLearningTables } from "../src/lib/family-learning-db.ts";
import { newMissionState } from "../src/lib/family-learning-state.ts";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : null;
if (!dir || !dir.startsWith("/tmp/")) {
  console.error("--dir under /tmp is required (isolated database only)");
  process.exit(2);
}
fs.mkdirSync(dir, { recursive: true });
const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/family-learning/content/${name}`, import.meta.url), "utf8"));
const v8 = asLearningContent(read("santiago-expedition-v8.json"));
const i3 = asIsabelContent(read("isabel-workshop-v3.json"));
const client = createClient({ url: `file:${path.join(dir, "nabu.db")}` });
await ensureLearningTables(client);

// Shape of the real history (ids, tasks, visits, evidence counts per objective — no answers): objective → [tasks, visits, mix].
// Evidence order within an objective follows the usual course of a task: help / not yet first, on own after.
const SHAPE = {
  santiago: {
    "equal-sharing": [["EQ-ENTRY", "EQ-FRESH", "EQ-RETURN"], ["v1", "v1", "v2"], ["independent", "independent", "independent"]],
    "language-en-listen": [["LANG-EN-WATER/listen", "LANG-EN-PIER/listen"], ["v1", "v5"], ["unscored", "unscored"]],
    "language-en-recognition": [["LANG-EN-WATER/pick", "LANG-EN-WATER/reuse", "LANG-EN-PIER/pick", "LANG-EN-PIER/reuse"], ["v1", "v1", "v5", "v5"], ["supported", "supported", "supported", "independent"]],
    "language-en-completion": [["LANG-EN-WATER/produce"], ["v1"], ["independent"]],
    "language-es-listen": [["LANG-ES-AGUA/listen", "LANG-ES-STATION/listen", "LANG-ES-HARBOR/listen"], ["v2", "v4", "v6"], ["unscored", "unscored", "unscored"]],
    "language-es-recognition": [["LANG-ES-AGUA/pick", "LANG-ES-AGUA/reuse", "LANG-ES-STATION/pick", "LANG-ES-STATION/reuse", "LANG-ES-HARBOR/pick", "LANG-ES-HARBOR/reuse"], ["v2", "v2", "v4", "v4", "v6", "v6"], ["supported", "supported", "supported", "supported", "independent", "independent"]],
    "language-es-completion": [["LANG-ES-AGUA/produce", "LANG-ES-STATION/produce"], ["v2", "v4"], ["independent", "independent"]],
    "equal-sharing-with-remainder": [["EQ-STATION", "EQ-PIER"], ["v4", "v5"], ["independent", "independent"]],
    "writing-spacing-transfer": [["WRITE-TRANSFER-1", "WRITE-TRANSFER-2"], ["v4", "v5"], ["unscored", "independent"]],
    "language-en-production": [["LANG-EN-PIER/produce"], ["v5"], ["supported"]],
    "quotient-with-remainder": [["EQ-HARBOR", "EQ-HARBOR", "EQ-HARBOR-CHECK"], ["v6", "v6", "v6"], ["incorrect", "supported", "independent"]],
    "quotient-groups-needed": [["EQ-HARBOR", "EQ-HARBOR-CHECK"], ["v6", "v6"], ["supported", "independent"]],
    "language-es-production": [["LANG-ES-HARBOR/produce", "LANG-ES-HARBOR/produce", "LANG-ES-HARBOR/produce", "LANG-ES-HARBOR-CHECK/produce"], ["v6", "v6", "v6", "v6"], ["incorrect", "supported", "unscored", "supported"]],
    "writing-review-revision": [["WRITE-LOG-HARBOR"], ["v6"], ["unscored"]],
    "reading-for-information": [["MISSION-SHIP-SUPPLY/S2-BOARD/boat-max", "MISSION-SHIP-SUPPLY/S2-BOARD/reef-max"], ["v7", "v7"], ["independent", "independent"]],
    "listening-for-information": [["MISSION-SHIP-SUPPLY/S3-RADIO/crew", "MISSION-SHIP-SUPPLY/S3-RADIO/bottles", "MISSION-SHIP-SUPPLY/S3-RADIO/ask", "MISSION-SHIP-SUPPLY/S7-ROSA-REPLY/ropes", "MISSION-ISLAND-GARDEN/G4-RADIO/a", "MISSION-ISLAND-GARDEN/G4-RADIO/b"], ["v7", "v7", "v7", "v7", "v8", "v8"], ["independent", "independent", "independent", "independent", "independent", "independent"]],
    "multiplication-in-context": [["MISSION-SHIP-SUPPLY/S4-WATER"], ["v7"], ["independent"]],
    "quotient-full-rest-needed": [["MISSION-SHIP-SUPPLY/S5-CRATES/full", "MISSION-SHIP-SUPPLY/S5-CRATES/full", "MISSION-SHIP-SUPPLY/S5-CRATES/needed", "MISSION-SHIP-SUPPLY/S5-CRATES/needed", "MISSION-ISLAND-GARDEN/G2-PACK/full", "MISSION-ISLAND-GARDEN/G2-PACK/left", "MISSION-ISLAND-GARDEN/G2-PACK/needed", "MISSION-ISLAND-GARDEN/G2-PACK/needed"], ["v7", "v7", "v7", "v7", "v8", "v8", "v8", "v8"], ["incorrect", "supported", "incorrect", "supported", "independent", "independent", "incorrect", "incorrect"]],
    "language-es-request": [["MISSION-SHIP-SUPPLY/S6-ROSA", "MISSION-SHIP-SUPPLY/S6-ROSA", "MISSION-ISLAND-GARDEN/G5-TOOLS", "MISSION-ISLAND-GARDEN/G5-TOOLS"], ["v7", "v7", "v8", "v8"], ["incorrect", "supported", "incorrect", "supported"]],
    "language-es-retrieval": [["MISSION-SHIP-SUPPLY/S8-TOOLS", "MISSION-SHIP-SUPPLY/S8-TOOLS", "MISSION-SHIP-SUPPLY/S13-RECALL-CUERDAS", "MISSION-SHIP-SUPPLY/S13-RECALL-CUERDAS"], ["v7", "v7", "v7", "v7"], ["incorrect", "supported", "incorrect", "unscored"]],
    "add-and-group": [["MISSION-SHIP-SUPPLY/S9-LOAD", "MISSION-SHIP-SUPPLY/S9-LOAD"], ["v7", "v7"], ["incorrect", "supported"]],
    "multiply-and-compare": [["MISSION-SHIP-SUPPLY/S10-ROPES"], ["v7"], ["independent"]],
    "language-es-retrieval-practice": [["MISSION-SHIP-SUPPLY/S13-RECALL-CUERDAS"], ["v7"], ["incorrect"]],
    "plan-under-constraints": [["MISSION-SHIP-SUPPLY/S11-ROUTE"], ["v7"], ["independent"]],
    "quotient-groups-needed-application": [["MISSION-ISLAND-GARDEN/G7-FRESH/needed"], ["v8"], ["independent"]],
    "writing-own-sentence-spacing": [["MISSION-ISLAND-GARDEN/G8-JOURNAL"], ["v8"], ["independent"]],
    "quotient-groups-needed-retrieval": [["MISSION-GREENHOUSE-GROW/H2-POTS/needed"], ["v9"], ["independent"]],
    "area-count-fields": [["MISSION-GREENHOUSE-GROW/H4-FLOOR/row", "MISSION-GREENHOUSE-GROW/H4-FLOOR/rows", "MISSION-GREENHOUSE-GROW/H4-FLOOR/area", "MISSION-GREENHOUSE-GROW/H4-FLOOR/area"], ["v9", "v9", "v9", "v9"], ["independent", "independent", "incorrect", "supported"]],
    "area-subtract-path": [["MISSION-GREENHOUSE-GROW/H5-PLANS/a", "MISSION-GREENHOUSE-GROW/H5-PLANS/b"], ["v9", "v9"], ["independent", "independent"]],
    "plan-judgment-viable": [["MISSION-GREENHOUSE-GROW/H6-CHOOSE"], ["v9"], ["independent"]],
    "listening-directions": [["MISSION-GREENHOUSE-GROW/H7-JUNE/a", "MISSION-GREENHOUSE-GROW/H7-JUNE/b", "MISSION-GREENHOUSE-GROW/H7-JUNE/b"], ["v9", "v9", "v9"], ["independent", "incorrect", "supported"]],
    "writing-own-sentence-revision": [["MISSION-GREENHOUSE-GROW/H11-JOURNAL"], ["v9"], ["incorrect"]],
    "language-es-request-retrieval": [["MISSION-GREENHOUSE-GROW/H8-TOOLS", "MISSION-GREENHOUSE-GROW/H8-TOOLS"], ["v9", "v9"], ["incorrect", "supported"]],
    "language-es-request-new-supported": [["MISSION-GREENHOUSE-GROW/H9-WATERING"], ["v9"], ["supported"]],
  },
  isabel: {
    "own-choice-not-scored": [["MISSION-OLD-LILA-WORKSHOP/W2-MAKE", "MISSION-IDA-GARDEN/IG2-PLANT"], ["v1", "v2"], ["independent", "independent"]],
    "materials-matching": [["MISSION-OLD-LILA-WORKSHOP/W3-MATERIALS/a", "MISSION-OLD-LILA-WORKSHOP/W3-MATERIALS/b", "MISSION-OLD-LILA-WORKSHOP/W3-MATERIALS/c"], ["v1", "v1", "v1"], ["independent", "independent", "independent"]],
    "small-sums-visible-counters": [["MISSION-OLD-LILA-WORKSHOP/W4-COUNT/a", "MISSION-OLD-LILA-WORKSHOP/W4-COUNT/b"], ["v1", "v1"], ["independent", "independent"]],
    "tens-bundles-visible-supported": [["MISSION-OLD-LILA-WORKSHOP/W5-TENS"], ["v1"], ["independent"]],
    "early-reading-word-picture": [["MISSION-OLD-LILA-WORKSHOP/W8-READ", "MISSION-IDA-GARDEN/IG7-READ"], ["v1", "v2"], ["independent", "independent"]],
    "listening-recognition-german": [["MISSION-OLD-LILA-WORKSHOP/W9-LISTEN"], ["v1"], ["independent"]],
    "tens-bundles-retrieval-visible": [["MISSION-IDA-GARDEN/IG3-STICKS"], ["v2"], ["independent"]],
    "small-sums-extended-visible-counters": [["MISSION-IDA-GARDEN/IG5-PLANTING/a", "MISSION-IDA-GARDEN/IG5-PLANTING/b", "MISSION-IDA-GARDEN/IG5-PLANTING/c"], ["v2", "v2", "v2"], ["independent", "independent", "independent"]],
    "listening-recognition-german-two-details": [["MISSION-IDA-GARDEN/IG8-LISTEN"], ["v2"], ["independent"]],
  },
};

// Synthetic calendar (the real one is not copied): Santiago since Sep 29, Isabel since Oct 28.
const VISIT_DAY = { santiago: { v1: "2026-09-29", v2: "2026-10-06", v4: "2026-10-09", v5: "2026-10-12", v6: "2026-10-16", v7: "2026-10-21", v8: "2026-10-25", v9: "2026-11-01" }, isabel: { v1: "2026-10-28", v2: "2026-11-01" } };
const LANG = (objective, task) => (task.includes("S7-ROSA") || objective.startsWith("language-es") ? "es" : objective.startsWith("language-en") || task.includes("RADIO") || task.includes("JUNE") ? "en" : "de");
const MISSION = { santiago: v8.contentId, isabel: i3.contentId };
// One synthetic parent correction, to show the «I helped here» downgrade in the render.
const HELPED = { santiago: "multiply-and-compare", isabel: "listening-recognition-german-two-details" };

let n = 0;
let attempts = 0;
for (const child of ["santiago", "isabel"]) {
  const perVisitMinute = {};
  for (const [objective, [tasks, visits, mix]] of Object.entries(SHAPE[child])) {
    for (let k = 0; k < tasks.length; k += 1) {
      const visit = visits[k];
      perVisitMinute[visit] = (perVisitMinute[visit] ?? 0) + 1;
      const at = new Date(`${VISIT_DAY[child][visit]}T15:${String(perVisitMinute[visit]).padStart(2, "0")}:00.000Z`).toISOString();
      const ev = mix[k];
      const correct = ev === "incorrect" ? 0 : ev === "unscored" ? null : 1;
      const practice = objective.endsWith("-practice");
      const helped = HELPED[child] === objective && k === 0;
      n += 1;
      attempts += 1;
      await client.execute({
        sql: `INSERT INTO family_learning_attempts (id, child_id, mission_id, visit_id, task_id, task_version, objective, attempt_no, answer_json, correct, evidence, support_json, exposure_before, stimulus_language, response_language, modality, uncertainty, teaching_move, teaching_reason, seconds_since_teaching, created_at, parent_correction_json, parent_corrected_at)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'shown', ?, ?, 'typed', NULL, NULL, NULL, NULL, ?, ?, ?)`,
        args: [`fx-${child}-${n}`, child, MISSION[child], visit, tasks[k], objective, 1, JSON.stringify({ raw: "fixture", ...(practice ? { kind: "practice" } : {}) }), correct, ev, JSON.stringify(ev === "supported" ? ["hint"] : []), LANG(objective, tasks[k]), LANG(objective, tasks[k]), at, helped ? JSON.stringify({ evidence: "supported", note: "I helped here", by: "info@davideberle.com", at: "2026-11-02T08:00:00.000Z" }) : null, helped ? "2026-11-02T08:00:00.000Z" : null],
      });
    }
  }
}
// Own sentences (meaning is never scored): synthetic placeholders on the visits that had writing.
for (const [visit, kind] of [["v1", "expedition_log"], ["v2", "expedition_log"], ["v4", "writing_transfer"], ["v5", "writing_transfer"], ["v6", "expedition_log"], ["v8", "writing_transfer"], ["v9", "writing_transfer"]]) {
  n += 1;
  await client.execute({ sql: "INSERT INTO family_learning_work_samples (id, child_id, mission_id, visit_id, task_id, kind, language, modality, text, metrics_json, created_at) VALUES (?, 'santiago', ?, ?, NULL, ?, 'de', 'typed', 'Fixture-Satz.', NULL, ?)", args: [`fx-s-${n}`, MISSION.santiago, visit, kind, `${VISIT_DAY.santiago[visit]}T15:59:00.000Z`] });
}

const day = (d) => `${d}T15:00:00.000Z`;
const s = newMissionState(v8, "santiago", day("2026-09-29"));
s.visits = Object.entries(VISIT_DAY.santiago).map(([id, d]) => ({ id, startedAt: day(d), finishedAt: `${d}T15:40:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "easy" }));
s.base = { name: "Fixture Basis", locationId: "shore", supplies: {} };
const burst = (visit, d, acc, cpm) => ({ lessonId: "TYPE-CH-COURSE-X", visit, lines: [], expectedChars: 60, typedChars: 60, correctChars: Math.round(acc * 0.6), extraChars: 0, omittedChars: 0, substitutedChars: 0, denominator: 60, accuracy: acc / 100, comfort: "ok", metricVersion: 2, seconds: Math.round(3600 / cpm), at: `${d}T15:30:00.000Z` });
s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day("2026-10-06"), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 6, decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4", "TYPE-CH-COURSE-5", "TYPE-CH-COURSE-6"], bursts: [burst("v2", "2026-10-06", 78, 31), burst("v4", "2026-10-09", 82, 34), burst("v5", "2026-10-12", 85, 36), burst("v6", "2026-10-16", 88, 38), burst("v7", "2026-10-21", 86, 41), burst("v8", "2026-10-25", 90, 43), burst("v9", "2026-11-01", 91, 46)] };

const i = newMissionState(i3, "isabel", "2026-10-28T16:34:00.000Z");
i.visits = Object.entries(VISIT_DAY.isabel).map(([id, d]) => ({ id, startedAt: day(d), finishedAt: `${d}T15:20:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "right" }));

const now = new Date().toISOString();
for (const [child, missionId, version, state] of [["santiago", v8.contentId, 8, s], ["isabel", i3.contentId, 3, i]]) {
  await client.execute({ sql: "INSERT OR REPLACE INTO family_learning_missions (child_id, mission_id, content_version, revision, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [child, missionId, version, 1, JSON.stringify(state), now, now] });
}
console.log(JSON.stringify({ attempts, children: Object.fromEntries(Object.entries(SHAPE).map(([c, m]) => [c, Object.keys(m).length])) }));
