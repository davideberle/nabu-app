// Child games bearer + Studio play credential + settlement signature (GP-08). Run: npm test

import { equal, notEqual, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveGamesKey,
  derivePlayKey,
  deriveSharedPlayKey,
  mintChildGamesToken,
  mintPlayCredential,
  PLAY_CREDENTIAL_MAX_TTL_SECONDS,
  PLAY_CREDENTIAL_TTL_SECONDS,
  PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS,
  playCredentialTtlSeconds,
  readBearer,
  resolveStudioConfig,
  signSettlement,
  verifyChildGamesToken,
  verifyPlayCredential,
  verifySettlementSignature,
} from "./family-games-token.ts";
import { deriveLearningKey } from "./family-learning-token.ts";

const env = { AUTH_SECRET: "x".repeat(40), FAMILY_GAMES_TOKEN_SECRET: "y".repeat(40), FAMILY_GAMES_STUDIO_URL: "https://dae-macmini.tail4f656e.ts.net:8444" };
const now = 1_790_000_000;

describe("keys", () => {
  it("fail closed on a missing or short secret", () => {
    equal(deriveGamesKey({}), null);
    equal(deriveGamesKey({ AUTH_SECRET: "short" }), null);
    equal(derivePlayKey({}), null);
  });
  it("the games key differs from the learning key derived from the same AUTH_SECRET", () => {
    notEqual(deriveGamesKey(env)!.toString("hex"), deriveLearningKey(env)!.toString("hex"));
  });
  it("the Studio key is a deterministic function of the shared secret (adapter test vector)", () => {
    equal(deriveSharedPlayKey("y".repeat(40)).toString("hex"), derivePlayKey(env)!.toString("hex"));
    equal(deriveSharedPlayKey("test-secret-0123456789-0123456789-abc").toString("hex"), deriveSharedPlayKey("test-secret-0123456789-0123456789-abc").toString("hex"));
  });
  it("refuses a plaintext non-loopback Studio URL", () => {
    equal(resolveStudioConfig({ ...env, FAMILY_GAMES_STUDIO_URL: "http://dae-macmini.tail4f656e.ts.net:8444" }).ok, false);
    equal(resolveStudioConfig({ ...env, FAMILY_GAMES_STUDIO_URL: "http://127.0.0.1:5183" }).ok, true);
    const cfg = resolveStudioConfig(env);
    ok(cfg.ok && cfg.studioUrl === "https://dae-macmini.tail4f656e.ts.net:8444");
  });
});

describe("child games bearer", () => {
  const key = deriveGamesKey(env)!;
  it("round-trips and binds exactly one child", () => {
    const { token } = mintChildGamesToken(key, "isabel", "j1", now);
    const v = verifyChildGamesToken(key, token, now + 10);
    ok(v.ok && v.claims.sub === "isabel");
  });
  it("expires, and refuses a learning or play credential presented in its place", () => {
    const { token } = mintChildGamesToken(key, "isabel", "j1", now);
    equal(verifyChildGamesToken(key, token, now + 15 * 60).ok, false);
    const play = mintPlayCredential(derivePlayKey(env)!, { child: "isabel", scope: "library", gameId: "*", leaseId: "-", mode: "edit", metered: false, budgetSeconds: 0, jti: "j2", nowSeconds: now });
    equal(verifyChildGamesToken(key, play.token, now).ok, false);
    equal(verifyChildGamesToken(deriveLearningKey(env)!, token, now).ok, false);
  });
  it("a tampered subject fails the signature", () => {
    const { token } = mintChildGamesToken(key, "isabel", "j1", now);
    const [p, payload, sig] = token.split(".");
    const forged = Buffer.from(Buffer.from(payload, "base64url").toString("utf8").replace("isabel", "santiago")).toString("base64url");
    equal(verifyChildGamesToken(key, `${p}.${forged}.${sig}`, now).ok, false);
  });
});

describe("Studio play credential", () => {
  const key = derivePlayKey(env)!;
  it("carries child, game, lease, mode and budget, and verifies under the shared key only", () => {
    const { token } = mintPlayCredential(key, { child: "santiago", scope: "lease", gameId: "6bd56478-5ea0-4f2a-a2db-be8549a88d05", leaseId: "lease-0000000001", mode: "play", metered: true, budgetSeconds: 600, jti: "j3", nowSeconds: now });
    const v = verifyPlayCredential(key, token, now + 1);
    ok(v.ok && v.claims.sub === "santiago" && v.claims.lid === "lease-0000000001" && v.claims.metered && v.claims.budget === 600 && v.claims.mode === "play");
    equal(verifyPlayCredential(deriveGamesKey(env)!, token, now + 1).ok, false);
  });
  it("a library-scope credential never names a lease", () => {
    const { token } = mintPlayCredential(key, { child: "santiago", scope: "library", gameId: "ignored", leaseId: "ignored", mode: "edit", metered: false, budgetSeconds: 0, jti: "j4", nowSeconds: now });
    const v = verifyPlayCredential(key, token, now);
    ok(v.ok && v.claims.gid === "*" && v.claims.lid === "-");
  });
  it("expires after its TTL (replay of an old credential fails)", () => {
    const { token } = mintPlayCredential(key, { child: "santiago", scope: "lease", gameId: "g1", leaseId: "lease-0000000001", mode: "play", metered: true, budgetSeconds: 600, jti: "j5", nowSeconds: now, ttlSeconds: 60 });
    equal(verifyPlayCredential(key, token, now + 61).ok, false);
  });
  it("reads only a Bearer header", () => {
    equal(readBearer("Bearer abc.def.ghi"), "abc.def.ghi");
    equal(readBearer("Basic abc"), null);
    equal(readBearer(null), null);
  });
});

describe("settlement signature", () => {
  const key = derivePlayKey(env)!;
  const body = JSON.stringify({ consumedSeconds: 120, end: false });
  it("verifies a fresh signature and rejects skew, tampering, retargeting to another lease and a missing header", () => {
    const sig = signSettlement(key, now, "lease-aaaaaaaaaaaa", body);
    equal(verifySettlementSignature(key, sig, String(now), "lease-aaaaaaaaaaaa", body, now + 5).ok, true);
    equal(verifySettlementSignature(key, sig, String(now), "lease-bbbbbbbbbbbb", body, now + 5).ok, false);
    equal(verifySettlementSignature(key, sig, String(now), "lease-aaaaaaaaaaaa", body + " ", now + 5).ok, false);
    equal(verifySettlementSignature(key, sig, String(now), "lease-aaaaaaaaaaaa", body, now + 1000).ok, false);
    equal(verifySettlementSignature(key, null, String(now), "lease-aaaaaaaaaaaa", body, now).ok, false);
  });
});

describe("lease credential life (November 1, 2026: a 1800 s lease must not end credential-expired after 20 minutes)", () => {
  it("is the lease budget plus the unbilled allowance for menus, pauses and loading", () => {
    equal(PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS, 30 * 60);
    equal(playCredentialTtlSeconds(1800), 1800 + 30 * 60);
    equal(playCredentialTtlSeconds(900), 900 + 30 * 60);
    equal(playCredentialTtlSeconds(2), 2 + 30 * 60);
  });
  it("never falls below the former fixed life and never exceeds the maximum", () => {
    // The allowance alone already exceeds the former fixed life, so the floor is a guard, never the result.
    ok(PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS >= PLAY_CREDENTIAL_TTL_SECONDS);
    equal(playCredentialTtlSeconds(0), PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS);
    equal(playCredentialTtlSeconds(-5), PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS);
    equal(playCredentialTtlSeconds(Number.NaN), PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS);
    ok(playCredentialTtlSeconds(0) >= PLAY_CREDENTIAL_TTL_SECONDS);
    equal(playCredentialTtlSeconds(PLAY_CREDENTIAL_MAX_TTL_SECONDS), PLAY_CREDENTIAL_MAX_TTL_SECONDS);
    equal(playCredentialTtlSeconds(10 * 60 * 60), PLAY_CREDENTIAL_MAX_TTL_SECONDS);
    equal(playCredentialTtlSeconds(1799.9), 1799 + 30 * 60);
  });
  it("a lease credential minted with that life outlives its budget, is verified, and a library credential keeps the fixed life", () => {
    const key = derivePlayKey(env)!;
    const budget = 1800;
    const minted = mintPlayCredential(key, { child: "santiago", scope: "lease", gameId: "deimos-rising", leaseId: "lease-bb8e3cbd43c14d88a3eb89e6", mode: "play", metered: true, budgetSeconds: budget, jti: "ttl-1", nowSeconds: now, ttlSeconds: playCredentialTtlSeconds(budget) });
    equal(minted.expiresAt, (now + budget + PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS) * 1000);
    // Still valid at the instant today's credential died (20 minutes) and at the end of the full budget.
    ok(verifyPlayCredential(key, minted.token, now + PLAY_CREDENTIAL_TTL_SECONDS).ok);
    ok(verifyPlayCredential(key, minted.token, now + budget + 60).ok);
    equal(verifyPlayCredential(key, minted.token, now + budget + PLAY_CREDENTIAL_UNBILLED_ALLOWANCE_SECONDS).ok, false);
    const library = mintPlayCredential(key, { child: "santiago", scope: "library", gameId: "*", leaseId: "-", mode: "edit", metered: false, budgetSeconds: 0, jti: "ttl-2", nowSeconds: now });
    equal(library.expiresAt, (now + PLAY_CREDENTIAL_TTL_SECONDS) * 1000);
  });
});
