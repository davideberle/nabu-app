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
  checkNoktOutcome,
  checkNoktReply,
  disclosesAnswer,
  NOKT_MAX_CLARIFICATIONS,
  NOKT_MAX_CHILD_TURNS,
  NOKT_PROMPT_VERSION,
  NOKT_SYSTEM_PROMPT_DE,
  noktPhase,
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

const ctx = (attempts: string[], hintIdsShown: string[] = []) => noktTaskContext({ step: "G2-PACK", solve, part: full, purpose: "diagnostic", attempts, hintIdsShown, phase: "nachfragen", resultAllowed: false });
const reply = (say: string, intent = "clarify", outcome: unknown = null) => ({ v: 1, say, intent, outcome });
const child = (text: string, via: "voice" | "typed" = "voice"): NoktTurnText => ({ role: "child", text, via });
const nokt = (text: string, intent: NoktTurnText["intent"] = "clarify"): NoktTurnText => ({ role: "nokt", text, via: "typed", intent });
const visible = [...solve.facts, full.question];

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

describe("Nokt reply — app-controlled phases and disclosure (G2 «full», answer known only to the app)", () => {
  const diag = (transcript: NoktTurnText[] = [], attempts: string[] = ["5"], disclosureAllowed = false) => ({ purpose: "diagnostic" as const, answer: full.answer, unit: full.unit, visibleText: visible, attempts, transcript, disclosureAllowed });
  const check = (say: string, intent: string, transcript: NoktTurnText[] = [], attempts?: string[], disclosureAllowed?: boolean) => checkNoktReply(parseNoktReply(reply(say, intent)), diag(transcript, attempts, disclosureAllowed));
  const twoClarifications = [child("fünf"), nokt("Was sollst du bei dieser Frage herausfinden?"), child("wie viele Tragen"), nokt("Wie bist du auf fünf gekommen?", "ask-method"), child("geraten")];

  it("a neutral clarification is accepted in the assessment phase", () => {
    deepEqual(check("Was sollst du bei dieser Frage herausfinden?", "clarify", [child("fünf")]), { ok: true });
  });

  it("ADVERSARIAL: the model labelling itself «teach» with the answer is refused — the label authorizes nothing", () => {
    deepEqual(check("Es sind 4 Tragen, weil 4 mal 4 gleich 16 ist.", "teach", [child("fünf")]), { ok: false, reason: "intent-not-in-phase" });
    deepEqual(check("Schau: In jede Trage kommen 4 Setzlinge.", "teach", [child("fünf")]), { ok: false, reason: "intent-not-in-phase" }, "no teaching before the two clarifications, answer or not");
  });

  it("ADVERSARIAL: in the teaching phase the answer stays closed until the app has recorded exposure", () => {
    equal(noktPhase(twoClarifications).phase, "erklaeren");
    deepEqual(check("Mit 4 Tragen geht es auf, 2 bleiben übrig.", "teach", twoClarifications), { ok: false, reason: "answer-disclosed" });
    deepEqual(check("Wie viele Setzlinge sind in 3 vollen Tragen?", "teach", twoClarifications), { ok: true }, "a guided step without the answer");
    deepEqual(check("Mit 4 Tragen geht es auf, 2 bleiben übrig.", "teach", twoClarifications, ["5"], true), { ok: true }, "after the app recorded the exposure («Lösung zeigen»)");
  });

  it("ADVERSARIAL: he says the right number without reasoning — quoting it back is fine, judging it is not", () => {
    const t = [child("vier")];
    deepEqual(check("Du sagst vier Tragen. Wie bist du darauf gekommen?", "ask-method", t), { ok: true });
    deepEqual(check("Richtig, vier Tragen! Wie hast du das gemacht?", "ask-method", t), { ok: false, reason: "judges-open-answer" });
  });

  it("ADVERSARIAL: a wrong method that contains the right digit incidentally is discussable", () => {
    const t = [child("18 minus 4 sind 14")];
    deepEqual(check("Du hast 18 minus 4 gerechnet. Was bedeutet die 4 in der Frage?", "clarify", t, ["14"]), { ok: true }, "the 4 here is the visible group size, not «4 Tragen»");
    deepEqual(check("Es passen 4 Tragen. Was meinst du?", "clarify", t, ["14"]), { ok: false, reason: "answer-disclosed" });
  });

  it("ADVERSARIAL: an ambiguous answer (question misread or miscount?) needs a clarification before any judgement", () => {
    const claimAt = (status: string, support = { kind: "none", answerExposed: false }) => parseNoktReply(reply("x", "close", { v: 1, turnId: "t-12345678", child: "santiago", missionId: "M", visit: "v8", step: "G2-PACK", part: "full", taskVersion: 1, sessionId: "s", revision: 1, status, evidence: { attempts: [1], transcriptTurns: 1 }, support, next: "hint" }))!.outcome!;
    deepEqual(checkNoktOutcome(claimAt("needs_practice"), [child("fünf")]), { ok: false, reason: "premature-judgement" });
    deepEqual(checkNoktOutcome(claimAt("not_established"), [child("fünf")]), { ok: true }, "«not established» is always honest");
    deepEqual(checkNoktOutcome(claimAt("needs_practice"), [child("fünf"), nokt("Was sollst du herausfinden?"), child("alle Setzlinge zählen")]), { ok: true });
    deepEqual(check("Was sollst du bei dieser Frage herausfinden?", "clarify", [child("fünf")]), { ok: true });
  });

  it("ADVERSARIAL: after two clarifications a third is refused; the talk moves on to guided teaching or closes", () => {
    equal(NOKT_MAX_CLARIFICATIONS, 2);
    deepEqual(check("Und was denkst du jetzt?", "clarify", twoClarifications), { ok: false, reason: "intent-not-in-phase" });
    deepEqual(check("Lass uns zusammen schauen: Wie viele Setzlinge passen in eine Trage?", "teach", twoClarifications), { ok: true });
    deepEqual(check("Danke. Probier es oben noch einmal oder öffne den Hinweis.", "close", twoClarifications), { ok: true });
  });

  it("ADVERSARIAL: teaching is support — never independent credit, and the claim must say so", () => {
    const taught = [...twoClarifications, nokt("Wie viele Setzlinge passen in eine Trage?", "teach"), child("vier")];
    const outcome = (status: string, kind: string) => parseNoktReply(reply("x", "close", { v: 1, turnId: "t-12345678", child: "santiago", missionId: "M", visit: "v8", step: "G2-PACK", part: "full", taskVersion: 1, sessionId: "s", revision: 1, status, evidence: { attempts: [1], transcriptTurns: 4 }, support: { kind, answerExposed: false }, next: "retry" }))!.outcome!;
    deepEqual(checkNoktOutcome(outcome("understood", "clarification"), taught), { ok: false, reason: "support-understated" });
    deepEqual(checkNoktOutcome(outcome("understood_with_support", "teaching"), taught), { ok: true });
    // and the existing validator refuses `understood` after teaching even when the claim admits it
    const d: TutorDispatch = { turnId: "t-12345678", child: "santiago", missionId: "M", visit: "v8", step: "G2-PACK", part: "full", taskVersion: 1, sessionId: "s", revision: 1, purpose: "diagnostic", entry: "manual", at: "2026-10-23T10:00:00Z", status: "pending" };
    deepEqual(validateTutorOutcome(outcome("understood", "teaching"), { child: "santiago", origin: "verified", nowIso: "2026-10-23T10:01:00Z", dispatch: d, question: { status: "open", attemptNos: [1], helped: false, answerExposed: false }, currentRevision: 1 }), { ok: false, reason: "false-independent" });
  });

  it("the hard turn bound remains only a backstop: after it, only a close", () => {
    const t: NoktTurnText[] = [];
    for (let i = 0; i < 6; i += 1) t.push(child(`Antwort ${i}`), nokt(`Schritt ${i}?`, "teach"));
    deepEqual(check("Wie geht es weiter?", "teach", t), { ok: false, reason: "must-close" });
    deepEqual(check("Danke fürs Mitdenken. Probier es oben noch einmal.", "close", t), { ok: true });
  });

  it("two questions in one line and a repeated question are refused", () => {
    deepEqual(check("Was fragt die Aufgabe? Und wie hast du gerechnet?", "clarify", [child("fünf")]), { ok: false, reason: "several-questions" });
    deepEqual(check("Wie bist du auf deine Zahl gekommen?", "ask-method", [child("fünf"), nokt("Wie bist du auf deine Zahl gekommen?", "ask-method"), child("weiss nicht")]), { ok: false, reason: "repeated-question" });
  });

  it("a garbled voice transcript is just another turn; a reflection after a correct answer may name it", () => {
    deepEqual(check("Ich habe dich nicht ganz verstanden. Kannst du es nochmal sagen?", "clarify", [child("vier tragen rest fünf bananen")]), { ok: true });
    deepEqual(checkNoktReply(parseNoktReply(reply("Du hast 4 Tragen geschrieben. Wie hast du das herausgefunden?", "ask-method")), { purpose: "reflection", answer: full.answer, unit: full.unit, visibleText: visible, attempts: ["4"], transcript: [], disclosureAllowed: false }), { ok: true });
  });

  it("KNOWN LIMIT (recorded, not hidden): the disclosure check is a heuristic — paraphrased or implied answers pass it", () => {
    equal(disclosesAnswer("In vier volle Tragen passen 16, dann bleiben 2 übrig.", { answer: 4, unit: "Tragen", visibleText: visible, childSaid: [] }), true, "number + unit is caught");
    equal(disclosesAnswer("16 Setzlinge sind voll verpackt, 2 bleiben übrig.", { answer: 4, unit: "Tragen", visibleText: visible, childSaid: [] }), false, "implied by arithmetic — NOT caught; phases, prompt and parent review remain the other safeguards");
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
