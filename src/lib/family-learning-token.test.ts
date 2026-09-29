// Learning credentials: audience separation, expiry, tamper resistance and
// the AUTH_SECRET-derived key (DESIGN §7.6 child isolation / parent unlock).
// Run with: npm test

import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHILD_LEARNING_TTL_SECONDS,
  deriveLearningKey,
  LEARNING_TOKEN_ISSUER,
  mintChildLearningToken,
  mintToken,
  readBearer,
  RETIRED_AUDIENCES,
  verifyChildLearningToken,
} from "./family-learning-token.ts";

const env = { AUTH_SECRET: "0123456789abcdef0123456789abcdef-test-secret" };
const key = deriveLearningKey(env)!;
const now = 1_800_000_000;

describe("deriveLearningKey", () => {
  it("fails closed without a usable AUTH_SECRET", () => {
    equal(deriveLearningKey({}), null);
    equal(deriveLearningKey({ AUTH_SECRET: "short" }), null);
    ok(key.length === 32);
  });
  it("is deterministic and differs from the raw secret", () => {
    equal(deriveLearningKey(env)!.equals(key), true);
    equal(key.toString("utf8").includes("test-secret"), false);
  });
});

describe("child learning token", () => {
  it("round-trips and binds the subject to one child", () => {
    const { token, expiresAt } = mintChildLearningToken(key, "santiago", "jti-1", now);
    equal(expiresAt, (now + CHILD_LEARNING_TTL_SECONDS) * 1000);
    const verified = verifyChildLearningToken(key, token, now + 10);
    ok(verified.ok && verified.claims.sub === "santiago" && verified.claims.jti === "jti-1");
  });
  it("expires, refuses tampering and refuses the wrong key", () => {
    const { token } = mintChildLearningToken(key, "isabel", "jti-2", now);
    equal(verifyChildLearningToken(key, token, now + CHILD_LEARNING_TTL_SECONDS).ok, false);
    const [p, payload, sig] = token.split(".");
    const forged = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").replace("isabel", "santiago");
    const forgedToken = `${p}.${Buffer.from(forged).toString("base64").replace(/=+$/, "")}.${sig}`;
    const forgedResult = verifyChildLearningToken(key, forgedToken, now + 1);
    ok(!forgedResult.ok && forgedResult.reason === "bad-signature");
    const otherKey = deriveLearningKey({ AUTH_SECRET: "another-secret-that-is-long-enough-000000" })!;
    ok(!verifyChildLearningToken(otherKey, token, now + 1).ok);
    ok(!verifyChildLearningToken(key, "fct1.abc.def", now).ok);
    ok(!verifyChildLearningToken(key, "", now).ok);
  });
  it("refuses tokens minted for the retired step-up audiences", () => {
    for (const aud of RETIRED_AUDIENCES) {
      const claims = { v: 1 as const, iss: LEARNING_TOKEN_ISSUER, aud, sub: "santiago", iat: now, exp: now + 600, jti: "j" };
      const token = mintToken(key, claims as unknown as Parameters<typeof mintToken>[1]);
      const result = verifyChildLearningToken(key, token, now + 1);
      ok(!result.ok && result.reason === "bad-audience");
    }
  });
});

describe("readBearer", () => {
  it("accepts only a well-formed bearer header", () => {
    equal(readBearer("Bearer abc.def.ghi"), "abc.def.ghi");
    equal(readBearer("bearer x"), "x");
    equal(readBearer("Basic abc"), null);
    equal(readBearer(null), null);
    equal(readBearer("Bearer"), null);
  });
});
