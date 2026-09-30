// ---------------------------------------------------------------------------
// Stable completed-draft retries for single-shot submissions (independent
// repair R3-4): the fresh transfer sentence and the reflection/feedback form.
//
// The same discipline as the typing draft: one completed payload keeps ONE
// idempotency key through a failed save (network), a lost acknowledgement
// (the retry replays on the server), a stale or refused answer and a
// double-submit race. A deliberately changed payload gets a new key. Nothing
// here talks to the network; the component asks `submitDraftFor` for the
// draft of the payload it is about to send and records the outcome.
// ---------------------------------------------------------------------------

export type SubmitDraftPhase = "idle" | "saving" | "saved" | "failed";
export type SubmitFailure = "network" | "refused" | "stale";

export type SubmitDraft = {
  /** Canonical payload identity (stable JSON of the fields that are sent). */
  payloadKey: string;
  idempotencyKey: string;
  phase: SubmitDraftPhase;
  failure: SubmitFailure | null;
  /** Machine code of a refusal, if any (e.g. "copied-text"). */
  refusalCode: string | null;
  attempts: number;
};

/** Stable JSON for a payload: keys sorted, whitespace in strings collapsed. */
export function payloadKeyOf(payload: Record<string, unknown>): string {
  const normalise = (v: unknown): unknown => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, normalise((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(normalise(payload));
}

/**
 * The draft to send for `payloadKey`: the previous draft when the payload is
 * unchanged (same key, even after a failure), a new draft otherwise. A draft
 * that is currently saving is returned as is (the caller must not send again).
 */
export function submitDraftFor(previous: SubmitDraft | null, payloadKey: string, newKey: () => string): SubmitDraft {
  if (previous && previous.payloadKey === payloadKey) return previous;
  return { payloadKey, idempotencyKey: newKey(), phase: "idle", failure: null, refusalCode: null, attempts: 0 };
}

/** True when this draft may be sent now (not already in flight, not saved). */
export function canSend(draft: SubmitDraft): boolean {
  return draft.phase === "idle" || draft.phase === "failed";
}

export function markSending(draft: SubmitDraft): SubmitDraft {
  return { ...draft, phase: "saving", failure: null, refusalCode: null, attempts: draft.attempts + 1 };
}

export function applySubmitOutcome(draft: SubmitDraft, outcome: { kind: "applied" | "replayed" } | { kind: "stale" } | { kind: "refused"; code: string } | { kind: "network" }): SubmitDraft {
  if (draft.phase !== "saving") return draft;
  switch (outcome.kind) {
    case "applied":
    case "replayed":
      return { ...draft, phase: "saved", failure: null, refusalCode: null };
    case "stale":
      // The server already moved on (a replayed commit or another tab); the view refresh decides what is shown next.
      return { ...draft, phase: "failed", failure: "stale", refusalCode: null };
    case "refused":
      return { ...draft, phase: "failed", failure: "refused", refusalCode: outcome.code };
    case "network":
      return { ...draft, phase: "failed", failure: "network", refusalCode: null };
  }
}
