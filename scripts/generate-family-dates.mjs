/**
 * Parses projects/family/DATES.md and writes src/data/family-dates.generated.json
 * so the app never hard-codes family dates.
 *
 * The generated JSON is a deploy mirror committed to git so Vercel builds
 * succeed without access to the monorepo sibling.  The canonical source of
 * truth is always projects/family/DATES.md — never edit the JSON by hand.
 *
 * Behaviour:
 *   1. DATES.md exists       → regenerate JSON from source.
 *   2. DATES.md missing,     → warn and keep the committed JSON mirror.
 *      JSON exists
 *   3. Neither exists        → fail (no data to build from).
 *
 * Run: node scripts/generate-family-dates.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATES_MD = resolve(__dirname, "../../../family/DATES.md");
const OUT = resolve(__dirname, "../src/data/family-dates.generated.json");

if (!existsSync(DATES_MD)) {
  if (existsSync(OUT)) {
    console.warn(
      `⚠  ${DATES_MD} not found — using committed ${OUT} as deploy mirror.`,
    );
    process.exit(0);
  }
  console.error(
    `✗  Neither ${DATES_MD} nor ${OUT} exists — cannot build without family date data.`,
  );
  process.exit(1);
}

const src = readFileSync(DATES_MD, "utf-8");

// --- helpers ----------------------------------------------------------------

function parseTable(text, sectionHeading) {
  const re = new RegExp(
    `## ${sectionHeading}[\\s\\S]*?\\n(\\|.+\\|[\\s\\S]*?)(?=\\n## |$)`,
  );
  const match = text.match(re);
  if (!match) return [];
  const lines = match[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && !l.startsWith("|---") && !l.startsWith("| Person") && !l.startsWith("| Event"));
  // drop header row (first line that starts with |)
  return lines.map((line) => {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    return cells;
  });
}

/** Matches a numeric range like "4–6", "4-6", or "4 to 6". */
const RANGE_RE = /(\d+)\s*(?:[–\u2013\u2014-]|to)\s*(\d+)/;

function parsePlanningRules(text) {
  const rules = {};

  const kidLine = text.match(/Kids.+?birthdays.*?(\d+\s*(?:[–\u2013\u2014-]|to)\s*\d+)\s*weeks/i);
  if (!kidLine) {
    throw new Error("DATES.md: could not find Kids' birthdays planning rule");
  }
  const kidRange = kidLine[0].match(RANGE_RE);
  rules.kidsPlanningStartWeeks = Number(kidRange[2]);

  const majorLine = text.match(/Major.+?birthdays\s*[\/&]\s*anniversaries.*?(\d+\s*(?:[–\u2013\u2014-]|to)\s*\d+)\s*weeks/i);
  if (!majorLine) {
    throw new Error("DATES.md: could not find Major birthdays/anniversaries planning rule");
  }
  const majorRange = majorLine[0].match(RANGE_RE);
  rules.majorPlanningStartWeeks = Number(majorRange[2]);

  return rules;
}

// --- parse ------------------------------------------------------------------

const birthdayRows = parseTable(src, "Birthdays");
if (birthdayRows.length === 0) {
  throw new Error("DATES.md: Birthdays table parsed to zero rows — check format");
}

const anniversaryRows = parseTable(src, "Anniversaries");
if (anniversaryRows.length === 0) {
  throw new Error("DATES.md: Anniversaries table parsed to zero rows — check format");
}

const milestones = [];

for (const [person, date, notes] of birthdayRows) {
  const id = person.toLowerCase().replace(/\s+/g, "-") + "-birthday";
  const isChild = /kid recommendations/i.test(notes || "");
  milestones.push({
    id,
    label: `${person}'s Birthday`,
    kind: "birthday",
    canonicalDate: date,
    ...(isChild ? { isChild: true } : {}),
    ...(notes && notes !== "Birthday" ? { note: notes.replace(/^Birthday;\s*/, "") } : {}),
  });
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

for (const [event, date, notes] of anniversaryRows) {
  const id = event.toLowerCase().replace(/\s+/g, "-");
  milestones.push({
    id,
    label: `${titleCase(event)} Anniversary`,
    kind: "anniversary",
    canonicalDate: date,
    ...(notes ? { note: notes } : {}),
  });
}

const planningRules = parsePlanningRules(src);

const output = { milestones, planningRules };

writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");
console.log(`✓ Generated ${OUT} (${milestones.length} milestones)`);
