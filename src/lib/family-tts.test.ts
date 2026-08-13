// Unit tests for the server-side ElevenLabs TTS helper.
//
// The security-relevant properties proven here: the request schema is closed
// (unknown fields, wrong children, empty and overlong text are refusals, not
// repairs); voice IDs resolve server-side with safe premade defaults so no
// browser value can pick a voice; a malformed configured voice ID can never be
// interpolated into the provider URL; and an upstream failure surfaces a
// status plus a *bounded* operator detail rather than the raw provider body.
//
// Run with: npm test  (node --test; types stripped natively)

import { equal, match, ok, rejects } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHILD_TTS_CONTENT_TYPE,
  CHILD_TTS_MODEL_ID,
  CHILD_TTS_OUTPUT_FORMAT,
  CHILD_VOICE_ENV_VARS,
  MAX_CHILD_SPEECH_CHARS,
  TtsConfigError,
  TtsUpstreamError,
  parseChildTtsRequest,
  resolveChildVoiceId,
  synthesizeChildSpeech,
} from "./family-tts.ts";

describe("parseChildTtsRequest", () => {
  it("accepts exactly childId and text, trimming the text", () => {
    const result = parseChildTtsRequest({ childId: "santiago", text: "  Hello!  " });
    ok(result.ok);
    equal(result.request.childId, "santiago");
    equal(result.request.text, "Hello!");
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, "text", 4, ["childId"]]) {
      const result = parseChildTtsRequest(bad);
      ok(!result.ok);
      equal(result.issue, "not-an-object");
    }
  });

  it("rejects unknown fields by refusal, not by ignoring them", () => {
    const result = parseChildTtsRequest({
      childId: "isabel",
      text: "hi",
      voiceId: "attacker-chosen",
    });
    ok(!result.ok);
    equal(result.issue, "unknown-field");
  });

  it("rejects invalid child ids", () => {
    for (const child of ["main", "", 7, null, "SANTIAGO"]) {
      const result = parseChildTtsRequest({ childId: child, text: "hi" });
      ok(!result.ok);
      equal(result.issue, "invalid-child");
    }
  });

  it("rejects empty and whitespace-only text", () => {
    for (const text of ["", "   ", "\n\t"]) {
      const result = parseChildTtsRequest({ childId: "santiago", text });
      ok(!result.ok);
      equal(result.issue, "empty-text");
    }
  });

  it("rejects text past the speech bound", () => {
    const result = parseChildTtsRequest({
      childId: "santiago",
      text: "a".repeat(MAX_CHILD_SPEECH_CHARS + 1),
    });
    ok(!result.ok);
    equal(result.issue, "overlong-text");
  });
});

describe("resolveChildVoiceId", () => {
  it("uses the configured env voice per child", () => {
    equal(
      resolveChildVoiceId("santiago", { [CHILD_VOICE_ENV_VARS.santiago]: "AbCdEf123456" }),
      "AbCdEf123456",
    );
    equal(
      resolveChildVoiceId("isabel", { [CHILD_VOICE_ENV_VARS.isabel]: "XyZ987654321" }),
      "XyZ987654321",
    );
  });

  it("falls back to a premade default when unset, and the defaults differ per child", () => {
    const santiago = resolveChildVoiceId("santiago", {});
    const isabel = resolveChildVoiceId("isabel", {});
    ok(santiago.length >= 8);
    ok(isabel.length >= 8);
    ok(santiago !== isabel);
  });

  it("refuses a malformed configured value rather than interpolating it", () => {
    const fallback = resolveChildVoiceId("santiago", {});
    for (const bad of ["../../admin", "abc def", "x", "id?stream=1", ""]) {
      equal(resolveChildVoiceId("santiago", { [CHILD_VOICE_ENV_VARS.santiago]: bad }), fallback);
    }
  });

  it("never reads a NEXT_PUBLIC variable", () => {
    for (const name of Object.values(CHILD_VOICE_ENV_VARS)) {
      ok(!name.startsWith("NEXT_PUBLIC"));
    }
  });
});

describe("synthesizeChildSpeech", () => {
  const request = { childId: "santiago" as const, text: "Hello there!" };

  it("throws a config error without an API key", async () => {
    await rejects(
      synthesizeChildSpeech(request, { env: {} }),
      (error: unknown) => error instanceof TtsConfigError,
    );
  });

  it("posts the text to the resolved voice with the multilingual low-latency model", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(audio, { status: 200 });
    }) as typeof fetch;

    const result = await synthesizeChildSpeech(request, {
      fetchImpl,
      env: { ELEVENLABS_API_KEY: "key", [CHILD_VOICE_ENV_VARS.santiago]: "VoiceAbc12345" },
    });

    ok(captured !== null);
    const call = captured as { url: string; init: RequestInit };
    match(call.url, /\/v1\/text-to-speech\/VoiceAbc12345\?/);
    match(call.url, new RegExp(`output_format=${CHILD_TTS_OUTPUT_FORMAT}`));
    const headers = call.init.headers as Record<string, string>;
    equal(headers["xi-api-key"], "key");
    const body = JSON.parse(String(call.init.body));
    equal(body.text, "Hello there!");
    equal(body.model_id, CHILD_TTS_MODEL_ID);
    equal(result.contentType, CHILD_TTS_CONTENT_TYPE);
    equal(result.audio.byteLength, 3);
  });

  it("maps an upstream failure to a status plus a bounded operator detail", async () => {
    const fetchImpl = (async () =>
      new Response("provider internals ".repeat(100), { status: 422 })) as typeof fetch;
    await rejects(
      synthesizeChildSpeech(request, { fetchImpl, env: { ELEVENLABS_API_KEY: "key" } }),
      (error: unknown) => {
        ok(error instanceof TtsUpstreamError);
        equal(error.status, 422);
        ok(error.operatorDetail.length <= 200);
        // The child-facing message never carries the provider body.
        ok(!error.message.includes("provider internals"));
        return true;
      },
    );
  });
});
