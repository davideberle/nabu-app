// Telemetry buffer semantics (independent repair C4) and the closed privacy
// schema (P4). Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createTelemetryBuffer, enterStage, noteControl, noteInput, noteSubmit, pause, resume, setHidden, takeBatch } from "./family-learning-telemetry.ts";
import { sanitizeTelemetryEvent, sanitizeTelemetryEvents, TELEMETRY_OPS, TELEMETRY_STAGES } from "./family-learning-telemetry-schema.ts";
import { summariseTelemetry } from "./family-learning-summary.ts";

const s = (n: number) => n * 1000;

describe("foreground-active accounting excludes paused, hidden and idle time (C4)", () => {
  it("the independent probe: input at 0, pause at 10 s, flush at 30 s → 10 active seconds, never 30", () => {
    let b = noteInput(createTelemetryBuffer(), 0);
    b = enterStage(b, "typing-course", 0);
    b = noteInput(b, 0);
    b = pause(b, s(10));
    const { batch } = takeBatch(b, s(30), "p");
    const summary = summariseTelemetry(batch!.events, 1);
    equal(summary.foregroundActiveSeconds, 10);
    equal(summary.pauses, 1);
    deepStrictEqual(batch!.events.map((e) => e.kind), ["stage-enter", "active-interval", "pause"]);
  });
  it("input while paused is ignored; a deliberate resume starts a new interval with the next input", () => {
    let b = enterStage(createTelemetryBuffer(), "EQ-STATION", 0);
    b = noteInput(b, 0);
    b = pause(b, s(10));
    b = noteInput(b, s(20)); // ignored
    equal(b.activeSince, null);
    b = resume(b, s(25));
    equal(b.activeSince, null, "resume alone is not activity");
    b = noteInput(b, s(26));
    const { batch } = takeBatch(b, s(30), "p");
    equal(summariseTelemetry(batch!.events, 1).foregroundActiveSeconds, 10 + 4);
    deepStrictEqual(batch!.events.map((e) => e.kind), ["stage-enter", "active-interval", "pause", "resume", "active-interval"]);
  });
  it("hidden time is excluded and a flush does not reopen activity while hidden or paused", () => {
    let b = enterStage(createTelemetryBuffer(), "log", 0);
    b = noteInput(b, 0);
    b = setHidden(b, true, s(5));
    b = noteInput(b, s(6)); // ignored while hidden
    const first = takeBatch(b, s(40), "h");
    equal(summariseTelemetry(first.batch!.events, 1).foregroundActiveSeconds, 5);
    equal(first.buffer.activeSince, null);
    b = setHidden(first.buffer, false, s(41));
    b = noteInput(b, s(42));
    b = pause(b, s(50));
    const second = takeBatch(b, s(60), "h2");
    equal(summariseTelemetry(second.batch!.events, 1).foregroundActiveSeconds, 8);
    equal(second.buffer.activeSince, null, "no reopening while paused");
  });
  it("the idle rule closes an interval at the last input when the gap exceeds 60 s", () => {
    let b = enterStage(createTelemetryBuffer(), "explain", 0);
    b = noteInput(b, 0);
    b = noteInput(b, s(30));
    b = noteInput(b, s(100)); // gap of 70 s
    const { batch } = takeBatch(b, s(110), "i");
    const intervals = batch!.events.filter((e) => e.kind === "active-interval").map((e) => (e.detail as { seconds: number }).seconds);
    deepStrictEqual(intervals, [30, 10]);
  });
});

describe("closed telemetry schema (P4)", () => {
  it("drops free text, unknown keys, unknown stages and unknown controls; keeps only enumerated, bounded values", () => {
    equal(sanitizeTelemetryEvent({ t: 1, kind: "control", stage: "my private typed words", detail: { key: "PRIVATE_RAW_KEY", text: "PRIVATE_RAW_TEXT" } }), null, "unknown stage text drops the event");
    equal(sanitizeTelemetryEvent({ t: 1, kind: "control", stage: "log", detail: { key: "PRIVATE_RAW_KEY", text: "PRIVATE_RAW_TEXT" } }), null, "a control without a known name is dropped");
    deepStrictEqual(sanitizeTelemetryEvent({ t: 1, kind: "control", stage: "log", detail: { name: "stop", text: "PRIVATE_RAW_TEXT", extra: 5 } }), { t: 1, kind: "control", stage: "log", detail: { name: "stop" } });
    deepStrictEqual(sanitizeTelemetryEvent({ t: 2, kind: "submit", stage: "EQ-STATION", detail: { op: "answer-remainder", ok: true, raw: "30 und 2", transcript: "secret" } }), { t: 2, kind: "submit", stage: "EQ-STATION", detail: { op: "answer-remainder", ok: true } });
    equal(sanitizeTelemetryEvent({ t: 2, kind: "submit", detail: { op: "delete-everything", ok: true } }), null);
    deepStrictEqual(sanitizeTelemetryEvent({ t: 3, kind: "active-interval", stage: "typing-course", detail: { seconds: 12.7 } }), null, "durations are bounded integers");
    deepStrictEqual(sanitizeTelemetryEvent({ t: 3, kind: "active-interval", stage: "typing-course", detail: { seconds: 5000 } }), null);
    deepStrictEqual(sanitizeTelemetryEvent({ t: 3, kind: "active-interval", stage: "typing-course", detail: { seconds: 12 } }), { t: 3, kind: "active-interval", stage: "typing-course", detail: { seconds: 12 } });
    deepStrictEqual(sanitizeTelemetryEvent({ t: 4, kind: "hidden", stage: null, detail: { note: "x" } }), { t: 4, kind: "hidden", stage: null });
    deepStrictEqual(sanitizeTelemetryEvent({ t: 5, kind: "feedback", stage: "reflect", detail: { dimension: "difficulty", option: "right", comment: "free text" } }), { t: 5, kind: "feedback", stage: "reflect", detail: { dimension: "difficulty", option: "right" } });
    deepStrictEqual(sanitizeTelemetryEvent({ t: 5, kind: "feedback", stage: "reflect", detail: { dimension: "enjoyment", option: "yes" } }), { t: 5, kind: "feedback", stage: "reflect", detail: { dimension: "enjoyment", option: "yes" } });
    equal(sanitizeTelemetryEvent({ t: 5, kind: "feedback", stage: "reflect", detail: { dimension: "enjoyment", option: "right" } }), null, "an option of another dimension is dropped");
    equal(sanitizeTelemetryEvent({ t: 5, kind: "feedback", stage: "reflect", detail: { option: "right" } }), null, "feedback without a dimension is dropped");
    equal(sanitizeTelemetryEvent({ t: 5, kind: "feedback", stage: "reflect", detail: { dimension: "mood", option: "yes" } }), null);
    equal(sanitizeTelemetryEvent({ t: -1, kind: "hidden" }), null);
    equal(sanitizeTelemetryEvent({ t: Number.NaN, kind: "hidden" }), null);
    equal(sanitizeTelemetryEvent({ t: 1, kind: "keystream", detail: { keys: "secret" } }), null);
    equal(sanitizeTelemetryEvents([{ t: 1, kind: "hidden" }, "junk", { t: 2, kind: "visible" }], 1).length, 1, "bounded count");
    // Every stored string is one of the enumerations: nothing else can appear.
    const stored = JSON.stringify(sanitizeTelemetryEvents([{ t: 1, kind: "control", stage: "log", detail: { name: "stop", text: "PRIVATE" } }, { t: 2, kind: "submit", detail: { op: "save-log", ok: false, text: "PRIVATE" } }], 10));
    ok(!stored.includes("PRIVATE"));
  });
  it("the op enumeration matches the state machine's op names and the stage enumeration covers every stage", () => {
    const source = readFileSync(new URL("./family-learning-state.ts", import.meta.url), "utf8");
    const ops = new Set([...source.matchAll(/\| \{ op: "([a-z-]+)"/g)].map((m) => m[1]));
    deepStrictEqual([...ops].sort(), [...TELEMETRY_OPS].sort());
    // Content version 3 (Visit 4, 2026-10-04) adds EQ-PIER, LANG-EN-PIER and pier-build: 21 → 24 stage ids.
    const content = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v3.json", import.meta.url), "utf8")) as { visits: { stages: string[] }[] };
    const allStages = [...new Set(content.visits.flatMap((v) => v.stages))].sort();
    deepStrictEqual([...TELEMETRY_STAGES].sort(), allStages);
    equal(allStages.length, 24);
  });
  it("the client buffer only produces schema events (a malformed producer call is dropped, not stored)", () => {
    let b = enterStage(createTelemetryBuffer(), "log", 0);
    b = noteSubmit(b, "submit", 1, "save-log", true);
    b = noteControl(b, 2, "stop");
    b = noteControl(b, 3, "not-a-control" as never);
    const { batch } = takeBatch(b, 4, "x");
    deepStrictEqual(batch!.events.map((e) => [e.kind, e.detail]), [["stage-enter", undefined], ["submit", { op: "save-log", ok: true }], ["control", { name: "stop" }]]);
  });
});
