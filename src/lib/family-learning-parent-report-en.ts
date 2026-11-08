// ---------------------------------------------------------------------------
// Step 1 (2026-11-01, S1-13e / S1-13c / S1-06): the parent's visit report in English, derived from the child's OWN records
// (attempt rows, support rows, mission state, Nokt talk state). Pure and deterministic: nothing is stored, nothing is
// re-scored. The earlier German sections of the parent page stay as details below it.
//
//  - one row per task the child actually worked on, in the order of the mission, with its authored version (normal /
//    harder / easier / normal again) and, for a «Weisst du noch?» warm-up, the days since teaching and whether that counts
//    as delayed retention (≥ 6 days) or a short check;
//  - each attempt in plain English (right first time, right after help, not yet, not scored), the help that was recorded
//    before it, and the parent's own «I helped here» marking when there is one (a correction, never a rewrite);
//  - «Nokt did not respond N×» with the browser-reported reasons (unreachable, timeout …) — a reason for the parent, not
//    evidence about the child;
//  - the home task shown at the end (S1-10), recorded later by the parent.
// ---------------------------------------------------------------------------

import type { LearningContent } from "./family-learning-content.ts";
import type { EvidenceBundle } from "./family-learning-db.ts";
import type { MissionDef } from "./family-learning-mission-spec.ts";
import { retentionClass } from "./family-learning-mission.ts";
import { talkStateOf } from "./family-learning-nokt-talk.ts";

export const PARENT_HELPED_NOTE = "I helped here";
export const PARENT_HELPED_TASK_NOTE = `${PARENT_HELPED_NOTE} (whole task)`;

export type ReportAttemptEn = {
  id: string;
  part: string | null;
  answer: string;
  result: "right first time" | "right after help" | "right after the answer was shown" | "not yet" | "not scored" | "revision";
  help: string[];
  parentHelped: boolean;
};

export type ReportTaskEn = {
  step: string;
  title: string;
  version: "normal" | "harder" | "easier" | "normal again" | null;
  skill: string | null;
  warmup: { skill: string; daysSinceTeaching: number | null; counts: "delayed retention" | "short check" | "no teaching record" } | null;
  attempts: ReportAttemptEn[];
  wayUsed: string | null;
};

export type VisitReportEn = {
  visit: string;
  label: string;
  mission: string;
  startedAt: string | null;
  finishedAt: string | null;
  tasks: ReportTaskEn[];
  nokt: { replies: number; noReply: number; reasons: Record<string, number> };
  homeTask: string | null;
  notes: string[];
};

const HELP_EN: Record<string, string> = {
  hint: "hint",
  representation: "picture in the hint",
  "direct-teaching": "worked solution shown",
  transcript: "text shown",
  translation: "translation",
  "line-translation": "line translated",
  "word-bank": "word list",
  "language-repair": "spelling tip",
  "answer-shown": "answer shown",
  "spacing-correction": "spacing tip (app)",
  "capital-start-correction": "capital letter tip (app)",
  "end-mark-correction": "end mark tip (app)",
  "tutor-content": "help from Nokt",
  "nokt-writing": "Nokt's reaction to the sentence",
  letters: "letters shown",
  retry: "second try",
};

const REASON_EN: Record<string, string> = {
  "no-reply-unreachable": "unreachable",
  "no-reply-timeout": "timeout",
  "no-reply-unavailable": "unavailable",
  "no-reply-busy": "busy",
  "no-reply-usage_limit": "provider limit",
  "no-reply-bad_request": "request refused",
  "no-reply-attempts_exhausted": "daily allowance used up",
  "no-reply-daily-allowance": "daily allowance used up",
  "origin-missing": "no reply",
};

function helpEn(kind: string): string {
  const k = kind.replace(/^hint:.*/, "hint").replace(/^representation:.*/, "representation").replace(/^exposed:.*/, "answer-shown");
  return HELP_EN[k] ?? k.replace(/-/g, " ");
}

function resultEn(a: EvidenceBundle["attempts"][number]): ReportAttemptEn["result"] {
  const kind = (a.answer as { kind?: string } | null)?.kind;
  if (kind === "practice") return "revision";
  if (a.evidence === "unscored" || a.correct === null) return "not scored";
  if (a.correct === false || a.evidence === "incorrect") return "not yet";
  if (a.evidence === "independent") return "right first time";
  if (a.evidence === "answer_exposed") return "right after the answer was shown";
  return "right after help";
}

const VERSION_EN = { normal: "normal", harder: "harder", easier: "easier", "normal-again": "normal again" } as const;

/** The English report of one visit of this child's own content (null when the visit has no mission). */
export function visitReportEn(bundle: Pick<EvidenceBundle, "state" | "attempts" | "supports">, content: LearningContent, visit: string, label: string): VisitReportEn | null {
  const def: MissionDef | undefined = (content.missions ?? []).find((m) => m.visit === visit);
  if (!def) return null;
  const state = bundle.state;
  const run = state?.missions?.[def.id] ?? null;
  const visitRecord = state?.visits.find((v) => v.id === visit) ?? null;
  const attempts = bundle.attempts.filter((a) => a.visitId === visit && a.taskId.startsWith(`${def.id}/`));
  const tasks: ReportTaskEn[] = [];
  for (const step of def.steps) {
    const own = attempts.filter((a) => a.taskId === `${def.id}/${step.id}` || a.taskId.startsWith(`${def.id}/${step.id}/`));
    const sr = run?.steps?.[step.id] ?? null;
    if (!own.length && !sr) continue;
    // Story and outcome beats carry no answer: they are not listed as tasks.
    if (!own.length && (step.kind === "story" || step.kind === "outcome")) continue;
    const first = own.find((a) => a.teachingMove === "warmup") ?? null;
    const seconds = first?.secondsSinceTeaching ?? null;
    tasks.push({
      step: step.id,
      title: step.title,
      version: step.adaptive ? VERSION_EN[step.adaptive.level] : null,
      skill: step.adaptive?.skill ?? step.warmup?.skill ?? null,
      warmup: step.warmup ? { skill: step.warmup.skill, daysSinceTeaching: seconds === null ? null : Math.round((seconds / 86_400) * 10) / 10, counts: ({ "delayed-retention": "delayed retention", "short-check": "short check", "no-teaching-record": "no teaching record" } as const)[retentionClass(seconds)] } : null,
      attempts: own
        .sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.attemptNo - y.attemptNo))
        .map((a) => {
          const answer = a.answer as { raw?: unknown; question?: unknown } | null;
          const helped = !!a.parentCorrection && (a.parentCorrection.note ?? "").startsWith(PARENT_HELPED_NOTE);
          return { id: a.id, part: typeof answer?.question === "string" ? answer.question : null, answer: typeof answer?.raw === "string" ? answer.raw : "", result: resultEn(a), help: a.support.map(helpEn), parentHelped: helped };
        }),
      wayUsed: (() => {
        const chosen = sr?.support.find((x) => x.kind === "method-used")?.detail ?? null;
        return chosen ? step.solve?.methods?.options.find((o) => o.id === chosen)?.label ?? chosen : null;
      })(),
    });
  }
  // Nokt: every Nokt turn of this visit (conversations and task talk) that got no shown reply, with the browser's reason.
  const reasons: Record<string, number> = {};
  let replies = 0;
  let noReply = 0;
  const count = (shown: boolean, reason: string | undefined) => {
    if (shown) {
      replies += 1;
      return;
    }
    if (!reason || !(reason.startsWith("no-reply-") || reason === "origin-missing")) return;
    noReply += 1;
    const r = REASON_EN[reason] ?? reason;
    reasons[r] = (reasons[r] ?? 0) + 1;
  };
  if (state) {
    for (const s of talkStateOf(state).sessions.filter((x) => x.visit === visit)) for (const t of s.turns) if (t.role === "nokt") count(!!t.shown, t.reason);
    for (const sr of Object.values(run?.steps ?? {})) for (const t of sr.tutorTurns ?? []) if (t.role === "nokt") count(!!t.shown, t.reason);
  }
  const home = def.steps.find((x) => x.home)?.home?.text ?? null;
  const notes: string[] = [];
  const writing = def.steps.find((x) => x.kind === "write");
  const w = writing ? run?.steps?.[writing.id]?.writing ?? null : null;
  if (w?.endMarkOnly) notes.push("The sentence only lacked its end mark: shown as a revision prompt, not counted as wrong.");
  return { visit, label, mission: def.id, startedAt: visitRecord?.startedAt ?? null, finishedAt: visitRecord?.finishedAt ?? null, tasks, nokt: { replies, noReply, reasons }, homeTask: home, notes };
}

/** «Nokt did not respond 3× (unreachable 3)» — the parent-visible reason line, or null when every turn was answered. */
export function noktNoReplyLine(n: VisitReportEn["nokt"]): string | null {
  if (!n.noReply) return null;
  const parts = Object.entries(n.reasons).map(([r, c]) => `${r} ${c}`).join(", ");
  return `Nokt did not respond ${n.noReply}×${parts ? ` (${parts})` : ""}`;
}
