/**
 * Gymnastics skill-program projection + progress helpers.
 *
 * The program content (weeks, drills, safety rules, M60 scaling, videos) is
 * OWNED by the Health Dashboard domain. The canonical source lives at:
 *   projects/health-dashboard/gymnastics-program.json
 *
 * `src/data/gymnastics-program.json` in this repo is a byte-for-byte deployable
 * copy of that canonical file. Do not hand-edit the copy — edit the canonical
 * file and re-sync. `scripts/validate-gymnastics.mjs` enforces that the two
 * stay identical and that the program is structurally valid.
 *
 * This module owns only TypeScript types and pure progress projections. It does
 * NOT own the training content or DB access.
 */

import programData from "@/data/gymnastics-program.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GymnasticsSessionKey = "A" | "B";

export type GymnasticsBlock = {
  movement: string;
  prescription: string;
  note?: string;
};

export type GymnasticsSession = {
  label: string;
  blocks: GymnasticsBlock[];
};

export type GymnasticsWeek = {
  week: number;
  phase: string;
  focus: string;
  sessions: Record<GymnasticsSessionKey, GymnasticsSession>;
};

export type GymnasticsVideo = {
  id: string;
  movement: "kipping" | "butterfly" | "toes-to-bar";
  title: string;
  source: string;
  youtubeId: string;
  url: string;
};

export type GymnasticsProgram = {
  programId: string;
  title: string;
  subtitle: string;
  summary: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  totalSessions: number;
  spacingHours: { min: number; max: number };
  sessionLabels: Record<GymnasticsSessionKey, string>;
  warmup: { title: string; items: string[] };
  progressionRule: string;
  weeks: GymnasticsWeek[];
  prerequisites: {
    title: string;
    mustHave: string[];
    repCaps: { initial: number; later: number; note: string };
    stopRules: string[];
    notes: string[];
  };
  m60Scaling: { title: string; intro: string; points: string[] };
  videos: GymnasticsVideo[];
};

export const GYMNASTICS_PROGRAM = programData as GymnasticsProgram;

export const GYMNASTICS_SESSION_KEYS: GymnasticsSessionKey[] = ["A", "B"];

// ---------------------------------------------------------------------------
// Progress projection
// ---------------------------------------------------------------------------

export type GymnasticsProgressRow = {
  week: number;
  session: GymnasticsSessionKey;
  completed: boolean;
  completedAt: string | null;
  note?: string;
};

export type GymnasticsProgressSummary = {
  programId: string;
  completedCount: number;
  totalSessions: number;
  /** Lowest week that still has an incomplete session; equals durationWeeks + 1 when finished. */
  firstIncompleteWeek: number;
  /** week -> session -> row (only rows that exist in storage). */
  byWeek: Record<number, Partial<Record<GymnasticsSessionKey, GymnasticsProgressRow>>>;
};

/** Build a progress summary for the program from stored rows. Pure. */
export function summarizeProgress(
  program: GymnasticsProgram,
  rows: GymnasticsProgressRow[],
): GymnasticsProgressSummary {
  const byWeek: GymnasticsProgressSummary["byWeek"] = {};
  for (const row of rows) {
    if (!byWeek[row.week]) byWeek[row.week] = {};
    byWeek[row.week][row.session] = row;
  }

  let completedCount = 0;
  let firstIncompleteWeek = program.durationWeeks + 1;
  let foundIncomplete = false;

  for (const week of program.weeks) {
    let weekComplete = true;
    for (const session of GYMNASTICS_SESSION_KEYS) {
      const done = byWeek[week.week]?.[session]?.completed ?? false;
      if (done) completedCount++;
      else weekComplete = false;
    }
    if (!weekComplete && !foundIncomplete) {
      firstIncompleteWeek = week.week;
      foundIncomplete = true;
    }
  }

  return {
    programId: program.programId,
    completedCount,
    totalSessions: program.weeks.length * GYMNASTICS_SESSION_KEYS.length,
    firstIncompleteWeek,
    byWeek,
  };
}

/** Group videos by their target movement, preserving source order. Pure. */
export function videosByMovement(
  program: GymnasticsProgram,
): { movement: GymnasticsVideo["movement"]; label: string; videos: GymnasticsVideo[] }[] {
  const order: { movement: GymnasticsVideo["movement"]; label: string }[] = [
    { movement: "kipping", label: "Beat swing & kipping" },
    { movement: "butterfly", label: "Butterfly progression" },
    { movement: "toes-to-bar", label: "Kipping toes-to-bar" },
  ];
  return order.map(({ movement, label }) => ({
    movement,
    label,
    videos: program.videos.filter((v) => v.movement === movement),
  }));
}
