// Unit tests for the pure half of the New plays mirror + action outbox.
// Run with: npm test  (node --test; Node strips types natively)

import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEW_PLAY_ACTIONS,
  artworkUrl,
  normalizeNewPlayRow,
  summarizeRequest,
  validateActionRequest,
  type NewPlayRow,
  feedbackLabel,
  feedbackTone,
  publicFeedbackType,
} from "./music-new-plays.ts";

const FULL_ROW = {
  playId: "play-1",
  playedAt: "2026-09-16T12:05:00.000Z",
  room: "Living Room",
  requestContext: { intent: "play", context: "daytime", genre: null, query: null, source: "voice" },
  name: "Withness",
  artist: "ANOTR",
  type: "album",
  appleId: "1234567890",
  playbackUri: "x-sonos-http:album:1234567890",
  url: "https://music.apple.com/ch/album/withness/1234567890",
  releaseYear: 2024,
  genres: ["House", "Electronic"],
  artwork: { url: "https://is1-ssl.mzstatic.com/image/thumb/abc/{w}x{h}bb.jpg", width: 3000, height: 3000 },
  noveltyKind: "unfamiliar",
  source: "similar-artists",
  reason: "Close to artists you play at daytime",
  confidence: 0.72,
  announced: true,
  feedback: { type: "love", at: "2026-09-16T12:30:00.000Z", context: "daytime" },
  feedbackHistory: [
    { type: "more_like_this", at: "2026-09-16T12:10:00.000Z", context: "daytime" },
    { type: "love", at: "2026-09-16T12:30:00.000Z", context: "daytime" },
  ],
  libraryState: "in-library",
  profileState: { approved: true, contexts: ["daytime", "dinner"], at: "2026-09-16T12:31:00.000Z" },
  reviewed: true,
};

describe("normalizeNewPlayRow", () => {
  it("keeps a complete row intact", () => {
    const row = normalizeNewPlayRow(FULL_ROW);
    deepStrictEqual(row, FULL_ROW as NewPlayRow);
  });

  it("throws on a missing playId or playedAt", () => {
    throws(() => normalizeNewPlayRow({ playedAt: "2026-09-16T12:05:00Z" }), /playId/);
    throws(() => normalizeNewPlayRow({ playId: "p" }), /playedAt/);
    throws(() => normalizeNewPlayRow({ playId: "p", playedAt: "not a date" }), /playedAt/);
    throws(() => normalizeNewPlayRow(null), /object/);
    throws(() => normalizeNewPlayRow("play-1"), /object/);
  });

  it("coerces everything else safely with display-neutral defaults", () => {
    const row = normalizeNewPlayRow({ playId: "p", playedAt: "2026-09-16T14:05:00+02:00" });
    equal(row.playedAt, "2026-09-16T12:05:00.000Z");
    equal(row.room, null);
    deepStrictEqual(row.requestContext, {
      intent: null,
      context: null,
      genre: null,
      query: null,
      source: null,
    });
    equal(row.name, null);
    equal(row.type, null);
    equal(row.releaseYear, null);
    deepStrictEqual(row.genres, []);
    equal(row.artwork, null);
    equal(row.noveltyKind, "unknown");
    equal(row.confidence, null);
    equal(row.announced, false);
    equal(row.feedback, null);
    deepStrictEqual(row.feedbackHistory, []);
    equal(row.libraryState, "unknown");
    deepStrictEqual(row.profileState, { approved: false, contexts: [] });
    equal(row.reviewed, false);
  });

  it("drops malformed nested values instead of failing", () => {
    const row = normalizeNewPlayRow({
      playId: "p",
      playedAt: "2026-09-16T12:05:00Z",
      genres: ["Jazz", 42, null, ""],
      artwork: { url: "" },
      feedback: { type: "love" },
      feedbackHistory: [{ type: "love", at: "2026-09-16T12:30:00Z" }, "junk", { at: "x" }],
      profileState: { approved: "yes", contexts: "dinner" },
      releaseYear: "1998",
      confidence: "0.5",
      reviewed: 1,
    });
    deepStrictEqual(row.genres, ["Jazz"]);
    equal(row.artwork, null);
    equal(row.feedback, null);
    deepStrictEqual(row.feedbackHistory, [
      { type: "love", at: "2026-09-16T12:30:00Z", context: null },
    ]);
    deepStrictEqual(row.profileState, { approved: true, contexts: [] });
    equal(row.releaseYear, 1998);
    equal(row.confidence, 0.5);
    equal(row.reviewed, true);
  });

  it("accepts a bare artwork URL string", () => {
    const row = normalizeNewPlayRow({
      playId: "p",
      playedAt: "2026-09-16T12:05:00Z",
      artwork: "https://example.com/a.jpg",
    });
    deepStrictEqual(row.artwork, { url: "https://example.com/a.jpg" });
  });
});

describe("validateActionRequest", () => {
  it("exposes exactly the six typed actions, with no combined library+profile action", () => {
    deepStrictEqual([...NEW_PLAY_ACTIONS], [
      "love",
      "more_like_this",
      "wrong_context",
      "not_for_me",
      "add_to_apple_library",
      "approve_for_context",
    ]);
  });

  it("accepts a plain feedback action without context", () => {
    deepStrictEqual(validateActionRequest({ playId: "p", action: "love" }), {
      ok: true,
      value: { playId: "p", action: "love", context: null },
    });
    deepStrictEqual(validateActionRequest({ playId: "p", action: "add_to_apple_library", context: "" }), {
      ok: true,
      value: { playId: "p", action: "add_to_apple_library", context: null },
    });
  });

  it("fails closed when a context-scoped action has no context", () => {
    for (const action of ["wrong_context", "approve_for_context"]) {
      for (const context of [undefined, null, "", "   "]) {
        const result = validateActionRequest({ playId: "p", action, context });
        equal(result.ok, false, `${action} with ${JSON.stringify(context)}`);
        if (!result.ok) equal(result.error, `${action} requires a non-empty context`);
      }
      deepStrictEqual(validateActionRequest({ playId: "p", action, context: " dinner " }), {
        ok: true,
        value: { playId: "p", action, context: "dinner" },
      });
    }
  });

  it("rejects unknown actions, missing ids, and non-string contexts", () => {
    equal(validateActionRequest({ playId: "p", action: "promote" }).ok, false);
    equal(validateActionRequest({ playId: "p", action: "add_and_approve" }).ok, false);
    equal(validateActionRequest({ action: "love" }).ok, false);
    equal(validateActionRequest({ playId: "", action: "love" }).ok, false);
    equal(validateActionRequest({ playId: "p" }).ok, false);
    equal(validateActionRequest({ playId: "p", action: "love", context: 5 }).ok, false);
    equal(validateActionRequest(null).ok, false);
    equal(validateActionRequest("love").ok, false);
  });
});

describe("artworkUrl", () => {
  it("fills Apple {w}/{h} placeholders with a square size", () => {
    equal(
      artworkUrl({ url: "https://is1-ssl.mzstatic.com/image/thumb/abc/{w}x{h}bb.jpg" }),
      "https://is1-ssl.mzstatic.com/image/thumb/abc/300x300bb.jpg",
    );
    equal(
      artworkUrl({ url: "https://is1-ssl.mzstatic.com/image/thumb/abc/{w}x{h}bb.jpg", width: 3000 }, 120),
      "https://is1-ssl.mzstatic.com/image/thumb/abc/120x120bb.jpg",
    );
  });

  it("passes plain URLs through and returns null without artwork", () => {
    equal(artworkUrl({ url: "https://example.com/a.jpg" }), "https://example.com/a.jpg");
    equal(artworkUrl(null), null);
    equal(artworkUrl({ url: "" }), null);
  });

  it("falls back to 300 for a nonsense size", () => {
    equal(artworkUrl({ url: "x/{w}x{h}.jpg" }, 0), "x/300x300.jpg");
    equal(artworkUrl({ url: "x/{w}x{h}.jpg" }, Number.NaN), "x/300x300.jpg");
  });
});

describe("summarizeRequest", () => {
  it("renders intent, context, and room", () => {
    equal(
      summarizeRequest({
        room: "Living Room",
        requestContext: { intent: "play", context: "daytime" },
      }),
      "Play music · daytime · Living Room",
    );
  });

  it("includes genre and a distinct query, and tolerates missing parts", () => {
    equal(
      summarizeRequest({
        room: null,
        requestContext: { intent: "genre", genre: "jazz", query: "jazz", context: "dinner" },
      }),
      "Play genre · jazz · dinner",
    );
    equal(
      summarizeRequest({
        room: "Cinema",
        requestContext: { intent: "dj_session", query: "something like Bonobo", context: null },
      }),
      'DJ session · "something like Bonobo" · Cinema',
    );
    equal(summarizeRequest({ room: null, requestContext: { context: null } }), "Play music");
  });

  it("humanizes an unknown intent instead of dropping it", () => {
    equal(
      summarizeRequest({ room: null, requestContext: { intent: "morning_routine", context: "morning" } }),
      "Morning routine · morning",
    );
  });
});

describe("public feedback vocabulary (Love / Wrong context)", () => {
  it("maps the domain's internal event names to the public contract and keeps public names", () => {
    equal(publicFeedbackType("explicit_love"), "love");
    equal(publicFeedbackType("not_for_context"), "wrong_context");
    equal(publicFeedbackType("love"), "love");
    equal(publicFeedbackType("wrong_context"), "wrong_context");
    equal(publicFeedbackType("more_like_this"), "more_like_this");
    equal(publicFeedbackType("not_for_me"), "not_for_me");
    equal(publicFeedbackType(null), null);
  });

  it("renders Loved and Wrong context for both public and internal names", () => {
    for (const type of ["love", "explicit_love"]) {
      equal(feedbackLabel({ type, at: "2026-09-15T10:00:00.000Z", context: null }), "Loved");
      equal(feedbackTone(type), "green");
    }
    for (const type of ["wrong_context", "not_for_context"]) {
      equal(feedbackLabel({ type, at: "2026-09-15T10:00:00.000Z", context: "dinner" }), "Wrong context (dinner)");
      equal(feedbackTone(type), "amber");
    }
    equal(feedbackLabel({ type: "not_for_me", at: "2026-09-15T10:00:00.000Z", context: null }), "Not for me");
    equal(feedbackLabel(null), null);
    equal(feedbackTone(undefined), "stone");
  });

  it("normalizes mirrored rows to the public vocabulary", () => {
    const row = normalizeNewPlayRow({
      playId: "p1",
      playedAt: "2026-09-15T10:00:00.000Z",
      feedback: { type: "not_for_context", at: "2026-09-15T10:03:00.000Z", context: "dinner" },
      feedbackHistory: [
        { type: "explicit_love", at: "2026-09-15T10:01:00.000Z" },
        { type: "not_for_context", at: "2026-09-15T10:03:00.000Z", context: "dinner" },
      ],
    });
    equal(row.feedback?.type, "wrong_context");
    deepStrictEqual(row.feedbackHistory.map((f) => f.type), ["love", "wrong_context"]);
  });
});
