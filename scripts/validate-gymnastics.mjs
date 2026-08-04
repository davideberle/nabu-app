#!/usr/bin/env node
/**
 * Validate the gymnastics program projection.
 *
 * Checks:
 *  1. The app projection (src/data/gymnastics-program.json) is byte-for-byte
 *     identical to the canonical health-domain source, when the canonical file
 *     is present.
 *  2. Structural rules for the current block: 3 weeks, two sessions per week
 *     (A/B) with at least one block each, six sessions in total, and the exact
 *     prescription and rep total each of those six sessions must carry.
 *  3. Every video has a valid YouTube URL and belongs to a declared movement
 *     group, and every declared group has at least one video.
 *  4. The safety, spacing, stop-rule, progression, WOD-scaling, gate, and
 *     feedback guidance the UI renders is present, and no butterfly /
 *     chest-to-bar training volume leaked into the block.
 *
 * Exit non-zero on any failure. Run: node scripts/validate-gymnastics.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");
const projectionPath = join(appRoot, "src/data/gymnastics-program.json");
const archivePath = join(appRoot, "src/data/gymnastics-archive.json");
// The health domain sits beside the app checkout in the workspace. Set
// HEALTH_DASHBOARD_DIR to point at it from a worktree or CI checkout, where the
// relative path does not resolve.
const canonicalDir =
  process.env.HEALTH_DASHBOARD_DIR || join(appRoot, "../../health-dashboard");
const canonicalPath = join(canonicalDir, "gymnastics-program.json");
const canonicalArchivePath = join(canonicalDir, "gymnastics-archive.json");

const errors = [];
const fail = (msg) => errors.push(msg);

const projectionRaw = readFileSync(projectionPath, "utf8");
const program = JSON.parse(projectionRaw);
const archiveRaw = readFileSync(archivePath, "utf8");
const archive = JSON.parse(archiveRaw);

// 1. Parity with canonical source (if reachable).
const checkParity = (canonical, projection, name) => {
  if (!existsSync(canonical)) return false;
  if (readFileSync(canonical, "utf8") !== projection) {
    fail(
      `Projection src/data/${name} is out of sync with the canonical health-dashboard/${name} (re-copy the canonical file).`,
    );
  }
  return true;
};
if (checkParity(canonicalPath, projectionRaw, "gymnastics-program.json")) {
  checkParity(canonicalArchivePath, archiveRaw, "gymnastics-archive.json");
} else {
  console.warn(
    "! Canonical health-dashboard source not reachable; skipped parity check. Set HEALTH_DASHBOARD_DIR to check it from here.",
  );
}

// 2. Structure — the current ordinary-kipping capacity block.
const EXPECTED_WEEKS = 3;
const SESSIONS = ["A", "B"];
const EXPECTED_TOTAL_SESSIONS = EXPECTED_WEEKS * SESSIONS.length; // 6

/** Blocks retired before this one. Progress must not carry over to any of them. */
const RETIRED_PROGRAM_IDS = ["gym-kip-ttb-10wk-v1", "gym-link-two-kip-2wk-v1"];

/**
 * The block the Health Dashboard currently owns. Pinned here so a deployment
 * built from a source that predates it fails prebuild loudly instead of quietly
 * shipping a retired plan — which is exactly how the capacity block was lost on
 * 2026-08-04.
 */
const EXPECTED_PROGRAM_ID = "gym-kipping-capacity-3wk-v1";

/**
 * The six sessions, in order. `prescription` must appear verbatim on one of the
 * session's blocks and `total` must appear verbatim somewhere in the session —
 * this is the training content the Health Dashboard domain owns, so the app is
 * not free to drift from it.
 */
const PLAN = [
  { week: 1, session: "A", label: /repeat fours/i, prescription: "6×4", rest: /60[–-]75 seconds/, total: "24 full reps" },
  { week: 1, session: "B", label: /rhythm on the clock/i, prescription: "EMOM 8×3", total: "24 full reps" },
  { week: 2, session: "A", label: /introduce fives/i, prescription: "6×5", rest: /75[–-]90 seconds/, total: "30 full reps", extra: [{ re: /7×4/, what: "the 7×4 fallback when rep five needs extra pulling" }] },
  { week: 2, session: "B", label: /densify fours/i, prescription: "EMOM 8×4", total: "32 full reps" },
  { week: 3, session: "A", label: /accumulate fives/i, prescription: "8×5", rest: /60[–-]90 seconds/, total: "40 full reps" },
  {
    week: 3,
    session: "B",
    label: /fifty[- ]rep benchmark/i,
    prescription: "10×5 on a 90-second clock",
    total: "50 full reps",
    extra: [{ re: /only after week 3 session A is clean/i, what: "the benchmark gate on a clean week 3 session A" }, { re: /shoulders, elbows, grip, and hands/i, what: "the shoulders/elbows/grip/hands readiness check" }],
  },
];

if (typeof program.programId !== "string" || program.programId.length === 0) {
  fail("programId must be a non-empty string");
}
for (const retired of RETIRED_PROGRAM_IDS) {
  if (program.programId === retired) {
    fail(
      `programId must differ from the retired ${retired} so completed progress from that block does not mark this block's sessions done`,
    );
  }
}
if (program.programId !== EXPECTED_PROGRAM_ID) {
  fail(
    `programId must be ${EXPECTED_PROGRAM_ID} (the block the health domain currently owns), got ${program.programId} — this build would ship the wrong plan`,
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

// Holding the push-away through every rep of every set is the point of the
// block: every session must train it somewhere in its goal or its blocks.
// Deliberately narrow — a bare "link" says reps were joined, not that the
// push-away was held, so it does not count on its own.
const PRIMARY_SKILL = /push[- ]?away|\bdescent\b|\barch(?:ed|ing)?\b|\bbackswing\b/i;
const BANNED_MOVEMENTS = /butterfly|chest[- ]to[- ]bar/i;

/** Everything the UI renders for a session, as one searchable string. */
const sessionTextOf = (session) =>
  [
    session.label ?? "",
    session.goal ?? "",
    ...(session.blocks ?? []).map((b) => `${b.movement} ${b.prescription} ${b.note ?? ""}`),
    ...(session.notes ?? []),
  ].join(" ");

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

    const sessionText = sessionTextOf(session);
    if (!PRIMARY_SKILL.test(sessionText)) {
      fail(
        `week ${week.week} session ${s} never mentions the push-away / arch — it must be the primary skill in every session`,
      );
    }
    if (BANNED_MOVEMENTS.test(sessionText)) {
      fail(`week ${week.week} session ${s} contains butterfly / chest-to-bar training volume`);
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

// The exact progression, session by session.
for (const step of PLAN) {
  const session = program.weeks?.find((w) => w.week === step.week)?.sessions?.[step.session];
  if (!session) continue; // already reported above
  const where = `week ${step.week} session ${step.session}`;
  const text = sessionTextOf(session);

  if (!step.label.test(session.label ?? "")) {
    fail(`${where} label must match ${step.label} — got "${session.label}"`);
  }
  if (!(session.blocks ?? []).some((b) => b.prescription === step.prescription)) {
    fail(`${where} must prescribe exactly "${step.prescription}"`);
  }
  if (!text.includes(step.total)) {
    fail(`${where} must state a session total of "${step.total}"`);
  }
  if (step.rest && !step.rest.test(text)) {
    fail(`${where} must state its rest interval (${step.rest})`);
  }
  for (const { re, what } of step.extra ?? []) {
    if (!re.test(text)) fail(`${where} must state ${what}`);
  }
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

// The first session opens the block, so it must carry the 48h-clean-of-pulling
// entry condition rather than leaving it to the general spacing note alone.
const week1A = program.weeks?.find((w) => w.week === 1)?.sessions?.A;
if (!Array.isArray(week1A?.notes) || week1A.notes.length === 0) {
  fail("week 1 session A must carry entry-condition notes");
} else if (!/48 hours/.test(week1A.notes.join(" "))) {
  fail("week 1 session A notes must state the 48 hours without dynamic pulling before the first session");
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
    fail(`video group "${group.label}" references butterfly / chest-to-bar`);
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
  fail("primarySkill.cue must describe holding the push-away");
}

// Spacing: 48h clean before the first session, 48–72h between sessions.
if (!program.spacingNote) fail("spacingNote missing");
if (program.spacingHours?.min !== 48) {
  fail(`spacingHours.min must be 48 for this block, got ${program.spacingHours?.min}`);
}
if (program.spacingHours?.max !== 72) {
  fail(`spacingHours.max must be 72 for this block, got ${program.spacingHours?.max}`);
}
if (!/48 hours/.test(program.spacingNote ?? "")) {
  fail("spacingNote must state the 48 hours without dynamic pulling before the first session");
}
if (!/48[–-]72 hours/.test(program.spacingNote ?? "")) {
  fail("spacingNote must state the 48–72 hour gap between sessions");
}

if (!program.prerequisites?.mustHave?.length) fail("prerequisites.mustHave missing");
if (!program.prerequisites?.stopRules?.length) fail("prerequisites.stopRules missing");
if (program.prerequisites?.repCaps?.perSession !== 50) {
  fail(
    `prerequisites.repCaps.perSession must be 50 (the week 3 benchmark) for this block, got ${program.prerequisites?.repCaps?.perSession}`,
  );
}
if (!program.progressionRule) fail("progressionRule missing");
if (!/repeat a session/i.test(program.progressionRule ?? "")) {
  fail("progressionRule must state that a session is repeated until it is clean");
}
if (!program.warmup?.items?.length) fail("warmup.items missing");

// Warm-up is fixed for every session.
const WARMUP = ["2×6 scap pull-ups", "2×5 controlled beat swings", "1 easy set of 3 linked kipping pull-ups"];
for (const item of WARMUP) {
  if (!(program.warmup?.items ?? []).includes(item)) fail(`warmup must include "${item}"`);
}

if (!program.feedbackPrompt?.items?.length) fail("feedbackPrompt.items missing");
if ((program.feedbackPrompt?.items ?? []).length < 3) {
  fail("feedbackPrompt must ask for clean sets, where the push-away went, and pain / hand hot spots");
}

// Stop rules — the four signals that end a set.
const stopText = (program.prerequisites?.stopRules ?? []).join(" ");
if (!/push[- ]?away/i.test(stopText)) fail("stopRules must include the push-away disappearing");
if (!/arm[- ]dominant/i.test(stopText)) fail("stopRules must include the kip turning arm-dominant");
if (!/pain/i.test(stopText)) fail("stopRules must include pain");
if (!/hot spot/i.test(stopText)) fail("stopRules must include a hand hot spot");

// Session rules — spacing against the WOD, stopping, regression, exclusions.
const rulesText = (program.sessionRules?.items ?? []).join(" ");
if (!program.sessionRules?.items?.length) fail("sessionRules.items missing");
if (!/30 or more pulling reps|30\+ pulling reps/i.test(rulesText)) {
  fail("sessionRules must state skipping the session when the WOD already has ~30+ pulling reps");
}
if (!/two rhythm failures/i.test(rulesText)) {
  fail("sessionRules must state moving back one step after two rhythm failures");
}
if (!/push[- ]?away/i.test(rulesText) || !/arm[- ]dominant/i.test(rulesText)) {
  fail("sessionRules must state the stop-the-set rule (push-away gone / arm-dominant kip)");
}
if (!/butterfly/i.test(rulesText) || !/chest[- ]to[- ]bar/i.test(rulesText)) {
  fail("sessionRules must explicitly exclude butterfly and chest-to-bar volume");
}

// WOD scaling for a 50-rep pull-up workout that arrives before the benchmark.
const wodText = [program.wodScaling?.title ?? "", program.wodScaling?.intro ?? "", ...(program.wodScaling?.points ?? [])].join(" ");
if (!program.wodScaling?.points?.length) fail("wodScaling.points missing");
if (!/\b50\b/.test(wodText)) fail("wodScaling must name the 50-pull-up WOD");
if (!/from rep one|from the first rep/i.test(wodText)) fail("wodScaling must say to break from rep one");
if (!/sets of three/i.test(wodText)) fail("wodScaling must prescribe sets of three for the unassisted portion");
if (!/coach/i.test(wodText)) fail("wodScaling must send volume/movement scaling through the coach");
if (!/time domain/i.test(wodText)) fail("wodScaling must preserve the intended time domain");

// Gates — what is deliberately held out of the block, and what earns it.
const gateItems = program.gates?.items ?? [];
if (gateItems.length < 2) fail("gates.items must cover chest-to-bar and butterfly");
const c2bGate = gateItems.find((g) => /chest[- ]to[- ]bar/i.test(g.skill ?? ""));
const butterflyGate = gateItems.find((g) => /butterfly/i.test(g.skill ?? ""));
if (!c2bGate) fail("gates must include a chest-to-bar gate");
else if (!/sets of five/i.test(c2bGate.requirement ?? "") || !/8[–-]10/.test(c2bGate.requirement ?? "")) {
  fail("chest-to-bar gate must require routine sets of five and 8–10 clean ordinary kipping reps");
}
if (!butterflyGate) fail("gates must include a butterfly gate");
else if (!/15[–-]20/.test(butterflyGate.requirement ?? "") || !/coach/i.test(butterflyGate.requirement ?? "")) {
  fail("butterfly gate must require roughly 15–20 clean unbroken reps and direct coach observation");
}

if (!program.m60Scaling?.points?.length) fail("m60Scaling.points missing");

// No stale copy describing pair acquisition as the current limiter.
const narrative = [
  program.title ?? "",
  program.subtitle ?? "",
  program.summary ?? "",
  program.primarySkill?.cue ?? "",
  program.primarySkill?.failureSignal ?? "",
  program.progressionRule ?? "",
  ...(program.prerequisites?.mustHave ?? []),
].join(" ");
if (/link(ing)? (two|a pair)|linked pair|pair attempts/i.test(narrative)) {
  fail("stale copy: this block builds capacity — linking a pair is no longer the limiter");
}

// 5. The archive descriptor — titles and session labels for retired blocks.
// It must never claim a completion: whether a session happened is only ever
// read from health_gymnastics_progress rows.
const archiveIds = new Set();
if (!Array.isArray(archive.blocks) || archive.blocks.length === 0) {
  fail("gymnastics-archive.json must list the retired blocks under `blocks`");
}
for (const block of archive.blocks ?? []) {
  const where = `archive block ${block.programId ?? "(no id)"}`;
  if (!block.programId) fail(`${where} missing programId`);
  if (!block.title || !block.subtitle) fail(`${where} missing title/subtitle`);
  if (archiveIds.has(block.programId)) fail(`${where} is listed twice`);
  archiveIds.add(block.programId);
  if (block.programId === program.programId) {
    fail(`${where} is the current block — the archive describes retired blocks only`);
  }
  if (!Array.isArray(block.sessions)) fail(`${where} sessions must be an array`);
  for (const s of block.sessions ?? []) {
    if (typeof s.week !== "number" || !s.session || !s.label) {
      fail(`${where} has a session entry missing week/session/label`);
    }
    if ("completed" in s || "completedAt" in s) {
      fail(`${where} records completion in the descriptor — completion belongs in Turso rows only`);
    }
  }
}
for (const retired of RETIRED_PROGRAM_IDS) {
  if (!archiveIds.has(retired)) {
    fail(`gymnastics-archive.json must describe the retired ${retired} so its history can be titled`);
  }
}

if (errors.length > 0) {
  console.error(`✗ Gymnastics program validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ Gymnastics program valid: "${program.programId}", ${program.weeks.length} weeks × ${SESSIONS.join("/")}, ${totalSessions} sessions, ${program.videos.length} videos, ${archive.blocks.length} archived blocks.`,
);
