#!/usr/bin/env node
// Nov 8: seeds an ISOLATED local learning database with SYNTHETIC states only — both children "after the November 8 visits", with the
// teaching dates 7 days back so the warm-ups count as delayed. Never production. Usage: node scripts/next-visits-seed.mjs --dir <db-dir>
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
const v9 = asLearningContent(read("santiago-expedition-v9.json"));
const i4 = asIsabelContent(read("isabel-workshop-v4.json"));
const client = createClient({ url: `file:${path.join(dir, "nabu.db")}` });
await ensureLearningTables(client);
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const done = (at) => ({ status: "done", openedAt: at, finishedAt: at, attempts: [], support: [], plays: 0, questions: {}, phase: "answer", outcome: "independent" });
const visit = (id, days) => ({ id, startedAt: ago(days), finishedAt: ago(days - 0.01), stageIndex: 99, skippedStages: [], reflection: "easy" });

const s = newMissionState(v9, "santiago", ago(60));
s.visits = ["v1", "v2", "v4", "v5", "v6", "v7", "v8", "v9", "v10"].map((id, i) => visit(id, 40 - i * 4 + (id === "v10" ? -1 : 0)));
s.base = { name: "Fixture Basis", locationId: "shore", supplies: {} };
s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: ago(30), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 6, bursts: [], decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4", "TYPE-CH-COURSE-5", "TYPE-CH-COURSE-6"] };
s.missions = { "MISSION-WATER-PIPE": { missionId: "MISSION-WATER-PIPE", version: 1, visit: "v10", startedAt: ago(7), position: "greenhouse", visited: [], active: null, steps: { "P3-TANKBED": done(ago(7)), "P6-EDGE": done(ago(7)), "P9-TUBO": done(ago(7)) }, facts: {}, shownWords: [], typing: null, finishedAt: ago(7) } };
s.interests = [{ id: "fx-i", visit: "v10", source: "closing", kind: "choice", text: "Einen kleinen Teich anlegen", choice: "pond", at: ago(7) }];

const i = newMissionState(i4, "isabel", ago(30));
i.visits = [visit("v1", 20), visit("v2", 14), visit("v4", 7)];
i.missions = { "MISSION-IDA-GARDEN": { missionId: "MISSION-IDA-GARDEN", version: 1, visit: "v2", startedAt: ago(14), position: "garden", visited: [], active: null, steps: { "IG7-READ": done(ago(14)) }, facts: {}, shownWords: [], typing: null, finishedAt: ago(14) }, "MISSION-IDA-HARVEST": { missionId: "MISSION-IDA-HARVEST", version: 1, visit: "v4", startedAt: ago(7), position: "garden", visited: [], active: null, steps: { "IH4-TENS": done(ago(7)) }, facts: {}, shownWords: [], typing: null, finishedAt: ago(7) } };
i.interests = [{ id: "fx-b", visit: "v4", source: "closing", kind: "choice", text: "Ein Vogelhaus bauen", choice: "birdhouse", at: ago(7) }];

// --after: both new visits finished, to check the built pieces and their labels on the map.
if (args.includes("--after")) {
  s.visits.push(visit("v11", 0.5));
  s.story = { turtleName: { value: "Kira", optionId: "own", kind: "own", visit: "v11", at: ago(0.5) } };
  i.visits.push(visit("v5", 0.5));
  i.story = { roofColor: { value: "Blau", optionId: "blue", kind: "preset", visit: "v5", at: ago(0.5) } };
  i.missions["MISSION-IDA-BIRDS"] = { missionId: "MISSION-IDA-BIRDS", version: 1, visit: "v5", startedAt: ago(0.5), position: "birdhouse", visited: [], active: null, steps: { "IV10-ROOF": { ...done(ago(0.5)), attempts: [{ no: 1, at: ago(0.5), raw: "Blau", choice: "blue", correct: true, evidence: "independent", support: [], modality: "pick", kind: "answer" }] } }, facts: {}, shownWords: [], typing: null, finishedAt: ago(0.5) };
}
const now = new Date().toISOString();
for (const [child, missionId, version, state] of [["santiago", v9.contentId, 9, s], ["isabel", i4.contentId, 4, i]]) {
  await client.execute({ sql: "INSERT OR REPLACE INTO family_learning_missions (child_id, mission_id, content_version, revision, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [child, missionId, version, 1, JSON.stringify(state), now, now] });
}
const sv = await readChildView(client, "santiago", v9, new Date());
const iv = await readChildView(client, "isabel", i4, new Date());
console.log(JSON.stringify({ santiagoNext: sv.next?.visit ?? null, isabelNext: iv.next?.visit ?? null }));
