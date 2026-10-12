// ---------------------------------------------------------------------------
// Reasoning conversation after a quotient item (Visit 5, content version 4,
// reasoning definition version 5 — the ASSESSMENT RESET of 2026-10-10;
// family-assistant DESIGN §7.6 "Assessment reset", CONTRACT.md "Assessment
// reset (binding)"; feedback group F4).
//
// The division of labour, stated plainly:
//
//  - OBSERVED FACTS (this module records, never judges): the child's exact
//    turns with modality, the support mode and its event log, the number of
//    clarification prompts used, narrow mathematical contradictions (only when
//    the child's stated calculation is unambiguous, e.g. "38 minus 36 ist 9"),
//    retraction markers in a turn, the origin of every reply (verified /
//    missing / malformed / invalid), the bound. The first numerical answer and
//    its correctness live in the math item record and are never touched here.
//
//  - NABU'S ASSESSMENT (the isolated child assistant, verified origin only):
//    per reviewed criterion a level — demonstrated / partial /
//    not-yet-demonstrated / uncertain — with the child passages it rests on
//    and a rationale. Stored as a REVISION with every reply, with the schema
//    version and the turn it followed. The app checks only that passages are
//    verbatim (an ungrounded passage is reported, never used to overrule), marks
//    an assessment STALE when a later child turn retracts or contradicts (a
//    reassessment must follow; if none does, the criteria close as uncertain —
//    never as "wrong"), and notes when a reassessment after a retraction rests
//    only on passages from before it. Citations are grounding, not proof.
//    Nothing here is promoted to a deterministic correct-method, understanding
//    or mastery claim; the summary labels are "Nabus Einschätzung".
//
//  - SUPPORT is a MODE with an event log, not a word detector. The assistant may
//    ask at most `maxClarifications` clarifying questions from the reviewed,
//    answer-free prompt bank (ART klaerung + PROMPT id: the app renders the
//    exact prompt text) while the explanation window stays UNSUPPORTED. Any
//    free-form content-bearing line (ART lehre) switches the mode to SUPPORTED
//    before it is shown and is logged; counters and the teaching text are
//    support events too. Supported success is recorded as such, never as a
//    failure.
//
//  - TRUST: only a reply whose origin the bridge receipt verifies is attributed
//    to Nabu, shown as Nabu's line, spoken, or assessed. A missing, malformed or
//    invalid receipt withholds the text behind a local reviewed line; the origin
//    kind is kept distinct all the way to the report.
//
//  - Bounds and transport: child turns are counted monotonically (maxChildTurns
//    plus one per scaffold choice, each once); the dispatch is compacted from
//    the oldest history only and refused rather than truncated; the reply's
//    exact wire bytes are what the receipt signs.
// ---------------------------------------------------------------------------

import type { MathItem, ReasoningCriterionId, ReasoningDef, ScoredMathItemId } from "./family-learning-content.ts";
import { sha256Hex } from "./family-learning-hash.ts";

/** Summary label of Nabu's assessment plus the support mode (child-facing close and reports). Never a deterministic verdict. */
export type ReasoningMethod = "explained-independently" | "explained-after-probing" | "explained-with-support" | "not-yet-established" | "unscored";
export type AssessmentLevel = "demonstrated" | "partial" | "not-yet-demonstrated" | "uncertain";
export type AssistantKind = "klaerung" | "lehre" | "abschluss";
import type { ReplyOrigin } from "./family-learning-trust.ts";
export type { ReplyOrigin };
export type SupportMode = "unsupported" | "supported";
export type SupportEventKind = "clarification-prompt" | "tutor-content" | "counters" | "teaching";

/** The bridge's hard message limit; the dispatch never exceeds it. */
export const MAX_DISPATCH_CHARS = 4000;
export const MAX_CHILD_TURN_CHARS = 500;
/** A reply longer than the bridge limit is refused explicitly (never sliced). */
export const MAX_REPLY_CHARS = 4000;
/** The reply schema this module parses; stored with every assessment revision. */
export const ASSESSMENT_SCHEMA_VERSION = 5;

// ---------------------------------------------------------------------------
// German numbers (for the narrow contradiction facts only)
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = { null: 0, eins: 1, ein: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const TEENS: Record<string, number> = { zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const TENS: Record<string, number> = { zwanzig: 20, dreissig: 30, dreißig: 30, vierzig: 40, fünfzig: 50, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };

export function germanNumberWord(raw: string): number | null {
  const w = raw.toLowerCase();
  if (w === "hundert" || w === "einhundert") return 100;
  if (w in TEENS) return TEENS[w];
  if (w in TENS) return TENS[w];
  if (w in UNITS && w !== "ein") return UNITS[w];
  const m = w.match(/^([a-zäöü]+)und([a-zäöü]+)$/);
  if (m && m[1] in UNITS && m[2] in TENS) return UNITS[m[1]] + TENS[m[2]];
  return null;
}

export function normaliseNumbers(text: string): string {
  return text
    .toLowerCase()
    .replace(/[×·]/g, " mal ")
    .replace(/÷/g, " durch ")
    .replace(/−/g, " minus ")
    .replace(/[a-zäöüß]+/g, (word) => {
      const n = germanNumberWord(word);
      return n === null ? word : String(n);
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function numbersIn(text: string): number[] {
  return (normaliseNumbers(text).match(/\d+/g) ?? []).map(Number);
}

// ---------------------------------------------------------------------------
// Observed facts: unambiguous stated calculations and retraction markers
// ---------------------------------------------------------------------------

export type NumericClaim = {
  kind: "product" | "sum" | "difference" | "quotient";
  text: string;
  operands: number[];
  result: number;
  arithmetic: boolean;
  index: number;
  end: number;
};

// The NARROW ASSERTION CONTRACT (repair rounds 5–6, R4-03 / R5-03): an observed arithmetic fact exists only for a sentence that
// is, IN FULL, a plain affirmative statement whose calculation is written with whole-number TOKENS. The recogniser works on the
// whole input token by token — no sentence-internal substring mining, no regex backtracking into digits: a token is an integer
// only if it is EXACTLY digits ("36"); "+36", "36,0", "36.0", "0.5", "1/2", "abc6", "−36" are not integers and the sentence yields
// NOTHING. A sentence containing a quotation mark, a question mark, a negation, a hypothetical, reported speech or meta-talk
// yields nothing either. Sentences are split only at a terminal mark FOLLOWED BY WHITESPACE or the end of the input, so decimals
// and quoted spans are never cut. Whatever is not recognised stays uncertain, model-attributed prose: the semantic tutor still
// reads it; the child is never asked for formal notation.
const RESULT_WORDS = new Set(["ist", "sind", "gibt", "macht", "ergibt", "wird", "war", "waren", "gleich", "="]);
const OP_TOKENS: Record<string, NumericClaim["kind"]> = { mal: "product", x: "product", "*": "product", plus: "sum", "+": "sum", minus: "difference", "-": "difference", durch: "quotient", ":": "quotient" };
const INT_RE = /^\d+$/;
/** A sentence that is not a plain affirmative assertion: negated, questioned, quoted, hypothetical, reported or meta. No claim is read from it. */
const NON_ASSERTION_RE = /(?:^|[^a-zäöüß])(nicht|kein|keine|falsch\w*|stimmt|ob|dass|angenommen|wäre|hätte|behauptung|behaupte\w*|prüfe\w*|frage|fragst|warum|weshalb|wieso|wenn|vielleicht|glaube|glaubst|meinst|sagt|sagte|steht|zettel|internet|beispiel|aussage)(?![a-zäöüß])|[?"„“”»«'`]/;
/** Split the whole normalised input into sentences at a terminal mark followed by whitespace or the end (never inside "36,0" or "0.5"). */
function sentencesOf(norm: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let start = 0;
  for (let i = 0; i < norm.length; i += 1) {
    const ch = norm[i];
    if ((ch === "." || ch === "!" || ch === "?") && (i + 1 >= norm.length || /\s/.test(norm[i + 1]))) {
      const text = norm.slice(start, i + 1);
      if (text.trim()) out.push({ text, start });
      start = i + 1;
    }
  }
  const tail = norm.slice(start);
  if (tail.trim()) out.push({ text: tail, start });
  return out;
}
/** Tokens of a sentence with their offsets; trailing sentence punctuation is detached from a token ("36." → "36"), nothing else is altered. */
function tokensOf(sentence: string, base: number): { tok: string; start: number; end: number }[] {
  const out: { tok: string; start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    let tok = m[0];
    let end = m.index + tok.length;
    const trimmed = tok.replace(/[.,;:!?]+$/, "");
    if (trimmed !== tok && trimmed.length > 0) { end -= tok.length - trimmed.length; tok = trimmed; }
    out.push({ tok, start: base + m.index, end: base + end });
  }
  return out;
}

/** Unambiguous stated calculations in ONE child text: whole-number tokens, one operation chain, a result connector, a whole-number result. Pure. */
export function parseClaims(text: string): NumericClaim[] {
  const s = normaliseNumbers(text);
  const claims: NumericClaim[] = [];
  for (const sentence of sentencesOf(s)) {
    if (NON_ASSERTION_RE.test(sentence.text)) continue; // not an affirmative assertion: nothing is read from it
    const toks = tokensOf(sentence.text, sentence.start);
    for (let i = 0; i < toks.length; i += 1) {
      if (!INT_RE.test(toks[i].tok)) continue;
      // a number right after an operator or sign token is signed or a continuation, not a plain start ("− 6 mal 6")
      if (i > 0 && (OP_TOKENS[toks[i - 1].tok] !== undefined || /^[+\-−]$/.test(toks[i - 1].tok))) continue;
      // operand chain: INT (OP INT)+ with ONE operation kind ("geteilt durch" counts as one operator)
      const operands = [Number(toks[i].tok)];
      let kind: NumericClaim["kind"] | null = null;
      let j = i + 1;
      for (;;) {
        let opTok = j < toks.length ? toks[j].tok : "";
        let width = 1;
        if (opTok === "geteilt" && j + 1 < toks.length && toks[j + 1].tok === "durch") { opTok = "durch"; width = 2; }
        if (OP_TOKENS[opTok] === undefined || j + width >= toks.length || !INT_RE.test(toks[j + width].tok)) break;
        const k = OP_TOKENS[opTok];
        if (kind !== null && k !== kind) break;
        kind = k;
        operands.push(Number(toks[j + width].tok));
        j += width + 1;
      }
      if (kind === null) continue;
      if (kind !== "sum" && operands.length !== 2) continue;
      // connector: [das] RESULT_WORD, then at most two filler words (not a number, not a negation), then INT
      if (j < toks.length && toks[j].tok === "das") j += 1;
      if (j >= toks.length || !RESULT_WORDS.has(toks[j].tok)) continue;
      j += 1;
      let fillers = 0;
      while (j < toks.length && !INT_RE.test(toks[j].tok) && fillers < 2) {
        // a sign, an operator word, a negation or anything carrying a digit ends the assertion — no claim
        if (/^(nicht|kein\w*|falsch\w*|-|−|\+)$/.test(toks[j].tok) || OP_TOKENS[toks[j].tok] !== undefined || /\d/.test(toks[j].tok)) break;
        fillers += 1;
        j += 1;
      }
      if (j < toks.length && (OP_TOKENS[toks[j].tok] !== undefined || /^[+\-−]$/.test(toks[j].tok))) continue;
      if (j >= toks.length || !INT_RE.test(toks[j].tok)) continue;
      const result = Number(toks[j].tok);
      let end = toks[j].end;
      let rest: number | null = null;
      let last = j;
      if (kind === "quotient" && j + 2 < toks.length && toks[j + 1].tok === "rest" && INT_RE.test(toks[j + 2].tok)) { rest = Number(toks[j + 2].tok); end = toks[j + 2].end; last = j + 2; }
      // the assertion must END here: a result followed by another operator or sign ("99 minus 63") is not a whole calculation
      if (last + 1 < toks.length && (OP_TOKENS[toks[last + 1].tok] !== undefined || /^[+\-−]$/.test(toks[last + 1].tok))) continue;
      const arithmetic = kind === "product" ? result === operands[0] * operands[1] : kind === "sum" ? result === operands.reduce((x, y) => x + y, 0) : kind === "difference" ? result === operands[0] - operands[1] : result === Math.floor(operands[0] / operands[1]) && (rest === null || rest === operands[0] - Math.floor(operands[0] / operands[1]) * operands[1]);
      const word = kind === "product" ? "mal" : kind === "sum" ? "plus" : kind === "difference" ? "minus" : "durch";
      claims.push({ kind, text: `${operands.join(` ${word} `)} ist ${result}${rest !== null ? ` Rest ${rest}` : ""}`, operands, result, arithmetic, index: toks[i].start, end });
      i = j;
    }
  }
  return claims.sort((x, y) => x.index - y.index);
}
/** Reviewed first-person correction phrases: a false stated calculation followed by one of these and the true value is corrected in place. */
const SELF_CORRECTION_RE = /\b(ich meine|meine ich|ich wollte sagen|wollte ich sagen|versprochen|vertippt|richtig ist|also doch|korrigiere|nein|nicht)\b(?:\s+\S+){0,4}?\s*(\d+)\b/g;
/** Retraction / "not mine" markers — an observed fact that requires reassessment; never a judgement. */
const RETRACTION_RE = /(?:^|[^a-zäöüß])(widerruf\w*|streich\w*|vergiss\w*|zurück\w*|gilt nicht|nicht mehr|entfallen|stimmt nicht|war falsch|ist falsch|nicht erklären|weiss nicht mehr|weiß nicht mehr|doch nicht)(?![a-zäöüß])/;
/** "Not mine / hypothetical" markers: the content of THIS turn is disowned, copied or hypothetical — passages grounded in it read as uncertain. Observed fact, never a judgement. */
/** EXPLICIT disowning only (R5-04): the child says the content is not theirs, copied, told, hypothetical or unknown to them. A relative's name alone, "gar nicht", or a negated verb is NOT disowning — that is for the semantic assessment. */
const DISOWN_RE = /(?:^|[^a-zäöüß])(lehne\s+\w+\s+ab|lehne ab|war nicht ich|nicht von mir|abgeschrieben|vom zettel|auf dem zettel|zettel steht|im internet|hat mir gesagt|hat (?:meine?|mein|der|die|ein|eine) \w+ (?:gerechnet|gemacht|gesagt|vorgesagt)|kenne (?:ihn|es|den|sie|den weg)? ?(?:gar )?nicht|angenommen|das wäre|wäre eine)(?![a-zäöüß])/;

export type ChildScreen = {
  /** Every unambiguous stated calculation across the turns, with its turn index. */
  claims: (NumericClaim & { turn: number })[];
  /** False stated calculations not corrected later (a later true restatement of the same kind, or a reviewed in-turn correction). OBSERVED FACTS, reported narrowly. */
  contradictions: string[];
  /** Turn indices that carry a retraction marker (earlier content withdrawn). */
  retractionTurns: number[];
  /** Turn indices whose own content is disowned, copied or hypothetical. */
  disownTurns: number[];
  /** The LAST turn retracts or disowns. */
  retractionInLastTurn: boolean;
  reasons: string[];
};

/** Observed facts over ALL child turns. Never a judgement of the method. Pure. */
export function screenChildTexts(childTexts: readonly string[]): ChildScreen {
  const perTurn = childTexts.map((t, turn) => ({ turn, norm: normaliseNumbers(t), claims: parseClaims(t) }));
  const claims = perTurn.flatMap((p) => p.claims.map((c) => ({ ...c, turn: p.turn })));
  const trueValue = (c: NumericClaim) => (c.kind === "product" ? c.operands[0] * c.operands[1] : c.kind === "difference" ? c.operands[0] - c.operands[1] : c.kind === "sum" ? c.operands.reduce((x, y) => x + y, 0) : Math.floor(c.operands[0] / c.operands[1]));
  const corrected = (c: NumericClaim & { turn: number }) => {
    if (claims.some((d) => d.turn > c.turn && d.kind === c.kind && d.operands.join(",") === c.operands.join(",") && d.arithmetic)) return true;
    const tail = perTurn[c.turn].norm.slice(c.end);
    const re = new RegExp(SELF_CORRECTION_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(tail)) !== null) if (Number(m[2]) === trueValue(c)) return true;
    return false;
  };
  const contradictions = claims.filter((c) => !c.arithmetic && !corrected(c)).map((c) => c.text);
  const retractionTurns = perTurn.filter((p) => RETRACTION_RE.test(p.norm)).map((p) => p.turn);
  const disownTurns = perTurn.filter((p) => DISOWN_RE.test(p.norm)).map((p) => p.turn);
  const retractionInLastTurn = perTurn.length > 0 && (retractionTurns.includes(perTurn.length - 1) || disownTurns.includes(perTurn.length - 1));
  const reasons: string[] = [];
  for (const c of contradictions) reasons.push(`Ausdrücklich genannte Rechnung stimmt nicht und wurde nicht korrigiert: „${c}“`);
  if (retractionInLastTurn) reasons.push("Die letzte Antwort nimmt etwas zurück oder sagt, der Weg sei nicht vom Kind — neu einschätzen");
  return { claims, contradictions, retractionTurns, disownTurns, retractionInLastTurn, reasons };
}

// ---------------------------------------------------------------------------
// Nabu's reply: strict whole-response schema with the per-criterion assessment
// ---------------------------------------------------------------------------

export type CriterionAssessment = { level: AssessmentLevel; passages: string[]; rationale: string; /** The assistant's level was downgraded to uncertain because a positive level came without a passage or a rationale (R4-05). */ downgraded?: { from: AssessmentLevel; reason: string } };
export type AssistantReply = {
  answer: string;
  kind: AssistantKind;
  promptId: string | null;
  criteria: Record<ReasoningCriterionId, CriterionAssessment>;
  /** The child's explicitly false calculation the assistant names, or null. */
  contradiction: string | null;
};
export type ParsedReply = { ok: true; reply: AssistantReply } | { ok: false; reason: string };

const REPLY_KEYS = ["ANTWORT", "ART", "PROMPT", "RECHENWEG", "MENGEN", "BEDEUTUNG", "WIDERSPRUCH"] as const;
const CRITERION_KEY: Record<ReasoningCriterionId, (typeof REPLY_KEYS)[number]> = { strategy: "RECHENWEG", quantities: "MENGEN", meaning: "BEDEUTUNG" };
const LEVELS: Record<string, AssessmentLevel> = { gezeigt: "demonstrated", teilweise: "partial", "noch-nicht": "not-yet-demonstrated", nochnicht: "not-yet-demonstrated", unsicher: "uncertain" };

function parseCriterion(raw: string): CriterionAssessment | null {
  const m = raw.match(/^([a-zäöü-]+)\s*((?:«[^«»]{1,200}»\s*;?\s*)*)(?:\|\s*(.*))?$/i);
  if (!m) return null;
  const level = LEVELS[m[1].toLowerCase()];
  if (!level) return null;
  const passages = [...m[2].matchAll(/«([^«»]{1,200})»/g)].map((p) => p[1].trim()).filter(Boolean);
  const rationale = (m[3] ?? "").trim();
  if (rationale.length > 240) return null;
  // a positive judgment without justification is not refused (the reply stays useful) but reads as uncertain
  if ((level === "demonstrated" || level === "partial") && (passages.length === 0 || !rationale)) {
    return { level: "uncertain", passages, rationale: rationale || "", downgraded: { from: level, reason: passages.length === 0 && !rationale ? "ohne Beleg und ohne Begründung" : passages.length === 0 ? "ohne Beleg" : "ohne Begründung" } };
  }
  return { level, passages, rationale };
}

/**
 * Parse the WHOLE reply: exactly the seven lines in order, each once, nothing else, no truncation, CRLF tolerated.
 * Enum fields must be exactly one allowed token. Pure.
 */
export function parseAssistantReply(text: string): ParsedReply {
  if (text.length > MAX_REPLY_CHARS) return { ok: false, reason: "reply too long" };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length !== REPLY_KEYS.length) return { ok: false, reason: `expected ${REPLY_KEYS.length} lines, got ${lines.length}` };
  const values: Record<string, string> = {};
  for (let i = 0; i < REPLY_KEYS.length; i += 1) {
    const m = lines[i].match(/^([A-ZÄÖÜ_]+)\s*:\s*(.*)$/);
    if (!m || m[1] !== REPLY_KEYS[i]) return { ok: false, reason: `line ${i + 1} must be ${REPLY_KEYS[i]}` };
    values[REPLY_KEYS[i]] = m[2].trim();
  }
  const answer = values.ANTWORT.replace(/\[\[|\]\]/g, "").replace(/\*\*|__|`/g, "").trim();
  if (!answer || answer.length > 400) return { ok: false, reason: "bad answer" };
  const kind = values.ART.toLowerCase();
  if (kind !== "klaerung" && kind !== "lehre" && kind !== "abschluss") return { ok: false, reason: "bad kind" };
  const prompt = values.PROMPT;
  if (!/^(?:P[1-9]|-)$/.test(prompt)) return { ok: false, reason: "bad prompt id" };
  const criteria = {} as Record<ReasoningCriterionId, CriterionAssessment>;
  for (const id of ["strategy", "quantities", "meaning"] as const) {
    const parsed = parseCriterion(values[CRITERION_KEY[id]]);
    if (!parsed) return { ok: false, reason: `bad ${CRITERION_KEY[id]}` };
    criteria[id] = parsed;
  }
  const w = values.WIDERSPRUCH;
  if (!w) return { ok: false, reason: "empty WIDERSPRUCH" };
  if (w.length > 120) return { ok: false, reason: "WIDERSPRUCH too long" };
  return { ok: true, reply: { answer, kind: kind as AssistantKind, promptId: prompt === "-" ? null : prompt, criteria, contradiction: w === "-" ? null : w } };
}

// ---------------------------------------------------------------------------
// Grounding of passages (verbatim check — reported, never used to overrule)
// ---------------------------------------------------------------------------

const collapse = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The child turn a passage is verbatim in (whitespace/case-insensitive), or -1. */
export function locatePassage(passage: string, childTexts: readonly string[]): number {
  const needle = collapse(passage);
  if (!needle) return -1;
  for (let i = childTexts.length - 1; i >= 0; i -= 1) if (collapse(childTexts[i]).includes(needle)) return i;
  return -1;
}

export type StoredCriterion = CriterionAssessment & {
  /** Per passage: the child turn it is verbatim in, or -1 (ungrounded). */
  grounding: number[];
  /** THIS criterion rests only on passages from before the last retraction, or on a disowned turn, or on nothing after a retraction (per criterion, R4-04). */
  preRetraction: boolean;
};

export type ReasoningAssessment = {
  /** Who/what produced it: the isolated child assistant through the bridge; model id is not disclosed by the bridge. */
  by: "nabu-child-assistant";
  schemaVersion: number;
  contentVersion: number;
  /** The turn id the assessment answered. */
  turnId: string;
  /** AUTHENTICATED run metadata from the bridge receipt (v2): "<provider>/<model>" and the run id as the executor reported them ("unknown" when it reported none); null when the receipt carried none (v1). Never a configured default (R4-06). */
  model: { model: string; runId: string } | null;
  /** The number of child turns it had seen. */
  childTurns: number;
  kind: AssistantKind;
  criteria: Record<ReasoningCriterionId, StoredCriterion>;
  /** Some passage is not verbatim in the child's turns — reported as uncertainty in the summary. */
  ungrounded: boolean;
  /** This assessment followed a retraction turn but rests only on passages from before it (or none), or rests on a turn the child disowned. Reported; reads as uncertain in the summary. */
  preRetractionGrounding: boolean;
  /** A later child turn retracted or contradicted: a reassessment is required; this one no longer counts. */
  stale: boolean;
  revision: number;
  at: string;
};

function storeAssessment(reply: AssistantReply, childTexts: readonly string[], screen: ChildScreen, meta: { turnId: string; contentVersion: number; revision: number; at: string; model: { model: string; runId: string } | null }): ReasoningAssessment {
  const criteria = {} as Record<ReasoningCriterionId, StoredCriterion>;
  let ungrounded = false;
  // a retraction AND a disowning turn ("not my way") both invalidate everything grounded before them
  const invalidations = [...screen.retractionTurns, ...screen.disownTurns];
  const lastRetraction = invalidations.length ? Math.max(...invalidations) : -1;
  for (const id of ["strategy", "quantities", "meaning"] as const) {
    const c = reply.criteria[id];
    const grounding = c.passages.map((p) => locatePassage(p, childTexts));
    if (grounding.some((g) => g < 0)) ungrounded = true;
    const grounded = grounding.filter((g) => g >= 0);
    // per criterion (R5-04): after a retraction/disowning, ANY cited passage from before it or from a disowned turn is INADMISSIBLE,
    // and a criterion that rests on an inadmissible passage reads as uncertain — a new unrelated citation never revives it;
    // after an invalidation a criterion with no admissible grounding at all is uncertain too
    const inadmissible = grounded.some((g) => g < lastRetraction || screen.disownTurns.includes(g));
    const preRetraction = inadmissible || (lastRetraction >= 0 && grounded.length === 0);
    criteria[id] = { ...c, grounding, preRetraction };
  }
  const preRetractionGrounding = Object.values(criteria).some((cr) => cr.preRetraction);
  return { by: "nabu-child-assistant", schemaVersion: ASSESSMENT_SCHEMA_VERSION, contentVersion: meta.contentVersion, turnId: meta.turnId, model: meta.model, childTurns: childTexts.length, kind: reply.kind, criteria, ungrounded, preRetractionGrounding, stale: false, revision: meta.revision, at: meta.at };
}

/** The level a criterion reads as in a summary: the assistant's level, except that a stale assessment, or one grounded only before a retraction, reads as uncertain. */
export function effectiveLevel(a: ReasoningAssessment | null, id: ReasoningCriterionId): AssessmentLevel | null {
  if (!a) return null;
  if (a.stale || a.criteria[id].preRetraction) return "uncertain";
  return a.criteria[id].level;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** `phase`: `post-assessment` = free-form content delivered WITH the closing assessment (it cannot have shaped that assessment, but it is exposure and is recorded before delivery, R4-02). */
export type SupportEvent = { kind: SupportEventKind; at: string; turnId?: string; promptId?: string; phase?: "pre-assessment" | "post-assessment" };

export type ReasoningTurn = {
  role: "nabu" | "child";
  text: string;
  modality?: "typed" | "spoken";
  /**
   * `prompt` = the opening question; `prompt-bank` = a reviewed clarification the assistant selected; `dialogue` = the verified
   * assistant's own line; `withheld` = a reply whose origin was not verified (the text is NOT stored here; the line shown is local
   * guidance); `unavailable` = no usable reply; `scaffold` / `teach` / `after-teach` / `close` = reviewed lines.
   */
  kind?: "prompt" | "prompt-bank" | "dialogue" | "withheld" | "unavailable" | "scaffold" | "teach" | "after-teach" | "close";
  /** `assistant` = verified Nabu; `reviewed` = reviewed app text; `local` = local guidance shown instead of untrusted content. */
  source?: "assistant" | "reviewed" | "local";
  origin?: ReplyOrigin;
  /** Child turns: the observed facts over all child turns up to and including this one. */
  screen?: ChildScreen;
  /** Which assessment revision this (assistant) turn produced. */
  assessmentRevision?: number;
  turnId?: string;
  at: string;
};

export type ReasoningState = {
  itemId: ScoredMathItemId;
  turns: ReasoningTurn[];
  childTurns: number;
  assistantTurns: number;
  unavailable: number;
  status: "open" | "awaiting" | "scaffold" | "done";
  pending: { turnId: string; message: string; reqHash: string; at: string } | null;
  /** Summary label (Nabu's assessment + support mode), set at close. */
  method: ReasoningMethod | null;
  supportMode: SupportMode;
  supportEvents: SupportEvent[];
  /** Compatibility: the scaffold choices used (`counters`, `teaching`). */
  support: ("counters" | "teaching")[];
  clarificationsUsed: number;
  /** Every assessment revision, in order (never deleted). */
  assessments: ReasoningAssessment[];
  /** The assessment that counts at close (latest non-stale), or null. */
  final: ReasoningAssessment | null;
  screen: ChildScreen | null;
  /** Origins of all replies, counted. */
  origins: Record<ReplyOrigin, number>;
  afterTeach: boolean;
  closedAt: string | null;
  closeReason: string | null;
};

export function newReasoningState(itemId: ScoredMathItemId, def: ReasoningDef, nowIso: string): ReasoningState {
  return { itemId, turns: [{ role: "nabu", text: def.prompt, kind: "prompt", source: "reviewed", at: nowIso }], childTurns: 0, assistantTurns: 0, unavailable: 0, status: "open", pending: null, method: null, supportMode: "unsupported", supportEvents: [], support: [], clarificationsUsed: 0, assessments: [], final: null, screen: null, origins: { verified: 0, missing: 0, malformed: 0, invalid: 0 }, afterTeach: false, closedAt: null, closeReason: null };
}

export function turnLimit(state: ReasoningState, def: ReasoningDef): number {
  return def.maxChildTurns + (state.support.includes("counters") ? 1 : 0) + (state.support.includes("teaching") ? 1 : 0);
}

export function turnsLeft(state: ReasoningState, def: ReasoningDef): number {
  return Math.max(0, turnLimit(state, def) - state.childTurns);
}

// ---------------------------------------------------------------------------
// The bridge message (bounded)
// ---------------------------------------------------------------------------

export const REASONING_DISPATCH_MARKER = "Gespräch über den Rechenweg";

export function sanitiseChildText(text: string, max = MAX_CHILD_TURN_CHARS): string {
  return text.replace(/\[\[|\]\]|«|»/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function screenInWords(screen: ChildScreen | null, state: ReasoningState, def: ReasoningDef): string[] {
  const out: string[] = [];
  if (!screen) out.push("Noch keine Antwort des Kindes.");
  else if (screen.reasons.length === 0) out.push("Keine Auffälligkeiten.");
  else out.push(...screen.reasons);
  const left = Math.max(0, def.maxClarifications - state.clarificationsUsed);
  out.push(left > 0 ? `Du darfst noch ${left} Klärungsfrage(n) aus der Liste stellen (ART: klaerung); das Gespräch gilt bis dahin als ohne Hilfe.` : "Keine Klärungsfrage mehr: erkläre jetzt natürlich (ART: lehre, gilt als Hilfe) oder schliesse ab (ART: abschluss).");
  if (state.supportMode === "supported") out.push("Das Kind hat bereits Hilfe bekommen (wird so gespeichert).");
  return out;
}

export type ReasoningDispatchContext = { item: MathItem; def: ReasoningDef; childAnswer: string; page: "mission"; contentVersion?: number };
export type DispatchBuild = { ok: true; message: string } | { ok: false; reason: "too-long" };

export function buildReasoningDispatch(ctx: ReasoningDispatchContext, state: ReasoningState, childText: string, round: number, limit: number, screen: ChildScreen): DispatchBuild {
  const head = [
    `Kontext (Lern-Expedition, vom Lernsystem) — ${REASONING_DISPATCH_MARKER}.`,
    `Aufgabe ${ctx.item.id} v${ctx.item.version}: ${ctx.item.prompt}`,
    `Antwort des Kindes auf die Aufgabe (bereits gespeichert, nicht Thema): ${ctx.childAnswer}.`,
    "Deine Rolle: Du bist Nabu. Es geht nur darum, WIE das Kind gerechnet hat.",
    ...ctx.def.rules.map((r) => `- ${r}`),
    "Kriterien:",
    ...ctx.def.criteria.map((c) => `- ${c.label}: ${c.question}`),
    "Klärungsfragen (Liste):",
    ...ctx.def.prompts.map((p) => `- ${p.id}: ${p.text}`),
    ...(state.support.includes("teaching") ? ["- Das Kind hat deinen Rechenweg vorgezeigt bekommen (Hilfe); es soll ihn jetzt in eigenen Worten erzählen."] : []),
    ...(state.support.includes("counters") ? ["- Das Kind hat die Kisten mit Material in Boote gelegt (Hilfe); es soll erzählen, was es gesehen hat."] : []),
    "Hinweise des Lernsystems:",
    ...screenInWords(screen, state, ctx.def).map((l) => `- ${l}`),
  ];
  const tail = [`Runde ${round} von ${limit}.${round >= limit ? ` ${ctx.def.lastRound}` : ""}`, ...ctx.def.schema, "---", "Letzte Antwort des Kindes:", sanitiseChildText(childText)];
  const history = state.turns.filter((t) => t.kind !== "withheld" && t.kind !== "unavailable").map((t) => (t.role === "nabu" ? `Nabu: ${sanitiseChildText(t.text, 300)}` : `Kind (${t.modality === "spoken" ? "gesprochen" : "getippt"}): „${sanitiseChildText(t.text, 300)}“`));
  const assemble = (hist: string[]) => [...head, "Bisheriges Gespräch:", ...hist, ...tail].join("\n");
  let kept = history;
  let message = assemble(kept);
  while (message.length > MAX_DISPATCH_CHARS && kept.length > 0) {
    kept = kept.slice(1);
    message = assemble([`… (${history.length - kept.length} ältere Zeilen ausgelassen)`, ...kept]);
  }
  if (message.length > MAX_DISPATCH_CHARS) return { ok: false, reason: "too-long" };
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// State machine (pure)
// ---------------------------------------------------------------------------

export type ReasoningDispatch = { state: ReasoningState; turnId: string; message: string; reqHash: string };

export function applyReasoningTurn(state: ReasoningState, text: string, modality: "typed" | "spoken", ctx: ReasoningDispatchContext, turnId: string, nowIso: string): ReasoningDispatch {
  if (state.status === "done") throw new Error("the reasoning conversation is closed");
  if (state.status === "scaffold") throw new Error("the scaffold is offered: choose counters, teaching or continue first");
  if (state.status === "awaiting") throw new Error("the assistant's reply is still pending: resend or wait");
  if (turnsLeft(state, ctx.def) <= 0) throw new Error("no turns left in this conversation");
  if (text.length > MAX_CHILD_TURN_CHARS) throw new Error("explanation too long");
  const childTexts = [...state.turns.filter((t) => t.role === "child").map((t) => t.text), text];
  const screen = screenChildTexts(childTexts);
  const round = state.childTurns + 1;
  const built = buildReasoningDispatch(ctx, state, text, round, turnLimit(state, ctx.def), screen);
  if (!built.ok) throw new Error("explanation too long for one message");
  const reqHash = sha256Hex(built.message);
  // A retraction or a new unresolved contradiction makes every earlier assessment stale: a reassessment must follow.
  const previous = state.screen;
  const newContradiction = screen.contradictions.some((c) => !(previous?.contradictions ?? []).includes(c));
  const invalidates = screen.retractionInLastTurn || newContradiction;
  const assessments = invalidates ? state.assessments.map((a) => ({ ...a, stale: true })) : state.assessments;
  const turns: ReasoningTurn[] = [...state.turns, { role: "child", text, modality, screen, turnId, at: nowIso }];
  return { state: { ...state, turns, childTurns: round, status: "awaiting", pending: { turnId, message: built.message, reqHash, at: nowIso }, screen, assessments }, turnId, message: built.message, reqHash };
}

export type ReasoningReply = { turnId: string; ok: boolean; text: string; origin: ReplyOrigin; /** Authenticated run metadata from the receipt (v2), or null. */ provenance?: { model: string; runId: string } | null };
export type ReasoningStep = { state: ReasoningState; nabu: ReasoningTurn; done: boolean; malformed: boolean; supportRecorded: SupportEventKind | null };

function latestValid(assessments: ReasoningAssessment[]): ReasoningAssessment | null {
  for (let i = assessments.length - 1; i >= 0; i -= 1) if (!assessments[i].stale) return assessments[i];
  return null;
}

/** The summary label at close: Nabu's levels + the support mode. "unscored" only when no verified assessment exists. */
export function summarise(state: ReasoningState): { method: ReasoningMethod; final: ReasoningAssessment | null } {
  const final = latestValid(state.assessments) ?? (state.assessments.length ? { ...state.assessments[state.assessments.length - 1] } : null);
  if (!final) return { method: "unscored", final: null };
  const levels = (["strategy", "quantities", "meaning"] as const).map((id) => effectiveLevel(final, id));
  const all = levels.every((l) => l === "demonstrated");
  if (!all) return { method: "not-yet-established", final };
  // the label describes the explanation BEFORE the final assessment: content delivered with the closing line is exposure
  // (recorded, shown in the report) but could not have shaped what was assessed
  const supportBeforeAssessment = state.supportEvents.some((e) => e.kind !== "clarification-prompt" && e.phase !== "post-assessment");
  if (supportBeforeAssessment) return { method: "explained-with-support", final };
  return { method: state.clarificationsUsed > 0 ? "explained-after-probing" : "explained-independently", final };
}

/**
 * Apply the reply bound to the pending dispatch.
 *  - origin missing / malformed / invalid → the text is WITHHELD (never stored as a turn, never shown, never spoken); a local
 *    reviewed line is shown instead; counts as unavailable (two → scaffold);
 *  - verified → parsed strictly; every reply stores an assessment revision; `klaerung` renders the selected prompt (unsupported
 *    window, at most maxClarifications); `lehre` switches to supported BEFORE the line is shown and logs the event; `abschluss`
 *    closes with the summary; a malformed reply is unavailable.
 */
export function applyReasoningReply(state: ReasoningState, reply: ReasoningReply, ctx: ReasoningDispatchContext, nowIso: string): ReasoningStep {
  if (state.status !== "awaiting" || !state.pending) throw new Error("no reply is pending");
  if (state.pending.turnId !== reply.turnId) throw new Error("the reply belongs to another turn");
  const def = ctx.def;
  const childTexts = state.turns.filter((t) => t.role === "child").map((t) => t.text);
  const screen = state.screen ?? screenChildTexts(childTexts);
  const origins = { ...state.origins, [reply.origin]: state.origins[reply.origin] + 1 };
  const base: ReasoningState = { ...state, pending: null, screen, origins };
  const noTurnsLeft = turnsLeft(base, def) <= 0;
  const canScaffold = !base.support.includes("counters") || !base.support.includes("teaching");
  const step = (nabu: ReasoningTurn, next: Partial<ReasoningState>, done: boolean, extra: Partial<Pick<ReasoningStep, "malformed" | "supportRecorded">> = {}): ReasoningStep => ({ state: { ...base, ...next, turns: [...base.turns, nabu] }, nabu, done, malformed: false, supportRecorded: null, ...extra });
  const close = (s: ReasoningState, shown: ReasoningTurn, reason: string, extra: Partial<Pick<ReasoningStep, "malformed" | "supportRecorded">> = {}): ReasoningStep => {
    const { method, final } = summarise(s);
    const closeLine: ReasoningTurn = { role: "nabu", text: def.fallback.continued, kind: "close", source: "reviewed", at: nowIso };
    const turns = shown.kind === "dialogue" && reason === "accepted" ? [...base.turns, shown] : [...base.turns, shown, closeLine];
    return { state: { ...s, turns, status: "done", method, final, closedAt: nowIso, closeReason: reason }, nabu: shown, done: true, malformed: false, supportRecorded: null, ...extra };
  };
  const bound = (shown: ReasoningTurn, next: Partial<ReasoningState>, extra: Partial<Pick<ReasoningStep, "malformed" | "supportRecorded">> = {}): ReasoningStep => {
    if (canScaffold) {
      const scaffold: ReasoningTurn = { role: "nabu", text: def.scaffold, kind: "scaffold", source: "reviewed", at: nowIso };
      return { state: { ...base, ...next, turns: [...base.turns, shown, scaffold], status: "scaffold" }, nabu: shown, done: false, malformed: false, supportRecorded: null, ...extra };
    }
    return close({ ...base, ...next }, shown, "bound-reached", extra);
  };

  // --- untrusted origin: withheld entirely, local guidance shown
  if (reply.origin !== "verified") {
    const unavailable = state.unavailable + 1;
    const local: ReasoningTurn = { role: "nabu", text: def.fallback.withheld, kind: "withheld", source: "local", origin: reply.origin, turnId: reply.turnId, at: nowIso };
    if (unavailable >= 2 || noTurnsLeft) return bound(local, { unavailable });
    return step(local, { status: "open", unavailable }, false);
  }
  // --- no reply / malformed
  const parsed = reply.ok && reply.text.trim() ? parseAssistantReply(reply.text) : ({ ok: false, reason: "no reply" } as const);
  if (!parsed.ok) {
    const unavailable = state.unavailable + 1;
    const notice: ReasoningTurn = { role: "nabu", text: def.fallback.unavailable, kind: "unavailable", source: "reviewed", origin: "verified", turnId: reply.turnId, at: nowIso };
    if (unavailable >= 2 || noTurnsLeft) return bound(notice, { unavailable }, { malformed: reply.ok });
    return step(notice, { status: "open", unavailable }, false, { malformed: reply.ok });
  }
  const r = parsed.reply;
  const assistantTurns = state.assistantTurns + 1;
  const revision = state.assessments.length + 1;
  const assessment = storeAssessment(r, childTexts, screen, { turnId: reply.turnId, contentVersion: ctx.contentVersion ?? 4, revision, at: nowIso, model: reply.provenance ?? null });
  const assessments = [...state.assessments, assessment];
  // the narrow contradiction the assistant names is kept only when the child actually stated it (observed fact)
  const named = r.contradiction && screen.contradictions.some((c) => normaliseNumbers(c) === normaliseNumbers(r.contradiction!)) ? r.contradiction : null;
  void named;
  const common = { assistantTurns, assessments };
  // --- a clarification from the prompt bank (unsupported window)
  if (r.kind === "klaerung" && r.promptId && state.clarificationsUsed < def.maxClarifications) {
    const prompt = def.prompts.find((p) => p.id === r.promptId);
    if (prompt) {
      const event: SupportEvent = { kind: "clarification-prompt", at: nowIso, turnId: reply.turnId, promptId: prompt.id, phase: "pre-assessment" };
      const shown: ReasoningTurn = { role: "nabu", text: prompt.text, kind: "prompt-bank", source: "reviewed", origin: "verified", turnId: reply.turnId, assessmentRevision: revision, at: nowIso };
      const next = { ...common, clarificationsUsed: state.clarificationsUsed + 1, supportEvents: [...state.supportEvents, event] };
      if (noTurnsLeft) return bound(shown, next, { supportRecorded: "clarification-prompt" });
      return step(shown, { status: "open", ...next }, false, { supportRecorded: "clarification-prompt" });
    }
  }
  // --- closing: Nabu's own free-form line is content the child is exposed to — recorded as a POST-assessment support event
  //     before delivery (it cannot have shaped the assessment it comes with, so the summary label is computed from the
  //     pre-assessment support only; the exposure itself is never hidden from the record)
  if (r.kind === "abschluss") {
    const event: SupportEvent = { kind: "tutor-content", at: nowIso, turnId: reply.turnId, phase: "post-assessment" };
    const shown: ReasoningTurn = { role: "nabu", text: r.answer, kind: "dialogue", source: "assistant", origin: "verified", turnId: reply.turnId, assessmentRevision: revision, at: nowIso };
    return close({ ...base, ...common, supportMode: "supported", supportEvents: [...state.supportEvents, event] }, shown, "accepted", { supportRecorded: "tutor-content" });
  }
  // --- content-bearing teaching (lehre, or a clarification the bank cannot serve): SUPPORTED, recorded before it is shown
  const event: SupportEvent = { kind: "tutor-content", at: nowIso, turnId: reply.turnId, phase: "pre-assessment" };
  const shown: ReasoningTurn = { role: "nabu", text: r.answer, kind: "dialogue", source: "assistant", origin: "verified", turnId: reply.turnId, assessmentRevision: revision, at: nowIso };
  const next = { ...common, supportMode: "supported" as const, supportEvents: [...state.supportEvents, event] };
  if (noTurnsLeft) return bound(shown, next, { supportRecorded: "tutor-content" });
  return step(shown, { status: "open", ...next }, false, { supportRecorded: "tutor-content" });
}

export function pendingDispatch(state: ReasoningState): { turnId: string; message: string; reqHash: string } | null {
  return state.status === "awaiting" && state.pending ? { turnId: state.pending.turnId, message: state.pending.message, reqHash: state.pending.reqHash } : null;
}

export function applyReasoningChoice(state: ReasoningState, choice: "counters" | "teach" | "continue", def: ReasoningDef, nowIso: string): ReasoningStep {
  if (state.status !== "scaffold") throw new Error("no scaffold is offered");
  const support = [...state.support];
  const turns = [...state.turns];
  const none = { malformed: false, supportRecorded: null as SupportEventKind | null };
  if (choice === "counters") {
    if (support.includes("counters")) throw new Error("the counters were already used");
    support.push("counters");
    const nabu: ReasoningTurn = { role: "nabu", text: def.counters, kind: "scaffold", source: "reviewed", at: nowIso };
    turns.push(nabu);
    return { state: { ...state, turns, status: "open", support, supportMode: "supported", supportEvents: [...state.supportEvents, { kind: "counters", at: nowIso, phase: "pre-assessment" }] }, nabu, done: false, ...none, supportRecorded: "counters" };
  }
  if (choice === "teach") {
    if (support.includes("teaching")) throw new Error("the teaching was already shown");
    support.push("teaching");
    turns.push({ role: "nabu", text: def.teach, kind: "teach", source: "reviewed", at: nowIso });
    const nabu: ReasoningTurn = { role: "nabu", text: def.afterTeach, kind: "after-teach", source: "reviewed", at: nowIso };
    turns.push(nabu);
    return { state: { ...state, turns, status: "open", support, afterTeach: true, supportMode: "supported", supportEvents: [...state.supportEvents, { kind: "teaching", at: nowIso, phase: "pre-assessment" }] }, nabu, done: false, ...none, supportRecorded: "teaching" };
  }
  const nabu: ReasoningTurn = { role: "nabu", text: def.fallback.continued, kind: "close", source: "reviewed", at: nowIso };
  turns.push(nabu);
  const { method, final } = summarise(state);
  return { state: { ...state, turns, status: "done", method, final, support, closedAt: nowIso, closeReason: state.assistantTurns === 0 ? "no-dialogue" : "continued" }, nabu, done: true, ...none };
}

export function closeReasoningUnresolved(state: ReasoningState, nowIso: string, reason: string): ReasoningState {
  if (state.status === "done") return state;
  const { method, final } = summarise(state);
  return { ...state, status: "done", pending: null, method, final, closedAt: nowIso, closeReason: reason };
}

export function methodLabel(def: ReasoningDef, method: ReasoningMethod | null): string {
  if (!method) return "offen";
  return def.methodLabels[method] ?? method;
}

export function levelLabel(def: ReasoningDef, level: AssessmentLevel | null): string {
  if (!level) return "nicht eingeschätzt";
  return def.levelLabels[level] ?? level;
}

export function childExplanationText(state: ReasoningState): string {
  return state.turns.filter((t) => t.role === "child").map((t) => t.text).join(" ");
}
