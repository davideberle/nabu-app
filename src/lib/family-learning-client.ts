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

import { readBridgeOrigin, type ChildId } from "./family-assistant-turn.ts";
import type { ChildView, LearningOp } from "./family-learning-state.ts";
import { isChildView } from "./family-learning-view-guard.ts";

export const LEARNING_SESSION_PATH = "/api/family/learning/session";
export const LEARNING_MISSION_PATH = "/api/family/learning/mission";
export const LEARNING_TELEMETRY_PATH = "/api/family/learning/telemetry";
export const LEARNING_NOKT_TRANSCRIBE_PATH = "/api/family/learning/nokt/transcribe";
export const LEARNING_NOKT_DISPATCH_PATH = "/api/family/learning/nokt/turn/dispatch";
export const LEARNING_NOKT_REPLY_PATH = "/api/family/learning/nokt/turn/reply";
/** The family runtime's Nokt route (bridge origin + this path), reached by the BROWSER — the hosted app cannot reach it. */
export const BRIDGE_NOKT_PATH = "/v1/nokt/turn";

/** One Nokt turn as the panel sends it; the server builds everything else (context, request, binding). */
export type NoktTurnInput = { step: string; part: string; purpose: "diagnostic" | "reflection"; entry: "manual" | "offer" | "planned"; sessionId: string; turnId: string; text: string; via: "voice" | "typed" };
export const LEARNING_REFRESH_MARGIN_MS = 60_000;

export type LearningSessionInfo = { child: ChildId; token: string; expiresAt: number };

/**
 * "unprepared" is the server's explicit answer that no mission exists for this
 * child (`{ view: null, prepared: false }`); "bad-response" is a malformed or
 * mismatched payload and is never evidence of absence.
 */
/** R5-1: the identity the request was rendered against (erasure generation + running visit instance); the server refuses a mismatch as stale. */
export type MutationContext = { erasureGeneration: number; visit: { id: string; startedAt: string } | null };

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

/** One Nokt push-to-talk turn: the transcript the child then sees and may correct, or why there is none. */
export type NoktTranscribeOutcome = { ok: true; transcript: string } | { ok: false; failure: LearningFailure | "cancelled" | "empty"; status?: number };

export type LearningClientDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  newIdempotencyKey?: () => string;
};

export type LearningClient = {
  /** `timeZone` (IANA, from the browser) scopes the progress strip's Monday–Sunday week; the server validates it. */
  read: (childId: ChildId, options?: { signal?: AbortSignal; timeZone?: string | null }) => Promise<LearningReadOutcome>;
  mutate: (childId: ChildId, op: LearningOp, expectedRevision: number, options?: { signal?: AbortSignal; idempotencyKey?: string; context?: MutationContext; timeZone?: string | null }) => Promise<LearningMutateOutcome>;
  /** Send one bounded telemetry batch (idempotent by batch id); failures are silent by design. */
  sendTelemetry: (childId: ChildId, batch: { batchId: string; visitId: string; visitStartedAt: string; erasureGeneration: number; events: unknown[] }, options?: { signal?: AbortSignal; keepalive?: boolean }) => Promise<boolean>;
  /** One Nokt turn (dispatch → backend → verified reply); the outcome carries the adopted view like `mutate`. Aborting cancels it. */
  noktTurn: (childId: ChildId, turn: NoktTurnInput, expectedRevision: number, options: { signal: AbortSignal; context: MutationContext; timeZone?: string | null }) => Promise<LearningMutateOutcome | { ok: false; failure: "cancelled" }>;
  /** Upload one recorded turn for Nokt; aborting `signal` cancels the upload and the server's provider call. */
  transcribeNokt: (childId: ChildId, audio: Blob, fileName: string, options: { signal: AbortSignal }) => Promise<NoktTranscribeOutcome>;
  reset: () => void;
  peekSession: () => LearningSessionInfo | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The browser's IANA zone, or null when unavailable (the server then uses the household default). */
export function browserTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 && tz.length <= 64 ? tz : null;
  } catch {
    return null;
  }
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

  /** The one reading of a mutation response (mission PUT and the Nokt turn): applied/replayed/stale/refused, or a failure. */
  async function readMutation(response: Response, childId: ChildId): Promise<LearningMutateOutcome> {
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
  }

  return {
    async read(childId, options) {
      const info = await session(childId, options?.signal);
      if (!info) return { ok: false, failure: "no-session" };
      let response: Response;
      const tz = options?.timeZone ?? null;
      try {
        response = await doFetch(tz ? `${LEARNING_MISSION_PATH}?tz=${encodeURIComponent(tz)}` : LEARNING_MISSION_PATH, { headers: { Authorization: `Bearer ${info.token}` }, signal: options?.signal });
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
          body: JSON.stringify({ op, expectedRevision, idempotencyKey, context: options?.context ?? null, ...(options?.timeZone ? { tz: options.timeZone } : {}) }),
          signal: options?.signal,
        });
      } catch {
        return { ok: false, failure: "network" };
      }
      return readMutation(response, childId);
    },

    async noktTurn(childId, turn, expectedRevision, options) {
      // 1. Dispatch: the server records his line and returns the request it built (never the answer key) + a `learn` token.
      const info = await session(childId, options.signal);
      if (options.signal.aborted) return { ok: false, failure: "cancelled" };
      if (!info) return { ok: false, failure: "no-session" };
      const post = async (path: string, body: Record<string, unknown>, revision: number): Promise<LearningMutateOutcome | { ok: false; failure: "cancelled" }> => {
        let response: Response;
        try {
          response = await doFetch(path, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, expectedRevision: revision, context: options.context, ...(options.timeZone ? { tz: options.timeZone } : {}) }), signal: options.signal, cache: "no-store" });
        } catch {
          return { ok: false, failure: options.signal.aborted ? "cancelled" : "network" };
        }
        return readMutation(response, childId);
      };
      const dispatched = await post(LEARNING_NOKT_DISPATCH_PATH, { ...turn }, expectedRevision);
      if (!dispatched.ok || dispatched.status !== "applied") return dispatched;
      const r = dispatched.result as { turnId?: unknown; request?: unknown; bridge?: { url?: unknown; token?: unknown } };
      const origin = readBridgeOrigin(r.bridge?.url);
      // 2. The browser (on the Mac mini) asks the family runtime; bearer only, no cookies, nothing else is sent.
      let reply: string | null = null;
      let receipt: string | null = null;
      let noReply: "attempts_exhausted" | null = null;
      if (origin && typeof r.bridge?.token === "string" && r.request && r.turnId === turn.turnId) {
        try {
          const res = await doFetch(`${origin}${BRIDGE_NOKT_PATH}`, { method: "POST", headers: { Authorization: `Bearer ${r.bridge.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ turnId: turn.turnId, request: r.request }), signal: options.signal, cache: "no-store", credentials: "omit", mode: "cors" });
          if (res.ok) {
            const body = (await res.json()) as { reply?: unknown; receipt?: unknown };
            if (typeof body.reply === "string") reply = body.reply;
            if (typeof body.receipt === "string") receipt = body.receipt;
          } else if (res.status === 429) {
            // The runtime's daily allowance is used up: say so (the child sees a kind line, the parent the reason).
            const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
            if (body?.code === "attempts_exhausted") noReply = "attempts_exhausted";
          }
        } catch {
          if (options.signal.aborted) return { ok: false, failure: "cancelled" };
        }
      }
      // Cancelled (closed, navigated, task changed) after dispatch: nothing more is sent; his line stays without a reply.
      if (options.signal.aborted) return { ok: false, failure: "cancelled" };
      // 3. The reply EXACTLY as received (or none); the server checks the receipt and the engine binds and guards it.
      return post(LEARNING_NOKT_REPLY_PATH, { step: turn.step, turnId: turn.turnId, reply: reply ?? null, receipt: reply === null ? null : receipt, ...(reply === null && noReply ? { noReply } : {}) }, dispatched.view.revision);
    },

    async sendTelemetry(childId, batch, options) {
      const info = await session(childId, options?.signal);
      if (!info) return false;
      try {
        const response = await doFetch(LEARNING_TELEMETRY_PATH, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify(batch), signal: options?.signal, keepalive: options?.keepalive });
        return response.ok;
      } catch {
        return false;
      }
    },

    async transcribeNokt(childId, audio, fileName, options) {
      const info = await session(childId, options.signal);
      if (options.signal.aborted) return { ok: false, failure: "cancelled" };
      if (!info) return { ok: false, failure: "no-session" };
      const form = new FormData();
      form.append("audio", audio, fileName);
      let response: Response;
      try {
        response = await doFetch(LEARNING_NOKT_TRANSCRIBE_PATH, { method: "POST", headers: { Authorization: `Bearer ${info.token}` }, body: form, signal: options.signal, cache: "no-store" });
      } catch {
        return { ok: false, failure: options.signal.aborted ? "cancelled" : "network" };
      }
      if (!response.ok) {
        if (response.status === 401) cached = null;
        return { ok: false, failure: failureFor(response.status), status: response.status };
      }
      try {
        const payload: unknown = await response.json();
        if (!isRecord(payload) || typeof payload.transcript !== "string") return { ok: false, failure: "bad-response", status: response.status };
        const transcript = payload.transcript.trim();
        return transcript ? { ok: true, transcript } : { ok: false, failure: "empty" };
      } catch {
        return { ok: false, failure: options.signal.aborted ? "cancelled" : "bad-response", status: response.status };
      }
    },

    reset() {
      cached = null;
    },

    peekSession() {
      return cached;
    },
  };
}
