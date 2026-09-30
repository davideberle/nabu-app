// ---------------------------------------------------------------------------
// Bounded spacing feedback for the child's own log sentence (approved
// redesign 2026-09-29, F2/W1–W3).
//
// Deterministic and deliberately narrow — this is NOT a German
// word-segmentation engine. It flags exactly three reviewed kinds of missing
// space in the child's text:
//   digit-boundary        a letter directly next to a digit  ("habe2Schild")
//   punctuation-boundary  a letter directly after . ! ? ,    ("da.Dann")
//   reviewed-join         a join from the content's reviewed list ("Ichhabe")
// Anything else is left alone and never called an error. Spelling is never
// touched here (e.g. "Schildkroten" stays as typed); it is a separate lesson.
//
// The original text is always preserved by the caller; the child edits a
// suggestion and the server compares the revision against the flags without
// praising unchanged text.
// ---------------------------------------------------------------------------

import type { SpacingJoin } from "./family-learning-content.ts";
import { alignTyping } from "./family-learning-typing-metrics.ts";

export type SpacingRule = "digit-boundary" | "punctuation-boundary" | "reviewed-join";

/** A place in the ORIGINAL text (index of the character before which a space belongs). */
export type SpacingFlag = { index: number; rule: SpacingRule; before: string; after: string };

const LETTER = /[\p{L}]/u;
const DIGIT = /[0-9]/;

/** Flags for the reviewed spacing cases, ordered by position, deduplicated by index. */
export function flagSpacing(text: string, joins: readonly SpacingJoin[]): SpacingFlag[] {
  const chars = Array.from(text);
  const flags = new Map<number, SpacingFlag>();
  const add = (index: number, rule: SpacingRule) => {
    if (index <= 0 || index >= chars.length || flags.has(index)) return;
    flags.set(index, { index, rule, before: chars[index - 1], after: chars[index] });
  };
  for (let i = 1; i < chars.length; i += 1) {
    const a = chars[i - 1];
    const b = chars[i];
    if ((LETTER.test(a) && DIGIT.test(b)) || (DIGIT.test(a) && LETTER.test(b))) add(i, "digit-boundary");
    if (/[.!?,]/.test(a) && LETTER.test(b)) add(i, "punctuation-boundary");
  }
  // Reviewed joins: match the lowercase join anywhere at a word boundary and
  // flag each internal split position.
  const lower = chars.map((c) => c.toLowerCase());
  for (const join of joins) {
    const j = Array.from(join.joined.toLowerCase());
    const splitParts = join.split.toLowerCase().split(" ");
    for (let start = 0; start + j.length <= chars.length; start += 1) {
      let ok = true;
      for (let k = 0; k < j.length; k += 1) if (lower[start + k] !== j[k]) { ok = false; break; }
      if (!ok) continue;
      const beforeOk = start === 0 || !LETTER.test(chars[start - 1]);
      const afterOk = start + j.length === chars.length || !LETTER.test(chars[start + j.length]);
      if (!beforeOk || !afterOk) continue;
      let offset = start;
      for (let p = 0; p < splitParts.length - 1; p += 1) {
        offset += Array.from(splitParts[p]).length;
        add(offset, "reviewed-join");
      }
    }
  }
  return [...flags.values()].sort((a, b) => a.index - b.index);
}

/**
 * Assessment of a text against the three reviewed cases (R3-1): every place
 * where a reviewed boundary actually occurs, either correctly spaced or
 * missing. `assessed` = correct + flagged. A text with no reviewed boundary at
 * all (e.g. "Hallo", "xyz", or an unreviewed join like
 * "Diemorgensonneistwarm") is UNASSESSABLE: nothing can be credited.
 */
export type SpacingAssessment = { assessed: number; correct: number; flags: SpacingFlag[]; assessable: boolean };

export function assessSpacing(text: string, joins: readonly SpacingJoin[]): SpacingAssessment {
  const flags = flagSpacing(text, joins);
  const chars = Array.from(text);
  let correct = 0;
  // Digit and punctuation boundaries that ARE spaced: letter␣digit, digit␣letter, [.!?,]␣letter.
  for (let i = 2; i < chars.length; i += 1) {
    if (chars[i - 1] !== " ") continue;
    const a = chars[i - 2];
    const b = chars[i];
    if ((LETTER.test(a) && DIGIT.test(b)) || (DIGIT.test(a) && LETTER.test(b))) correct += 1;
    else if (/[.!?,]/.test(a) && LETTER.test(b)) correct += 1;
  }
  // Reviewed joins written correctly as separate words ("ich habe"), word-bounded, case-insensitive.
  const lower = text.toLowerCase();
  for (const join of joins) {
    const parts = join.split.toLowerCase().split(" ");
    const pattern = new RegExp(`(^|[^\\p{L}])${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(" ")}(?=$|[^\\p{L}])`, "gu");
    const hits = lower.match(pattern);
    if (hits) correct += hits.length * (parts.length - 1);
  }
  const assessed = correct + flags.length;
  return { assessed, correct, flags, assessable: assessed > 0 };
}

/** The original text with a space inserted at every flag — the child-facing suggestion. */
export function suggestSpacing(text: string, flags: readonly SpacingFlag[]): string {
  const chars = Array.from(text);
  const marks = new Set(flags.map((f) => f.index));
  let out = "";
  chars.forEach((c, i) => {
    if (marks.has(i)) out += " ";
    out += c;
  });
  return out;
}

/** Child-facing pointer: the text with "|" where a space is missing. */
export function markSpacing(text: string, flags: readonly SpacingFlag[]): string {
  const chars = Array.from(text);
  const marks = new Set(flags.map((f) => f.index));
  let out = "";
  chars.forEach((c, i) => {
    if (marks.has(i)) out += "|";
    out += c;
  });
  return out;
}

export type RevisionOutcome = "revised" | "partial" | "unchanged" | "no-flags";

/**
 * Compare a revision with the flags of the ORIGINAL by ALIGNING the two texts
 * character by character (the same edit-distance alignment as the typing
 * metric, case-insensitive, whitespace normalised). A flag is resolved only
 * when both characters next to its boundary survive in the revision as the
 * same characters and exactly one space now stands between them. Because
 * every original character maps to at most one revised position, each
 * original occurrence is judged on its own: fixing the first of two
 * identical sentences never satisfies the second, and fixing the join in
 * the second never steals the digit boundaries of the first (independent
 * repair R2-1). Reordered, deleted or rewritten material simply leaves its
 * boundaries unresolved — never counted as a fix. Unchanged text can never
 * count as a fix. "no-flags" means only that none of the reviewed cases was
 * detected, never that the spacing is globally right.
 */
export function evaluateRevision(original: string, revised: string, flags: readonly SpacingFlag[]): { resolved: number; total: number; outcome: RevisionOutcome; unresolved: SpacingFlag[] } {
  const total = flags.length;
  if (total === 0) return { resolved: 0, total: 0, outcome: "no-flags", unresolved: [] };
  const normalizedOriginal = original.replace(/\s+/g, " ").trim();
  const normalizedRevised = revised.replace(/\s+/g, " ").trim();
  if (normalizedOriginal === normalizedRevised) return { resolved: 0, total, outcome: "unchanged", unresolved: [...flags] };
  const { ops } = alignTyping(original.toLowerCase(), normalizedRevised.toLowerCase());
  const revisedChars = Array.from(normalizedRevised);
  // Position of every ORIGINAL character in the revision (null = omitted or replaced).
  const posOf: (number | null)[] = [];
  let oi = 0;
  let ri = 0;
  for (const op of ops) {
    if (op.kind === "match") {
      posOf[oi] = ri;
      oi += 1;
      ri += 1;
    } else if (op.kind === "substitute") {
      posOf[oi] = null;
      oi += 1;
      ri += 1;
    } else if (op.kind === "extra") {
      ri += 1;
    } else {
      posOf[oi] = null;
      oi += 1;
    }
  }
  const unresolved: SpacingFlag[] = [];
  for (const flag of flags) {
    const a = posOf[flag.index - 1] ?? null;
    const b = posOf[flag.index] ?? null;
    const fixed = a !== null && b !== null && b - a === 2 && revisedChars[a + 1] === " ";
    if (!fixed) unresolved.push(flag);
  }
  const resolved = total - unresolved.length;
  return { resolved, total, outcome: resolved === total ? "revised" : resolved > 0 ? "partial" : "unchanged", unresolved };
}
