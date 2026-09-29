// Tutor turn sequencing (independent-review defect #4): record the question
// before dispatch, use the latest revision, retry on stale, treat only
// applied/replayed as recorded, and withhold a reply whose classification was
// not persisted. Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { recordSupportConfirmed, runTutorTurn, type SupportOutcome, type TutorRunnerDeps } from "./family-learning-tutor.ts";

const context = { taskId: "EQ-ENTRY", taskVersion: 1, language: "de" as const, prompt: "Vier Forscher …", allowedHelp: "erklären" };

function harness(script: SupportOutcome[], replyText = "Teile in vier gleich grosse Gruppen.") {
  const log: string[] = [];
  let revision = 7;
  let n = 0;
  const deps: TutorRunnerDeps = {
    recordSupport: async (op, expectedRevision) => {
      const outcome = script[n] ?? "applied";
      n += 1;
      log.push(`${op.kind}@${expectedRevision}:${outcome}`);
      if (outcome === "applied" || outcome === "replayed") revision += 1;
      if (outcome === "stale") revision += 2; // the server view moved on; caller adopts it
      return { outcome, revision };
    },
    currentRevision: () => revision,
    ask: async (message) => {
      log.push(`ask:${message.includes("Frage des Kindes") ? "framed" : "raw"}`);
      return { ok: true, text: replyText };
    },
    newTurnId: () => "turn-1",
    isAlive: () => true,
  };
  return { deps, log };
}

describe("runTutorTurn", () => {
  it("records the question, asks, records the reply, then answers — in that order", async () => {
    const { deps, log } = harness([]);
    const result = await runTutorTurn(deps, context, "Was heisst gerecht?");
    deepStrictEqual(result, { status: "answered", turnId: "turn-1", text: "Teile in vier gleich grosse Gruppen." });
    deepStrictEqual(log, ["tutor_question@7:applied", "ask:framed", "tutor_reply@8:applied"]);
  });

  it("uses the latest revision after the question was recorded (no stale closure)", async () => {
    const { deps, log } = harness(["applied", "applied"]);
    await runTutorTurn(deps, context, "?");
    ok(log[2].startsWith("tutor_reply@8:"));
  });

  it("retries once on a stale revision and never treats stale as recorded", async () => {
    const { deps, log } = harness(["stale", "applied", "stale", "stale", "stale"]);
    const result = await runTutorTurn(deps, context, "?");
    equal(result.status, "reply-withheld");
    deepStrictEqual(log.slice(0, 3), ["tutor_question@7:stale", "tutor_question@9:applied", "ask:framed"]);
    equal(log.filter((l) => l.startsWith("tutor_reply")).length, 3);
  });

  it("does not dispatch when the question could not be recorded", async () => {
    const { deps, log } = harness(["refused"]);
    const result = await runTutorTurn(deps, context, "?");
    equal(result.status, "question-not-recorded");
    deepStrictEqual(log, ["tutor_question@7:refused"]);
  });

  it("withholds the reply when the reply event was not recorded, and after the workspace is gone", async () => {
    const { deps } = harness(["applied", "failed"]);
    equal((await runTutorTurn(deps, context, "?")).status, "reply-withheld");
    const gone = harness([]);
    let alive = true;
    gone.deps.isAlive = () => alive;
    gone.deps.ask = async () => {
      alive = false;
      return { ok: true, text: "x" };
    };
    const result = await runTutorTurn(gone.deps, context, "?");
    deepStrictEqual(result, { status: "reply-withheld", turnId: "turn-1", reason: "gone" });
    // The question was recorded before the workspace went away.
    ok(gone.log.some((l) => l.startsWith("tutor_question@7:applied")));
  });

  it("binds question and reply to the original task and turn", async () => {
    const seen: unknown[] = [];
    const { deps } = harness([]);
    const inner = deps.recordSupport;
    deps.recordSupport = async (op, rev) => {
      seen.push(op.taskId, (op.payload as { turnId: string }).turnId);
      return inner(op, rev);
    };
    await runTutorTurn(deps, context, "?");
    deepStrictEqual(seen, ["EQ-ENTRY", "turn-1", "EQ-ENTRY", "turn-1"]);
  });

  it("reports a bridge failure only after recording the empty reply", async () => {
    const { deps, log } = harness([], "");
    deps.ask = async () => ({ ok: false, text: "" });
    equal((await runTutorTurn(deps, context, "?")).status, "bridge-unavailable");
    ok(log.some((l) => l.startsWith("tutor_reply@8:applied")));
  });
});

describe("recordSupportConfirmed", () => {
  it("accepts applied/replayed only", async () => {
    for (const outcome of ["applied", "replayed"] as SupportOutcome[]) {
      equal(await recordSupportConfirmed({ recordSupport: async () => ({ outcome, revision: 1 }), currentRevision: () => 1 }, { op: "support", taskId: null, kind: "gloss" }), true);
    }
    for (const outcome of ["refused", "failed"] as SupportOutcome[]) {
      equal(await recordSupportConfirmed({ recordSupport: async () => ({ outcome, revision: 1 }), currentRevision: () => 1 }, { op: "support", taskId: null, kind: "gloss" }), false);
    }
  });
});
