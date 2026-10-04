// ---------------------------------------------------------------------------
// Telemetry privacy schema (independent repair P4, 2026-09-30).
//
// One closed schema shared by the client buffer and the server store. Every
// event is reduced to reviewed, finite, enumerated values: the stage is one
// of the content's stage ids, an op is one of the state machine's op names, a
// control is one of the named controls, feedback is one of the reflection
// options and a duration is a bounded integer. Any other key, any free text
// and any unknown value is dropped — there is no field in which a key stream,
// a typed word, a transcript or an attention score could be stored.
// ---------------------------------------------------------------------------

import { EXPECTED_RETAINED_STAGES, EXPECTED_V4_STAGES, EXPECTED_V5_STAGES, type StageId } from "./family-learning-content.ts";

export const TELEMETRY_STAGES: readonly StageId[] = [...new Set<StageId>([...Object.values(EXPECTED_RETAINED_STAGES).flat(), ...EXPECTED_V4_STAGES, ...EXPECTED_V5_STAGES])];

/** Every op name of the state machine (kept in sync by a unit test). */
export const TELEMETRY_OPS = [
  "answer-math", "answer-remainder", "build-pier", "build-station", "choose-station", "continue-item", "explain", "language-continue", "language-step",
  "name-base", "place-base", "reflect", "request-teaching", "resume-base", "revise-log", "save-log", "skip-stage", "start-visit", "stop-item",
  "summary-seen", "support", "typing-burst", "typing-check", "typing-course-continue", "typing-label", "typing-lesson", "write-transfer",
  "repair-explain", "typing-retry", "writing-retry", "language-retry", "repair-close", "lesson-feedback-seen",
] as const;
export type TelemetryOp = (typeof TELEMETRY_OPS)[number];

/** Named controls whose activation may be counted (never their payload). */
export const TELEMETRY_CONTROLS = ["stop", "tutor-open", "tutor-close", "read-aloud", "another-burst", "shorter-burst", "course-continue"] as const;
export type TelemetryControl = (typeof TELEMETRY_CONTROLS)[number];

/** Child feedback dimensions and their option ids (content `reflection`). */
export const TELEMETRY_FEEDBACK_DIMENSIONS = { difficulty: ["easy", "right", "tricky"], enjoyment: ["yes", "partly", "no"], clarity: ["clear", "partly", "unclear"] } as const;
export type TelemetryFeedbackDimension = keyof typeof TELEMETRY_FEEDBACK_DIMENSIONS;
export const TELEMETRY_FEEDBACK = ["easy", "right", "tricky", "yes", "partly", "no", "clear", "unclear"] as const;

export const TELEMETRY_KINDS = ["stage-enter", "stage-exit", "submit", "correction", "hint", "retry", "save-failure", "control", "pause", "resume", "hidden", "visible", "active-interval", "feedback"] as const;
export type TelemetryKind = (typeof TELEMETRY_KINDS)[number];

export const TELEMETRY_MAX_INTERVAL_SECONDS = 3600;
export const TELEMETRY_MAX_TIME_MS = 2 ** 53;

export type TelemetryDetail =
  | { seconds: number }
  | { op: TelemetryOp; ok: boolean; retry?: boolean }
  | { op: TelemetryOp }
  | { name: TelemetryControl }
  | { dimension: TelemetryFeedbackDimension; option: (typeof TELEMETRY_FEEDBACK)[number] };

export type TelemetryEvent = { t: number; kind: TelemetryKind; stage: StageId | null; detail?: TelemetryDetail };

const KIND_SET = new Set<string>(TELEMETRY_KINDS);
const STAGE_SET = new Set<string>(TELEMETRY_STAGES);
const OP_SET = new Set<string>(TELEMETRY_OPS);
const CONTROL_SET = new Set<string>(TELEMETRY_CONTROLS);
const FEEDBACK_SET = new Set<string>(TELEMETRY_FEEDBACK);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const boundedInt = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * Reduce a raw event to the schema, or drop it (null). Unknown keys are never
 * copied; a required enumerated value that is missing or unknown drops the
 * whole event; a stage that is not a known stage id drops the event.
 */
export function sanitizeTelemetryEvent(raw: unknown): TelemetryEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.kind !== "string" || !KIND_SET.has(raw.kind)) return null;
  const kind = raw.kind as TelemetryKind;
  if (!boundedInt(raw.t, TELEMETRY_MAX_TIME_MS)) return null;
  let stage: StageId | null = null;
  if (raw.stage !== undefined && raw.stage !== null) {
    if (typeof raw.stage !== "string" || !STAGE_SET.has(raw.stage)) return null;
    stage = raw.stage as StageId;
  }
  const d = isRecord(raw.detail) ? raw.detail : {};
  switch (kind) {
    case "active-interval": {
      if (!boundedInt(d.seconds, TELEMETRY_MAX_INTERVAL_SECONDS)) return null;
      return { t: raw.t, kind, stage, detail: { seconds: d.seconds } };
    }
    case "submit":
    case "hint": {
      if (typeof d.op !== "string" || !OP_SET.has(d.op) || typeof d.ok !== "boolean") return null;
      const detail: { op: TelemetryOp; ok: boolean; retry?: boolean } = { op: d.op as TelemetryOp, ok: d.ok };
      if (d.retry === true) detail.retry = true;
      return { t: raw.t, kind, stage, detail };
    }
    case "save-failure":
    case "retry":
    case "correction": {
      if (typeof d.op !== "string" || !OP_SET.has(d.op)) return null;
      return { t: raw.t, kind, stage, detail: { op: d.op as TelemetryOp } };
    }
    case "control": {
      if (typeof d.name !== "string" || !CONTROL_SET.has(d.name)) return null;
      return { t: raw.t, kind, stage, detail: { name: d.name as TelemetryControl } };
    }
    case "feedback": {
      if (typeof d.dimension !== "string" || !(d.dimension in TELEMETRY_FEEDBACK_DIMENSIONS)) return null;
      const dimension = d.dimension as TelemetryFeedbackDimension;
      if (typeof d.option !== "string" || !(TELEMETRY_FEEDBACK_DIMENSIONS[dimension] as readonly string[]).includes(d.option)) return null;
      return { t: raw.t, kind, stage, detail: { dimension, option: d.option as (typeof TELEMETRY_FEEDBACK)[number] } };
    }
    default:
      // stage-enter, stage-exit, pause, resume, hidden, visible: no detail at all.
      return { t: raw.t, kind, stage };
  }
}

/** Sanitize a whole batch: drops what does not conform, keeps order, bounds the count. */
export function sanitizeTelemetryEvents(raw: unknown, max: number): TelemetryEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: TelemetryEvent[] = [];
  for (const item of raw.slice(0, max)) {
    const event = sanitizeTelemetryEvent(item);
    if (event) out.push(event);
  }
  return out;
}
