// Unit tests for the push-to-talk recording helpers.
//
// Run with: npm test  (node --test; types stripped natively)

import { deepEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CHILD_TURN_CHARS } from "./family-assistant-turn.ts";
import {
  FINAL_CHUNK_GRACE_MS,
  MAX_RECORDING_MS,
  MIN_LIVE_CAPTURE_MS,
  RECORDER_MIME_PREFERENCES,
  STOP_EVENT_TIMEOUT_MS,
  checkChildUtterance,
  pickRecorderMimeType,
  recordingBlobType,
  recordingFileName,
  startPushToTalk,
  voiceCaptureSupported,
  type PushToTalkDeps,
  type PushToTalkOutcome,
  type RecorderControl,
  type RecorderHandlers,
} from "./family-voice.ts";

describe("pickRecorderMimeType", () => {
  it("prefers audio/mp4, the iPad Safari native recording format", () => {
    equal(RECORDER_MIME_PREFERENCES[0], "audio/mp4");
    equal(pickRecorderMimeType(() => true), "audio/mp4");
  });

  it("falls back through webm/opus for desktop browsers", () => {
    equal(
      pickRecorderMimeType((type) => type.startsWith("audio/webm")),
      "audio/webm;codecs=opus",
    );
  });

  it("returns null when nothing is supported, meaning 'browser default'", () => {
    equal(pickRecorderMimeType(() => false), null);
  });

  it("treats a throwing isTypeSupported as unsupported", () => {
    equal(
      pickRecorderMimeType(() => {
        throw new Error("legacy");
      }),
      null,
    );
  });
});

describe("recording file/blob metadata", () => {
  it("names the upload after the actual recorded container", () => {
    equal(recordingFileName("audio/mp4"), "utterance.m4a");
    equal(recordingFileName("audio/mp4;codecs=mp4a.40.2"), "utterance.m4a");
    equal(recordingFileName("audio/webm;codecs=opus"), "utterance.webm");
    equal(recordingFileName("audio/ogg"), "utterance.ogg");
    equal(recordingFileName(null), "utterance.audio");
    equal(recordingFileName(""), "utterance.audio");
  });

  it("gives untyped chunks an octet-stream blob type the transcribe route accepts", () => {
    equal(recordingBlobType("audio/mp4"), "audio/mp4");
    equal(recordingBlobType(""), "application/octet-stream");
    equal(recordingBlobType(null), "application/octet-stream");
  });
});

describe("checkChildUtterance", () => {
  it("accepts and trims ordinary text", () => {
    const result = checkChildUtterance("  Why is the sky blue?  ");
    ok(result.ok);
    equal(result.text, "Why is the sky blue?");
  });

  it("refuses empty and whitespace-only drafts", () => {
    for (const raw of ["", "   ", "\n"]) {
      const result = checkChildUtterance(raw);
      ok(!result.ok);
      equal(result.reason, "empty");
    }
  });

  it("refuses — never truncates — a draft past the bridge bound", () => {
    const result = checkChildUtterance("a".repeat(MAX_CHILD_TURN_CHARS + 1));
    ok(!result.ok);
    equal(result.reason, "overlong");
    equal(result.limit, MAX_CHILD_TURN_CHARS);
  });

  it("accepts a draft exactly at the bound", () => {
    const result = checkChildUtterance("a".repeat(MAX_CHILD_TURN_CHARS));
    ok(result.ok);
  });
});

describe("voiceCaptureSupported", () => {
  const getUserMedia = () => Promise.resolve();
  const Recorder = function () {};

  it("requires both MediaRecorder and getUserMedia", () => {
    equal(
      voiceCaptureSupported({
        MediaRecorder: Recorder,
        navigator: { mediaDevices: { getUserMedia } },
      }),
      true,
    );
    equal(voiceCaptureSupported({ MediaRecorder: Recorder, navigator: {} }), false);
    equal(
      voiceCaptureSupported({ navigator: { mediaDevices: { getUserMedia } } }),
      false,
    );
    equal(voiceCaptureSupported(undefined), false);
  });

  it("does not consult browser SpeechRecognition at all", () => {
    // A browser with ONLY SpeechRecognition is not voice-capable here: the
    // recognizer is no longer the source of truth for anything.
    equal(
      voiceCaptureSupported({
        // @ts-expect-error deliberately probing an unrelated capability
        SpeechRecognition: function () {},
        navigator: {},
      }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The push-to-talk session
//
// The bug these tests exist for: on an iPad the child taps Talk, taps Stop a
// beat later — while `getUserMedia` is still resolving — and the utterance
// disappears with nothing posted anywhere. Every case below is driven off a
// fake clock and a fake recorder, so the whole lifecycle is deterministic.
// ---------------------------------------------------------------------------

/** A clock whose timers only fire when the test says so. */
function makeClock() {
  let time = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => time,
    setTimer(fn: () => void, ms: number): unknown {
      const id = nextId++;
      pending.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer(handle: unknown) {
      pending.delete(handle as number);
    },
    /** Runs every timer due within `ms`, earliest first. */
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Number.POSITIVE_INFINITY;
        for (const [id, timer] of pending) {
          if (timer.at > target) continue;
          if (dueId === null || timer.at < dueAt) {
            dueId = id;
            dueAt = timer.at;
          }
        }
        if (dueId === null) break;
        const timer = pending.get(dueId)!;
        pending.delete(dueId);
        time = timer.at;
        timer.fn();
      }
      time = target;
    },
    armed: () => pending.size,
  };
}

/** Lets a resolved `getUserMedia` promise run its continuation. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type FakeRecorder = ReturnType<typeof makeRecorder>;

function makeRecorder(mimeType: string | null, onStart?: (self: FakeRecorder) => void) {
  const log = { starts: 0, stops: 0, detaches: 0 };
  let handlers: RecorderHandlers | null = null;
  const self = {
    log,
    bind(next: RecorderHandlers) {
      handlers = next;
    },
    /** A `dataavailable` carrying `bytes` bytes. */
    data(bytes: number) {
      handlers?.onData(new Blob(["x".repeat(bytes)]));
    },
    stopEvent() {
      handlers?.onStop();
    },
    errorEvent() {
      handlers?.onError();
    },
    control: {
      start: () => {
        log.starts += 1;
        onStart?.(self);
      },
      stop: () => {
        log.stops += 1;
      },
      mimeType: () => mimeType,
      // Detaching is what the DOM adapter does: events stop arriving.
      detach: () => {
        log.detaches += 1;
        handlers = null;
      },
    } satisfies RecorderControl,
  };
  return self;
}

type HarnessOptions = {
  mimeType?: string | null;
  isTypeSupported?: (type: string) => boolean;
  /** Throw where the real code calls `new MediaRecorder(...)`. */
  createThrows?: boolean;
  /** Runs inside `start()`; used to throw or to fire a synchronous error. */
  onStart?: (recorder: FakeRecorder) => void;
  /** Fail blob assembly, the last thing that can go wrong. */
  blobThrows?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const clock = makeClock();
  const events: string[] = [];
  const outcomes: PushToTalkOutcome[] = [];
  const requestedMimes: (string | null)[] = [];
  const tracks = { stopped: 0 };
  const mediaStream = {
    getTracks: () => [
      { stop: () => { tracks.stopped += 1; } },
      { stop: () => { tracks.stopped += 1; } },
    ],
  };
  const recorder = makeRecorder(
    options.mimeType === undefined ? "audio/mp4" : options.mimeType,
    options.onStart,
  );

  let settleMedia!: (grant: boolean) => void;
  const media = new Promise<typeof mediaStream>((resolve, reject) => {
    settleMedia = (grant) =>
      grant ? resolve(mediaStream) : reject(new Error("NotAllowedError"));
  });

  const deps: PushToTalkDeps<typeof mediaStream> = {
    getUserMedia: () => media,
    isTypeSupported: options.isTypeSupported ?? ((type) => type === "audio/mp4"),
    createRecorder: (_stream, mimeType, handlers) => {
      requestedMimes.push(mimeType);
      if (options.createThrows) throw new Error("MediaRecorder unavailable");
      recorder.bind(handlers);
      return recorder.control;
    },
    onLive: () => events.push("live"),
    onSettle: (outcome) => {
      events.push(`settle:${outcome.kind}`);
      outcomes.push(outcome);
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...(options.blobThrows
      ? {
          createBlob: () => {
            throw new Error("blob assembly failed");
          },
        }
      : {}),
  };

  const session = startPushToTalk(deps);

  return {
    session,
    clock,
    recorder,
    events,
    outcomes,
    requestedMimes,
    tracksStopped: () => tracks.stopped,
    /** Grants (or refuses) the microphone and lets startup finish. */
    async grant(allow = true) {
      settleMedia(allow);
      await flush();
    },
    /** The single outcome, asserting there is exactly one. */
    only(): PushToTalkOutcome {
      equal(outcomes.length, 1, `expected one outcome, got ${events.join(",")}`);
      return outcomes[0]!;
    },
  };
}

/** The common path: live, one chunk, stop honoured. */
async function speakAndStop(h: ReturnType<typeof harness>, bytes = 128) {
  await h.grant();
  h.clock.advance(MIN_LIVE_CAPTURE_MS);
  h.session.stop();
  h.recorder.data(bytes);
  h.recorder.stopEvent();
}

describe("startPushToTalk — startup vs. live", () => {
  it("does not claim to be live until the recorder has started", async () => {
    const h = harness();
    // Permission still pending: nothing has been recorded, so nothing may say so.
    deepEqual(h.events, []);
    await h.grant();
    deepEqual(h.events, ["live"]);
    equal(h.recorder.log.starts, 1);
  });

  it("reports live only after start(), never before", async () => {
    let seenInsideStart: string[] = ["not run"];
    let h!: ReturnType<typeof harness>;
    h = harness({
      onStart: () => {
        seenInsideStart = [...h.events];
      },
    });
    await h.grant();
    deepEqual(seenInsideStart, [], "start() runs before anything is called live");
    deepEqual(h.events, ["live"]);
  });

  it("keeps a Stop tapped during startup and applies it once live", async () => {
    const h = harness();
    // The tap that used to vanish: no recorder exists yet.
    h.session.stop();
    equal(h.recorder.log.starts, 0);
    deepEqual(h.outcomes, []);

    await h.grant();
    // Live first — the UI is told the truth even though a stop is queued.
    deepEqual(h.events, ["live"]);
    equal(h.recorder.log.stops, 0, "the floor has not elapsed yet");

    h.clock.advance(MIN_LIVE_CAPTURE_MS);
    equal(h.recorder.log.stops, 1);
    h.recorder.data(2048);
    h.recorder.stopEvent();

    const outcome = h.only();
    equal(outcome.kind, "recorded");
    ok(outcome.kind === "recorded" && outcome.blob.size === 2048);
  });

  it("still releases the microphone when it is cancelled mid-startup", async () => {
    const h = harness();
    h.session.cancel();
    deepEqual(h.events, ["settle:cancelled"]);
    equal(h.tracksStopped(), 0, "nothing to release yet");
    await h.grant();
    equal(h.tracksStopped(), 2, "the late stream is handed straight back");
    equal(h.recorder.log.starts, 0, "no recorder is built for a cancelled session");
    equal(h.outcomes.length, 1);
  });
});

describe("startPushToTalk — the minimum live capture floor", () => {
  it("holds a stop until the floor has passed, so the turn carries frames", async () => {
    const h = harness();
    await h.grant();
    h.clock.advance(50);
    h.session.stop();
    h.clock.advance(MIN_LIVE_CAPTURE_MS - 51);
    equal(h.recorder.log.stops, 0, "still short of the floor");
    h.clock.advance(1);
    equal(h.recorder.log.stops, 1);
  });

  it("stops immediately once the child has been talking longer than the floor", async () => {
    const h = harness();
    await h.grant();
    h.clock.advance(MIN_LIVE_CAPTURE_MS + 1);
    h.session.stop();
    equal(h.recorder.log.stops, 1);
  });
});

describe("startPushToTalk — assembling the final chunks", () => {
  it("handles data-then-stop, the ordinary ordering", async () => {
    const h = harness();
    await speakAndStop(h, 512);
    const outcome = h.only();
    ok(outcome.kind === "recorded");
    equal(outcome.blob.size, 512);
    equal(outcome.mimeType, "audio/mp4");
    equal(outcome.fileName, "utterance.m4a");
    equal(outcome.blob.type, "audio/mp4");
  });

  it("handles stop-then-data, and does not call it silence", async () => {
    const h = harness();
    await h.grant();
    h.clock.advance(MIN_LIVE_CAPTURE_MS);
    h.session.stop();
    h.recorder.stopEvent();
    deepEqual(h.outcomes, [], "waiting a bounded beat for the last chunk");
    h.recorder.data(256);
    const outcome = h.only();
    ok(outcome.kind === "recorded");
    equal(outcome.blob.size, 256);
  });

  it("gives up on the late chunk after a bounded grace, never hanging", async () => {
    const h = harness();
    await h.grant();
    h.clock.advance(MIN_LIVE_CAPTURE_MS);
    h.session.stop();
    h.recorder.stopEvent();
    h.clock.advance(FINAL_CHUNK_GRACE_MS);
    equal(h.only().kind, "empty");
    equal(h.clock.armed(), 0, "no timer is left running");
  });

  it("finishes on its own when the stop event never arrives", async () => {
    const h = harness();
    await h.grant();
    h.clock.advance(MIN_LIVE_CAPTURE_MS);
    h.recorder.data(64);
    h.session.stop();
    equal(h.recorder.log.stops, 1);
    deepEqual(h.outcomes, [], "no stop event yet");
    h.clock.advance(STOP_EVENT_TIMEOUT_MS);
    const outcome = h.only();
    ok(outcome.kind === "recorded");
    equal(outcome.blob.size, 64);
  });

  it("reports empty for no chunks at all, and for zero-byte ones", async () => {
    for (const bytes of [null, 0]) {
      const h = harness();
      await h.grant();
      h.clock.advance(MIN_LIVE_CAPTURE_MS);
      h.session.stop();
      if (bytes !== null) h.recorder.data(bytes);
      h.recorder.stopEvent();
      h.clock.advance(FINAL_CHUNK_GRACE_MS);
      equal(h.only().kind, "empty");
      equal(h.tracksStopped(), 2);
    }
  });

  it("names the upload after the MIME the recorder actually used", async () => {
    const h = harness({ mimeType: "audio/webm;codecs=opus" });
    await speakAndStop(h);
    const outcome = h.only();
    ok(outcome.kind === "recorded");
    equal(outcome.fileName, "utterance.webm");
  });

  it("asks for the iPad-native container when the browser supports it", async () => {
    const h = harness();
    await h.grant();
    deepEqual(h.requestedMimes, ["audio/mp4"]);
  });

  it("lets the browser choose when no preferred MIME is supported", async () => {
    const h = harness({ isTypeSupported: () => false, mimeType: null });
    await speakAndStop(h);
    deepEqual(h.requestedMimes, [null]);
    const outcome = h.only();
    ok(outcome.kind === "recorded");
    equal(outcome.blob.type, "application/octet-stream");
    equal(outcome.fileName, "utterance.audio");
  });
});

describe("startPushToTalk — failure paths", () => {
  it("reports denied when the microphone says no, and never claims to be live", async () => {
    const h = harness();
    await h.grant(false);
    deepEqual(h.events, ["settle:denied"]);
    equal(h.recorder.log.starts, 0);
    equal(h.tracksStopped(), 0);
  });

  it("reports failed — and releases the microphone — when the recorder cannot be built", async () => {
    const h = harness({ createThrows: true });
    await h.grant();
    deepEqual(h.events, ["settle:failed"]);
    equal(h.tracksStopped(), 2);
  });

  it("reports failed when start() throws", async () => {
    const h = harness({
      onStart: () => {
        throw new Error("no capture");
      },
    });
    await h.grant();
    deepEqual(h.events, ["settle:failed"]);
    equal(h.tracksStopped(), 2);
  });

  it("reports failed on a recorder error event, once", async () => {
    const h = harness();
    await h.grant();
    h.recorder.errorEvent();
    h.recorder.errorEvent();
    deepEqual(h.events, ["live", "settle:failed"]);
    equal(h.tracksStopped(), 2);
  });

  it("reports failed rather than throwing when the blob cannot be assembled", async () => {
    const h = harness({ blobThrows: true });
    await speakAndStop(h);
    equal(h.only().kind, "failed");
    equal(h.tracksStopped(), 2);
  });
});

describe("startPushToTalk — one outcome, one microphone", () => {
  it("is idempotent under repeated stops", async () => {
    const h = harness();
    await h.grant();
    h.clock.advance(MIN_LIVE_CAPTURE_MS);
    h.session.stop();
    h.session.stop();
    h.session.stop();
    equal(h.recorder.log.stops, 1, "the recorder is stopped exactly once");
    h.recorder.data(32);
    h.recorder.stopEvent();
    h.session.stop();
    equal(h.only().kind, "recorded");
  });

  it("stays silent after cancel, whatever the recorder does next", async () => {
    const h = harness();
    await h.grant();
    h.clock.advance(MIN_LIVE_CAPTURE_MS);
    h.session.cancel();
    deepEqual(h.events, ["live", "settle:cancelled"]);
    equal(h.recorder.log.detaches, 1);
    equal(h.tracksStopped(), 2);
    // Late events from a detached recorder cannot resurrect the turn.
    h.recorder.data(4096);
    h.recorder.stopEvent();
    h.clock.advance(STOP_EVENT_TIMEOUT_MS * 2);
    h.session.stop();
    h.session.cancel();
    equal(h.outcomes.length, 1);
    equal(h.clock.armed(), 0);
  });

  it("stops itself at the recording bound and reports what it heard", async () => {
    const h = harness();
    await h.grant();
    h.recorder.data(1024);
    h.clock.advance(MAX_RECORDING_MS);
    equal(h.recorder.log.stops, 1, "a forgotten open mic stops itself");
    h.recorder.stopEvent();
    const outcome = h.only();
    ok(outcome.kind === "recorded");
    equal(outcome.blob.size, 1024);
    equal(h.tracksStopped(), 2);
  });

  it("releases the microphone and detaches on every settled path", async () => {
    const paths: [string, (h: ReturnType<typeof harness>) => Promise<void>][] = [
      ["recorded", async (h) => { await speakAndStop(h); }],
      [
        "empty",
        async (h) => {
          await speakAndStop(h, 0);
          h.clock.advance(FINAL_CHUNK_GRACE_MS);
        },
      ],
      ["failed", async (h) => { await h.grant(); h.recorder.errorEvent(); }],
      ["cancelled", async (h) => { await h.grant(); h.session.cancel(); }],
    ];
    for (const [kind, run] of paths) {
      const h = harness();
      await run(h);
      equal(h.only().kind, kind);
      equal(h.tracksStopped(), 2, `${kind} must release the microphone`);
      equal(h.recorder.log.detaches, 1, `${kind} must detach the recorder`);
      equal(h.clock.armed(), 0, `${kind} must leave no timer running`);
    }
  });
});
