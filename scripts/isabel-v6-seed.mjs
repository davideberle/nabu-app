#!/usr/bin/env node
// Nov 21: seeds an ISOLATED local learning database for the Isabel Visit 6 render checks, in the shape of her real record today
// (from VISIT-6-DRAFT.md, no record copied): Visit 5 finished (roof blue from Visit 4, worms in the bowl, her wish «Wasser»),
// nothing started. SYNTHETIC values only; never production.
//   node scripts/isabel-v6-seed.mjs --dir /tmp/<db-dir> [--roof red|blue|yellow] [--food seeds|berries|worms]
// Builds on visit11-seed.mjs (Visit 4 finished, her roof colour), then finishes Visit 5 the way her record has it.
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dir = opt("--dir", null);
if (!dir || !dir.startsWith("/tmp/")) {
  console.error("--dir under /tmp is required (isolated database only)");
  process.exit(2);
}
const roof = opt("--roof", "blue");
const food = opt("--food", "worms");
const FOODS = { seeds: "Körner", berries: "Beeren", worms: "Würmer" };
if (!FOODS[food]) throw new Error("--food seeds|berries|worms");
execFileSync(process.execPath, [new URL("./visit11-seed.mjs", import.meta.url).pathname, "--dir", dir, "--roof", roof], { stdio: "inherit" });

const c = createClient({ url: `file:${dir}/nabu.db` });
const read = async (child) => JSON.parse(String((await c.execute({ sql: "SELECT state_json FROM family_learning_missions WHERE child_id = ?", args: [child] })).rows[0].state_json));
const write = (child, s) => c.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = ?", args: [JSON.stringify(s), child] });
const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const i = await read("isabel");
i.visits.push({ id: "v6", startedAt: ago(3), finishedAt: ago(2.8), stageIndex: 99, skippedStages: [], reflection: "right" });
const done = (at, extra = {}) => ({ status: "done", openedAt: at, finishedAt: at, attempts: [], support: [], plays: 0, questions: {}, phase: "answer", outcome: "independent", ...extra });
i.missions["MISSION-IDA-FOOD"] = { missionId: "MISSION-IDA-FOOD", version: 1, visit: "v6", startedAt: ago(3), position: "birdhouse", visited: [], active: null, steps: { "IF2-WARM": done(ago(3)), "IF3-SEEDS": done(ago(2.9), { outcome: "supported" }), "IF8-FOOD": done(ago(2.85), { attempts: [{ no: 1, at: ago(2.85), raw: FOODS[food], choice: food, correct: true, evidence: "independent", support: [], modality: "pick", kind: "answer" }] }) }, facts: {}, shownWords: [], typing: null, finishedAt: ago(2.8) };
i.story = { ...(i.story ?? {}), birdFood: { value: FOODS[food], optionId: food, kind: "preset", visit: "v6", at: ago(2.85) } };
i.interests = [...(i.interests ?? []), { id: "fx-water", visit: "v6", source: "closing", kind: "choice", text: "Wasser", choice: "bath", at: ago(2.8) }];
await write("isabel", i);
console.log(JSON.stringify({ roof, food, isabelVisits: i.visits.map((v) => v.id), story: Object.keys(i.story) }));
