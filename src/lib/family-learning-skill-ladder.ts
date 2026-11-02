// ---------------------------------------------------------------------------
// Step 2 A (2026-11-02): the parent's level-based learning report — one skills ladder per child, computed from ALL of
// the child's stored records (every visit since September). Pure and deterministic: no clock (the newest visit is
// «now»), no writes, no model call, nothing stored. Child screens never call this.
//
// Status per row (ASSESSMENT-RULES §3, as a ladder on the parent's request of 2026-11-02):
//   not seen                 no scored answer (refined as «seen, not scored» or «tried, not yet right» when there
//                            are unscored or wrong answers — an unsuccessful attempt is measured evidence, never hidden);
//   with help                right, but with help recorded before the answer — or the parent marked «I helped here»;
//   on own once              right with no help, first substantive try;
//   on own in a new situation right with no help in a second, different task (another story, setting or frame);
//   held                     a fresh task right on own ≥ 6 days after the skill was last taught or helped. For a
//                            «Weisst du noch?» warm-up the stored teachingReason decides (`…:delayed-retention`); for
//                            earlier records (before warm-ups existed) the same rule is applied to the attempt dates.
// Answer shown, copying after a shown answer and unscored answers never count as success. A parent correction of the
// evidence category wins over the stored one; «I helped here» turns an on-own answer into «with help».
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import type { EvidenceAttempt, EvidenceBundle } from "./family-learning-db.ts";
import type { TypingCourseState } from "./family-learning-state.ts";
import { DELAYED_RETENTION_DAYS } from "./family-learning-mission.ts";
import { PARENT_HELPED_NOTE } from "./family-learning-parent-report-en.ts";
import { cycleContext, KUMON_REFERENCE, resolveObjective, SKILL_ROWS, TYPING_REF, type CefrStep, type Lp21Ref, type ObjectiveRole, type SkillRow } from "./family-learning-skill-map.ts";

export const LADDER_LABEL = "Estimates from a few tasks, not test scores.";

/** The ladder steps, lowest first. «observed» and «tried» are refinements of «not seen» (no success yet). */
export type LadderStatus = "not-seen" | "observed" | "tried" | "with-help" | "on-own-once" | "on-own-new" | "held";

const RANK: Record<LadderStatus, number> = { "not-seen": 0, observed: 0, tried: 0, "with-help": 1, "on-own-once": 2, "on-own-new": 3, held: 4 };
const ORDER: LadderStatus[] = ["not-seen", "observed", "tried", "with-help", "on-own-once", "on-own-new", "held"];

export const STATUS_EN: Record<LadderStatus, string> = {
  "not-seen": "not seen",
  observed: "seen, not scored",
  tried: "tried, not yet right",
  "with-help": "with help",
  "on-own-once": "on own once",
  "on-own-new": "on own in a new situation",
  held: "held",
};

/** The five steps shown on the ladder. */
export const LADDER_STEPS: { rank: number; label: string }[] = [
  { rank: 0, label: "not seen" },
  { rank: 1, label: "with help" },
  { rank: 2, label: "on own once" },
  { rank: 3, label: "on own in a new situation" },
  { rank: 4, label: "held" },
];

export const statusRank = (s: LadderStatus) => RANK[s];

function better(a: LadderStatus, b: LadderStatus): LadderStatus {
  if (RANK[a] !== RANK[b]) return RANK[a] > RANK[b] ? a : b;
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

type AttemptLike = Pick<EvidenceAttempt, "id" | "visitId" | "taskId" | "objective" | "answer" | "correct" | "evidence" | "stimulusLanguage" | "teachingMove" | "teachingReason" | "secondsSinceTeaching" | "createdAt" | "parentCorrection"> & { modality?: string };

export type LadderInput = {
  child: ChildId;
  attempts: AttemptLike[];
  samples: Pick<EvidenceBundle["samples"][number], "visitId" | "kind" | "createdAt">[];
  /** The child's started visits, oldest first, with the parent-facing label («Visit 3»). */
  visits: { id: string; label: string; startedAt: string | null; finishedAt: string | null }[];
  typing: { course: TypingCourseState | null; lessonsTotal: number } | null;
};

export type LadderAttempt = {
  id: string;
  visit: string;
  task: string;
  at: string;
  role: ObjectiveRole;
  cefrStep: CefrStep | null;
  /** What this one answer showed, given everything before it. */
  level: LadderStatus;
  parentHelped: boolean;
  /** For «held»: whole days since the skill was last taught or helped, when known. */
  daysLater: number | null;
  /** Answered by picking from given options (a right pick can be a guess). */
  pick: boolean;
};

export type LadderRow = {
  id: string;
  subject: SkillRow["subject"];
  label: string;
  observes: string;
  mapRow: string | null;
  fit: SkillRow["fit"];
  reference:
    | { kind: "lp21"; code: string; url: string; cycle: string; bullet: string }
    | { kind: "cefr"; steps: { step: CefrStep; scale: string; page: number; text: string; status: LadderStatus | null }[] };
  status: LadderStatus;
  /** One dot per started visit: what that visit showed for this row (null = no task on it that visit). */
  trend: { visit: string; label: string; status: LadderStatus | null }[];
  evidence: { answers: number; tasks: number; notYet: number; withHelp: number; parentHelped: number; lastAt: string | null };
  meaning: string;
  latestNotYet: boolean;
  observedOnly: boolean;
  noTaskYet: boolean;
  /** CEFR rows: the step the status chip speaks for (the highest step attempted); null for Lehrplan 21 rows. */
  headlineStep: CefrStep | null;
  /** «held» / «on own in a new situation» resting only on picks, or on one task: a display marker, never a status change. */
  thin: { reason: string } | null;
  attempts: LadderAttempt[];
};

export type LadderTyping = {
  reference: { code: string; url: string; cycle: string };
  lesson: { current: number; total: number; completed: number } | null;
  accuracy: { latest: number | null; trend: { visit: string; label: string; value: number | null }[] };
  speed: { latest: number | null; trend: { visit: string; label: string; value: number | null }[] };
  rounds: number;
  note: string;
};

export type LearningLadder = {
  child: ChildId;
  label: string;
  rows: LadderRow[];
  summary: { movedUp: string; held: string; teachNext: string };
  typing: LadderTyping | null;
  kumon: { level: string; line: string };
  reconciliation: {
    found: number;
    mapped: number;
    notASkill: { objective: string; answers: number; reason: string }[];
    unmapped: { objective: string; answers: number }[];
  };
  lastVisit: { id: string; label: string } | null;
};

const DAY = 86_400_000;

/** Same task context: a mission step («MISSION-X/S3»), or a segment / older task id («LANG-ES-AGUA», «EQ-FRESH»). */
function taskContext(taskId: string): string {
  const parts = taskId.split("/");
  return parts[0].startsWith("MISSION-") ? parts.slice(0, 2).join("/") : parts[0];
}

function parentHelped(a: AttemptLike): boolean {
  return !!a.parentCorrection && (a.parentCorrection.note ?? "").startsWith(PARENT_HELPED_NOTE);
}

/** The evidence category after parent corrections: «I helped here» or any corrected category wins over the stored one. */
function effectiveEvidence(a: AttemptLike): string {
  const ev = a.parentCorrection?.evidence ?? a.evidence;
  return parentHelped(a) && ev === "independent" ? "supported" : ev;
}

type Base = "observed" | "tried" | "with-help" | "own";

function baseOf(a: AttemptLike, role: ObjectiveRole): Base {
  const kind = (a.answer as { kind?: string } | null)?.kind;
  if (role === "practice" || kind === "practice") return "observed";
  const ev = effectiveEvidence(a);
  // A parent's corrected category decides on its own (the stored «correct» flag is the app's, the correction the parent's).
  if (a.parentCorrection?.evidence || parentHelped(a)) {
    if (ev === "independent") return "own";
    if (ev === "supported") return "with-help";
    if (ev === "incorrect") return "tried";
    return "observed";
  }
  if (ev === "incorrect" || a.correct === false) return "tried";
  if (ev === "unscored" || ev === "answer_exposed" || a.correct === null) return "observed";
  if (ev === "independent" && role !== "hint-check") return "own";
  return "with-help";
}

const byTime = (x: AttemptLike, y: AttemptLike) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id < y.id ? -1 : 1);

/**
 * Walk one row's answers in time order and say what each showed, given what came before:
 *  own + warm-up → held only if the stored teachingReason says delayed retention;
 *  own (not a warm-up) on a task context never seen in this row ≥ 6 days after the row's last help / not-yet / shown
 *    answer (or, with none, after the row's first answer) → held;
 *  own on a second distinct context (easier versions do not count as a context) → on own in a new situation;
 *  otherwise own → on own once.
 */
function classify(rowAttempts: { a: AttemptLike; role: ObjectiveRole; cefrStep: CefrStep | null }[]): LadderAttempt[] {
  const out: LadderAttempt[] = [];
  const contexts = new Set<string>();
  const ownContexts = new Set<string>();
  let lastTeachAt: number | null = null;
  let firstAt: number | null = null;
  for (const { a, role, cefrStep } of rowAttempts) {
    const at = Date.parse(a.createdAt);
    const ctx = taskContext(a.taskId);
    const base = baseOf(a, role);
    let level: LadderStatus = base === "own" ? "on-own-once" : base;
    let daysLater: number | null = null;
    if (base === "own") {
      const isWarmup = role === "warmup" || a.teachingMove === "warmup";
      if (isWarmup) {
        if ((a.teachingReason ?? "").endsWith(":delayed-retention")) {
          level = "held";
          daysLater = a.secondsSinceTeaching === null ? null : Math.floor(a.secondsSinceTeaching / 86_400);
        }
      } else {
        const anchor = lastTeachAt ?? firstAt;
        if (anchor !== null && !contexts.has(ctx) && at - anchor >= DELAYED_RETENTION_DAYS * DAY) {
          level = "held";
          daysLater = Math.floor((at - anchor) / DAY);
        }
      }
      if (level !== "held" && role !== "easier") {
        const others = [...ownContexts].filter((c) => c !== ctx);
        if (others.length > 0) level = "on-own-new";
      }
      if (role !== "easier") ownContexts.add(ctx);
    } else if (base !== "observed" || (a.answer as { kind?: string } | null)?.kind === "practice" || effectiveEvidence(a) === "answer_exposed" || (!!a.teachingMove && a.teachingMove !== "warmup")) {
      // Help, a wrong answer, a shown answer or a recorded teaching move (e.g. a writing review) re-teaches: the next «held»
      // is measured from here.
      lastTeachAt = at;
    }
    if (firstAt === null) firstAt = at;
    contexts.add(ctx);
    out.push({ id: a.id, visit: a.visitId, task: a.taskId, at: a.createdAt, role, cefrStep, level, parentHelped: parentHelped(a), daysLater, pick: a.modality === "pick" });
  }
  return out;
}

function bestOf(levels: LadderStatus[]): LadderStatus {
  return levels.reduce<LadderStatus>((m, l) => better(m, l), "not-seen");
}

const STEP_ORDER: CefrStep[] = ["Pre-A1", "A1", "A2"];

/**
 * The status the chip shows. Lehrplan 21 rows: the best level ever reached. CEFR rows (review decision of 2026-11-02): the
 * best level at the HIGHEST step attempted — whole requests at A1 speak for «speaking», not the single words at Pre-A1;
 * the lower steps stay visible on the CEFR track.
 */
function headlineOf(def: SkillRow, attempts: LadderAttempt[]): { status: LadderStatus; step: CefrStep | null } {
  if (!def.cefr) return { status: bestOf(attempts.map((x) => x.level)), step: null };
  const top = [...STEP_ORDER].reverse().find((st) => attempts.some((x) => x.cefrStep === st)) ?? null;
  return { status: bestOf(attempts.filter((x) => top === null || x.cefrStep === top).map((x) => x.level)), step: top };
}

/** «Thin evidence» for «held» and «on own in a new situation»: only picks from given options, or a single task. */
function thinOf(status: LadderStatus, step: CefrStep | null, attempts: LadderAttempt[]): LadderRow["thin"] {
  if (status !== "held" && status !== "on-own-new") return null;
  const scope = attempts.filter((x) => step === null || x.cefrStep === step);
  const own = scope.filter((x) => RANK[x.level] >= RANK["on-own-once"]);
  if (own.length && own.every((x) => x.pick)) return { reason: "Only picks from given options so far — a right pick can be a guess." };
  const shown = new Set(scope.filter((x) => x.level === status).map((x) => taskContext(x.task)));
  if (shown.size === 1) return { reason: `${status === "held" ? "Held" : "The new situation"} is shown by one task only (${[...shown][0]}).` };
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one-line plain-English «what this means» — from the status and the counts only. */
function meaningOf(row: SkillRow, status: LadderStatus, ev: LadderRow["evidence"], latestNotYet: boolean, attempts: LadderAttempt[], samples: number): string {
  if (row.noTaskYet) return "No task has asked for this yet, so there is nothing to say.";
  if (row.observedOnly) return samples ? `${plural(samples, "own sentence")} written so far. Meaning is not scored (no agreed rubric), so this row shows practice, not a level.` : "No own sentence written yet.";
  const tail = latestNotYet && RANK[status] > 0 ? " The latest try was not right yet." : "";
  switch (status) {
    case "not-seen":
      return "No task on this yet.";
    case "observed":
      return `Seen in ${plural(ev.tasks, "task")}, but nothing there was scored, so there is nothing to say yet.`;
    case "tried":
      return `Tried ${plural(ev.notYet, "time")} without a right answer yet — a starting point, not a verdict.`;
    case "with-help":
      return `Right with help (a hint, a picture, a second try${ev.parentHelped ? " or a parent" : ""}); not yet right on own.${tail}`;
    case "on-own-once":
      return `Right on own once; not yet shown in a second, different task.${tail}`;
    case "on-own-new":
      return `Right on own in different tasks; not yet checked again ≥ ${DELAYED_RETENTION_DAYS} days later.${tail}`;
    case "held": {
      const d = attempts.filter((x) => x.level === "held").map((x) => x.daysLater).filter((x): x is number => x !== null);
      return `A fresh task was right on own ${d.length ? `${Math.max(...d)} days` : "days"} after it was last taught — held so far.${tail}`;
    }
  }
}

const NEXT_MOVE: Partial<Record<LadderStatus, string>> = {
  tried: "teach it again, then a fresh task of the same kind",
  observed: "a first scored task",
  "with-help": "a fresh task of the same kind, on own",
  "on-own-once": "a second, different task on own",
  "on-own-new": `a fresh check ≥ ${DELAYED_RETENTION_DAYS} days later (a warm-up)`,
};

const SUBJECT_ORDER: SkillRow["subject"][] = ["math", "german", "english", "spanish"];

export function learningLadder(input: LadderInput): LearningLadder {
  const { child } = input;
  const rowsDef = SKILL_ROWS[child];
  const visits = input.visits;
  const visitIndex = new Map(visits.map((v, i) => [v.id, i] as const));
  const byRow = new Map<string, { a: AttemptLike; role: ObjectiveRole; cefrStep: CefrStep | null }[]>();
  const found = new Map<string, number>();
  const notASkill = new Map<string, { answers: number; reason: string }>();
  const unmapped = new Map<string, number>();
  const mappedIds = new Set<string>();

  for (const a of [...input.attempts].sort(byTime)) {
    found.set(a.objective, (found.get(a.objective) ?? 0) + 1);
    const r = resolveObjective(child, a.objective, a.stimulusLanguage);
    if (r.kind === "unmapped") {
      unmapped.set(a.objective, (unmapped.get(a.objective) ?? 0) + 1);
      continue;
    }
    if (r.kind === "not-a-skill") {
      const cur = notASkill.get(a.objective);
      notASkill.set(a.objective, { answers: (cur?.answers ?? 0) + 1, reason: r.reason });
      continue;
    }
    if (!rowsDef.some((d) => d.id === r.row)) {
      // A table entry pointing at another child's row can never be shown here: treated as unmapped.
      unmapped.set(a.objective, (unmapped.get(a.objective) ?? 0) + 1);
      continue;
    }
    mappedIds.add(a.objective);
    const list = byRow.get(r.row) ?? [];
    list.push({ a, role: r.role, cefrStep: r.cefrStep });
    byRow.set(r.row, list);
  }

  const lastVisit = visits.length ? visits[visits.length - 1] : null;
  const lastIdx = lastVisit ? visits.length - 1 : -1;

  const rows: LadderRow[] = rowsDef.map((def) => {
    const list = byRow.get(def.id) ?? [];
    // CEFR rows: each descriptor step is its own skill for «new situation» and «held» (numbers in a message and following
    // directions are different things to retain); the row shows the best step.
    const attempts = def.cefr
      ? [...new Set(list.map((x) => x.cefrStep))].flatMap((step) => classify(list.filter((x) => x.cefrStep === step))).sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.id < y.id ? -1 : 1))
      : classify(list);
    const samples = def.observedOnly ? input.samples.filter((s) => s.kind === "expedition_log" || s.kind === "writing_transfer").length : 0;
    const head = headlineOf(def, attempts);
    let status: LadderStatus = def.observedOnly || def.noTaskYet ? "not-seen" : head.status;
    if (def.observedOnly && samples) status = "observed";
    const headScope = attempts.filter((x) => head.step === null || x.cefrStep === head.step);
    const trend = visits.map((v) => {
      const here = attempts.filter((x) => x.visit === v.id);
      const s = def.observedOnly ? (input.samples.some((x) => x.visitId === v.id && (x.kind === "expedition_log" || x.kind === "writing_transfer")) ? "observed" : null) : here.length ? bestOf(here.map((x) => x.level)) : null;
      return { visit: v.id, label: v.label, status: s as LadderStatus | null };
    });
    const scored = headScope.filter((x) => x.level !== "observed");
    const evidence = {
      answers: attempts.length,
      tasks: new Set(attempts.map((x) => taskContext(x.task))).size,
      notYet: attempts.filter((x) => x.level === "tried").length,
      withHelp: attempts.filter((x) => x.level === "with-help").length,
      parentHelped: attempts.filter((x) => x.parentHelped).length,
      lastAt: attempts.length ? attempts[attempts.length - 1].at : null,
    };
    const latestNotYet = scored.length > 0 && scored[scored.length - 1].level === "tried";
    const reference: LadderRow["reference"] = def.lp21
      ? { kind: "lp21", code: def.lp21.code, url: def.lp21.url, cycle: cycleContext(def.lp21), bullet: def.lp21.bullet }
      : {
          kind: "cefr",
          steps: (def.cefr ?? []).map((d) => {
            const at = attempts.filter((x) => x.cefrStep === d.step);
            return { ...d, status: at.length ? bestOf(at.map((x) => x.level)) : null };
          }),
        };
    return {
      id: def.id,
      subject: def.subject,
      label: def.label,
      observes: def.observes,
      mapRow: def.mapRow,
      fit: def.fit,
      reference,
      status,
      trend,
      evidence,
      meaning: `${head.step && !def.noTaskYet && attempts.some((x) => x.cefrStep !== head.step) ? `At ${head.step}: ` : ""}${meaningOf(def, status, evidence, latestNotYet, headScope, samples)}`,
      latestNotYet,
      observedOnly: !!def.observedOnly,
      noTaskYet: !!def.noTaskYet,
      headlineStep: def.cefr ? head.step : null,
      thin: def.observedOnly || def.noTaskYet ? null : thinOf(status, head.step, attempts),
      attempts,
    };
  });

  // Summary: three lines from the ladder itself — never free text.
  const before = (r: LadderRow) => headlineOf(rowsDef.find((d) => d.id === r.id)!, r.attempts.filter((x) => (visitIndex.get(x.visit) ?? -1) < lastIdx)).status;
  const thinTag = (r: LadderRow) => (r.thin ? " (thin evidence)" : "");
  const moved = lastVisit ? rows.filter((r) => !r.observedOnly && !r.noTaskYet && RANK[r.status] > RANK[before(r)]) : [];
  const lastHad = lastVisit ? rows.some((r) => r.attempts.some((x) => x.visit === lastVisit.id)) : false;
  const movedUp = !lastVisit
    ? "No visit yet."
    : moved.length
      ? `Moved up in ${lastVisit.label}: ${moved.map((r) => `${r.label} → ${STATUS_EN[r.status]}${thinTag(r)}`).join("; ")}.`
      : lastHad
        ? `Nothing moved up in ${lastVisit.label}.`
        : `${lastVisit.label} has no scored answers yet${lastVisit.finishedAt ? "" : " (not finished)"}.`;
  const heldRows = rows.filter((r) => r.status === "held");
  const held = heldRows.length
    ? `Held: ${heldRows.map((r) => `${r.label}${thinTag(r)}`).join("; ")}.`
    : `Nothing held yet — no fresh task right on own ≥ ${DELAYED_RETENTION_DAYS} days after teaching so far.`;
  const candidates = rows
    .filter((r) => !r.observedOnly && !r.noTaskYet && NEXT_MOVE[r.status])
    .map((r) => ({ r, pri: r.status === "tried" || r.status === "with-help" ? 0 : r.status === "on-own-once" ? 1 : r.status === "on-own-new" ? 2 : 3 }))
    .sort((x, y) => x.pri - y.pri || (y.r.evidence.lastAt ?? "").localeCompare(x.r.evidence.lastAt ?? "") || SUBJECT_ORDER.indexOf(x.r.subject) - SUBJECT_ORDER.indexOf(y.r.subject));
  const teachNext = candidates.length
    ? `Teach next: ${candidates.slice(0, 2).map(({ r }) => `${r.label} — ${NEXT_MOVE[r.status]}`).join("; then ")}.`
    : "Teach next: nothing open on the ladder.";

  const typing = typingBlock(input);
  const kumon = KUMON_REFERENCE[child];
  return {
    child,
    label: LADDER_LABEL,
    rows,
    summary: { movedUp, held, teachNext },
    typing,
    kumon: { level: kumon.level, line: `Kumon: level ${kumon.level} — entered by ${kumon.enteredBy} as a reference; not computed and not used for any status here.` },
    reconciliation: {
      found: found.size,
      mapped: mappedIds.size,
      notASkill: [...notASkill.entries()].map(([objective, v]) => ({ objective, ...v })).sort((x, y) => x.objective.localeCompare(y.objective)),
      unmapped: [...unmapped.entries()].map(([objective, answers]) => ({ objective, answers })).sort((x, y) => x.objective.localeCompare(y.objective)),
    },
    lastVisit: lastVisit ? { id: lastVisit.id, label: lastVisit.label } : null,
  };
}

function typingBlock(input: LadderInput): LadderTyping | null {
  const course = input.typing?.course ?? null;
  if (!course) return null;
  const bursts = [...course.bursts].sort((x, y) => (x.at < y.at ? -1 : 1));
  const acc = (b: TypingCourseState["bursts"][number]) => (b.denominator > 0 ? Math.round((b.correctChars / b.denominator) * 100) : null);
  const cpm = (b: TypingCourseState["bursts"][number]) => (b.seconds > 0 ? Math.round((b.typedChars / b.seconds) * 60) : null);
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  const last = bursts.length ? bursts[bursts.length - 1] : null;
  return {
    reference: { code: TYPING_REF.code, url: TYPING_REF.url, cycle: cycleContext(TYPING_REF as Lp21Ref) },
    lesson: { current: Math.min(course.lessonIndex + 1, Math.max(1, input.typing!.lessonsTotal)), total: input.typing!.lessonsTotal, completed: course.completed.length },
    accuracy: { latest: last ? acc(last) : null, trend: input.visits.map((v) => ({ visit: v.id, label: v.label, value: mean(bursts.filter((b) => b.visit === v.id).map(acc)) })) },
    speed: { latest: last ? cpm(last) : null, trend: input.visits.map((v) => ({ visit: v.id, label: v.label, value: mean(bursts.filter((b) => b.visit === v.id).map(cpm)) })) },
    rounds: bursts.length,
    note: "Accuracy = keys right out of keys expected; speed = characters typed per minute. Keystrokes cannot show which fingers were used.",
  };
}
