// Nov 18 — Nokt prompt v5: the fictional turns (FICTIONAL data only; never a child's record, never production).
//
//   FAMILY_BRIDGE_TOKEN_SECRET=<synthetic ≥32 chars> node scripts/nokt-v5-fictional-turns.ts \
//     --bridge http://127.0.0.1:<port> --origin <allowed app origin> --out <file.json> [--max 14] [--label stub|real-model]
//
// Each turn goes through the app's REAL engine: dispatch (the server-built v5 request, phase and guards' context) → the bridge
// `/v1/nokt/turn` with a minted `learn` token (the loopback stub, or an isolated runtime candidate on the subscription model
// with its own ceiling ledger) → the reply with its fcr1 receipt verified with the same synthetic secret → the engine binds it
// and applies every guard (provenance, answer leak, v4 rules, the v5 helper/teacher rules). Nothing is retried; the run stops at
// `--max` bridge calls. The output holds the request phase, his (invented) line, Nokt's line and the guard verdicts — no secret.
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { asLearningContent, type LearningContent } from "../src/lib/family-learning-content.ts";
import { missionDefFor, type MissionAction } from "../src/lib/family-learning-mission.ts";
import { applyLearningOp, EMPTY_PARENT_SETTINGS, newMissionState, type LearningOp, type MissionState, type OpEnv } from "../src/lib/family-learning-state.ts";
import { buildChildBridgeSession } from "../src/lib/family-assistant-bridge.ts";
import { noktReceiptInput } from "../src/lib/family-learning-nokt-turn.ts";
import { talkStateOf, type NoktTalkPurpose } from "../src/lib/family-learning-nokt-talk.ts";
import { asksQuestion, isStuckOrHelp, rewritesSentence } from "../src/lib/family-learning-nokt-contract.ts";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BRIDGE = opt("--bridge", "http://127.0.0.1:3789")!;
const ORIGIN = opt("--origin", "http://127.0.0.1:3781")!;
const OUT = opt("--out", "/tmp/nov18/nokt-v5/fictional-turns.json")!;
const MAX = Number(opt("--max", "14"));
const LABEL = opt("--label", "stub")!;
const SECRET = process.env.FAMILY_BRIDGE_TOKEN_SECRET ?? "";
if (SECRET.length < 32) throw new Error("FAMILY_BRIDGE_TOKEN_SECRET (synthetic, ≥ 32 chars) is required");

const content: LearningContent = asLearningContent(JSON.parse(readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v7.json", import.meta.url), "utf8")));
const gh = missionDefFor(content, "v9")!;
let clock = Date.UTC(2026, 10, 18, 9, 0, 0);
let ids = 0;
const env: OpEnv = { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz" }, now: () => new Date((clock += 15_000)), newId: () => `fx-${(ids += 1)}`, noktEnabled: true } as OpEnv;
const op = (s: MissionState, o: LearningOp, e: OpEnv = env) => applyLearningOp(s, o, e);
const m = (s: MissionState, action: MissionAction) => op(s, { op: "mission", action }).state;

/** SYNTHETIC «seven visits finished» (invented values, the shape of the Visit 8 test fixture). */
function started(): MissionState {
  const s = newMissionState(content, "santiago", "2026-09-29T10:00:00.000Z");
  const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, 29 + d, h, 0, 0)).toISOString();
  s.visits = (["v1", "v2", "v4", "v5", "v6", "v7", "v8"] as const).map((id, i) => ({ id, startedAt: day(i * 3, 10), finishedAt: day(i * 3, 11), stageIndex: 99, skippedStages: [], reflection: "easy" })) as never;
  s.base = { name: "Fixture Basis", locationId: "shore", supplies: {} } as never;
  s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day(6, 10), result: "match", observed: [], matchesLayout: "ch-de-qwertz" } as never;
  s.interests = [{ id: "fx-i", visit: "v8", source: "closing", kind: "choice", text: "Das Gewächshaus vergrössern", choice: "greenhouse", at: day(18, 11) }] as never;
  return op(s, { op: "start-visit" }).state;
}
const openAt = (s: MissionState, step: string) => m(m(s, { a: "arrive", place: gh.steps.find((x) => x.id === step)!.place }), { a: "open", step });
const answer = (s: MissionState, step: string, values: Record<string, number>) => Object.entries(values).reduce((acc, [part, value]) => m(acc, { a: "answer-part", step, part, value: String(value) }), s);
function walk(s: MissionState, upTo: string[], finishMission = false): MissionState {
  for (const id of upTo) {
    s = openAt(s, id);
    const def = gh.steps.find((x) => x.id === id)!;
    if (def.kind === "story" || def.kind === "outcome") s = m(s, { a: "story-done", step: id });
    if (id === "H2-POTS") s = answer(s, id, { total: 4 });
    if (id === "H4-FLOOR") s = answer(s, id, { row: 6, rows: 5, all: 30 });
    if (id === "H5-PLANS") s = answer(s, id, { bedsA: 24, bedsB: 18 });
    if (id === "H6-CHOOSE") s = m(s, { a: "decide", step: id, option: "A" });
    if (id === "H7-JUNE") {
      s = m(s, { a: "support", step: id, kind: "play" });
      s = m(s, { a: "listen-outcome", step: id, outcome: "browser" });
      s = m(s, { a: "answer-question", step: id, question: "tomatoes", value: "Neben die Tür" });
      s = m(s, { a: "answer-question", step: id, question: "beans", value: "Hinten links" });
    }
    if (id === "H8-TOOLS") s = m(s, { a: "produce", step: id, response: "Necesitamos herramientas", modality: "typed" });
    if (id === "H9-WATERING") s = m(s, { a: "produce", step: id, response: "Necesitamos una regadera", modality: "typed" });
    if (id === "H10-TYPING") {
      s = m(s, { a: "typing-start" });
      for (;;) {
        const block = s.missions![gh.id].typing!;
        const next = block.plan.drills.find((d) => !block.drills.some((x) => x.no === d.no && x.attempted));
        if (!next) break;
        s = m(s, { a: "typing-drill", no: next.no, lines: next.lines, seconds: 30, activeSeconds: 28, idleSeconds: 2 });
      }
      s = m(s, { a: "typing-comfort", comfort: "easy" });
      s = m(s, { a: "typing-extra", take: false });
    }
    if (id === "H11-JOURNAL") {
      s = m(s, { a: "write", step: id, text: "Heute haben wir Beete geplant." });
      // Strict step, no model turn spent here: the app's check alone settles the (right) original.
      s = m(s, { a: "revise", step: id, text: "Heute haben wir Beete geplant.", nokt: false });
    }
    s = m(s, { a: "leave" });
  }
  return finishMission ? m(s, { a: "finish" }) : s;
}
const BEFORE_JOURNAL = ["H1-PLAN", "H2-POTS", "H4-FLOOR", "H5-PLANS", "H6-CHOOSE", "H7-JUNE"];

let calls = 0;
const log: Record<string, unknown>[] = [];
async function turn(caseId: string, s: MissionState, purpose: NoktTalkPurpose, session: string, input: { text?: string; choice?: string } = {}): Promise<MissionState | null> {
  if (calls >= MAX) {
    log.push({ case: caseId, skipped: `budget of ${MAX} bridge calls reached` });
    return null;
  }
  const turnId = `fx-${randomUUID().slice(0, 18)}`;
  if (purpose === "writing" && s.missions![gh.id].steps["H11-JOURNAL"]?.status !== "active") {
    log.push({ case: caseId, skipped: "the sentence step is already finished (Nokt's previous line ended it)" });
    return null;
  }
  const d = op(s, { op: "nokt-talk", action: { a: "dispatch", purpose, sessionId: session, turnId, ...(input.text !== undefined ? { text: input.text, via: "typed" as const } : {}), ...(input.choice ? { choice: input.choice } : {}) } }, { ...env, tutorAvailable: true } as OpEnv);
  const res = d.result as { request: { context: Record<string, unknown>; transcript: { role: string; text: string }[]; promptVersion: string }; phase: string };
  const childLine = [...res.request.transcript].reverse().find((t) => t.role === "child")?.text ?? null;
  const bridge = buildChildBridgeSession({ config: { secret: SECRET, bridgeUrl: BRIDGE }, childId: "santiago", sessionSuffix: "learn", jti: randomUUID(), nowMs: Date.now() });
  calls += 1;
  const started = Date.now();
  let reply: string | null = null;
  let receipt: unknown = null;
  let httpStatus = 0;
  try {
    const r = await fetch(`${BRIDGE}/v1/nokt/turn`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${bridge.token}`, "content-type": "application/json" }, body: JSON.stringify({ turnId, request: res.request }), signal: AbortSignal.timeout(90_000) });
    httpStatus = r.status;
    const j = (await r.json().catch(() => null)) as { reply?: string; receipt?: string; code?: string } | null;
    reply = typeof j?.reply === "string" ? j.reply : null;
    receipt = j?.receipt ?? null;
  } catch {
    httpStatus = -1;
  }
  const ms = Date.now() - started;
  const out = op(d.state, { op: "nokt-talk", action: { a: "reply", turnId, reply: reply ?? "", ...(reply === null ? { noReply: "unavailable" as const } : {}) } }, { ...env, tutorAvailable: true, tutorReceipt: reply === null ? null : noktReceiptInput(receipt, SECRET) } as OpEnv);
  const r = out.result as { shown: boolean; say?: string; intent?: string; reason?: string; line?: string; ended?: boolean };
  let parsed: { say?: string; intent?: string } | null = null;
  try {
    parsed = reply ? JSON.parse(reply) : null;
  } catch {
    parsed = null;
  }
  const said = parsed?.say ?? "";
  const lastNoktBefore = [...res.request.transcript].reverse().find((t) => t.role === "nokt")?.text ?? null;
  log.push({
    case: caseId,
    purpose,
    phase: res.request.context.phase,
    promptVersion: res.request.promptVersion,
    child: childLine,
    nokt: said || null,
    intent: parsed?.intent ?? null,
    httpStatus,
    ms,
    shown: r.shown,
    guards: r.shown ? "all passed (provenance, answer leak, v4 rules, v5 rules)" : `withheld: ${r.reason}`,
    appLineShown: r.shown ? null : r.line,
    checks: {
      childStuckOrHelp: childLine ? isStuckOrHelp(childLine) : false,
      noktAsksQuestion: said ? asksQuestion(said) : null,
      previousNoktAskedQuestion: lastNoktBefore ? asksQuestion(lastNoktBefore) : null,
      rewritesHisSentence: purpose === "writing" && said ? (res.request.context.writing as { hisSentence?: string } | undefined)?.hisSentence ? rewritesSentence(said, (res.request.context.writing as { hisSentence: string }).hisSentence) : false : null,
      adultWords: said ? /bleibt offen|verabschied|aufgabe|modus|gespeichert/i.test(said) : null,
      sharpS: said ? said.includes("ß") : null,
    },
  });
  return out.state;
}

// ---- the cases (fictional) ----
async function main() {
  // A) Task help during the visit (purpose visit, on the Spanish request step H8-TOOLS): «weiss nicht», then a help request.
  {
    let s = walk(started(), ["H1-PLAN", "H4-FLOOR", "H5-PLANS", "H6-CHOOSE"]);
    s = openAt(s, "H8-TOOLS");
    const sess = "fx-visit-help-0001";
    const a = await turn("task: «weiss nicht»", s, "visit", sess, { text: "weiss nicht" });
    if (a) await turn("task: help request (second turn in a row)", a, "visit", sess, { text: "hilf mir, was muss ich machen?" });
  }
  // B) Writing — a missing full stop: reaction, his answer, his corrected version.
  {
    let s = walk(started(), BEFORE_JOURNAL);
    s = openAt(s, "H11-JOURNAL");
    s = m(s, { a: "write", step: "H11-JOURNAL", text: "Die Schildkröte schwimmt im Teich" });
    const sess = "fx-writing-stop-01";
    let x = await turn("writing: missing full stop (reaction)", s, "writing", sess);
    if (x) x = await turn("writing: missing full stop (his answer «ein Punkt»)", x, "writing", sess, { text: "ein Punkt" });
    if (x) {
      x = m(x, { a: "revise", step: "H11-JOURNAL", text: "Die Schildkröte schwimmt im Teich." });
      x = await turn("writing: missing full stop (his corrected version)", x, "writing", sess);
      if (x) log.push({ case: "writing: missing full stop — step after", status: x.missions![gh.id].steps["H11-JOURNAL"].status, outcome: x.missions![gh.id].steps["H11-JOURNAL"].outcome });
    }
  }
  // C) Writing — a spelling error the app cannot see; then «weiss nicht» inside the writing step.
  {
    let s = walk(started(), BEFORE_JOURNAL);
    s = openAt(s, "H11-JOURNAL");
    s = m(s, { a: "write", step: "H11-JOURNAL", text: "Die Schildkröte hat sich den Fuss ferstaucht." });
    const sess = "fx-writing-spell-1";
    const x = await turn("writing: spelling error (reaction)", s, "writing", sess);
    if (x) await turn("writing: «weiss nicht» after Nokt's pointer", x, "writing", sess, { text: "weiss nicht" });
  }
  // D) Writing — no sentence at all.
  {
    let s = walk(started(), BEFORE_JOURNAL);
    s = openAt(s, "H11-JOURNAL");
    s = m(s, { a: "write", step: "H11-JOURNAL", text: "weiss nicht" });
    await turn("writing: no sentence at all", s, "writing", "fx-writing-none-01");
  }
  // E) Writing — the safety limit: the third wrong rewrite (two earlier ones decided by the app's check alone).
  {
    let s = walk(started(), BEFORE_JOURNAL);
    s = openAt(s, "H11-JOURNAL");
    s = m(s, { a: "write", step: "H11-JOURNAL", text: "die schildkröte hat hunger" });
    s = m(s, { a: "revise", step: "H11-JOURNAL", text: "die schildkröte hat hunger", nokt: false });
    s = m(s, { a: "revise", step: "H11-JOURNAL", text: "die Schildkröte hat hunger", nokt: false });
    s = m(s, { a: "revise", step: "H11-JOURNAL", text: "die Schildkröte hat Hunger" });
    const x = await turn("writing: safety limit (third wrong rewrite)", s, "writing", "fx-writing-limit-1");
    if (x) {
      const st = x.missions![gh.id].steps["H11-JOURNAL"].writing!.strict!;
      log.push({ case: "writing: safety limit — shown sentence recorded", shown: st.shown });
    }
  }
  // F) The look back: one question with tap answers (opener), then his tap «Überspringen».
  {
    const s = walk(started(), ["H1-PLAN", "H2-POTS", "H4-FLOOR", "H5-PLANS", "H6-CHOOSE", "H7-JUNE", "H8-TOOLS", "H9-WATERING", "H10-TYPING", "H11-JOURNAL", "H12-DONE"], true);
    const fb = op(s, { op: "closing-feedback", feedback: { difficulty: "right", enjoyment: "yes", clarity: null } } as LearningOp).state;
    const sess = "fx-debrief-v5-001";
    const x = await turn("look-back: the one question (opener)", fb, "debrief", sess);
    if (x) {
      const y = await turn("look-back: he taps «Überspringen»", x, "debrief", sess, { text: "Überspringen", choice: "skip" });
      if (y) log.push({ case: "look-back — recorded", interest: (y.interests ?? []).filter((i) => i.visit === "v9").map((i) => ({ kind: i.kind, text: i.text, note: i.uncertainty })), sessionTurns: talkStateOf(y).sessions.find((q) => q.id === sess)!.turns.length });
    }
  }
  const turns = log.filter((l) => "nokt" in l);
  const summary = { label: LABEL, bridge: BRIDGE.replace(/\/\/[^@]*@/, "//"), bridgeCalls: calls, max: MAX, shown: turns.filter((t) => t.shown).length, withheld: turns.filter((t) => !t.shown).length, generatedAt: new Date().toISOString(), note: "FICTIONAL fixtures only (invented state, no child record); no secret in this file." };
  writeFileSync(OUT, JSON.stringify({ summary, turns: log }, null, 2));
  console.log(JSON.stringify(summary));
}
await main();
