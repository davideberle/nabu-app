// ---------------------------------------------------------------------------
// Browser transport for the learning cockpit.
//
// Mirrors `family-assistant-client.ts`: mint a short-lived child credential
// from the app, cache it until close to expiry, send every learning call with
// it, and drop everything on `reset()` (child switch). Every mutation carries
// an idempotency key and the revision the client last rendered, so a double
// tap, a retried request or a stale tab is settled by the server, never by
// this file. Isomorphic and dependency-free so `node --test` covers it.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import type { ChildView, LearningOp } from "./family-learning-state.ts";
import { isChildView } from "./family-learning-view-guard.ts";

export const LEARNING_SESSION_PATH = "/api/family/learning/session";
export const LEARNING_MISSION_PATH = "/api/family/learning/mission";
export const LEARNING_REFRESH_MARGIN_MS = 60_000;

export type LearningSessionInfo = { child: ChildId; token: string; expiresAt: number };

/**
 * "unprepared" is the server's explicit answer that no mission exists for this
 * child (`{ view: null, prepared: false }`); "bad-response" is a malformed or
 * mismatched payload and is never evidence of absence.
 */
export type LearningFailure = "no-session" | "network" | "bad-response" | "unauthorized" | "unavailable" | "unprepared";
// Every adopted view — read or write response, applied/replayed/stale/refused —
// must satisfy the full runtime ChildView contract (family-learning-view-guard);
// a record that merely names the right child is rejected as bad-response.

export type LearningReadOutcome = { ok: true; view: ChildView } | { ok: false; failure: LearningFailure; status?: number };

export type LearningMutateOutcome =
  | { ok: true; status: "applied" | "replayed"; view: ChildView; result: Record<string, unknown> }
  | { ok: true; status: "stale"; view: ChildView }
  | { ok: false; status: "refused"; code: string; message: string; view: ChildView }
  | { ok: false; failure: LearningFailure; status?: number };

export type LearningClientDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  newIdempotencyKey?: () => string;
};

export type LearningClient = {
  read: (childId: ChildId, options?: { signal?: AbortSignal }) => Promise<LearningReadOutcome>;
  mutate: (childId: ChildId, op: LearningOp, expectedRevision: number, options?: { signal?: AbortSignal; idempotencyKey?: string }) => Promise<LearningMutateOutcome>;
  reset: () => void;
  peekSession: () => LearningSessionInfo | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readLearningSession(value: unknown): LearningSessionInfo | null {
  if (!isRecord(value)) return null;
  const { child, token, expiresAt } = value;
  if (child !== "santiago" && child !== "isabel") return null;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { child, token, expiresAt };
}

export function createLearningClient(deps: LearningClientDeps = {}): LearningClient {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  const newKey =
    deps.newIdempotencyKey ??
    (() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${now()}-${Math.random().toString(36).slice(2, 10)}`));

  let cached: LearningSessionInfo | null = null;

  async function session(childId: ChildId, signal: AbortSignal | undefined): Promise<LearningSessionInfo | null> {
    if (cached && cached.child === childId && cached.expiresAt - now() > LEARNING_REFRESH_MARGIN_MS) return cached;
    cached = null;
    let response: Response;
    try {
      response = await doFetch(LEARNING_SESSION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId }),
        signal,
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return null;
    }
    const info = readLearningSession(payload);
    if (!info || info.child !== childId) return null;
    cached = info;
    return info;
  }

  function failureFor(status: number): LearningFailure {
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 503) return "unavailable";
    return "bad-response";
  }

  return {
    async read(childId, options) {
      const info = await session(childId, options?.signal);
      if (!info) return { ok: false, failure: "no-session" };
      let response: Response;
      try {
        response = await doFetch(LEARNING_MISSION_PATH, { headers: { Authorization: `Bearer ${info.token}` }, signal: options?.signal });
      } catch {
        return { ok: false, failure: "network" };
      }
      if (!response.ok) {
        if (response.status === 401) cached = null;
        return { ok: false, failure: failureFor(response.status), status: response.status };
      }
      try {
        const payload: unknown = await response.json();
        if (!isRecord(payload)) return { ok: false, failure: "bad-response", status: response.status };
        if (payload.prepared === false && payload.view === null && payload.child === childId) return { ok: false, failure: "unprepared", status: response.status };
        if (!isChildView(payload.view, childId)) return { ok: false, failure: "bad-response", status: response.status };
        return { ok: true, view: payload.view };
      } catch {
        return { ok: false, failure: "bad-response", status: response.status };
      }
    },

    async mutate(childId, op, expectedRevision, options) {
      const info = await session(childId, options?.signal);
      if (!info) return { ok: false, failure: "no-session" };
      const idempotencyKey = options?.idempotencyKey ?? newKey();
      let response: Response;
      try {
        response = await doFetch(LEARNING_MISSION_PATH, {
          method: "PUT",
          headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ op, expectedRevision, idempotencyKey }),
          signal: options?.signal,
        });
      } catch {
        return { ok: false, failure: "network" };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, failure: failureFor(response.status), status: response.status };
      }
      if (!isRecord(payload) || !isChildView(payload.view, childId)) {
        if (response.status === 401) cached = null;
        return { ok: false, failure: failureFor(response.status), status: response.status };
      }
      const view: ChildView = payload.view;
      if (response.status === 200 && (payload.status === "applied" || payload.status === "replayed")) {
        return { ok: true, status: payload.status, view, result: isRecord(payload.result) ? payload.result : {} };
      }
      if (response.status === 409) return { ok: true, status: "stale", view };
      if (response.status === 422 && typeof payload.code === "string") {
        return { ok: false, status: "refused", code: payload.code, message: typeof payload.message === "string" ? payload.message : "", view };
      }
      return { ok: false, failure: failureFor(response.status), status: response.status };
    },

    reset() {
      cached = null;
    },

    peekSession() {
      return cached;
    },
  };
}
