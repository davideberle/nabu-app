// Static wiring guards for Phase 4E's UI and route boundaries. Pure behavior
// is covered in recipe-render-qa.test.ts and planner-preparation.test.ts.

import { doesNotMatch, match } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("Phase 4E visible-candidate wiring", () => {
  it("gates both database generation and Quick View through recipe-render QA", () => {
    const source = read("../app/api/meals/generate/route.ts");
    match(source, /qaRecipeForShelf\(recipe, \{ role: role\.role \}\)/);
    match(source, /qaRecipeForShelf\(raw, \{ role: role\.role \}\)/);
  });

  it("gates stored web inspirations before returning visible cards", () => {
    const source = read("../app/api/meals/inspirations/route.ts");
    match(source, /const checked = qaRecipeForShelf\(raw,/);
    match(source, /if \(!checked\.ok\) continue;/);
    match(source, /recipeToCandidate\(checked\.recipe,/);
  });

  it("preserves the weekly dismissal ledger across both regeneration paths", () => {
    const source = read("../app/meals/page.tsx");
    match(source, /notThisWeek: plan\?\.candidateSet\?\.notThisWeek \?\? databaseCandidateSet\.notThisWeek/);
    match(source, /notThisWeek: basePlan\.candidateSet\?\.notThisWeek/);
  });

  it("does not grow a current Phase 4E shelf with supplemental web cards or expose old generators", () => {
    const source = read("../app/meals/page.tsx");
    match(source, /allowLegacyWebMerge = !data\.candidateSet\.policyVersion\.startsWith\(SHELF_POLICY_VERSION\)/);
    doesNotMatch(source, />Generate from recipe book</);
    doesNotMatch(source, />Research web ideas</);
  });

  it("excludes dismissed ids from completion replacements and records safe fixes", () => {
    const source = read("./planner-runtime.ts");
    match(source, /new Set\(\[\.\.\.onShelf, \.\.\.notThisWeekIds\(plan\.candidateSet\)\]\)/);
    match(source, /result\.issues\.length \|\| result\.fixes\.length/);
    match(source, /qaDiagnostics: \(\) => diagnostics\.slice\(\)/);
  });
});
