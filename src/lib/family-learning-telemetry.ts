// ---------------------------------------------------------------------------
// Minimal task telemetry for the mission workspace (approved redesign
// 2026-09-29, F6/R3; repaired 2026-09-30, C4/P4). Pure buffer + explicit
// idle rule; the component wires DOM events in and flushes batches through
// the learning client.
//
// What is recorded: stage entries/exits, submissions, corrections, hints,
// retries, save failures, named control activations, pause/resume,
// visibility changes and foreground-active intervals. An "active interval"
// is time with input activity where no gap exceeds the idle rule (60 s); it
// is an estimate of foreground activity, never attention. Paused and hidden
// time is excluded: a pause closes the running interval and input while
// paused is ignored until an explicit resume. Every event conforms to the
// closed schema in `family-learning-telemetry-schema.ts` by construction —
// nothing here keeps keystroke contents, audio or a replay.
// ---------------------------------------------------------------------------

import { sanitizeTelemetryEvent, type TelemetryControl, type TelemetryDetail, type TelemetryEvent, type TelemetryKind, type TelemetryOp } from "./family-learning-telemetry-schema.ts";
import type { StageId } from "./family-learning-content.ts";

export type { TelemetryEvent } from "./family-learning-telemetry-schema.ts";

export const TELEMETRY_IDLE_RULE_SECONDS = 60;
export const TELEMETRY_MAX_EVENTS_PER_BATCH = 200;

export type TelemetryBuffer = {
  events: TelemetryEvent[];
  /** Start of the current active interval (ms), or null when idle/hidden/paused. */
  activeSince: number | null;
  lastInput: number | null;
  stage: StageId | null;
  hidden: boolean;
  paused: boolean;
};

export function createTelemetryBuffer(): TelemetryBuffer {
  return { events: [], activeSince: null, lastInput: null, stage: null, hidden: false, paused: false };
}

function push(buffer: TelemetryBuffer, raw: { t: number; kind: TelemetryKind; stage: StageId | null; detail?: TelemetryDetail }): TelemetryBuffer {
  if (buffer.events.length >= TELEMETRY_MAX_EVENTS_PER_BATCH) return buffer;
  // The schema is the only gate: a malformed producer call is dropped here too.
  const event = sanitizeTelemetryEvent(raw);
  if (!event) return buffer;
  return { ...buffer, events: [...buffer.events, event] };
}

/** Close the running active interval at `nowMs` (if any) into an event. */
export function closeActive(buffer: TelemetryBuffer, nowMs: number): TelemetryBuffer {
  if (buffer.activeSince === null) return buffer;
  const end = Math.min(nowMs, (buffer.lastInput ?? nowMs) + TELEMETRY_IDLE_RULE_SECONDS * 1000);
  const seconds = Math.max(0, Math.round((end - buffer.activeSince) / 1000));
  const next = seconds > 0 ? push(buffer, { t: nowMs, kind: "active-interval", stage: buffer.stage, detail: { seconds } }) : buffer;
  return { ...next, activeSince: null };
}

/** Input activity (any key, pointer or touch): extends or starts an active interval; a gap over the idle rule closes it first. Ignored while hidden or paused. */
export function noteInput(buffer: TelemetryBuffer, nowMs: number): TelemetryBuffer {
  if (buffer.hidden || buffer.paused) return buffer;
  let next = buffer;
  if (next.activeSince !== null && next.lastInput !== null && nowMs - next.lastInput > TELEMETRY_IDLE_RULE_SECONDS * 1000) next = closeActive(next, next.lastInput);
  if (next.activeSince === null) next = { ...next, activeSince: nowMs };
  return { ...next, lastInput: nowMs };
}

export function enterStage(buffer: TelemetryBuffer, stage: StageId | null, nowMs: number): TelemetryBuffer {
  if (buffer.stage === stage) return buffer;
  let next = closeActive(buffer, nowMs);
  if (next.stage) next = push(next, { t: nowMs, kind: "stage-exit", stage: next.stage });
  next = { ...next, stage };
  if (stage) next = push(next, { t: nowMs, kind: "stage-enter", stage });
  return next;
}

export function setHidden(buffer: TelemetryBuffer, hidden: boolean, nowMs: number): TelemetryBuffer {
  if (buffer.hidden === hidden) return buffer;
  let next = hidden ? closeActive(buffer, nowMs) : buffer;
  next = push(next, { t: nowMs, kind: hidden ? "hidden" : "visible", stage: next.stage });
  return { ...next, hidden };
}

/** An explicit pause closes the active interval; input is ignored until `resume`. */
export function pause(buffer: TelemetryBuffer, nowMs: number): TelemetryBuffer {
  if (buffer.paused) return buffer;
  const next = closeActive(buffer, nowMs);
  return { ...push(next, { t: nowMs, kind: "pause", stage: next.stage }), paused: true, lastInput: null };
}

/** A deliberate resume; activity starts again with the next input. */
export function resume(buffer: TelemetryBuffer, nowMs: number): TelemetryBuffer {
  if (!buffer.paused) return buffer;
  return { ...push(buffer, { t: nowMs, kind: "resume", stage: buffer.stage }), paused: false, lastInput: null };
}

export function noteSubmit(buffer: TelemetryBuffer, kind: "submit" | "hint", nowMs: number, op: TelemetryOp, ok: boolean, retry = false): TelemetryBuffer {
  return push(buffer, { t: nowMs, kind, stage: buffer.stage, detail: retry ? { op, ok, retry: true } : { op, ok } });
}

export function noteOp(buffer: TelemetryBuffer, kind: "save-failure" | "retry" | "correction", nowMs: number, op: TelemetryOp): TelemetryBuffer {
  return push(buffer, { t: nowMs, kind, stage: buffer.stage, detail: { op } });
}

export function noteControl(buffer: TelemetryBuffer, nowMs: number, name: TelemetryControl): TelemetryBuffer {
  return push(buffer, { t: nowMs, kind: "control", stage: buffer.stage, detail: { name } });
}

export function noteFeedback(buffer: TelemetryBuffer, nowMs: number, dimension: string, option: string): TelemetryBuffer {
  return push(buffer, { t: nowMs, kind: "feedback", stage: buffer.stage, detail: { dimension: dimension as "difficulty", option: option as "easy" } });
}

/**
 * Generic producer kept for callers/probes that address events by kind. It
 * dispatches to the typed producers, so pause/resume keep their accounting
 * semantics and every event still passes the closed schema.
 */
export function note(buffer: TelemetryBuffer, kind: "submit" | "correction" | "hint" | "retry" | "save-failure" | "control" | "pause" | "resume" | "feedback", nowMs: number, detail?: Record<string, unknown>): TelemetryBuffer {
  const d = detail ?? {};
  switch (kind) {
    case "pause":
      return pause(buffer, nowMs);
    case "resume":
      return resume(buffer, nowMs);
    case "submit":
    case "hint":
      return noteSubmit(buffer, kind, nowMs, d.op as TelemetryOp, d.ok === true, d.retry === true);
    case "save-failure":
    case "retry":
    case "correction":
      return noteOp(buffer, kind, nowMs, d.op as TelemetryOp);
    case "control":
      return noteControl(buffer, nowMs, d.name as TelemetryControl);
    case "feedback":
      return noteFeedback(buffer, nowMs, String(d.dimension ?? "difficulty"), String(d.option ?? ""));
  }
}

/** Take the pending events as one batch (closing the active interval); the buffer keeps its stage/visibility/pause state. */
export function takeBatch(buffer: TelemetryBuffer, nowMs: number, batchId: string): { buffer: TelemetryBuffer; batch: { batchId: string; events: TelemetryEvent[] } | null } {
  const closed = closeActive(buffer, nowMs);
  if (closed.events.length === 0) return { buffer: closed, batch: null };
  // A new active interval continues from now only if input was recent and nothing suspends activity.
  const reopened = closed.lastInput !== null && nowMs - closed.lastInput <= TELEMETRY_IDLE_RULE_SECONDS * 1000 && !closed.hidden && !closed.paused ? { ...closed, activeSince: nowMs } : closed;
  return { buffer: { ...reopened, events: [] }, batch: { batchId, events: closed.events } };
}
