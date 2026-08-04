#!/usr/bin/env node
/**
 * Record week 1 session A of the live kipping-capacity block in
 * `health_gymnastics_progress`.
 *
 * David completed 6×4 with 60-second rests on 2026-08-04 and reported it to
 * Nabu, but the completion was never written to the app database. The rest of
 * the block was adapted from that result, so `/health/gymnastics` should show
 * session 1 done rather than a plan that begins where David already is.
 *
 * Safety properties:
 *   - dry run by default; `--write` is required to touch the database;
 *   - scoped to exactly one row — the current program id, week 1, session A.
 *     No other program, week, or session is read or written;
 *   - the reported `completed_at` is written verbatim, not stamped now;
 *   - the upsert is on the table's natural key, so re-running converges rather
 *     than duplicating;
 *   - it aborts if the projection no longer ships the block this row belongs to.
 *
 * Run:
 *   node scripts/record-gymnastics-session-one.mjs            # dry run
 *   node scripts/record-gymnastics-session-one.mjs --write    # apply
 *
 * Against production, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first.
 * Without them the script falls back to the same local SQLite file the app uses.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@libsql/client";
import {
  CURRENT_PROGRAM_ID,
  SESSION_ROW,
  applyRecord,
  assertCurrentProgram,
} from "./lib/gymnastics-session-one.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes("--write");

// Read the shipped program id from the projection rather than trusting the
// constant alone, so this refuses to run once a later block replaces this one.
const projectionProgramId = JSON.parse(
  readFileSync(join(__dirname, "..", "src/data/gymnastics-program.json"), "utf8"),
).programId;
assertCurrentProgram(projectionProgramId);

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
console.log(
  `Recording: ${CURRENT_PROGRAM_ID} W${SESSION_ROW.week} ${SESSION_ROW.session} @ ${SESSION_ROW.completedAt}`,
);
console.log(`Note:      ${SESSION_ROW.note}\n`);

const { action } = await applyRecord(client, { write: WRITE });
console.log(`  [${action}] W${SESSION_ROW.week} ${SESSION_ROW.session}`);

// Read the row back, and count everything else, to prove the scope held.
const readBack = await client.execute({
  sql: "SELECT program_id, week, session, completed, completed_at, note FROM health_gymnastics_progress WHERE program_id = ? AND week = ? AND session = ?",
  args: [CURRENT_PROGRAM_ID, SESSION_ROW.week, SESSION_ROW.session],
});
const others = await client.execute({
  sql: "SELECT COUNT(*) AS n FROM health_gymnastics_progress WHERE NOT (program_id = ? AND week = ? AND session = ?)",
  args: [CURRENT_PROGRAM_ID, SESSION_ROW.week, SESSION_ROW.session],
});

console.log(`\n${WRITE ? "Applied" : "Would apply"}: ${action}.`);
console.log(`Row now: ${JSON.stringify(readBack.rows[0] ?? null)}`);
console.log(`Other rows in the table: ${others.rows[0].n} (never read or written by this script).`);
if (!WRITE) console.log("\n(dry run — nothing was written. Re-run with --write to apply.)");
