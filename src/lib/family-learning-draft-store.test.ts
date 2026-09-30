// Recoverable completed drafts (independent repair R4-2). Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { clearChildDrafts, clearDraft, draftKey, identityMatches, loadDraft, retireAllDrafts, retireMismatched, saveDraft, type DraftIdentity, type DraftStorage, type StoredDraft } from "./family-learning-draft-store.ts";

function memory(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const id: DraftIdentity = { child: "santiago", contentVersion: 2, visitId: "v4", visitStartedAt: "2026-09-30T10:00:00.000Z", erasureGeneration: 0, stage: "log-transfer", session: "abc123" };
const draft = (over: Partial<StoredDraft> = {}): StoredDraft => ({ v: 1, identity: id, op: "write-transfer", payload: { op: "write-transfer", text: "Ich sehe 3 Wellen.", modality: "typed" }, payloadKey: "k", idempotencyKey: "key-1", savedAt: 1, ...over });

describe("R4-2 — completed drafts are bound to the exact identity and retired on any mismatch", () => {
  it("round trip for the same identity; key and payload are preserved exactly", () => {
    const s = memory();
    ok(saveDraft(s, draft()));
    deepStrictEqual(loadDraft(s, id, "write-transfer"), draft());
    equal(loadDraft(s, id, "reflect"), null, "the other op has no draft");
  });
  it("stage moved on, other visit instance, erasure, other content version, other child, other sign-in, unknown sign-in: never restored, storage cleared", () => {
    const cases: Partial<DraftIdentity>[] = [{ stage: "summary" }, { visitStartedAt: "2026-09-30T11:00:00.000Z" }, { visitId: "v1" }, { erasureGeneration: 1 }, { contentVersion: 1 }, { session: "other" }, { session: null }];
    for (const c of cases) {
      const s = memory();
      saveDraft(s, draft());
      equal(loadDraft(s, { ...id, ...c }, "write-transfer"), null, JSON.stringify(c));
      if (!("child" in c)) equal(s.map.has(draftKey("santiago", "write-transfer")), false, "retired: " + JSON.stringify(c));
    }
    const s = memory();
    saveDraft(s, draft());
    equal(loadDraft(s, { ...id, child: "isabel" }, "write-transfer"), null, "another child's key is a different key");
    ok(s.map.has(draftKey("santiago", "write-transfer")), "santiago's draft is untouched by isabel's lookup");
    ok(!identityMatches({ ...id, session: null }, id) && !identityMatches(id, { ...id, session: null }));
  });
  it("retireMismatched clears every op of the child whose identity is stale; clearChildDrafts clears all; malformed entries are dropped", () => {
    const s = memory();
    saveDraft(s, draft());
    saveDraft(s, draft({ op: "reflect", payload: { op: "reflect", optionId: "right" }, idempotencyKey: "key-2" }));
    retireMismatched(s, id);
    equal(s.map.size, 2, "matching drafts stay");
    retireMismatched(s, { ...id, stage: "summary" });
    equal(s.map.size, 0);
    saveDraft(s, draft());
    s.map.set(draftKey("santiago", "reflect"), "{not json");
    equal(loadDraft(s, id, "reflect"), null);
    equal(s.map.has(draftKey("santiago", "reflect")), false);
    clearChildDrafts(s, "santiago");
    equal(s.map.size, 0);
    clearDraft(null, "santiago", "reflect");
    equal(loadDraft(null, id, "reflect"), null, "no storage → nothing");
  });
  it("R5-3: retireAllDrafts removes every learning draft of every child and nothing else", () => {
    const s = memory();
    saveDraft(s, draft());
    saveDraft(s, draft({ identity: { ...id, child: "isabel" }, op: "reflect", payload: { op: "reflect" } }));
    s.map.set("unrelated-key", "keep");
    const withKeys = Object.assign(s, { get length() { return s.map.size; }, key: (i: number) => [...s.map.keys()][i] ?? null });
    equal(retireAllDrafts(withKeys), 2);
    deepStrictEqual([...s.map.keys()], ["unrelated-key"]);
    equal(retireAllDrafts(null), 0);
  });
  it("oversized drafts are refused (bounded storage)", () => {
    const s = memory();
    equal(saveDraft(s, draft({ payload: { text: "x".repeat(5000) } })), false);
    equal(s.map.size, 0);
  });
});
