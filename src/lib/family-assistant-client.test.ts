// Retirement contract: real-child messages never leave the browser transport.
import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createChildTurnClient, readSessionInfo } from "./family-assistant-client.ts";
import { readRetirementSessionRequest } from "./family-assistant-availability.ts";
import { childFacingRecovery, isRetryable } from "./family-assistant-turn.ts";

describe("retired real-child AI transport", () => {
  for (const childId of ["santiago", "isabel"] as const) {
    for (const sessionSuffix of ["ipad", "learn", "mission", "listening"]) {
      it(`${childId}/${sessionSuffix}: no mint, provider, cached-token or bridge call`, async () => {
        let calls = 0;
        const client = createChildTurnClient({ fetchImpl: (async () => { calls++; throw Error("forbidden network"); }) as typeof fetch });
        for (let n = 0; n < 2; n++) {
          const result = await client.ask({ childId, sessionSuffix, message: "Synthetic retirement check" }, { idempotencyKey: "old-key", noTruncate: true });
          equal(result.ok, false);
          equal(result.envelope.child, childId);
          equal(result.envelope.error?.code, "temporarily_unavailable");
          equal(isRetryable(result.envelope), false);
          match(childFacingRecovery(result.envelope), /temporarily unavailable/);
          deepStrictEqual(result.envelope.blocks, []);
          equal(client.peekSession(), null);
          client.reset();
        }
        equal(calls, 0);
      });
    }
  }
  it("all shipped Family and Learning free-tutor callers retain this one boundary", () => {
    for (const path of ["../app/family/(shell)/assistant/client.tsx", "../app/family/(shell)/learn/client.tsx", "../app/family/(shell)/learn/mission/client.tsx", "../components/family/learning/nabu-sidebar.tsx"]) {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      match(text, /createChildTurnClient/);
      equal(text.includes("/v1/child-turn"), false);
    }
  });
  it("AI entry and voice precursors are disabled before recording or transcription", () => {
    const family = readFileSync(new URL("../app/family/(shell)/assistant/client.tsx", import.meta.url), "utf8");
    match(family, /disabled=\{!CHILD_ASSISTANT_AI_ENABLED\} onClick=\{\(\) => enterConversation/);
    match(family, /if \(!CHILD_ASSISTANT_AI_ENABLED\) \{[\s\S]*?setStage\(\{ kind: "home" \}\);[\s\S]*?return;/);
    const learning = readFileSync(new URL("../components/family/learning/nabu-sidebar.tsx", import.meta.url), "utf8");
    match(learning, /const canType = CHILD_ASSISTANT_AI_ENABLED &&/);
    match(learning, /const awaiting = CHILD_ASSISTANT_AI_ENABLED &&/);
    match(learning, /if \(!CHILD_ASSISTANT_AI_ENABLED \|\| !pendingTurn/);
  });
  it("AI mint is denied even when bridge configuration would otherwise exist", () => {
    for (const childId of ["santiago", "isabel"]) for (const purpose of [undefined, "assistant"]) {
      equal(readRetirementSessionRequest({ childId, sessionSuffix: "ipad", ...(purpose ? { purpose } : {}) }).status, 503);
    }
    const source = readFileSync(new URL("../app/api/family/assistant/session/route.ts", import.meta.url), "utf8");
    ok(source.indexOf("if (!session?.user)") < source.indexOf("request.json()"));
    ok(source.indexOf("readRetirementSessionRequest(body)") < source.indexOf("const configured = resolveBridgeMintConfig()"));
    ok(source.indexOf("if (parsed.status !== 200)") < source.indexOf("const minted = buildChildBridgeSession"));
    match(source, /status: 401/);
  });
  it("only explicit listening purpose with exact suffix and closed fields is admitted", () => {
    for (const childId of ["santiago", "isabel"] as const) {
      deepStrictEqual(readRetirementSessionRequest({ childId, purpose: "listening", sessionSuffix: "listening" }), { status: 200, childId, sessionSuffix: "listening" });
    }
    for (const input of [null, [], {}, { childId: "avery", purpose: "listening", sessionSuffix: "listening" }, { childId: "santiago", purpose: "listening", sessionSuffix: "ipad" }, { childId: "santiago", purpose: "listening", sessionSuffix: "listening", tools: [] }, { childId: "santiago", purpose: "gateway" }, { childId: "santiago", sessionSuffix: "agent:isabel" }]) equal(readRetirementSessionRequest(input).status, 400);
  });
  it("media session parsing still refuses sibling and invalid origins", () => {
    const fixture = { child: "santiago", sessionSuffix: "listening", token: "fcm1.test.sig", expiresAt: 1_800_000_000_000, bridgeUrl: "https://mini.tail.ts.net:8787" };
    ok(readSessionInfo(fixture));
    for (const patch of [{ child: "parent" }, { bridgeUrl: "http://mini.tail.ts.net:8787" }, { token: "" }, { token: "fct1.old.token" }, { expiresAt: Infinity }]) equal(readSessionInfo({ ...fixture, ...patch }), null);
  });
});
