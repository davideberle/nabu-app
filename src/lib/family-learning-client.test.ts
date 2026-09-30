// Browser transport: credential minting and reuse, bearer on every call,
// idempotency key per mutation, stale/refused handling, reset on child switch.
// Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createLearningClient, LEARNING_MISSION_PATH, LEARNING_SESSION_PATH } from "./family-learning-client.ts";
import { asLearningContent } from "./family-learning-content.ts";
import { buildChildView, EMPTY_PARENT_SETTINGS, newMissionState } from "./family-learning-state.ts";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(handlers: Record<string, (init: RequestInit | undefined, n: number) => Response>, calls: Call[]) {
  const counts: Record<string, number> = {};
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    counts[url] = (counts[url] ?? 0) + 1;
    const handler = handlers[url];
    if (!handler) return new Response("{}", { status: 404 });
    return handler(init, counts[url]);
  };
}

// Views handed to the client must satisfy the full runtime contract (view guard),
// so the fixture is a real view built by the state machine, re-stamped.
const content = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")));
const fullView = (revision: number, child: "santiago" | "isabel" = "santiago") => ({ ...buildChildView(newMissionState(content, child, new Date(0).toISOString()), content, EMPTY_PARENT_SETTINGS, new Date(0)), child, revision });
const view = fullView;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createLearningClient", () => {
  it("mints once, sends the bearer, and reuses the credential until near expiry", async () => {
    const calls: Call[] = [];
    let now = 1_000_000;
    const client = createLearningClient({
      now: () => now,
      fetchImpl: fakeFetch(
        {
          [LEARNING_SESSION_PATH]: (init, n) => {
            deepStrictEqual(JSON.parse(String(init?.body)), { childId: "santiago" });
            return json({ child: "santiago", token: `tok-${n}`, expiresAt: now + 15 * 60_000 });
          },
          [LEARNING_MISSION_PATH]: () => json({ view: view(3) }),
        },
        calls,
      ),
    });
    const first = await client.read("santiago");
    ok(first.ok && first.view.revision === 3);
    const second = await client.read("santiago");
    ok(second.ok);
    equal(calls.filter((c) => c.url === LEARNING_SESSION_PATH).length, 1);
    const headers = calls.filter((c) => c.url === LEARNING_MISSION_PATH).map((c) => (c.init?.headers as Record<string, string>).Authorization);
    deepStrictEqual(headers, ["Bearer tok-1", "Bearer tok-1"]);
    now += 14.5 * 60_000; // inside the refresh margin → re-mint
    await client.read("santiago");
    equal(calls.filter((c) => c.url === LEARNING_SESSION_PATH).length, 2);
  });

  it("refuses a mint response for a different child and reports no-session", async () => {
    const client = createLearningClient({
      fetchImpl: fakeFetch({ [LEARNING_SESSION_PATH]: () => json({ child: "isabel", token: "t", expiresAt: Date.now() + 60_000 }) }, []),
    });
    deepStrictEqual(await client.read("santiago"), { ok: false, failure: "no-session" });
  });

  it("sends op, expectedRevision and a fresh idempotency key; maps 409 and 422", async () => {
    const calls: Call[] = [];
    let keyN = 0;
    const client = createLearningClient({
      newIdempotencyKey: () => `key-${(keyN += 1)}`,
      fetchImpl: fakeFetch(
        {
          [LEARNING_SESSION_PATH]: () => json({ child: "santiago", token: "tok", expiresAt: Date.now() + 600_000 }),
          [LEARNING_MISSION_PATH]: (init, n) => {
            const body = JSON.parse(String(init?.body));
            if (n === 1) return json({ status: "applied", view: view(body.expectedRevision + 1), result: { feedback: "done" } });
            if (n === 2) return json({ status: "stale", view: view(9) }, 409);
            return json({ status: "refused", code: "not-allowed", message: "nope", view: view(9) }, 422);
          },
        },
        calls,
      ),
    });
    const applied = await client.mutate("santiago", { op: "start-visit" }, 4);
    ok(applied.ok && applied.status === "applied" && applied.view.revision === 5);
    const sent = JSON.parse(String(calls.find((c) => c.url === LEARNING_MISSION_PATH)?.init?.body));
    // R5-1: the wire body always carries the rendered identity context (null when the caller gave none).
    deepStrictEqual(sent, { op: { op: "start-visit" }, expectedRevision: 4, idempotencyKey: "key-1", context: null });
    const stale = await client.mutate("santiago", { op: "start-visit" }, 4);
    ok(stale.ok && stale.status === "stale" && stale.view.revision === 9);
    const refused = await client.mutate("santiago", { op: "name-base", name: "X" }, 9);
    ok(!refused.ok && "status" in refused && refused.status === "refused" && refused.code === "not-allowed");
    // A retry may reuse an explicit key so the server can replay it.
    await client.mutate("santiago", { op: "start-visit" }, 9, { idempotencyKey: "key-1" });
    const last = JSON.parse(String(calls[calls.length - 1].init?.body));
    equal(last.idempotencyKey, "key-1");
  });

  it("drops the credential on reset and on a 401", async () => {
    const calls: Call[] = [];
    let status = 200;
    const client = createLearningClient({
      fetchImpl: fakeFetch(
        {
          [LEARNING_SESSION_PATH]: () => json({ child: "santiago", token: "tok", expiresAt: Date.now() + 600_000 }),
          [LEARNING_MISSION_PATH]: () => (status === 200 ? json({ view: view(1) }) : json({ error: "Unauthorized" }, 401)),
        },
        calls,
      ),
    });
    await client.read("santiago");
    ok(client.peekSession());
    client.reset();
    equal(client.peekSession(), null);
    await client.read("santiago");
    status = 401;
    const failed = await client.read("santiago");
    ok(!failed.ok && failed.failure === "unauthorized");
    equal(client.peekSession(), null);
  });

  it("distinguishes the server's explicit 'not prepared' answer from a malformed success (A07)", async () => {
    let body: unknown = { view: null, prepared: false, child: "santiago" };
    const client = createLearningClient({
      fetchImpl: fakeFetch(
        {
          [LEARNING_SESSION_PATH]: () => json({ child: "santiago", token: "tok", expiresAt: Date.now() + 600_000 }),
          [LEARNING_MISSION_PATH]: () => json(body),
        },
        [],
      ),
    });
    const unprepared = await client.read("santiago");
    ok(!unprepared.ok && unprepared.failure === "unprepared" && unprepared.status === 200);
    // The independent reviewer's exact matching-child probes (r2): a child name is not a view.
    for (const malformed of [{ unexpected: "malformed-response" }, { view: "nope" }, { view: null }, { view: null, prepared: false, child: "isabel" }, { view: null, prepared: true }, [], "text", { view: { child: "santiago" } }, { child: "santiago", prepared: false, view: { child: "santiago" } }, { view: { child: "santiago", revision: 1, visit: null } }]) {
      body = malformed;
      const outcome = await client.read("santiago");
      ok(!outcome.ok && outcome.failure === "bad-response", JSON.stringify(malformed));
    }
  });

  it("write responses are held to the same contract: a malformed applied/stale/refused view is bad-response, a complete one is adopted", async () => {
    let body: unknown = { status: "applied", view: { child: "santiago" }, result: {} };
    let status = 200;
    const client = createLearningClient({
      fetchImpl: fakeFetch(
        {
          [LEARNING_SESSION_PATH]: () => json({ child: "santiago", token: "tok", expiresAt: Date.now() + 600_000 }),
          [LEARNING_MISSION_PATH]: () => json(body, status),
        },
        [],
      ),
    });
    const applied = await client.mutate("santiago", { op: "start-visit" }, 0);
    ok(!applied.ok && "failure" in applied && applied.failure === "bad-response");
    body = { status: "stale", view: { child: "santiago", revision: 2 } };
    status = 409;
    const stale = await client.mutate("santiago", { op: "start-visit" }, 0);
    ok(!stale.ok && "failure" in stale && stale.failure === "bad-response");
    body = { status: "refused", code: "x", message: "y", view: { child: "santiago" } };
    status = 422;
    const refused = await client.mutate("santiago", { op: "start-visit" }, 0);
    ok(!refused.ok && "failure" in refused && refused.failure === "bad-response");
    body = { status: "applied", view: fullView(1), result: {} };
    status = 200;
    const good = await client.mutate("santiago", { op: "start-visit" }, 0);
    ok(good.ok && good.status === "applied" && good.view.revision === 1);
  });

  it("never renders a view for another child", async () => {
    const client = createLearningClient({
      fetchImpl: fakeFetch(
        {
          [LEARNING_SESSION_PATH]: () => json({ child: "santiago", token: "tok", expiresAt: Date.now() + 600_000 }),
          [LEARNING_MISSION_PATH]: () => json({ view: view(1, "isabel") }),
        },
        [],
      ),
    });
    const outcome = await client.read("santiago");
    ok(!outcome.ok && outcome.failure === "bad-response");
  });
});
