#!/usr/bin/env node
// Nov 18 (Nokt v5): moves the SYNTHETIC Santiago of an isolated database seeded by scripts/next-visits-seed.mjs into a running
// Visit 10 «Die Schildkröte» (v11) with every step before the journal finished, so the strict writing step (T10-JOURNAL) can be
// rendered. Invented state only; never production. Usage: node scripts/nokt-v5-writing-seed.mjs --dir <db-dir under /tmp>
import path from "node:path";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : null;
if (!dir || !dir.startsWith("/tmp/")) {
  console.error("--dir under /tmp is required (isolated database only)");
  process.exit(2);
}
const client = createClient({ url: `file:${path.join(dir, "nabu.db")}` });
const row = (await client.execute({ sql: "SELECT revision, state_json FROM family_learning_missions WHERE child_id = 'santiago'", args: [] })).rows[0];
const s = JSON.parse(String(row.state_json));
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const started = ago(40);
s.visits.push({ id: "v11", startedAt: started, finishedAt: null, stageIndex: 0, skippedStages: [], reflection: null });
s.currentVisit = "v11";
const before = ["T1-BEACH", "T1R-RADIO", "T2-AROUND", "T2G-GRID", "T2S-TUBO", "T3-MATEO", "T3E-LENGTH", "T3H-DEPTH", "T4-AREA", "T4E-SMALL", "T4H-BEACH", "T5-STONES", "T5E-SMALL", "T5H-HALF", "T6-SPOT", "T7-JUNE", "T7H-BETWEEN", "T8-PIEDRAS", "T9-TYPING"];
const done = (at) => ({ status: "done", openedAt: at, finishedAt: at, attempts: [], support: [], plays: 0, questions: {}, phase: "finished", outcome: "independent" });
s.missions["MISSION-TURTLE-POND"] = { missionId: "MISSION-TURTLE-POND", version: 1, visit: "v11", startedAt: started, position: "beach", visited: ["beach"], active: null, steps: Object.fromEntries(before.map((id, i) => [id, done(ago(35 - i))])), facts: {}, shownWords: [], typing: null, finishedAt: null };
// The welcome of this visit instance already happened (the map is not held for it).
s.noktTalks = { sessions: [], welcomes: [{ visit: "v11", visitStartedAt: started, sessionId: "fx-welcome-session", at: started }] };
await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, revision = ?, updated_at = ? WHERE child_id = 'santiago'", args: [JSON.stringify(s), Number(row.revision) + 1, new Date().toISOString()] });
console.log(JSON.stringify({ seeded: "v11 at T10-JOURNAL", revision: Number(row.revision) + 1 }));
