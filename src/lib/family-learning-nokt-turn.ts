// ---------------------------------------------------------------------------
// Nokt turn — the reply receipt, as the reply route hands it to the engine (content v6, N7-03/N7-06).
//
// **Server-only** (node:crypto via the bridge verifier). The hosted app cannot
// reach the family runtime on the private network, so the turn is
// browser-mediated, exactly like listening: the dispatch route returns the
// server-built request and a minted `learn` bridge token; the browser on the
// Mac mini sends `{ turnId, request }` to `<bridge>/v1/nokt/turn`; the reply
// route receives `{ reply, receipt }` back. Here the receipt's SIGNATURE is
// checked with the existing shared secret; the engine then binds the claims to
// its own dispatch record (child, sid "learn", turn, request hash, exact reply
// bytes — `receiptOrigin`). Nothing here mints a receipt.
// ---------------------------------------------------------------------------

import { verifyBridgeReceipt } from "./family-assistant-bridge.ts";
import { verifiedReceiptFromClaims, type ReceiptInput } from "./family-learning-trust.ts";

/** Session suffix of the bridge token the dispatch route mints for a Nokt turn (the runtime accepts only this on its turn route). */
export const NOKT_SESSION_SUFFIX = "learn";

/** The receipt as the engine needs it: verified claims, an explicit invalid marker, or null when none came. */
export function noktReceiptInput(receipt: unknown, secret: string, nowSeconds?: number): ReceiptInput {
  if (receipt === undefined || receipt === null) return null;
  const verified = typeof receipt === "string" ? verifyBridgeReceipt(receipt, secret, nowSeconds) : ({ ok: false, reason: "not-a-string" } as const);
  return verified.ok ? verifiedReceiptFromClaims(verified.claims) : { invalid: verified.reason };
}
