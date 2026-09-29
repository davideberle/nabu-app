// ---------------------------------------------------------------------------
// Read-aloud controller with lifecycle fencing (review R3-4).
//
// A play request first records the `read_aloud` support (durable, conservative:
// the record stays even if playback never happens), then plays — but only if
// nothing invalidated the request while the acknowledgement was pending:
// stop, dispose (control removed / task or selected word changed) or a newer
// play request. Every request carries a generation; the acknowledgement of a
// superseded generation is ignored, so a late acknowledgement can never start
// old audio. Pure orchestration with injected dependencies.
//
// Honest outcome (independent M3 review, 2026-09-29): `play` resolves
// "played" ONLY when the speech dependency itself reported "played". A fetch
// or playback failure ("fallback") resolves "unavailable" so the control can
// show an accessible audio-unavailable state; any other non-played result of
// a still-current request — the shared speech player was cancelled by another
// speaker, e.g. the tutor reading its reply — resolves "interrupted", so the
// mounted control settles back to idle (A01, independent M3-repair review).
// "superseded"/"disposed" are reserved for this controller's own stop, newer
// request or dispose, whose state the control has already handled; an older
// request therefore can never clear a newer one. The support record stays
// conservative: it is written before playing and is not undone when playback
// fails.
// ---------------------------------------------------------------------------

export type ReadAloudDeps = {
  /** Record the support; resolves true only when the server confirmed it. */
  record: (text: string) => Promise<boolean>;
  /**
   * Play the text; resolves when playback ends, fails or is cancelled with the
   * speech player's own outcome ("played" | "fallback" | "cancelled").
   */
  speak: (text: string, rate?: number) => Promise<unknown>;
  /** Stop any current playback immediately. */
  cancelSpeech: () => void;
  unlock?: () => void;
};

export type ReadAloudController = {
  /**
   * Play (recording first on the first play of this text). Resolves with what
   * happened: "played" only for finished playback; "unavailable" when speech
   * could not be fetched or played (text and manual controls stay usable);
   * "interrupted" when another speaker cancelled this still-current request.
   */
  play: (text: string, rate?: number) => Promise<ReadAloudOutcome>;
  /** Stop playback and invalidate any pending acknowledgement. */
  stop: () => void;
  /** Control removed: stop, and refuse everything afterwards. */
  dispose: () => void;
  isPlaying: () => boolean;
  /** Texts whose support has been recorded (for the repeat/slow controls). */
  isRecorded: (text: string) => boolean;
};

export type ReadAloudOutcome = "played" | "unavailable" | "interrupted" | "not-recorded" | "superseded" | "disposed";

export function createReadAloudController(deps: ReadAloudDeps): ReadAloudController {
  let generation = 0;
  let disposed = false;
  let playing = false;
  const recorded = new Set<string>();

  function invalidate() {
    generation += 1;
    if (playing) {
      playing = false;
      deps.cancelSpeech();
    }
  }

  return {
    async play(text, rate) {
      if (disposed) return "disposed";
      invalidate();
      const mine = generation;
      deps.unlock?.();
      if (!recorded.has(text)) {
        const ok = await deps.record(text);
        // The acknowledgement is for THIS request only.
        if (disposed) return "disposed";
        if (mine !== generation) return "superseded";
        if (!ok) return "not-recorded";
        recorded.add(text);
      }
      if (disposed || mine !== generation) return disposed ? "disposed" : "superseded";
      playing = true;
      let result: unknown;
      try {
        result = await deps.speak(text, rate);
      } catch {
        result = "fallback";
      } finally {
        if (mine === generation) playing = false;
      }
      if (disposed) return "disposed";
      if (mine !== generation) return "superseded";
      if (result === "played") return "played";
      if (result === "fallback") return "unavailable";
      // Cancelled underneath us by another speaker: not played, not an audio
      // failure — the still-current request is over and the control may idle.
      return "interrupted";
    },
    stop() {
      invalidate();
    },
    dispose() {
      disposed = true;
      invalidate();
    },
    isPlaying: () => playing,
    isRecorded: (text) => recorded.has(text),
  };
}
