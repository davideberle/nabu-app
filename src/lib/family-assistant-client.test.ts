// Unit tests for the browser-side child-turn transport.
//
// These are the tests that prove the *free-form* claim: whatever the child
// typed or said is what reaches the bridge, and no field in the outgoing
// request can pick an agent, a session, a model or a tool. They also prove the
// negative that motivated the whole milestone — that the shipped client no
// longer routes meaning through the keyword/semantic classifier.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRIDGE_TURN_PATH,
  SESSION_MINT_PATH,
  SESSION_REFRESH_MARGIN_MS,
  createChildTurnClient,
  readSessionInfo,
} from "./family-assistant-client.ts";

const BRIDGE_URL = "https://mini.tail.ts.net:8787";
const NOW_MS = 1_800_000_000_000;

type Call = { url: string; init: RequestInit };

function sessionBody(overrides: Record<string, unknown> = {}) {
  return {
    child: "santiago",
    sessionSuffix: "ipad",
    token: "fct1.payload.signature",
    expiresAt: NOW_MS + 600_000,
    bridgeUrl: BRIDGE_URL,
    ...overrides,
  };
}

function okEnvelope(text = "Because sunlight scatters in the air.") {
  return {
    v: 1,
    status: "ok",
    child: "santiago",
    blocks: [{ type: "text", text }],
    meta: { requestId: "r1", durationMs: 800 },
  };
}

/** A fetch stub that records every call and replays scripted responses. */
function stubFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  let index = 0;
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!next) throw new Error("no scripted response");
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(responses: (() => Response)[]) {
  const { impl, calls } = stubFetch(responses);
  return {
    calls,
    turnClient: createChildTurnClient({
      fetchImpl: impl,
      now: () => NOW_MS,
      newIdempotencyKey: () => "idem-1",
    }),
  };
}

describe("child turn client — free-form path", () => {
  it("sends the utterance verbatim and returns the agent's real reply", async () => {
    const utterance = "Edit my avatar so it looks like Goku from Dragon Ball";
    const { turnClient, calls } = client([
      () => jsonResponse(sessionBody()),
      () => jsonResponse(okEnvelope("I can't copy Goku exactly, but I can make a spiky-haired hero!")),
    ]);

    const outcome = await turnClient.ask({
      childId: "santiago",
      sessionSuffix: "ipad",
      message: utterance,
    });

    ok(outcome.ok);
    equal(outcome.envelope.blocks[0]?.type, "text");

    // The exact regression this milestone closes: the phrase "Dragon Ball" no
    // longer selects a music view. It is sent, unexamined, to the agent — and
    // the reply is whatever the agent said, not a fixture.
    const turn = calls[1];
    ok(turn);
    equal(turn.url, `${BRIDGE_URL}${BRIDGE_TURN_PATH}`);
    const body = JSON.parse(String(turn.init.body)) as Record<string, unknown>;
    equal(body.message, utterance);
  });

  it("sends exactly two body fields, so nothing about the run is client-chosen", async () => {
    const { turnClient, calls } = client([
      () => jsonResponse(sessionBody()),
      () => jsonResponse(okEnvelope()),
    ]);
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hello" });

    const body = JSON.parse(String(calls[1]?.init.body)) as Record<string, unknown>;
    deepStrictEqual(Object.keys(body).sort(), ["idempotencyKey", "message"]);
    // The child, the session, the model, the tool allowlist and the system
    // prompt are all absent by construction: the bridge derives them from the
    // token and its own configuration.
    for (const forbidden of [
      "childId",
      "sessionSuffix",
      "sessionKey",
      "agentId",
      "model",
      "provider",
      "toolsAllow",
      "prompt",
      "lane",
    ]) {
      equal(forbidden in body, false, forbidden);
    }
  });

  it("carries the child token as a bearer and never as a body field or query", async () => {
    const { turnClient, calls } = client([
      () => jsonResponse(sessionBody({ token: "fct1.abc.def" })),
      () => jsonResponse(okEnvelope()),
    ]);
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hello" });

    const turn = calls[1];
    ok(turn);
    const headers = turn.init.headers as Record<string, string>;
    equal(headers.Authorization, "Bearer fct1.abc.def");
    equal(turn.url.includes("fct1"), false);
    equal(String(turn.init.body).includes("fct1"), false);
  });

  it("mints a session for the selected child and refuses a mismatched answer", async () => {
    const { turnClient, calls } = client([
      () => jsonResponse(sessionBody()),
      () => jsonResponse(okEnvelope()),
    ]);
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hi" });
    equal(calls[0]?.url, SESSION_MINT_PATH);
    deepStrictEqual(JSON.parse(String(calls[0]?.init.body)), { childId: "santiago", sessionSuffix: "ipad" });

    // A server that answers about the wrong child is a bug, not something to
    // work around: the turn is refused rather than sent to the sibling.
    const mismatched = client([() => jsonResponse(sessionBody({ child: "isabel" }))]);
    const outcome = await mismatched.turnClient.ask({
      childId: "santiago",
      sessionSuffix: "ipad",
      message: "hi",
    });
    equal(outcome.ok, false);
    equal(mismatched.calls.length, 1);
  });
});

describe("child turn client — session lifecycle", () => {
  it("reuses one session across turns instead of minting per question", async () => {
    const { turnClient, calls } = client([
      () => jsonResponse(sessionBody()),
      () => jsonResponse(okEnvelope()),
      () => jsonResponse(okEnvelope()),
      () => jsonResponse(okEnvelope()),
    ]);
    for (const message of ["one", "two", "three"]) {
      await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message });
    }
    equal(calls.filter((call) => call.url === SESSION_MINT_PATH).length, 1);
    equal(calls.filter((call) => call.url.endsWith(BRIDGE_TURN_PATH)).length, 3);
  });

  it("re-mints before expiry rather than sending on a dying token", async () => {
    const nearlyExpired = sessionBody({ expiresAt: NOW_MS + SESSION_REFRESH_MARGIN_MS - 1 });
    const { turnClient, calls } = client([
      () => jsonResponse(nearlyExpired),
      () => jsonResponse(okEnvelope()),
      () => jsonResponse(nearlyExpired),
      () => jsonResponse(okEnvelope()),
    ]);
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "one" });
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "two" });
    equal(calls.filter((call) => call.url === SESSION_MINT_PATH).length, 2);
  });

  it("re-mints exactly once on a 401 and retries the same turn", async () => {
    let turnAttempts = 0;
    const { turnClient, calls } = client([
      () => jsonResponse(sessionBody()),
      () => {
        turnAttempts += 1;
        return jsonResponse({ v: 1, status: "rejected", child: "santiago", blocks: [], meta: {} }, 401);
      },
      () => jsonResponse(sessionBody()),
      () => {
        turnAttempts += 1;
        return jsonResponse(okEnvelope());
      },
    ]);
    const outcome = await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hi" });
    ok(outcome.ok);
    equal(turnAttempts, 2);
    equal(calls.filter((call) => call.url === SESSION_MINT_PATH).length, 2);

    // The retry reuses the idempotency key, so a turn that actually started
    // before the token expired rejoins rather than running twice.
    const first = JSON.parse(String(calls[1]?.init.body)) as { idempotencyKey: string };
    const second = JSON.parse(String(calls[3]?.init.body)) as { idempotencyKey: string };
    equal(first.idempotencyKey, second.idempotencyKey);
  });

  it("drops the cached session on reset", async () => {
    const { turnClient, calls } = client([
      () => jsonResponse(sessionBody()),
      () => jsonResponse(okEnvelope()),
      () => jsonResponse(sessionBody()),
      () => jsonResponse(okEnvelope()),
    ]);
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "one" });
    ok(turnClient.peekSession());
    turnClient.reset();
    equal(turnClient.peekSession(), null);
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "two" });
    equal(calls.filter((call) => call.url === SESSION_MINT_PATH).length, 2);
  });
});

describe("child turn client — failure handling", () => {
  it("reports a missing session without attempting a turn", async () => {
    const { turnClient, calls } = client([() => jsonResponse({ error: "not configured" }, 503)]);
    const outcome = await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hi" });
    equal(outcome.ok, false);
    if (!outcome.ok) equal(outcome.failure, "no-session");
    equal(calls.length, 1);
  });

  it("reports a network failure as retryable rather than as an answer", async () => {
    const { impl } = stubFetch([]);
    void impl;
    const failing = createChildTurnClient({
      fetchImpl: (async (input: RequestInfo | URL) => {
        if (String(input) === SESSION_MINT_PATH) return jsonResponse(sessionBody());
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      now: () => NOW_MS,
      newIdempotencyKey: () => "idem-1",
    });
    const outcome = await failing.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hi" });
    equal(outcome.ok, false);
    if (!outcome.ok) equal(outcome.failure, "network");
    equal(outcome.envelope.error?.retryable, true);
  });

  it("surfaces a bridge failure envelope instead of pretending it answered", async () => {
    const { turnClient } = client([
      () => jsonResponse(sessionBody()),
      () =>
        jsonResponse(
          {
            v: 1,
            status: "busy",
            child: "santiago",
            blocks: [],
            meta: { requestId: "r" },
            error: { code: "busy", message: "in flight", retryable: true },
          },
          429,
        ),
    ]);
    const outcome = await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hi" });
    equal(outcome.ok, false);
    equal(outcome.envelope.status, "busy");
    equal(outcome.envelope.error?.code, "busy");
  });

  it("refuses an empty utterance before touching the network", async () => {
    const { turnClient, calls } = client([() => jsonResponse(sessionBody())]);
    const outcome = await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "   " });
    equal(outcome.ok, false);
    equal(calls.length, 0);
  });
});

describe("readSessionInfo", () => {
  it("accepts a well-formed mint response", () => {
    ok(readSessionInfo(sessionBody()));
  });

  it("refuses anything that is not a child-scoped session", () => {
    const bad: unknown[] = [
      null,
      "string",
      sessionBody({ child: "main" }),
      sessionBody({ child: undefined }),
      sessionBody({ token: "" }),
      sessionBody({ expiresAt: "soon" }),
      sessionBody({ bridgeUrl: "javascript:alert(1)" }),
      sessionBody({ bridgeUrl: "not a url" }),
      sessionBody({ sessionSuffix: "" }),
    ];
    for (const value of bad) equal(readSessionInfo(value), null, JSON.stringify(value));
  });

  // The second half of the https rule. The mint route already refuses these,
  // but this is the last check before the browser puts a live bearer token on a
  // socket — and it is the half that an attacker able to answer the mint call
  // would have to get past.
  it("refuses a plaintext bridge URL for any non-loopback host", () => {
    for (const bridgeUrl of [
      "http://mini.tail.ts.net:8787",
      "http://dae-macmini.tail4f656e.ts.net",
      "http://100.64.0.1:8787",
      "http://attacker.example",
    ]) {
      equal(readSessionInfo(sessionBody({ bridgeUrl })), null, bridgeUrl);
    }
  });

  it("keeps plaintext loopback usable for local verification", () => {
    for (const bridgeUrl of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
      const info = readSessionInfo(sessionBody({ bridgeUrl }));
      ok(info, bridgeUrl);
      if (info) equal(info.bridgeUrl, bridgeUrl);
    }
  });

  it("reduces a bridge URL to its origin before it is ever fetched", () => {
    const info = readSessionInfo(sessionBody({ bridgeUrl: "https://mini.tail.ts.net:8787/wrong/path" }));
    ok(info);
    if (info) equal(info.bridgeUrl, "https://mini.tail.ts.net:8787");
  });
});

// ---------------------------------------------------------------------------
// Negative control: the fixtures are not the runtime
// ---------------------------------------------------------------------------

describe("negative control — no phrase decides meaning", () => {
  it("MUTANT: a keyword router would answer these two identically; the client does not", async () => {
    // The 2026 regression, reproduced as a mutant. A router that scored word
    // overlap mapped BOTH of these onto the music-discovery view, because
    // "dragon" is in the shipped dragon-song fixtures.
    const mutantRoute = (text: string) => (/dragon/i.test(text) ? "music-choices" : "unknown");
    equal(mutantRoute("Play the song with the dragon"), "music-choices");
    equal(mutantRoute("Edit my avatar so it looks like Goku from Dragon Ball"), "music-choices");

    // The shipped client has no such branch: both strings are transported
    // unchanged, and the *agent* decides what each one means.
    const sent: string[] = [];
    const turnClient = createChildTurnClient({
      fetchImpl: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (String(input) === SESSION_MINT_PATH) return jsonResponse(sessionBody());
        sent.push((JSON.parse(String(init.body)) as { message: string }).message);
        return jsonResponse(okEnvelope("an answer from the agent"));
      }) as unknown as typeof fetch,
      now: () => NOW_MS,
      newIdempotencyKey: () => "idem-1",
    });

    for (const message of [
      "Play the song with the dragon",
      "Edit my avatar so it looks like Goku from Dragon Ball",
    ]) {
      const outcome = await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message });
      ok(outcome.ok);
    }
    deepStrictEqual(sent, [
      "Play the song with the dragon",
      "Edit my avatar so it looks like Goku from Dragon Ball",
    ]);
  });

  it("MUTANT: a client that read childId from its own arguments-with-body would cross children", async () => {
    // A plausible refactor — "let the caller put childId in the body so the
    // bridge does not have to decode the token" — would make the sibling
    // reachable from the browser. Shown here, and absent from the real body.
    const mutantBody = (childId: string, message: string) => ({ childId, message });
    equal(mutantBody("isabel", "hi").childId, "isabel");

    const bodies: Record<string, unknown>[] = [];
    const turnClient = createChildTurnClient({
      fetchImpl: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (String(input) === SESSION_MINT_PATH) return jsonResponse(sessionBody());
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse(okEnvelope());
      }) as unknown as typeof fetch,
      now: () => NOW_MS,
      newIdempotencyKey: () => "idem-1",
    });
    await turnClient.ask({ childId: "santiago", sessionSuffix: "ipad", message: "hi" });
    equal("childId" in (bodies[0] ?? {}), false);
  });
});
