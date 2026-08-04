#!/usr/bin/env node
/**
 * Restore the six completed `Link Two Kipping Pull-Ups` sessions to
 * `health_gymnastics_progress`.
 *
 * David reported all six to Nabu between 2026-07-27 and 2026-08-03, but none of
 * them were ever written to the app database — production holds a single
 * untouched row for the older 10-week block and nothing else. `/health/gymnastics`
 * reads its Training history from these rows, so until they exist the history
 * section has nothing to show.
 *
 * Safety properties:
 *   - dry run by default; `--write` is required to touch the database;
 *   - every write is scoped to the retired program id, so current capacity-block
 *     progress under `gym-kipping-capacity-3wk-v1` is never read or modified;
 *   - historical `completed_at` values are written verbatim, not stamped now;
 *   - the upsert is on the table's natural key, so re-running converges rather
 *     than duplicating.
 *
 * Run:
 *   node scripts/backfill-gymnastics-history.mjs            # dry run
 *   node scripts/backfill-gymnastics-history.mjs --write    # apply
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
} from "./lib/gymnastics-history-backfill.mjs";

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
console.log(`Backfilling:   ${ARCHIVED_PROGRAM_ID} (${BACKFILL_ROWS.length} sessions)\n`);

const { insert, update, unchanged } = await applyBackfill(client, {
  write: WRITE,
  onStep: ({ row, action }) =>
    console.log(
      `  [${action.padEnd(9)}] W${row.week} ${row.session}  ${row.date}  ${row.note.slice(0, 64)}…`,
    ),
});

// Prove the current block was not touched.
const currentAfter = await client.execute({
  sql: "SELECT COUNT(*) AS n FROM health_gymnastics_progress WHERE program_id = ? AND completed = 1",
  args: [currentProgramId],
});

console.log(
  `\n${WRITE ? "Applied" : "Would apply"}: ${insert} inserted, ${update} updated, ${unchanged} already correct.`,
);
console.log(
  `Current block completed sessions: ${currentAfter.rows[0].n} (this script never writes them).`,
);
if (!WRITE) console.log("\n(dry run — nothing was written. Re-run with --write to apply.)");
