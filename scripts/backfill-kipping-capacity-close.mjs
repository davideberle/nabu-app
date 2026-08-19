#!/usr/bin/env node
/**
 * Record the two sessions that closed the retired kipping-capacity block in
 * `health_gymnastics_progress`:
 *
 *   - W2 B, 2026-08-15 — the grips-confirmed descending ladder (8/7/6/5/4/3/2,
 *     35 reps), which replaced the failed 12 August set-length exposure;
 *   - W3 B, 2026-08-18 — the fifty-rep WOD application (6×5 + 5×4 in 8:15)
 *     that closed the block.
 *
 * W3 A (the clean-forty gate) was never trained — the application superseded
 * it — so this script writes NO row for it and Training history correctly
 * omits it.
 *
 * Safety properties:
 *   - dry run by default; `--write` is required to touch the database;
 *   - every write is scoped to the retired `gym-kipping-capacity-3wk-v1`, so
 *     current toes-to-bar progress is never read or modified;
 *   - historical `completed_at` values are written verbatim, not stamped now;
 *   - the upsert is on the table's natural key, so re-running converges
 *     rather than duplicating;
 *   - the script refuses to run while the projection still ships the
 *     kipping-capacity block as current.
 *
 * Run:
 *   node scripts/backfill-kipping-capacity-close.mjs            # dry run
 *   node scripts/backfill-kipping-capacity-close.mjs --write    # apply
 *
 * Against production, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first.
 * Without them the script falls back to the same local SQLite file the app uses.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@libsql/client";
import {
  ARCHIVED_PROGRAM_ID,
  BACKFILL_ROWS,
  applyBackfill,
  assertNotCurrentProgram,
} from "./lib/gymnastics-capacity-close.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes("--write");

// Read the current program id from the projection rather than repeating it, so
// the guard keeps working when the live block is replaced again.
const currentProgramId = JSON.parse(
  readFileSync(join(__dirname, "..", "src/data/gymnastics-program.json"), "utf8"),
).programId;
assertNotCurrentProgram(currentProgramId);

function buildUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const dir =
    process.env.NABU_DB_DIR ||
    (process.env.HOME
      ? `${process.env.HOME}/.openclaw/workspace/projects/companion-app/app`
      : "/tmp");
  return `file:${dir}/nabu.db`;
}

const url = buildUrl();
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

console.log(`Database: ${url.startsWith("file:") ? url : "(remote Turso)"}`);
console.log(`Current block: ${currentProgramId} — untouched by this script.`);
console.log(`Backfilling:   ${ARCHIVED_PROGRAM_ID} (${BACKFILL_ROWS.length} sessions; W3 A stays absent on purpose)\n`);

const { insert, update, unchanged } = await applyBackfill(client, {
  write: WRITE,
  onStep: ({ row, action }) =>
    console.log(
      `  [${action.padEnd(9)}] W${row.week} ${row.session}  ${row.date}  ${row.note.slice(0, 64)}…`,
    ),
});

// Prove the gate row stayed absent and the current block was not touched.
const gateRow = await client.execute({
  sql: "SELECT COUNT(*) AS n FROM health_gymnastics_progress WHERE program_id = ? AND week = 3 AND session = 'A'",
  args: [ARCHIVED_PROGRAM_ID],
});
const currentAfter = await client.execute({
  sql: "SELECT COUNT(*) AS n FROM health_gymnastics_progress WHERE program_id = ?",
  args: [currentProgramId],
});

console.log(
  `\n${WRITE ? "Applied" : "Would apply"}: ${insert} inserted, ${update} updated, ${unchanged} already correct.`,
);
console.log(`W3 A (never-trained clean-forty gate) rows: ${gateRow.rows[0].n} — must stay 0.`);
console.log(
  `Current block (${currentProgramId}) rows: ${currentAfter.rows[0].n} (this script never writes them).`,
);
if (!WRITE) console.log("\n(dry run — nothing was written. Re-run with --write to apply.)");
