// Unit tests for the child-scoped Family Assistant bridge credential and its
// wire envelope.
//
// Two things are being protected here:
//
//  1. the credential boundary — a minted token names exactly one child and one
//     surface session, expires in minutes, and never carries operator scope;
//  2. interoperability with the verifying half on the Mac mini, which lives in
//     a different repository (`projects/family-assistant/openclaw-plugin/
//     src/bridge/token.ts`) and asserts the same golden vector.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { createHmac } from "node:crypto";
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRIDGE_SECRET_MIN_CHARS,
  BRIDGE_TOKEN_MAX_TTL_SECONDS,
  BRIDGE_TOKEN_SECRET_ENV,
  BRIDGE_TOKEN_TTL_SECONDS,
  BRIDGE_URL_ENV,
  BridgeTokenMintError,
  CHILD_BRIDGE_TOKEN_GOLDEN_VECTOR,
  buildChildBridgeSession,
  mintBridgeToken,
  resolveBridgeMintConfig,
  serializeBridgeClaims,
} from "./family-assistant-bridge.ts";
import {
  childFacingRecovery,
  envelopeSpokenText,
  isRetryable,
  parseChildTurnEnvelope,
  plainTextForChild,
  readAssistantBlocks,
} from "./family-assistant-turn.ts";

const SECRET = "companion-app-bridge-test-secret-0123456789";
const NOW_MS = 1_800_000_000_000;

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    [BRIDGE_TOKEN_SECRET_ENV]: SECRET,
    [BRIDGE_URL_ENV]: "https://mini.tail.ts.net:8787",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Interoperability with the bridge
// ---------------------------------------------------------------------------

describe("bridge token — interoperability", () => {
  it("reproduces the golden vector the bridge verifies", () => {
    const vector = CHILD_BRIDGE_TOKEN_GOLDEN_VECTOR;
    const { token, claims } = mintBridgeToken({
      secret: vector.secret,
      childId: vector.childId,
      sessionSuffix: vector.sessionSuffix,
      jti: vector.jti,
      issuedAtSeconds: vector.issuedAtSeconds,
      ttlSeconds: vector.ttlSeconds,
    });
    equal(serializeBridgeClaims(claims), vector.serializedClaims);
    equal(token, vector.token);
  });

  it("signs over the prefix and payload, so neither can be swapped", () => {
    // Re-derives the signature independently of the implementation: if the
    // signing input ever changes shape, this fails rather than the bridge.
    const { token } = mintBridgeToken({
      secret: SECRET,
      childId: "isabel",
      sessionSuffix: "ipad",
      jti: "t1",
      issuedAtSeconds: 1_770_000_000,
    });
    const [prefix, payload, signature] = token.split(".");
    const expected = createHmac("sha256", SECRET).update(`${prefix}.${payload}`).digest("base64url");
    equal(signature, expected);
    equal(prefix, "fct1");
  });
});

// ---------------------------------------------------------------------------
// The credential boundary
// ---------------------------------------------------------------------------

describe("bridge token — scope", () => {
  it("names exactly one child and one surface session", () => {
    const { claims } = mintBridgeToken({
      secret: SECRET,
      childId: "santiago",
      sessionSuffix: "ipad",
      jti: "t1",
      issuedAtSeconds: 1_770_000_000,
    });
    deepStrictEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "iss", "jti", "sid", "sub", "v"]);
    equal(claims.sub, "santiago");
    equal(claims.sid, "ipad");
    // No scope, role, permission or agent-list claim exists to be widened.
    equal("scope" in claims, false);
  });

  it("expires in minutes and clamps a longer request", () => {
    const normal = mintBridgeToken({
      secret: SECRET,
      childId: "santiago",
      sessionSuffix: "ipad",
      jti: "t1",
      issuedAtSeconds: 1_770_000_000,
    });
    equal(normal.claims.exp - normal.claims.iat, BRIDGE_TOKEN_TTL_SECONDS);

    const greedy = mintBridgeToken({
      secret: SECRET,
      childId: "santiago",
      sessionSuffix: "ipad",
      jti: "t2",
      issuedAtSeconds: 1_770_000_000,
      ttlSeconds: 365 * 24 * 3600,
    });
    equal(greedy.claims.exp - greedy.claims.iat, BRIDGE_TOKEN_MAX_TTL_SECONDS);
  });

  it("refuses a subject that is not one of the two children", () => {
    for (const childId of ["main", "nabu", "", "SANTIAGO", "santiago "]) {
      throws(
        () =>
          mintBridgeToken({
            secret: SECRET,
            childId,
            sessionSuffix: "ipad",
            jti: "t1",
            issuedAtSeconds: 1_770_000_000,
          }),
        BridgeTokenMintError,
      );
    }
  });

  it("refuses a session suffix that could escape the child namespace", () => {
    // The Gateway session key is `agent:<child>:<suffix>`. A suffix containing
    // `:` would let a caller address `agent:main:main`.
    for (const suffix of ["main:main", "a:b", "", "x".repeat(65), "../evil"]) {
      throws(
        () =>
          mintBridgeToken({
            secret: SECRET,
            childId: "santiago",
            sessionSuffix: suffix,
            jti: "t1",
            issuedAtSeconds: 1_770_000_000,
          }),
        BridgeTokenMintError,
      );
    }
  });

  it("fails closed on a missing or under-length secret", () => {
    for (const secret of ["", "   ", "x".repeat(BRIDGE_SECRET_MIN_CHARS - 1)]) {
      throws(
        () =>
          mintBridgeToken({
            secret,
            childId: "santiago",
            sessionSuffix: "ipad",
            jti: "t1",
            issuedAtSeconds: 1_770_000_000,
          }),
        BridgeTokenMintError,
      );
    }
  });
});

describe("resolveBridgeMintConfig — fail closed", () => {
  it("reports the reason rather than falling back to a default", () => {
    equal(resolveBridgeMintConfig(env({ [BRIDGE_TOKEN_SECRET_ENV]: undefined })).ok, false);
    equal(resolveBridgeMintConfig(env({ [BRIDGE_TOKEN_SECRET_ENV]: "short" })).ok, false);
    equal(resolveBridgeMintConfig(env({ [BRIDGE_URL_ENV]: undefined })).ok, false);
    equal(resolveBridgeMintConfig(env({ [BRIDGE_URL_ENV]: "not-a-url" })).ok, false);
    equal(resolveBridgeMintConfig(env({ [BRIDGE_URL_ENV]: "file:///etc/passwd" })).ok, false);
  });

  it("keeps only the origin of a configured bridge URL", () => {
    const resolved = resolveBridgeMintConfig(env({ [BRIDGE_URL_ENV]: "https://mini.tail.ts.net:8787/some/path" }));
    ok(resolved.ok);
    if (resolved.ok) equal(resolved.config.bridgeUrl, "https://mini.tail.ts.net:8787");
  });

  // A token minted against a plaintext tailnet origin would be handed to the
  // iPad and then sent in clear, where anything else on the tailnet could read
  // it. Refusing at mint time means that misconfiguration produces a 503 rather
  // than a working-but-exposed credential.
  it("refuses http:// to any non-loopback host", () => {
    for (const url of [
      "http://mini.tail.ts.net:8787",
      "http://dae-macmini.tail4f656e.ts.net",
      "http://100.64.0.1:8787",
      "http://mini.local:8787",
    ]) {
      equal(resolveBridgeMintConfig(env({ [BRIDGE_URL_ENV]: url })).ok, false, url);
    }
  });

  it("still allows plaintext loopback, which is how local verification runs", () => {
    for (const url of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
      const resolved = resolveBridgeMintConfig(env({ [BRIDGE_URL_ENV]: url }));
      ok(resolved.ok, url);
      if (resolved.ok) equal(resolved.config.bridgeUrl, url);
    }
  });
});

// ---------------------------------------------------------------------------
// What the browser is allowed to receive
// ---------------------------------------------------------------------------

describe("buildChildBridgeSession — non-exposure", () => {
  it("returns a child-scoped session and no server secret", () => {
    const resolved = resolveBridgeMintConfig(env());
    ok(resolved.ok);
    if (!resolved.ok) return;
    const session = buildChildBridgeSession({
      config: resolved.config,
      childId: "isabel",
      sessionSuffix: "ipad",
      jti: "abc-123",
      nowMs: NOW_MS,
    });

    deepStrictEqual(Object.keys(session).sort(), [
      "bridgeUrl",
      "child",
      "expiresAt",
      "sessionSuffix",
      "token",
    ]);
    equal(session.child, "isabel");
    const serialized = JSON.stringify(session);
    // The signing secret is the one value that must never travel to a browser.
    equal(serialized.includes(SECRET), false);
    // Nor may anything Gateway-shaped: no URL, no bearer, no agent internals.
    for (const leak of ["18789", "operator", "openclaw", "gpt-5.6-sol", "child_memory"]) {
      equal(serialized.toLowerCase().includes(leak.toLowerCase()), false, leak);
    }
  });

  it("expires the returned session within the token lifetime", () => {
    const resolved = resolveBridgeMintConfig(env());
    ok(resolved.ok);
    if (!resolved.ok) return;
    const session = buildChildBridgeSession({
      config: resolved.config,
      childId: "santiago",
      sessionSuffix: "ipad",
      jti: "abc-123",
      nowMs: NOW_MS,
    });
    equal(session.expiresAt, NOW_MS - (NOW_MS % 1000) + BRIDGE_TOKEN_TTL_SECONDS * 1000);
    ok(session.expiresAt - NOW_MS <= BRIDGE_TOKEN_MAX_TTL_SECONDS * 1000);
  });
});

// ---------------------------------------------------------------------------
// The wire envelope the iPad renders
// ---------------------------------------------------------------------------

describe("child turn envelope", () => {
  it("reads a normal text reply", () => {
    const envelope = parseChildTurnEnvelope({
      v: 1,
      status: "ok",
      child: "santiago",
      blocks: [{ type: "text", text: "Because the air scatters blue light." }],
      meta: { requestId: "r1", durationMs: 900 },
    });
    equal(envelope.status, "ok");
    equal(envelopeSpokenText(envelope), "Because the air scatters blue light.");
    equal(isRetryable(envelope), false);
  });

  it("treats an ok status with nothing renderable as an error", () => {
    // Fails closed in the one way that matters to a child: never an empty
    // answer bubble presented as a reply.
    const envelope = parseChildTurnEnvelope({ v: 1, status: "ok", child: "santiago", blocks: [], meta: {} });
    equal(envelope.status, "error");
    ok(envelope.error);
  });

  it("survives a hostile or unrecognizable body", () => {
    for (const body of [null, undefined, 42, "boom", [], { status: "weird" }]) {
      const envelope = parseChildTurnEnvelope(body);
      equal(envelope.status, "error");
      deepStrictEqual(envelope.blocks, []);
    }
  });

  it("keeps a future block type instead of failing on it", () => {
    // Forward compatibility: a Phase 3 bridge sending a Sonos card must not
    // break an iPad running this build.
    const blocks = readAssistantBlocks([
      { type: "text", text: "Here is one idea" },
      { type: "sonos-candidate", title: "Ninjago 42", room: "Kitchen" },
    ]);
    equal(blocks.length, 2);
    equal(blocks[0]?.type, "text");
    equal(blocks[1]?.type, "unknown");

    const envelope = parseChildTurnEnvelope({
      v: 99,
      status: "ok",
      child: "santiago",
      blocks,
      meta: { requestId: "r" },
    });
    equal(envelope.status, "ok");
    equal(envelopeSpokenText(envelope), "Here is one idea");
  });

  it("reads a media candidate card, artwork included, and only over https", () => {
    const blocks = readAssistantBlocks([
      {
        type: "card",
        title: "**Kids Dance Party**",
        subtitle: "Apple Music · playlist",
        meta: "Living Room · tap or say yes to play",
        imageUrl: "https://art.invalid/a.jpg",
      },
      { type: "card", title: "Ninjago Soundtrack", imageUrl: "http://insecure.invalid/a.jpg" },
    ]);
    deepStrictEqual(blocks[0], {
      type: "card",
      // Markdown markers are stripped here like everywhere else a reply enters
      // the app, so the card reads the same as the bubble.
      title: "Kids Dance Party",
      subtitle: "Apple Music · playlist",
      meta: "Living Room · tap or say yes to play",
      imageUrl: "https://art.invalid/a.jpg",
    });
    // Plaintext artwork is dropped; the card still renders without a picture.
    deepStrictEqual(blocks[1], { type: "card", title: "Ninjago Soundtrack" });

    const envelope = parseChildTurnEnvelope({
      v: 1,
      status: "ok",
      child: "santiago",
      blocks: [{ type: "text", text: "I found two. Which one?" }, ...blocks],
      meta: { requestId: "r" },
    });
    equal(envelope.status, "ok");
    // The spoken reply is the text block alone: a card is shown, not read out.
    equal(envelopeSpokenText(envelope), "I found two. Which one?");
  });

  it("maps failures to child-appropriate wording and a retry decision", () => {
    const cases: [string, boolean][] = [
      ["busy", true],
      ["timeout", true],
      ["rate_limited", false],
      ["unauthorized", false],
      ["upstream_unavailable", false],
      ["turn_failed", false],
    ];
    for (const [code, retryableByCode] of cases) {
      const envelope = parseChildTurnEnvelope({
        v: 1,
        status: "error",
        child: "santiago",
        blocks: [],
        meta: { requestId: "r" },
        error: { code, message: "adult-facing detail" },
      });
      const line = childFacingRecovery(envelope);
      ok(line.length > 0, code);
      // The bridge's adult-facing message is never what a child reads.
      equal(line.includes("adult-facing detail"), false, code);
      equal(isRetryable(envelope), retryableByCode, code);
    }
  });

  it("honours an explicit retryable flag from the bridge", () => {
    const envelope = parseChildTurnEnvelope({
      v: 1,
      status: "error",
      child: "santiago",
      blocks: [],
      meta: { requestId: "r" },
      error: { code: "upstream_unavailable", message: "x", retryable: true },
    });
    equal(isRetryable(envelope), true);
  });
});

// ---------------------------------------------------------------------------
// What a child actually sees and hears
// ---------------------------------------------------------------------------

describe("plainTextForChild", () => {
  it("removes the emphasis markers a model emits by habit", () => {
    const cases: [string, string][] = [
      ["You need **3 apples**.", "You need 3 apples."],
      ["You need __3 apples__.", "You need 3 apples."],
      ["That was *really* fast!", "That was really fast!"],
      ["That was _really_ fast!", "That was really fast!"],
      ["~~six~~ five apples", "six five apples"],
      ["Type `npm test` to check.", "Type npm test to check."],
      ["## Your routine\nBrush teeth", "Your routine\nBrush teeth"],
      ["**_Both at once_**", "Both at once"],
    ];
    for (const [input, expected] of cases) equal(plainTextForChild(input), expected, input);
  });

  // The markers are only markers when they wrap something. Stripping too
  // eagerly would quietly corrupt arithmetic and identifiers a child asked
  // about, which is worse than leaving a stray asterisk on screen.
  it("leaves ordinary punctuation, arithmetic and identifiers alone", () => {
    for (const text of [
      "2 * 3 * 4 = 24",
      "snake_case_name",
      "5 stars * * *",
      "a ** b",
      "What does _ mean?",
      "3 * 4",
    ]) {
      equal(plainTextForChild(text), text, text);
    }
  });

  it("changes nothing in text that has no markers", () => {
    const text = "The sky looks blue because the air scatters blue light more than red light.";
    equal(plainTextForChild(text), text);
  });

  // Display and speech read the same normalized string. A regression that
  // normalized only one of them would show clean text and still say "star
  // star three apples star star".
  it("normalizes the rendered block and the spoken line identically", () => {
    const envelope = parseChildTurnEnvelope({
      v: 1,
      status: "ok",
      child: "isabel",
      blocks: [
        { type: "text", text: "You need **3 apples** and `2 pears`." },
        { type: "card", title: "**Snack time**", subtitle: "_after school_", meta: "`5 points`" },
      ],
      meta: { requestId: "r" },
    });
    const [text, card] = envelope.blocks;
    equal(text?.type === "text" ? text.text : null, "You need 3 apples and 2 pears.");
    deepStrictEqual(
      card?.type === "card" ? [card.title, card.subtitle, card.meta] : null,
      ["Snack time", "after school", "5 points"],
    );
    equal(envelopeSpokenText(envelope), "You need 3 apples and 2 pears.");
  });

  // Negative control: the normalization is a text strip, not a renderer. If
  // someone ever swaps in a markdown-to-HTML step, this fails.
  it("never produces markup from a reply that contains markup", () => {
    const hostile = "**bold** <script>alert(1)</script> [link](https://evil.example) <b>x</b>";
    const out = plainTextForChild(hostile);
    equal(out.includes("bold"), true);
    // Angle brackets and link syntax survive verbatim as literal text: they are
    // rendered as text nodes, so nothing needs to interpret or sanitize them.
    equal(out.includes("<script>alert(1)</script>"), true);
    equal(out.includes("[link](https://evil.example)"), true);
  });
});
