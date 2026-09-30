// Synthetic fixture for the approved learning redesign (2026-09-29): a child
// who completed visits 1 and 2 under VERSION-1 content before the completion
// table existed (mirrors the live Santiago record shape without touching any
// live data). Writes into an ISOLATED NABU_DB_DIR only.
//
//   node scripts/seed-learning-redesign-fixture.mjs --dir /tmp/<fresh> [--backdate-days 10]
//
// --backdate-days records the fixture's visits with an injected clock N days
// in the past (the state machine's `now` parameter). The SERVER clock is never
// touched: the delayed check becomes due only because the fixture's records
// are older, exactly like a real child whose first visit was N days ago.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { asLearningContent } from "../src/lib/family-learning-content.ts";
import { applyMutation, ensureLearningTables, readChildView } from "../src/lib/family-learning-db.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dir = opt("--dir", null);
if (!dir) {
  console.error("--dir is required");
  process.exit(2);
}
const backdateDays = Number(opt("--backdate-days", "0"));
fs.mkdirSync(dir, { recursive: true });
const v1 = asLearningContent(JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")));
const client = createClient({ url: `file:${path.join(dir, "nabu.db")}` });
await ensureLearningTables(client);

// Fixed synthetic clock: starts three hours before the run (minus the backdate)
// and advances one minute per call, so every fixture timestamp stays in the
// past relative to the real clock the server will use.
let t = Date.now() - backdateDays * 86400000 - 3 * 3600000;
const now = () => new Date((t += 60000));
let k = 0;
async function step(op) {
  const view = await readChildView(client, "santiago", v1, now());
  const out = await applyMutation(client, { child: "santiago", op, idempotencyKey: `seed-${(k += 1)}`, expectedRevision: view.revision }, v1, now);
  if (out.status !== "applied") throw new Error(`${op.op}: ${out.status} ${"message" in out ? out.message : ""}`);
}
const ops = [
  { op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" },
  { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" },
  { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
  { op: "explain", text: "Ich habe geteilt.", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" },
  { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" },
  { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
  { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 },
  { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" },
];
for (const op of ops) await step(op);
// Production completed these visits before the completion table existed.
await client.execute("DELETE FROM family_learning_completions WHERE child_id = 'santiago'");
const row = (await client.execute("SELECT content_version, revision, state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
const state = JSON.parse(String(row.state_json));
const attempts = Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_attempts WHERE child_id = 'santiago'")).rows[0].c);
const samples = Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_work_samples WHERE child_id = 'santiago'")).rows[0].c);
const summary = { dir, backdateDays, contentVersion: Number(row.content_version), revision: Number(row.revision), visits: state.visits.map((v) => ({ id: v.id, startedAt: v.startedAt, finishedAt: v.finishedAt })), attempts, samples, pages: state.pages.length, base: state.base };
fs.writeFileSync(path.join(dir, "fixture.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
client.close();
