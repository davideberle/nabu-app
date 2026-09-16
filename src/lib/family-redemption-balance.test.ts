import { match, doesNotMatch } from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(
  new URL("../app/api/family/redemptions/route.ts", import.meta.url),
  "utf8",
);

describe("family redemption balance enforcement", () => {
  it("uses the same credit-count-aware weekly earnings helper as the UIs", () => {
    match(routeSource, /weekPoints\(personId, completions, resolved\)/);
    doesNotMatch(routeSource, /return sum \+ \(routine\?\.points \?\? 0\)/);
  });
});
