#!/usr/bin/env node
/**
 * Validate the gymnastics program projection.
 *
 * Checks:
 *  1. The app projection (src/data/gymnastics-program.json) is byte-for-byte
 *     identical to the canonical health-domain source, when the canonical file
 *     is present.
 *  2. Structural rules for the current block — the individualized Mayhem
 *     toes-to-bar block: 8 weeks, one session per week (A), and on every week
 *     a skill primer, a David-scaled prescription, quality/contact rules,
 *     stop rules, a WOD-volume adjustment, a feedback contract, and the
 *     original Mayhem prescription kept visibly as source provenance.
 *  3. Source fidelity: each week's provenance carries the numbers the
 *     screenshot actually shows, week 7's cropped advanced option is marked
 *     incomplete rather than reconstructed, and no week 9 or week 10 content
 *     is invented (the week-10 retest exists only as week 1's intent mention).
 *  4. Every video has a valid YouTube URL and belongs to a declared movement
 *     group, and every declared group has at least one video.
 *  5. The archive descriptor labels all three retired blocks and never claims
 *     a completion of its own.
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

// 2. Structure — the individualized Mayhem toes-to-bar block.
const EXPECTED_WEEKS = 8;
const SESSIONS = ["A"];
const EXPECTED_TOTAL_SESSIONS = EXPECTED_WEEKS * SESSIONS.length; // 8

/** Blocks retired before this one. Progress must not carry over to any of them. */
const RETIRED_PROGRAM_IDS = [
  "gym-kip-ttb-10wk-v1",
  "gym-link-two-kip-2wk-v1",
  "gym-kipping-capacity-3wk-v1",
];

/**
 * The block the Health Dashboard currently owns. Pinned here so a deployment
 * built from a source that predates it fails prebuild loudly instead of quietly
 * shipping a retired plan — which is exactly how the capacity block was lost on
 * 2026-08-04.
 */
const EXPECTED_PROGRAM_ID = "gym-ttb-mayhem-scaled-8wk-v1";

/**
 * Source fidelity, week by week: what each Mayhem screenshot actually shows
 * must appear in that week's provenance (`session.source`), and only there.
 * These pins are the app's defence against quietly rewriting the source.
 */
const SOURCE_PLAN = [
  {
    week: 1,
    pins: [
      { re: /50 Toes to Bar/, what: "the Rx 50-rep initial test" },
      { re: /75 Toes to Bar/, what: "the advanced 75-rep initial test" },
      { re: /7\/5 Calorie Ski/i, what: "the every-minute 7/5-calorie Ski" },
      { re: /including at 0:00/i, what: "that the Ski starts at 0:00" },
      { re: /10 minutes/i, what: "the 10-minute cap" },
      { re: /retest on week 10/i, what: "the source's week-10 retest mention" },
      { re: /no week 9 or week 10 material was supplied/i, what: "that the week 9/10 material was not supplied" },
    ],
  },
  {
    week: 2,
    pins: [
      { re: /5 Sets \(2:00 on \/ 1:00 off\)/i, what: "the 5×(2:00 on/1:00 off) structure" },
      { re: /18\/15 Calorie Ski/i, what: "the 18/15-calorie Ski" },
      { re: /Max GHD Sit Ups \(or V-Ups\)/i, what: "the max GHD/V-up piece" },
      { re: /Cap at 100/i, what: "the 100-rep GHD/V-up cap" },
      { re: /1:15/, what: "the 1:15 per-set Ski cap" },
    ],
  },
  {
    week: 3,
    pins: [
      { re: /50 Double Unders/i, what: "the 50 double-unders" },
      { re: /10 Burpees to 6\\?" Target/i, what: "the 10 burpees to a 6-inch target" },
      { re: /15 Toes to Bar for Time/i, what: "the 15 toes-to-bar for time" },
      { re: /Rest 2 minutes/i, what: "the 2-minute rest" },
      { re: /10–12/, what: "the 10–12 rep reduction rule" },
      { re: /Score time to complete each set/i, what: "the per-set scoring rule" },
    ],
  },
  {
    week: 4,
    pins: [
      { re: /2:00 On\/1:00 Off until workout is completed OR 6 Sets/i, what: "the interval-or-6-sets structure" },
      { re: /5 Wall Walk/i, what: "the 5 wall walks" },
      { re: /35 Toes to Bar/, what: "the Rx 35-rep toes-to-bar bookends" },
      { re: /50 GHD Sit Ups/i, what: "the 50 GHD sit-ups" },
      { re: /50 Toes to Bar/, what: "the advanced 50-rep toes-to-bar" },
      { re: /total time with rest/i, what: "the total-time-with-rest score" },
    ],
  },
  {
    week: 5,
    pins: [
      { re: /10 Minute AMRAP/i, what: "the 10-minute AMRAP" },
      { re: /10 Toes to Bar \(OR 8\/6 Cal Ski\)/i, what: "the Rx 10 toes-to-bar or 8/6-cal Ski" },
      { re: /15 Toes to Bar \(OR 12\/10 Calorie Ski\)/i, what: "the advanced 15 toes-to-bar or 12/10-cal Ski" },
      { re: /15ft Handstand Walk/i, what: "the Rx 15 ft handstand walk" },
      { re: /25ft Handstand Walk/i, what: "the advanced 25 ft handstand walk" },
      { re: /unbroken each segment/i, what: "the unbroken handstand-walk rule" },
    ],
  },
  {
    week: 6,
    pins: [
      { re: /3-3-3-4 Intervals/, what: "the '3-3-3-4 Intervals' label, verbatim" },
      { re: /15\/12 Cal Ski/i, what: "the 15/12-calorie Ski" },
      { re: /15 Box Jump \(24\/20\)/i, what: "the 15 box jumps at 24/20" },
      { re: /Max Toes to Bar/i, what: "the max toes-to-bar set" },
      { re: /Rest 1 minute/i, what: "the 1-minute rest" },
      { re: /buy-in at 2 minutes/i, what: "the 2-minute buy-in cap" },
      { re: /do not explain it further|screenshots do not explain it further/i, what: "that the interval label is displayed without an invented explanation" },
    ],
  },
  {
    week: 7,
    pins: [
      { re: /15\/12 Calorie Row \+ 15 Toes to Ring/i, what: "the row + toes-to-ring rounds" },
      { re: /15\/12 Calorie Bike \+ 15 Toes to Bar/i, what: "the bike + toes-to-bar rounds" },
      { re: /15\/12 Calorie Ski \+ 15 GHD Sit Ups/i, what: "the ski + GHD rounds" },
      { re: /20\/16 Calorie Row/i, what: "the surviving fragment of the advanced option" },
    ],
  },
  {
    week: 8,
    pins: [
      { re: /20 Minute EMOM/i, what: "the 20-minute EMOM" },
      { re: /Odd Minutes: 30 sec Max Calorie Ski/i, what: "the odd-minute max-calorie Ski" },
      { re: /Even Minutes: 30 sec Max Toes to Bar \(OR GHD Sit Up\)/i, what: "the even-minute toes-to-bar or GHD" },
      { re: /Log reps in notes/i, what: "the log-reps-in-notes instruction" },
    ],
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

// The skill this block acquires: full toe contact via the late flick, and the
// return swing that pushes the bar away instead of dropping to a dead hang.
const PRIMARY_SKILL = /toe flick|late knee[- ]extension|return swing|push(?:es|ed)? the bar away|hollow[- ]to[- ]arch/i;
const BANNED_MOVEMENTS = /butterfly|chest[- ]to[- ]bar/i;

/** Everything the UI renders for a session, as one searchable string. */
const sessionTextOf = (session) =>
  [
    session.label ?? "",
    session.goal ?? "",
    ...(session.blocks ?? []).map((b) => `${b.movement} ${b.prescription} ${b.note ?? ""}`),
    ...(session.notes ?? []),
    ...(session.primer ?? []),
    ...(session.qualityRules ?? []),
    ...(session.stopRules ?? []),
    session.wodAdjustment ?? "",
    ...(session.feedback ?? []),
  ].join(" ");

/** The session's source provenance, as one searchable string. */
const sourceTextOf = (session) =>
  session.source ? JSON.stringify(session.source) : "";

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
    const where = `week ${week.week} session ${s}`;
    if (!session.label) fail(`${where} missing label`);
    if (!session.goal) fail(`${where} missing goal`);
    if (!Array.isArray(session.blocks) || session.blocks.length === 0) {
      fail(`${where} must have at least one block`);
      continue;
    }
    for (const [i, block] of session.blocks.entries()) {
      if (!block.movement || !block.prescription) {
        fail(`${where} block ${i} missing movement/prescription`);
      }
    }

    // Every week's individualized lane must carry all five per-week contracts.
    if (!Array.isArray(session.primer) || session.primer.length === 0) {
      fail(`${where} missing the low-fatigue skill primer`);
    }
    if (!Array.isArray(session.qualityRules) || session.qualityRules.length === 0) {
      fail(`${where} missing quality/contact rules`);
    } else {
      const quality = session.qualityRules.join(" ");
      if (!/both feet/i.test(quality) || !/inside the hands/i.test(quality)) {
        fail(`${where} quality rules must define a full contact as both feet on the bar inside the hands`);
      }
      if (!/near contact/i.test(quality)) {
        fail(`${where} quality rules must record near contacts separately`);
      }
    }
    if (!Array.isArray(session.stopRules) || session.stopRules.length === 0) {
      fail(`${where} missing stop rules`);
    } else {
      const stop = session.stopRules.join(" ");
      if (!/shoulder/i.test(stop)) fail(`${where} stop rules must cover shoulder collapse`);
      if (!/return swing/i.test(stop)) fail(`${where} stop rules must cover the return swing disappearing`);
      if (!/grip/i.test(stop)) fail(`${where} stop rules must cover insecure grip`);
      if (!/pain/i.test(stop)) fail(`${where} stop rules must cover pain`);
    }
    if (typeof session.wodAdjustment !== "string" || session.wodAdjustment.length === 0) {
      fail(`${where} missing the WOD-volume adjustment`);
    }
    if (!Array.isArray(session.feedback) || session.feedback.length === 0) {
      fail(`${where} missing the feedback contract`);
    } else {
      const feedback = session.feedback.join(" ");
      if (!/full contact/i.test(feedback)) fail(`${where} feedback must capture full contacts`);
      if (!/near contact/i.test(feedback)) fail(`${where} feedback must capture near contacts`);
      if (!/set breakdown|per set|sets/i.test(feedback)) fail(`${where} feedback must capture the set breakdown`);
      if (!/shoulder and grip fatigue|shoulder\/grip fatigue|grip fatigue/i.test(feedback)) {
        fail(`${where} feedback must capture shoulder/grip fatigue`);
      }
      if (!/return swing/i.test(feedback)) fail(`${where} feedback must capture return-swing quality`);
    }
    if (!session.source || !Array.isArray(session.source.options) || session.source.options.length === 0) {
      fail(`${where} missing the original Mayhem prescription as source provenance`);
    } else {
      if (!/Mayhem/i.test(session.source.title ?? "")) {
        fail(`${where} source title must name the Mayhem origin`);
      }
      for (const option of session.source.options) {
        if (!option.label || !Array.isArray(option.lines) || option.lines.length === 0) {
          fail(`${where} source option missing label/lines`);
        }
      }
    }

    const sessionText = sessionTextOf(session);
    if (!PRIMARY_SKILL.test(sessionText)) {
      fail(
        `${where} never mentions the late toe flick / return swing — contact acquisition must be the primary skill in every session`,
      );
    }
    if (BANNED_MOVEMENTS.test(sessionText)) {
      fail(`${where} contains butterfly / chest-to-bar training volume`);
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

// 3. Source fidelity, week by week.
for (const step of SOURCE_PLAN) {
  const session = program.weeks?.find((w) => w.week === step.week)?.sessions?.A;
  if (!session) continue; // already reported above
  const where = `week ${step.week} source`;
  const text = sourceTextOf(session);
  for (const { re, what } of step.pins) {
    if (!re.test(text)) fail(`${where} must preserve ${what} (${re})`);
  }
}

// Week 7's advanced option is cropped in the screenshot: it must be marked
// incomplete and never reconstructed.
const week7 = program.weeks?.find((w) => w.week === 7)?.sessions?.A;
if (week7?.source) {
  const advanced = (week7.source.options ?? []).find((o) => /advanced/i.test(o.label ?? ""));
  if (!advanced) {
    fail("week 7 source must show the cropped advanced option");
  } else {
    if (!advanced.incomplete || !/cropped/i.test(advanced.incomplete)) {
      fail("week 7 advanced option must be marked incomplete (cropped), not reconstructed");
    }
    // Reconstruction guard: the fragment ends at the row line, so nothing
    // beyond a row calorie figure and an ellipsis may appear.
    const extraLines = (advanced.lines ?? []).filter(
      (line) => !/^3 Rounds$/i.test(line) && !/20\/16 Calorie Row/i.test(line) && !/^…$/.test(line),
    );
    if (extraLines.length > 0) {
      fail(`week 7 advanced option reconstructs cropped content: ${extraLines.join(" | ")}`);
    }
  }
}

// No invented week 9 / week 10 content: the only place "week 10" may appear is
// week 1's source intent (the screenshot's own retest mention), and "week 9"
// only in the statement that its material was not supplied.
for (const week of program.weeks ?? []) {
  for (const s of SESSIONS) {
    const session = week.sessions?.[s];
    if (!session) continue;
    const text = `${sessionTextOf(session)} ${sourceTextOf(session)}`;
    if (/week ?9|week ?10/i.test(text)) {
      const allowed =
        /retest on week 10|no week 9 or week 10|week 9 or week 10 screenshots|week 10 exists|no week 9 or week 10 material/i;
      const stripped = text.replace(new RegExp(allowed.source, "gi"), "");
      if (/week ?9|week ?10/i.test(stripped)) {
        fail(`week ${week.week} invents week 9/10 content beyond the source's retest mention`);
      }
    }
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

// The block opens only after the FMD and full refeed — stated where the page
// opens (summary/spacing), in the prerequisites, and on week 1 itself.
if (!/17[–-]21 August FMD/.test(program.summary ?? "")) {
  fail("summary must name the 17–21 August FMD start condition");
}
if (!/refeed/i.test(program.summary ?? "")) fail("summary must require the full refeed");
if (!/FMD/.test(program.spacingNote ?? "") || !/refeed/i.test(program.spacingNote ?? "")) {
  fail("spacingNote must state the post-FMD/full-refeed start condition");
}
if (!/FMD/.test((program.prerequisites?.mustHave ?? []).join(" "))) {
  fail("prerequisites.mustHave must include the finished FMD + refeed");
}
const week1Notes = (program.weeks?.find((w) => w.week === 1)?.sessions?.A?.notes ?? []).join(" ");
if (!/FMD/.test(week1Notes) || !/refeed/i.test(week1Notes)) {
  fail("week 1 session A notes must state the FMD/refeed start condition");
}

// The Mayhem Rx is provenance, not the day's target.
const rulesText = (program.sessionRules?.items ?? []).join(" ");
if (!program.sessionRules?.items?.length) fail("sessionRules.items missing");
if (!/source context, not the day's target/i.test(rulesText)) {
  fail("sessionRules must state that the Mayhem numbers are source context, not the target");
}
if (!/both feet/i.test(rulesText) || !/inside the hands/i.test(rulesText)) {
  fail("sessionRules must define the full-rep contact standard");
}
if (!/near contact/i.test(rulesText)) {
  fail("sessionRules must separate near contacts from full reps");
}
if (!/30 or more pulling/i.test(rulesText)) {
  fail("sessionRules must state skipping/shrinking the session after ~30+ pulling/hanging reps");
}
if (!/never buy back failed technique|never .* hide/i.test(rulesText)) {
  fail("sessionRules must forbid substitute volume from hiding a technique failure");
}
if (!/butterfly/i.test(rulesText) || !/chest[- ]to[- ]bar/i.test(rulesText)) {
  fail("sessionRules must explicitly exclude butterfly and chest-to-bar volume");
}

if (!program.progressionRule) fail("progressionRule missing");
if (!/repeat a week/i.test(program.progressionRule ?? "")) {
  fail("progressionRule must state that a degraded week is repeated");
}
if (!/contact quality/i.test(program.progressionRule ?? "")) {
  fail("progressionRule must make contact quality, not the calendar, the gate");
}

if (!program.warmup?.items?.length) fail("warmup.items missing");
const warmupText = (program.warmup?.items ?? []).join(" ");
if (!/active hang/i.test(warmupText)) fail("warmup must include the active hang");
if (!/scap pull-ups/i.test(warmupText)) fail("warmup must include scap pull-ups");
if (!/beat swings/i.test(warmupText)) fail("warmup must include beat swings");
if (!/knee raises/i.test(warmupText)) fail("warmup must include slow knee raises");
if (!/toe[- ]flick/i.test(warmupText)) fail("warmup must include fresh toe-flick singles");

if (!program.feedbackPrompt?.items?.length) fail("feedbackPrompt.items missing");
const promptText = (program.feedbackPrompt?.items ?? []).join(" ");
if (!/full contacts/i.test(promptText)) fail("feedbackPrompt must ask for full contacts");
if (!/near contacts/i.test(promptText)) fail("feedbackPrompt must ask for near contacts");
if (!/set breakdown/i.test(promptText)) fail("feedbackPrompt must ask for the set breakdown");
if (!/grip fatigue/i.test(promptText)) fail("feedbackPrompt must ask for shoulder/grip fatigue");
if (!/return swing/i.test(promptText)) fail("feedbackPrompt must ask about the return swing");
if (!/pain/i.test(promptText)) fail("feedbackPrompt must ask about pain / hot spots");

// Prerequisites & safety.
if (!program.prerequisites?.mustHave?.length) fail("prerequisites.mustHave missing");
if (!program.prerequisites?.stopRules?.length) fail("prerequisites.stopRules missing");
if (program.prerequisites?.repCaps?.perSession !== 30) {
  fail(
    `prerequisites.repCaps.perSession must be 30 (the block's dynamic-attempt ceiling), got ${program.prerequisites?.repCaps?.perSession}`,
  );
}
if (!/hanging attempts/i.test(program.prerequisites?.repCaps?.label ?? "")) {
  fail("prerequisites.repCaps.label must name what the cap counts (dynamic hanging attempts)");
}
const stopText = (program.prerequisites?.stopRules ?? []).join(" ");
if (!/shoulder/i.test(stopText)) fail("stopRules must include the active shoulder collapsing");
if (!/return swing/i.test(stopText)) fail("stopRules must include the return swing disappearing");
if (!/grip/i.test(stopText) || !/hot spot/i.test(stopText)) {
  fail("stopRules must include insecure grip and hand hot spots");
}
if (!/pain/i.test(stopText)) fail("stopRules must include pain");

// Primary skill card.
if (!program.primarySkill?.cue) fail("primarySkill.cue missing");
if (!program.primarySkill?.failureSignal) fail("primarySkill.failureSignal missing");
if (!PRIMARY_SKILL.test(program.primarySkill?.cue ?? "")) {
  fail("primarySkill.cue must describe the late toe flick and the pushed-away return");
}
if (!/near contact/i.test(program.primarySkill?.failureSignal ?? "")) {
  fail("primarySkill.failureSignal must protect near contacts from being forced into reps");
}

// WOD reconciliation card.
const wodText = [program.wodScaling?.title ?? "", program.wodScaling?.intro ?? "", ...(program.wodScaling?.points ?? [])].join(" ");
if (!program.wodScaling?.points?.length) fail("wodScaling.points missing");
if (!/pulling|hanging/i.test(wodText) || !/GHD/i.test(wodText)) {
  fail("wodScaling must count WOD pulling/hanging/GHD volume against the weekly dose");
}
if (!/48 hours/.test(wodText)) fail("wodScaling must state the 48-hour buffer after big pulling/grip days");
if (!/coach/i.test(wodText)) fail("wodScaling must route in-WOD scaling through the coach");
if (!/maintenance/i.test(wodText)) {
  fail("wodScaling must keep ordinary kipping pull-ups as WOD maintenance");
}

// Gates — chest-to-bar stays separate low-volume technique work; butterfly stays deferred.
const gateItems = program.gates?.items ?? [];
if (gateItems.length < 2) fail("gates.items must cover chest-to-bar and butterfly");
const c2bGate = gateItems.find((g) => /chest[- ]to[- ]bar/i.test(g.skill ?? ""));
const butterflyGate = gateItems.find((g) => /butterfly/i.test(g.skill ?? ""));
if (!c2bGate) fail("gates must include a chest-to-bar gate");
else if (!/low-volume/i.test(c2bGate.requirement ?? "") || !/never appended|never mixed/i.test(c2bGate.requirement ?? "")) {
  fail("chest-to-bar gate must keep it a separate low-volume exposure never mixed into this block");
}
if (!butterflyGate) fail("gates must include a butterfly gate");
else if (!/15[–-]20/.test(butterflyGate.requirement ?? "") || !/coach/i.test(butterflyGate.requirement ?? "")) {
  fail("butterfly gate must require roughly 15–20 clean unbroken reps and direct coach observation");
}

// Home-bar substitutions: the 80 cm wall clearance rules out the full swing.
const homeBarText = [
  program.homeBarSubstitutions?.title ?? "",
  program.homeBarSubstitutions?.intro ?? "",
  ...(program.homeBarSubstitutions?.points ?? []),
].join(" ");
if (!program.homeBarSubstitutions?.points?.length) fail("homeBarSubstitutions.points missing");
if (!/80 cm/.test(homeBarText)) fail("homeBarSubstitutions must state the 80 cm wall clearance");
if (!/hollow[- ]to[- ]arch/i.test(homeBarText)) {
  fail("homeBarSubstitutions must say the clearance blocks the full hollow-to-arch swing");
}
if (!/knee raises/i.test(homeBarText)) {
  fail("homeBarSubstitutions must prescribe strict hanging knee raises");
}
if (!/No kipping toes-to-bar attempts/i.test(homeBarText)) {
  fail("homeBarSubstitutions must forbid dynamic toes-to-bar attempts on the home bar");
}

if (!program.m60Scaling?.points?.length) fail("m60Scaling.points missing");

// No stale copy describing the kipping-capacity block as current.
const narrative = [
  program.title ?? "",
  program.subtitle ?? "",
  program.summary ?? "",
  program.primarySkill?.cue ?? "",
  program.primarySkill?.failureSignal ?? "",
  program.progressionRule ?? "",
  ...(program.prerequisites?.mustHave ?? []),
].join(" ");
if (/clean[- ]forty|50-rep application|kipping capacity/i.test(narrative)) {
  fail("stale copy: this block trains toes-to-bar contact — the kipping-capacity block is closed");
}
if (!/knees[- ]to[- ]elbows/i.test(program.summary ?? "")) {
  fail("summary must state the verified starting point (kipping attempts reach knees-to-elbows)");
}

// 4. Videos and movement groups.
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
for (const m of ["contact", "return"]) {
  if (!declaredGroups.has(m)) fail(`videoGroups must cover "${m}" for this block`);
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
// The freshly retired capacity block must be fully labelled so its Turso rows
// can render as history.
const capacityBlock = (archive.blocks ?? []).find(
  (b) => b.programId === "gym-kipping-capacity-3wk-v1",
);
if (capacityBlock && (capacityBlock.sessions ?? []).length !== 6) {
  fail(
    `archive block gym-kipping-capacity-3wk-v1 must label all six sessions, got ${capacityBlock.sessions?.length}`,
  );
}

if (errors.length > 0) {
  console.error(`✗ Gymnastics program validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ Gymnastics program valid: "${program.programId}", ${program.weeks.length} weeks × ${SESSIONS.join("/")}, ${totalSessions} sessions, ${program.videos.length} videos, ${archive.blocks.length} archived blocks.`,
);
