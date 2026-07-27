/**
 * Gymnastics program types, pure projections, and API payload validation.
 *
 * Kept free of imports on purpose: the program JSON is loaded by
 * `gymnastics.ts`, which re-exports everything here, so app code keeps
 * importing `@/lib/gymnastics`. This file is what `gymnastics-core.test.ts`
 * exercises (`node --test` cannot resolve the `@/` alias).
 *
 * The training content itself is OWNED by the Health Dashboard domain
 * (`projects/health-dashboard/gymnastics-program.json`). Nothing here decides
 * sets, reps, weeks, or session count — those are read from the program.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Weekly session slots. Stored as text in Turso, so adding a slot is additive. */
export type GymnasticsSessionKey = "A" | "B" | "C";

export type GymnasticsBlock = {
  movement: string;
  prescription: string;
  note?: string;
};

export type GymnasticsSession = {
  label: string;
  /** One-line statement of what the session is for. */
  goal?: string;
  blocks: GymnasticsBlock[];
  /** Session-specific placement, readiness, or fallback guidance. */
  notes?: string[];
};

export type GymnasticsWeek = {
  week: number;
  phase: string;
  focus: string;
  sessions: Record<GymnasticsSessionKey, GymnasticsSession>;
};

/** Movement groups are declared by the program, not hard-coded here. */
export type GymnasticsVideoGroup = {
  movement: string;
  label: string;
};

export type GymnasticsVideo = {
  id: string;
  movement: string;
  title: string;
  source: string;
  youtubeId: string;
  url: string;
};

export type GymnasticsNoteCard = {
  title: string;
  items: string[];
};

export type GymnasticsProgram = {
  programId: string;
  title: string;
  subtitle: string;
  summary: string;
  primarySkill: { title: string; cue: string; failureSignal: string };
  durationWeeks: number;
  sessionsPerWeek: number;
  totalSessions: number;
  spacingHours: { min: number; max: number };
  spacingNote: string;
  warmup: { title: string; items: string[] };
  sessionRules: GymnasticsNoteCard;
  progressionRule: string;
  feedbackPrompt: GymnasticsNoteCard;
  weeks: GymnasticsWeek[];
  prerequisites: {
    title: string;
    mustHave: string[];
    repCaps: { perSession: number; note: string };
    stopRules: string[];
    notes: string[];
  };
  m60Scaling: { title: string; intro: string; points: string[] };
  videoGroups: GymnasticsVideoGroup[];
  videos: GymnasticsVideo[];
};

/** Every slot a program may use, in display order. */
export const GYMNASTICS_SLOT_ORDER: GymnasticsSessionKey[] = ["A", "B", "C"];

/** Session slots actually present in the program's first week, in A/B/C order. Pure. */
export function sessionKeysOf(program: GymnasticsProgram): GymnasticsSessionKey[] {
  const sessions = program.weeks[0]?.sessions ?? ({} as GymnasticsWeek["sessions"]);
  return GYMNASTICS_SLOT_ORDER.filter((key) => Boolean(sessions[key]));
}

/** Type guard for untrusted session values arriving over the API. Pure. */
export function isGymnasticsSessionKey(
  value: unknown,
  keys: GymnasticsSessionKey[],
): value is GymnasticsSessionKey {
  return typeof value === "string" && (keys as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// API payload validation
// ---------------------------------------------------------------------------

/** A validated completion toggle, ready to hand to the Turso writer. */
export type GymnasticsProgressUpdate = {
  week: number;
  session: GymnasticsSessionKey;
  completed: boolean;
  note?: string;
};

export type GymnasticsParseResult =
  | { ok: true; value: GymnasticsProgressUpdate }
  | { ok: false; error: string };

/**
 * Validate an untrusted completion-toggle body against the current program.
 *
 * The valid week range and session slots are read from the program, so a block
 * of a different length or with a different number of weekly sessions needs no
 * change here — and the route handler keeps no validation logic of its own.
 * Pure, so it is tested directly rather than through the route.
 */
export function parseProgressUpdate(
  body: unknown,
  program: GymnasticsProgram,
): GymnasticsParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }

  const { week, session, completed, note } = body as Record<string, unknown>;
  const sessionKeys = sessionKeysOf(program);

  if (
    typeof week !== "number" ||
    !Number.isInteger(week) ||
    week < 1 ||
    week > program.durationWeeks
  ) {
    return { ok: false, error: `week must be an integer 1-${program.durationWeeks}` };
  }
  if (!isGymnasticsSessionKey(session, sessionKeys)) {
    return { ok: false, error: `session must be one of ${sessionKeys.join(", ")}` };
  }
  if (typeof completed !== "boolean") {
    return { ok: false, error: "completed (boolean) required" };
  }

  return {
    ok: true,
    value: { week, session, completed, ...(typeof note === "string" ? { note } : {}) },
  };
}

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
  const sessionKeys = sessionKeysOf(program);
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
    for (const session of sessionKeys) {
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
    totalSessions: program.weeks.length * sessionKeys.length,
    firstIncompleteWeek,
    byWeek,
  };
}

/**
 * Group videos by the movement groups the program declares, preserving source
 * order and dropping groups that have no videos. Pure.
 */
export function videosByMovement(
  program: GymnasticsProgram,
): { movement: string; label: string; videos: GymnasticsVideo[] }[] {
  return program.videoGroups
    .map(({ movement, label }) => ({
      movement,
      label,
      videos: program.videos.filter((v) => v.movement === movement),
    }))
    .filter((group) => group.videos.length > 0);
}
