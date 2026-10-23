// ---------------------------------------------------------------------------
// Nokt turn — the server's hop to the tutor backend and the receipt binding (content v6, N7-03/N7-06).
//
// **Server-only** (node:crypto via the bridge verifier). No backend is chosen
// here: the request goes to `<FAMILY_ASSISTANT_BRIDGE_URL>/nokt/turn` with a
// minted bridge token (the existing app → bridge credential), and the reply
// must come back with an `fcr1` receipt signed by the bridge with the existing
// shared secret. The real runtime has no such endpoint yet; the isolated tests
// use a loopback stub that signs with a synthetic secret. This module only
// VERIFIES receipts — nothing here can mint one.
//
// Binding (unchanged trust boundary, `receiptOrigin`): sub = the child, sid =
// "learn", key = the turn id, req = the hash of the request the app built at
// dispatch, res = sha256 of the exact reply bytes. Anything else is not Nokt's.
// ---------------------------------------------------------------------------

import { buildChildBridgeSession, verifyBridgeReceipt, type BridgeMintConfig } from "./family-assistant-bridge.ts";
import { originWithoutBinding, receiptOrigin, verifiedReceiptFromClaims, type ReplyOrigin } from "./family-learning-trust.ts";

export const NOKT_BACKEND_PATH = "/nokt/turn";
export const NOKT_BACKEND_TIMEOUT_MS = 30_000;
export const NOKT_SESSION_SUFFIX = "learn";

/** The origin of one reply: verified only when the signature checks AND the claims bind to this turn's dispatch and bytes. */
export function noktReplyOrigin(receipt: unknown, secret: string, expected: { child: string; turnId: string; reqHash: string; text: string }, nowSeconds?: number): ReplyOrigin {
  if (receipt === undefined || receipt === null) return "missing";
  const verified = verifyBridgeReceipt(receipt, secret, nowSeconds);
  if (!verified.ok) return originWithoutBinding({ invalid: verified.reason });
  try {
    return receiptOrigin(verifiedReceiptFromClaims(verified.claims), expected);
  } catch {
    // Signed, but for another child, turn, request or text: a forgery or a replay, never Nokt's line.
    return "invalid";
  }
}

export type NoktBackendAnswer = { ok: true; reply: string; receipt: unknown } | { ok: false; reason: "cancelled" | "transport" };

/** One request to the tutor backend; the caller's signal (he cancelled, closed Nokt or changed task) and a timeout abort it. */
export async function askNoktBackend(
  config: BridgeMintConfig,
  input: { child: string; turnId: string; request: unknown },
  deps: { signal: AbortSignal; jti: string; nowMs?: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<NoktBackendAnswer> {
  const doFetch = deps.fetchImpl ?? fetch;
  const { token } = buildChildBridgeSession({ config, childId: input.child, sessionSuffix: NOKT_SESSION_SUFFIX, jti: deps.jti, nowMs: deps.nowMs ?? Date.now() });
  let response: Response;
  try {
    response = await doFetch(`${config.bridgeUrl.replace(/\/$/, "")}${NOKT_BACKEND_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ turnId: input.turnId, request: input.request }),
      signal: AbortSignal.any([deps.signal, AbortSignal.timeout(deps.timeoutMs ?? NOKT_BACKEND_TIMEOUT_MS)]),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: deps.signal.aborted ? "cancelled" : "transport" };
  }
  if (!response.ok) return { ok: false, reason: "transport" };
  try {
    const body = (await response.json()) as { reply?: unknown; receipt?: unknown };
    if (typeof body.reply !== "string") return { ok: false, reason: "transport" };
    return { ok: true, reply: body.reply, receipt: body.receipt };
  } catch {
    return { ok: false, reason: deps.signal.aborted ? "cancelled" : "transport" };
  }
}
