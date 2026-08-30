import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  guidedCategories,
  guidedCategoryById,
  guidedRoutineFor,
  guidedSubmissionChallenge,
  isGuidedCategoryId,
} from "./family-guided-capture.ts";
import { CHILD_IDS } from "./family-assistant-turn.ts";

describe("guided capture categories", () => {
  it("are exactly the six approved activities, in order", () => {
    deepStrictEqual(
      guidedCategories.map((c) => c.id),
      ["kumon", "piano", "exercise", "physio", "household", "bonus"],
    );
  });

  it("each carries a child-readable label, icon and a task-specific prompt", () => {
    const prompts = new Set<string>();
    for (const category of guidedCategories) {
      ok(category.label.length > 0);
      ok(category.icon.length > 0);
      // A real question, not a generic placeholder.
      ok(category.prompt.length > 20, `${category.id} prompt too short`);
      ok(category.prompt.includes("?"), `${category.id} prompt is not a question`);
      prompts.add(category.prompt);
    }
    // Task-specific means no two categories share a prompt.
    equal(prompts.size, guidedCategories.length);
  });

  it("validates ids strictly", () => {
    equal(isGuidedCategoryId("piano"), true);
    equal(isGuidedCategoryId("Piano"), false);
    equal(isGuidedCategoryId("music"), false);
    equal(guidedCategoryById("kumon")?.label, "Kumon");
    equal(guidedCategoryById("nope"), null);
  });
});

describe("guided capture routine mapping", () => {
  it("resolves every category to a real routine for both children", () => {
    for (const child of CHILD_IDS) {
      for (const category of guidedCategories) {
        const routine = guidedRoutineFor(child, category.id);
        ok(routine, `${child}/${category.id} has no routine`);
        ok(
          routine.assignedTo.includes(child),
          `${routine.id} is not assigned to ${child}`,
        );
      }
    }
  });

  it("maps the six categories to distinct completion identities per child", () => {
    for (const child of CHILD_IDS) {
      const ids = guidedCategories.map((c) => guidedRoutineFor(child, c.id)?.id);
      equal(new Set(ids).size, guidedCategories.length, `${child} mappings collide`);
    }
  });

  it("keeps guided routines coin-earning but never target-inflating for the extras", () => {
    // Exercise and bonus are unscheduled extras: they earn one coin on
    // approval but have no weekly target, so an un-recorded day is never
    // "missing" on the board.
    for (const child of CHILD_IDS) {
      for (const categoryId of ["exercise", "bonus"] as const) {
        const routine = guidedRoutineFor(child, categoryId);
        ok(routine);
        equal(routine.weeklyTarget, null, `${routine.id} must have no weekly target`);
        equal(routine.days, null, `${routine.id} must not be day-scheduled`);
        equal(routine.points, 1);
      }
    }
  });

  it("labels the submission channel without inventing content", () => {
    const category = guidedCategoryById("piano");
    ok(category);
    equal(guidedSubmissionChallenge(category), 'Recorded with the guided "Piano" flow');
  });
});
