// Browser-side transport for one child turn.
//
// Isomorphic and dependency-free on purpose: it is imported by a client
// component, so it must not pull in `node:crypto` (that lives in the
// server-only `family-assistant-bridge.ts`) and must not import React.
//
// ## The two hops, and why the browser makes both
//
//   1. `POST /api/family/assistant/session` on the Companion App origin, which
//      checks the household session and returns a minutes-long token naming one
//      child plus the bridge's tailnet origin;
//   2. `POST <bridgeUrl>/v1/child-turn` on the Mac mini, carrying that token.
//
// The second hop does not go through Vercel because the Gateway is loopback
// bound on the Mac mini and its operator bearer must never leave that machine.
// Proxying the turn through the Companion App server would mean either putting
// that bearer in Vercel or putting the Mac mini on the public internet; the
// canonical design (DESIGN §7) chooses neither and keeps the browser on the
// tailnet instead.
//
// ## What this module guarantees
//
// - the child is chosen once, when the token is minted, and is never a field in
//   a turn request. The bridge takes it from the token subject, so a tampered
//   request body cannot re-aim a turn at the sibling;
// - the session token is refreshed before it expires and re-minted exactly once
//   on a 401, so a child never sees an auth error for an ordinary expiry;
// - every request is abortable, so leaving the page or tapping stop does not
//   leave a turn running.

import {
  MAX_CHILD_TURN_CHARS,
  parseChildTurnEnvelope,
  readBridgeOrigin,
  type ChildId,
  type ChildTurnEnvelope,
  // Explicit .ts extension: this module is also loaded directly by
  // `node --test`, whose ESM resolver does not add extensions.
} from "./family-assistant-turn.ts";

/** What `/api/family/assistant/session` returns. No secret, no Gateway URL. */
export type ChildBridgeSessionInfo = {
  child: ChildId;
  sessionSuffix: string;
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  bridgeUrl: string;
};

/** Path of the bridge's one turn endpoint. */
export const BRIDGE_TURN_PATH = "/v1/child-turn";

/** Re-mint this long before expiry, so a turn never starts on a dying token. */
export const SESSION_REFRESH_MARGIN_MS = 60_000;

/** Route that mints a child session. */
export const SESSION_MINT_PATH = "/api/family/assistant/session";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the mint response before anything is stored or sent anywhere.
 *
 * The scheme check is deliberately repeated here even though the server already
 * enforces it at mint time: this is the last point before the browser puts a
 * live bearer token on a socket, and it is the half of the pair an attacker who
 * could answer the mint call would have to get past.
 */
export function readSessionInfo(value: unknown): ChildBridgeSessionInfo | null {
  if (!isRecord(value)) return null;
  const { child, sessionSuffix, token, expiresAt, bridgeUrl } = value;
  if (child !== "santiago" && child !== "isabel") return null;
  if (typeof sessionSuffix !== "string" || !sessionSuffix) return null;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  // `https:` for every non-loopback host; plaintext only to this machine.
  const origin = readBridgeOrigin(bridgeUrl);
  if (!origin) return null;
  return { child, sessionSuffix, token, expiresAt, bridgeUrl: origin };
}

/** Reason a turn could not even be attempted. Mapped to a child-facing line. */
export type ChildTurnTransportFailure = "no-session" | "network" | "bad-response";

export type ChildTurnOutcome =
  | { ok: true; envelope: ChildTurnEnvelope }
  | { ok: false; failure: ChildTurnTransportFailure; envelope: ChildTurnEnvelope };

function transportEnvelope(child: string, code: string, message: string): ChildTurnEnvelope {
  return {
    v: 1,
    status: "error",
    child,
    blocks: [],
    meta: { requestId: "client" },
    error: { code, message, retryable: true },
  };
}

export type ChildTurnClientDeps = {
  /** Injected so the tests never touch the network. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Injected so idempotency keys are deterministic in tests. */
  newIdempotencyKey?: () => string;
};

export type ChildTurnClient = {
  /** Sends one free-form utterance to the selected child agent. */
  ask: (
    params: { childId: ChildId; sessionSuffix: string; message: string },
    options?: { signal?: AbortSignal },
  ) => Promise<ChildTurnOutcome>;
  /** Drops the cached session, e.g. when the child profile changes. */
  reset: () => void;
  /** Current cached session, for tests and diagnostics. */
  peekSession: () => ChildBridgeSessionInfo | null;
};

export function createChildTurnClient(deps: ChildTurnClientDeps = {}): ChildTurnClient {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  const newKey =
    deps.newIdempotencyKey ??
    (() =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `k-${now()}-${Math.random().toString(36).slice(2, 10)}`);

  let cached: ChildBridgeSessionInfo | null = null;

  async function mint(
    childId: ChildId,
    sessionSuffix: string,
    signal: AbortSignal | undefined,
  ): Promise<ChildBridgeSessionInfo | null> {
    const response = await doFetch(SESSION_MINT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childId, sessionSuffix }),
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return null;
    const info = readSessionInfo(await response.json());
    // A mint that answers about a different child is a server bug, not
    // something to work around: refuse it rather than talk to the sibling.
    if (!info || info.child !== childId || info.sessionSuffix !== sessionSuffix) return null;
    cached = info;
    return info;
  }

  async function session(
    childId: ChildId,
    sessionSuffix: string,
    signal: AbortSignal | undefined,
    force: boolean,
  ): Promise<ChildBridgeSessionInfo | null> {
    const usable =
      !force &&
      cached !== null &&
      cached.child === childId &&
      cached.sessionSuffix === sessionSuffix &&
      cached.expiresAt - now() > SESSION_REFRESH_MARGIN_MS;
    if (usable && cached) return cached;
    return await mint(childId, sessionSuffix, signal);
  }

  async function postTurn(
    info: ChildBridgeSessionInfo,
    message: string,
    idempotencyKey: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    return await doFetch(`${info.bridgeUrl}${BRIDGE_TURN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${info.token}`,
      },
      // The body is exactly what the bridge accepts. Notably absent: childId,
      // sessionSuffix, model, tools — all of which come from the token or the
      // bridge's own configuration.
      body: JSON.stringify({ message, idempotencyKey }),
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  }

  return {
    reset() {
      cached = null;
    },
    peekSession: () => cached,
    async ask({ childId, sessionSuffix, message }, options = {}) {
      const trimmed = message.trim().slice(0, MAX_CHILD_TURN_CHARS);
      if (!trimmed) {
        return {
          ok: false,
          failure: "bad-response",
          envelope: transportEnvelope(childId, "bad_request", "there was nothing to ask"),
        };
      }
      const idempotencyKey = newKey();

      let info = await session(childId, sessionSuffix, options.signal, false).catch(() => null);
      if (!info) {
        return {
          ok: false,
          failure: "no-session",
          envelope: transportEnvelope(childId, "not_configured", "could not start an assistant session"),
        };
      }

      let response: Response;
      try {
        response = await postTurn(info, trimmed, idempotencyKey, options.signal);
        if (response.status === 401) {
          // One re-mint, then one retry. Beyond that it is not an expiry.
          const refreshed = await session(childId, sessionSuffix, options.signal, true).catch(() => null);
          if (!refreshed) {
            return {
              ok: false,
              failure: "no-session",
              envelope: transportEnvelope(childId, "unauthorized", "the assistant session expired"),
            };
          }
          info = refreshed;
          response = await postTurn(info, trimmed, idempotencyKey, options.signal);
        }
      } catch {
        return {
          ok: false,
          failure: "network",
          envelope: transportEnvelope(childId, "upstream_unavailable", "could not reach the assistant"),
        };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return {
          ok: false,
          failure: "bad-response",
          envelope: transportEnvelope(childId, "turn_failed", "the assistant sent something unreadable"),
        };
      }

      const envelope = parseChildTurnEnvelope(body);
      if (response.ok && envelope.status === "ok") return { ok: true, envelope };
      return { ok: false, failure: "bad-response", envelope };
    },
  };
}
