// Unit tests for the server-side ElevenLabs Scribe v2 STT helper.
//
// The properties proven here: the upstream request pins the model and privacy
// settings but sends NO language_code, so Scribe auto-detects the household's
// three languages (English/German/Spanish) instead of mistranscribing two of
// them as English; upload refusals are closed messages that never echo a
// client-supplied content type; and the per-identity admission window bounds
// requests before any credential is spent.
//
// Run with: npm test  (node --test; types stripped natively)

import { equal, match, ok, rejects } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIO_UPLOAD_ISSUE_MESSAGES,
  MAX_AUDIO_BYTES,
  STT_MODEL_ID,
  TRANSCRIPTIONS_PER_WINDOW,
  TRANSCRIPTION_WINDOW_MS,
  TranscriptionConfigError,
  buildSttForm,
  checkAudioUpload,
  createTranscriptionAdmission,
  transcribeAudio,
} from "./family-transcription.ts";

const sampleAudio = () =>
  new File([new Uint8Array([1, 2, 3])], "utterance.m4a", { type: "audio/mp4" });

describe("buildSttForm", () => {
  it("sends the model and privacy settings but no language pin", () => {
    const file = sampleAudio();
    const form = buildSttForm(file);
    equal(form.get("model_id"), STT_MODEL_ID);
    equal(form.get("no_verbatim"), "true");
    equal(form.get("timestamps_granularity"), "none");
    equal(form.get("file"), file);
    // The release-blocking property: no language_code, ever. Scribe v2
    // auto-detects English/German/Spanish per utterance.
    equal(form.has("language_code"), false);
    // And nothing else sneaks in beside the four intended fields.
    equal([...form.keys()].length, 4);
  });
});

describe("transcribeAudio", () => {
  it("throws a config error without an API key", async () => {
    await rejects(
      transcribeAudio(sampleAudio(), { env: {} }),
      (error: unknown) => error instanceof TranscriptionConfigError,
    );
  });

  it("posts the built form to the STT endpoint and trims the transcript", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return Response.json({ text: "  ¿Por qué es azul el cielo?  " });
    }) as typeof fetch;

    const result = await transcribeAudio(sampleAudio(), {
      fetchImpl,
      env: { ELEVENLABS_API_KEY: "key" },
    });

    ok(captured !== null);
    const call = captured as { url: string; init: RequestInit };
    match(call.url, /\/v1\/speech-to-text$/);
    equal((call.init.headers as Record<string, string>)["xi-api-key"], "key");
    const body = call.init.body;
    ok(body instanceof FormData);
    equal(body.get("model_id"), STT_MODEL_ID);
    equal(body.has("language_code"), false);
    equal(result.transcript, "¿Por qué es azul el cielo?");
    equal(result.provider, "elevenlabs");
    equal(result.model, STT_MODEL_ID);
  });

  it("maps an upstream failure to an operator error, not a config error", async () => {
    const fetchImpl = (async () =>
      new Response("provider internals ".repeat(100), { status: 422 })) as typeof fetch;
    await rejects(
      transcribeAudio(sampleAudio(), { fetchImpl, env: { ELEVENLABS_API_KEY: "key" } }),
      (error: unknown) => {
        ok(error instanceof Error);
        ok(!(error instanceof TranscriptionConfigError));
        match(error.message, /ElevenLabs STT failed \(422\)/);
        // Detail is bounded for the server log.
        ok(error.message.length <= 250);
        return true;
      },
    );
  });
});

describe("checkAudioUpload", () => {
  const fileOf = (bytes: number, type: string) =>
    new File([new Uint8Array(bytes)], "utterance.audio", { type });

  it("accepts audio/*, video/webm and octet-stream uploads", () => {
    for (const type of ["audio/mp4", "audio/webm;codecs=opus", "video/webm", "application/octet-stream"]) {
      const result = checkAudioUpload(fileOf(3, type));
      ok(result.ok, `expected ${type} to be accepted`);
    }
  });

  it("refuses a missing, non-file, or empty upload", () => {
    for (const bad of [null, undefined, "a string", fileOf(0, "audio/mp4")]) {
      const result = checkAudioUpload(bad);
      ok(!result.ok);
      equal(result.issue, "missing-audio");
    }
  });

  it("refuses unsupported types with a closed message that never echoes them", () => {
    const hostileType = "text/html; charset=utf-8 <script>alert(1)</script>";
    const result = checkAudioUpload(
      new File([new Uint8Array(3)], "x", { type: "text/html" }),
    );
    ok(!result.ok);
    equal(result.issue, "unsupported-type");
    const message = AUDIO_UPLOAD_ISSUE_MESSAGES[result.issue];
    equal(message, "Unsupported audio content type");
    ok(!message.includes("text/html"));
    ok(!message.includes(hostileType));
  });

  it("refuses oversized files with a closed message that never echoes the size", () => {
    const result = checkAudioUpload(fileOf(MAX_AUDIO_BYTES + 1, "audio/mp4"));
    ok(!result.ok);
    equal(result.issue, "oversized");
    match(AUDIO_UPLOAD_ISSUE_MESSAGES[result.issue], /^Audio file is too large$/);
  });

  it("accepts a file exactly at the byte bound", () => {
    ok(checkAudioUpload(fileOf(MAX_AUDIO_BYTES, "audio/mp4")).ok);
  });
});

describe("createTranscriptionAdmission", () => {
  it("admits the child-use allowance within a window, then refuses", () => {
    const admit = createTranscriptionAdmission();
    for (let i = 0; i < TRANSCRIPTIONS_PER_WINDOW; i += 1) {
      equal(admit("household@example.com", 1_000 + i), true);
    }
    equal(admit("household@example.com", 2_000), false);
  });

  it("opens a fresh window once the previous one has elapsed", () => {
    const admit = createTranscriptionAdmission();
    for (let i = 0; i <= TRANSCRIPTIONS_PER_WINDOW; i += 1) {
      admit("household@example.com", 1_000);
    }
    equal(admit("household@example.com", 1_000), false);
    equal(admit("household@example.com", 1_000 + TRANSCRIPTION_WINDOW_MS), true);
  });

  it("counts identities independently", () => {
    const admit = createTranscriptionAdmission();
    for (let i = 0; i <= TRANSCRIPTIONS_PER_WINDOW; i += 1) {
      admit("a@example.com", 1_000);
    }
    equal(admit("a@example.com", 1_000), false);
    equal(admit("b@example.com", 1_000), true);
  });

  it("gives each factory call isolated state", () => {
    const first = createTranscriptionAdmission();
    for (let i = 0; i <= TRANSCRIPTIONS_PER_WINDOW; i += 1) first("x", 1_000);
    equal(first("x", 1_000), false);
    equal(createTranscriptionAdmission()("x", 1_000), true);
  });
});
