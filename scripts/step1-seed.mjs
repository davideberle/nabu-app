#!/usr/bin/env node
// Step 1 (2026-11-01): seeds an ISOLATED local learning database with SYNTHETIC states only — Santiago "after Visit 8" (content
// v8, greenhouse mission finished on Nov 1 with its taught steps) and Isabel "after Visit 2" (content v3). Never production,
// never a real child record. Usage: node scripts/step1-seed.mjs --dir <db-dir>
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { asLearningContent } from "../src/lib/family-learning-content.ts";
import { asIsabelContent } from "../src/lib/family-learning-isabel.ts";
import { ensureLearningTables, readChildView } from "../src/lib/family-learning-db.ts";
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

const day = (d, h) => new Date(Date.UTC(2026, 8, 29 + d, h, 0, 0)).toISOString();
const done = (at) => ({ status: "done", openedAt: at, finishedAt: at, attempts: [], support: [], plays: 0, questions: {}, phase: "answer", outcome: "independent" });

const s = newMissionState(v8, "santiago", "2026-09-29T10:00:00.000Z");
s.visits = ["v1", "v2", "v4", "v5", "v6", "v7", "v8", "v9"].map((id, i) => ({ id, startedAt: day(i * 3, 10), finishedAt: day(i * 3, 11), stageIndex: 99, skippedStages: [], reflection: "easy" }));
s.base = { name: "Fixture Basis", locationId: "shore", supplies: {} };
s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day(6, 10), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 5, bursts: [], decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4", "TYPE-CH-COURSE-5"] };
s.missions = { "MISSION-GREENHOUSE-GROW": { missionId: "MISSION-GREENHOUSE-GROW", version: 1, visit: "v9", startedAt: "2026-11-01T11:02:00.000Z", position: "greenhouse", visited: [], active: null, steps: { "H2-POTS": done("2026-11-01T11:14:32.000Z"), "H4-FLOOR": done("2026-11-01T11:17:30.000Z"), "H5-PLANS": done("2026-11-01T11:19:30.000Z"), "H9-WATERING": done("2026-11-01T11:28:00.000Z") }, facts: {}, shownWords: [], typing: null, finishedAt: "2026-11-01T11:34:24.000Z" } };
s.interests = [{ id: "fx-i", visit: "v9", source: "closing", kind: "choice", text: "Eine Wasserleitung zum Gewächshaus bauen", choice: "water-pipe", at: day(24, 11) }];

const i = newMissionState(i3, "isabel", "2026-10-28T16:34:00.000Z");
i.visits = [
  { id: "v1", startedAt: "2026-10-28T16:34:00.000Z", finishedAt: "2026-10-28T16:50:00.000Z", stageIndex: 99, skippedStages: [], reflection: "right" },
  { id: "v2", startedAt: "2026-11-01T13:48:55.000Z", finishedAt: "2026-11-01T13:57:49.000Z", stageIndex: 99, skippedStages: [], reflection: "right" },
];
i.interests = [{ id: "fx-h", visit: "v2", source: "closing", kind: "choice", text: "Ernten und probieren", choice: "harvest", at: "2026-11-01T13:57:49.000Z" }];

const now = new Date().toISOString();
for (const [child, missionId, version, state] of [["santiago", v8.contentId, 8, s], ["isabel", i3.contentId, 3, i]]) {
  await client.execute({ sql: "INSERT OR REPLACE INTO family_learning_missions (child_id, mission_id, content_version, revision, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [child, missionId, version, 1, JSON.stringify(state), now, now] });
}
const sv = await readChildView(client, "santiago", v8, new Date());
const iv = await readChildView(client, "isabel", i3, new Date());
console.log(JSON.stringify({ santiagoNext: sv.next?.visit ?? null, isabelNext: iv.next?.visit ?? null }));
