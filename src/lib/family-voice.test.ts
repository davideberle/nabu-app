// Unit tests for the push-to-talk recording helpers.
//
// Run with: npm test  (node --test; types stripped natively)

import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CHILD_TURN_CHARS } from "./family-assistant-turn.ts";
import {
  RECORDER_MIME_PREFERENCES,
  checkChildUtterance,
  pickRecorderMimeType,
  recordingBlobType,
  recordingFileName,
  voiceCaptureSupported,
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
