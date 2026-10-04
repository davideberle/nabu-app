// ---------------------------------------------------------------------------
// Heartbeat controller for the guarded play wrapper (GP-04/05/07).
//
// Exactly one RENEWAL in flight, exactly one timer. A beat requested while a
// renewal is pending is coalesced into one follow-up beat that runs when the
// pending one settles — with one exception: a STOP boundary (the input turned
// from foreground to not-foreground while a foreground renewal is pending) is
// sent at once as its own request, so the meter learns the pause promptly and
// never bills the interval the wrapper already froze. At most one boundary is
// in flight; a second transition coalesces as before. Every outcome is fenced by a generation (the lease
// session) and a sequence number: an outcome of a request that is not the
// latest issued one is discarded, so an older success can never clear a newer
// failure, raise the clock, or re-arm the loop. `stop()` invalidates all
// pending callbacks and clears the timer.
//
// Pure: timers are injected so the unit tests drive it with fake time.
// ---------------------------------------------------------------------------

/**
 * `active`: the frame is armed and running right now (attested to the meter — billing happens only between such
 * reports). `foreground`: the child wants to play (not paused, not hidden) even if the frame is still frozen — the
 * meter answers such a report with a grant; the wrapper then arms the frame and sends a running report at once.
 */
export type HeartbeatInput = { active: boolean; hidden: boolean; paused: boolean; foreground?: boolean };

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
  state: () => { inFlight: boolean; timerArmed: boolean; issued: number; applied: number; generation: number; boundaryInFlight: boolean };
};

export function createHeartbeat<T>(deps: HeartbeatDeps<T>): Heartbeat {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const generation = 1;
  let stopped = false;
  let issued = 0;
  let applied = 0;
  let inFlight = false;
  /** The input the pending renewal was sent with (null when none is pending). */
  let inFlightInput: HeartbeatInput | null = null;
  let boundaryInFlight = false;
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

  /** Send one request outside the single-flight renewal: the stop boundary. Its outcome is fenced like any other. */
  const sendBoundary = async (input: HeartbeatInput) => {
    boundaryInFlight = true;
    const seq = (issued += 1);
    let result: T;
    try {
      result = await deps.send(input, seq);
    } finally {
      boundaryInFlight = false;
    }
    if (stopped) return;
    if (seq === issued && seq > applied) {
      applied = seq;
      deps.onOutcome(result, seq);
    }
    // The renewal may have settled meanwhile and left its follow-up to us.
    if (!inFlight) {
      if (coalesced) {
        coalesced = false;
        void beat();
      } else {
        arm();
      }
    }
  };

  const beat = async () => {
    if (stopped) return;
    if (inFlight) {
      const input = deps.input();
      if (!input.active && inFlightInput?.active && !boundaryInFlight) {
        // Foreground ended while a foreground renewal is pending: report the stop now.
        void sendBoundary(input);
      }
      coalesced = true;
      return;
    }
    inFlight = true;
    disarm();
    const seq = (issued += 1);
    let result: T;
    const input = deps.input();
    inFlightInput = input;
    try {
      result = await deps.send(input, seq);
    } finally {
      inFlight = false;
      inFlightInput = null;
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
    // A stop boundary is still out: it carries the newest state, so no follow-up is issued until it settles.
    if (boundaryInFlight) {
      coalesced = true;
      return;
    }
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
    state: () => ({ inFlight, timerArmed: timer !== null, issued, applied, generation, boundaryInFlight }),
  };
}
