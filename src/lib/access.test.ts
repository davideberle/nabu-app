// Unit tests for the session-access rules, in particular the canonical
// planner/domain write decision that `runtime-auth.ts` binds to the Cooking
// Session mutation routes (POST /api/cooking/session, POST …/from-plan,
// PATCH …/:id), and the middleware exemption list for those routes.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  evaluatePlannerWriteAccess,
  getTrackerOnlyEmails,
  isTrackerOnlyEmail,
  isTrackerAllowedApiPath,
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

describe("tracker-only email list", () => {
  it("defaults to the shared-iPad account", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    deepStrictEqual(getTrackerOnlyEmails(), ["assistant@davideberle.com"]);
    equal(isTrackerOnlyEmail("Assistant@DavidEberle.com"), true);
    equal(isTrackerOnlyEmail("info@davideberle.com"), false);
    equal(isTrackerOnlyEmail(null), false);
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
  });

  it("matches the method case-insensitively and ignores a trailing slash", () => {
    equal(isTrustedRuntimeApiRoute("post", "/api/cooking/session"), true);
    equal(isTrustedRuntimeApiRoute("POST", "/api/cooking/session/"), true);
  });

  it("does not cover a different method on the same path", () => {
    equal(isTrustedRuntimeApiRoute("GET", "/api/cooking/session"), false);
    equal(isTrustedRuntimeApiRoute("DELETE", "/api/cooking/session/abc-123"), false);
    equal(isTrustedRuntimeApiRoute("PATCH", "/api/cooking/session/from-plan"), false);
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
