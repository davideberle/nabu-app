// ---------------------------------------------------------------------------
// Alignment-aware typing metrics (approved redesign 2026-09-29, F1/T4).
//
// Metric version 2. The typed text is aligned to the target with a standard
// edit-distance alignment (unit cost for insertion, omission and
// substitution), so ONE inserted character does not turn every later correct
// character into an error, and one omission does not either. Per line:
//   correctChars     aligned matches
//   substitutedChars aligned but different characters
//   extraChars       typed characters with no target counterpart (insertions)
//   omittedChars     target characters never typed
// Tie-breaking is fixed and documented: the alignment is traced from the
// START of the line (suffix costs), preferring match, then substitution,
// then insertion (extra), then omission — so a wrong character is read as a
// substitution at the earliest position, never pushed to the end. The per-line
// denominator keeps the existing convention max(expected, typed), summed over
// lines, so insertions on one line never cancel omissions on another.
//
// Final-text accuracy measures the finished line, not initial keystrokes that
// were backspaced; it says nothing about finger technique. Pure and shared by
// the server (authoritative) and the client (preview).
// ---------------------------------------------------------------------------

export const TYPING_METRIC_VERSION = 2 as const;

export type AlignedLineMetrics = {
  expectedChars: number;
  typedChars: number;
  correctChars: number;
  extraChars: number;
  omittedChars: number;
  substitutedChars: number;
  metricVersion: typeof TYPING_METRIC_VERSION;
};

export type AlignmentOp = { kind: "match" | "substitute" | "extra" | "omit"; expected: string | null; typed: string | null };

/** Align `typed` to `expected` and count each category once. */
export function alignTyping(expected: string, typed: string): AlignedLineMetrics & { ops: AlignmentOp[] } {
  const e = Array.from(expected);
  const t = Array.from(typed);
  const n = e.length;
  const m = t.length;
  // dp[i][j] = minimal cost aligning the suffixes e[i..) and t[j..)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) dp[i][m] = n - i;
  for (let j = m - 1; j >= 0; j -= 1) dp[n][j] = m - j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const same = e[i] === t[j];
      dp[i][j] = Math.min(dp[i + 1][j + 1] + (same ? 0 : 1), dp[i][j + 1] + 1, dp[i + 1][j] + 1);
    }
  }
  // Forward trace with fixed preference: match, substitution, extra (typed insertion), omission.
  const ops: AlignmentOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && e[i] === t[j] && dp[i][j] === dp[i + 1][j + 1]) {
      ops.push({ kind: "match", expected: e[i], typed: t[j] });
      i += 1;
      j += 1;
    } else if (i < n && j < m && dp[i][j] === dp[i + 1][j + 1] + 1) {
      ops.push({ kind: "substitute", expected: e[i], typed: t[j] });
      i += 1;
      j += 1;
    } else if (j < m && dp[i][j] === dp[i][j + 1] + 1) {
      ops.push({ kind: "extra", expected: null, typed: t[j] });
      j += 1;
    } else {
      ops.push({ kind: "omit", expected: e[i], typed: null });
      i += 1;
    }
  }
  let correct = 0;
  let substituted = 0;
  let extra = 0;
  let omitted = 0;
  for (const op of ops) {
    if (op.kind === "match") correct += 1;
    else if (op.kind === "substitute") substituted += 1;
    else if (op.kind === "extra") extra += 1;
    else omitted += 1;
  }
  return { expectedChars: n, typedChars: m, correctChars: correct, extraChars: extra, omittedChars: omitted, substitutedChars: substituted, metricVersion: TYPING_METRIC_VERSION, ops };
}

/** Per-line denominator convention: max(expected, typed). */
export function lineDenominator(m: { expectedChars: number; typedChars: number }): number {
  return Math.max(m.expectedChars, m.typedChars);
}

export type AlignedLessonMetrics = {
  lines: AlignedLineMetrics[];
  expectedChars: number;
  typedChars: number;
  correctChars: number;
  extraChars: number;
  omittedChars: number;
  substitutedChars: number;
  /** Σ max(expected_i, typed_i). */
  denominator: number;
  accuracy: number;
  metricVersion: typeof TYPING_METRIC_VERSION;
};

/** Aggregate per-line aligned metrics without cancellation between lines. */
export function alignedLessonMetrics(expectedLines: readonly string[], typedLines: readonly string[]): AlignedLessonMetrics {
  const lines = expectedLines.map((expected, i) => {
    const { ops: _ops, ...metrics } = alignTyping(expected, typedLines[i] ?? "");
    return metrics;
  });
  const sum = (f: (l: AlignedLineMetrics) => number) => lines.reduce((n, l) => n + f(l), 0);
  const denominator = lines.reduce((n, l) => n + lineDenominator(l), 0);
  const correctChars = sum((l) => l.correctChars);
  return {
    lines,
    expectedChars: sum((l) => l.expectedChars),
    typedChars: sum((l) => l.typedChars),
    correctChars,
    extraChars: sum((l) => l.extraChars),
    omittedChars: sum((l) => l.omittedChars),
    substitutedChars: sum((l) => l.substitutedChars),
    denominator,
    accuracy: denominator ? correctChars / denominator : 0,
    metricVersion: TYPING_METRIC_VERSION,
  };
}

/**
 * The next target character the child should type, given what was typed so
 * far on the current line (alignment-aware: after an insertion the guidance
 * still points at the right next key instead of drifting).
 */
export function nextExpectedChar(expected: string, typedSoFar: string): string | null {
  const { ops } = alignTyping(expected, typedSoFar);
  let consumed = 0;
  for (const op of ops) if (op.kind === "match" || op.kind === "substitute" || op.kind === "omit") consumed += 1;
  // Omissions at the end are "not yet typed": count only omissions before the last typed char.
  let trailingOmits = 0;
  for (let i = ops.length - 1; i >= 0 && ops[i].kind === "omit"; i -= 1) trailingOmits += 1;
  const index = consumed - trailingOmits;
  const chars = Array.from(expected);
  return index < chars.length ? chars[index] : null;
}
