// Nokt turn — the reply receipt and the browser-mediated client flow. Fictional, offline: receipts are signed HERE
// with synthetic secrets (the app itself can only verify); every fetch is a fake. No provider, no network.
//
// Run with: npm test  (node --test; types stripped natively)

import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { BRIDGE_RECEIPT_ISSUER, serializeBridgeReceiptClaims, type BridgeReceiptClaims } from "./family-assistant-bridge.ts";
import { BRIDGE_NOKT_PATH, createLearningClient, LEARNING_NOKT_DISPATCH_PATH, LEARNING_NOKT_REPLY_PATH, LEARNING_SESSION_PATH, type NoktTurnInput } from "./family-learning-client.ts";
import { sha256Hex } from "./family-learning-hash.ts";
import { noktReceiptInput } from "./family-learning-nokt-turn.ts";
import { receiptOrigin } from "./family-learning-trust.ts";
import { readFileSync } from "node:fs";
import { asLearningContent } from "./family-learning-content.ts";
import { buildChildView, EMPTY_PARENT_SETTINGS, newMissionState } from "./family-learning-state.ts";

const SECRET = "fable-nokt-turn-test-secret-0123456789abcdef";
const now = Math.floor(Date.UTC(2026, 9, 23, 12, 0, 0) / 1000);
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
function sign(claims: Partial<BridgeReceiptClaims> & Record<string, unknown>, secret = SECRET): string {
  const full = { v: 1, iss: BRIDGE_RECEIPT_ISSUER, sub: "santiago", sid: "learn", key: "turn-000001", req: "a".repeat(64), res: "b".repeat(64), iat: now, ...claims } as BridgeReceiptClaims;
  const payload = b64u(serializeBridgeReceiptClaims(full));
  return `fcr1.${payload}.${b64u(createHmac("sha256", secret).update(`fcr1.${payload}`).digest())}`;
}
/** What the engine does with the route's receipt input (tutor-reply). */
const bind = (receipt: unknown, expected: { child: string; turnId: string; reqHash: string; text: string }) => {
  try {
    return receiptOrigin(noktReceiptInput(receipt, SECRET, now), expected);
  } catch {
    return "invalid";
  }
};

describe("Nokt reply receipt — signature checked by the route, bound by the engine to its dispatch and the bytes", () => {
  const reqHash = sha256Hex('{"fictional":"request"}');
  const text = JSON.stringify({ v: 1, say: "Was sollst du herausfinden?", intent: "clarify", outcome: null });
  const expected = { child: "santiago", turnId: "turn-000001", reqHash, text };
  const good = sign({ key: "turn-000001", req: reqHash, res: sha256Hex(text) });

  it("verified for the exact turn", () => equal(bind(good, expected), "verified"));
  it("none came → missing; a non-string → malformed; a bad signature → invalid marker", () => {
    equal(noktReceiptInput(null, SECRET, now), null);
    deepEqual(noktReceiptInput(42, SECRET, now), { invalid: "not-a-string" });
    deepEqual(noktReceiptInput(sign({}, "attacker-secret-0123456789abcdef0123456789"), SECRET, now), { invalid: "bad-signature" });
  });
  it("ADVERSARIAL cross-child", () => equal(bind(sign({ sub: "isabel", key: "turn-000001", req: reqHash, res: sha256Hex(text) }), expected), "invalid"));
  it("ADVERSARIAL replay of another turn's receipt", () => equal(bind(sign({ key: "turn-000002", req: reqHash, res: sha256Hex(text) }), expected), "invalid"));
  it("ADVERSARIAL altered reply text", () => equal(bind(good, { ...expected, text: text.replace("herausfinden", "rechnen") }), "invalid"));
  it("ADVERSARIAL a request changed in the browser (other request hash)", () => equal(bind(good, { ...expected, reqHash: sha256Hex("other") }), "invalid"));
  it("ADVERSARIAL a listening-session receipt", () => equal(bind(sign({ sid: "listening", key: "turn-000001", req: reqHash, res: sha256Hex(text) }), expected), "invalid"));
  it("expired receipts are not verified", () => equal(bind(sign({ key: "turn-000001", req: reqHash, res: sha256Hex(text), iat: now - 3600 }), expected), "invalid"));

  it("INTEROP: the family runtime's pinned golden receipt verifies here (src/nokt/receipt.ts NOKT_RECEIPT_GOLDEN_VECTOR)", () => {
    const g = {
      secret: "family-child-bridge-golden-vector-secret-0001",
      requestJson: '{"promptVersion":"golden","system":"x","context":{},"transcript":[]}',
      reply: '{"v":1,"say":"Was sollst du herausfinden?","intent":"clarify","outcome":null}',
      receipt:
        "fcr1.eyJ2IjoyLCJpc3MiOiJmYW1pbHktY2hpbGQtYnJpZGdlIiwic3ViIjoic2FudGlhZ28iLCJzaWQiOiJsZWFybiIsImtleSI6ImdvbGRlbi10dXJuLTAwMDEiLCJyZXEiOiI4MDdjMTUxYTMzODdjOTI3YjZlYTNjNjE3ZWZmMmRmNTIyMDI5N2FkMjM2NmI4MTQxMzBmOTFiMmMxMmU5NTBkIiwicmVzIjoiYmIyNTdmNmUxZGZmMjMzODMyZWI5MmJjZGE0MzQxM2M1M2UzZTljYjNlMTcxMjVmYTA5ZTIzN2Q4ZDY3MGE5NSIsImlhdCI6MTc3MDAwMDAwMCwibWRsIjoib3BlbmFpL2dvbGRlbi1tb2RlbCIsInJ1biI6InJlc3BfZ29sZGVuXzAwMDEifQ.ZzA7SR21wRjvLwXswSLgoo6AGZOIclZT65N-rgr4i6M",
    };
    const input = noktReceiptInput(g.receipt, g.secret, 1_770_000_000);
    ok(input && !("invalid" in input));
    equal(receiptOrigin(input, { child: "santiago", turnId: "golden-turn-0001", reqHash: sha256Hex(g.requestJson), text: g.reply }), "verified");
    deepEqual({ mdl: (input as { mdl?: string }).mdl, run: (input as { run?: string }).run }, { mdl: "openai/golden-model", run: "resp_golden_0001" });
    throws(() => receiptOrigin(input, { child: "santiago", turnId: "golden-turn-0001", reqHash: sha256Hex(g.requestJson), text: g.reply + " " }));
  });
});

describe("Nokt turn client — dispatch → the browser asks the bridge → reply (fake fetch)", () => {
  const turn: NoktTurnInput = { step: "G2-PACK", part: "full", purpose: "diagnostic", entry: "manual", sessionId: "talk-1", turnId: "turn-c0000001", text: "fünf", via: "typed" };
  // A REAL child view of a fresh synthetic state, so the client's full view guard accepts the responses.
  const v6 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v6.json", import.meta.url), "utf8")));
  const baseView = JSON.parse(JSON.stringify(buildChildView(newMissionState(v6, "santiago", "2026-09-29T10:00:00.000Z"), v6, EMPTY_PARENT_SETTINGS, new Date("2026-10-23T12:00:00Z"), 0)));
  const view = (revision: number) => ({ ...baseView, revision });
  type Call = { url: string; init: RequestInit };
  function harness(opts: { bridgeUrl?: string; bridge?: (call: Call) => Response | Promise<Response>; onDispatch?: () => void } = {}) {
    const calls: Call[] = [];
    const request = { promptVersion: "p", system: "s", context: { step: "G2-PACK" }, transcript: [{ role: "child", text: "fünf", via: "typed" }] };
    const impl = (async (url: string, init: RequestInit = {}) => {
      const call = { url: String(url), init };
      calls.push(call);
      if (call.url === LEARNING_SESSION_PATH) return Response.json({ child: "santiago", token: "learning-token", expiresAt: Date.now() + 3_600_000 });
      if (call.url === LEARNING_NOKT_DISPATCH_PATH) {
        opts.onDispatch?.();
        return Response.json({ status: "applied", view: view(8), result: { turnId: turn.turnId, request, reqHash: "h", bridge: { url: opts.bridgeUrl ?? "http://127.0.0.1:3299", token: "fcm1.learn.token", expiresAt: 1 } } });
      }
      if (call.url.endsWith(BRIDGE_NOKT_PATH)) return opts.bridge ? opts.bridge(call) : Response.json({ ok: true, reply: '{"v":1}', receipt: "fcr1.r.s" });
      if (call.url === LEARNING_NOKT_REPLY_PATH) return Response.json({ status: "applied", view: view(9), result: { shown: true, say: "x" } });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    return { calls, request, client: createLearningClient({ fetchImpl: impl, now: () => Date.now() }) };
  }
  const run = (h: ReturnType<typeof harness>, signal = new AbortController().signal) => h.client.noktTurn("santiago", turn, 7, { signal, context: { erasureGeneration: 0, visit: null } });

  it("the bridge is called by the browser with the minted bearer, no cookies, and exactly the dispatched request", async () => {
    const h = harness();
    await run(h);
    const dispatch = h.calls.find((c) => c.url === LEARNING_NOKT_DISPATCH_PATH)!;
    equal((dispatch.init.headers as Record<string, string>).Authorization, "Bearer learning-token");
    deepEqual(JSON.parse(String(dispatch.init.body)).expectedRevision, 7);
    const bridge = h.calls.find((c) => c.url.endsWith(BRIDGE_NOKT_PATH))!;
    equal(bridge.url, `http://127.0.0.1:3299${BRIDGE_NOKT_PATH}`);
    equal((bridge.init.headers as Record<string, string>).Authorization, "Bearer fcm1.learn.token");
    equal(bridge.init.credentials, "omit");
    deepEqual(JSON.parse(String(bridge.init.body)), { turnId: turn.turnId, request: h.request });
    const reply = h.calls.find((c) => c.url === LEARNING_NOKT_REPLY_PATH)!;
    deepEqual(JSON.parse(String(reply.init.body)), { step: "G2-PACK", turnId: turn.turnId, reply: '{"v":1}', receipt: "fcr1.r.s", expectedRevision: 8, context: { erasureGeneration: 0, visit: null } });
    deepEqual(h.calls.map((c) => c.url), [LEARNING_SESSION_PATH, LEARNING_NOKT_DISPATCH_PATH, `http://127.0.0.1:3299${BRIDGE_NOKT_PATH}`, LEARNING_NOKT_REPLY_PATH], "the server never calls the bridge — the browser does");
  });

  it("an unreachable or failing bridge: the reply route gets reply null (withheld behind the app line), never a guess", async () => {
    for (const bridge of [() => new Response("x", { status: 503 }), () => Promise.reject(new TypeError("network"))]) {
      const h = harness({ bridge });
      await run(h);
      const reply = h.calls.find((c) => c.url === LEARNING_NOKT_REPLY_PATH)!;
      deepEqual({ reply: JSON.parse(String(reply.init.body)).reply, receipt: JSON.parse(String(reply.init.body)).receipt }, { reply: null, receipt: null });
    }
  });

  it("round 16: the runtime's «used up for today» (429 attempts_exhausted) is passed on with the empty reply; other refusals are not", async () => {
    const h = harness({ bridge: () => Response.json({ ok: false, code: "attempts_exhausted" }, { status: 429 }) });
    await run(h);
    deepEqual(JSON.parse(String(h.calls.find((c) => c.url === LEARNING_NOKT_REPLY_PATH)!.init.body)), { step: "G2-PACK", turnId: turn.turnId, reply: null, receipt: null, noReply: "attempts_exhausted", expectedRevision: 8, context: { erasureGeneration: 0, visit: null } });
    for (const bridge of [() => Response.json({ ok: false, code: "busy" }, { status: 429 }), () => Response.json({ ok: false, code: "usage_limit" }, { status: 429 }), () => new Response("not json", { status: 429 })]) {
      const o = harness({ bridge });
      await run(o);
      equal("noReply" in JSON.parse(String(o.calls.find((c) => c.url === LEARNING_NOKT_REPLY_PATH)!.init.body)), false);
    }
  });

  it("a non-loopback plaintext bridge URL is never called; the turn is closed with reply null", async () => {
    const h = harness({ bridgeUrl: "http://dae-macmini.example:8787" });
    await run(h);
    equal(h.calls.filter((c) => c.url.includes(BRIDGE_NOKT_PATH)).length, 0);
    equal(JSON.parse(String(h.calls.find((c) => c.url === LEARNING_NOKT_REPLY_PATH)!.init.body)).reply, null);
  });

  it("cancel after dispatch: nothing reaches the reply route", async () => {
    const c = new AbortController();
    const h = harness({ onDispatch: () => c.abort() });
    const out = await run(h, c.signal);
    equal(h.calls.filter((x) => x.url === LEARNING_NOKT_REPLY_PATH).length, 0);
    ok(!out.ok);
  });
});
