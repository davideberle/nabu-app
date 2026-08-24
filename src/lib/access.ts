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
    pathname === "/family/dashboard" ||
    pathname.startsWith("/family/dashboard/") ||
    pathname === "/family/assistant" ||
    // Child-shell destinations: the shared-iPad shell's Listen, Plan, and Rewards
    // surfaces (the Assistant destination is /family/assistant above).
    pathname === "/family/listen" ||
    pathname === "/family/plan" ||
    pathname === "/family/rewards" ||
    // Rewards game corner: the Adaptive Chess Coach launch page and its
    // vendored static bundle (Game Studio-owned pilot). The bundle is pure
    // client-side game code with no secrets; keeping it behind the household
    // login (rather than excluding it from middleware) is the conservative
    // choice for a child-facing surface.
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

export function isAdminOnlyApiRoute(method: string, pathname: string): boolean {
  return ADMIN_ONLY_API_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.path === pathname,
  );
}
