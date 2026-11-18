#!/usr/bin/env node
// Nov 18 (t12): seeds an ISOLATED local learning database for the Visit 11 / Visit 5 render checks, in the shape of the
// children's real records today (read from the release snapshot facts in NEXT-VISITS-V11.md, no record copied): both finished
// Visit 10 / Visit 4, nothing started. SYNTHETIC values only; never production.
//   node scripts/visit11-seed.mjs --dir /tmp/<db-dir> [--roof red|blue|yellow] [--turtle Flip]
// Builds on next-visits-seed.mjs --after (both Nov 8 visits finished), then sets what the real records also have:
//  - Isabel's roof colour (her real one is blue) and her Visit 4 wish «Nest» (timed after the visit start, as in her record);
//  - the turtle's name (his real one is Flip);
//  - Santiago's typing position (lessons 1–7 completed, on lesson 8) and his keyboard setting.
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
const ROOFS = { red: "Rot", blue: "Blau", yellow: "Gelb" };
if (!ROOFS[roof]) throw new Error("--roof red|blue|yellow");
const turtle = opt("--turtle", "Flip");
execFileSync(process.execPath, [new URL("./next-visits-seed.mjs", import.meta.url).pathname, "--dir", dir, "--after"], { stdio: "inherit" });

const c = createClient({ url: `file:${dir}/nabu.db` });
const read = async (child) => JSON.parse(String((await c.execute({ sql: "SELECT state_json FROM family_learning_missions WHERE child_id = ?", args: [child] })).rows[0].state_json));
const write = (child, s) => c.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = ?", args: [JSON.stringify(s), child] });

const i = await read("isabel");
const v5 = i.visits.find((v) => v.id === "v5");
i.story = { ...(i.story ?? {}), roofColor: { ...i.story.roofColor, value: ROOFS[roof], optionId: roof } };
const birds = i.missions["MISSION-IDA-BIRDS"];
birds.steps["IV10-ROOF"].attempts = birds.steps["IV10-ROOF"].attempts.map((a) => ({ ...a, raw: ROOFS[roof], choice: roof }));
i.interests = [...(i.interests ?? []), { id: "fx-nest", visit: "v5", source: "closing", kind: "choice", text: "Nest", choice: "nest", at: new Date(Date.parse(v5.startedAt) + 60_000).toISOString() }];
await write("isabel", i);

const s = await read("santiago");
s.story = { ...(s.story ?? {}), turtleName: { ...s.story.turtleName, value: turtle } };
s.typing.course = { ...s.typing.course, lessonIndex: 7, completed: [1, 2, 3, 4, 5, 6, 7].map((n) => `TYPE-CH-COURSE-${n}`) };
await write("santiago", s);
await c.execute({ sql: "INSERT OR REPLACE INTO family_learning_parent_settings (child_id, key, value, updated_at) VALUES (?, ?, ?, ?)", args: ["santiago", "keyboard_layout", "ch-de-qwertz", new Date().toISOString()] });
console.log(JSON.stringify({ roof, turtle, isabelVisits: i.visits.map((v) => v.id), santiagoVisits: s.visits.map((v) => v.id) }));
