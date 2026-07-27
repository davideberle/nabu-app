#!/usr/bin/env node
/**
 * Validate the gymnastics program projection.
 *
 * Checks:
 *  1. The app projection (src/data/gymnastics-program.json) is byte-for-byte
 *     identical to the canonical health-domain source, when the canonical file
 *     is present.
 *  2. Structural rules for the current block: 2 weeks, three sessions per week
 *     (A/B/C) with at least one block each, six sessions in total.
 *  3. Every video has a valid YouTube URL and belongs to a declared movement
 *     group, and every declared group has at least one video.
 *  4. The safety, rep-cap, rest, stop-rule, scaling, and feedback guidance the
 *     UI renders is present, and no butterfly / toes-to-bar training volume
 *     leaked back into the block.
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

// 2. Structure — the current focused kipping-pair block.
const EXPECTED_WEEKS = 2;
const SESSIONS = ["A", "B", "C"];
const EXPECTED_TOTAL_SESSIONS = EXPECTED_WEEKS * SESSIONS.length; // 6
const RETIRED_PROGRAM_ID = "gym-kip-ttb-10wk-v1";

if (typeof program.programId !== "string" || program.programId.length === 0) {
  fail("programId must be a non-empty string");
}
if (program.programId === RETIRED_PROGRAM_ID) {
  fail(
    `programId must differ from the retired ${RETIRED_PROGRAM_ID} so old progress does not appear as current progress`,
  );
}
if (program.durationWeeks !== EXPECTED_WEEKS) {
  fail(`durationWeeks must be ${EXPECTED_WEEKS}, got ${program.durationWeeks}`);
}
if (program.sessionsPerWeek !== SESSIONS.length) {
  fail(`sessionsPerWeek must be ${SESSIONS.length}, got ${program.sessionsPerWeek}`);
}
if (!Array.isArray(program.weeks) || program.weeks.length !== EXPECTED_WEEKS) {
  fail(`weeks must contain exactly ${EXPECTED_WEEKS} entries, got ${program.weeks?.length}`);
}

// The push-away descent back into the arch/backswing is the point of the block:
// every single session must train it somewhere in its goal or its blocks.
// Deliberately narrow — a bare "link" says two reps were joined, not that the
// push-away descent was the thing trained, so it does not count on its own.
const PRIMARY_SKILL = /push[- ]?away|\bdescent\b|\barch(?:ed|ing)?\b|\bbackswing\b/i;
const BANNED_MOVEMENTS = /butterfly|toes[- ]to[- ]bar/i;

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
    if (!session.goal) fail(`week ${week.week} session ${s} missing goal`);
    if (!Array.isArray(session.blocks) || session.blocks.length === 0) {
      fail(`week ${week.week} session ${s} must have at least one block`);
      continue;
    }
    for (const [i, block] of session.blocks.entries()) {
      if (!block.movement || !block.prescription) {
        fail(`week ${week.week} session ${s} block ${i} missing movement/prescription`);
      }
    }

    const sessionText = [
      session.goal ?? "",
      ...session.blocks.map((b) => `${b.movement} ${b.note ?? ""}`),
      ...(session.notes ?? []),
    ].join(" ");
    if (!PRIMARY_SKILL.test(sessionText)) {
      fail(
        `week ${week.week} session ${s} never mentions the push-away / return to the arch — it must be the primary skill in every session`,
      );
    }
    if (BANNED_MOVEMENTS.test(sessionText)) {
      fail(`week ${week.week} session ${s} contains butterfly / toes-to-bar training volume`);
    }
  }

  const extraSessions = Object.keys(week.sessions ?? {}).filter((k) => !SESSIONS.includes(k));
  if (extraSessions.length > 0) {
    fail(`week ${week.week} has unexpected session keys: ${extraSessions.join(", ")}`);
  }
}

for (let w = 1; w <= EXPECTED_WEEKS; w++) {
  if (!seenWeeks.has(w)) fail(`missing week ${w}`);
}

const totalSessions = (program.weeks ?? []).reduce(
  (n, week) => n + SESSIONS.filter((s) => week.sessions?.[s]).length,
  0,
);
if (totalSessions !== EXPECTED_TOTAL_SESSIONS) {
  fail(`expected ${EXPECTED_TOTAL_SESSIONS} total sessions, got ${totalSessions}`);
}
if (program.totalSessions !== EXPECTED_TOTAL_SESSIONS) {
  fail(`totalSessions field must be ${EXPECTED_TOTAL_SESSIONS}, got ${program.totalSessions}`);
}

// Week 1 session A is the session David does today: it needs placement and a
// conservative fatigue fallback.
const week1A = program.weeks?.find((w) => w.week === 1)?.sessions?.A;
if (!Array.isArray(week1A?.notes) || week1A.notes.length < 2) {
  fail("week 1 session A must carry placement + fallback notes");
} else if (!/fallback|fatigue|cooked|tired/i.test(week1A.notes.join(" "))) {
  fail("week 1 session A notes must include a conservative fatigue fallback");
}

// 3. Videos and movement groups.
const YT = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/;
if (!Array.isArray(program.videos) || program.videos.length === 0) {
  fail("videos must be a non-empty array");
}
if (!Array.isArray(program.videoGroups) || program.videoGroups.length === 0) {
  fail("videoGroups must be a non-empty array");
}
const declaredGroups = new Set((program.videoGroups ?? []).map((g) => g.movement));
for (const group of program.videoGroups ?? []) {
  if (!group.movement || !group.label) fail(`video group ${group.movement} missing movement/label`);
  if (BANNED_MOVEMENTS.test(`${group.movement} ${group.label}`)) {
    fail(`video group "${group.label}" still references butterfly / toes-to-bar`);
  }
}
const movementsCovered = new Set();
for (const video of program.videos ?? []) {
  if (!video.title || !video.source) fail(`video ${video.id} missing title/source`);
  if (!YT.test(video.url)) fail(`video ${video.id} has invalid YouTube URL: ${video.url}`);
  if (video.url !== `https://www.youtube.com/watch?v=${video.youtubeId}`) {
    fail(`video ${video.id} url does not match youtubeId`);
  }
  if (!declaredGroups.has(video.movement)) {
    fail(`video ${video.id} has movement "${video.movement}" with no matching videoGroup`);
  }
  movementsCovered.add(video.movement);
}
for (const m of declaredGroups) {
  if (!movementsCovered.has(m)) fail(`no movement reference video for "${m}"`);
}
for (const m of ["kipping", "linking"]) {
  if (!declaredGroups.has(m)) fail(`videoGroups must cover "${m}" for this block`);
}

// 4. Required guidance the UI renders.
if (!program.primarySkill?.cue) fail("primarySkill.cue missing");
if (!program.primarySkill?.failureSignal) fail("primarySkill.failureSignal missing");
if (!PRIMARY_SKILL.test(program.primarySkill?.cue ?? "")) {
  fail("primarySkill.cue must describe the push-away / return to the arch");
}
if (!program.spacingNote) fail("spacingNote missing");
if (program.spacingHours?.min !== 24) fail("spacingHours.min must be 24 for this block");
if (!program.m60Scaling?.points?.length) fail("m60Scaling.points missing");
if (!program.prerequisites?.mustHave?.length) fail("prerequisites.mustHave missing");
if (!program.prerequisites?.stopRules?.length) fail("prerequisites.stopRules missing");
if (program.prerequisites?.repCaps?.perSession !== 20) {
  fail(
    `prerequisites.repCaps.perSession must be 20 for this block, got ${program.prerequisites?.repCaps?.perSession}`,
  );
}
if (!program.progressionRule) fail("progressionRule missing");
if (!program.warmup?.items?.length) fail("warmup.items missing");
if (!program.feedbackPrompt?.items?.length) fail("feedbackPrompt.items missing");
if ((program.feedbackPrompt?.items ?? []).length < 3) {
  fail("feedbackPrompt must ask for clean pairs/attempts, where rhythm failed, and pain/hand hot spots");
}

const rulesText = (program.sessionRules?.items ?? []).join(" ");
if (!program.sessionRules?.items?.length) fail("sessionRules.items missing");
if (!/\b20\b/.test(rulesText)) fail("sessionRules must state the 20-rep dynamic cap");
if (!/60[–-]90/.test(rulesText)) fail("sessionRules must state the 60–90s rest between pair attempts");
if (!/two consecutive/i.test(rulesText)) fail("sessionRules must state the two-consecutive-miss stop rule");
if (!BANNED_MOVEMENTS.test(rulesText)) {
  fail("sessionRules must explicitly exclude butterfly and toes-to-bar volume");
}

if (errors.length > 0) {
  console.error(`✗ Gymnastics program validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ Gymnastics program valid: "${program.programId}", ${program.weeks.length} weeks × ${SESSIONS.join("/")}, ${totalSessions} sessions, ${program.videos.length} videos.`,
);
