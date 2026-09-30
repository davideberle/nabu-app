// Alignment-aware typing metrics (redesign F1/T4) and bounded spacing feedback (F2/W1–W2).
// Run with: npm test

import { deepStrictEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { alignTyping, alignedLessonMetrics, nextExpectedChar } from "./family-learning-typing-metrics.ts";
import { evaluateRevision, flagSpacing, markSpacing, suggestSpacing } from "./family-learning-writing.ts";

const strip = (m: ReturnType<typeof alignTyping>) => {
  const { ops: _ops, metricVersion: _v, ...rest } = m;
  return rest;
};

describe("alignTyping — one real error per real error", () => {
  it("exact text", () => {
    deepStrictEqual(strip(alignTyping("abc", "abc")), { expectedChars: 3, typedChars: 3, correctChars: 3, extraChars: 0, omittedChars: 0, substitutedChars: 0 });
  });
  it("internal insertion keeps the shifted suffix correct (independent reviewer probe)", () => {
    deepStrictEqual(strip(alignTyping("abc", "axbc")), { expectedChars: 3, typedChars: 4, correctChars: 3, extraChars: 1, omittedChars: 0, substitutedChars: 0 });
  });
  it("omission keeps the aligned letters (independent reviewer probe)", () => {
    deepStrictEqual(strip(alignTyping("abc", "ac")), { expectedChars: 3, typedChars: 2, correctChars: 2, extraChars: 0, omittedChars: 1, substitutedChars: 0 });
  });
  it("missing space: two aligned letters and one missing space (independent reviewer probe)", () => {
    deepStrictEqual(strip(alignTyping("a b", "ab")), { expectedChars: 3, typedChars: 2, correctChars: 2, extraChars: 0, omittedChars: 1, substitutedChars: 0 });
  });
  it("substitution, trailing extra, doubled space, empty text, repeated characters", () => {
    deepStrictEqual(strip(alignTyping("abc", "abd")), { expectedChars: 3, typedChars: 3, correctChars: 2, extraChars: 0, omittedChars: 0, substitutedChars: 1 });
    deepStrictEqual(strip(alignTyping("abc", "abcZZ")), { expectedChars: 3, typedChars: 5, correctChars: 3, extraChars: 2, omittedChars: 0, substitutedChars: 0 });
    deepStrictEqual(strip(alignTyping("a b", "a  b")), { expectedChars: 3, typedChars: 4, correctChars: 3, extraChars: 1, omittedChars: 0, substitutedChars: 0 });
    deepStrictEqual(strip(alignTyping("abc", "")), { expectedChars: 3, typedChars: 0, correctChars: 0, extraChars: 0, omittedChars: 3, substitutedChars: 0 });
    deepStrictEqual(strip(alignTyping("", "abc")), { expectedChars: 0, typedChars: 3, correctChars: 0, extraChars: 3, omittedChars: 0, substitutedChars: 0 });
    deepStrictEqual(strip(alignTyping("fff jjj", "ffff jjj")), { expectedChars: 7, typedChars: 8, correctChars: 7, extraChars: 1, omittedChars: 0, substitutedChars: 0 });
  });
  it("the live label case: 13 target characters, one internal extra and a final period", () => {
    const m = alignTyping("Sonnenkueste!", "Sonnenkuueste!.");
    equal(m.correctChars, 13);
    equal(m.extraChars, 2);
    equal(m.omittedChars, 0);
  });
  it("mixed insertion and omission across lines never cancel; denominator keeps Σ max(expected, typed)", () => {
    const m = alignedLessonMetrics(["abc", "def"], ["axbc", "df"]);
    equal(m.correctChars, 5);
    equal(m.extraChars, 1);
    equal(m.omittedChars, 1);
    equal(m.denominator, 7);
    equal(m.metricVersion, 2);
    equal(Math.round(m.accuracy * 100), 71);
  });
  it("next expected character stays right after an insertion", () => {
    equal(nextExpectedChar("fff jjj", "fff"), " ");
    // A wrong character is read as a substitution at its position; the next key follows it.
    equal(nextExpectedChar("fff jjj", "fffx"), "j");
    equal(nextExpectedChar("fff jjj", "fff j"), "j");
    equal(nextExpectedChar("fff jjj", "fff jjj"), null);
  });
});

const joins = [
  { joined: "ichhabe", split: "ich habe" },
  { joined: "undich", split: "und ich" },
];

describe("spacing feedback — reviewed cases only", () => {
  it("flags the observed log fragment and suggests the spaced form without touching spelling", () => {
    const text = "Ichhabe2Schildkroten gesehen.";
    const flags = flagSpacing(text, joins);
    deepStrictEqual(flags.map((f) => [f.index, f.rule]), [[3, "reviewed-join"], [7, "digit-boundary"], [8, "digit-boundary"]]);
    equal(suggestSpacing(text, flags), "Ich habe 2 Schildkroten gesehen.");
    equal(markSpacing(text, flags), "Ich|habe|2|Schildkroten gesehen.");
  });
  it("punctuation boundary and a join at a word boundary only", () => {
    deepStrictEqual(flagSpacing("Da.Dann kam undich.", joins).map((f) => [f.index, f.rule]), [[3, "punctuation-boundary"], [15, "reviewed-join"]]);
    deepStrictEqual(flagSpacing("Der Mundichter", joins), [], "a join inside a longer word is not flagged");
    deepStrictEqual(flagSpacing("Wir haben 2 Schildkröten gesehen.", joins), [], "correct text has no flags");
  });
  it("unchanged text earns no praise; partial and full corrections are counted honestly", () => {
    const text = "Ichhabe2Schildkroten gesehen.";
    const flags = flagSpacing(text, joins);
    equal(evaluateRevision(text, text, flags).outcome, "unchanged");
    equal(evaluateRevision(text, "Ichhabe 2 Schildkroten gesehen.", flags).outcome, "partial");
    equal(evaluateRevision(text, "Ichhabe 2 Schildkroten gesehen.", flags).resolved, 2);
    equal(evaluateRevision(text, "Ich habe 2 Schildkroten gesehen.", flags).outcome, "revised");
    // A different spelling in the revision is not judged by this step.
    equal(evaluateRevision(text, "Ich habe 2 Schildkröten gesehen.", flags).outcome, "revised");
    equal(evaluateRevision("Alles gut.", "Alles gut.", []).outcome, "no-flags");
  });
});
