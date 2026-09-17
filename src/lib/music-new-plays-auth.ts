// Route-level authorization for the music "New plays" surface.
//
// Two audiences use the same three routes, with DIFFERENT rights:
//
//   browser session (David)        list New plays, enqueue a typed action
//   trusted home runtime           mirror push (PUT), pending-outbox read
//   (`new-plays-sync.js`, bearer)  (GET ?status=pending), acknowledgement
//
// A signed-in browser must NEVER be able to overwrite the mirror, drain the
// outbox, or forge an acknowledgement: those three change what the app shows
// as domain truth and are the runtime's alone. The decision is stated here,
// once, as pure data + one function, so every route binds to the same rule
// and the rule can be tested without NextAuth.
//
// Explicit .ts extension: loaded directly by `node --test`.
import {
  evaluateRuntimeWriteAccess,
  type RuntimeWriteAccess,
} from "./runtime-auth.ts";
import type { PlannerWriteSession } from "./access.ts";

export type NewPlaysRouteOperation =
  | "list" // GET  /api/music/new-plays
  | "mirror-put" // PUT  /api/music/new-plays
  | "enqueue" // POST /api/music/new-plays/actions
  | "outbox-get" // GET  /api/music/new-plays/actions
  | "ack"; // POST /api/music/new-plays/actions/ack

/** Operations only the trusted runtime may perform; everything else is session-or-runtime. */
export const RUNTIME_ONLY_OPERATIONS: ReadonlySet<NewPlaysRouteOperation> = new Set<NewPlaysRouteOperation>([
  "mirror-put",
  "outbox-get",
  "ack",
]);

export type NewPlaysRouteAccess =
  | { allowed: true; via: "session" | "trusted-runtime" }
  | { allowed: false; status: 401 | 403; error: "Unauthorized" | "Forbidden" };

/**
 * Decide one New plays operation.
 *
 * - runtime-only operations require `via === "trusted-runtime"`; an ordinary
 *   signed-in browser session is refused with 403, anonymous with 401;
 * - `list` and `enqueue` keep the shared session-or-runtime rule.
 */
export function evaluateNewPlaysRouteAccess(
  operation: NewPlaysRouteOperation,
  session: PlannerWriteSession,
  authorizationHeader: string | null | undefined,
  options: { token?: string | null; env?: Record<string, string | undefined> } = {},
): NewPlaysRouteAccess {
  const access: RuntimeWriteAccess = evaluateRuntimeWriteAccess(session, authorizationHeader, options);
  if (!access.allowed) return access;
  if (RUNTIME_ONLY_OPERATIONS.has(operation) && access.via !== "trusted-runtime") {
    return { allowed: false, status: 403, error: "Forbidden" };
  }
  return access;
}
