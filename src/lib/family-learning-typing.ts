// ---------------------------------------------------------------------------
// Typing-lesson draft for the mission workspace (review R3-3 / R3-5).
//
// Pure state for the client: what the child typed per line is kept until the
// server has acknowledged the completed lesson. A failed or lost save is
// retried with the SAME payload and the SAME idempotency key, so nothing is
// double-counted and the server can replay a lost acknowledgement. Enter and
// button both go through `commitLine`, which refuses while a save is busy.
// Per-line typed text is what is sent; the server computes every metric.
// ---------------------------------------------------------------------------

export type TypingDraftPhase = "typing" | "completed" | "saving" | "saved";

export type TypingDraft = {
  lessonId: string;
  lines: readonly string[];
  /** Typed text per finished line, in order. */
  typedLines: string[];
  /** Index of the line currently being typed (== typedLines.length while typing). */
  lineIndex: number;
  /** Current, unfinished input for the active line. */
  current: string;
  phase: TypingDraftPhase;
  /** Fixed once the last line is committed; reused for every retry. */
  idempotencyKey: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  /** Last save failure, shown to the child; cleared on retry. */
  failure: "network" | "stale" | "refused" | null;
};

export function createTypingDraft(lessonId: string, lines: readonly string[]): TypingDraft {
  return { lessonId, lines, typedLines: [], lineIndex: 0, current: "", phase: "typing", idempotencyKey: null, startedAtMs: null, completedAtMs: null, failure: null };
}

export function typeInto(draft: TypingDraft, value: string, nowMs: number): TypingDraft {
  if (draft.phase !== "typing") return draft;
  const line = draft.lines[draft.lineIndex] ?? "";
  const bounded = Array.from(value).slice(0, Array.from(line).length + 20).join("");
  return { ...draft, current: bounded, startedAtMs: draft.startedAtMs ?? nowMs };
}

/**
 * Commit the active line. Refused while a save is busy (Enter and button
 * share this path) and after completion. Completing the last line freezes
 * the payload and mints the idempotency key exactly once.
 */
export function commitLine(draft: TypingDraft, params: { busy: boolean; nowMs: number; newKey: () => string }): TypingDraft {
  if (params.busy || draft.phase !== "typing") return draft;
  if (draft.current.length === 0) return draft;
  const typedLines = [...draft.typedLines, draft.current];
  if (typedLines.length < draft.lines.length) {
    return { ...draft, typedLines, lineIndex: typedLines.length, current: "" };
  }
  return { ...draft, typedLines, lineIndex: typedLines.length, current: "", phase: "completed", idempotencyKey: draft.idempotencyKey ?? params.newKey(), completedAtMs: params.nowMs };
}

export type TypingLessonPayload = { op: "typing-lesson"; lessonId: string; lines: string[]; seconds: number };

/** The one payload for this completed draft — identical on every retry. */
export function lessonPayload(draft: TypingDraft): { op: TypingLessonPayload; idempotencyKey: string } | null {
  if ((draft.phase !== "completed" && draft.phase !== "saving") || !draft.idempotencyKey) return null;
  const seconds = draft.startedAtMs !== null && draft.completedAtMs !== null ? Math.max(0, Math.round((draft.completedAtMs - draft.startedAtMs) / 1000)) : 0;
  return { op: { op: "typing-lesson", lessonId: draft.lessonId, lines: [...draft.typedLines], seconds }, idempotencyKey: draft.idempotencyKey };
}

export function markSaving(draft: TypingDraft): TypingDraft {
  return draft.phase === "completed" ? { ...draft, phase: "saving", failure: null } : draft;
}

/**
 * Apply the save outcome. `applied`/`replayed` acknowledge the lesson; a
 * `stale` view that already shows the lesson done is an acknowledgement too
 * (the earlier request landed); anything else keeps the completed draft for
 * retry with the same key. A `refused` answer means the payload itself is
 * wrong and must not be resent unchanged.
 */
export function applySaveOutcome(
  draft: TypingDraft,
  outcome: { kind: "applied" | "replayed" } | { kind: "stale"; lessonDoneOnServer: boolean } | { kind: "network" } | { kind: "refused" },
): TypingDraft {
  if (draft.phase !== "saving") return draft;
  switch (outcome.kind) {
    case "applied":
    case "replayed":
      return { ...draft, phase: "saved", failure: null };
    case "stale":
      return outcome.lessonDoneOnServer ? { ...draft, phase: "saved", failure: null } : { ...draft, phase: "completed", failure: "stale" };
    case "network":
      return { ...draft, phase: "completed", failure: "network" };
    case "refused":
      return { ...draft, phase: "completed", failure: "refused" };
  }
}

/** Per-line preview metrics for the UI (server values are authoritative). */
export function previewLine(expected: string, typed: string): { correct: number; extra: number; omitted: number } {
  const e = Array.from(expected);
  const t = Array.from(typed);
  let correct = 0;
  for (let i = 0; i < e.length; i += 1) if (t[i] === e[i]) correct += 1;
  return { correct, extra: Math.max(0, t.length - e.length), omitted: Math.max(0, e.length - t.length) };
}
