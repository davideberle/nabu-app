// Nokt tutor prompt and conversation contract — fictional offline cases only.
// No model, no provider, no network: every "reply" below is hand-written fictional
// output, checked by the deterministic contract the app would apply to a real one.
//
// Run with: npm test  (node --test; types stripped natively)

import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sha256Hex } from "./family-learning-hash.ts";
import type { MissionSolve } from "./family-learning-mission-spec.ts";
import {
  buildNoktRequest,
  checkNoktReply,
  NOKT_MAX_CHILD_TURNS,
  NOKT_PROMPT_VERSION,
  NOKT_SYSTEM_PROMPT_DE,
  noktReceiptBinding,
  noktTaskContext,
  parseNoktReply,
  statesNumber,
  type NoktTurnText,
} from "./family-learning-nokt-contract.ts";
import { receiptOrigin } from "./family-learning-trust.ts";
import { validateTutorOutcome, type TutorDispatch } from "./family-learning-tutor-outcome.ts";

// The reviewed Visit 7 content (G2 «Tragen packen»), read as data.
const content = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v6.json", import.meta.url), "utf8"));
const garden = content.missions.find((m: { id: string }) => m.id === "MISSION-ISLAND-GARDEN");
const g2 = garden.steps.find((s: { id: string }) => s.id === "G2-PACK");
const solve: MissionSolve = g2.solve;
const full = solve.parts.find((p) => p.id === "full")!;

const ctx = (attempts: string[], hintIdsShown: string[] = []) => noktTaskContext({ step: "G2-PACK", solve, part: full, purpose: "diagnostic", attempts, hintIdsShown });
const reply = (say: string, intent = "clarify", outcome: unknown = null) => ({ v: 1, say, intent, outcome });
const child = (text: string, via: "voice" | "typed" = "voice"): NoktTurnText => ({ role: "child", text, via });
const nokt = (text: string): NoktTurnText => ({ role: "nokt", text, via: "typed" });

describe("Nokt request — only what is on his screen", () => {
  it("carries facts, the question, his attempts and shown hints — never the answer, the teaching or unrevealed hints", () => {
    const c = ctx(["5", "6"], []);
    const { request, reqHash } = buildNoktRequest(c, [child("ich hab einfach geraten")]);
    const json = JSON.stringify(request);
    deepEqual(c.facts, solve.facts);
    equal(c.question, full.question);
    deepEqual(c.attempts, ["5", "6"]);
    deepEqual(c.hintsShown, []);
    ok(!json.includes(full.teach), "the worked teaching is not sent");
    for (const h of full.hints) ok(!json.includes(h.text), `hint ${h.id} not shown → not sent`);
    ok(!/"answer"/.test(json), "no answer field anywhere");
    equal(request.promptVersion, NOKT_PROMPT_VERSION);
    equal(reqHash, sha256Hex(json));
  });

  it("a hint he has seen is part of the context; its check answer is not", () => {
    const h1 = full.hints[0];
    const c = ctx(["5"], [h1.id]);
    deepEqual(c.hintsShown, [h1.text]);
    if (h1.check) ok(!JSON.stringify(c).includes(`"${h1.check.answer}"`));
  });

  it("the prompt is German, asks one short question at a time and forbids interrogating for wording", () => {
    ok(NOKT_SYSTEM_PROMPT_DE.includes("Deutsch"));
    ok(NOKT_SYSTEM_PROMPT_DE.includes("höchstens eine Frage"));
    ok(NOKT_SYSTEM_PROMPT_DE.includes("bis das Kind einen bestimmten Satz wiederholt"));
    ok(NOKT_SYSTEM_PROMPT_DE.includes("Hörfehler"));
    ok(!statesNumber(NOKT_SYSTEM_PROMPT_DE, full.answer) || !NOKT_SYSTEM_PROMPT_DE.includes(full.question), "the generic prompt holds no task answer");
  });

  it("the same context and transcript give the same request hash; a changed turn changes it", () => {
    const a = buildNoktRequest(ctx(["5"]), [child("fünf")]).reqHash;
    equal(buildNoktRequest(ctx(["5"]), [child("fünf")]).reqHash, a);
    ok(buildNoktRequest(ctx(["5"]), [child("sechs")]).reqHash !== a);
  });
});

describe("Nokt reply — strict shape", () => {
  it("accepts exactly {v, say, intent, outcome}", () => {
    ok(parseNoktReply(reply("Was sollst du bei dieser Frage herausfinden?")));
    equal(parseNoktReply({ ...reply("Hallo"), extra: 1 }), null);
    equal(parseNoktReply(reply("Hallo", "praise")), null);
    equal(parseNoktReply(reply("")), null);
    equal(parseNoktReply(reply("x".repeat(221))), null);
    equal(parseNoktReply("Super, du hast es verstanden!"), null, "prose is never a reply");
    equal(parseNoktReply(reply("Gut.", "close", { status: "understood" })), null, "a loose outcome is malformed");
  });
});

describe("Nokt reply — fictional cases against the guard (G2 «full», answer known only to the app)", () => {
  const diag = (transcript: NoktTurnText[] = []) => ({ purpose: "diagnostic" as const, answer: full.answer, transcript });

  it("a neutral clarifying question is accepted", () => {
    deepEqual(checkNoktReply(parseNoktReply(reply("Was sollst du bei dieser Frage herausfinden?")), diag([child("fünf")])), { ok: true, exposesAnswer: false });
  });

  it("asking about his method is accepted, also when he names a wrong number", () => {
    deepEqual(checkNoktReply(parseNoktReply(reply("Wie bist du auf fünf gekommen?", "ask-method")), diag([child("fünf")])), { ok: true, exposesAnswer: false });
  });

  it("stating the answer before teaching is refused — digits and the German word", () => {
    deepEqual(checkNoktReply(parseNoktReply(reply(`Es sind ${full.answer} Tragen. Stimmt das?`)), diag()), { ok: false, reason: "answer-before-teaching" });
    deepEqual(checkNoktReply(parseNoktReply(reply("Ich glaube, vier passt. Was meinst du?")), diag()), { ok: false, reason: "answer-before-teaching" });
  });

  it("explicit teaching may state it, and is flagged as answer exposure", () => {
    deepEqual(checkNoktReply(parseNoktReply(reply("Schau: 4 Tragen mit je 4 Setzlingen sind 16. Es bleiben 2 übrig.", "teach")), diag()), { ok: true, exposesAnswer: true });
  });

  it("two questions in one line are refused", () => {
    deepEqual(checkNoktReply(parseNoktReply(reply("Was fragt die Aufgabe? Und wie hast du gerechnet?")), diag()), { ok: false, reason: "several-questions" });
  });

  it("asking the same question again is refused (no interrogation until he repeats a wording)", () => {
    const t = [nokt("Wie bist du auf deine Zahl gekommen?"), child("weiss nicht")];
    deepEqual(checkNoktReply(parseNoktReply(reply("Wie bist du auf deine Zahl gekommen?", "ask-method")), diag(t)), { ok: false, reason: "repeated-question" });
  });

  it("after the turn bound only a close is accepted", () => {
    const t: NoktTurnText[] = [];
    for (let i = 0; i < NOKT_MAX_CHILD_TURNS; i += 1) t.push(child(`Antwort ${i}`), nokt(`Frage ${i}?`));
    deepEqual(checkNoktReply(parseNoktReply(reply("Was denkst du jetzt?")), diag(t)), { ok: false, reason: "must-close" });
    deepEqual(checkNoktReply(parseNoktReply(reply("Danke fürs Erklären. Probier es oben noch einmal oder öffne den Hinweis.", "close")), diag(t)), { ok: true, exposesAnswer: false });
  });

  it("a garbled voice transcript is just another turn — nothing in the contract scores it", () => {
    deepEqual(checkNoktReply(parseNoktReply(reply("Ich habe dich nicht ganz verstanden. Kannst du es nochmal sagen?")), diag([child("vier tragen rest fünf bananen")])), { ok: true, exposesAnswer: false });
  });

  it("in a reflection after a correct answer, naming the answer is fine", () => {
    deepEqual(checkNoktReply(parseNoktReply(reply("Du hast 4 geschrieben. Wie hast du das herausgefunden?", "ask-method")), { purpose: "reflection", answer: full.answer, transcript: [] }), { ok: true, exposesAnswer: false });
  });
});

describe("Nokt reply — provenance and completion reuse the existing contracts", () => {
  const turnId = "nokt-turn-1";
  const { reqHash } = buildNoktRequest(ctx(["5"]), [child("fünf")]);
  const replyJson = JSON.stringify(reply("Wie bist du auf fünf gekommen?", "ask-method"));
  const binding = noktReceiptBinding({ child: "santiago", turnId, reqHash, replyJson });

  it("a receipt bound to these exact bytes is verified; any other text is a forgery", () => {
    const receipt = { sub: "santiago", sid: "learn", key: turnId, req: reqHash, res: sha256Hex(replyJson), iat: 1 };
    equal(receiptOrigin(receipt, binding), "verified");
    throws(() => receiptOrigin({ ...receipt, res: sha256Hex(replyJson.replace("fünf", "vier")) }, binding));
    throws(() => receiptOrigin({ ...receipt, sub: "isabel" }, binding));
    equal(receiptOrigin(null, binding), "missing");
  });

  const dispatch: TutorDispatch = { turnId, child: "santiago", missionId: "MISSION-ISLAND-GARDEN", visit: "v8", step: "G2-PACK", part: "full", taskVersion: 1, sessionId: "s1", revision: 7, purpose: "diagnostic", entry: "manual", at: "2026-10-23T10:00:00Z", status: "pending" };
  const claim = (status: string, next: string, support = { kind: "clarification", answerExposed: false }) => ({ v: 1, turnId, child: "santiago", missionId: "MISSION-ISLAND-GARDEN", visit: "v8", step: "G2-PACK", part: "full", taskVersion: 1, sessionId: "s1", revision: 7, status, evidence: { attempts: [1], transcriptTurns: 2 }, support, next });
  const base = { child: "santiago", nowIso: "2026-10-23T10:05:00Z", dispatch, currentRevision: 7 };

  it("prose alone completes nothing: a reply without an outcome carries no result", () => {
    const r = parseNoktReply(reply("Super, jetzt hast du es verstanden!", "encourage"));
    equal(r?.outcome, null);
  });

  it("an outcome inside a reply is checked by validateTutorOutcome — unverified origin refused", () => {
    const r = parseNoktReply(reply("Probier es oben nochmal.", "close", claim("understood_with_support", "retry")))!;
    deepEqual(validateTutorOutcome(r.outcome, { ...base, origin: "missing", question: { status: "open", attemptNos: [1], helped: false, answerExposed: false } }), { ok: false, reason: "origin-unverified" });
    equal(validateTutorOutcome(r.outcome, { ...base, origin: "verified", question: { status: "open", attemptNos: [1], helped: false, answerExposed: false } }).ok, true);
  });

  it("after teaching exposed the answer, `understood` is refused as false independence", () => {
    const r = parseNoktReply(reply("Probier es oben nochmal.", "close", claim("understood", "retry", { kind: "none", answerExposed: false })))!;
    deepEqual(validateTutorOutcome(r.outcome, { ...base, origin: "verified", question: { status: "open", attemptNos: [1], helped: true, answerExposed: true } }), { ok: false, reason: "false-independent" });
  });

  it("a diagnostic talk can never mark the open question answered", () => {
    const r = parseNoktReply(reply("Weiter!", "close", claim("understood_with_support", "advance")))!;
    deepEqual(validateTutorOutcome(r.outcome, { ...base, origin: "verified", question: { status: "open", attemptNos: [1], helped: false, answerExposed: false } }), { ok: false, reason: "transition-not-allowed" });
  });
});
