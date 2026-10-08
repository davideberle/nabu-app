// Unit tests for the session-access rules, in particular the canonical
// planner/domain write decision that `runtime-auth.ts` binds to the Cooking
// Session mutation routes (POST /api/cooking/session, POST …/from-plan,
// PATCH …/:id), and the middleware exemption list for those routes.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  evaluateHealthAccess,
  evaluatePlannerWriteAccess,
  getTrackerOnlyEmails,
  isTrackerOnlyEmail,
  isTrackerAllowedApiPath,
  isTrackerAllowedPath,
  isTrustedRuntimeApiRoute,
  isAdminOnlyApiRoute,
  evaluateParentLearningAccess,
  isSessionCookieHeader,
  splitSetCookieHeader,
  withoutSessionRefresh,
  PARENT_LEARNING_API_INVENTORY,
  PARENT_LEARNING_PAGES,
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
  it("allows the legacy board/plan URLs (which now redirect into Family Home) and the child-shell surfaces", () => {
    equal(isTrackerAllowedPath("/family/dashboard"), true);
    equal(isTrackerAllowedPath("/family/dashboard/santiago"), true);
    equal(isTrackerAllowedPath("/family/dashboard/isabel"), true);
    equal(isTrackerAllowedPath("/family/assistant"), true);
    equal(isTrackerAllowedPath("/family/assistant/record"), true);
    equal(isTrackerAllowedPath("/family/listen"), true);
    equal(isTrackerAllowedPath("/family/plan"), true);
    equal(isTrackerAllowedPath("/family/rewards"), true);
  });

  it("allows the unified Family Home, Activity and the approved-game surfaces (DESIGN §7.5)", () => {
    for (const path of ["/family/home", "/family/activity", "/family/games", "/family/games/play", "/family/games/edit"]) {
      equal(isTrackerAllowedPath(path), true, path);
    }
    equal(isTrackerAllowedPath("/family/games/extra"), false);
    equal(isTrackerAllowedPath("/family/home/extra"), false);
  });

  it("keeps paid-play compensation parent-only while the child's purchase and lease routes stay reachable", () => {
    equal(isAdminOnlyApiRoute("POST", "/api/family/play/purchases/abc/refund"), true);
    equal(isAdminOnlyApiRoute("POST", "/api/family/play/purchases"), false);
    equal(isAdminOnlyApiRoute("POST", "/api/family/play/leases"), false);
    equal(isAdminOnlyApiRoute("GET", "/api/family/play/state"), false);
    equal(isAdminOnlyApiRoute("GET", "/api/family/activity"), false);
  });

  it("allows the legacy chess launch page (a redirect) and the credential-gated bundle route", () => {
    equal(isTrackerAllowedPath("/family/rewards/chess"), true);
    equal(isTrackerAllowedPath("/games/adaptive-chess-coach/index.html"), true);
    // The route itself refuses anything but index.html under a valid lease credential.
    equal(isTrackerAllowedPath("/games/adaptive-chess-coach/chess-engine.js"), true);
    // A different game folder is not implicitly allowed.
    equal(isTrackerAllowedPath("/games/some-other-game/index.html"), false);
  });

  it("keeps the compact parent tools owner-only (October 8, 2026)", () => {
    equal(isTrackerAllowedPath("/family/parent"), false);
    equal(isAdminOnlyApiRoute("GET", "/api/family/parent/records"), true);
    equal(isAdminOnlyApiRoute("GET", "/api/family/parent/anything"), true);
    equal(isAdminOnlyApiRoute("GET", "/api/family/review-queue"), false, "the queue route decides admin itself");
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

describe("isTrustedRuntimeApiRoute — music New plays routes", () => {
  it("lets exactly the runtime's New plays combinations through middleware to the route guard", () => {
    equal(isTrustedRuntimeApiRoute("GET", "/api/music/new-plays"), true);
    equal(isTrustedRuntimeApiRoute("PUT", "/api/music/new-plays"), true);
    equal(isTrustedRuntimeApiRoute("GET", "/api/music/new-plays/actions"), true);
    equal(isTrustedRuntimeApiRoute("POST", "/api/music/new-plays/actions"), true);
    equal(isTrustedRuntimeApiRoute("POST", "/api/music/new-plays/actions/ack"), true);
    equal(isTrustedRuntimeApiRoute("PUT", "/api/music/new-plays/"), true);
  });

  it("keeps every other New plays combination on the ordinary session rules", () => {
    equal(isTrustedRuntimeApiRoute("POST", "/api/music/new-plays"), false);
    equal(isTrustedRuntimeApiRoute("DELETE", "/api/music/new-plays/actions"), false);
    equal(isTrustedRuntimeApiRoute("GET", "/api/music/new-plays/actions/ack"), false);
    equal(isTrustedRuntimeApiRoute("GET", "/api/music/new-plays/extra"), false);
  });
});

describe("parent learning access — settled account rule (2026-09-29)", () => {
  it("grants exactly the owner identity and nothing else", () => {
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "info@davideberle.com" } }), { allowed: true, adminEmail: "info@davideberle.com" });
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "Info@DavidEberle.com" } }), { allowed: true, adminEmail: "info@davideberle.com" });
    deepStrictEqual(evaluateParentLearningAccess(null), { allowed: false, status: 401, error: "Unauthorized" });
    deepStrictEqual(evaluateParentLearningAccess(undefined), { allowed: false, status: 401, error: "Unauthorized" });
    deepStrictEqual(evaluateParentLearningAccess({ user: null }), { allowed: false, status: 401, error: "Unauthorized" });
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "" } }), { allowed: false, status: 401, error: "Unauthorized" });
    // The shared child device account: child views only.
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "assistant@davideberle.com" } }), { allowed: false, status: 403, error: "Forbidden" });
    // Other or forged identities.
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "someone@example.com" } }), { allowed: false, status: 403, error: "Forbidden" });
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "info@davideberle.com.evil.example" } }), { allowed: false, status: 403, error: "Forbidden" });
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "xinfo@davideberle.com" } }), { allowed: false, status: 403, error: "Forbidden" });
  });
  it("an extra tracker-only configuration can never widen parent access", () => {
    process.env.IPAD_TRACKER_ONLY_EMAILS = "info@davideberle.com";
    deepStrictEqual(evaluateParentLearningAccess({ user: { email: "info@davideberle.com" } }), { allowed: false, status: 403, error: "Forbidden" });
  });
  it("no response re-issues the session cookie: middleware and the session endpoint strip exactly the Auth.js session cookie", () => {
    // Plain, secure-prefixed and chunked session cookies are all session writes; nothing else is.
    equal(isSessionCookieHeader("authjs.session-token=abc; Path=/; HttpOnly; SameSite=Lax"), true);
    equal(isSessionCookieHeader("__Secure-authjs.session-token=abc; Path=/; Secure; HttpOnly"), true);
    equal(isSessionCookieHeader("__Host-authjs.session-token.1=abc; Path=/; Secure"), true);
    equal(isSessionCookieHeader("authjs.session-token=; Path=/; Max-Age=0"), true);
    equal(isSessionCookieHeader("authjs.csrf-token=abc; Path=/; HttpOnly"), false);
    equal(isSessionCookieHeader("authjs.callback-url=http%3A%2F%2Fx; Path=/"), false);
    equal(isSessionCookieHeader("family_learning_child=abc"), false);
    // Joined header splitting keeps the comma inside Expires.
    deepStrictEqual(splitSetCookieHeader("a=1; Expires=Thu, 29 Oct 2026 09:34:41 GMT; Path=/, b=2; Path=/"), ["a=1; Expires=Thu, 29 Oct 2026 09:34:41 GMT; Path=/", "b=2; Path=/"]);
    // A middleware response: session refresh removed, CSRF/callback cookies and other headers kept in order.
    const headers = new Headers({ "cache-control": "no-store", "x-middleware-next": "1" });
    headers.append("set-cookie", "authjs.csrf-token=c; Path=/; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "authjs.callback-url=u; Path=/; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "authjs.session-token=eyJ; Path=/; Expires=Thu, 29 Oct 2026 09:34:41 GMT; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "__Secure-authjs.session-token.0=eyJ; Path=/; Secure");
    const stripped = withoutSessionRefresh(headers);
    deepStrictEqual(stripped.getSetCookie(), ["authjs.csrf-token=c; Path=/; HttpOnly; SameSite=Lax", "authjs.callback-url=u; Path=/; HttpOnly; SameSite=Lax"]);
    equal(stripped.get("cache-control"), "no-store");
    equal(stripped.get("x-middleware-next"), "1");
    // Nothing to strip: headers pass through unchanged.
    equal(withoutSessionRefresh(new Headers({ "content-type": "application/json" })).get("set-cookie"), null);
    // The middleware applies it to EVERY response it returns, and the session endpoint to its own reply.
    const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
    equal(middleware.includes("headers: withoutSessionRefresh(response.headers)"), true);
    equal(/suppressesSessionRefresh|pathname\)\) return response/.test(middleware), false);
    // The Auth.js route: BOTH methods of the session action (GET read, POST update) go through the
    // strip; no handler is re-exported untouched. Sign-in callback and sign-out are other actions and pass.
    const authRoute = readFileSync(new URL("../app/api/auth/[...nextauth]/route.ts", import.meta.url), "utf8");
    equal(authRoute.includes("withoutSessionRefresh(response.headers)"), true);
    equal(authRoute.includes("return withoutSessionActionRefresh(handlers.GET, request)"), true);
    equal(authRoute.includes("return withoutSessionActionRefresh(handlers.POST, request)"), true);
    equal(/export const \{[^}]*\} = handlers/.test(authRoute), false);
    const sessionAction = /\/api\/auth\/session\/?$/;
    equal(sessionAction.test("/api/auth/session"), true);
    equal(sessionAction.test("/api/auth/session/"), true);
    equal(sessionAction.test("/api/auth/callback/google"), false);
    equal(sessionAction.test("/api/auth/signout"), false);
    equal(sessionAction.test("/api/auth/csrf"), false);
    equal(sessionAction.test("/api/auth/signin/google"), false);
  });

  it("the parent page and every parent API route decide with the one shared guard (no parallel identity check)", () => {
    // Source-level alignment: the page must not re-implement the rule with
    // isAdminEmail or anything else; it calls evaluateParentLearningAccess and
    // redirects on its decision. Every parent route goes through requireParentOwner.
    const page = readFileSync(new URL("../app/family/learn/parent/page.tsx", import.meta.url), "utf8");
    equal(page.includes("evaluateParentLearningAccess(session)"), true);
    equal(page.includes("isAdminEmail"), false);
    equal(/unlock|reauth|passkey|step-up/i.test(page), false);
    const auth = readFileSync(new URL("./family-learning-auth.ts", import.meta.url), "utf8");
    equal(auth.includes("evaluateParentLearningAccess(session)"), true);
    for (const route of ["evidence", "corrections", "records", "settings"]) {
      const source = readFileSync(new URL(`../app/api/family/learning/parent/${route}/route.ts`, import.meta.url), "utf8");
      equal(source.includes("requireParentOwner()"), true, route);
      equal(source.includes("isAdminEmail"), false, route);
    }
  });

  it("every parent endpoint in the inventory is admin-only for its method, and child endpoints are not", () => {
    for (const entry of PARENT_LEARNING_API_INVENTORY) equal(isAdminOnlyApiRoute(entry.method, entry.path), true, `${entry.method} ${entry.path}`);
    for (const entry of PARENT_LEARNING_API_INVENTORY) equal(isAdminOnlyApiRoute("OPTIONS", entry.path), true);
    equal(isAdminOnlyApiRoute("GET", "/api/family/learning/mission"), false);
    equal(isAdminOnlyApiRoute("PUT", "/api/family/learning/mission"), false);
    equal(isAdminOnlyApiRoute("POST", "/api/family/learning/session"), false);
    for (const page of PARENT_LEARNING_PAGES) equal(isTrackerAllowedPath(page), false, page);
    // Obsolete step-up endpoints no longer exist; their paths would still be admin-only by prefix.
    equal(isAdminOnlyApiRoute("POST", "/api/family/learning/parent/unlock"), true);
  });
});

describe("learning cockpit access (family-assistant DESIGN §7.6)", () => {
  it("lets a tracker-only session reach the child cockpit and mission, never the parent cockpit", () => {
    equal(isTrackerAllowedPath("/family/learn"), true);
    equal(isTrackerAllowedPath("/family/learn/mission"), true);
    equal(isTrackerAllowedPath("/family/learn/parent"), false);
  });
  it("treats every parent learning API route as admin-only for every method", () => {
    equal(isAdminOnlyApiRoute("GET", "/api/family/learning/parent/evidence"), true);
    equal(isAdminOnlyApiRoute("POST", "/api/family/learning/parent/unlock"), true);
    equal(isAdminOnlyApiRoute("DELETE", "/api/family/learning/parent/records"), true);
    equal(isAdminOnlyApiRoute("GET", "/api/family/learning/mission"), false);
    equal(isAdminOnlyApiRoute("POST", "/api/family/learning/session"), false);
  });
});
