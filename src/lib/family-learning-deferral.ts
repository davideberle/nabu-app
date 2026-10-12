// ---------------------------------------------------------------------------
// Temporary Visit 5 scope reduction (owner decision 2026-10-11 12:44, while the
// child-tutor runtime replacement is pending): in the harbor visit the LIVE
// reasoning conversation and the LIVE semantic writing review are deferred.
// Everything else stays: arithmetic with its numeric-answer-vs-help record,
// the required planning and typing work, the Spanish tasks, the dictionaries,
// the built-in hints, the fresh check, the captain's log with its mechanical
// review and revision, the child report and the parent review.
//
// This is deliberately NOT a capability framework: one visit-scoped rule,
// consulted by the state machine (the `explain` stage is passed with the
// explicit, non-child skip reason `deferred`; the writing review carries no
// semantic dispatch; free questions are refused for the running visit), by the
// view (no pending dispatch) and by the two UI spots that must say so. The full
// tutor code stays in place for the later integration; unit suites that
// exercise it switch the rule off through the explicit test-only override.
// A deferred stage is never "skipped by the child", never caught up, never
// credited and never scored — "nicht beurteilt", not "nicht geschafft".
// ---------------------------------------------------------------------------

/** Visits whose live tutor hops are deferred. Visit-scoped on purpose. */
export const LIVE_TUTOR_DEFERRED_VISITS: ReadonlySet<string> = new Set(["v6"]);

let testOverride: boolean | null = null;

/** Whether the live tutor (reasoning conversation, semantic writing review, free question) is deferred for a visit. */
export function liveTutorDeferred(visitId: string | null | undefined): boolean {
  if (testOverride !== null) return testOverride;
  return typeof visitId === "string" && LIVE_TUTOR_DEFERRED_VISITS.has(visitId);
}

/** Unit tests only: keep exercising the full tutor path (`false`) or force the deferral (`true`); `null` restores the rule. Never called by app code. */
export function setLiveTutorDeferredForTests(value: boolean | null): void {
  testOverride = value;
}

/** The one plain line the child sees where a live hop would have been. */
export const LIVE_TUTOR_DEFERRED_CHILD_NOTICE = "In diesem Besuch gibt es gerade kein Gespräch mit Nabu. Die Aufgaben gehen ohne weiter.";
/** The child report's one scope sentence for a FRESH deferred visit (nothing was ever assessed). */
export const LIVE_TUTOR_DEFERRED_REPORT_SCOPE = "Rechenweg, Inhalt und Satzbau wurden heute nicht beurteilt.";
/**
 * The child report's scope sentence derived from the visit's OWN evidence (round 3, after the independent deferred-r2 review):
 * never say an assessment did not happen when it did. An earlier verified assessment (from before the deferral) is retained and
 * named; only what did not happen is called not assessed; no further live assessment occurs in this temporary mode.
 */
export function deferredReportScope(reasoningAssessedEarlier: boolean, semanticAssessedEarlier: boolean): string {
  // Round 4 wording (independent deferred-r3): earlier judgments are STORED, not asserted as still valid — a retraction may have marked them stale.
  if (reasoningAssessedEarlier && semanticAssessedEarlier) return "Nabus frühere Einschätzungen zum Rechenweg und zu deinem Satz bleiben im Bericht gespeichert — heute kam keine neue dazu.";
  if (reasoningAssessedEarlier) return "Zum Rechenweg bleibt Nabus frühere Einschätzung im Bericht gespeichert — heute kam keine neue dazu. Inhalt und Satzbau wurden heute nicht beurteilt.";
  if (semanticAssessedEarlier) return "Der Rechenweg wurde heute nicht beurteilt. Zu Inhalt und Satzbau bleibt Nabus frühere Prüfung im Bericht gespeichert — heute kam keine neue dazu.";
  return LIVE_TUTOR_DEFERRED_REPORT_SCOPE;
}
/** The writing-review footer on a deferred visit (replaces the live-review promise). */
export const LIVE_TUTOR_DEFERRED_WRITING_FOOTER = "Inhalt, ganzer Satz und Satzbau werden in diesem Besuch nicht beurteilt.";
/** The parent-facing wording: not performed, not assessed — neither effort nor failure. */
export const LIVE_TUTOR_DEFERRED_PARENT_NOTE = "in dieser Übergangsversion ausgesetzt (Entscheid des Eigentümers, 11.10.2026) — nicht geführt und nicht beurteilt; weder ein Nachweis noch ein Fehlen von Verständnis";
