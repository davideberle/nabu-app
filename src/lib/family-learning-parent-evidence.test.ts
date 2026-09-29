// Parent evidence orchestration (R5-1) and typing display (R5-2).
// Run with: npm test

import { deepStrictEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginRequest,
  clearEvidence,
  createEvidenceStore,
  invalidateAuthorization,
  isCurrentEpoch,
  describeTypingMetrics,
  formatTypingMetrics,
  receiveEvidence,
  renderableEvidence,
  selectChild,
  type EvidenceIdentity,
} from "./family-learning-parent-evidence.ts";

type B = EvidenceIdentity & { hook: string | null };
const santiago = (hook: string | null, gen = 0): B => ({ child: "santiago", erasureGeneration: gen, hook });
const isabel = (hook: string | null, gen = 0): B => ({ child: "isabel", erasureGeneration: gen, hook });

describe("evidence store", () => {
  it("child switch with equal generations: old evidence disappears at once and is never rendered for the new child", () => {
    let s = createEvidenceStore<B>("santiago");
    let r = beginRequest(s);
    s = receiveEvidence(r.store, r.seq, santiago("PRIVATE HOOK")).store;
    equal(renderableEvidence(s)?.hook, "PRIVATE HOOK");
    s = selectChild(s, "isabel");
    equal(renderableEvidence(s), null);
    // Even without any request pending, Santiago's bundle can no longer be shown or saved under Isabel.
    r = beginRequest(s);
    const wrong = receiveEvidence(r.store, r.seq, santiago("PRIVATE HOOK"));
    equal(wrong.outcome, "ignored-wrong-child");
    equal(renderableEvidence(wrong.store), null);
    const right = receiveEvidence(r.store, r.seq, isabel(null));
    equal(right.outcome, "adopted");
    deepStrictEqual(renderableEvidence(right.store), isabel(null));
  });

  it("pending load for the previous child, then a switch: the late response is superseded", () => {
    let s = createEvidenceStore<B>("santiago");
    const first = beginRequest(s);
    s = selectChild(first.store, "isabel");
    const second = beginRequest(s);
    s = second.store;
    // Responses arrive in order: the old Santiago response is stale by sequence and by child.
    const late = receiveEvidence(s, first.seq, santiago("PRIVATE HOOK"));
    equal(late.outcome, "ignored-superseded");
    const now = receiveEvidence(late.store, second.seq, isabel(null));
    equal(now.outcome, "adopted");
    equal(renderableEvidence(now.store)?.child, "isabel");
  });

  it("reversed responses: a newer request's bundle wins and the older one cannot replace it", () => {
    let s = createEvidenceStore<B>("santiago");
    const a = beginRequest(s);
    const b = beginRequest(a.store);
    s = b.store;
    const newer = receiveEvidence(s, b.seq, santiago(null, 1));
    equal(newer.outcome, "adopted");
    const older = receiveEvidence(newer.store, a.seq, santiago("PRIVATE HOOK", 0));
    equal(older.outcome, "ignored-superseded");
    equal(renderableEvidence(older.store)?.hook, null);
  });

  it("post-deletion refresh: a response carrying an older generation for the same child is refused even if it is the latest request", () => {
    let s = createEvidenceStore<B>("santiago");
    let r = beginRequest(s);
    s = receiveEvidence(r.store, r.seq, santiago(null, 2)).store;
    r = beginRequest(s);
    const regressed = receiveEvidence(r.store, r.seq, santiago("PRIVATE HOOK", 1));
    equal(regressed.outcome, "ignored-regressed-generation");
    equal(renderableEvidence(regressed.store)?.erasureGeneration, 2);
    // Switching children keeps each child's own fence.
    s = selectChild(regressed.store, "isabel");
    r = beginRequest(s);
    equal(receiveEvidence(r.store, r.seq, isabel(null, 0)).outcome, "adopted");
  });

  it("authorization invalidation supersedes a held owner response: cleared data never returns (browser blocker 1)", () => {
    let s = createEvidenceStore<B>("santiago");
    let r = beginRequest(s);
    s = receiveEvidence(r.store, r.seq, santiago("PRIVATE_TITLE_20260929")).store;
    // A refresh is in flight and its 200 is already fetched under owner authority …
    const held = beginRequest(s);
    s = held.store;
    const epochBefore = s.authEpoch;
    // … then the server refuses a save (session switched to the assistant).
    s = invalidateAuthorization(s);
    equal(renderableEvidence(s), null);
    equal(s.denied, true);
    equal(isCurrentEpoch(s, epochBefore), false);
    // Releasing the held response cannot restore anything, and does not clear "denied".
    const late = receiveEvidence(s, held.seq, santiago("PRIVATE_TITLE_20260929"));
    equal(late.outcome, "ignored-superseded");
    equal(renderableEvidence(late.store), null);
    equal(late.store.denied, true);
    // Only a NEW request issued after the invalidation can show data again (a fresh owner session).
    const fresh = beginRequest(late.store);
    const again = receiveEvidence(fresh.store, fresh.seq, santiago(null, 0));
    equal(again.outcome, "adopted");
    equal(again.store.denied, false);
  });

  it("clearing applies only to the latest request", () => {
    let s = createEvidenceStore<B>("santiago");
    const a = beginRequest(s);
    s = receiveEvidence(a.store, a.seq, santiago(null)).store;
    const b = beginRequest(s);
    equal(renderableEvidence(clearEvidence(b.store, a.seq)) !== null, true);
    equal(renderableEvidence(clearEvidence(b.store, b.seq)), null);
  });
});

describe("typing metrics display", () => {
  it("uses the stored per-line denominator: 33/37 is 89 %, with extras and omissions shown", () => {
    const m = { expectedChars: 35, typedChars: 35, correctChars: 33, extraChars: 2, omittedChars: 2, denominator: 37, seconds: 30 };
    const d = formatTypingMetrics(m);
    equal(d.percent, 89);
    equal(d.denominator, 37);
    equal(d.basis, "stored");
    equal(describeTypingMetrics(m), "Genauigkeit 89% (33 von 37 richtig, 35 erwartet, 2 zu viel, 2 fehlen)");
  });
  it("falls back to max(expected, typed) for single-label and legacy records", () => {
    equal(formatTypingMetrics({ expectedChars: 7, typedChars: 12, correctChars: 7, extraChars: 5 }).percent, 58);
    equal(describeTypingMetrics({ expectedChars: 7, typedChars: 12, correctChars: 7, extraChars: 5 }), "Genauigkeit 58% (7 von 12 richtig, 7 erwartet, 5 zu viel)");
    equal(formatTypingMetrics({ expectedChars: 10, correctChars: 10 }).percent, 100);
    equal(describeTypingMetrics({ expectedChars: 10, correctChars: 10 }), "Genauigkeit 100% (10 von 10 richtig)");
  });
});
