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
    const wallet = readSource("./family-wallet.ts");

    match(routines, /CompletionStatus = "done" \| "pending_review" \| "on_hold" \| "redo"/);
    match(routines, /c\.status === "done"/);
    match(wallet, /row\.status === "done"/);
    match(wallet, /row\.awardedPoints/);
  });

  it("the guided record flow submits for review and the parent tools render approve/hold/redo", () => {
    const record = readSource("../app/family/(shell)/assistant/record/client.tsx");
    const parent = readSource("../app/family/parent/client.tsx");

    match(record, /status: "pending_review"/);
    match(parent, /review\(item, "approve"\)/);
    match(parent, /review\(item, "hold"\)/);
    match(parent, /review\(item, "redo"\)/);
  });

  it("keeps redo status-only so the original transcript survives", () => {
    const database = readSource("./family-db.ts");
    const ledger = readSource("./family-wallet-ledger.ts");

    // The review-action update writes status + reviewed_at and nothing else —
    // in particular it never touches note/normalized_summary/challenge, which
    // is what "redo preserves the child's original transcript" rests on.
    match(ledger, /UPDATE family_completions SET status = \?, reviewed_at = \?,/);
    match(ledger, /COALESCE\(awarded_points, \?\)/);
    // The write is a compare-and-swap so concurrent review actions cannot
    // silently overwrite each other.
    match(ledger, /AND status = \? AND created_at IS \?/);
    // A resubmission is a new submission: fresh created_at, review cleared.
    match(database, /created_at = excluded\.created_at/);
    match(database, /reviewed_at = NULL/);
  });

  it("a child session can never write done directly; approval provenance is explicit (October 8, 2026)", () => {
    const route = readSource("../app/api/family/completions/route.ts");
    const ledger = readSource("./family-wallet-ledger.ts");

    match(route, /\(status === "done" \|\| parentAssisted === true\) && !admin/);
    match(route, /"parent-review",\n/);
    match(route, /"parent-assisted",\n/);
    match(ledger, /approval_source = CASE WHEN \? = 'done' THEN \? ELSE NULL END/);
  });
});
