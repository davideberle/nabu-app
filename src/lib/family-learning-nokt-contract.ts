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
//  - Guards (deterministic, app-side, with the answer the server knows but the
//    model never received): no answer before teaching, at most one question,
//    no repeated question, a bounded number of turns that ends in a close.
//  - Provenance: the reply's exact bytes and the request hash are what the
//    signed `fcr1` receipt binds (`receiptOrigin` in family-learning-trust.ts,
//    sid "learn"); only a verified reply is Nokt's line.
//
// The system prompt is a DRAFT for the N7-05 review; the version string is
// part of the request hash so a changed prompt is a different request.
// ---------------------------------------------------------------------------

import { sha256Hex } from "./family-learning-hash.ts";
import type { MissionPart, MissionSolve } from "./family-learning-mission-spec.ts";
import { parseTutorOutcome, type TutorOutcomeClaim } from "./family-learning-tutor-outcome.ts";

export const NOKT_PROMPT_VERSION = "nokt-de-2026-10-23-draft1";

/** Draft German instructions for the tutor model (N7-05). Reviewed wording is pending; nothing here is live. */
export const NOKT_SYSTEM_PROMPT_DE = [
  "Du bist Nokt, ein freundlicher Lernbegleiter für ein Kind (8–9 Jahre) im Inselgarten-Abenteuer. Du sprichst Deutsch, kurz und einfach.",
  "Ziel: herausfinden, was das Kind denkt, dass die Aufgabe fragt, und wie es auf seine Zahl gekommen ist. Du bewertest nicht und lobst nichts, was nicht stimmt.",
  "So gehst du vor:",
  "1. Stelle kurze, offene Fragen — höchstens eine Frage pro Antwort, höchstens zwei kurze Sätze.",
  "2. Akzeptiere jeden gültigen Rechenweg (zählen, malen, plus rechnen, mal rechnen, teilen).",
  "3. Unterscheide Raten, Missverstehen der Frage und Rechenfehler nur aus dem, was das Kind sagt oder getan hat. Wenn du es nicht weisst, frag nach.",
  "4. Zuerst neutral nachfragen. Erst wenn das nicht hilft, erkläre einen Schritt. Nenne das Ergebnis der offenen Frage nie, bevor du ausdrücklich erklärst (intent \"teach\").",
  "5. Frag nie dieselbe Frage nochmal, und frag nicht so lange, bis das Kind einen bestimmten Satz wiederholt. Wenn es nicht weitergeht, beende freundlich (intent \"close\").",
  "6. Was das Kind sagt, ist eine Abschrift seiner Sprache und kann Hörfehler enthalten. Werte einen merkwürdigen Satz nicht als Denkfehler, sondern frag nach.",
  "7. Erzähle nichts über dich, frag nicht nach persönlichen Dingen und bleib bei der Aufgabe.",
  "Antworte nur mit JSON: {\"v\":1,\"say\":\"…\",\"intent\":\"clarify|ask-method|teach|encourage|close\",\"outcome\":null} — ein Ergebnis (\"outcome\") nur, wenn du dir aus den Belegen sicher bist; sonst null.",
].join("\n");

export const NOKT_INTENTS = ["clarify", "ask-method", "teach", "encourage", "close"] as const;
export type NoktIntent = (typeof NOKT_INTENTS)[number];
export const NOKT_SAY_MAX_CHARS = 220;
/** Child turns per dispatch; after this the tutor must close (N7-05: never an endless interrogation). */
export const NOKT_MAX_CHILD_TURNS = 6;

export type NoktTaskContext = {
  step: string;
  part: string;
  purpose: "diagnostic" | "reflection";
  facts: string[];
  question: string;
  unit: string;
  /** His own submitted values for this question, in order. */
  attempts: string[];
  /** Hint texts he has already seen (child-visible). */
  hintsShown: string[];
};

export type NoktTurnText = { role: "child" | "nokt"; text: string; via: "voice" | "typed" };

/** The app builds the context from the reviewed content and his own record — only what is on his screen. */
export function noktTaskContext(input: { step: string; solve: MissionSolve; part: MissionPart; purpose: NoktTaskContext["purpose"]; attempts: string[]; hintIdsShown: string[] }): NoktTaskContext {
  return {
    step: input.step,
    part: input.part.id,
    purpose: input.purpose,
    facts: [...input.solve.facts],
    question: input.part.question,
    unit: input.part.unit,
    attempts: input.attempts.map(String),
    hintsShown: input.part.hints.filter((h) => input.hintIdsShown.includes(h.id)).map((h) => h.text),
  };
}

export type NoktRequest = { promptVersion: string; system: string; context: NoktTaskContext; transcript: NoktTurnText[] };

export function buildNoktRequest(context: NoktTaskContext, transcript: NoktTurnText[]): { request: NoktRequest; reqHash: string } {
  const request: NoktRequest = { promptVersion: NOKT_PROMPT_VERSION, system: NOKT_SYSTEM_PROMPT_DE, context, transcript: transcript.map((t) => ({ role: t.role, text: t.text, via: t.via })) };
  // Key order is fixed by construction above, so the serialization (and the receipt's `req`) is deterministic.
  return { request, reqHash: sha256Hex(JSON.stringify(request)) };
}

export type NoktReply = { v: 1; say: string; intent: NoktIntent; outcome: TutorOutcomeClaim | null };

/** Strict whole-object schema; a reply that is not exactly this is withheld, never shown as Nokt. */
export function parseNoktReply(raw: unknown): NoktReply | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== 4 || !["v", "say", "intent", "outcome"].every((k) => keys.includes(k))) return null;
  if (r.v !== 1 || typeof r.say !== "string" || !r.say.trim() || r.say.length > NOKT_SAY_MAX_CHARS) return null;
  if (!(NOKT_INTENTS as readonly unknown[]).includes(r.intent)) return null;
  if (r.outcome !== null && !parseTutorOutcome(r.outcome)) return null;
  return { v: 1, say: r.say.trim(), intent: r.intent as NoktIntent, outcome: r.outcome === null ? null : parseTutorOutcome(r.outcome) };
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

export type NoktReplyRefusal = "malformed" | "answer-before-teaching" | "several-questions" | "repeated-question" | "must-close";

/**
 * App-side guard on a parsed reply. `answer` is the server's value for the open question — the model never received it.
 * A refused reply is withheld (the child sees a reviewed local line); an accepted `teach` that states the answer is
 * recorded as answer exposure before it is shown.
 */
export function checkNoktReply(
  reply: NoktReply | null,
  ctx: { purpose: NoktTaskContext["purpose"]; answer: number; transcript: NoktTurnText[] },
): { ok: true; exposesAnswer: boolean } | { ok: false; reason: NoktReplyRefusal } {
  if (!reply) return { ok: false, reason: "malformed" };
  const states = statesNumber(reply.say, ctx.answer);
  if (ctx.purpose === "diagnostic" && states && reply.intent !== "teach") return { ok: false, reason: "answer-before-teaching" };
  if ((reply.say.match(/\?/g) ?? []).length > 1) return { ok: false, reason: "several-questions" };
  const asked = ctx.transcript.filter((t) => t.role === "nokt" && t.text.includes("?")).map((t) => normalize(t.text));
  if (reply.say.includes("?") && asked.includes(normalize(reply.say))) return { ok: false, reason: "repeated-question" };
  const childTurns = ctx.transcript.filter((t) => t.role === "child").length;
  if (childTurns >= NOKT_MAX_CHILD_TURNS && reply.intent !== "close") return { ok: false, reason: "must-close" };
  return { ok: true, exposesAnswer: ctx.purpose === "diagnostic" && states };
}

/** What the signed receipt binds for one reply: the exact reply bytes the child would see/hear and the request hash. */
export function noktReceiptBinding(input: { child: string; turnId: string; reqHash: string; replyJson: string }): { child: string; turnId: string; reqHash: string; text: string } {
  return { child: input.child, turnId: input.turnId, reqHash: input.reqHash, text: input.replyJson };
}
