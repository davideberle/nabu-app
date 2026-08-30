import { match } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("family parent-review regression contract", () => {
  it("accepts review submissions and exposes the parent review action", () => {
    const route = readSource("../app/api/family/completions/route.ts");

    match(route, /\["done", "pending_review"\]/);
    match(route, /export async function PATCH/);
    // The action vocabulary is the canonical review contract's closed set
    // (approve / hold / redo); anything else is refused before any write.
    match(route, /!isReviewAction\(action\)/);
    match(route, /updateCompletionStatus/);
    // Stale numbered actions fail closed instead of mutating a different
    // submission (Family DESIGN.md Phase R7).
    match(route, /resolveReviewAction/);
    match(route, /status: 409/);
    // A resubmitted transcript invalidates a pending approval even though the
    // status still matches.
    match(route, /expectedSubmittedAt/);
    // A submission can never silently overwrite a parent's done/on_hold
    // decision.
    match(route, /Already reviewed/);
  });

  it("preserves stored review states instead of projecting them as done", () => {
    const database = readSource("./family-db.ts");

    match(database, /status === "pending_review" \|\| status === "on_hold" \|\| status === "redo"/);
    match(database, /status: narrowCompletionStatus/);
    match(database, /reviewed_at/);
  });

  it("keeps review states out of the coin balance", () => {
    const routines = readSource("../data/family-routines.ts");
    const shell = readSource("./family-child-shell.ts");

    match(routines, /CompletionStatus = "done" \| "pending_review" \| "on_hold" \| "redo"/);
    match(shell, /c\.status === "done"/);
  });

  it("submits voice-coach work for review and renders parent controls", () => {
    const board = readSource("../app/family/dashboard/[person]/client.tsx");

    match(board, /submitCompletion\(routine, day, "pending_review"/);
    match(board, /onReviewAction/);
    match(board, /Approve/);
    match(board, /Hold/);
    match(board, /Redo/);
  });

  it("keeps redo status-only so the original transcript survives", () => {
    const database = readSource("./family-db.ts");

    // The review-action update writes status + reviewed_at and nothing else —
    // in particular it never touches note/normalized_summary/challenge, which
    // is what "redo preserves the child's original transcript" rests on.
    match(database, /UPDATE family_completions SET status = \?, reviewed_at = \?\n\s+WHERE week = \?/);
    // The write is a compare-and-swap so concurrent review actions cannot
    // silently overwrite each other.
    match(database, /AND status = \? AND created_at IS \?/);
    // A resubmission is a new submission: fresh created_at, review cleared.
    match(database, /created_at = excluded\.created_at/);
    match(database, /reviewed_at = NULL/);
  });

  it("a redo reopening can never self-approve on the child board", () => {
    const board = readSource("../app/family/dashboard/[person]/client.tsx");

    match(board, /fromRedo/);
    match(board, /needsReview \? "pending_review" : "done"/);
  });
});
