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
  it("keeps exactly one RENEWAL in flight, but a stop boundary (pause while a foreground renewal waits) is sent at once; continue is coalesced", async () => {
    const h = harness();
    h.hb.request();
    await h.tick();
    equal(h.pending.length, 1);
    equal(h.pending[0].input.active, true);
    // Pause: the frame is frozen by the wrapper; the meter must learn it now, not when the renewal returns.
    h.setInput({ active: false, hidden: false, paused: true });
    h.hb.request();
    await h.tick();
    equal(h.pending.length, 2, "the stop boundary went out immediately");
    equal(h.pending[1].input.active, false);
    equal(h.hb.state().boundaryInFlight, true);
    // Continue while both wait: coalesced (no third request, foreground is only reported after an answer).
    h.setInput({ active: true, hidden: false, paused: false });
    h.hb.request();
    h.hb.request();
    await h.tick();
    equal(h.pending.length, 2, "no third request while the renewal and the boundary are pending");
    // The older renewal answers first: fenced out (the boundary is newer), and no follow-up is issued while the boundary is out.
    h.pending[0].resolve("renewal");
    await h.tick();
    equal(h.outcomes.length, 0);
    equal(h.pending.length, 2, "the follow-up waits for the boundary to settle");
    // The boundary answers: it speaks, then the coalesced follow-up goes out with the latest state (continue).
    h.pending[1].resolve("boundary");
    await h.tick();
    deepEqual(h.outcomes.map((o) => o.result), ["boundary"]);
    equal(h.pending.length, 3, "the coalesced follow-up was issued once the boundary settled");
    equal(h.pending[2].input.active, true, "with the latest state (continue)");
    h.pending[2].resolve("follow-up");
    await h.tick();
    deepEqual(h.outcomes.map((o) => o.result), ["boundary", "follow-up"]);
    equal(h.hb.state().inFlight, false);
    equal(h.timers.length, 1, "exactly one timer armed afterwards");
  });

  it("a second stop transition while a boundary is already in flight coalesces; a pause while nothing is pending is an ordinary beat", async () => {
    const h = harness();
    h.hb.request();
    await h.tick();
    h.setInput({ active: false, hidden: false, paused: true });
    h.hb.request();
    await h.tick();
    equal(h.pending.length, 2);
    h.setInput({ active: false, hidden: true, paused: true });
    h.hb.request();
    await h.tick();
    equal(h.pending.length, 2, "one boundary at a time");
    h.pending[1].resolve("boundary");
    h.pending[0].resolve("renewal");
    await h.tick();
    await h.tick();
    equal(h.pending.length, 3, "the coalesced beat follows");
    h.pending[2].resolve("beat");
    await h.tick();
    equal(h.hb.state().inFlight, false);
    h.setInput({ active: false, hidden: false, paused: true });
    h.hb.request();
    await h.tick();
    equal(h.pending.length, 4, "with nothing pending a pause report is a normal single-flight beat");
    equal(h.hb.state().boundaryInFlight, false);
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
