#!/usr/bin/env node
/**
 * Validate the gymnastics program projection.
 *
 * Checks:
 *  1. The app projection (src/data/gymnastics-program.json) is byte-for-byte
 *     identical to the canonical health-domain source, when the canonical file
 *     is present.
 *  2. Structural rules: exactly 10 weeks, both sessions (A + B) per week with at
 *     least one block each, and every video has a valid YouTube URL.
 *
 * Exit non-zero on any failure. Run: node scripts/validate-gymnastics.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");
const projectionPath = join(appRoot, "src/data/gymnastics-program.json");
const canonicalPath = join(
  appRoot,
  "../../health-dashboard/gymnastics-program.json",
);

const errors = [];
const fail = (msg) => errors.push(msg);

const projectionRaw = readFileSync(projectionPath, "utf8");
const program = JSON.parse(projectionRaw);

// 1. Parity with canonical source (if reachable).
if (existsSync(canonicalPath)) {
  const canonicalRaw = readFileSync(canonicalPath, "utf8");
  if (canonicalRaw !== projectionRaw) {
    fail(
      "Projection src/data/gymnastics-program.json is out of sync with the canonical health-dashboard/gymnastics-program.json (re-copy the canonical file).",
    );
  }
} else {
  console.warn("! Canonical health-dashboard source not reachable; skipped parity check.");
}

// 2. Structure.
const EXPECTED_WEEKS = 10;
const SESSIONS = ["A", "B"];

if (program.durationWeeks !== EXPECTED_WEEKS) {
  fail(`durationWeeks must be ${EXPECTED_WEEKS}, got ${program.durationWeeks}`);
}
if (!Array.isArray(program.weeks) || program.weeks.length !== EXPECTED_WEEKS) {
  fail(`weeks must contain exactly ${EXPECTED_WEEKS} entries, got ${program.weeks?.length}`);
}

const seenWeeks = new Set();
for (const week of program.weeks ?? []) {
  if (typeof week.week !== "number" || week.week < 1 || week.week > EXPECTED_WEEKS) {
    fail(`invalid week number: ${week.week}`);
  }
  if (seenWeeks.has(week.week)) fail(`duplicate week number: ${week.week}`);
  seenWeeks.add(week.week);
  if (!week.phase || !week.focus) fail(`week ${week.week} missing phase/focus`);

  for (const s of SESSIONS) {
    const session = week.sessions?.[s];
    if (!session) {
      fail(`week ${week.week} missing session ${s}`);
      continue;
    }
    if (!session.label) fail(`week ${week.week} session ${s} missing label`);
    if (!Array.isArray(session.blocks) || session.blocks.length === 0) {
      fail(`week ${week.week} session ${s} must have at least one block`);
      continue;
    }
    for (const [i, block] of session.blocks.entries()) {
      if (!block.movement || !block.prescription) {
        fail(`week ${week.week} session ${s} block ${i} missing movement/prescription`);
      }
    }
  }
}

for (let w = 1; w <= EXPECTED_WEEKS; w++) {
  if (!seenWeeks.has(w)) fail(`missing week ${w}`);
}

// Total sessions must equal 20 (10 weeks × A + B).
const totalSessions = (program.weeks ?? []).reduce(
  (n, week) => n + SESSIONS.filter((s) => week.sessions?.[s]).length,
  0,
);
if (totalSessions !== 20) fail(`expected 20 total sessions, got ${totalSessions}`);
if (program.totalSessions !== 20) fail(`totalSessions field must be 20, got ${program.totalSessions}`);

// 3. Videos.
const YT = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/;
if (!Array.isArray(program.videos) || program.videos.length === 0) {
  fail("videos must be a non-empty array");
}
const movementsCovered = new Set();
for (const video of program.videos ?? []) {
  if (!video.title || !video.source) fail(`video ${video.id} missing title/source`);
  if (!YT.test(video.url)) fail(`video ${video.id} has invalid YouTube URL: ${video.url}`);
  if (video.url !== `https://www.youtube.com/watch?v=${video.youtubeId}`) {
    fail(`video ${video.id} url does not match youtubeId`);
  }
  movementsCovered.add(video.movement);
}
for (const m of ["kipping", "butterfly", "toes-to-bar"]) {
  if (!movementsCovered.has(m)) fail(`no movement reference video for "${m}"`);
}

// 4. Required guidance cards.
if (!program.m60Scaling?.points?.length) fail("m60Scaling.points missing");
if (!program.prerequisites?.mustHave?.length) fail("prerequisites.mustHave missing");
if (!program.prerequisites?.stopRules?.length) fail("prerequisites.stopRules missing");
if (!program.progressionRule) fail("progressionRule missing");
if (!program.warmup?.items?.length) fail("warmup.items missing");

if (errors.length > 0) {
  console.error(`✗ Gymnastics program validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ Gymnastics program valid: ${program.weeks.length} weeks, ${totalSessions} sessions, ${program.videos.length} videos.`,
);
