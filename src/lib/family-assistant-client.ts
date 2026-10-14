// Real-child AI is temporarily disabled during the runtime retirement.
// Session parsing remains shared by the independent non-AI Listening Library.

import { childAssistantUnavailable } from "./family-assistant-availability.ts";
import {
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
  if (typeof token !== "string" || !/^fcm1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  // `https:` for every non-loopback host; plaintext only to this machine.
  const origin = readBridgeOrigin(bridgeUrl);
  if (!origin) return null;
  return { child, sessionSuffix, token, expiresAt, bridgeUrl: origin };
}

/** Reason a turn could not even be attempted. Mapped to a child-facing line. `too-long`: the caller refused silent truncation (repair round 2, IV5-05). */
export type ChildTurnTransportFailure = "no-session" | "network" | "bad-response" | "too-long" | "unavailable";

export type ChildTurnOutcome =
  | { ok: true; envelope: ChildTurnEnvelope }
  | { ok: false; failure: ChildTurnTransportFailure; envelope: ChildTurnEnvelope };

export type ChildTurnClientDeps = {
  /** Injected so the tests never touch the network. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Injected so idempotency keys are deterministic in tests. */
  newIdempotencyKey?: () => string;
};

export type ChildTurnClient = {
  /** Returns the explicit retirement notice; never transmits the utterance. */
  ask: (
    params: { childId: ChildId; sessionSuffix: string; message: string },
    /** Compatibility options retained for callers; none can enable AI transport. */
    options?: { signal?: AbortSignal; idempotencyKey?: string; noTruncate?: boolean },
  ) => Promise<ChildTurnOutcome>;
  /** Drops the cached session, e.g. when the child profile changes. */
  reset: () => void;
  /** Current cached session, for tests and diagnostics. */
  peekSession: () => ChildBridgeSessionInfo | null;
};

// Retirement boundary: never mint, forward, refresh, or reuse a legacy child token.
// Dependencies remain accepted for callers/tests, but cannot activate transport.
export function createChildTurnClient(_deps: ChildTurnClientDeps = {}): ChildTurnClient {
  return {
    reset() {},
    peekSession: () => null,
    async ask({ childId }) {
      return {
        ok: false,
        failure: "unavailable",
        envelope: childAssistantUnavailable(childId),
      };
    },
  };
}
