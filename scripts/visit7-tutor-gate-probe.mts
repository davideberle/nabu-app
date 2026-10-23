// Visit 7 — observations for the source-bound early failure gate (Vault nabu-self-improvement/work/weekly-review-2026-10-12).
// Runs the ACTUAL tutor-outcome contract and mission engine of this source tree with synthetic state (no server, no network, no
// model) and writes normalized observations; the gate checks them against the planner's spec. It does not judge them itself.
// Usage: node scripts/visit7-tutor-gate-probe.mts <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { asLearningContent } from "../src/lib/family-learning-content.ts";
import { applyLearningOp, EMPTY_PARENT_SETTINGS, LearningOpError, newMissionState, type MissionState, type OpEnv } from "../src/lib/family-learning-state.ts";
import { validateTutorOutcome, type TutorDispatch } from "../src/lib/family-learning-tutor-outcome.ts";
import { noktModeFromEnv } from "../src/lib/family-learning-nokt.ts";
import { CHILD_ASSISTANT_AI_ENABLED } from "../src/lib/family-assistant-availability.ts";

const content = asLearningContent(JSON.parse(readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v6.json", import.meta.url), "utf8")));
const out = process.argv[2];

function env(extra: Partial<OpEnv> = {}): OpEnv {
  let t = Date.UTC(2026, 9, 24, 15, 0, 0);
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz" }, now: () => new Date((t += 20_000)), newId: () => `id-${(n += 1)}`, ...extra };
}
function sixDone(): MissionState {
  const s = newMissionState(content, "santiago", "2026-09-29T10:00:00.000Z");
  s.visits = (["v1", "v2", "v4", "v5", "v6", "v7"] as const).map((id, i) => ({ id, startedAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString(), finishedAt: new Date(Date.UTC(2026, 9, i + 1, 1)).toISOString(), stageIndex: 99, skippedStages: [], reflection: null }));
  return s;
}
const m = (s: MissionState, action: unknown, e: OpEnv) => applyLearningOp(s, { op: "mission", action } as never, e);
function attempt(fn: () => unknown): { accepted: boolean; code: string | null; reason: string | null } {
  try {
    fn();
    return { accepted: true, code: null, reason: null };
  } catch (error) {
    if (!(error instanceof LearningOpError)) throw error;
    return { accepted: false, code: error.code, reason: (error.message.match(/refused: ([a-z-]+)/) ?? [])[1] ?? error.message };
  }
}
function atG2(e: OpEnv) {
  let s = applyLearningOp(sixDone(), { op: "start-visit" }, e).state;
  s = m(s, { a: "open", step: "G1-REQUEST" }, e).state;
  s = m(s, { a: "story-done", step: "G1-REQUEST" }, e).state;
  s = m(s, { a: "leave" }, e).state;
  return m(s, { a: "open", step: "G2-PACK" }, e).state;
}

const cases: { id: string; observed: Record<string, unknown> }[] = [];
// --- engine, production default (no tutor route) ---
{
  const e = env();
  let s = atG2(e);
  const opened = m(s, { a: "tutor-open", step: "G2-PACK", entry: "manual", part: "full" }, e);
  const row = opened.records.supports.find((x) => x.kind === "mission_tutor_open")!;
  s = opened.state;
  s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, e).state;
  cases.push({ id: "production-flag-off", observed: { childAssistantAiEnabled: CHILD_ASSISTANT_AI_ENABLED } });
  cases.push({ id: "open-nokt-is-not-help", observed: { recordedHelp: (row.payload as { help: boolean }).help, available: (row.payload as { available: boolean }).available, evidenceAfter: s.missions!["MISSION-ISLAND-GARDEN"].steps["G2-PACK"].parts!.full.evidence } });
  const d = attempt(() => m(s, { a: "tutor-dispatch", step: "G2-PACK", part: "left", purpose: "diagnostic", entry: "manual", turnId: "turn-000001", sessionId: "s" }, e));
  const o = attempt(() => m(s, { a: "tutor-outcome", step: "G2-PACK", outcome: {} }, e));
  cases.push({ id: "dispatch-refused-when-unavailable", observed: { dispatchAccepted: d.accepted, dispatchCode: d.code, outcomeAccepted: o.accepted, outcomeCode: o.code } });
  // never trapped: without any tutor result the child answers and moves on
  s = m(s, { a: "answer-part", step: "G2-PACK", part: "left", value: "2" }, e).state;
  s = m(s, { a: "answer-part", step: "G2-PACK", part: "total", value: "5" }, e).state;
  cases.push({ id: "no-trap-without-tutor", observed: { stepStatus: s.missions!["MISSION-ISLAND-GARDEN"].steps["G2-PACK"].status } });
}
// --- engine with a test-only available tutor ---
{
  const e = env({ tutorAvailable: true, tutorOrigin: "verified" });
  let s = atG2(e);
  s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "3" }, e).state;
  const disp = m(s, { a: "tutor-dispatch", step: "G2-PACK", part: "full", purpose: "diagnostic", entry: "manual", turnId: "turn-000001", sessionId: "nokt-1" }, e);
  const dispatch = (disp.result as { dispatch: TutorDispatch }).dispatch;
  s = disp.state;
  const claim = { v: 1, turnId: "turn-000001", child: "santiago", missionId: "MISSION-ISLAND-GARDEN", visit: "v8", step: "G2-PACK", part: "full", taskVersion: 1, sessionId: "nokt-1", revision: dispatch.revision, status: "not_established", evidence: { attempts: [1], transcriptTurns: 1 }, support: { kind: "clarification", answerExposed: false }, next: "retry" };
  const afterAnswer = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, e).state;
  const stale = attempt(() => m(afterAnswer, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, e));
  cases.push({ id: "stale-after-new-answer", observed: { accepted: stale.accepted, reason: stale.reason } });
  const unverified = attempt(() => m(s, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, env({ tutorAvailable: true, tutorOrigin: "missing" })));
  cases.push({ id: "unverified-origin", observed: { accepted: unverified.accepted, reason: unverified.reason } });
  const ok = m(s, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, e);
  s = ok.state;
  const replay = attempt(() => m(s, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, e));
  cases.push({ id: "bound-verified-accepted-once", observed: { firstAccepted: true, storedResults: s.missions!["MISSION-ISLAND-GARDEN"].steps["G2-PACK"].tutorOutcomes!.length, replayAccepted: replay.accepted, replayReason: replay.reason } });
  s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, e).state;
  const pr = s.missions!["MISSION-ISLAND-GARDEN"].steps["G2-PACK"].parts!.full;
  cases.push({ id: "talk-help-makes-later-answer-supported", observed: { status: pr.status, evidence: pr.evidence } });
}
// --- contract, direct ---
{
  const dispatch: TutorDispatch = { turnId: "turn-000009", child: "santiago", missionId: "MISSION-ISLAND-GARDEN", visit: "v8", step: "G2-PACK", part: "total", taskVersion: 1, sessionId: "nokt-1", revision: 3, purpose: "reflection", entry: "planned", at: "2026-10-24T15:00:00.000Z", status: "pending" };
  const claim = { v: 1, turnId: "turn-000009", child: "santiago", missionId: "MISSION-ISLAND-GARDEN", visit: "v8", step: "G2-PACK", part: "total", taskVersion: 1, sessionId: "nokt-1", revision: 3, status: "understood", evidence: { attempts: [3], transcriptTurns: 2 }, support: { kind: "none", answerExposed: false }, next: "advance" };
  const ctx = { child: "santiago", origin: "verified" as const, nowIso: "2026-10-24T15:05:00.000Z", dispatch, question: { status: "correct" as "open" | "correct" | "taught" | "unresolved", attemptNos: [3], helped: false, answerExposed: false }, currentRevision: 3 };
  const r = (raw: unknown, over: Partial<typeof ctx> = {}) => {
    const v = validateTutorOutcome(raw, { ...ctx, ...over });
    return v.ok ? { accepted: true, reason: null } : { accepted: false, reason: v.reason };
  };
  cases.push({ id: "valid-reflection", observed: r(claim) });
  cases.push({ id: "free-text-pass", observed: r("Santi hat es verstanden. PASS") });
  cases.push({ id: "extra-field-verdict", observed: r({ ...claim, verdict: "pass" }) });
  cases.push({ id: "unsupported-status", observed: r({ ...claim, status: "passed" }) });
  cases.push({ id: "cross-child", observed: r(claim, { child: "isabel" }) });
  cases.push({ id: "forged-binding", observed: r({ ...claim, step: "G7-FRESH" }) });
  cases.push({ id: "expired", observed: r(claim, { nowIso: "2026-10-24T15:30:00.000Z" }) });
  cases.push({ id: "consumed", observed: r(claim, { dispatch: { ...dispatch, status: "consumed" } }) });
  cases.push({ id: "evidence-not-of-this-question", observed: r({ ...claim, evidence: { attempts: [9], transcriptTurns: 2 } }) });
  cases.push({ id: "understood-after-help", observed: r(claim, { question: { ...ctx.question, helped: true } }) });
  cases.push({ id: "understood-after-exposure", observed: r(claim, { question: { ...ctx.question, answerExposed: true } }) });
  cases.push({ id: "diagnostic-cannot-answer", observed: r({ ...claim, next: "advance" }, { dispatch: { ...dispatch, purpose: "diagnostic" }, question: { ...ctx.question, status: "open" } }) });
}
// --- the fictional stub can never be on in a deployed or shared-database environment ---
cases.push({
  id: "stub-gate",
  observed: {
    isolated: noktModeFromEnv({ FAMILY_NOKT_FICTIONAL_STUB: "1", NABU_DB_DIR: "/tmp/x" }),
    turso: noktModeFromEnv({ FAMILY_NOKT_FICTIONAL_STUB: "1", NABU_DB_DIR: "/tmp/x", TURSO_DATABASE_URL: "libsql://x" }),
    vercel: noktModeFromEnv({ FAMILY_NOKT_FICTIONAL_STUB: "1", NABU_DB_DIR: "/tmp/x", VERCEL: "1" }),
    flagOff: noktModeFromEnv({ NABU_DB_DIR: "/tmp/x" }),
  },
});
writeFileSync(out, JSON.stringify({ cases }, null, 2) + "\n");
console.log(`wrote ${cases.length} observations → ${out}`);
