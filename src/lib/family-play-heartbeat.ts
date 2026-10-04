// ---------------------------------------------------------------------------
// Heartbeat controller for the guarded play wrapper (GP-04/05/07).
//
// Exactly one request in flight, exactly one timer. A beat requested while a
// request is pending is coalesced into one follow-up beat that runs when the
// pending one settles. Every outcome is fenced by a generation (the lease
// session) and a sequence number: an outcome of a request that is not the
// latest issued one is discarded, so an older success can never clear a newer
// failure, raise the clock, or re-arm the loop. `stop()` invalidates all
// pending callbacks and clears the timer.
//
// Pure: timers are injected so the unit tests drive it with fake time.
// ---------------------------------------------------------------------------

export type HeartbeatInput = { active: boolean; hidden: boolean; paused: boolean };

export type HeartbeatDeps<T> = {
  /** Perform one heartbeat with the CURRENT input; must never throw (return a result). */
  send: (input: HeartbeatInput, seq: number) => Promise<T>;
  /** Current wrapper state, read at send time (not when the beat was requested). */
  input: () => HeartbeatInput;
  /** Called only for outcomes that pass the fence: the latest issued request of the live generation. */
  onOutcome: (result: T, seq: number) => void;
  intervalMs: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type Heartbeat = {
  /** Ask for a beat now; coalesced if one is in flight. */
  request: () => void;
  /** Invalidate every pending callback and stop the loop. */
  stop: () => void;
  /** Introspection for tests and the wrapper. */
  state: () => { inFlight: boolean; timerArmed: boolean; issued: number; applied: number; generation: number };
};

export function createHeartbeat<T>(deps: HeartbeatDeps<T>): Heartbeat {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const generation = 1;
  let stopped = false;
  let issued = 0;
  let applied = 0;
  let inFlight = false;
  let coalesced = false;
  let timer: unknown = null;

  const disarm = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const arm = () => {
    disarm();
    if (stopped) return;
    timer = setTimer(() => {
      timer = null;
      void beat();
    }, deps.intervalMs);
  };

  const beat = async () => {
    if (stopped) return;
    if (inFlight) {
      coalesced = true;
      return;
    }
    inFlight = true;
    disarm();
    const seq = (issued += 1);
    let result: T;
    try {
      result = await deps.send(deps.input(), seq);
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    // Fence: only the latest issued request may speak (single-flight makes
    // this equal to "this request", but a stop/restart or a late resolver
    // must still be refused).
    if (seq === issued && seq > applied) {
      applied = seq;
      deps.onOutcome(result, seq);
    }
    if (stopped) return;
    if (coalesced) {
      coalesced = false;
      void beat();
    } else {
      arm();
    }
  };

  return {
    request: () => {
      void beat();
    },
    stop: () => {
      stopped = true;
      coalesced = false;
      disarm();
    },
    state: () => ({ inFlight, timerArmed: timer !== null, issued, applied, generation }),
  };
}
