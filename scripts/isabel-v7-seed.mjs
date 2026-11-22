#!/usr/bin/env node
// Nov 22: seeds an ISOLATED local learning database for the Isabel Visit 7 render checks, in the shape of her real record today
// (from VISIT-7-DRAFT.md and the Visit 6 build record, no record copied): stored content version 6, Visit 6 finished (Sun Nov 22,
// 12:52–13:08 Zurich), roof blue (Visit 4), worms in the bowl (Visit 5), her chick «Isa» (she typed «IsA»), her wish «Augen»,
// nothing started. SYNTHETIC values only; never production.
//   node scripts/isabel-v7-seed.mjs --dir /tmp/<db-dir> [--roof red|blue|yellow] [--food seeds|berries|worms] [--name IsA]
// Builds on isabel-v6-seed.mjs (Visit 5 finished, her roof and food), then finishes Visit 6 the way her record has it.
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
const typed = opt("--name", "IsA");
// The server's own rule (sanitizeStoryName): letters only, 2–12, shown with a capital first letter («IsA» → «Isa»).
const shown = typed.charAt(0).toUpperCase() + typed.slice(1).toLowerCase();
execFileSync(process.execPath, [new URL("./isabel-v6-seed.mjs", import.meta.url).pathname, "--dir", dir, "--roof", roof, "--food", food], { stdio: "inherit" });

const c = createClient({ url: `file:${dir}/nabu.db` });
const read = async (child) => JSON.parse(String((await c.execute({ sql: "SELECT state_json FROM family_learning_missions WHERE child_id = ?", args: [child] })).rows[0].state_json));
const i = await read("isabel");
// Visit 6 as it ran: Sun Nov 22, 12:52–13:08 Zurich (11:52–12:08 UTC).
const at = (m) => new Date(Date.UTC(2026, 10, 22, 11, 52 + m)).toISOString();
i.visits.push({ id: "v7", startedAt: at(0), finishedAt: at(16), stageIndex: 99, skippedStages: [], reflection: "right" });
const done = (t, extra = {}) => ({ status: "done", openedAt: t, finishedAt: t, attempts: [], support: [], plays: 0, questions: {}, phase: "answer", outcome: "independent", ...extra });
i.missions["MISSION-IDA-CHICK"] = {
  missionId: "MISSION-IDA-CHICK", version: 1, visit: "v7", startedAt: at(0), position: "birdhouse", visited: [], active: null,
  steps: {
    "I62-FLIP": done(at(1), { outcome: "supported" }),
    "I69-NAME": done(at(8), { attempts: [{ no: 1, at: at(8), raw: shown, choice: "own", correct: true, evidence: "independent", support: [], modality: "typed", kind: "answer" }] }),
    "I610-FEED": done(at(9), { attempts: [{ no: 1, at: at(9), raw: "Raupen", choice: "caterpillars", correct: true, evidence: "independent", support: [], modality: "pick", kind: "answer" }] }),
    "I613-BOOK": done(at(14)),
  },
  facts: {}, shownWords: [], typing: null, finishedAt: at(16),
};
i.story = { ...(i.story ?? {}), chickName: { value: shown, optionId: "own", kind: "own", visit: "v7", at: at(8) } };
i.interests = [...(i.interests ?? []), { id: "fx-eyes", visit: "v7", source: "closing", kind: "choice", text: "Augen", choice: "eyes", at: at(16) }];
await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, content_version = 6 WHERE child_id = ?", args: [JSON.stringify(i), "isabel"] });
const row = (await c.execute({ sql: "SELECT content_version FROM family_learning_missions WHERE child_id = 'isabel'" })).rows[0];
console.log(JSON.stringify({ roof, food, chickName: shown, typed, storedContentVersion: row.content_version, isabelVisits: i.visits.map((v) => v.id), story: Object.keys(i.story) }));
