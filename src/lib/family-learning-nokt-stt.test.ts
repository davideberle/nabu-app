// Unit tests for Nokt's microphone transcription adapter and its client call.
// Fake fetch only: no network, no key, no provider call, fictional audio bytes.
//
// Run with: npm test  (node --test; types stripped natively)

import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { describe, it } from "node:test";
import { noktModeFromEnv } from "./family-learning-nokt.ts";
import { createLearningClient, LEARNING_NOKT_TRANSCRIBE_PATH, LEARNING_SESSION_PATH } from "./family-learning-client.ts";
import {
  buildNoktSttForm,
  FICTIONAL_TRANSCRIPT,
  fictionalNoktTranscriber,
  NOKT_TRANSCRIPTION_AUTHORIZATION,
  NOKT_STT_MODEL,
  noktSttModeFromEnv,
  noktTranscriberFor,
  noktSttFailure,
  NoktSttUpstreamError,
  OPENAI_TRANSCRIPTIONS_URL,
  openAiNoktTranscriber,
} from "./family-learning-nokt-stt.ts";

const audio = () => new File([new Uint8Array([1, 2, 3, 4])], "utterance.m4a", { type: "audio/mp4" });
const ISOLATED = { NABU_DB_DIR: "/tmp/fixture-db", FAMILY_NOKT_FICTIONAL_STUB: "1" };
const FAKE_KEY = "sk-fictional-test-key";

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

describe("Nokt STT — owner selection gpt-transcribe, no expected-answer bias", () => {
  it("sends the model, the audio and the German language hint only — no prompt, no keywords, no task text", () => {
    const form = buildNoktSttForm(audio());
    deepEqual([...form.keys()].sort(), ["file", "languages[]", "model"]);
    equal(form.get("model"), "gpt-transcribe");
    equal(NOKT_STT_MODEL, "gpt-transcribe");
    deepEqual(form.getAll("languages[]"), ["de"]);
    equal(form.get("prompt"), null);
    equal(form.getAll("keywords[]").length, 0);
    // The adapter's signature takes no task context at all: there is no way to pass an answer key in.
    equal(openAiNoktTranscriber(FAKE_KEY).transcribe.length, 2);
  });

  it("posts to the documented transcription endpoint with the key as bearer and returns the trimmed text", async () => {
    const f = fakeFetch(() => Response.json({ text: "  fünf Tragen, glaube ich  ", languages: [{ code: "de" }] }));
    const out = await openAiNoktTranscriber(FAKE_KEY, { fetchImpl: f.impl }).transcribe(audio(), new AbortController().signal);
    deepEqual(out, { transcript: "fünf Tragen, glaube ich", provider: "openai", model: "gpt-transcribe" });
    equal(f.calls.length, 1);
    equal(f.calls[0].url, OPENAI_TRANSCRIPTIONS_URL);
    equal(f.calls[0].url, "https://api.openai.com/v1/audio/transcriptions");
    equal(f.calls[0].init.method, "POST");
    equal((f.calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${FAKE_KEY}`);
    ok(f.calls[0].init.body instanceof FormData);
  });

  it("a wrong answer is returned as heard — the adapter never rewrites the transcript", async () => {
    const f = fakeFetch(() => Response.json({ text: "fünf" }));
    const out = await openAiNoktTranscriber(FAKE_KEY, { fetchImpl: f.impl }).transcribe(audio(), new AbortController().signal);
    equal(out.transcript, "fünf");
  });

  it("an upstream failure carries the status only — the upstream body (which may quote the request) is never read", async () => {
    let bodyRead = false;
    const f = fakeFetch(() => {
      const r = new Response("echo: Ich heisse Santi", { status: 400 });
      const original = r.text.bind(r);
      r.text = async () => {
        bodyRead = true;
        return original();
      };
      return r;
    });
    await rejects(openAiNoktTranscriber(FAKE_KEY, { fetchImpl: f.impl }).transcribe(audio(), new AbortController().signal), (e: unknown) => e instanceof NoktSttUpstreamError && e.status === 400 && !e.message.includes("Santi"));
    equal(bodyRead, false);
  });

  it("cancellation: the caller's abort reaches the upstream request", async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | null = null;
    const f = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          upstreamSignal = call.init.signal ?? null;
          call.init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = openAiNoktTranscriber(FAKE_KEY, { fetchImpl: f.impl }).transcribe(audio(), controller.signal);
    controller.abort();
    await rejects(pending);
    ok(upstreamSignal && (upstreamSignal as AbortSignal).aborted);
  });

  it("a stuck upstream is bounded by the timeout", async () => {
    const f = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
        }),
    );
    await rejects(openAiNoktTranscriber(FAKE_KEY, { fetchImpl: f.impl, timeoutMs: 20 }).transcribe(audio(), new AbortController().signal));
  });
});

describe("Nokt STT — owner-authorized activation, explicit per deployment", () => {
  it("records the owner's authorization (recognition only)", () => {
    equal(NOKT_TRANSCRIPTION_AUTHORIZATION.at, "2026-10-23T12:32+02:00");
    ok(NOKT_TRANSCRIPTION_AUTHORIZATION.scope.includes("gpt-transcribe"));
  });

  it("a deployment transcribes only with the explicit provider setting AND a key", () => {
    const deployed = { VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://x" };
    deepEqual(noktSttModeFromEnv(deployed), { kind: "off" });
    deepEqual(noktSttModeFromEnv({ ...deployed, OPENAI_API_KEY: FAKE_KEY }), { kind: "off" }, "a key alone never selects a paid provider");
    deepEqual(noktSttModeFromEnv({ ...deployed, FAMILY_NOKT_STT_PROVIDER: "openai" }), { kind: "unconfigured" });
    deepEqual(noktSttModeFromEnv({ ...deployed, FAMILY_NOKT_STT_PROVIDER: "openai", OPENAI_API_KEY: FAKE_KEY }), { kind: "openai", apiKey: FAKE_KEY });
    deepEqual(noktSttModeFromEnv({ ...deployed, FAMILY_NOKT_STT_PROVIDER: "elevenlabs", OPENAI_API_KEY: FAKE_KEY }), { kind: "off" }, "no other provider name is honoured");
    equal(noktTranscriberFor({ kind: "off" }), null);
    equal(noktTranscriberFor({ kind: "unconfigured" }), null);
  });

  it("activating recognition does not enable Nokt's conversation", () => {
    const deployed = { VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://x", FAMILY_NOKT_STT_PROVIDER: "openai", OPENAI_API_KEY: FAKE_KEY };
    equal(noktSttModeFromEnv(deployed).kind, "openai");
    equal(noktModeFromEnv(deployed), "unavailable");
    equal(noktModeFromEnv({ ...deployed, FAMILY_NOKT_FICTIONAL_STUB: "1" }), "unavailable");
  });

  it("round 16: the real conversation (`subscription`) is OFF by default and needs the explicit switch AND a ready https bridge", () => {
    const prod = { VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://x", FAMILY_ASSISTANT_BRIDGE_URL: "https://dae-macmini.example.ts.net:8787", FAMILY_BRIDGE_TOKEN_SECRET: "s".repeat(40) };
    equal(noktModeFromEnv(prod), "unavailable", "today's production env: off");
    equal(noktModeFromEnv({ ...prod, FAMILY_NOKT_CONVERSATION: "subscription" }), "subscription");
    for (const v of ["on", "1", "true", "SUBSCRIPTION", ""]) equal(noktModeFromEnv({ ...prod, FAMILY_NOKT_CONVERSATION: v }), "unavailable", `only the exact value: ${v}`);
    equal(noktModeFromEnv({ ...prod, FAMILY_NOKT_CONVERSATION: "subscription", FAMILY_ASSISTANT_BRIDGE_URL: "http://dae-macmini.example.ts.net:8787" }), "unavailable", "plaintext bridge");
    equal(noktModeFromEnv({ ...prod, FAMILY_NOKT_CONVERSATION: "subscription", FAMILY_ASSISTANT_BRIDGE_URL: "" }), "unavailable", "no bridge");
    equal(noktModeFromEnv({ ...prod, FAMILY_NOKT_CONVERSATION: "subscription", FAMILY_BRIDGE_TOKEN_SECRET: "short" }), "unavailable", "no usable secret");
    equal(noktModeFromEnv({ ...prod, FAMILY_NOKT_FICTIONAL_STUB: "1", FAMILY_NOKT_CONVERSATION: "subscription" }), "subscription", "the stub flag never applies on Vercel");
    equal(noktModeFromEnv({ ...ISOLATED, FAMILY_NOKT_CONVERSATION: "subscription" }), "fictional-stub", "the isolated stub stays the stub");
    // the conversation switch does not turn on the microphone: transcription stays its own decision
    deepEqual(noktSttModeFromEnv({ ...prod, FAMILY_NOKT_CONVERSATION: "subscription" }), { kind: "off" });
  });

  it("the isolated fictional database uses the fake unless OpenAI is named explicitly; the fake never runs anywhere else", () => {
    deepEqual(noktSttModeFromEnv(ISOLATED), { kind: "fictional-fake", fault: null });
    deepEqual(noktSttModeFromEnv({ ...ISOLATED, OPENAI_API_KEY: FAKE_KEY }), { kind: "fictional-fake", fault: null });
    deepEqual(noktSttModeFromEnv({ ...ISOLATED, FAMILY_NOKT_STT_PROVIDER: "openai", OPENAI_API_KEY: FAKE_KEY }), { kind: "openai", apiKey: FAKE_KEY });
    deepEqual(noktSttModeFromEnv({ NABU_DB_DIR: "/tmp/x" }), { kind: "off" }, "an isolated DB without the stub flag does not transcribe");
    deepEqual(noktSttModeFromEnv({ ...ISOLATED, VERCEL_URL: "x.vercel.app" }), { kind: "off" });
  });

  it("the fake makes no network call and returns a fictional sentence that answers no task", async () => {
    const out = await fictionalNoktTranscriber().transcribe(audio(), new AbortController().signal);
    deepEqual(out, { transcript: FICTIONAL_TRANSCRIPT, provider: "fictional-fake", model: "none" });
    ok(!/\d|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn/i.test(FICTIONAL_TRANSCRIPT));
    const aborted = new AbortController();
    aborted.abort();
    await rejects(fictionalNoktTranscriber().transcribe(audio(), aborted.signal));
  });
});

describe("Nokt STT — exhausted provider account (Nabu's smoke: HTTP 429 credit_balance_exhausted)", () => {
  it("OpenAI 429 is an upstream error with the status only; its body is never read", async () => {
    let bodyRead = false;
    const f = fakeFetch(() => {
      const r = Response.json({ error: { code: "credit_balance_exhausted", message: "fictional" } }, { status: 429 });
      r.json = async () => {
        bodyRead = true;
        return {};
      };
      r.text = async () => {
        bodyRead = true;
        return "";
      };
      return r;
    });
    await rejects(openAiNoktTranscriber(FAKE_KEY, { fetchImpl: f.impl }).transcribe(audio(), new AbortController().signal), (e: unknown) => e instanceof NoktSttUpstreamError && e.status === 429);
    equal(bodyRead, false);
  });

  it("the route answers 503 «cannot listen» for account/billing/quota refusals and 502 otherwise — never a transcript", () => {
    for (const status of [401, 402, 403, 429]) deepEqual(noktSttFailure(new NoktSttUpstreamError(status)), { status: 503, error: "Nokt cannot listen right now" });
    deepEqual(noktSttFailure(new NoktSttUpstreamError(500)), { status: 502, error: "Transcription failed" });
    deepEqual(noktSttFailure(new DOMException("timeout", "TimeoutError")), { status: 502, error: "Transcription failed" });
  });

  it("the isolated stub can simulate it with the FAKE only", async () => {
    deepEqual(noktSttModeFromEnv({ ...ISOLATED, FAMILY_NOKT_STT_FAKE_FAULT: "quota" }), { kind: "fictional-fake", fault: "quota" });
    deepEqual(noktSttModeFromEnv({ VERCEL: "1", FAMILY_NOKT_STT_FAKE_FAULT: "quota" }), { kind: "off" });
    await rejects(fictionalNoktTranscriber("quota").transcribe(audio(), new AbortController().signal), (e: unknown) => e instanceof NoktSttUpstreamError && e.status === 429);
  });

  it("the client turns the 503 into «unavailable», not a transcript", async () => {
    const session = () => Response.json({ child: "santiago", token: "t", expiresAt: Date.now() + 3_600_000 });
    const client = createLearningClient({ fetchImpl: fakeFetch((c) => (c.url === LEARNING_SESSION_PATH ? session() : Response.json({ error: "Nokt cannot listen right now" }, { status: 503 }))).impl });
    deepEqual(await client.transcribeNokt("santiago", new Blob(["x"]), "u.m4a", { signal: new AbortController().signal }), { ok: false, failure: "unavailable", status: 503 });
  });
});

describe("Nokt STT — client upload", () => {
  const session = () => Response.json({ child: "santiago", token: "learning-token", expiresAt: Date.now() + 3_600_000 });

  it("uploads the recording with the child learning credential and returns the transcript for the editable field", async () => {
    const f = fakeFetch((call) => (call.url === LEARNING_SESSION_PATH ? session() : Response.json({ transcript: " Ich weiss es nicht. ", provider: "fictional-fake", model: "none" })));
    const client = createLearningClient({ fetchImpl: f.impl });
    const out = await client.transcribeNokt("santiago", new Blob([new Uint8Array([9])], { type: "audio/mp4" }), "utterance.m4a", { signal: new AbortController().signal });
    deepEqual(out, { ok: true, transcript: "Ich weiss es nicht." });
    const upload = f.calls.find((c) => c.url === LEARNING_NOKT_TRANSCRIBE_PATH)!;
    equal(upload.init.method, "POST");
    equal((upload.init.headers as Record<string, string>).Authorization, "Bearer learning-token");
    const body = upload.init.body as FormData;
    deepEqual([...body.keys()], ["audio"]);
    equal((body.get("audio") as File).name, "utterance.m4a");
  });

  it("maps refusal, empty and cancellation to outcomes the panel turns into the typing fallback", async () => {
    const unavailable = createLearningClient({ fetchImpl: fakeFetch((c) => (c.url === LEARNING_SESSION_PATH ? session() : Response.json({ error: "Nokt cannot listen right now" }, { status: 503 }))).impl });
    deepEqual(await unavailable.transcribeNokt("santiago", new Blob(["x"]), "u.m4a", { signal: new AbortController().signal }), { ok: false, failure: "unavailable", status: 503 });
    const empty = createLearningClient({ fetchImpl: fakeFetch((c) => (c.url === LEARNING_SESSION_PATH ? session() : Response.json({ transcript: "  " }))).impl });
    deepEqual(await empty.transcribeNokt("santiago", new Blob(["x"]), "u.m4a", { signal: new AbortController().signal }), { ok: false, failure: "empty" });
    const controller = new AbortController();
    const cancelling = createLearningClient({
      fetchImpl: fakeFetch((c) => {
        if (c.url === LEARNING_SESSION_PATH) return session();
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }).impl,
    });
    deepEqual(await cancelling.transcribeNokt("santiago", new Blob(["x"]), "u.m4a", { signal: controller.signal }), { ok: false, failure: "cancelled" });
  });
});
