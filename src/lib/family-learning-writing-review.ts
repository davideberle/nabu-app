// ---------------------------------------------------------------------------
// Writing review of the child's own German log sentence (Visit 5, content
// version 4; family-assistant DESIGN §7.6 "Visit 5 — the harbor", CONTRACT.md
// "October 10 — Visit 5", feedback group F2).
//
// Deterministic and deliberately bounded — this is NOT a grammar engine. It
// checks six reviewed aspects of ONE sentence against the reviewed lexicon the
// content carries (`writing.review`):
//   meaning         does the sentence speak about what was built/transported?
//   completeness    a subject and a verb
//   spacing         the three reviewed spacing cases (existing checker)
//   capitalization  the sentence start and the reviewed nouns
//   spelling        the reviewed common misspellings only
//   punctuation     an end mark
// It diagnoses broadly but TEACHES at most `maxTeachingPoints` points, in the
// content's priority order. A word it does not know is never rewritten or
// called wrong: it is listed for a clarification question. It never claims the
// whole sentence is right — the summary names exactly which aspects had no
// finding and says that nothing else was checked. Spoken text must not reach
// this module as spelling evidence (the caller passes only typed text).
// ---------------------------------------------------------------------------

import type { SpacingJoin, WritingReviewAspect, WritingReviewDef } from "./family-learning-content.ts";
import { evaluateRevision, flagSpacing, markSpacing, suggestSpacing, type SpacingFlag } from "./family-learning-writing.ts";

export type WritingFinding = {
  /** `<aspect>:<key>` — stable within one review (e.g. `spelling:ales`, `capitalization:boot`, `spacing:rule`). */
  id: string;
  aspect: WritingReviewAspect;
  /** The child's text at that place (word or marked sentence). */
  given: string;
  /** What the reviewed rule expects, or null when the child has to write it (meaning, completeness). */
  expected: string | null;
  /** Short child-facing teaching line (German). */
  teaching: string;
};

export type WritingReview = {
  original: string;
  /** Everything diagnosed, in priority order. */
  findings: WritingFinding[];
  /** The points taught this visit (≤ maxTeachingPoints), in priority order. */
  taught: WritingFinding[];
  /** Aspects with no finding — named, never summarised as "all correct". */
  clean: WritingReviewAspect[];
  /** Words the review does not know: asked about, never rewritten or scored. */
  unknownWords: string[];
  /** Whether the sentence names what was built/transported; null when unknown words make it undecidable. */
  taskFulfilled: boolean | null;
  /** The original with the TAUGHT mechanical points applied (spacing, capitalisation, spelling, end mark) — shown as help; null when nothing mechanical is taught. */
  suggestion: string | null;
  /** The original with `|` where a taught space is missing (spacing visual), or null. */
  marked: string | null;
  /** One honest child-facing summary line. */
  summary: string;
};

const ASPECT_LABEL: Record<WritingReviewAspect, string> = {
  meaning: "Inhalt",
  completeness: "ganzer Satz",
  spacing: "Leerzeichen",
  capitalization: "Grossschreibung",
  spelling: "Schreibweise",
  punctuation: "Satzzeichen",
};

export function writingAspectLabel(aspect: WritingReviewAspect): string {
  return ASPECT_LABEL[aspect];
}

const WORD = /[\p{L}\p{N}]+/gu;
const UPPER = /^\p{Lu}/u;
const END_MARK = /[.!?…]\s*$/u;

type Token = { raw: string; word: string; lower: string; index: number };

/** Words of the sentence with their position; punctuation stripped from `word`, the raw token kept. */
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

/** Review one typed sentence against the reviewed lexicon and rules. Pure; the same input yields the same review. */
export function reviewLogSentence(text: string, def: WritingReviewDef, joins: readonly SpacingJoin[]): WritingReview {
  const original = text.replace(/\s+/g, " ").trim();
  const tokens = tokenize(original);
  const nounForms = new Map<string, string>(); // lowercase form → capitalised reviewed form
  for (const n of def.nouns) for (const f of n.forms) nounForms.set(f.toLowerCase(), f);
  const misspelling = new Map<string, string | null>(def.misspellings.map((m) => [m.wrong, m.right]));
  const known = new Set<string>([...def.functionWords, ...def.verbs, ...def.subjects, ...def.taskWords]);
  const findings: WritingFinding[] = [];
  const unknown: string[] = [];

  // --- spelling (reviewed list only) and unknown words
  for (const t of tokens) {
    if (isNumeral(t.word)) continue;
    const right = misspelling.get(t.lower);
    if (right !== undefined) {
      if (right !== null && right.toLowerCase() !== t.lower) findings.push({ id: `spelling:${t.lower}`, aspect: "spelling", given: t.raw, expected: right, teaching: `„${t.raw}“ schreibt man „${right}“.` });
      continue;
    }
    if (known.has(t.lower) || nounForms.has(t.lower)) continue;
    // Capitalised words that are not reviewed nouns may be names (a base name, a person): unknown, asked, never flagged.
    if (!unknown.includes(t.raw)) unknown.push(t.raw);
  }

  // --- meaning: a task word (or a reviewed misspelling of one) is present
  const taskWords = def.taskWords;
  const speaksAboutTask = tokens.some((t) => {
    const forms = [t.lower, misspelling.get(t.lower)?.toLowerCase() ?? ""];
    return forms.some((w) => w && taskWords.some((tw) => w === tw || (tw.length >= 4 && w.startsWith(tw))));
  });
  const taskFulfilled: boolean | null = speaksAboutTask ? true : unknown.length > 0 ? null : false;
  if (taskFulfilled === false) findings.push({ id: "meaning:task", aspect: "meaning", given: original, expected: null, teaching: "Dein Satz sagt noch nicht, was gebaut oder transportiert wurde. Schreib es dazu — zum Beispiel die Boote, die Kisten oder den Hafen." });

  // --- completeness: a verb and a subject
  const verbs = new Set(def.verbs);
  const subjects = new Set(def.subjects);
  const hasVerb = tokens.some((t) => verbs.has(t.lower) || verbs.has(misspelling.get(t.lower)?.toLowerCase() ?? ""));
  const hasSubject = tokens.some((t) => subjects.has(t.lower) || nounForms.has(t.lower) || (UPPER.test(t.raw) && !verbs.has(t.lower)) || isNumeral(t.word));
  if (!hasVerb) findings.push({ id: "completeness:verb", aspect: "completeness", given: original, expected: null, teaching: "Ein ganzer Satz braucht ein Tun-Wort — zum Beispiel: haben … gebaut, haben … geladen, ist, sind." });
  else if (!hasSubject) findings.push({ id: "completeness:subject", aspect: "completeness", given: original, expected: null, teaching: "Wer hat es gemacht? Schreib dazu, wer: ich, wir, das Team …" });

  // --- spacing: the three reviewed cases
  const flags: SpacingFlag[] = flagSpacing(original, joins);
  if (flags.length) findings.push({ id: "spacing:rule", aspect: "spacing", given: markSpacing(original, flags), expected: suggestSpacing(original, flags), teaching: `Zwischen Wörtern, und zwischen Wort und Zahl, kommt ein Leerzeichen. An ${flags.length} ${flags.length === 1 ? "Stelle" : "Stellen"} fehlt eins — der Strich zeigt wo.` });

  // --- capitalisation: the sentence start and the reviewed nouns
  if (tokens.length && !isNumeral(tokens[0].word) && !UPPER.test(tokens[0].raw)) findings.push({ id: "capitalization:start", aspect: "capitalization", given: tokens[0].raw, expected: capitalise(tokens[0].raw), teaching: `Ein Satz beginnt gross: „${capitalise(tokens[0].raw)}“.` });
  for (const t of tokens) {
    const reviewed = nounForms.get(t.lower);
    if (reviewed && !UPPER.test(t.raw) && !findings.some((f) => f.id === `capitalization:${t.lower}`)) findings.push({ id: `capitalization:${t.lower}`, aspect: "capitalization", given: t.raw, expected: reviewed, teaching: `„${reviewed}“ ist ein Namenwort — Namenwörter schreibt man gross.` });
  }

  // --- punctuation: an end mark
  if (original && !END_MARK.test(original)) findings.push({ id: "punctuation:end", aspect: "punctuation", given: original, expected: `${original}.`, teaching: "Am Ende des Satzes steht ein Punkt." });

  // --- priority, teaching selection, clean aspects
  const rank = (a: WritingReviewAspect) => def.priority.indexOf(a);
  findings.sort((a, b) => rank(a.aspect) - rank(b.aspect));
  const taught: WritingFinding[] = [];
  const taughtAspects = new Set<WritingReviewAspect>();
  for (const f of findings) {
    if (taughtAspects.has(f.aspect)) {
      // One teaching point per aspect; its further instances ride along (the suggestion applies all of them).
      taught.push(f);
      continue;
    }
    if (taughtAspects.size >= def.maxTeachingPoints) continue;
    taughtAspects.add(f.aspect);
    taught.push(f);
  }
  const clean = def.priority.filter((a) => !findings.some((f) => f.aspect === a) && !(a === "meaning" && taskFulfilled === null));

  // --- suggestion: the taught MECHANICAL points applied to the original (never meaning/completeness — the child writes those)
  let suggestion: string | null = null;
  const mechanical = taught.filter((f) => f.aspect === "spacing" || f.aspect === "capitalization" || f.aspect === "spelling" || f.aspect === "punctuation");
  if (mechanical.length) {
    let s = original;
    if (taughtAspects.has("spelling")) for (const f of mechanical.filter((x) => x.aspect === "spelling")) s = s.replace(new RegExp(`(^|[^\\p{L}])${escape(f.given)}(?=$|[^\\p{L}])`, "gu"), `$1${f.expected ?? f.given}`);
    if (taughtAspects.has("capitalization")) for (const f of mechanical.filter((x) => x.aspect === "capitalization")) s = s.replace(new RegExp(`(^|[^\\p{L}])${escape(f.given)}(?=$|[^\\p{L}])`, "gu"), `$1${f.expected ?? f.given}`);
    if (taughtAspects.has("spacing")) s = suggestSpacing(s, flagSpacing(s, joins));
    if (taughtAspects.has("punctuation") && !END_MARK.test(s)) s = `${s}.`;
    suggestion = s === original ? null : s;
  }
  const marked = taughtAspects.has("spacing") ? markSpacing(original, flags) : null;

  // --- summary (German, honest): what had no finding, what is taught, what is asked, what was not checked
  const parts: string[] = [];
  if (clean.length) parts.push(`Geprüft und in Ordnung: ${clean.map((a) => ASPECT_LABEL[a]).join(", ")}.`);
  if (taughtAspects.size) parts.push(`Heute schauen wir an: ${[...taughtAspects].map((a) => ASPECT_LABEL[a]).join(" und ")}.`);
  const notTaught = findings.filter((f) => !taughtAspects.has(f.aspect)).map((f) => f.aspect);
  if (notTaught.length) parts.push(`${[...new Set(notTaught)].map((a) => ASPECT_LABEL[a]).join(", ")} ${new Set(notTaught).size === 1 ? "kommt" : "kommen"} ein andermal.`);
  if (unknown.length) parts.push(`Ein Wort kenne ich nicht: ${unknown.map((w) => `„${w}“`).join(", ")} — sag mir, was du meinst.`);
  parts.push("Alles andere habe ich nicht geprüft.");

  return { original, findings, taught, clean, unknownWords: unknown, taskFulfilled, suggestion, marked, summary: parts.join(" ") };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type LogRevisionOutcome = "revised" | "partial" | "unchanged" | "none-needed";

export type LogRevisionEvaluation = {
  outcome: LogRevisionOutcome;
  /** Taught findings resolved in the revision (by id). */
  resolved: string[];
  /** Taught findings still present. */
  unresolved: string[];
  /** Findings of the revision that were not in the original (shown, never scored as the child's mistake). */
  introduced: string[];
  /** Whether the revision is the suggestion copied verbatim (copying, never independent). */
  copiedSuggestion: boolean;
};

/**
 * Evaluate the child's revision against the TAUGHT points only: a point is resolved when the revised sentence no longer
 * carries that finding (spacing: the original flags are resolved by the alignment rule of the spacing checker).
 * Unchanged text never counts as a fix; new findings are listed apart.
 */
export function evaluateLogRevision(review: WritingReview, revised: string, def: WritingReviewDef, joins: readonly SpacingJoin[]): LogRevisionEvaluation {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const text = norm(revised);
  const copiedSuggestion = review.suggestion !== null && norm(review.suggestion).toLowerCase() === text.toLowerCase();
  if (review.taught.length === 0) return { outcome: "none-needed", resolved: [], unresolved: [], introduced: [], copiedSuggestion };
  if (text.toLowerCase() === review.original.toLowerCase() && text === review.original) return { outcome: "unchanged", resolved: [], unresolved: review.taught.map((f) => f.id), introduced: [], copiedSuggestion: false };
  const after = reviewLogSentence(text, def, joins);
  const afterIds = new Set(after.findings.map((f) => f.id));
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const f of review.taught) {
    let fixed: boolean;
    if (f.aspect === "spacing") {
      const flags = flagSpacing(review.original, joins);
      fixed = evaluateRevision(review.original, text, flags).resolved === flags.length && !afterIds.has("spacing:rule");
    } else fixed = !afterIds.has(f.id);
    (fixed ? resolved : unresolved).push(f.id);
  }
  const beforeIds = new Set(review.findings.map((f) => f.id));
  const introduced = after.findings.filter((f) => !beforeIds.has(f.id)).map((f) => f.id);
  const outcome: LogRevisionOutcome = unresolved.length === 0 ? "revised" : resolved.length > 0 ? "partial" : "unchanged";
  return { outcome, resolved, unresolved, introduced, copiedSuggestion };
}
