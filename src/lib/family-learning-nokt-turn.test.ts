// Nokt turn — receipt binding and the backend hop. Fictional, offline: receipts are signed HERE with a synthetic
// secret (the app itself can only verify); the backend is a fake fetch. No provider, no network.
//
// Run with: npm test  (node --test; types stripped natively)

import { deepEqual, equal, ok } from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { BRIDGE_RECEIPT_ISSUER, serializeBridgeReceiptClaims, type BridgeReceiptClaims } from "./family-assistant-bridge.ts";
import { sha256Hex } from "./family-learning-hash.ts";
import { askNoktBackend, NOKT_BACKEND_PATH, noktReplyOrigin } from "./family-learning-nokt-turn.ts";

const SECRET = "fable-nokt-turn-test-secret-0123456789abcdef";
const now = Math.floor(Date.UTC(2026, 9, 23, 12, 0, 0) / 1000);
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
function sign(claims: Partial<BridgeReceiptClaims> & Record<string, unknown>, secret = SECRET): string {
  const full = { v: 1, iss: BRIDGE_RECEIPT_ISSUER, sub: "santiago", sid: "learn", key: "turn-000001", req: "a".repeat(64), res: "b".repeat(64), iat: now, ...claims } as BridgeReceiptClaims;
  const payload = b64u(serializeBridgeReceiptClaims(full));
  return `fcr1.${payload}.${b64u(createHmac("sha256", secret).update(`fcr1.${payload}`).digest())}`;
}

describe("Nokt reply origin — signed AND bound to this dispatch and these bytes", () => {
  const reqHash = sha256Hex('{"fictional":"request"}');
  const text = JSON.stringify({ v: 1, say: "Was sollst du herausfinden?", intent: "clarify", outcome: null });
  const expected = { child: "santiago", turnId: "turn-000001", reqHash, text };
  const good = sign({ key: "turn-000001", req: reqHash, res: sha256Hex(text) });

  it("verified for the exact turn", () => equal(noktReplyOrigin(good, SECRET, expected, now), "verified"));
  it("missing when no receipt came", () => equal(noktReplyOrigin(undefined, SECRET, expected, now), "missing"));
  it("ADVERSARIAL cross-child: a receipt for another child is invalid", () => equal(noktReplyOrigin(sign({ sub: "isabel", key: "turn-000001", req: reqHash, res: sha256Hex(text) }), SECRET, expected, now), "invalid"));
  it("ADVERSARIAL replay: another turn's receipt is invalid here", () => equal(noktReplyOrigin(sign({ key: "turn-000002", req: reqHash, res: sha256Hex(text) }), SECRET, expected, now), "invalid"));
  it("ADVERSARIAL altered text: the receipt no longer matches", () => equal(noktReplyOrigin(good, SECRET, { ...expected, text: text.replace("herausfinden", "rechnen") }, now), "invalid"));
  it("ADVERSARIAL other request: a reply to a different request is invalid", () => equal(noktReplyOrigin(good, SECRET, { ...expected, reqHash: sha256Hex("other") }, now), "invalid"));
  it("ADVERSARIAL wrong key: a self-signed receipt is invalid", () => equal(noktReplyOrigin(sign({ key: "turn-000001", req: reqHash, res: sha256Hex(text) }, "attacker-secret-0123456789abcdef0123456789"), SECRET, expected, now), "invalid"));
  it("expired and malformed receipts are not verified", () => {
    equal(noktReplyOrigin(sign({ key: "turn-000001", req: reqHash, res: sha256Hex(text), iat: now - 3600 }), SECRET, expected, now), "invalid");
    equal(noktReplyOrigin("garbage", SECRET, expected, now), "malformed");
  });
});

describe("Nokt backend hop — bearer, path, cancel, transport", () => {
  const config = { secret: SECRET, bridgeUrl: "http://127.0.0.1:9999/" };
  it("posts {turnId, request} to <bridge>/nokt/turn with a minted bridge token and returns reply + receipt as sent", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const out = await askNoktBackend(config, { child: "santiago", turnId: "turn-000001", request: { fictional: true } }, {
      signal: new AbortController().signal,
      jti: "jti-1",
      nowMs: now * 1000,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Response.json({ reply: "{\"v\":1}", receipt: "fcr1.x.y" });
      }) as unknown as typeof fetch,
    });
    deepEqual(out, { ok: true, reply: "{\"v\":1}", receipt: "fcr1.x.y" });
    equal(calls[0].url, `http://127.0.0.1:9999${NOKT_BACKEND_PATH}`);
    ok(/^Bearer fcm1\./.test((calls[0].init.headers as Record<string, string>).Authorization));
    deepEqual(JSON.parse(String(calls[0].init.body)), { turnId: "turn-000001", request: { fictional: true } });
  });

  it("cancel: his abort reaches the backend call and is reported as cancelled", async () => {
    const controller = new AbortController();
    const pending = askNoktBackend(config, { child: "santiago", turnId: "turn-000001", request: {} }, {
      signal: controller.signal,
      jti: "jti-2",
      fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch,
    });
    controller.abort();
    deepEqual(await pending, { ok: false, reason: "cancelled" });
  });

  it("a failing or malformed backend is a transport failure, never a reply", async () => {
    const fail = (r: Response) => askNoktBackend(config, { child: "santiago", turnId: "turn-000001", request: {} }, { signal: new AbortController().signal, jti: "j", fetchImpl: (async () => r) as unknown as typeof fetch });
    deepEqual(await fail(new Response("x", { status: 500 })), { ok: false, reason: "transport" });
    deepEqual(await fail(Response.json({ reply: 42 })), { ok: false, reason: "transport" });
  });
});
