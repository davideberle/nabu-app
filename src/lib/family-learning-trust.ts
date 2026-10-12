// ---------------------------------------------------------------------------
// The ONE trusted-reply boundary (assessment reset §7; repair round 5, R4-01).
//
// Every assistant reply that reaches the learning record — a free question, a
// reasoning turn, the writing review — passes through the same three steps:
//   1. the mission route verifies the bridge receipt with the configured secret
//      (`verifyReceiptOnOp`): absent → nothing, present → verified claims or an
//      explicit `{ invalid: reason }`;
//   2. the state machine binds the claims to the dispatch it recorded before
//      the send (`receiptOrigin`): child, session, turn id, request hash, reply
//      hash — the ORIGIN is one of verified / missing / malformed / invalid;
//   3. only a VERIFIED reply is attributed to Nabu, stored as Nabu's text in a
//      transcript, shown as Nabu's line, spoken, or used for an assessment.
//      Untrusted replies are kept in the evidence payload only (origin named)
//      and the child sees a local reviewed notice.
// Every consumer (sidebar speech and repeat, finished state, reports, reload)
// decides by `source`/`origin` through the helpers below — never by itself.
// ---------------------------------------------------------------------------

import type { BridgeReceiptClaims } from "./family-assistant-bridge.ts";
import { sha256Hex } from "./family-learning-hash.ts";

/** Discriminated origin of a reply, from the mission route's verification to the report. */
export type ReplyOrigin = "verified" | "missing" | "malformed" | "invalid";
/** Who a shown line belongs to: `assistant` = verified Nabu; `reviewed` = reviewed app text; `local` = local guidance shown instead of untrusted content. */
export type LineSource = "assistant" | "reviewed" | "local";

export type VerifiedReceipt = { sub: string; sid: string; key: string; req: string; res: string; iat: number; mdl?: string; run?: string };
/** A receipt that was present but failed verification: `invalid` carries the verifier's reason ("malformed"/"not-a-string" → origin `malformed`, else `invalid`). */
export type InvalidReceipt = { invalid: string };
export type ReceiptInput = VerifiedReceipt | InvalidReceipt | null | undefined;

/** The claims the route hands the state machine from a verified receipt (never a caller-supplied object). */
export function verifiedReceiptFromClaims(claims: BridgeReceiptClaims): VerifiedReceipt {
  // Keep this browser-shared module free of the server's node:crypto import.
  // Exact projection used by receiptProvenance; signature verification stays server-side.
  const p = claims.v === 2 ? { model: claims.mdl, runId: claims.run } : null;
  return { sub: claims.sub, sid: claims.sid, key: claims.key, req: claims.req, res: claims.res, iat: claims.iat, ...(p ? { mdl: p.model, run: p.runId } : {}) };
}

/**
 * Origin of a reply that could NOT be bound (no usable text, no pending dispatch): a receipt that verified cryptographically but was
 * never bound to this turn's bytes is `invalid` here — a verified signature is not a verified application reply (R5-01).
 */
export function originWithoutBinding(receipt: ReceiptInput): ReplyOrigin {
  if (!receipt) return "missing";
  if (typeof receipt !== "object") return "malformed";
  if ("invalid" in receipt) return receipt.invalid === "malformed" || receipt.invalid === "not-a-string" ? "malformed" : "invalid";
  return "invalid";
}

/**
 * The ONE display policy for a stored tutor reply event (parent cockpit and every other consumer): only an event whose stored
 * origin is `verified` AND that was shown may render the assistant's prose. A legacy event without an origin (written before the
 * origin schema) is UNKNOWN and withheld like untrusted content — its raw bytes stay in the evidence store only (R5-06).
 */
/**
 * What happened to a stored `tutor_reply` (parent projection, 2026-10-11 correction ID28): the stored ORIGIN and the stored DELIVERY
 * are read together — a verified reply may have been shown to the child as Nabu (free question `shown === true`, reasoning
 * `shownKind === "dialogue"`), shown as a reviewed prompt-bank question (`shownKind === "prompt-bank"`: the child saw the exact
 * bank text, never the raw reply), used inside the writing review (`writingReview` with status `done`: findings became teaching
 * points, no wording was shown), failed (unusable / transport failure — a local line was shown), or withheld (origin not verified —
 * a local line was shown instead). A record without a stored origin is UNKNOWN and withheld. Nothing here widens trust: only
 * `origin === "verified"` can ever be attributed to the assistant, exactly as before.
 */
export type ReplyDelivery = "displayed" | "reviewed-prompt" | "used-in-review" | "withheld" | "failed" | "unknown";
export function tutorReplyDelivery(payload: Record<string, unknown> | null | undefined): { origin: ReplyOrigin | "unknown"; delivery: ReplyDelivery; attributable: boolean; label: string } {
  const origin = payload && (payload.origin === "verified" || payload.origin === "missing" || payload.origin === "malformed" || payload.origin === "invalid") ? payload.origin : "unknown";
  if (origin === "unknown") return { origin, delivery: "unknown", attributable: false, label: "Antwort aus der Zeit vor der Herkunftsprüfung (Herkunft: unbekannt) — zurückgehalten, nicht als Assistent gewertet" };
  const cls = typeof payload?.classification === "string" ? payload.classification : "";
  if (payload?.reasoning === true) {
    if (origin !== "verified") return { origin, delivery: "withheld", attributable: false, label: `Antwort ohne Beglaubigung (Herkunft: ${origin}) — zurückgehalten; dem Kind wurde stattdessen ein lokaler Hinweis gezeigt` };
    const kind = typeof payload.shownKind === "string" ? payload.shownKind : "";
    if (kind === "dialogue") return { origin, delivery: "displayed", attributable: true, label: "beglaubigt; dem Kind als Nabu gezeigt" };
    if (kind === "prompt-bank") return { origin, delivery: "reviewed-prompt", attributable: true, label: "beglaubigt; dem Kind als Rückfrage aus der geprüften Liste gezeigt (nicht der Wortlaut der Antwort)" };
    if (kind === "withheld") return { origin, delivery: "withheld", attributable: false, label: "beglaubigt, aber zurückgehalten; dem Kind wurde ein lokaler Hinweis gezeigt" };
    return { origin, delivery: "failed", attributable: false, label: `beglaubigt, aber nicht verwertbar${cls ? ` (${cls})` : ""} — dem Kind wurde ein lokaler Hinweis gezeigt` };
  }
  if (payload?.writingReview === true) {
    if (origin !== "verified") return { origin, delivery: "withheld", attributable: false, label: `Antwort ohne Beglaubigung (Herkunft: ${origin}) — nicht in die Schreib-Rückmeldung eingeflossen (nur die mechanische Prüfung sprach)` };
    if (payload.status === "done") return { origin, delivery: "used-in-review", attributable: true, label: "beglaubigt; in die Schreib-Rückmeldung eingeflossen — kein Wortlaut für das Kind, die Befunde wurden als Lernpunkte gezeigt" };
    const problem = typeof payload.problem === "string" && payload.problem ? ` (${payload.problem})` : "";
    return { origin, delivery: "failed", attributable: false, label: `beglaubigt, aber nicht verwertbar${problem} — Bedeutung und Grammatik blieben ungeprüft` };
  }
  if (origin === "verified" && payload?.shown === true) return { origin, delivery: "displayed", attributable: true, label: "beglaubigt; dem Kind als Nabu gezeigt" };
  if (origin === "verified" && cls === "transport-failure") return { origin, delivery: "failed", attributable: false, label: "Übertragung fehlgeschlagen — keine Antwort, nichts gezeigt" };
  if (origin === "verified") return { origin, delivery: "withheld", attributable: false, label: "beglaubigt, aber nicht gezeigt (keine Zustellung aufgezeichnet)" };
  return { origin, delivery: "withheld", attributable: false, label: `Antwort ohne Beglaubigung (Herkunft: ${origin}) — zurückgehalten, dem Kind nicht gezeigt` };
}

/** Assistant attribution for a stored reply: only a verified reply that was actually DISPLAYED as Nabu (free question or reasoning dialogue). */
export function tutorReplyDisplay(payload: Record<string, unknown> | null | undefined): { mode: "assistant" | "withheld"; origin: ReplyOrigin | "unknown"; label: string } {
  const d = tutorReplyDelivery(payload);
  return { mode: d.delivery === "displayed" ? "assistant" : "withheld", origin: d.origin, label: d.label };
}

/** Executor-reported run metadata as a parent-readable line; "unbekannt" only when the receipt carried none. Never provider-attested. */
export function provenanceLabel(model: { model: string; runId: string } | null | undefined): string {
  if (!model) return "Modell: unbekannt (Beleg ohne Laufdaten)";
  return `Modell (vom Executor gemeldet, nicht vom Anbieter bestätigt): ${model.model}, Lauf ${model.runId}`;
}

/** Bind verified claims to the dispatch recorded before the send. Mismatching claims are a forgery and throw. */
export function receiptOrigin(receipt: ReceiptInput, expected: { child: string; turnId: string; reqHash: string; text: string }): ReplyOrigin {
  if (!receipt || "invalid" in receipt) return originWithoutBinding(receipt);
  const ok = receipt.sub === expected.child && receipt.sid === "learn" && receipt.key === expected.turnId && receipt.req === expected.reqHash && receipt.res === sha256Hex(expected.text);
  if (!ok) throw new Error("the receipt does not match this turn");
  return "verified";
}

/** Authenticated run metadata of a verified receipt (v2), or null — never a configured default. */
export function provenanceOf(receipt: ReceiptInput): { model: string; runId: string } | null {
  if (!receipt || "invalid" in receipt || typeof receipt.mdl !== "string" || typeof receipt.run !== "string") return null;
  return { model: receipt.mdl, runId: receipt.run };
}

/** May this line be attributed to Nabu (shown as Nabu's own words)? Only a verified origin. */
export function attributableToNabu(origin: ReplyOrigin | null | undefined): boolean {
  return origin === "verified";
}

/** May this line be spoken? Verified Nabu lines and reviewed app lines; never local guidance shown instead of untrusted content, never unknown sources. */
export function speakable(source: LineSource | null | undefined): boolean {
  return source === "assistant" || source === "reviewed";
}
