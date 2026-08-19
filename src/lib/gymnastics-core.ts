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

/** One variant of an original source prescription (e.g. Rx / Advanced). */
export type GymnasticsSourceOption = {
  label: string;
  lines: string[];
  /**
   * Present when the source material for this option is incomplete (e.g. a
   * cropped screenshot). The UI must show it instead of pretending the option
   * is whole, and nothing may reconstruct the missing content.
   */
  incomplete?: string;
};

/**
 * The original programming a session was adapted from, kept visible as
 * provenance. Never the actionable prescription — that is what `blocks` are.
 */
export type GymnasticsSessionSource = {
  title: string;
  /** Source-stated cycle intent, when the material carries one. */
  intent?: string;
  options: GymnasticsSourceOption[];
  /** Source-stated caps, scoring, or scaling instructions. */
  notes?: string[];
};

export type GymnasticsSession = {
  label: string;
  /** One-line statement of what the session is for. */
  goal?: string;
  blocks: GymnasticsBlock[];
  /** Session-specific placement, readiness, or fallback guidance. */
  notes?: string[];
  /** Low-fatigue skill work that precedes anything metabolic. */
  primer?: string[];
  /** The original prescription this session was individualized from. */
  source?: GymnasticsSessionSource;
  /** What counts as a rep, and what is recorded separately. */
  qualityRules?: string[];
  /** The signals that end the session's dynamic work. */
  stopRules?: string[];
  /** How this session bends around the week's WOD volume. */
  wodAdjustment?: string;
  /** What to capture after the session, in order. */
  feedback?: string[];
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

/** A titled list of guidance points, e.g. WOD scaling or masters scaling. */
export type GymnasticsGuidanceCard = {
  title: string;
  intro: string;
  points: string[];
};

/** A skill deliberately kept out of the block, plus the bar for adding it. */
export type GymnasticsGate = {
  skill: string;
  requirement: string;
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
    /** `label` names what the cap counts (e.g. "dynamic hanging attempts"). */
    repCaps: { perSession: number; label?: string; note: string };
    stopRules: string[];
    notes: string[];
  };
  /** How to handle a workout that outruns the capacity the block has built. */
  wodScaling: GymnasticsGuidanceCard;
  /** Skills held out of the block, and what earns them afterwards. */
  gates: { title: string; intro: string; items: GymnasticsGate[] };
  /** What to do on the home bar, whose wall clearance rules out a full swing. */
  homeBarSubstitutions: GymnasticsGuidanceCard;
  m60Scaling: GymnasticsGuidanceCard;
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

// ---------------------------------------------------------------------------
// Training history (completed blocks that came before the current one)
// ---------------------------------------------------------------------------
//
// Completion is a fact about David's training, so it lives in Turso and nowhere
// else — this file never decides that a session happened. The archive is only a
// health-owned label sheet: block titles and session labels for program ids the
// app no longer carries a full program for.

/** A retired block's session slot, as the Health Dashboard labelled it. */
export type GymnasticsArchivedSession = {
  week: number;
  session: GymnasticsSessionKey;
  label: string;
};

export type GymnasticsArchivedBlock = {
  programId: string;
  title: string;
  subtitle: string;
  /** Human-readable span of the block, when the domain records one. */
  period?: string;
  /** Why the block was closed — the training meaning it handed forward. */
  outcome?: string;
  sessions: GymnasticsArchivedSession[];
};

export type GymnasticsArchive = {
  blocks: GymnasticsArchivedBlock[];
};

/** One completed session in the history view. */
export type GymnasticsHistoryEntry = {
  week: number;
  session: GymnasticsSessionKey;
  /** The archived label for this slot, or a derived fallback. */
  label: string;
  completedAt: string | null;
  note?: string;
};

export type GymnasticsHistoryBlock = {
  programId: string;
  title: string;
  subtitle: string;
  period?: string;
  outcome?: string;
  completedCount: number;
  entries: GymnasticsHistoryEntry[];
};

/** A stored row plus the program it belongs to, as read back from Turso. */
export type GymnasticsHistoryRow = GymnasticsProgressRow & { programId: string };

/**
 * Project stored rows into the completed-block history the page renders. Pure.
 *
 * Rules, all of which the tests pin:
 *  - only `completed` rows count — an untouched row from a retired block is not
 *    history, it is a leftover;
 *  - the current program is never history, however complete it is;
 *  - blocks appear in archive order, and a block with no completed rows is
 *    dropped entirely (so the retired 10-week block stays invisible);
 *  - rows from a program id the archive does not describe are dropped, because
 *    the app has no honest title or label to show for them.
 */
export function summarizeHistory(
  archive: GymnasticsArchive,
  rows: GymnasticsHistoryRow[],
  currentProgramId: string,
): GymnasticsHistoryBlock[] {
  const blocks: GymnasticsHistoryBlock[] = [];

  for (const block of archive.blocks) {
    if (block.programId === currentProgramId) continue;

    const entries = rows
      .filter((row) => row.programId === block.programId && row.completed)
      .map((row) => {
        const known = block.sessions.find(
          (s) => s.week === row.week && s.session === row.session,
        );
        return {
          week: row.week,
          session: row.session,
          label: known?.label ?? `Week ${row.week} · Session ${row.session}`,
          completedAt: row.completedAt,
          ...(row.note ? { note: row.note } : {}),
        };
      })
      .sort((a, b) => a.week - b.week || a.session.localeCompare(b.session));

    if (entries.length === 0) continue;

    blocks.push({
      programId: block.programId,
      title: block.title,
      subtitle: block.subtitle,
      ...(block.period ? { period: block.period } : {}),
      ...(block.outcome ? { outcome: block.outcome } : {}),
      completedCount: entries.length,
      entries,
    });
  }

  return blocks;
}

/**
 * Program ids the archive describes, minus the current one — the exact set the
 * history read is allowed to query. Pure.
 */
export function archivedProgramIds(
  archive: GymnasticsArchive,
  currentProgramId: string,
): string[] {
  return archive.blocks
    .map((b) => b.programId)
    .filter((id) => id !== currentProgramId);
}

// ---------------------------------------------------------------------------
// Structured session feedback
// ---------------------------------------------------------------------------
//
// The block's feedback contract (full contacts, near contacts, set breakdown,
// shoulder/grip fatigue, return-swing quality) is serialized into the existing
// per-session `note` column, so no schema or API change is needed and the
// persistent completion path is untouched.

export type GymnasticsFatigueLevel = "none" | "noticeable" | "limiting";
export type GymnasticsReturnSwing = "intact" | "faded late" | "lost";

export type GymnasticsSessionFeedback = {
  fullContacts: number | null;
  nearContacts: number | null;
  setBreakdown: string;
  fatigue: GymnasticsFatigueLevel | null;
  returnSwing: GymnasticsReturnSwing | null;
  extra: string;
};

export const GYMNASTICS_FATIGUE_LEVELS: GymnasticsFatigueLevel[] = [
  "none",
  "noticeable",
  "limiting",
];

export const GYMNASTICS_RETURN_SWING_STATES: GymnasticsReturnSwing[] = [
  "intact",
  "faded late",
  "lost",
];

/**
 * Serialize structured feedback into one readable note line. Pure. Empty
 * fields are omitted; an all-empty form returns "" so callers can refuse to
 * save a note that says nothing.
 */
export function composeSessionFeedbackNote(feedback: GymnasticsSessionFeedback): string {
  const parts: string[] = [];
  if (feedback.fullContacts !== null && Number.isFinite(feedback.fullContacts)) {
    parts.push(`Full contacts ${feedback.fullContacts}`);
  }
  if (feedback.nearContacts !== null && Number.isFinite(feedback.nearContacts)) {
    parts.push(`Near contacts ${feedback.nearContacts}`);
  }
  if (feedback.setBreakdown.trim()) parts.push(`Sets ${feedback.setBreakdown.trim()}`);
  if (feedback.fatigue) parts.push(`Shoulder/grip fatigue ${feedback.fatigue}`);
  if (feedback.returnSwing) parts.push(`Return swing ${feedback.returnSwing}`);
  const joined = parts.join(" · ");
  const extra = feedback.extra.trim();
  if (!joined) return extra;
  return extra ? `${joined} — ${extra}` : joined;
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
