// ---------------------------------------------------------------------------
// Nokt — German tutor prompt and conversation contract (content v6, N7-03/N7-05/N7-06).
//
// Provider-agnostic and offline: this module builds what a future tutor backend
// would receive and checks what it returns. It selects no backend, calls no
// model, imports no memory and activates nothing — Nokt's conversation stays
// `unavailable` outside the isolated fictional stub (family-learning-nokt.ts).
//
//  - Context: only what Santiago can see on the task (facts, the question, his
//    own attempts, hints already shown). NEVER the answer key, the worked
//    teaching, unrevealed hints or hint-check answers.
//  - Reply: a strict JSON object — one short German line to say, its intent,
//    and optionally the structured result that `validateTutorOutcome`
//    (family-learning-tutor-outcome.ts) checks. Prose never completes a task.
//  - Phases are the APP's, never the model's: after his first answer (kept as
//    the original evidence) Nokt may ask at most two neutral clarifications —
//    that is assessment; then guided teaching. The model's `intent` label is
//    checked against the phase and never authorizes anything by itself. The
//    answer may be stated only where the app has already recorded answer
//    exposure (`disclosureAllowed`, e.g. «Lösung zeigen» in the hint ladder).
//    Teaching is support: an answer after it is never independent, and the
//    reviewed fresh problem (G7) stays the separate evidence of application.
//  - Guards (deterministic, app-side, with the answer the server knows but the
//    model never received): phase/intent, a CONSERVATIVE disclosure heuristic
//    (number + unit, digits or German words — a bound, not semantic
//    understanding; see `disclosesAnswer`), at most one question, no repeated
//    question, a hard turn bound that ends in a close.
//  - Provenance: the reply's exact bytes and the request hash are what the
//    signed `fcr1` receipt binds (`receiptOrigin` in family-learning-trust.ts,
//    sid "learn"); only a verified reply is Nokt's line.
//
// The system prompt is a DRAFT for the N7-05 review; the version string is
// part of the request hash so a changed prompt is a different request.
// ---------------------------------------------------------------------------

import { sha256Hex } from "./family-learning-hash.ts";
import type { MissionPart, MissionSolve } from "./family-learning-mission-spec.ts";
import { TUTOR_NEXT, TUTOR_OUTCOME_STATUSES, type TutorDispatch, type TutorNext, type TutorOutcomeClaim, type TutorOutcomeStatus } from "./family-learning-tutor-outcome.ts";

export const NOKT_PROMPT_VERSION = "nokt-de-2026-10-23-draft3";

/** Draft German instructions for the tutor model (N7-05). Reviewed wording is pending; nothing here is live. */
export const NOKT_SYSTEM_PROMPT_DE = [
  "Du bist Nokt, ein freundlicher Lernbegleiter für ein Kind (8–9 Jahre) im Inselgarten-Abenteuer. Du sprichst Deutsch, kurz und einfach.",
  "Ziel: herausfinden, was das Kind denkt, dass die Aufgabe fragt, und wie es auf seine Zahl gekommen ist. Du bewertest nicht und lobst nichts, was nicht stimmt.",
  "So gehst du vor:",
  "1. Stelle kurze, offene Fragen — höchstens eine Frage pro Antwort, höchstens zwei kurze Sätze.",
  "2. Akzeptiere jeden gültigen Rechenweg (zählen, malen, plus rechnen, mal rechnen, teilen). Beschreibt das Kind einen gültigen Weg, sag zuerst in einem kurzen Satz, was an seinem Weg passt — ohne zu sagen, ob sein Ergebnis stimmt, und ohne zu behaupten, warum etwas nicht passt —, dann frag gezielt und offen nach genau der Stelle, an der es hakt.",
  "3. Unterscheide Raten, Missverstehen der Frage und Rechenfehler nur aus dem, was das Kind sagt oder getan hat. Wenn du es nicht weisst, frag nach.",
  "4. Die App sagt dir die Phase (context.phase). Phase \"nachfragen\": höchstens zwei neutrale Fragen, die nichts vorsagen (intent clarify oder ask-method); du erklärst noch nichts. Phase \"erklaeren\": führe Schritt für Schritt mit kleinen Fragen (intent teach); das Ergebnis der offenen Frage nennst du nur, wenn context.resultAllowed true ist — sonst nie, auch nicht als Bestätigung.",
  "5. Frag nie dieselbe Frage nochmal, und frag nicht so lange, bis das Kind einen bestimmten Satz wiederholt. Wenn es nicht weitergeht, beende freundlich (intent \"close\").",
  "6. Was das Kind sagt, ist eine Abschrift seiner Sprache und kann Hörfehler enthalten. Werte einen merkwürdigen Satz nicht als Denkfehler, sondern frag nach.",
  "7. Erzähle nichts über dich, frag nicht nach persönlichen Dingen und bleib bei der Aufgabe.",
  "8. Fragt das Kind direkt, ob etwas stimmt, sag ehrlich, dass ihr es zusammen prüft; bestätige oder verneine kein Ergebnis der offenen Frage.",
  "9. Eine Erklärung ist Hilfe: Danach ist eine richtige Antwort nicht selbständig. Ein Ergebnis mit status \"understood\" gibt es nach Hilfe nie.",
  "Antworte nur mit JSON: {\"v\":1,\"say\":\"…\",\"intent\":\"clarify|ask-method|teach|encourage|close\",\"outcome\":null}.",
  "Ein Ergebnis gibst du nur an, wenn die Belege aus dem Gespräch dafür reichen; sonst bleibt outcome null. Form: \"outcome\":{\"status\":\"understood|understood_with_support|needs_practice|not_established\",\"support\":\"none|clarification|teaching\",\"next\":\"retry|hint|teach|fresh-problem|pause|advance\"}. support ist die Hilfe in diesem Gespräch (Nachfragen = clarification, Erklären = teaching). Die App prüft das Ergebnis und ordnet es zu; es ist eine Einschätzung, keine Note.",
].join("\n");

export const NOKT_INTENTS = ["clarify", "ask-method", "teach", "encourage", "close"] as const;
export type NoktIntent = (typeof NOKT_INTENTS)[number];
export const NOKT_SAY_MAX_CHARS = 220;
/** Child turns per dispatch; after this the tutor must close (N7-05: never an endless interrogation). */
export const NOKT_MAX_CHILD_TURNS = 6;
/** Neutral clarifications (assessment) before the app moves to guided teaching. */
export const NOKT_MAX_CLARIFICATIONS = 2;

export type NoktPhase = "nachfragen" | "erklaeren";

export type NoktTaskContext = {
  step: string;
  part: string;
  purpose: "diagnostic" | "reflection";
  /** The app's phase for this turn (not the model's choice). */
  phase: NoktPhase;
  /** True only where the app has already recorded answer exposure for this question. */
  resultAllowed: boolean;
  facts: string[];
  question: string;
  unit: string;
  /** His own submitted values for this question, in order. */
  attempts: string[];
  /** Hint texts he has already seen (child-visible). */
  hintsShown: string[];
};

/** A transcript line; Nokt lines carry the intent that was accepted for them. */
export type NoktTurnText = { role: "child" | "nokt"; text: string; via: "voice" | "typed"; intent?: NoktIntent };

/** The app builds the context from the reviewed content and his own record — only what is on his screen. */
export function noktTaskContext(input: { step: string; solve: MissionSolve; part: MissionPart; purpose: NoktTaskContext["purpose"]; attempts: string[]; hintIdsShown: string[]; phase: NoktPhase; resultAllowed: boolean }): NoktTaskContext {
  return {
    step: input.step,
    part: input.part.id,
    purpose: input.purpose,
    phase: input.phase,
    resultAllowed: input.resultAllowed,
    facts: [...input.solve.facts],
    question: input.part.question,
    unit: input.part.unit,
    attempts: input.attempts.map(String),
    hintsShown: input.part.hints.filter((h) => input.hintIdsShown.includes(h.id)).map((h) => h.text),
  };
}

export type NoktRequest = { promptVersion: string; system: string; context: NoktTaskContext; transcript: NoktTurnText[] };

export function buildNoktRequest(context: NoktTaskContext, transcript: NoktTurnText[]): { request: NoktRequest; reqHash: string } {
  const request: NoktRequest = { promptVersion: NOKT_PROMPT_VERSION, system: NOKT_SYSTEM_PROMPT_DE, context, transcript: transcript.map((t) => ({ role: t.role, text: t.text, via: t.via, ...(t.intent ? { intent: t.intent } : {}) })) };
  // Key order is fixed by construction above, so the serialization (and the receipt's `req`) is deterministic.
  return { request, reqHash: sha256Hex(JSON.stringify(request)) };
}

/**
 * The model's judgement only. Everything that BINDS a result (turn, child, mission, visit, step, question, version,
 * session, revision, evidence attempts) comes from the app's own dispatch record — the model never received those
 * fields, so it cannot be asked to echo them (round-12 correction of the round-9 contract).
 */
export type NoktModelOutcome = { status: TutorOutcomeStatus; support: "none" | "clarification" | "teaching"; next: TutorNext };
export type NoktReply = { v: 1; say: string; intent: NoktIntent; outcome: NoktModelOutcome | null };

export function parseNoktModelOutcome(raw: unknown): NoktModelOutcome | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== 3 || !["status", "support", "next"].every((k) => keys.includes(k))) return null;
  if (!(TUTOR_OUTCOME_STATUSES as readonly unknown[]).includes(r.status)) return null;
  if (r.support !== "none" && r.support !== "clarification" && r.support !== "teaching") return null;
  if (!(TUTOR_NEXT as readonly unknown[]).includes(r.next)) return null;
  return { status: r.status as TutorOutcomeStatus, support: r.support, next: r.next as TutorNext };
}

/** The full N7-06 claim, bound by the APP from its dispatch and its own attempt record; `validateTutorOutcome` then decides. */
export function noktOutcomeClaim(model: NoktModelOutcome, dispatch: TutorDispatch, input: { attemptNos: number[]; transcriptTurns: number }): TutorOutcomeClaim {
  return {
    v: 1,
    turnId: dispatch.turnId,
    child: dispatch.child,
    missionId: dispatch.missionId,
    visit: dispatch.visit,
    step: dispatch.step,
    part: dispatch.part,
    taskVersion: dispatch.taskVersion,
    sessionId: dispatch.sessionId,
    revision: dispatch.revision,
    status: model.status,
    evidence: { attempts: input.attemptNos, transcriptTurns: input.transcriptTurns },
    // Exposure is the APP's record (merged by the validator), never the model's claim.
    support: { kind: model.support, answerExposed: false },
    next: model.next,
  };
}

/** Strict whole-object schema; a reply that is not exactly this is withheld, never shown as Nokt. */
export function parseNoktReply(raw: unknown): NoktReply | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== 4 || !["v", "say", "intent", "outcome"].every((k) => keys.includes(k))) return null;
  if (r.v !== 1 || typeof r.say !== "string" || !r.say.trim() || r.say.length > NOKT_SAY_MAX_CHARS) return null;
  if (!(NOKT_INTENTS as readonly unknown[]).includes(r.intent)) return null;
  const outcome = r.outcome === null ? null : parseNoktModelOutcome(r.outcome);
  if (r.outcome !== null && !outcome) return null;
  return { v: 1, say: r.say.trim(), intent: r.intent as NoktIntent, outcome };
}

/**
 * The reply TEXT as the model returned it → the strict reply. Tolerates exactly one surrounding Markdown code fence
 * (```json … ```), which chat models add habitually; anything else around the object (prose, two objects) is refused.
 * The receipt binds the raw bytes; only the parse is tolerant.
 */
export function parseNoktReplyText(text: string): NoktReply | null {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(body);
  if (fenced) body = fenced[1].trim();
  try {
    return parseNoktReply(JSON.parse(body));
  } catch {
    return null;
  }
}

const NUMBER_WORDS: Record<number, string[]> = {
  2: ["zwei"], 3: ["drei"], 4: ["vier"], 5: ["fünf", "fuenf"], 6: ["sechs"], 7: ["sieben"], 8: ["acht"], 9: ["neun"], 10: ["zehn"],
  11: ["elf"], 12: ["zwölf", "zwoelf"], 13: ["dreizehn"], 14: ["vierzehn"], 15: ["fünfzehn"], 16: ["sechzehn"], 17: ["siebzehn"], 18: ["achtzehn"], 19: ["neunzehn"], 20: ["zwanzig"],
};

/** Does the line state this number (digits, or the German word for 2–20)? */
export function statesNumber(text: string, n: number): boolean {
  if (new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(text)) return true;
  return (NUMBER_WORDS[n] ?? []).some((w) => new RegExp(`(^|[^a-zäöüß])${w}([^a-zäöüß]|$)`, "i").test(text));
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();

/**
 * The app's phase for the next Nokt line, from the ACCEPTED transcript only: up to two neutral clarifications
 * (assessment), then guided teaching. Once teaching has started it does not go back.
 */
export function noktPhase(transcript: NoktTurnText[]): { phase: NoktPhase; clarifications: number; teachingGiven: boolean } {
  const nokt = transcript.filter((t) => t.role === "nokt");
  const clarifications = nokt.filter((t) => t.intent === "clarify" || t.intent === "ask-method").length;
  const teachingGiven = nokt.some((t) => t.intent === "teach");
  return { phase: teachingGiven || clarifications >= NOKT_MAX_CLARIFICATIONS ? "erklaeren" : "nachfragen", clarifications, teachingGiven };
}

const unitWords = (unit: string) => {
  const u = unit.toLowerCase();
  // «Tragen»/«Trage», «Setzlinge»/«Setzling»: the singular stem catches both.
  return [u, u.replace(/(en|e|n|s)$/, "")].filter((w) => w.length >= 3);
};

/** Does `text` state the number together with the answer's unit («4 Tragen», «vier Tragen»)? */
function statesNumberWithUnit(text: string, n: number, unit: string): boolean {
  const forms = [String(n), ...(NUMBER_WORDS[n] ?? [])];
  return forms.some((f) => unitWords(unit).some((u) => new RegExp(`(^|[^0-9a-zäöüß])${f}\\s+(volle[nr]?\\s+|ganze[nr]?\\s+)?${u}`, "i").test(text)));
}

/**
 * CONSERVATIVE disclosure heuristic — a deterministic bound, NOT semantic understanding:
 *  - the answer number never appears in what he can see or said → any mention counts as disclosure;
 *  - the number is also a visible fact (G2: «je 4 Setzlingen» while the answer is 4 Tragen) → only the number with the
 *    answer's unit counts, so discussing his own wrong method («18 minus 4») is not blocked;
 *  - he gave that answer himself (with its unit, or as a short answer) → quoting it back is not disclosure (judging it
 *    is refused separately); a number that is only a term in his calculation does not count.
 * Known limits: paraphrases («so viele wie bei der Zählhilfe»), arithmetic that implies the answer («16 und 2 übrig»)
 * and other units are not detected; the prompt, phases and the parent review remain the other safeguards.
 */
export function disclosesAnswer(say: string, input: { answer: number; unit: string; visibleText: string[]; childSaid: string[] }): boolean {
  if (!statesNumber(say, input.answer)) return false;
  // He said the answer himself only when he gave it AS an answer — the number with its unit, or a short answer
  // («vier», «ich glaube vier») — not when it is a term in his own calculation («18 minus 4»).
  const quotesHim = input.childSaid.some((t) => statesNumberWithUnit(t, input.answer, input.unit) || (normalize(t).split(" ").length <= 3 && statesNumber(t, input.answer)));
  if (quotesHim) return false;
  if (!input.visibleText.some((t) => statesNumber(t, input.answer))) return true;
  return statesNumberWithUnit(say, input.answer, input.unit);
}

/**
 * Does the line JUDGE (confirm or reject) a result, as opposed to using an evaluative word as an ordinary adverb?
 * Conservative bound (round 12, after the live false positive «… Tragen mit genau vier Setzlingen …»):
 *  - an evaluative interjection opening a sentence: «Richtig, …», «Genau!», «Ja, vier …», «Stimmt.», «Super …»;
 *  - a verdict phrase anywhere: «… ist richtig/korrekt/falsch», «das stimmt», «stimmt so», «genau richtig»,
 *    «richtig gerechnet/gezählt/gemacht», «du hast recht»;
 *  - a sentence that STARTS with «Genau …» / «Richtig …» even without punctuation («Genau vier Tragen sind es.»).
 * «genau» in the middle of a sentence as "exactly" («mit genau vier Setzlingen») is not a verdict.
 */
export function judgesAnswer(say: string): boolean {
  const sentences = say.split(/(?<=[.!?])\s+/);
  const opener = /^\s*[«"„]?\s*(richtig|genau|stimmt|korrekt|super|toll|perfekt|prima|bravo|falsch|ja|nein)\b/i;
  if (sentences.some((x) => opener.test(x))) return true;
  return /\b(ist|sind|war|wäre|hast du|hattest du)\s+(ja\s+)?(richtig|korrekt|falsch)\b|\b(das|es|dies|so)\s+stimmt\b|\bstimmt\s+(so|genau|schon)\b|\bgenau\s+richtig\b|\brichtig\s+(gerechnet|gezählt|gemacht|gesagt)\b|\bdu\s+hast\s+(recht|richtig)\b/i.test(say);
}

export type NoktReplyRefusal = "malformed" | "intent-not-in-phase" | "answer-disclosed" | "judges-open-answer" | "several-questions" | "repeated-question" | "must-close";

/**
 * App-side guard on a parsed reply. `answer` is the server's value for the open question — the model never received it.
 * The phase and `disclosureAllowed` come from the app's own record; the reply's `intent` is checked against them and
 * authorizes nothing. A refused reply is withheld (the child sees a reviewed local line).
 */
export function checkNoktReply(
  reply: NoktReply | null,
  ctx: { purpose: NoktTaskContext["purpose"]; answer: number; unit: string; visibleText: string[]; attempts: string[]; transcript: NoktTurnText[]; disclosureAllowed: boolean },
): { ok: true } | { ok: false; reason: NoktReplyRefusal } {
  if (!reply) return { ok: false, reason: "malformed" };
  const childTurns = ctx.transcript.filter((t) => t.role === "child");
  if (childTurns.length >= NOKT_MAX_CHILD_TURNS && reply.intent !== "close") return { ok: false, reason: "must-close" };
  if (ctx.purpose === "diagnostic") {
    const { phase } = noktPhase(ctx.transcript);
    if (phase === "nachfragen" && reply.intent === "teach") return { ok: false, reason: "intent-not-in-phase" };
    if (phase === "erklaeren" && (reply.intent === "clarify" || reply.intent === "ask-method")) return { ok: false, reason: "intent-not-in-phase" };
    const childSaid = [...ctx.attempts, ...childTurns.map((t) => t.text)];
    if (!ctx.disclosureAllowed && disclosesAnswer(reply.say, { answer: ctx.answer, unit: ctx.unit, visibleText: ctx.visibleText, childSaid })) return { ok: false, reason: "answer-disclosed" };
    // Quoting his number back is fine; judging an open answer («richtig», «stimmt») next to the answer number is not.
    if (statesNumber(reply.say, ctx.answer) && judgesAnswer(reply.say)) return { ok: false, reason: "judges-open-answer" };
  }
  if ((reply.say.match(/\?/g) ?? []).length > 1) return { ok: false, reason: "several-questions" };
  const asked = ctx.transcript.filter((t) => t.role === "nokt" && t.text.includes("?")).map((t) => normalize(t.text));
  if (reply.say.includes("?") && asked.includes(normalize(reply.say))) return { ok: false, reason: "repeated-question" };
  return { ok: true };
}

export type NoktOutcomeRefusal = "premature-judgement" | "support-understated";

/**
 * The tutor result must fit what actually happened in the talk (checked BEFORE `validateTutorOutcome`):
 *  - a judgement other than `not_established` needs at least one clarification he has answered, or teaching, first;
 *  - after teaching, the claim must name teaching as its support (it can then never be `understood`).
 */
export function checkNoktOutcome(claim: NoktModelOutcome, transcript: NoktTurnText[]): { ok: true } | { ok: false; reason: NoktOutcomeRefusal } {
  const { teachingGiven } = noktPhase(transcript);
  // Only a clarification HE ANSWERED is evidence; a judgement riding on the first question itself is premature.
  const answered = transcript.filter((t, i) => t.role === "nokt" && (t.intent === "clarify" || t.intent === "ask-method") && transcript.slice(i + 1).some((x) => x.role === "child")).length;
  if (claim.status !== "not_established" && answered === 0 && !teachingGiven) return { ok: false, reason: "premature-judgement" };
  if (teachingGiven && claim.support !== "teaching") return { ok: false, reason: "support-understated" };
  return { ok: true };
}

/** What the signed receipt binds for one reply: the exact reply bytes the child would see/hear and the request hash. */
export function noktReceiptBinding(input: { child: string; turnId: string; reqHash: string; replyJson: string }): { child: string; turnId: string; reqHash: string; text: string } {
  return { child: input.child, turnId: input.turnId, reqHash: input.reqHash, text: input.replyJson };
}
