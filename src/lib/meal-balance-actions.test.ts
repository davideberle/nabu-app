// Unit tests for the /cooking meal-balance mapping.
//
// This is the logic behind the "Apply tonight" button: which findings surface,
// whether an adjustment can be expressed against the session in front of the
// cook, and the exact patch it becomes. It used to live inside the React
// component, where none of it was covered.
//
// Two properties matter most, and both are asserted directly:
//   - a component-status patch changes only the named component and preserves
//     every other one verbatim;
//   - anything unsupported produces no patch at all, so the UI cannot offer a
//     button that would write the wrong thing.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_FINDINGS,
  MAX_SUGGESTIONS,
  buildSessionPatch,
  canApplySuggestion,
  suggestionKey,
  topFindings,
  topSuggestions,
} from "./meal-balance-actions.ts";
import type {
  CoherenceFinding,
  CoherenceSuggestion,
  MealCoherenceReview,
} from "./meal-coherence.ts";
import type { RelatedRecipe } from "./cooking-session.ts";

const STAMP = { now: "2026-08-02T18:30:00.000Z", token: "abc123" };

const COMPONENTS: RelatedRecipe[] = [
  { kind: "side", recipeId: "cg-cucumber-raita", title: "Cucumber raita" },
  { kind: "side", recipeId: "flatbreads", title: "Flatbreads", status: "optional" },
  { kind: "dessert", recipeId: "rhubarb-tart", title: "Rhubarb tart" },
];

function finding(
  severity: CoherenceFinding["severity"],
  summary: string,
  kind: CoherenceFinding["kind"] = "seasoning-lane-repeat",
): CoherenceFinding {
  return { kind, severity, summary, componentIds: [] };
}

function review(overrides: Partial<MealCoherenceReview> = {}): MealCoherenceReview {
  return {
    findings: [],
    suggestions: [],
    laneOwners: [],
    ...overrides,
  } as MealCoherenceReview;
}

const componentStatusSuggestion: CoherenceSuggestion = {
  kind: "make-optional",
  componentId: "cg-cucumber-raita",
  componentTitle: "Cucumber raita",
  summary: "Set the raita aside tonight — the meal already has a cool dairy lane.",
  adjustment: { target: "component-status", componentId: "cg-cucumber-raita", status: "optional" },
};

const seasoningSuggestion: CoherenceSuggestion = {
  kind: "reseason",
  componentId: "rhubarb-tart",
  componentTitle: "Rhubarb tart",
  summary: "Swap the cardamom in the tart for vanilla so it does not echo the main.",
  adjustment: { target: "seasoning", componentId: "rhubarb-tart", replace: "cardamom", with: "vanilla" },
};

const sessionNoteSuggestion: CoherenceSuggestion = {
  kind: "add-contrast",
  componentId: null,
  componentTitle: null,
  summary: "Nothing sharp on the plate — add a squeeze of lemon at the table.",
  adjustment: { target: "session-note", text: "Add a squeeze of lemon at the table." },
};

describe("topFindings", () => {
  it("shows the most serious findings first, capped", () => {
    const result = topFindings(
      review({
        findings: [
          finding("info", "info one"),
          finding("major", "major one"),
          finding("minor", "minor one"),
          finding("major", "major two"),
        ],
      }),
    );
    equal(result.length, MAX_FINDINGS);
    deepStrictEqual(
      result.map((f) => f.summary),
      ["major one", "major two"],
    );
  });

  it("keeps equal-severity findings in the analyzer's order, so a re-read is stable", () => {
    const findings = [finding("minor", "a"), finding("minor", "b"), finding("minor", "c")];
    deepStrictEqual(
      topFindings(review({ findings })).map((f) => f.summary),
      ["a", "b"],
    );
    // Re-reviewing the same meal must not shuffle what the cook is reading.
    deepStrictEqual(
      topFindings(review({ findings })).map((f) => f.summary),
      topFindings(review({ findings })).map((f) => f.summary),
    );
  });

  it("does not mutate the review it was given", () => {
    const findings = [finding("info", "a"), finding("major", "b")];
    const source = review({ findings });
    topFindings(source);
    deepStrictEqual(
      source.findings.map((f) => f.summary),
      ["a", "b"],
    );
  });

  it("returns nothing for a coherent meal", () => {
    deepStrictEqual(topFindings(review()), []);
  });
});

describe("topSuggestions", () => {
  it("caps the offered suggestions in the analyzer's order", () => {
    const suggestions = [
      componentStatusSuggestion,
      seasoningSuggestion,
      sessionNoteSuggestion,
      { ...sessionNoteSuggestion, summary: "fourth" },
    ];
    const result = topSuggestions(review({ suggestions }));
    equal(result.length, MAX_SUGGESTIONS);
    equal(result[2].summary, sessionNoteSuggestion.summary);
  });
});

describe("suggestionKey", () => {
  it("is stable and distinguishes positions", () => {
    equal(suggestionKey(componentStatusSuggestion, 0), suggestionKey(componentStatusSuggestion, 0));
    ok(suggestionKey(componentStatusSuggestion, 0) !== suggestionKey(componentStatusSuggestion, 1));
    ok(suggestionKey(componentStatusSuggestion, 0) !== suggestionKey(seasoningSuggestion, 0));
  });
});

describe("canApplySuggestion", () => {
  it("accepts a component-status change for a listed component", () => {
    equal(canApplySuggestion(componentStatusSuggestion, COMPONENTS), true);
  });

  it("refuses a component-status change for a component the session does not list", () => {
    const unknown: CoherenceSuggestion = {
      ...componentStatusSuggestion,
      adjustment: { target: "component-status", componentId: "not-in-this-meal", status: "omitted" },
    };
    equal(canApplySuggestion(unknown, COMPONENTS), false);
    equal(canApplySuggestion(componentStatusSuggestion, []), false);
  });

  it("accepts seasoning and session-note adjustments regardless of components", () => {
    equal(canApplySuggestion(seasoningSuggestion, []), true);
    equal(canApplySuggestion(sessionNoteSuggestion, []), true);
  });

  it("refuses an unsupported or absent adjustment", () => {
    equal(
      canApplySuggestion(
        { ...sessionNoteSuggestion, adjustment: { target: "recipe-edit" } } as unknown as CoherenceSuggestion,
        COMPONENTS,
      ),
      false,
    );
    equal(canApplySuggestion({} as CoherenceSuggestion, COMPONENTS), false);
  });
});

describe("buildSessionPatch — component status", () => {
  it("changes only the named component and preserves the others verbatim", () => {
    const patch = buildSessionPatch(componentStatusSuggestion, COMPONENTS, STAMP);
    ok(patch);
    deepStrictEqual(patch!.relatedRecipes, [
      { kind: "side", recipeId: "cg-cucumber-raita", title: "Cucumber raita", status: "optional" },
      { kind: "side", recipeId: "flatbreads", title: "Flatbreads", status: "optional" },
      { kind: "dessert", recipeId: "rhubarb-tart", title: "Rhubarb tart" },
    ]);
  });

  it("touches nothing but relatedRecipes", () => {
    const patch = buildSessionPatch(componentStatusSuggestion, COMPONENTS, STAMP)!;
    deepStrictEqual(Object.keys(patch), ["relatedRecipes"]);
  });

  it("does not mutate the components it was given", () => {
    const components = COMPONENTS.map((c) => ({ ...c }));
    buildSessionPatch(componentStatusSuggestion, components, STAMP);
    equal(components[0].status, undefined);
  });

  it("produces no patch for an unknown component", () => {
    const unknown: CoherenceSuggestion = {
      ...componentStatusSuggestion,
      adjustment: { target: "component-status", componentId: "not-in-this-meal", status: "omitted" },
    };
    equal(buildSessionPatch(unknown, COMPONENTS, STAMP), null);
  });
});

describe("buildSessionPatch — seasoning", () => {
  it("records a session adaptation and echoes it into the notes", () => {
    const patch = buildSessionPatch(seasoningSuggestion, COMPONENTS, STAMP);
    ok(patch);
    deepStrictEqual(patch!.adaptations, [
      {
        id: "coherence-rhubarb-tart-abc123",
        kind: "ingredient-substitution",
        summary: seasoningSuggestion.summary,
        messageSource: "app",
        createdAt: STAMP.now,
      },
    ]);
    equal(patch!.appendNotes, seasoningSuggestion.summary);
  });

  it("never carries a relatedRecipes or recipe-shaped change", () => {
    const patch = buildSessionPatch(seasoningSuggestion, COMPONENTS, STAMP)!;
    deepStrictEqual(Object.keys(patch).sort(), ["adaptations", "appendNotes"]);
  });

  it("is deterministic for the same stamp", () => {
    deepStrictEqual(
      buildSessionPatch(seasoningSuggestion, COMPONENTS, STAMP),
      buildSessionPatch(seasoningSuggestion, COMPONENTS, STAMP),
    );
  });

  it("produces no patch when the summary is empty", () => {
    equal(buildSessionPatch({ ...seasoningSuggestion, summary: "  " }, COMPONENTS, STAMP), null);
  });
});

describe("buildSessionPatch — session note", () => {
  it("appends the adjustment text", () => {
    const patch = buildSessionPatch(sessionNoteSuggestion, COMPONENTS, STAMP);
    deepStrictEqual(patch, { appendNotes: "Add a squeeze of lemon at the table." });
  });

  it("produces no patch for empty note text", () => {
    equal(
      buildSessionPatch(
        { ...sessionNoteSuggestion, adjustment: { target: "session-note", text: "   " } },
        COMPONENTS,
        STAMP,
      ),
      null,
    );
  });
});

describe("buildSessionPatch — fail closed", () => {
  it("produces no patch for an adjustment target it does not understand", () => {
    for (const adjustment of [
      { target: "recipe-edit", recipeId: "x" },
      { target: "" },
      {},
      null,
      undefined,
      "seasoning",
    ]) {
      equal(
        buildSessionPatch(
          { ...sessionNoteSuggestion, adjustment } as unknown as CoherenceSuggestion,
          COMPONENTS,
          STAMP,
        ),
        null,
        `adjustment=${JSON.stringify(adjustment)}`,
      );
    }
  });

  it("produces no patch for a malformed suggestion", () => {
    equal(buildSessionPatch({} as CoherenceSuggestion, COMPONENTS, STAMP), null);
  });

  it("never emits a patch key outside the session-state set", () => {
    // The DESIGN boundary, stated as an assertion: nothing here may reach a
    // canonical recipe. Only these session fields are ever written.
    const allowed = new Set(["relatedRecipes", "adaptations", "appendNotes"]);
    for (const suggestion of [componentStatusSuggestion, seasoningSuggestion, sessionNoteSuggestion]) {
      const patch = buildSessionPatch(suggestion, COMPONENTS, STAMP);
      ok(patch);
      for (const key of Object.keys(patch!)) {
        ok(allowed.has(key), `unexpected patch key ${key}`);
      }
    }
  });
});
