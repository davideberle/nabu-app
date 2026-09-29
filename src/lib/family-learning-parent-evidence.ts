// ---------------------------------------------------------------------------
// Parent evidence orchestration (review R5-1) and typing-metric display (R5-2).
//
// The evidence shown for a child must be that child's own, current bundle:
//  - selecting a child invalidates whatever is shown at once (no evidence is
//    rendered until that child's bundle arrives);
//  - every load carries a request sequence; a response is adopted only if it
//    is the latest request, its bundle names the selected child, and its
//    erasure generation does not regress the one already shown for that child
//    (an older response can never overwrite a newer post-deletion refresh);
//  - the form's draft is bound to the bundle's own child/generation, never to
//    the selection alone.
// Pure so the orderings are unit-tested; the component just applies it.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";

export type EvidenceIdentity = { child: ChildId; erasureGeneration: number };

export type EvidenceStore<B extends EvidenceIdentity> = {
  selected: ChildId;
  /** Evidence currently shown — always for `selected`, or null while loading. */
  shown: B | null;
  /** Sequence of the latest request issued for `selected`. */
  latestRequest: number;
  /** Highest generation adopted per child (fence against regressing responses). */
  seenGeneration: Partial<Record<ChildId, number>>;
  /**
   * Authorization epoch. Bumped by `invalidateAuthorization` the moment the
   * server refuses (401/403) or the session is lost; every operation captures
   * the epoch it started under and its result is dropped if the epoch moved.
   */
  authEpoch: number;
  /** True after an invalidation until a fresh response is adopted again. */
  denied: boolean;
};

export function createEvidenceStore<B extends EvidenceIdentity>(selected: ChildId): EvidenceStore<B> {
  return { selected, shown: null, latestRequest: 0, seenGeneration: {}, authEpoch: 0, denied: false };
}

/**
 * The session is no longer authorized (server said 401/403, or sign-out was
 * detected). Everything shown disappears, the per-child generation fences are
 * forgotten (a fresh owner session must re-read), the request sequence is
 * advanced so EVERY outstanding evidence response is superseded, and the
 * authorization epoch moves so pending settings/correction/deletion handlers
 * drop their results too. Data cleared here can never come back from a
 * response that was fetched before the invalidation.
 */
export function invalidateAuthorization<B extends EvidenceIdentity>(store: EvidenceStore<B>): EvidenceStore<B> {
  return { ...store, shown: null, seenGeneration: {}, latestRequest: store.latestRequest + 1, authEpoch: store.authEpoch + 1, denied: true };
}

/** Whether an operation started under `epoch` may still apply its result. */
export function isCurrentEpoch<B extends EvidenceIdentity>(store: EvidenceStore<B>, epoch: number): boolean {
  return store.authEpoch === epoch;
}

/** Select a child: stale evidence disappears immediately. */
export function selectChild<B extends EvidenceIdentity>(store: EvidenceStore<B>, child: ChildId): EvidenceStore<B> {
  if (child === store.selected) return store;
  return { ...store, selected: child, shown: null };
}

/** Issue a load for the selected child; returns the sequence to pass to `receive`. */
export function beginRequest<B extends EvidenceIdentity>(store: EvidenceStore<B>): { store: EvidenceStore<B>; seq: number } {
  const seq = store.latestRequest + 1;
  return { store: { ...store, latestRequest: seq }, seq };
}

export type ReceiveOutcome = "adopted" | "ignored-superseded" | "ignored-wrong-child" | "ignored-regressed-generation";

/** Adopt a response only when it is current, for the selected child, and not older than what was shown. */
export function receiveEvidence<B extends EvidenceIdentity>(store: EvidenceStore<B>, seq: number, bundle: B): { store: EvidenceStore<B>; outcome: ReceiveOutcome } {
  if (seq !== store.latestRequest) return { store, outcome: "ignored-superseded" };
  if (bundle.child !== store.selected) return { store, outcome: "ignored-wrong-child" };
  const seen = store.seenGeneration[bundle.child];
  if (seen !== undefined && bundle.erasureGeneration < seen) return { store, outcome: "ignored-regressed-generation" };
  return {
    store: { ...store, shown: bundle, seenGeneration: { ...store.seenGeneration, [bundle.child]: bundle.erasureGeneration }, denied: false },
    outcome: "adopted",
  };
}

/** A load failed or the view was locked: nothing is shown for the selected child. */
export function clearEvidence<B extends EvidenceIdentity>(store: EvidenceStore<B>, seq: number): EvidenceStore<B> {
  if (seq !== store.latestRequest) return store;
  return { ...store, shown: null };
}

/** Evidence is renderable only when it is the selected child's own bundle. */
export function renderableEvidence<B extends EvidenceIdentity>(store: EvidenceStore<B>): B | null {
  return store.shown && store.shown.child === store.selected ? store.shown : null;
}

// ---------------------------------------------------------------------------
// Typing metrics display (R5-2): respect the stored per-line denominator.
// ---------------------------------------------------------------------------

export type StoredTypingMetrics = {
  expectedChars: number;
  typedChars?: number;
  correctChars: number;
  extraChars?: number;
  omittedChars?: number;
  /** Σ max(expected_i, typed_i) for lessons; absent on single-label records. */
  denominator?: number;
  seconds?: number;
};

export type TypingMetricsDisplay = {
  percent: number;
  correct: number;
  denominator: number;
  expected: number;
  extra: number;
  omitted: number;
  /** "stored" when the record carries its per-line denominator; "single" otherwise. */
  basis: "stored" | "single";
};

/**
 * Accuracy for display. A lesson record carries `denominator` (Σ per-line
 * max) and is shown as correct/denominator; a single-label (or legacy) record
 * without it uses max(expected, typed). Never inflates: with the stored
 * denominator 33/37 renders 89 %, not 94 %.
 */
export function formatTypingMetrics(m: StoredTypingMetrics): TypingMetricsDisplay {
  const expected = Number(m.expectedChars) || 0;
  const typed = typeof m.typedChars === "number" ? m.typedChars : expected;
  const correct = Number(m.correctChars) || 0;
  const stored = typeof m.denominator === "number" && Number.isFinite(m.denominator) && m.denominator > 0;
  const denominator = stored ? (m.denominator as number) : Math.max(expected, typed);
  const extra = typeof m.extraChars === "number" ? m.extraChars : Math.max(0, typed - expected);
  const omitted = typeof m.omittedChars === "number" ? m.omittedChars : Math.max(0, expected - typed);
  return { percent: denominator ? Math.round((correct / denominator) * 100) : 0, correct, denominator, expected, extra, omitted, basis: stored ? "stored" : "single" };
}

/** German explanatory line; the fraction always matches the denominator used. */
export function describeTypingMetrics(m: StoredTypingMetrics): string {
  const d = formatTypingMetrics(m);
  const parts = [`${d.correct} von ${d.denominator} richtig`];
  if (d.denominator !== d.expected) parts.push(`${d.expected} erwartet`);
  if (d.extra > 0) parts.push(`${d.extra} zu viel`);
  if (d.omitted > 0) parts.push(`${d.omitted} fehlen`);
  return `Genauigkeit ${d.percent}% (${parts.join(", ")})`;
}
