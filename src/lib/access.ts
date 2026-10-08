const ADMIN_EMAIL = "info@davideberle.com";
const DEFAULT_TRACKER_ONLY_EMAILS = ["assistant@davideberle.com"];

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getTrackerOnlyEmails(): string[] {
  const configured = parseEmailList(process.env.IPAD_TRACKER_ONLY_EMAILS);
  return configured.length > 0 ? configured : DEFAULT_TRACKER_ONLY_EMAILS;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase() === ADMIN_EMAIL;
}

export function isTrackerOnlyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getTrackerOnlyEmails().includes(email.toLowerCase());
}

export function isTrackerAllowedPath(pathname: string): boolean {
  return (
    // Legacy board/tracker/plan URLs stay allowed so installed shortcuts and old
    // bookmarks on the shared device still resolve — each one now redirects
    // into Family Home (October 8, 2026).
    pathname === "/family/dashboard" ||
    pathname.startsWith("/family/dashboard/") ||
    pathname === "/family/assistant" ||
    // Guided activity capture, reached from the child Home
    // (family-assistant DESIGN.md §2.1 / Family DESIGN.md Phase R7).
    pathname === "/family/assistant/record" ||
    // Child-shell destinations: the shared-iPad shell's Listen, Plan, and Rewards
    // surfaces (the Assistant destination is /family/assistant above).
    pathname === "/family/listen" ||
    pathname === "/family/plan" ||
    pathname === "/family/rewards" ||
    // Unified Family Home (family-assistant DESIGN §7.5, accepted 2026-10-04):
    // the shared chooser/Home, the Activity chronology and the approved-game
    // library with its guarded play and scoped edit surfaces.
    pathname === "/family/home" ||
    pathname === "/family/activity" ||
    pathname === "/family/games" ||
    pathname === "/family/games/play" ||
    pathname === "/family/games/edit" ||
    // Learning cockpit and mission workspace (family-assistant DESIGN §7.6).
    // The parent evidence cockpit (/family/learn/parent) is deliberately NOT
    // here: a tracker-only (shared child device) session is redirected away.
    pathname === "/family/learn" ||
    pathname === "/family/learn/mission" ||
    // Chess: the legacy launch page (now a redirect into guarded play) and the
    // gated bundle route. The route itself demands a valid lease credential;
    // the household login is only the outer layer.
    pathname === "/family/rewards/chess" ||
    pathname.startsWith("/games/adaptive-chess-coach/")
  );
}

export function isTrackerAllowedApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/family/")
  );
}

/** Structural subset of the NextAuth session the access rules need. */
export type PlannerWriteSession = { user?: { email?: string | null } | null } | null | undefined;

export type PlannerWriteAccess =
  | { allowed: true }
  | { allowed: false; status: 401 | 403; error: "Unauthorized" | "Forbidden" };

/**
 * Canonical decision for planner/domain API mutations (meal plans, cook
 * events, My Recipes, inspiration imports): a signed-in session is required,
 * and tracker-only (shared iPad) accounts stay read-only family surfaces —
 * they never write planner state.
 */
export function evaluatePlannerWriteAccess(session: PlannerWriteSession): PlannerWriteAccess {
  if (!session?.user) {
    return { allowed: false, status: 401, error: "Unauthorized" };
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return { allowed: false, status: 403, error: "Forbidden" };
  }
  return { allowed: true };
}

/**
 * Canonical decision for the health-domain API (gymnastics progress and the
 * completed-block history it reads back).
 *
 * The rule is the same as a planner write, but it is stated separately because
 * it also governs *reads*: health data is personal, so a tracker-only shared
 * iPad account is refused a GET too, not just a mutation. Both the route and
 * its contract test bind to this function, so the boundary has one definition.
 */
export function evaluateHealthAccess(session: PlannerWriteSession): PlannerWriteAccess {
  return evaluatePlannerWriteAccess(session);
}

/**
 * API method/path combinations a trusted local runtime may perform with a
 * bearer token instead of a browser session (kitchen DESIGN.md §"Phase 4C").
 *
 * This list exists because the policy has two enforcement points. The route
 * guard (`lib/api-guards.ts`) decides "authorized session OR valid runtime
 * token", but middleware runs first and used to 403 a tracker-only cookie
 * before any bearer could be examined — so a Telegram runtime that happened to
 * be on the shared-iPad account was refused despite carrying a valid token,
 * contradicting the shared policy. Middleware now lets exactly these
 * combinations through to the guard, which is the single place that decides.
 *
 * Nothing is weakened: the guard still returns 403 for a tracker-only session
 * without a valid bearer, and every other tracker-restricted path keeps its
 * middleware refusal.
 *
 * Kept in this module, not in `runtime-auth.ts`, because middleware runs on the
 * Edge runtime and must not pull in `node:crypto`. Pure string matching only.
 */
const TRUSTED_RUNTIME_API_ROUTES: { methods: readonly string[]; pattern: RegExp }[] = [
  { methods: ["POST"], pattern: /^\/api\/cooking\/session$/ },
  { methods: ["POST"], pattern: /^\/api\/cooking\/session\/from-plan$/ },
  // PATCH /api/cooking/session/:id — one path segment, and never `from-plan`,
  // which is a POST-only creation route.
  { methods: ["PATCH"], pattern: /^\/api\/cooking\/session\/(?!from-plan$)[^/]+$/ },
  // Weekly planner preparation: the Thursday 05:30 run, the Friday 06:00
  // watchdog, and week rollover. These are scheduled non-browser calls, so
  // they authenticate with the runtime token rather than a session cookie.
  { methods: ["POST"], pattern: /^\/api\/meals\/prepare$/ },
  // Chat-driven targeted replacement of unassigned recommendations.
  { methods: ["POST"], pattern: /^\/api\/meals\/replace$/ },
  // Music "New plays" mirror + action outbox. `projects/sonos-music`
  // (`new-plays-sync.js`) pushes the read-only projection with PUT, pulls the
  // queued typed actions with GET, and reports outcomes to /ack. The browser
  // session uses GET (list) and POST (enqueue) on the same routes; the route
  // guard (`lib/music-new-plays-auth.ts`) restricts PUT / pending GET / ack to
  // the trusted runtime.
  { methods: ["GET", "PUT"], pattern: /^\/api\/music\/new-plays$/ },
  { methods: ["GET", "POST"], pattern: /^\/api\/music\/new-plays\/actions$/ },
  { methods: ["POST"], pattern: /^\/api\/music\/new-plays\/actions\/ack$/ },
];

export function isTrustedRuntimeApiRoute(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();
  // A trailing slash addresses the same handler, so it must not change the
  // decision in either direction.
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.replace(/\/+$/, "") : pathname;
  return TRUSTED_RUNTIME_API_ROUTES.some(
    (route) => route.methods.includes(normalizedMethod) && route.pattern.test(normalizedPath),
  );
}

const ADMIN_ONLY_API_ROUTES: { method: string; path: string }[] = [
  { method: "PUT", path: "/api/family/config" },
  { method: "DELETE", path: "/api/family/completions" },
  { method: "DELETE", path: "/api/family/redemptions" },
];

/**
 * Whole API prefixes only the owner session may reach, for every method. The
 * learning parent routes are decided by `evaluateParentLearningAccess` inside
 * each handler (`lib/family-learning-auth.ts`); middleware additionally keeps
 * tracker-only sessions out before the handler runs.
 */
const ADMIN_ONLY_API_PREFIXES = [
  "/api/family/learning/parent/",
  // Compact parent tools (October 8, 2026): cross-week records for the owner only.
  "/api/family/parent/",
  // Parent-only compensation for paid play (`…/purchases/:id/refund`); the
  // child's own `POST /api/family/play/purchases` has no trailing segment and
  // therefore stays outside this prefix.
  "/api/family/play/purchases/",
];

/**
 * Exact inventory of parent learning endpoints (method + path). Tests assert
 * that every entry is admin-only in middleware terms and that no other
 * learning endpoint is; adding a parent endpoint means adding it here.
 */
export const PARENT_LEARNING_API_INVENTORY: readonly { method: string; path: string }[] = [
  { method: "GET", path: "/api/family/learning/parent/evidence" },
  { method: "POST", path: "/api/family/learning/parent/corrections" },
  { method: "DELETE", path: "/api/family/learning/parent/records" },
  { method: "GET", path: "/api/family/learning/parent/settings" },
  { method: "PUT", path: "/api/family/learning/parent/settings" },
];

/** Parent learning page(s); never in the tracker allow-list. */
export const PARENT_LEARNING_PAGES: readonly string[] = ["/family/learn/parent"];
/** The compact parent tools page (October 8, 2026); owner session only, never in the tracker allow-list. */
export const PARENT_TOOLS_PAGE = "/family/parent";

export type ParentLearningAccess =
  | { allowed: true; adminEmail: string }
  | { allowed: false; status: 401 | 403; error: "Unauthorized" | "Forbidden" };

/**
 * The one decision for every parent learning page and API, read or write
 * (account rule settled 2026-09-29): the session must carry exactly the owner
 * email. The assistant (shared child device) account, any other account,
 * anonymous callers and anything that is not a NextAuth session are refused.
 * Nothing but the server-side session is consulted — no cookie, header,
 * bearer, unlock or challenge exists any more.
 */
export function evaluateParentLearningAccess(session: PlannerWriteSession): ParentLearningAccess {
  const email = session?.user?.email;
  if (!session?.user || typeof email !== "string" || !email.trim()) {
    return { allowed: false, status: 401, error: "Unauthorized" };
  }
  if (isTrackerOnlyEmail(email) || !isAdminEmail(email)) {
    return { allowed: false, status: 403, error: "Forbidden" };
  }
  return { allowed: true, adminEmail: email.trim().toLowerCase() };
}

/**
 * Session-cookie refresh suppression (independent privacy reviews, 2026-09-29).
 *
 * The NextAuth middleware wrapper re-signs the JWT session and appends it as
 * `Set-Cookie` to EVERY response it handles (pages, RSC, all APIs — sliding
 * expiry); the Auth.js `/api/auth/session` handler does the same. Any response
 * computed under the owner session but delivered after a sign-out or account
 * switch therefore re-installs the owner cookie and resurrects the session,
 * whichever route it came from. The app removes exactly those re-issued
 * session cookies from every middleware response and from the session
 * endpoint; the real writers — sign-in callback and sign-out — are route
 * handlers/server actions whose cookies are merged separately and stay intact.
 *
 * Trade-off: sessions no longer slide. A sign-in lasts exactly Auth.js's
 * `session.maxAge` (default 30 days) from the moment of sign-in, after which
 * the middleware redirects to login and Google sign-in is required again. No
 * server-side state, no product decision, no change to who may sign in.
 */
const SESSION_COOKIE_HEADER = /^\s*(?:__Secure-|__Host-)?authjs\.session-token(?:\.\d+)?=/i;

/** True for a Set-Cookie header value that (re)writes the Auth.js session cookie or one of its chunks. */
export function isSessionCookieHeader(value: string): boolean {
  return SESSION_COOKIE_HEADER.test(value);
}

/** Split a joined Set-Cookie header on commas that start a new cookie (not the comma inside `Expires`). */
export function splitSetCookieHeader(joined: string): string[] {
  return joined.split(/,(?=\s*[^;,\s=]+=)/).map((part) => part.trim()).filter(Boolean);
}

/**
 * Copy of `headers` without any Auth.js session-cookie write. Every other
 * header — including the CSRF and callback-URL cookies Auth.js sets alongside —
 * is preserved in order.
 */
export function withoutSessionRefresh(headers: Headers): Headers {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(headers) : splitSetCookieHeader(headers.get("set-cookie") ?? "");
  const kept = cookies.filter((value) => !isSessionCookieHeader(value));
  const next = new Headers(headers);
  next.delete("set-cookie");
  for (const value of kept) next.append("set-cookie", value);
  return next;
}

export function isAdminOnlyApiRoute(method: string, pathname: string): boolean {
  if (ADMIN_ONLY_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return ADMIN_ONLY_API_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.path === pathname,
  );
}
