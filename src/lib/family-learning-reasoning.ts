// ---------------------------------------------------------------------------
// Reasoning conversation after a quotient item (Visit 5, content version 4;
// family-assistant DESIGN §7.6 "Visit 5 — the harbor", feedback group F4).
//
// A reviewed, deterministic probe policy — no model decides anything here.
// Nabu asks how the child solved the item; the child answers by speech
// (push-to-talk, confirmed transcript) or typing; each child turn is
// classified against the ITEM's numbers and the next reviewed probe is chosen:
//   vague (no numbers)              → "Welche Zahlen hast du … gerechnet?"
//   numbers without meaning         → "Was bedeuten die a und die b …?"
//   consistent, remainder not told  → "Wie hast du herausgefunden, was übrig bleibt?"
//   a specific contradiction        → "Du sagst {claim}. Wie viele Boote waren bei dir voll?"
//   consistent and complete         → accept
// Probing is bounded (`maxProbes`); afterwards the child is offered the
// counters or direct teaching and the method is recorded as not yet
// established. Any strategy whose numbers are consistent with the item is
// valid: 6 × 6 = 36 and 38 − 36 = 2, 6 × 7 = 42 > 38, repeated addition,
// 38 : 6 = 6 R 2, counting — multiplication is never presumed false.
// Neutral elicitation (a probe) and answer-revealing support (the counters,
// the teaching text) are kept apart in the recorded method; a spoken turn is
// never spelling evidence (the transcript's modality travels with it).
// ---------------------------------------------------------------------------

import type { MathItem, ReasoningDef, ScoredMathItemId } from "./family-learning-content.ts";

export type ReasoningMethod = "explained-independently" | "explained-after-probing" | "explained-with-support" | "not-yet-established" | "unscored";

export type ReasoningTurn = {
  role: "nabu" | "child";
  text: string;
  /** Child turns: how the text was entered. */
  modality?: "typed" | "spoken";
  /** Nabu turns: what the line is. */
  kind?: "prompt" | "probe" | "accept" | "scaffold" | "teach" | "close";
  /** Nabu probes: the reviewed probe id. Child turns: the classification. */
  probe?: string;
  classification?: ExplanationClass;
  at: string;
};

export type ReasoningState = {
  itemId: ScoredMathItemId;
  turns: ReasoningTurn[];
  probesUsed: number;
  status: "open" | "scaffold" | "done";
  method: ReasoningMethod | null;
  /** The strategy named by the child's consistent explanation, when one was recognised. */
  strategy: "multiplication" | "division" | "repeated-addition" | "counting" | "subtraction" | null;
  /** Answer-revealing support given inside the conversation (counters offered/used, teaching text shown). */
  support: ("counters" | "teaching")[];
  closedAt: string | null;
};

export type ExplanationClass = {
  kind: "vague" | "numbers-no-meaning" | "consistent" | "partial" | "contradiction";
  numbers: number[];
  operations: ("multiplication" | "addition" | "division" | "subtraction" | "counting")[];
  strategy: ReasoningState["strategy"];
  mentionsRemainder: boolean;
  mentionsNeeded: boolean;
  /** For a contradiction: the child's own claim, quoted back. */
  claim: string | null;
};

const NUMBER_WORDS: Record<string, number> = {
  null: 0, eins: 1, ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12,
  dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreissig: 30, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60,
  sechsunddreissig: 36, achtunddreissig: 38, zweiundvierzig: 42, fünfundzwanzig: 25, sechsundzwanzig: 26,
};

/** Numbers named in the text (digits and German number words), in order. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const token of text.toLowerCase().match(/\d+|[a-zäöüß]+/g) ?? []) {
    if (/^\d+$/.test(token)) out.push(Number(token));
    else if (token in NUMBER_WORDS) out.push(NUMBER_WORDS[token]);
  }
  return out;
}

const OPS: { op: ExplanationClass["operations"][number]; re: RegExp }[] = [
  { op: "multiplication", re: /\bmal\b|malgenommen|multipli|×|\bx\b|\*/i },
  { op: "addition", re: /\bplus\b|dazu|zusammengez|addier|\+|immer\s+\d+\s+(mehr|dazu)|aufaddiert/i },
  { op: "division", re: /geteilt|\bdurch\b|÷|dividiert|aufgeteilt|verteilt|:\s*\d/i },
  { op: "subtraction", re: /minus|weggenommen|abgezogen|abgezählt|weg\b|−|-\s*\d/i },
  { op: "counting", re: /gezählt|gezaehlt|zählen|abgezählt|gelegt|probiert|ausprobiert|nachgezählt/i },
];

const REMAINDER_RE = /übrig|uebrig|\brest\b|bleib|bleibt|blieb|passen nicht|passt nicht|zu viel/i;
const NEEDED_RE = /noch ein|eins mehr|ein boot mehr|mehr boot|insgesamt|zusammen \d|alle kisten|für alle/i;

/** Classify one child explanation against the item it refers to. Deterministic. */
export function classifyExplanation(text: string, item: MathItem): ExplanationClass {
  const numbers = numbersIn(text);
  const operations = OPS.filter((o) => o.re.test(text)).map((o) => o.op);
  const mentionsRemainder = REMAINDER_RE.test(text);
  const mentionsNeeded = NEEDED_RE.test(text);
  const Q = item.quantity;
  const P = item.perGroup ?? item.groups;
  const full = item.answers?.full ?? Math.floor(Q / P);
  const R = item.answers?.remaining ?? Q - full * P;
  const needed = item.answers?.needed ?? full + (R > 0 ? 1 : 0);
  const used = full * P;
  const has = (n: number) => numbers.includes(n);
  const base = { numbers, operations, mentionsRemainder, mentionsNeeded, claim: null as string | null };

  // --- an explicit equation "a mal b = c" / "a mal b ist c" that is false is a specific contradiction
  const eq = text.toLowerCase().match(/(\d+|[a-zäöü]+)\s*(mal|×|x|\*)\s*(\d+|[a-zäöü]+)\s*(?:=|ist|sind|gibt|macht|ergibt)\s*(\d+|[a-zäöü]+)/);
  if (eq) {
    const [a, b, c] = [eq[1], eq[3], eq[4]].map((t) => (/^\d+$/.test(t) ? Number(t) : NUMBER_WORDS[t]));
    if (Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(c) && a * b !== c) return { ...base, kind: "contradiction", strategy: null, claim: `${a} mal ${b} ist ${c}` };
  }
  // --- "X Boote voll" with X ≠ full is a specific contradiction
  const fullClaim = text.toLowerCase().match(/(\d+|[a-zäöü]+)\s+(boote?|karren|gruppen)\s+(sind\s+|waren\s+|wurden\s+)?voll/);
  if (fullClaim) {
    const x = /^\d+$/.test(fullClaim[1]) ? Number(fullClaim[1]) : NUMBER_WORDS[fullClaim[1]];
    if (Number.isInteger(x) && x !== full) return { ...base, kind: "contradiction", strategy: null, claim: `${x} ${fullClaim[2]} voll` };
  }

  if (numbers.length === 0) return { ...base, kind: "vague", strategy: null };

  // --- consistent strategies (any one suffices)
  const multiplication = operations.includes("multiplication") && has(P) && (has(full) || has(needed) || has(used) || has(needed * P) || has(Q));
  const division = operations.includes("division") && has(Q) && (has(P) || has(full));
  const repeatedAddition = operations.includes("addition") && has(P) && (has(used) || has(Q) || numbers.filter((n) => n === P).length >= 2);
  const subtraction = operations.includes("subtraction") && has(Q) && (has(used) || has(R));
  const counting = operations.includes("counting") && (has(P) || has(full));
  const strategy: ReasoningState["strategy"] = multiplication ? "multiplication" : division ? "division" : repeatedAddition ? "repeated-addition" : subtraction ? "subtraction" : counting ? "counting" : null;
  if (strategy) return { ...base, kind: "consistent", strategy };
  // Numbers that fit the item but no operation named: the numbers' meaning is the next question.
  const fits = numbers.filter((n) => [Q, P, full, R, needed, used].includes(n));
  if (fits.length >= 1 && operations.length === 0) return { ...base, kind: "numbers-no-meaning", strategy: null };
  if (fits.length >= 1) return { ...base, kind: "partial", strategy: null };
  // Numbers that do not fit the item at all, with an operation: challenge the specific claim.
  if (operations.length > 0 && numbers.length >= 2) return { ...base, kind: "contradiction", strategy: null, claim: `${numbers[0]} und ${numbers[1]}` };
  return { ...base, kind: "numbers-no-meaning", strategy: null };
}

export function newReasoningState(itemId: ScoredMathItemId, def: ReasoningDef, nowIso: string): ReasoningState {
  return { itemId, turns: [{ role: "nabu", text: def.prompt, kind: "prompt", at: nowIso }], probesUsed: 0, status: "open", method: null, strategy: null, support: [], closedAt: null };
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`));
}

export type ReasoningStep = { state: ReasoningState; nabu: ReasoningTurn; done: boolean };

/**
 * Apply one child turn: classify it, choose the next reviewed line, update the state. Pure.
 * The child's text is kept verbatim with its modality; Nabu's line comes from the reviewed content only.
 */
export function applyReasoningTurn(state: ReasoningState, text: string, modality: "typed" | "spoken", item: MathItem, def: ReasoningDef, nowIso: string): ReasoningStep {
  if (state.status === "done") throw new Error("the reasoning conversation is closed");
  if (state.status === "scaffold") throw new Error("the scaffold is offered: choose counters, teaching or continue first");
  const classification = classifyExplanation(text, item);
  const turns: ReasoningTurn[] = [...state.turns, { role: "child", text, modality, classification, at: nowIso }];
  const probesLeft = def.maxProbes - state.probesUsed;
  const needsRemainder = (item.kind === "remainder" || item.kind === "quotient") && !classification.mentionsRemainder;
  const consistent = classification.kind === "consistent";
  const probe = (id: keyof ReasoningDef["probes"] | "vagueMultiply", textOut: string): ReasoningStep => {
    const nabu: ReasoningTurn = { role: "nabu", text: textOut, kind: "probe", probe: id, at: nowIso };
    return { state: { ...state, turns: [...turns, nabu], probesUsed: state.probesUsed + 1 }, nabu, done: false };
  };
  const close = (method: ReasoningMethod, strategy: ReasoningState["strategy"], textOut: string, kind: "accept" | "scaffold"): ReasoningStep => {
    const nabu: ReasoningTurn = { role: "nabu", text: textOut, kind, at: nowIso };
    const done = kind === "accept";
    // Answer-revealing support inside the conversation (the counters) makes an explanation "with support", never the child's own.
    const honest: ReasoningMethod = done && state.support.length > 0 ? "explained-with-support" : method;
    return { state: { ...state, turns: [...turns, nabu], status: done ? "done" : "scaffold", method: done ? honest : null, strategy, closedAt: done ? nowIso : null }, nabu, done };
  };

  if (consistent && !needsRemainder) {
    return close(state.probesUsed === 0 ? "explained-independently" : "explained-after-probing", classification.strategy, def.accept, "accept");
  }
  if (probesLeft <= 0) {
    // Bounded: no further probing. A consistent strategy without the remainder is accepted as told; otherwise the scaffold is offered.
    if (consistent) return close(state.probesUsed === 0 ? "explained-independently" : "explained-after-probing", classification.strategy, def.acceptPartial, "accept");
    return close("not-yet-established", null, def.scaffold, "scaffold");
  }
  if (consistent && needsRemainder) {
    const remainderProbe = turns.some((t) => t.role === "nabu" && t.probe === "remainder");
    return remainderProbe ? close(state.probesUsed === 0 ? "explained-independently" : "explained-after-probing", classification.strategy, def.acceptPartial, "accept") : probe("remainder", def.probes.remainder);
  }
  switch (classification.kind) {
    case "vague": {
      const askedVague = turns.filter((t) => t.role === "nabu" && (t.probe === "vague" || t.probe === "vagueMultiply")).length;
      if (askedVague > 0) return probe("vagueAgain", def.probes.vagueAgain);
      const multiply = classification.operations.includes("multiplication") && (def.probes as Record<string, string>).vagueMultiply;
      return multiply ? probe("vagueMultiply", (def.probes as Record<string, string>).vagueMultiply) : probe("vague", def.probes.vague);
    }
    case "numbers-no-meaning": {
      const [a, b] = classification.numbers;
      return probe("numbersNoMeaning", fill(def.probes.numbersNoMeaning, { a: a ?? "?", b: b ?? a ?? "?" }));
    }
    case "contradiction":
      return probe("contradiction", fill(def.probes.contradiction, { claim: classification.claim ?? text.slice(0, 60) }));
    case "partial":
    default:
      return probe("remainder", def.probes.remainder);
  }
}

/** The child's choice at the scaffold: the counters (representation), the teaching text, or moving on without a method. */
export function applyReasoningChoice(state: ReasoningState, choice: "counters" | "teach" | "continue", def: ReasoningDef, nowIso: string): ReasoningStep {
  if (state.status !== "scaffold") throw new Error("no scaffold is offered");
  const support = [...state.support];
  let text = "";
  let kind: ReasoningTurn["kind"] = "close";
  if (choice === "counters") {
    support.push("counters");
    text = "Gut — leg die Kisten in die Boote. Danach erzählst du mir, was du siehst.";
    kind = "scaffold";
  } else if (choice === "teach") {
    support.push("teaching");
    text = def.teach;
    kind = "teach";
  } else text = "In Ordnung — wir schauen deinen Weg ein andermal an.";
  const nabu: ReasoningTurn = { role: "nabu", text, kind, at: nowIso };
  const done = choice !== "counters";
  return {
    state: { ...state, turns: [...state.turns, nabu], status: done ? "done" : "open", method: done ? (choice === "teach" ? "explained-with-support" : "not-yet-established") : null, support, closedAt: done ? nowIso : null },
    nabu,
    done,
  };
}

/** After the counters were used: one more child turn is allowed; a consistent one is explained WITH support. */
export function reopenAfterCounters(state: ReasoningState): ReasoningState {
  return { ...state, status: "open", probesUsed: Math.max(0, state.probesUsed - 1) };
}

/** Child-facing label for a method (from the reviewed content; the id when the content lacks it). */
export function methodLabel(def: ReasoningDef, method: ReasoningMethod | null): string {
  if (!method) return "offen";
  return def.methodLabels[method] ?? method;
}

/** The child's own words (all child turns), for the page and the free-text review. */
export function childExplanationText(state: ReasoningState): string {
  return state.turns.filter((t) => t.role === "child").map((t) => t.text).join(" ");
}
