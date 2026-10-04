// Heartbeat controller (GP-04/05/07): single-flight, coalesced, fenced outcomes, one timer, stop invalidates. Run: npm test

import { deepEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { createHeartbeat, type HeartbeatInput } from "./family-play-heartbeat.ts";

type Pending = { input: HeartbeatInput; seq: number; resolve: (v: string) => void };

function harness() {
  const pending: Pending[] = [];
  const outcomes: { result: string; seq: number }[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let timerId = 0;
  let input: HeartbeatInput = { active: true, hidden: false, paused: false };
  const hb = createHeartbeat<string>({
    send: (i, seq) => new Promise<string>((resolve) => pending.push({ input: i, seq, resolve })),
    input: () => input,
    onOutcome: (result, seq) => outcomes.push({ result, seq }),
    intervalMs: 5000,
    setTimer: (fn, ms) => {
      const id = (timerId += 1);
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimer: (h) => {
      const idx = timers.findIndex((t) => t.id === h);
      if (idx >= 0) timers.splice(idx, 1);
    },
  });
  const tick = async () => new Promise((r) => setTimeout(r, 0));
  return { hb, pending, outcomes, timers, setInput: (i: HeartbeatInput) => { input = i; }, tick };
}

describe("heartbeat controller", () => {
  it("keeps exactly one request in flight: pause + continue while the first tick waits send ONE follow-up, with the latest state", async () => {
    const h = harness();
    h.hb.request();
    await h.tick();
    equal(h.pending.length, 1);
    h.setInput({ active: false, hidden: false, paused: true });
    h.hb.request(); // pause
    h.setInput({ active: true, hidden: false, paused: false });
    h.hb.request(); // continue
    await h.tick();
    equal(h.pending.length, 1, "coalesced: still one in flight");
    h.pending[0].resolve("first");
    await h.tick();
    await h.tick();
    equal(h.pending.length, 2, "one follow-up, not two");
    deepEqual(h.pending[1].input, { active: true, hidden: false, paused: false }, "follow-up carries the CURRENT state");
    equal(h.timers.length, 0, "no timer while a request is in flight");
    h.pending[1].resolve("second");
    await h.tick();
    await h.tick();
    equal(h.timers.length, 1, "exactly one timer after the loop settles");
    deepEqual(h.outcomes.map((o) => o.result), ["first", "second"]);
  });

  it("a stale outcome never speaks after stop, and stop clears the timer", async () => {
    const h = harness();
    h.hb.request();
    await h.tick();
    h.hb.stop();
    h.pending[0].resolve("late");
    await h.tick();
    await h.tick();
    deepEqual(h.outcomes, []);
    equal(h.timers.length, 0);
    equal(h.hb.state().inFlight, false);
  });

  it("the timer re-arms once per settled beat and never accumulates", async () => {
    const h = harness();
    h.hb.request();
    await h.tick();
    h.pending[0].resolve("a");
    await h.tick();
    await h.tick();
    equal(h.timers.length, 1);
    // the timer fires (a fired timer is gone) → one request → resolve → one timer again
    h.timers.shift()!.fn();
    await h.tick();
    equal(h.pending.length, 2);
    equal(h.timers.length, 0);
    h.hb.request();
    h.hb.request();
    h.pending[1].resolve("b");
    await h.tick();
    await h.tick();
    equal(h.pending.length, 3, "the two extra requests coalesced into one");
    h.pending[2].resolve("c");
    await h.tick();
    await h.tick();
    equal(h.timers.length, 1);
    deepEqual(h.outcomes.map((o) => o.seq), [1, 2, 3]);
  });
});
