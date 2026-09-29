// Client-side recovery helpers (review R3-3, R3-4): the typing draft keeps one
// completed payload and one idempotency key across failed saves, lost
// acknowledgements and stale responses, and refuses commits while busy; the
// read-aloud controller fences pending acknowledgements by generation so a
// removed/cancelled control never starts old audio. Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { createReadAloudController } from "./family-learning-audio.ts";
import { applySaveOutcome, commitLine, createTypingDraft, lessonPayload, markSaving, previewLine, typeInto } from "./family-learning-typing.ts";

const LINES = ["fff jjj fj fj", "ddd kkk dk dk", "asdf jklö"];

function completeDraft(typed: string[] = LINES) {
  let keys = 0;
  const newKey = () => `key-${(keys += 1)}`;
  let d = createTypingDraft("TYPE-CH-QWERTZ-HOME", LINES);
  for (const line of typed) {
    d = typeInto(d, line, 1_000);
    d = commitLine(d, { busy: false, nowMs: 2_000, newKey });
  }
  return { draft: d, newKey };
}

describe("typing draft (R3-3)", () => {
  it("freezes one payload and one key on completion; retries resend exactly the same", () => {
    const { draft } = completeDraft();
    equal(draft.phase, "completed");
    const first = lessonPayload(draft)!;
    deepStrictEqual(first.op, { op: "typing-lesson", lessonId: "TYPE-CH-QWERTZ-HOME", lines: LINES, seconds: 1 });
    equal(first.idempotencyKey, "key-1");
    // Failed save → still completed, same payload/key on retry (never 44/44/44).
    const failed = applySaveOutcome(markSaving(draft), { kind: "network" });
    equal(failed.phase, "completed");
    equal(failed.failure, "network");
    deepStrictEqual(lessonPayload(failed), first);
    // A retype after a failure is impossible: commits are refused after completion.
    const retyped = commitLine(typeInto(failed, "asdf jklö", 3_000), { busy: false, nowMs: 3_000, newKey: () => "key-2" });
    deepStrictEqual(lessonPayload(retyped), first);
  });

  it("acknowledges applied/replayed, and a stale view that already shows the lesson done (lost acknowledgement)", () => {
    const { draft } = completeDraft();
    equal(applySaveOutcome(markSaving(draft), { kind: "applied" }).phase, "saved");
    equal(applySaveOutcome(markSaving(draft), { kind: "replayed" }).phase, "saved");
    equal(applySaveOutcome(markSaving(draft), { kind: "stale", lessonDoneOnServer: true }).phase, "saved");
    const notDone = applySaveOutcome(markSaving(draft), { kind: "stale", lessonDoneOnServer: false });
    equal(notDone.phase, "completed");
    equal(notDone.failure, "stale");
    deepStrictEqual(lessonPayload(notDone)!.idempotencyKey, "key-1");
    const refused = applySaveOutcome(markSaving(draft), { kind: "refused" });
    equal(refused.failure, "refused");
  });

  it("refuses Enter/commit while busy and after completion, and never double-counts a line", () => {
    const { newKey } = completeDraft([]);
    let d = createTypingDraft("TYPE-CH-QWERTZ-HOME", LINES);
    d = typeInto(d, "fff jjj fj fj", 0);
    const stillTyping = commitLine(d, { busy: true, nowMs: 1, newKey });
    equal(stillTyping.typedLines.length, 0);
    d = commitLine(d, { busy: false, nowMs: 1, newKey });
    equal(d.typedLines.length, 1);
    // Repeated Enter with an empty current line does nothing.
    d = commitLine(d, { busy: false, nowMs: 1, newKey });
    equal(d.typedLines.length, 1);
    d = typeInto(commitLine(typeInto(d, "ddd kkk dk dk", 1), { busy: false, nowMs: 1, newKey }), "asdf jklö", 1);
    d = commitLine(d, { busy: false, nowMs: 5, newKey });
    equal(d.phase, "completed");
    equal(commitLine(d, { busy: false, nowMs: 6, newKey }), d);
  });

  it("previews per-line extras and omissions", () => {
    deepStrictEqual(previewLine("fff jjj fj fj", "fff jjj fj fjZZ"), { correct: 13, extra: 2, omitted: 0 });
    deepStrictEqual(previewLine("ddd kkk dk dk", "ddd kkk dk "), { correct: 11, extra: 0, omitted: 2 });
  });
});

describe("read-aloud controller (R3-4)", () => {
  function harness() {
    let speakResult: unknown = "played";
    const log: string[] = [];
    let resolveRecord: ((ok: boolean) => void) | null = null;
    const deps = {
      record: (text: string) =>
        new Promise<boolean>((resolve) => {
          log.push(`record:${text}`);
          resolveRecord = resolve;
        }),
      speak: async (text: string, rate?: number) => {
        log.push(`speak:${text}${rate ? `@${rate}` : ""}`);
        return speakResult;
      },
      cancelSpeech: () => log.push("cancel"),
    };
    return { deps, log, ack: (ok: boolean) => resolveRecord?.(ok), setSpeakResult: (r: unknown) => (speakResult = r) };
  }

  it("a failed fetch/playback resolves 'unavailable', never 'played'; the support stays recorded and a retry plays again (M3 finding 1)", async () => {
    const { deps, log, ack, setSpeakResult } = harness();
    const c = createReadAloudController(deps);
    setSpeakResult("fallback");
    const p = c.play("Vier Forscher teilen 24 Pakete.");
    ack(true);
    equal(await p, "unavailable");
    equal(c.isPlaying(), false);
    equal(c.isRecorded("Vier Forscher teilen 24 Pakete."), true, "conservative: the help stays recorded even though nothing was heard");
    // Retry: no new record, speech attempted again, and success is reported only when the player says so.
    setSpeakResult("played");
    equal(await c.play("Vier Forscher teilen 24 Pakete."), "played");
    deepStrictEqual(log.filter((l) => l.startsWith("record")), ["record:Vier Forscher teilen 24 Pakete."]);
    equal(log.filter((l) => l.startsWith("speak")).length, 2);
    // A thrown speech dependency is a failure too, not a success.
    const throwing = createReadAloudController({ ...deps, speak: async () => { throw new Error("no audio element"); } });
    const q = throwing.play("x");
    ack(true);
    equal(await q, "unavailable");
  });

  it("an external cancel of the current request resolves 'interrupted' (control may idle), never 'played' (A01)", async () => {
    const { deps, ack, setSpeakResult } = harness();
    const c = createReadAloudController(deps);
    setSpeakResult("cancelled");
    const p = c.play("a");
    ack(true);
    equal(await p, "interrupted");
    equal(c.isPlaying(), false);
    setSpeakResult(undefined);
    equal(await c.play("a"), "interrupted");
    // A retry after the interruption plays normally.
    setSpeakResult("played");
    equal(await c.play("a"), "played");
  });

  it("an older request superseded by a newer one on the same control resolves 'superseded', not 'interrupted' (it must not clear the newer request)", async () => {
    let finishSpeech: ((r: string) => void) | undefined;
    const base = harness();
    const deps = { ...base.deps, speak: () => new Promise<string>((r) => (finishSpeech = r)) };
    const c = createReadAloudController(deps);
    const first = c.play("a");
    base.ack(true);
    await new Promise((r) => setTimeout(r, 0));
    const finishFirst = finishSpeech;
    const second = c.play("a", 0.75); // newer request on the same control
    finishFirst?.("cancelled"); // the player cancelled the first speech for the second
    equal(await first, "superseded");
    equal(c.isPlaying(), true, "the newer request is still the live one");
    finishSpeech?.("played");
    equal(await second, "played");
  });

  it("stop or dispose while speech is in flight wins over the speech result, so no stale 'unavailable' can be shown", async () => {
    let finishSpeech: ((r: string) => void) | undefined;
    const base = harness();
    const deps = { ...base.deps, speak: () => new Promise<string>((r) => (finishSpeech = r)) };
    const c = createReadAloudController(deps);
    const p = c.play("a");
    base.ack(true);
    await new Promise((r) => setTimeout(r, 0));
    c.stop();
    finishSpeech?.("fallback");
    equal(await p, "superseded");
    const d = createReadAloudController(deps);
    const q = d.play("b");
    base.ack(true);
    await new Promise((r) => setTimeout(r, 0));
    d.dispose();
    finishSpeech?.("fallback");
    equal(await q, "disposed");
  });

  it("plays only after the support is confirmed, and never after dispose", async () => {
    const { deps, log, ack } = harness();
    const c = createReadAloudController(deps);
    const p = c.play("We need water.");
    c.dispose();
    ack(true);
    equal(await p, "disposed");
    deepStrictEqual(log.filter((l) => l.startsWith("speak")), []);
    equal(await c.play("We need water."), "disposed");
  });

  it("a stop or a newer request while the acknowledgement is pending supersedes the old one", async () => {
    const { deps, log, ack } = harness();
    const c = createReadAloudController(deps);
    const p = c.play("sentence");
    c.stop();
    ack(true);
    equal(await p, "superseded");
    deepStrictEqual(log.filter((l) => l.startsWith("speak")), []);
    // A newer request (selected word changed) supersedes the pending one too.
    const p1 = c.play("water");
    const p2 = c.play("garden");
    ack(true); // resolves whichever record is pending last: "garden"
    equal(await p2, "played");
    deepStrictEqual(log.filter((l) => l.startsWith("speak")), ["speak:garden"]);
    void p1;
  });

  it("records once per text, then repeat/slow play without a new record; unconfirmed support never plays", async () => {
    const { deps, log, ack } = harness();
    const c = createReadAloudController(deps);
    const p = c.play("x");
    ack(true);
    equal(await p, "played");
    equal(c.isRecorded("x"), true);
    equal(await c.play("x", 0.75), "played");
    deepStrictEqual(log.filter((l) => l.startsWith("record")), ["record:x"]);
    ok(log.includes("speak:x@0.75"));
    const q = c.play("y");
    ack(false);
    equal(await q, "not-recorded");
    equal(c.isRecorded("y"), false);
    equal(log.filter((l) => l === "speak:y").length, 0);
  });
});
