// ---------------------------------------------------------------------------
// Writing review of the child's own German log sentence (Visit 5, content
// version 4; family-assistant DESIGN §7.6 "Visit 5 — the harbor", CONTRACT.md
// "October 10 — Visit 5", feedback group F2; repair round 2, 2026-10-10:
// IV5-07/08/09/12 and the origin gate of IV5-03; repair round 3: whole-reply
// validation without slicing; repair round 4 / assessment reset: per-criterion
// revision findings with token boundaries, no global correctness claim).
//
// Two sources, kept apart and both evidence-linked:
//
//  - MECHANICAL checks (deterministic, this module): spacing (the reviewed
//    checker), capitalisation (sentence start, reviewed nouns), spelling (the
//    reviewed misspellings only), punctuation (an end mark). A word the lexicon
//    does not know is listed as UNCHECKED — never rewritten, never called
//    wrong, never a reason for a question by itself.
//
//  - SEMANTIC review (the isolated child assistant through the existing bridge
//    transport, session "learn"): meaning / task fulfilment, completeness,
//    grammar, unclear words. The reply is a STRICT five-line schema: every line
//    exactly once, in order, nothing else; a missing, duplicated or unparseable
//    line makes the whole reply unusable; "unklar" leaves that aspect UNCHECKED;
//    a grammar span that is not verbatim in the original leaves grammar
//    UNCHECKED (never clean). Every assistant finding is `uncertain`. Without a
//    usable reply these aspects are reported as NOT CHECKED — never as in order.
//    Origin: only a reply the server verified against the bridge's signed
//    receipt counts as the assistant's; an unverified reply leaves the semantic
//    aspects unchecked and is kept only as evidence.
//
// The review diagnoses broadly but TEACHES at most `maxTeachingPoints` POINTS:
// one point per aspect, grouping every occurrence of that aspect (IV5-09). The
// summary names exactly which aspects had no finding, which were not checked,
// and says that nothing else was checked. The original is kept EXACTLY as
// typed. Spoken text never reaches this module as spelling evidence.
// ---------------------------------------------------------------------------

import type { LogDef, SpacingJoin, WritingReviewAspect, WritingReviewDef } from "./family-learning-content.ts";
import { evaluateRevision, flagSpacing, markSpacing, suggestSpacing, type SpacingFlag } from "./family-learning-writing.ts";

export type WritingFinding = {
  /** `<aspect>:<key>` — stable within one review (e.g. `spelling:ales`, `capitalization:boot`, `spacing:rule`, `grammar:1`). */
  id: string;
  aspect: WritingReviewAspect;
  /** The child's text at that place (word, quoted span, or marked sentence). Verbatim from the original. */
  given: string;
  /** What the reviewed rule expects, or null when the child has to write it (meaning, completeness, grammar). */
  expected: string | null;
  /** Short child-facing teaching line (German). */
  teaching: string;
  source: "rule" | "assistant";
  certainty: "certain" | "uncertain";
};

/** One TEACHING POINT shown to the child: one aspect, all its occurrences grouped (at most `maxTeachingPoints` points per review). */
export type TeachingPoint = {
  aspect: WritingReviewAspect;
  aspectLabel: string;
  source: "rule" | "assistant";
  certainty: "certain" | "uncertain";
  /** The teaching line of the first finding of this aspect. */
  teaching: string;
  /** Every occurrence (given → expected), in text order. */
  examples: { given: string; expected: string | null }[];
  /** The finding ids this point covers. */
  ids: string[];
};

/** The assistant's bounded semantic review, parsed from the strict schema; `null` fields mean "not judged". */
export type SemanticReview = {
  status: "done" | "unavailable" | "unverified";
  taskFulfilled: boolean | null;
  reason: string | null;
  complete: boolean | null;
  /** Grammar: `true` = checked, nothing found; `false` = a finding; `null` = not judged (unklar, or span not in the original). */
  grammarChecked: boolean | null;
  unclearWords: string[];
  grammar: { span: string; note: string }[];
  question: string | null;
  raw: string | null;
  /** Why a reply was not usable, for the parent. */
  problem: string | null;
};

export type WritingReview = {
  /** EXACTLY as typed. */
  original: string;
  findings: WritingFinding[];
  /** Every finding of a taught aspect (for the revision evaluation). */
  taught: WritingFinding[];
  /** The at most `maxTeachingPoints` points shown to the child. */
  points: TeachingPoint[];
  /** Aspects checked with no finding — named, never summarised as "all correct". */
  clean: WritingReviewAspect[];
  /** Aspects that could not be checked. */
  unchecked: WritingReviewAspect[];
  /** Words the lexicon does not know — unchecked, never a finding. */
  uncheckedWords: string[];
  taskFulfilled: boolean | null;
  clarify: { words: string[]; question: string } | null;
  /** The original with the TAUGHT mechanical points applied — shown as help; null when nothing mechanical is taught. */
  suggestion: string | null;
  marked: string | null;
  summary: string;
  semantic: SemanticReview | null;
};

const ASPECT_LABEL: Record<WritingReviewAspect, string> = {
  meaning: "Inhalt",
  completeness: "ganzer Satz",
  grammar: "Satzbau",
  spacing: "Leerzeichen",
  capitalization: "Grossschreibung",
  spelling: "Schreibweise",
  punctuation: "Satzzeichen",
};

export function writingAspectLabel(aspect: WritingReviewAspect): string {
  return ASPECT_LABEL[aspect] ?? aspect;
}

const WORD = /[\p{L}\p{N}]+/gu;
const UPPER = /^\p{Lu}/u;
const END_MARK = /[.!?…]\s*$/u;
const MECHANICAL: readonly WritingReviewAspect[] = ["spacing", "capitalization", "spelling", "punctuation"];
const SEMANTIC: readonly WritingReviewAspect[] = ["meaning", "completeness", "grammar"];

type Token = { raw: string; word: string; lower: string; index: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = new RegExp(WORD.source, WORD.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ raw: m[0], word: m[0], lower: m[0].toLowerCase(), index: m.index });
  return tokens;
}

const isNumeral = (w: string) => /^\p{N}+$/u.test(w);

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bounded(text: string, max: number): string {
  return text.replace(/\[\[|\]\]/g, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Review one typed sentence: the mechanical checks always, the semantic aspects from a usable, verified reply. Pure. */
export function reviewLogSentence(text: string, def: WritingReviewDef, joins: readonly SpacingJoin[], semantic: SemanticReview | null = null): WritingReview {
  const original = text;
  const tokens = tokenize(original);
  const nounForms = new Map<string, string>();
  for (const n of def.nouns) for (const f of n.forms) nounForms.set(f.toLowerCase(), f);
  const misspelling = new Map<string, string | null>(def.misspellings.map((m) => [m.wrong, m.right]));
  const known = new Set<string>([...def.functionWords, ...def.verbs, ...def.subjects, ...def.taskWords]);
  const findings: WritingFinding[] = [];
  const uncheckedWords: string[] = [];
  const rule = (f: Omit<WritingFinding, "source" | "certainty">): WritingFinding => ({ ...f, source: "rule", certainty: "certain" });
  const assistant = (f: Omit<WritingFinding, "source" | "certainty">): WritingFinding => ({ ...f, source: "assistant", certainty: "uncertain" });

  for (const t of tokens) {
    if (isNumeral(t.word)) continue;
    const right = misspelling.get(t.lower);
    if (right !== undefined) {
      if (right !== null && right.toLowerCase() !== t.lower) findings.push(rule({ id: `spelling:${t.lower}`, aspect: "spelling", given: t.raw, expected: right, teaching: `„${t.raw}“ schreibt man „${right}“.` }));
      continue;
    }
    if (known.has(t.lower) || nounForms.has(t.lower)) continue;
    if (!uncheckedWords.includes(t.raw)) uncheckedWords.push(t.raw);
  }

  const taskWordsFound = tokens.filter((t) => [t.lower, misspelling.get(t.lower)?.toLowerCase() ?? ""].some((w) => w && def.taskWords.some((tw) => w === tw || (tw.length >= 4 && w.startsWith(tw))))).map((t) => t.raw);
  const verbs = new Set(def.verbs);
  const verbFound = tokens.some((t) => verbs.has(t.lower) || verbs.has(misspelling.get(t.lower)?.toLowerCase() ?? ""));

  // --- semantic aspects: only a usable (done) reply judges; "unklar"/missing/unanchored → unchecked
  const unchecked: WritingReviewAspect[] = [];
  let taskFulfilled: boolean | null = null;
  let clarify: WritingReview["clarify"] = null;
  const sem = semantic && semantic.status === "done" ? semantic : null;
  if (sem) {
    taskFulfilled = sem.taskFulfilled;
    if (sem.taskFulfilled === false) findings.push(assistant({ id: "meaning:task", aspect: "meaning", given: original, expected: null, teaching: `Dein Satz sagt noch nicht, was ihr gebaut oder transportiert habt.${sem.reason ? ` Nabu meint: ${sem.reason}` : ""} Schreib es dazu — zum Beispiel die Boote, die Kisten oder den Hafen.` }));
    else if (sem.taskFulfilled === null) unchecked.push("meaning");
    if (sem.complete === false) findings.push(assistant({ id: "completeness:sentence", aspect: "completeness", given: original, expected: null, teaching: "Ein ganzer Satz sagt, wer etwas tut und was passiert — zum Beispiel: Wir haben … geladen." }));
    else if (sem.complete === null) unchecked.push("completeness");
    if (sem.grammarChecked === null) unchecked.push("grammar");
    else sem.grammar.forEach((g, i) => findings.push(assistant({ id: `grammar:${i + 1}`, aspect: "grammar", given: g.span, expected: null, teaching: `Bei „${g.span}“: ${g.note}` })));
    const words = sem.unclearWords.filter((w) => original.includes(w));
    if (words.length) clarify = { words, question: sem.question ?? `Was meinst du mit ${words.map((w) => `„${w}“`).join(" und ")}?` };
    else if (sem.question && sem.taskFulfilled !== true) clarify = { words: [], question: bounded(sem.question, 160) };
  } else {
    unchecked.push("meaning", "grammar");
    if (!verbFound && taskWordsFound.length === 0 && tokens.some((t) => !isNumeral(t.word))) {
      findings.push({ id: "completeness:verb", aspect: "completeness", given: original, expected: null, teaching: "Ein ganzer Satz braucht ein Tun-Wort — zum Beispiel: haben … gebaut, haben … geladen, ist, sind.", source: "rule", certainty: "uncertain" });
      clarify = { words: [], question: "Was wolltest du mit deinem Satz sagen? Erzähl es mir in einem ganzen Satz." };
    } else unchecked.push("completeness");
  }

  const flags: SpacingFlag[] = flagSpacing(original, joins);
  if (flags.length) findings.push(rule({ id: "spacing:rule", aspect: "spacing", given: markSpacing(original, flags), expected: suggestSpacing(original, flags), teaching: `Zwischen Wörtern, und zwischen Wort und Zahl, kommt ein Leerzeichen. An ${flags.length} ${flags.length === 1 ? "Stelle" : "Stellen"} fehlt eins — der Strich zeigt wo.` }));
  if (tokens.length && !isNumeral(tokens[0].word) && !UPPER.test(tokens[0].raw)) findings.push(rule({ id: "capitalization:start", aspect: "capitalization", given: tokens[0].raw, expected: capitalise(tokens[0].raw), teaching: `Ein Satz beginnt gross: „${capitalise(tokens[0].raw)}“.` }));
  for (const t of tokens) {
    const reviewed = nounForms.get(t.lower);
    if (reviewed && !UPPER.test(t.raw) && !findings.some((f) => f.id === `capitalization:${t.lower}`)) findings.push(rule({ id: `capitalization:${t.lower}`, aspect: "capitalization", given: t.raw, expected: reviewed, teaching: `„${reviewed}“ ist ein Namenwort — Namenwörter schreibt man gross.` }));
  }
  if (original.trim() && !END_MARK.test(original)) findings.push(rule({ id: "punctuation:end", aspect: "punctuation", given: original, expected: `${original.trimEnd()}.`, teaching: "Am Ende des Satzes steht ein Punkt." }));

  // --- priority, the at most N teaching POINTS (one per aspect, grouped), clean aspects
  const rank = (a: WritingReviewAspect) => def.priority.indexOf(a);
  findings.sort((a, b) => rank(a.aspect) - rank(b.aspect));
  const taughtAspects: WritingReviewAspect[] = [];
  for (const f of findings) if (!taughtAspects.includes(f.aspect) && taughtAspects.length < def.maxTeachingPoints) taughtAspects.push(f.aspect);
  const taught = findings.filter((f) => taughtAspects.includes(f.aspect));
  const points: TeachingPoint[] = taughtAspects.map((aspect) => {
    const of = findings.filter((f) => f.aspect === aspect);
    return { aspect, aspectLabel: ASPECT_LABEL[aspect], source: of[0].source, certainty: of[0].certainty, teaching: aspect === "capitalization" && of.length > 1 ? "Namenwörter und der Satzanfang werden gross geschrieben." : of[0].teaching, examples: (aspect === "spelling" || aspect === "capitalization") ? of.filter((f) => f.expected !== null).map((f) => ({ given: f.given, expected: f.expected })) : [], ids: of.map((f) => f.id) };
  });
  const clean = def.priority.filter((a) => !findings.some((f) => f.aspect === a) && !unchecked.includes(a));

  let suggestion: string | null = null;
  const mechanical = taught.filter((f) => MECHANICAL.includes(f.aspect));
  if (mechanical.length) {
    let s = original;
    if (taughtAspects.includes("spelling")) for (const f of mechanical.filter((x) => x.aspect === "spelling")) s = s.replace(new RegExp(`(^|[^\\p{L}])${escape(f.given)}(?=$|[^\\p{L}])`, "gu"), `$1${f.expected ?? f.given}`);
    if (taughtAspects.includes("capitalization")) for (const f of mechanical.filter((x) => x.aspect === "capitalization")) s = s.replace(new RegExp(`(^|[^\\p{L}])${escape(f.given)}(?=$|[^\\p{L}])`, "gu"), `$1${f.expected ?? f.given}`);
    if (taughtAspects.includes("spacing")) s = suggestSpacing(s, flagSpacing(s, joins));
    if (taughtAspects.includes("punctuation") && !END_MARK.test(s)) s = `${s.trimEnd()}.`;
    suggestion = s === original ? null : s;
  }
  const marked = taughtAspects.includes("spacing") ? markSpacing(original, flags) : null;

  const parts: string[] = [];
  if (clean.length) parts.push(`Geprüft und in Ordnung: ${clean.map((a) => ASPECT_LABEL[a]).join(", ")}.`);
  if (taughtAspects.length) parts.push(`Heute schauen wir an: ${taughtAspects.map((a) => ASPECT_LABEL[a]).join(" und ")}.`);
  const notTaught = [...new Set(findings.filter((f) => !taughtAspects.includes(f.aspect)).map((f) => f.aspect))];
  if (notTaught.length) parts.push(`${notTaught.map((a) => ASPECT_LABEL[a]).join(", ")} ${notTaught.length === 1 ? "kommt" : "kommen"} ein andermal.`);
  if (unchecked.length) parts.push(`Nicht geprüft: ${unchecked.map((a) => ASPECT_LABEL[a]).join(", ")}.`);
  if (clarify) parts.push(clarify.question);
  parts.push("Alles andere habe ich nicht geprüft.");

  return { original, findings, taught, points, clean, unchecked, uncheckedWords, taskFulfilled, clarify, suggestion, marked, summary: parts.join(" "), semantic };
}

// ---------------------------------------------------------------------------
// The semantic review through the isolated child assistant (strict schema)
// ---------------------------------------------------------------------------

export const WRITING_REVIEW_DISPATCH_MARKER = "Prüfung eines Satzes";
const WRITING_KEYS = ["INHALT", "GANZER_SATZ", "UNKLARE_WOERTER", "SATZBAU", "FRAGE"] as const;

export function buildWritingReviewDispatch(def: WritingReviewDef, log: LogDef, original: string): string {
  return [
    `Kontext (Lern-Expedition, vom Lernsystem) — ${WRITING_REVIEW_DISPATCH_MARKER} aus dem Kapitänslogbuch.`,
    `Aufgabe ${log.id} v${log.version}: ${log.prompt}`,
    `Anweisung an das Kind: ${log.instruction}`,
    "Deine Rolle: Du prüfst NUR Inhalt, Vollständigkeit und Satzbau dieses einen deutschen Satzes eines Kindes (2./3. Klasse, Schweiz). Rechtschreibung, Grossschreibung, Leerzeichen und Satzzeichen prüft das Lernsystem selbst — nenne sie nicht.",
    "Regeln: Beurteile nur, was im Satz steht. Erfinde nichts dazu. Ein ungewöhnliches, aber verständliches Wort ist in Ordnung. Ein Satz erfüllt die Aufgabe, wenn er sagt, was im Hafen gebaut oder transportiert wurde (Boote, Kisten, Seile, Werkzeug, Hafen, Steg …), auch mit anderen Worten. Schreib den Satz nicht um. Keine Lösung, kein Beispielsatz. Wenn du etwas nicht beurteilen kannst, schreib unklar.",
    "Antworte in GENAU diesem Format, fünf Zeilen in dieser Reihenfolge, jede genau einmal, sonst nichts:",
    "INHALT: ja | nein | unklar; <Grund in höchstens zwölf Wörtern>",
    "GANZER_SATZ: ja | nein | unklar",
    "UNKLARE_WOERTER: - | <Wörter aus dem Satz, durch Komma getrennt, genau wie geschrieben>",
    "SATZBAU: - | unklar | „<genaue Stelle aus dem Satz>“ -> <Hinweis in höchstens zwölf Wörtern>",
    "FRAGE: - | <eine kurze Frage an das Kind, nur wenn etwas unklar ist>",
    "---",
    "Der Satz des Kindes (genau so geschrieben):",
    original.replace(/\[\[|\]\]/g, " ").slice(0, 600),
  ].join("\n");
}

/** Parse the strict five-line reply. Any deviation makes the whole reply unusable; "unklar" leaves the aspect unjudged. Pure. */
/** The bridge's message limit: a longer reply is refused whole (never sliced). */
export const MAX_SEMANTIC_REPLY_CHARS = 1200;

/**
 * Parse the WHOLE reply (repair round 3, IV5-07): nothing is sliced before parsing; an overlong reply, an empty field, an
 * enum that is not exactly one allowed token ("ja, nein" fails), a question mark-only FRAGE or any extra text makes the
 * whole reply unusable (semantic aspects UNCHECKED). CRLF line ends are tolerated; nothing else is normalised.
 */
export function parseWritingReviewReply(text: string, original: string): SemanticReview {
  const fail = (problem: string): SemanticReview => ({ status: "unavailable", taskFulfilled: null, reason: null, complete: null, grammarChecked: null, unclearWords: [], grammar: [], question: null, raw: text.length > MAX_SEMANTIC_REPLY_CHARS ? null : text || null, problem });
  if (text.length > MAX_SEMANTIC_REPLY_CHARS) return fail(`reply too long (${text.length} > ${MAX_SEMANTIC_REPLY_CHARS})`);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length !== WRITING_KEYS.length) return fail(`expected ${WRITING_KEYS.length} lines, got ${lines.length}`);
  const values: Record<string, string> = {};
  for (let i = 0; i < WRITING_KEYS.length; i += 1) {
    const m = lines[i].match(/^([A-ZÄÖÜ_]+)\s*:\s*(.*)$/);
    if (!m || m[1] !== WRITING_KEYS[i]) return fail(`line ${i + 1} must be ${WRITING_KEYS[i]}`);
    const value = m[2].trim();
    if (!value) return fail(`${WRITING_KEYS[i]} is empty`);
    values[WRITING_KEYS[i]] = value;
  }
  const tri = (token: string): boolean | null | undefined => (token === "ja" ? true : token === "nein" ? false : token === "unklar" ? null : undefined);
  const inhalt = values.INHALT.match(/^(ja|nein|unklar)(?:\s*;\s*(.+))?$/i);
  if (!inhalt) return fail("INHALT must be exactly ja, nein or unklar, optionally followed by ; reason");
  const taskFulfilled = tri(inhalt[1].toLowerCase());
  if (taskFulfilled === undefined) return fail("INHALT must be ja, nein or unklar");
  const reason = inhalt[2] ? bounded(inhalt[2], 120) : null;
  const complete = tri(values.GANZER_SATZ.toLowerCase());
  if (complete === undefined) return fail("GANZER_SATZ must be exactly ja, nein or unklar");
  const unclearRaw = values.UNKLARE_WOERTER;
  let unclearWords: string[] = [];
  if (unclearRaw !== "-") {
    const items = unclearRaw.split(/\s*,\s*/).map((w) => w.replace(/^[„"'“]+|[“"'”]+$/g, "").trim());
    if (items.length === 0 || items.some((w) => !w) || items.length > 4) return fail("UNKLARE_WOERTER must be - or one to four words");
    // a word that is not verbatim in the sentence is no finding (never a reason for a question)
    unclearWords = items.filter((w) => original.includes(w));
  }
  const grammarRaw = values.SATZBAU;
  let grammarChecked: boolean | null;
  const grammar: { span: string; note: string }[] = [];
  if (grammarRaw === "-") grammarChecked = true;
  else if (grammarRaw.toLowerCase() === "unklar") grammarChecked = null;
  else {
    const m = grammarRaw.match(/^[„"“']([^„"“”']+)[“"”']\s*(?:->|→|:)\s*(.+)$/);
    if (!m) return fail("SATZBAU must be -, unklar or „span“ -> note");
    if (original.includes(m[1]) && m[2].trim()) {
      grammarChecked = false;
      grammar.push({ span: m[1], note: bounded(m[2], 120) });
    } else grammarChecked = null; // a span that is not in the sentence is no finding and no clean bill
  }
  const frage = values.FRAGE;
  if (frage !== "-" && !/[\p{L}\p{N}]/u.test(frage)) return fail("FRAGE must be - or a question");
  const question = frage !== "-" ? bounded(frage, 160) : null;
  return { status: "done", taskFulfilled, reason, complete, grammarChecked, unclearWords, grammar, question, raw: text, problem: null };
}

export function unavailableSemanticReview(problem = "no reply"): SemanticReview {
  return { status: "unavailable", taskFulfilled: null, reason: null, complete: null, grammarChecked: null, unclearWords: [], grammar: [], question: null, raw: null, problem };
}

/** A reply that parsed but whose origin the server could not verify: kept as evidence, judges nothing. */
export function unverifiedSemanticReview(raw: string): SemanticReview {
  return { status: "unverified", taskFulfilled: null, reason: null, complete: null, grammarChecked: null, unclearWords: [], grammar: [], question: null, raw: raw.length > MAX_SEMANTIC_REPLY_CHARS ? null : raw, problem: "origin not verified (no valid bridge receipt)" };
}

// ---------------------------------------------------------------------------
// The revision: per-criterion findings with token boundaries (assessment reset §6)
//
// No global "revision correct" and no "mechanical-only" claim. Every TAUGHT
// finding is evaluated on its own criterion as corrected / changed / unresolved /
// unassessed; a criterion that was never checked (no verified semantic review)
// is UNASSESSED and stays so in the stored attempt, the parent summary and the
// UI. Token boundaries are preserved: the original and the revision are compared
// as WORD TOKENS, and a join ("wir haben boote" → "Wirhabenboote") or a split
// is an observed boundary change — it can never disappear under normalisation,
// and it makes every token-aligned criterion unassessed while the spacing
// criterion records the change. A capitalisation correction certifies nothing
// about spelling, grammar or meaning.
// ---------------------------------------------------------------------------

export type LogRevisionOutcome = "revised" | "partial" | "unchanged" | "none-needed";
export type CriterionStatus = "corrected" | "changed" | "unresolved" | "unassessed" | "introduced";

export type CriterionFinding = {
  /** Finding id (`<aspect>:<key>`), or `<aspect>:*` for an aspect-level entry. */
  id: string;
  aspect: WritingReviewAspect;
  status: CriterionStatus;
  /** Child-readable detail (German, short). */
  detail: string;
  source: "rule" | "assistant" | "none";
};

export type LogRevisionEvaluation = {
  outcome: LogRevisionOutcome;
  /** Per taught finding (and per unchecked aspect), the criterion-scoped result. */
  criteria: CriterionFinding[];
  /** Compatibility views of `criteria`: ids by status. */
  resolved: string[];
  unresolved: string[];
  /** Changed but not re-assessed (semantic findings whose place changed; mechanical findings whose token changed to something else). */
  unverified: string[];
  /** Findings of the revision that were not in the original (incl. token joins/splits). */
  introduced: string[];
  /** Aspects that could not be assessed on the revision (never checked, or token alignment failed). */
  unassessed: WritingReviewAspect[];
  /** Token boundary changes between original and revision. */
  boundaries: { originalTokens: number; revisedTokens: number; joins: string[]; splits: string[] };
  copiedSuggestion: boolean;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const tokensOf = (text: string): string[] => text.match(WORD) ?? [];

/** Joins (a revised token equal to two or more consecutive original tokens) and splits (the reverse), case-insensitive. */
function boundaryChanges(original: string[], revised: string[]): { joins: string[]; splits: string[] } {
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
  const o = lower(original);
  const r = lower(revised);
  const joins: string[] = [];
  const splits: string[] = [];
  for (const token of r) {
    if (o.includes(token)) continue;
    for (let i = 0; i < o.length; i += 1) {
      let acc = "";
      for (let j = i; j < o.length && acc.length < token.length; j += 1) {
        acc += o[j];
        if (j > i && acc === token) joins.push(original.slice(i, j + 1).join(" ") + " → " + token);
      }
    }
  }
  for (const token of o) {
    if (r.includes(token)) continue;
    for (let i = 0; i < r.length; i += 1) {
      let acc = "";
      for (let j = i; j < r.length && acc.length < token.length; j += 1) {
        acc += r[j];
        if (j > i && acc === token) splits.push(token + " → " + revised.slice(i, j + 1).join(" "));
      }
    }
  }
  return { joins: [...new Set(joins)], splits: [...new Set(splits)] };
}

export function evaluateLogRevision(review: WritingReview, revised: string, def: WritingReviewDef, joins: readonly SpacingJoin[]): LogRevisionEvaluation {
  const text = revised;
  const copiedSuggestion = review.suggestion !== null && norm(review.suggestion).toLowerCase() === norm(text).toLowerCase();
  const oTokens = tokensOf(review.original);
  const rTokens = tokensOf(text);
  const boundaries = { originalTokens: oTokens.length, revisedTokens: rTokens.length, ...boundaryChanges(oTokens, rTokens) };
  const aligned = oTokens.length === rTokens.length && boundaries.joins.length === 0 && boundaries.splits.length === 0;
  const unchanged = norm(text) === norm(review.original);
  const criteria: CriterionFinding[] = [];
  const unassessedAspects = new Set<WritingReviewAspect>(review.unchecked);
  const map = new Map(def.misspellings.filter((m) => m.right !== null).map((m) => [m.wrong, (m.right as string).toLowerCase()]));
  // the aligned revised token for an original token (first occurrence by lowercase)
  const alignedToken = (given: string): string | null => {
    if (!aligned) return null;
    const i = oTokens.findIndex((t) => t === given || t.toLowerCase() === given.toLowerCase());
    return i < 0 ? null : rTokens[i];
  };
  const after = reviewLogSentence(text, def, joins, null);
  const afterRuleIds = new Set(after.findings.filter((x) => x.source === "rule").map((x) => x.id));
  for (const fnd of review.taught) {
    if (fnd.source === "assistant" || SEMANTIC.includes(fnd.aspect)) {
      // a semantic finding is never re-judged here: unchanged place → unresolved; changed place → changed (not re-assessed)
      const still = fnd.aspect === "grammar" ? text.includes(fnd.given) : unchanged;
      criteria.push({ id: fnd.id, aspect: fnd.aspect, status: still ? "unresolved" : "changed", detail: still ? "unverändert" : "Stelle geändert — nicht erneut beurteilt (keine neue Prüfung durch Nabu)", source: fnd.source });
      if (!still) unassessedAspects.add(fnd.aspect);
      continue;
    }
    if (fnd.aspect === "spacing") {
      const flags = flagSpacing(review.original, joins);
      const r = evaluateRevision(review.original, text, flags);
      const status: CriterionStatus = r.resolved === flags.length && !afterRuleIds.has("spacing:rule") ? "corrected" : r.resolved > 0 ? "changed" : "unresolved";
      criteria.push({ id: fnd.id, aspect: "spacing", status, detail: status === "corrected" ? `alle ${flags.length} Stellen getrennt` : `${r.resolved} von ${flags.length} Stellen getrennt`, source: "rule" });
      continue;
    }
    if (fnd.aspect === "punctuation") {
      const status: CriterionStatus = unchanged ? "unresolved" : afterRuleIds.has("punctuation:end") ? "unresolved" : "corrected";
      criteria.push({ id: fnd.id, aspect: "punctuation", status, detail: status === "corrected" ? "Satzzeichen am Ende gesetzt" : "kein Satzzeichen am Ende", source: "rule" });
      continue;
    }
    // token-aligned criteria: capitalisation and reviewed spelling
    const tok = alignedToken(fnd.given);
    if (tok === null) {
      criteria.push({ id: fnd.id, aspect: fnd.aspect, status: "unassessed", detail: unchanged ? "unverändert" : "Wortgrenzen oder Wortzahl geändert — an dieser Stelle nicht beurteilbar", source: "rule" });
      unassessedAspects.add(fnd.aspect);
      continue;
    }
    const expected = fnd.expected ?? "";
    if (fnd.aspect === "capitalization") {
      const sameWord = tok.toLowerCase() === fnd.given.toLowerCase() || (map.get(fnd.given.toLowerCase()) ?? "") === tok.toLowerCase();
      const status: CriterionStatus = tok === fnd.given ? "unresolved" : sameWord && UPPER.test(tok) ? "corrected" : "changed";
      criteria.push({ id: fnd.id, aspect: "capitalization", status, detail: status === "corrected" ? `„${tok}“ gross geschrieben` : status === "unresolved" ? `„${tok}“ unverändert` : `„${fnd.given}“ wurde zu „${tok}“ — ein anderes Wort, nicht die gelehrte Form`, source: "rule" });
      continue;
    }
    if (fnd.aspect === "spelling") {
      const status: CriterionStatus = tok.toLowerCase() === expected.toLowerCase() ? "corrected" : tok.toLowerCase() === fnd.given.toLowerCase() ? "unresolved" : "changed";
      criteria.push({ id: fnd.id, aspect: "spelling", status, detail: status === "corrected" ? `„${tok}“ richtig geschrieben` : status === "unresolved" ? `„${tok}“ unverändert` : `„${fnd.given}“ wurde zu „${tok}“ — nicht die gelehrte Schreibweise`, source: "rule" });
      continue;
    }
    criteria.push({ id: fnd.id, aspect: fnd.aspect, status: "unassessed", detail: "nicht beurteilbar", source: fnd.source });
    unassessedAspects.add(fnd.aspect);
  }
  // boundary changes are introduced spacing findings in their own right (never erased by normalisation)
  const introduced: string[] = after.findings.filter((x) => x.source === "rule" && !review.findings.some((y) => y.id === x.id)).map((x) => x.id);
  for (const j of boundaries.joins) {
    introduced.push(`spacing:join:${j}`);
    criteria.push({ id: `spacing:join`, aspect: "spacing", status: "introduced", detail: `Wörter zusammengeschrieben: ${j}`, source: "rule" });
  }
  for (const sp of boundaries.splits) {
    introduced.push(`spacing:split:${sp}`);
    criteria.push({ id: `spacing:split`, aspect: "spacing", status: "introduced", detail: `Wort getrennt: ${sp}`, source: "rule" });
  }
  for (const id of introduced.filter((x) => !x.startsWith("spacing:join") && !x.startsWith("spacing:split"))) {
    const found = after.findings.find((x) => x.id === id)!;
    criteria.push({ id, aspect: found.aspect, status: "introduced", detail: `neu aufgefallen: ${found.given}${found.expected ? ` → ${found.expected}` : ""}`, source: "rule" });
  }
  // aspects never checked stay unassessed — propagated, never dropped
  for (const a of review.unchecked) if (!criteria.some((c) => c.aspect === a)) criteria.push({ id: `${a}:*`, aspect: a, status: "unassessed", detail: "nicht geprüft (keine beglaubigte Prüfung durch Nabu)", source: "none" });
  const resolved = criteria.filter((c) => c.status === "corrected").map((c) => c.id);
  const unresolved = criteria.filter((c) => c.status === "unresolved").map((c) => c.id);
  const unverified = criteria.filter((c) => c.status === "changed").map((c) => c.id);
  const unassessed = [...unassessedAspects];
  let outcome: LogRevisionOutcome;
  if (review.taught.length === 0) outcome = "none-needed";
  else if (unchanged) outcome = "unchanged";
  else {
    const taughtEntries = criteria.filter((c) => review.taught.some((t) => t.id === c.id));
    outcome = taughtEntries.every((c) => c.status === "corrected") && introduced.length === 0 ? "revised" : resolved.length > 0 || unverified.length > 0 ? "partial" : "unchanged";
  }
  return { outcome, criteria, resolved, unresolved, unverified, introduced, unassessed, boundaries, copiedSuggestion };
}

export type RevisionEvidence = {
  /** Never a correctness claim: always null (assessment reset §6). */
  correct: null;
  /** Recorded in-app help for the corrected mechanical criteria: `independent` (none), `supported` (the suggestion was shown or copied); `unscored` when nothing was corrected or boundaries changed. */
  evidence: "independent" | "supported" | "unscored";
  /** Always names what was NOT assessed (propagated uncertainty). */
  uncertainty: string;
};

export function revisionEvidence(review: WritingReview, evaluation: LogRevisionEvaluation, helpShown: boolean): RevisionEvidence {
  const corrected = evaluation.criteria.filter((c) => c.status === "corrected").map((c) => writingAspectLabel(c.aspect));
  const unassessed = [...new Set(evaluation.criteria.filter((c) => c.status === "unassessed").map((c) => writingAspectLabel(c.aspect)))];
  const changed = evaluation.criteria.filter((c) => c.status === "changed").map((c) => c.id);
  const intro = evaluation.criteria.filter((c) => c.status === "introduced").map((c) => c.detail);
  const parts: string[] = [];
  parts.push(corrected.length ? `korrigiert: ${[...new Set(corrected)].join(", ")}` : "nichts korrigiert");
  if (changed.length) parts.push(`geändert, nicht erneut beurteilt: ${changed.join(", ")}`);
  if (intro.length) parts.push(`neu: ${intro.join("; ")}`);
  parts.push(unassessed.length ? `nicht beurteilt: ${unassessed.join(", ")}` : "alle gelehrten Stellen beurteilt");
  if (review.taught.length === 0) parts.unshift("an den geprüften Stellen nichts zu lehren");
  const boundary = evaluation.boundaries.joins.length > 0 || evaluation.boundaries.splits.length > 0;
  const copied = helpShown && evaluation.copiedSuggestion;
  const evidence: RevisionEvidence["evidence"] = corrected.length === 0 || boundary ? "unscored" : copied || helpShown ? "supported" : "independent";
  if (copied) parts.push("Vorschlag wörtlich kopiert");
  return { correct: null, evidence, uncertainty: parts.join(" · ") };
}
