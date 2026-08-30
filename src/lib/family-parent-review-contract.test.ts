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
    match(route, /action !== "approve" && action !== "hold"/);
    match(route, /updateCompletionStatus/);
  });

  it("preserves stored review states instead of projecting them as done", () => {
    const database = readSource("./family-db.ts");

    match(database, /status === "pending_review" \|\| status === "on_hold"/);
    match(database, /status: validStatus/);
    match(database, /reviewed_at/);
  });

  it("keeps review states out of the coin balance", () => {
    const routines = readSource("../data/family-routines.ts");
    const shell = readSource("./family-child-shell.ts");

    match(routines, /CompletionStatus = "done" \| "pending_review" \| "on_hold"/);
    match(shell, /c\.status === "done"/);
  });

  it("submits voice-coach work for review and renders parent controls", () => {
    const board = readSource("../app/family/dashboard/[person]/client.tsx");

    match(board, /submitCompletion\(routine, day, "pending_review"/);
    match(board, /onReviewAction/);
    match(board, /Approve/);
    match(board, /Hold/);
  });
});
