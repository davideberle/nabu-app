// Unit tests for the Listening Library contract and transport.
//
// The properties that matter mirror the child-turn client's: the child is
// chosen at mint time and never a request field; the library refuses to render
// a sibling's payload; artwork is https-only at the last hop; and playback is
// expressible only as "hand back the preview's one-use confirmation token".
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LISTENING_BASE_PATH,
  createListeningClient,
  readListeningLibrary,
  readListeningNow,
  readListeningPreview,
  readStoryView,
} from "./family-listening.ts";

const BRIDGE_URL = "https://mini.tail.ts.net:8787";
const NOW_MS = 1_800_000_000_000;

function storyPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "ninjago-f01",
    seriesId: "lego-ninjago",
    seriesTitle: "LEGO Ninjago",
    episodeNumber: 1,
    title: "Folge 01: Der Aufstieg der Schlangen",
    artist: "LEGO Ninjago",
    artworkUrl: "https://art.invalid/nj1.jpg",
    chapterCount: 15,
    educational: false,
    badge: "new",
    status: "not_started",
    liked: false,
    disliked: false,
    alreadyHeard: false,
    hidden: false,
    ...overrides,
  };
}

function libraryPayload(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    child: "santiago",
    lanes: {
      continueListening: [],
      favorites: [],
      newForYou: [{ storyId: "ninjago-f01", reason: "Next in LEGO Ninjago" }],
      learnSomething: [],
      funnyAndAdventurous: [],
    },
    series: [
      {
        id: "lego-ninjago",
        title: "LEGO Ninjago",
        artworkUrl: "https://art.invalid/nj1.jpg",
        storyIds: ["ninjago-f01"],
      },
    ],
    stories: { "ninjago-f01": storyPayload() },
    ...overrides,
  };
}

describe("library parsing", () => {
  it("parses a well-formed library", () => {
    const library = readListeningLibrary(libraryPayload(), "santiago");
    ok(library);
    equal(library.stories["ninjago-f01"]?.title, "Folge 01: Der Aufstieg der Schlangen");
    equal(library.series[0]?.storyIds.length, 1);
    equal(library.lanes.newForYou[0]?.reason, "Next in LEGO Ninjago");
  });

  it("refuses a payload answering about the wrong child", () => {
    equal(readListeningLibrary(libraryPayload({ child: "isabel" }), "santiago"), null);
  });

  it("drops non-https artwork at the last hop", () => {
    const story = readStoryView(storyPayload({ artworkUrl: "http://art.invalid/nj1.jpg" }));
    ok(story);
    equal(story.artworkUrl, undefined);
  });

  it("drops lane entries and series pointing at stories that did not parse", () => {
    const library = readListeningLibrary(
      libraryPayload({
        lanes: { newForYou: [{ storyId: "ghost", reason: "?" }, { storyId: "ninjago-f01", reason: "ok" }] },
      }),
      "santiago",
    );
    ok(library);
    deepStrictEqual(
      library.lanes.newForYou.map((entry) => entry.storyId),
      ["ninjago-f01"],
    );
  });
});

describe("preview and now parsing", () => {
  it("parses a preview with its one-use token and resume", () => {
    const preview = readListeningPreview({
      v: 1,
      status: "ok",
      confirmationToken: "opaque-token",
      room: "Living Room",
      card: { title: "Folge 01", imageUrl: "https://art.invalid/a.jpg" },
      resume: { chapterIndex: 4, chapterTitle: "Kapitel 05" },
      chapterCount: 15,
    });
    ok(preview);
    equal(preview.confirmationToken, "opaque-token");
    equal(preview.resume?.chapterIndex, 4);
  });

  it("refuses a preview without a token", () => {
    equal(readListeningPreview({ v: 1, status: "ok", card: { title: "x" } }), null);
  });

  it("treats a quiet room as null playing", () => {
    equal(readListeningNow({ v: 1, status: "ok", playing: null }), null);
    const playing = readListeningNow({
      v: 1,
      status: "ok",
      playing: { storyId: "s", title: "T", chapterIndex: 2, chapterTitle: "K3", chapterCount: 5, state: "PLAYING", elapsedSeconds: 12, room: "Living Room" },
    });
    ok(playing);
    equal(playing.chapterIndex, 2);
  });
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type Call = { url: string; init: RequestInit };

function makeFetch(handlers: Record<string, (init: RequestInit) => { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const handler = Object.entries(handlers).find(([suffix]) => url.endsWith(suffix))?.[1];
    if (!handler) return new Response("{}", { status: 404 });
    const { status, body } = handler(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function sessionHandler() {
  return {
    status: 200,
    body: {
      child: "santiago",
      sessionSuffix: "ipad",
      token: "fct1.payload.signature",
      expiresAt: NOW_MS + 600_000,
      bridgeUrl: BRIDGE_URL,
    },
  };
}

describe("listening client", () => {
  it("mints the same child session and carries only the bearer to the bridge", async () => {
    const { fetchImpl, calls } = makeFetch({
      "/api/family/assistant/session": sessionHandler,
      [`${LISTENING_BASE_PATH}/library`]: () => ({ status: 200, body: libraryPayload() }),
    });
    const client = createListeningClient({ fetchImpl, now: () => NOW_MS });
    const outcome = await client.loadLibrary("santiago");
    ok(outcome.ok);
    equal(outcome.value.stories["ninjago-f01"]?.badge, "new");

    const mint = calls[0]!;
    deepStrictEqual(JSON.parse(String(mint.init.body)), { childId: "santiago", sessionSuffix: "ipad" });
    const library = calls[1]!;
    equal(library.url, `${BRIDGE_URL}${LISTENING_BASE_PATH}/library`);
    equal((library.init.headers as Record<string, string>).Authorization, "Bearer fct1.payload.signature");
    equal(library.init.method, "GET");
    equal(library.init.body, undefined);
  });

  it("plays only by handing back the confirmation token", async () => {
    const { fetchImpl, calls } = makeFetch({
      "/api/family/assistant/session": sessionHandler,
      [`${LISTENING_BASE_PATH}/play`]: () => ({
        status: 200,
        body: { v: 1, status: "ok", started: { title: "Folge 01", room: "Living Room", volume: 20, chapterIndex: 0 } },
      }),
    });
    const client = createListeningClient({ fetchImpl, now: () => NOW_MS });
    const outcome = await client.confirmPlay("santiago", { confirmationToken: "opaque" });
    ok(outcome.ok);
    equal(outcome.value.room, "Living Room");
    const play = calls[1]!;
    // The body names the token and nothing else — no story, no URI, no room.
    deepStrictEqual(JSON.parse(String(play.init.body)), { confirmationToken: "opaque" });
  });

  it("surfaces a bridge refusal with its child-safe message", async () => {
    const { fetchImpl } = makeFetch({
      "/api/family/assistant/session": sessionHandler,
      [`${LISTENING_BASE_PATH}/play`]: () => ({
        status: 409,
        body: { v: 1, status: "rejected", error: { code: "confirmation-expired", message: "that choice is a bit old now" } },
      }),
    });
    const client = createListeningClient({ fetchImpl, now: () => NOW_MS });
    const outcome = await client.confirmPlay("santiago", { confirmationToken: "stale" });
    ok(!outcome.ok);
    equal(outcome.failure, "refused");
    ok(outcome.message?.includes("a bit old"));
  });

  it("re-mints exactly once on a 401", async () => {
    let libraryCalls = 0;
    const { fetchImpl, calls } = makeFetch({
      "/api/family/assistant/session": sessionHandler,
      [`${LISTENING_BASE_PATH}/library`]: () => {
        libraryCalls++;
        return libraryCalls === 1
          ? { status: 401, body: { error: { code: "unauthorized", message: "expired" } } }
          : { status: 200, body: libraryPayload() };
      },
    });
    const client = createListeningClient({ fetchImpl, now: () => NOW_MS });
    const outcome = await client.loadLibrary("santiago");
    ok(outcome.ok);
    // mint, 401, re-mint, retry.
    equal(calls.length, 4);
  });

  it("fails closed when the mint fails", async () => {
    const { fetchImpl } = makeFetch({
      "/api/family/assistant/session": () => ({ status: 503, body: { error: "not configured" } }),
    });
    const client = createListeningClient({ fetchImpl, now: () => NOW_MS });
    const outcome = await client.loadLibrary("santiago");
    ok(!outcome.ok);
    equal(outcome.failure, "no-session");
  });
});
