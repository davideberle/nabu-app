// ---------------------------------------------------------------------------
// Family Assistant learning — structured tutor outcome contract (content v6, N7-06).
//
// The future German-voice tutor (Nokt) may help a reasoning or diagnostic moment
// end — but conversational prose can never complete a task. A tutor result is a
// strict, task-bound claim checked here against the server's own dispatch record
// and the child's own attempts:
//
//  - bound to the authenticated child, mission, visit, step, question, task
//    version, tutor session and the state revision at dispatch; a mismatch is a
//    forged, stale or cross-child result and is refused;
//  - accepted only with a VERIFIED origin (the bridge receipt checked by the
//    route); missing / malformed / invalid origin is refused;
//  - one result per dispatch, within a bounded age; a replay is refused;
//  - evidence must reference real attempts of THAT question;
//  - `understood` is refused after any help or answer exposure (that is
//    `understood_with_support` at most) — no false independent success;
//  - the next transition is limited by purpose: a diagnostic talk about an
//    open question can never mark it answered (retry / hint / teach / pause);
//    a reflection after a correct answer may advance; `needs_practice` and
//    `not_established` lead to a fresh problem or a pause — the child can
//    always close Nokt and go on, so nothing traps them.
//
// Understanding remains the tutor's revisable, evidence-backed assessment, not a
// certainty. Pure and deterministic; the tutor itself is unavailable in this
// build (CHILD_ASSISTANT_AI_ENABLED = false), so production never reaches it.
// ---------------------------------------------------------------------------

import type { ReplyOrigin } from "./family-learning-trust.ts";

export const TUTOR_OUTCOME_STATUSES = ["understood", "understood_with_support", "needs_practice", "not_established"] as const;
export type TutorOutcomeStatus = (typeof TUTOR_OUTCOME_STATUSES)[number];
export const TUTOR_NEXT = ["advance", "retry", "hint", "teach", "fresh-problem", "pause"] as const;
export type TutorNext = (typeof TUTOR_NEXT)[number];
export const TUTOR_OUTCOME_MAX_AGE_SECONDS = 900;

/** Recorded by the server BEFORE the tutor is asked (the immutable context a result must bind to). */
export type TutorDispatch = {
  turnId: string;
  child: string;
  missionId: string;
  visit: string;
  step: string;
  part: string;
  taskVersion: number;
  sessionId: string;
  revision: number;
  purpose: "diagnostic" | "reflection";
  entry: "manual" | "offer" | "planned";
  at: string;
  status: "pending" | "consumed";
};

export type TutorOutcomeClaim = {
  v: 1;
  turnId: string;
  child: string;
  missionId: string;
  visit: string;
  step: string;
  part: string;
  taskVersion: number;
  sessionId: string;
  revision: number;
  status: TutorOutcomeStatus;
  /** Attempt numbers of THIS question in the mission run, and how many transcript turns the judgement rests on. */
  evidence: { attempts: number[]; transcriptTurns: number };
  support: { kind: "none" | "clarification" | "teaching"; answerExposed: boolean };
  next: TutorNext;
};

export type TutorOutcomeRecord = TutorOutcomeClaim & { acceptedAt: string; origin: "verified"; by: "nokt-tutor"; note: "Einschätzung des Tutors, revidierbar — kein Nachweis von Können" };

/** What the validator needs to know about the question (from the server's run, never from the claim). */
export type TutorQuestionFacts = {
  status: "open" | "correct" | "taught" | "unresolved";
  attemptNos: number[];
  /** Hints, teaching, exposure or inherited help recorded on this question before the result. */
  helped: boolean;
  answerExposed: boolean;
};

export type TutorOutcomeRefusal =
  | "malformed"
  | "origin-unverified"
  | "unknown-or-consumed"
  | "cross-child"
  | "binding-mismatch"
  | "stale"
  | "evidence-mismatch"
  | "false-independent"
  | "transition-not-allowed";

const KEYS = ["v", "turnId", "child", "missionId", "visit", "step", "part", "taskVersion", "sessionId", "revision", "status", "evidence", "support", "next"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strict whole-object schema: unknown keys, prose or a free-text "pass" are malformed. */
export function parseTutorOutcome(raw: unknown): TutorOutcomeClaim | null {
  if (!isRecord(raw)) return null;
  if (Object.keys(raw).some((k) => !(KEYS as readonly string[]).includes(k)) || KEYS.some((k) => !(k in raw))) return null;
  if (raw.v !== 1) return null;
  for (const k of ["turnId", "child", "missionId", "visit", "step", "part", "sessionId"] as const) if (typeof raw[k] !== "string" || !(raw[k] as string).length || (raw[k] as string).length > 120) return null;
  if (!Number.isInteger(raw.taskVersion) || !Number.isInteger(raw.revision) || (raw.revision as number) < 0) return null;
  if (!(TUTOR_OUTCOME_STATUSES as readonly unknown[]).includes(raw.status)) return null;
  if (!(TUTOR_NEXT as readonly unknown[]).includes(raw.next)) return null;
  const ev = raw.evidence;
  if (!isRecord(ev) || Object.keys(ev).some((k) => k !== "attempts" && k !== "transcriptTurns") || !Array.isArray(ev.attempts) || !ev.attempts.length || ev.attempts.some((n) => !Number.isInteger(n) || (n as number) < 1) || !Number.isInteger(ev.transcriptTurns) || (ev.transcriptTurns as number) < 1) return null;
  const sp = raw.support;
  if (!isRecord(sp) || Object.keys(sp).some((k) => k !== "kind" && k !== "answerExposed") || !["none", "clarification", "teaching"].includes(String(sp.kind)) || typeof sp.answerExposed !== "boolean") return null;
  return raw as unknown as TutorOutcomeClaim;
}

const ALLOWED_NEXT: Record<TutorDispatch["purpose"], Record<TutorOutcomeStatus, readonly TutorNext[]>> = {
  // An open question stays the child's to answer: the tutor can only send them back, to a hint, to teaching, or pause.
  diagnostic: { understood: ["retry", "pause"], understood_with_support: ["retry", "hint", "pause"], needs_practice: ["hint", "teach", "pause"], not_established: ["retry", "hint", "teach", "pause"] },
  // After a correct answer: an explanation may let the visit go on; otherwise a reviewed fresh problem or a pause.
  reflection: { understood: ["advance"], understood_with_support: ["advance"], needs_practice: ["fresh-problem", "pause"], not_established: ["fresh-problem", "pause"] },
};

export function validateTutorOutcome(
  raw: unknown,
  ctx: { child: string; origin: ReplyOrigin; nowIso: string; dispatch: TutorDispatch | undefined; question: TutorQuestionFacts | null; currentRevision: number },
): { ok: true; record: TutorOutcomeRecord } | { ok: false; reason: TutorOutcomeRefusal } {
  const claim = parseTutorOutcome(raw);
  if (!claim) return { ok: false, reason: "malformed" };
  if (ctx.origin !== "verified") return { ok: false, reason: "origin-unverified" };
  const d = ctx.dispatch;
  if (!d || d.status !== "pending" || d.turnId !== claim.turnId) return { ok: false, reason: "unknown-or-consumed" };
  if (claim.child !== ctx.child || d.child !== ctx.child) return { ok: false, reason: "cross-child" };
  for (const k of ["missionId", "visit", "step", "part", "taskVersion", "sessionId", "revision"] as const) if (claim[k] !== d[k]) return { ok: false, reason: "binding-mismatch" };
  const age = (Date.parse(ctx.nowIso) - Date.parse(d.at)) / 1000;
  if (!Number.isFinite(age) || age < 0 || age > TUTOR_OUTCOME_MAX_AGE_SECONDS) return { ok: false, reason: "stale" };
  // A new answer after the dispatch changes what the tutor was judging: the older result is stale.
  if (ctx.currentRevision !== d.revision) return { ok: false, reason: "stale" };
  const q = ctx.question;
  if (!q || claim.evidence.attempts.some((n) => !q.attemptNos.includes(n))) return { ok: false, reason: "evidence-mismatch" };
  // Help is decided from the server's records as well as the claim: the stricter one wins.
  const helped = q.helped || claim.support.kind !== "none";
  const exposed = q.answerExposed || claim.support.answerExposed;
  if (claim.status === "understood" && (helped || exposed)) return { ok: false, reason: "false-independent" };
  if (d.purpose === "diagnostic" && q.status !== "open") return { ok: false, reason: "transition-not-allowed" };
  if (d.purpose === "reflection" && q.status !== "correct") return { ok: false, reason: "transition-not-allowed" };
  if (!ALLOWED_NEXT[d.purpose][claim.status].includes(claim.next)) return { ok: false, reason: "transition-not-allowed" };
  return { ok: true, record: { ...claim, support: { kind: claim.support.kind, answerExposed: exposed }, acceptedAt: ctx.nowIso, origin: "verified", by: "nokt-tutor", note: "Einschätzung des Tutors, revidierbar — kein Nachweis von Können" } };
}
