import { deepStrictEqual, equal, notEqual, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReviewQueueSnapshot,
  completionIdentityKey,
  isReviewAction,
  isReviewQueueStatus,
  normalizeGuidedSummary,
  resolveReviewAction,
  summaryIsHonest,
  MAX_SUMMARY_CHARS,
  REVIEW_ACTION_TARGET,
  type ReviewQueueRow,
} from "./family-review-queue.ts";

const row = (over: Partial<ReviewQueueRow> = {}): ReviewQueueRow => ({
  week: "2026-W35",
  personId: "santiago",
  routineId: "s-piano",
  day: 2,
  status: "pending_review",
  submittedAt: "2026-08-30T10:00:00.000Z",
  ...over,
});

describe("review queue snapshot", () => {
  it("orders deterministically by submission time then identity", () => {
    const rows: ReviewQueueRow[] = [
      row({ personId: "isabel", routineId: "i-kumon", submittedAt: "2026-08-30T12:00:00.000Z" }),
      row({ submittedAt: "2026-08-29T08:00:00.000Z", week: "2026-W25" }),
      row({ personId: "isabel", routineId: "i-dinner", submittedAt: "2026-08-30T12:00:00.000Z" }),
    ];
    const snapshot = buildReviewQueueSnapshot(rows);
    deepStrictEqual(
      snapshot.items.map((item) => [item.number, item.routineId]),
      [
        [1, "s-piano"],
        [2, "i-dinner"],
        [3, "i-kumon"],
      ],
    );
    // Shuffled input produces the identical snapshot.
    const shuffled = buildReviewQueueSnapshot([rows[2], rows[0], rows[1]]);
    deepStrictEqual(shuffled, snapshot);
  });

  it("sorts rows without a timestamp last", () => {
    const snapshot = buildReviewQueueSnapshot([
      row({ routineId: "s-kumon", submittedAt: undefined }),
      row({ routineId: "s-piano" }),
    ]);
    deepStrictEqual(
      snapshot.items.map((item) => item.routineId),
      ["s-piano", "s-kumon"],
    );
  });

  it("gives every item its stable identity key", () => {
    const snapshot = buildReviewQueueSnapshot([row()]);
    equal(snapshot.items[0].key, "2026-W35:santiago:s-piano:2");
    equal(
      snapshot.items[0].key,
      completionIdentityKey("2026-W35", "santiago", "s-piano", 2),
    );
  });

  it("produces a stable snapshot id that changes with the queue", () => {
    const a = buildReviewQueueSnapshot([row(), row({ routineId: "s-kumon" })]);
    const b = buildReviewQueueSnapshot([row({ routineId: "s-kumon" }), row()]);
    equal(a.snapshotId, b.snapshotId);

    const afterApproval = buildReviewQueueSnapshot([row({ routineId: "s-kumon" })]);
    notEqual(afterApproval.snapshotId, a.snapshotId);

    const afterHold = buildReviewQueueSnapshot([
      row({ status: "on_hold" }),
      row({ routineId: "s-kumon" }),
    ]);
    notEqual(afterHold.snapshotId, a.snapshotId);

    // A resubmission over the same identity (new transcript, still pending)
    // also invalidates the snapshot: numbered replies must never approve
    // words the parent never read.
    const original = buildReviewQueueSnapshot([row({ note: "first try" })]);
    const resubmitted = buildReviewQueueSnapshot([row({ note: "second try" })]);
    notEqual(resubmitted.snapshotId, original.snapshotId);
  });

  it("drops rows that are not in a review status instead of trusting them", () => {
    const snapshot = buildReviewQueueSnapshot([
      row(),
      // A caller bug handing in an earning row must not surface it for
      // re-approval.
      row({ routineId: "s-kumon", status: "done" as ReviewQueueRow["status"] }),
    ]);
    deepStrictEqual(
      snapshot.items.map((item) => item.routineId),
      ["s-piano"],
    );
  });

  it("recognizes exactly the two queue statuses", () => {
    equal(isReviewQueueStatus("pending_review"), true);
    equal(isReviewQueueStatus("on_hold"), true);
    equal(isReviewQueueStatus("done"), false);
    equal(isReviewQueueStatus("redo"), false);
  });
});

describe("review action resolution", () => {
  it("maps the closed action vocabulary to non-earning-safe targets", () => {
    deepStrictEqual(REVIEW_ACTION_TARGET, {
      approve: "done",
      hold: "on_hold",
      redo: "redo",
    });
    equal(isReviewAction("approve"), true);
    equal(isReviewAction("redo"), true);
    equal(isReviewAction("reject"), false);
    equal(isReviewAction(""), false);
  });

  it("applies when the row matches the caller's expectation", () => {
    deepStrictEqual(
      resolveReviewAction({
        current: { status: "pending_review" },
        action: "approve",
        expectedStatus: "pending_review",
      }),
      { kind: "apply", to: "done" },
    );
    deepStrictEqual(
      resolveReviewAction({ current: { status: "on_hold" }, action: "redo" }),
      { kind: "apply", to: "redo" },
    );
  });

  it("is idempotent: repeat approval is a no-op, never a second award", () => {
    deepStrictEqual(
      resolveReviewAction({
        current: { status: "done" },
        action: "approve",
        expectedStatus: "pending_review",
      }),
      { kind: "noop", status: "done" },
    );
    deepStrictEqual(
      resolveReviewAction({ current: { status: "redo" }, action: "redo" }),
      { kind: "noop", status: "redo" },
    );
  });

  it("fails closed when the row moved under a stale snapshot", () => {
    // Snapshot said pending; another device already put it on hold. The stale
    // "approve number 3" must not approve what the parent never saw.
    deepStrictEqual(
      resolveReviewAction({
        current: { status: "on_hold" },
        action: "approve",
        expectedStatus: "pending_review",
      }),
      { kind: "conflict", status: "on_hold" },
    );
    // Row vanished entirely but the caller stated an expectation.
    deepStrictEqual(
      resolveReviewAction({
        current: null,
        action: "approve",
        expectedStatus: "pending_review",
      }),
      { kind: "conflict", status: null },
    );
  });

  it("reports a missing row as missing when no expectation was stated", () => {
    deepStrictEqual(resolveReviewAction({ current: null, action: "hold" }), {
      kind: "missing",
    });
  });
});

describe("normalized summary", () => {
  it("derives a short display line without inventing words", () => {
    const transcript =
      "ehm I practiced the new piece for twenty minutes and then I played the scales twice";
    const summary = normalizeGuidedSummary(transcript);
    equal(
      summary,
      "I practiced the new piece for twenty minutes and then I played the scales twice",
    );
    ok(summaryIsHonest(summary, transcript));
  });

  it("truncates at a word boundary within the display bound", () => {
    const transcript = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const summary = normalizeGuidedSummary(transcript);
    ok(summary.length <= MAX_SUMMARY_CHARS + 1);
    ok(summary.endsWith("…"));
    ok(summaryIsHonest(summary, transcript));
  });

  it("returns empty for empty or filler-only input", () => {
    equal(normalizeGuidedSummary(""), "");
    equal(normalizeGuidedSummary("   "), "");
    equal(normalizeGuidedSummary("um uh ehm"), "");
    equal(normalizeGuidedSummary(undefined), "");
  });

  it("keeps meaning-bearing sentence openers like So/Well/Also", () => {
    equal(
      normalizeGuidedSummary("So proud, I finally did the cartwheel"),
      "So proud, I finally did the cartwheel",
    );
    equal(
      normalizeGuidedSummary("Well done was what my teacher said"),
      "Well done was what my teacher said",
    );
  });

  it("prefers no summary over an invented mid-word fragment", () => {
    // A transcript opening with one giant token has no honest truncation.
    const giant = "a".repeat(300);
    equal(normalizeGuidedSummary(giant), "");
    const withTail = `${giant} then words`;
    equal(normalizeGuidedSummary(withTail), "");
  });

  it("never passes a summary containing words absent from the transcript", () => {
    equal(summaryIsHonest("Practiced piano for 30 minutes", "I practiced piano"), false);
    equal(summaryIsHonest("I practiced piano", "I practiced piano today"), true);
  });
});
