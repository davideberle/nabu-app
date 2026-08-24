// Unit tests for the session-access rules, in particular the canonical
// planner/domain write decision that `runtime-auth.ts` binds to the Cooking
// Session mutation routes (POST /api/cooking/session, POST …/from-plan,
// PATCH …/:id), and the middleware exemption list for those routes.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  evaluateHealthAccess,
  evaluatePlannerWriteAccess,
  getTrackerOnlyEmails,
  isTrackerOnlyEmail,
  isTrackerAllowedApiPath,
  isTrackerAllowedPath,
  isTrustedRuntimeApiRoute,
} from "./access.ts";

afterEach(() => {
  delete process.env.IPAD_TRACKER_ONLY_EMAILS;
});

describe("evaluatePlannerWriteAccess", () => {
  it("rejects anonymous requests with 401", () => {
    deepStrictEqual(evaluatePlannerWriteAccess(null), {
      allowed: false,
      status: 401,
      error: "Unauthorized",
    });
    deepStrictEqual(evaluatePlannerWriteAccess(undefined), {
      allowed: false,
      status: 401,
      error: "Unauthorized",
    });
    deepStrictEqual(evaluatePlannerWriteAccess({ user: null }), {
      allowed: false,
      status: 401,
      error: "Unauthorized",
    });
  });

  it("rejects tracker-only (shared iPad) sessions with 403", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    deepStrictEqual(
      evaluatePlannerWriteAccess({ user: { email: "assistant@davideberle.com" } }),
      { allowed: false, status: 403, error: "Forbidden" },
    );
  });

  it("allows the canonical authorized session", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    deepStrictEqual(
      evaluatePlannerWriteAccess({ user: { email: "info@davideberle.com" } }),
      { allowed: true },
    );
  });

  it("follows the configured tracker-only list when overridden", () => {
    process.env.IPAD_TRACKER_ONLY_EMAILS = "kiosk@example.com";
    deepStrictEqual(
      evaluatePlannerWriteAccess({ user: { email: "kiosk@example.com" } }),
      { allowed: false, status: 403, error: "Forbidden" },
    );
    // The default tracker account is a normal signed-in user once the
    // override replaces the list.
    deepStrictEqual(
      evaluatePlannerWriteAccess({ user: { email: "assistant@davideberle.com" } }),
      { allowed: true },
    );
  });
});

describe("evaluateHealthAccess", () => {
  // Health data is personal, so this governs the GET as well as the POST — the
  // gymnastics route calls it on both verbs.
  it("rejects anonymous requests with 401", () => {
    for (const session of [null, undefined, { user: null }]) {
      deepStrictEqual(evaluateHealthAccess(session), {
        allowed: false,
        status: 401,
        error: "Unauthorized",
      });
    }
  });

  it("rejects the tracker-only shared iPad account with 403, reads included", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    deepStrictEqual(evaluateHealthAccess({ user: { email: "assistant@davideberle.com" } }), {
      allowed: false,
      status: 403,
      error: "Forbidden",
    });
  });

  it("allows the canonical authorized session", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    deepStrictEqual(evaluateHealthAccess({ user: { email: "info@davideberle.com" } }), {
      allowed: true,
    });
  });

  it("follows the configured tracker-only list when overridden", () => {
    process.env.IPAD_TRACKER_ONLY_EMAILS = "kiosk@example.com";
    deepStrictEqual(evaluateHealthAccess({ user: { email: "kiosk@example.com" } }), {
      allowed: false,
      status: 403,
      error: "Forbidden",
    });
  });

  it("never diverges from the planner-write rule", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    for (const session of [
      null,
      undefined,
      { user: null },
      { user: { email: "assistant@davideberle.com" } },
      { user: { email: "info@davideberle.com" } },
      { user: { email: "someone@else.com" } },
    ]) {
      deepStrictEqual(evaluateHealthAccess(session), evaluatePlannerWriteAccess(session));
    }
  });
});

describe("tracker-only email list", () => {
  it("defaults to the shared-iPad account", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    deepStrictEqual(getTrackerOnlyEmails(), ["assistant@davideberle.com"]);
    equal(isTrackerOnlyEmail("Assistant@DavidEberle.com"), true);
    equal(isTrackerOnlyEmail("info@davideberle.com"), false);
    equal(isTrackerOnlyEmail(null), false);
  });
});

describe("isTrackerAllowedPath", () => {
  it("allows exactly the family board and child-shell surfaces", () => {
    equal(isTrackerAllowedPath("/family/dashboard"), true);
    equal(isTrackerAllowedPath("/family/dashboard/santiago"), true);
    equal(isTrackerAllowedPath("/family/dashboard/isabel"), true);
    equal(isTrackerAllowedPath("/family/assistant"), true);
    equal(isTrackerAllowedPath("/family/listen"), true);
    equal(isTrackerAllowedPath("/family/plan"), true);
    equal(isTrackerAllowedPath("/family/rewards"), true);
  });

  it("allows the Chess Coach pilot launch page and its vendored bundle", () => {
    equal(isTrackerAllowedPath("/family/rewards/chess"), true);
    equal(isTrackerAllowedPath("/games/adaptive-chess-coach/index.html"), true);
    equal(isTrackerAllowedPath("/games/adaptive-chess-coach/chess-engine.js"), true);
    // A different game folder is not implicitly allowed.
    equal(isTrackerAllowedPath("/games/some-other-game/index.html"), false);
  });

  it("keeps adult and unrelated surfaces out of the shared-iPad scope", () => {
    for (const path of [
      "/",
      "/meals",
      "/health",
      "/recipes",
      "/music",
      "/system",
      "/family",
      "/family/tracker",
      "/family/plans",
      "/family/plan/extra",
      "/family/listen/extra",
      "/family/rewards/extra",
      "/family/assistant/extra",
    ]) {
      equal(isTrackerAllowedPath(path), false, path);
    }
  });
});

describe("isTrustedRuntimeApiRoute", () => {
  // Middleware uses this to let a request reach the route guard, which is the
  // only place that can see the bearer token. Membership here does not grant
  // anything on its own.
  it("covers exactly the trusted-runtime mutation surfaces", () => {
    equal(isTrustedRuntimeApiRoute("POST", "/api/cooking/session"), true);
    equal(isTrustedRuntimeApiRoute("POST", "/api/cooking/session/from-plan"), true);
    equal(isTrustedRuntimeApiRoute("PATCH", "/api/cooking/session/abc-123"), true);
    // Weekly planner preparation and chat-driven targeted replacement are
    // scheduled/non-browser calls, so they carry a bearer rather than a cookie.
    equal(isTrustedRuntimeApiRoute("POST", "/api/meals/prepare"), true);
    equal(isTrustedRuntimeApiRoute("POST", "/api/meals/replace"), true);
  });

  it("matches the method case-insensitively and ignores a trailing slash", () => {
    equal(isTrustedRuntimeApiRoute("post", "/api/cooking/session"), true);
    equal(isTrustedRuntimeApiRoute("POST", "/api/cooking/session/"), true);
  });

  it("does not cover a different method on the same path", () => {
    equal(isTrustedRuntimeApiRoute("GET", "/api/cooking/session"), false);
    equal(isTrustedRuntimeApiRoute("DELETE", "/api/cooking/session/abc-123"), false);
    equal(isTrustedRuntimeApiRoute("PATCH", "/api/cooking/session/from-plan"), false);
    equal(isTrustedRuntimeApiRoute("GET", "/api/meals/prepare"), false);
    equal(isTrustedRuntimeApiRoute("GET", "/api/meals/replace"), false);
  });

  it("does not cover any other planner or family surface", () => {
    for (const [method, path] of [
      ["POST", "/api/meals/plan"],
      ["POST", "/api/shopping"],
      ["POST", "/api/cook-events"],
      ["POST", "/api/recipes"],
      ["POST", "/api/recipes/image"],
      ["DELETE", "/api/recipes/image"],
      ["GET", "/api/shopping/outbox"],
      ["POST", "/api/shopping/outbox"],
      ["DELETE", "/api/family/completions"],
      ["PUT", "/api/family/config"],
      ["PATCH", "/api/cooking/session/abc/extra"],
      ["POST", "/api/cooking/sessionx"],
    ] as [string, string][]) {
      equal(isTrustedRuntimeApiRoute(method, path), false, `${method} ${path}`);
    }
  });

  it("does not turn the trusted-runtime routes into tracker-allowed paths", () => {
    // The tracker allowance is unchanged; only the guard can grant these.
    equal(isTrackerAllowedApiPath("/api/cooking/session"), false);
    equal(isTrackerAllowedApiPath("/api/shopping/outbox"), false);
    equal(isTrackerAllowedApiPath("/api/family/completions"), true);
  });
});
