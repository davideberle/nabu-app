// Unit tests for the trusted-runtime write policy behind the Cooking
// Session mutation routes (POST /api/cooking/session,
// POST /api/cooking/session/from-plan, PATCH /api/cooking/session/:id).
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  MIN_TRUSTED_RUNTIME_TOKEN_LENGTH,
  TRUSTED_RUNTIME_TOKEN_ENV,
  evaluateRuntimeWriteAccess,
  extractBearerToken,
  getTrustedRuntimeToken,
  tokensMatch,
} from "./runtime-auth.ts";
import { isTrustedRuntimeApiRoute } from "./access.ts";

const TOKEN = "trusted-runtime-token-for-tests-0123456789";
const HOUSEHOLD = { user: { email: "info@davideberle.com" } };
const TRACKER = { user: { email: "assistant@davideberle.com" } };

afterEach(() => {
  delete process.env[TRUSTED_RUNTIME_TOKEN_ENV];
  delete process.env.IPAD_TRACKER_ONLY_EMAILS;
});

describe("getTrustedRuntimeToken", () => {
  it("returns null when the server has no token configured", () => {
    equal(getTrustedRuntimeToken({}), null);
    equal(getTrustedRuntimeToken({ [TRUSTED_RUNTIME_TOKEN_ENV]: "" }), null);
    equal(getTrustedRuntimeToken({ [TRUSTED_RUNTIME_TOKEN_ENV]: "    " }), null);
  });

  it("treats a too-short value as not configured, so a placeholder fails closed", () => {
    const short = "x".repeat(MIN_TRUSTED_RUNTIME_TOKEN_LENGTH - 1);
    equal(getTrustedRuntimeToken({ [TRUSTED_RUNTIME_TOKEN_ENV]: short }), null);
  });

  it("reads and trims a configured token", () => {
    equal(getTrustedRuntimeToken({ [TRUSTED_RUNTIME_TOKEN_ENV]: `  ${TOKEN}  ` }), TOKEN);
  });
});

describe("extractBearerToken", () => {
  it("reads the credential from a Bearer header, case-insensitively", () => {
    equal(extractBearerToken(`Bearer ${TOKEN}`), TOKEN);
    equal(extractBearerToken(`bearer ${TOKEN}`), TOKEN);
    equal(extractBearerToken(`  Bearer   ${TOKEN}  `), TOKEN);
  });

  it("returns null for missing, empty, or non-Bearer headers", () => {
    equal(extractBearerToken(null), null);
    equal(extractBearerToken(undefined), null);
    equal(extractBearerToken(""), null);
    equal(extractBearerToken("Bearer"), null);
    equal(extractBearerToken("Bearer   "), null);
    equal(extractBearerToken(`Basic ${TOKEN}`), null);
  });
});

describe("tokensMatch", () => {
  it("matches only an exact credential", () => {
    equal(tokensMatch(TOKEN, TOKEN), true);
    equal(tokensMatch(TOKEN, TOKEN + "x"), false);
    equal(tokensMatch(TOKEN.slice(0, -1), TOKEN), false);
    equal(tokensMatch(TOKEN.toUpperCase(), TOKEN), false);
  });

  it("never matches when either side is missing", () => {
    equal(tokensMatch(null, TOKEN), false);
    equal(tokensMatch(TOKEN, null), false);
    equal(tokensMatch(null, null), false);
    equal(tokensMatch("", ""), false);
  });
});

describe("evaluateRuntimeWriteAccess", () => {
  it("rejects anonymous requests with 401", () => {
    deepStrictEqual(evaluateRuntimeWriteAccess(null, null, { token: TOKEN }), {
      allowed: false,
      status: 401,
      error: "Unauthorized",
    });
  });

  it("rejects tracker-only (shared iPad) sessions with 403", () => {
    deepStrictEqual(evaluateRuntimeWriteAccess(TRACKER, null, { token: TOKEN }), {
      allowed: false,
      status: 403,
      error: "Forbidden",
    });
  });

  it("allows the canonical authorized household session", () => {
    deepStrictEqual(evaluateRuntimeWriteAccess(HOUSEHOLD, null, { token: TOKEN }), {
      allowed: true,
      via: "session",
    });
  });

  it("allows an anonymous request carrying the exact trusted-runtime token", () => {
    deepStrictEqual(
      evaluateRuntimeWriteAccess(null, `Bearer ${TOKEN}`, { token: TOKEN }),
      { allowed: true, via: "trusted-runtime" },
    );
  });

  it("rejects a wrong or truncated token like an anonymous request", () => {
    deepStrictEqual(
      evaluateRuntimeWriteAccess(null, `Bearer ${TOKEN}x`, { token: TOKEN }),
      { allowed: false, status: 401, error: "Unauthorized" },
    );
    deepStrictEqual(
      evaluateRuntimeWriteAccess(null, `Bearer ${TOKEN.slice(0, 10)}`, { token: TOKEN }),
      { allowed: false, status: 401, error: "Unauthorized" },
    );
  });

  it("fails closed when the server has no token: no credential can authorize", () => {
    for (const configured of [null, "", "   ", "short"]) {
      deepStrictEqual(
        evaluateRuntimeWriteAccess(null, `Bearer ${TOKEN}`, { token: configured || null }),
        { allowed: false, status: 401, error: "Unauthorized" },
        `configured=${JSON.stringify(configured)}`,
      );
      // Even a credential equal to the (blank) server value grants nothing.
      deepStrictEqual(
        evaluateRuntimeWriteAccess(null, `Bearer ${configured ?? ""}`, {
          token: configured || null,
        }),
        { allowed: false, status: 401, error: "Unauthorized" },
      );
    }
  });

  it("fails closed when the environment has no token", () => {
    deepStrictEqual(
      evaluateRuntimeWriteAccess(null, `Bearer ${TOKEN}`, { env: {} }),
      { allowed: false, status: 401, error: "Unauthorized" },
    );
  });

  it("still refuses a tracker-only session that carries a bad token", () => {
    deepStrictEqual(
      evaluateRuntimeWriteAccess(TRACKER, "Bearer nope", { token: TOKEN }),
      { allowed: false, status: 403, error: "Forbidden" },
    );
  });

  it("honours a valid token even for a tracker-only browser session", () => {
    // The token is a runtime credential, not a user: presenting it proves the
    // caller is the trusted runtime regardless of which cookie rode along.
    deepStrictEqual(
      evaluateRuntimeWriteAccess(TRACKER, `Bearer ${TOKEN}`, { token: TOKEN }),
      { allowed: true, via: "trusted-runtime" },
    );
  });

  it("reads the configured token from the environment when none is passed", () => {
    process.env[TRUSTED_RUNTIME_TOKEN_ENV] = TOKEN;
    deepStrictEqual(evaluateRuntimeWriteAccess(null, `Bearer ${TOKEN}`), {
      allowed: true,
      via: "trusted-runtime",
    });
  });
});

// ---------------------------------------------------------------------------
// Middleware + route guard, as one chain
//
// The policy has two enforcement points and they used to disagree: middleware
// refused a tracker-only cookie on these routes before the guard could look at
// the bearer, so a valid runtime token was rejected with 403 even though the
// unit test above says it must be accepted. This models both hops.
// ---------------------------------------------------------------------------

type ChainOutcome =
  | { allowed: true; via: "session" | "trusted-runtime" }
  | { allowed: false; status: 401 | 403; by: "middleware" | "guard" };

/** Middleware decision, then the route guard's, exactly as production runs them. */
function chain(
  method: string,
  path: string,
  session: typeof HOUSEHOLD | typeof TRACKER | null,
  authorization: string | null,
  token: string | null,
): ChainOutcome {
  const trackerOnly = Boolean(session?.user?.email) && session!.user!.email === TRACKER.user.email;
  if (path.startsWith("/api/") && session && trackerOnly) {
    if (!isTrustedRuntimeApiRoute(method, path)) {
      return { allowed: false, status: 403, by: "middleware" };
    }
  }
  const access = evaluateRuntimeWriteAccess(session, authorization, { token });
  return access.allowed
    ? { allowed: true, via: access.via }
    : { allowed: false, status: access.status, by: "guard" };
}

const RUNTIME_ROUTES: [string, string][] = [
  ["POST", "/api/cooking/session"],
  ["POST", "/api/cooking/session/from-plan"],
  ["PATCH", "/api/cooking/session/abc-123"],
];

describe("middleware + guard: authorized session OR valid runtime token", () => {
  it("lets a tracker cookie carrying the exact valid bearer through", () => {
    for (const [method, path] of RUNTIME_ROUTES) {
      deepStrictEqual(
        chain(method, path, TRACKER, `Bearer ${TOKEN}`, TOKEN),
        { allowed: true, via: "trusted-runtime" },
        `${method} ${path}`,
      );
    }
  });

  it("still refuses a tracker cookie with no bearer, at the guard", () => {
    for (const [method, path] of RUNTIME_ROUTES) {
      deepStrictEqual(
        chain(method, path, TRACKER, null, TOKEN),
        { allowed: false, status: 403, by: "guard" },
        `${method} ${path}`,
      );
    }
  });

  it("still refuses a tracker cookie with a wrong bearer", () => {
    for (const [method, path] of RUNTIME_ROUTES) {
      deepStrictEqual(
        chain(method, path, TRACKER, `Bearer ${TOKEN}x`, TOKEN),
        { allowed: false, status: 403, by: "guard" },
        `${method} ${path}`,
      );
    }
  });

  it("fails closed for a valid-looking bearer when the server has no token", () => {
    for (const [method, path] of RUNTIME_ROUTES) {
      deepStrictEqual(
        chain(method, path, TRACKER, `Bearer ${TOKEN}`, null),
        { allowed: false, status: 403, by: "guard" },
        `${method} ${path}`,
      );
      deepStrictEqual(
        chain(method, path, null, `Bearer ${TOKEN}`, null),
        { allowed: false, status: 401, by: "guard" },
        `${method} ${path}`,
      );
    }
  });

  it("keeps refusing a tracker cookie on every other API surface, at middleware", () => {
    for (const [method, path] of [
      ["POST", "/api/meals/plan"],
      ["POST", "/api/shopping"],
      ["POST", "/api/cook-events"],
      ["GET", "/api/cooking/session"],
      ["POST", "/api/recipes/image"],
      ["POST", "/api/shopping/outbox"],
    ] as [string, string][]) {
      deepStrictEqual(
        chain(method, path, TRACKER, `Bearer ${TOKEN}`, TOKEN),
        { allowed: false, status: 403, by: "middleware" },
        `${method} ${path}`,
      );
    }
  });

  it("leaves the authorized household session working with no bearer at all", () => {
    for (const [method, path] of RUNTIME_ROUTES) {
      deepStrictEqual(
        chain(method, path, HOUSEHOLD, null, TOKEN),
        { allowed: true, via: "session" },
        `${method} ${path}`,
      );
    }
  });

  it("refuses an anonymous request with 401 rather than 403", () => {
    for (const [method, path] of RUNTIME_ROUTES) {
      deepStrictEqual(
        chain(method, path, null, null, TOKEN),
        { allowed: false, status: 401, by: "guard" },
        `${method} ${path}`,
      );
    }
  });
});
