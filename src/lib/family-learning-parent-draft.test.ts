// Parent settings draft identity (review R4-2): refreshed evidence with a
// different child or erasure generation resets the draft; a save body is only
// produced while the draft still matches the evidence shown. Run with: npm test

import { deepStrictEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { createSettingsDraft, editSettingsDraft, reconcileSettingsDraft, settingsSaveBody, type SettingsSource } from "./family-learning-parent-draft.ts";

const blank = { keyboardLayout: null, missionTitle: null, missionHook: null, languageVarietyEn: null, languageVarietyEs: null };
const withHook: SettingsSource = { child: "santiago", erasureGeneration: 1, settings: { ...blank, missionHook: "PRIVATE HOOK" } };

describe("settings draft binding", () => {
  it("same-tab deletion: refreshed blank evidence with a new generation resets the draft, even when dirty", () => {
    const draft = editSettingsDraft(createSettingsDraft(withHook), "title", "typed meanwhile");
    const refreshed: SettingsSource = { child: "santiago", erasureGeneration: 2, settings: blank };
    const result = reconcileSettingsDraft(draft, refreshed);
    equal(result.reset, "records-erased");
    equal(result.draft.hook, "");
    equal(result.draft.title, "");
    equal(result.draft.dirty, false);
    // The old draft cannot be saved against the new evidence either.
    equal(settingsSaveBody(draft, refreshed), null);
    // A deliberate fresh entry after the reset saves against the new generation.
    const fresh = editSettingsDraft(result.draft, "hook", "Neuer Satz");
    deepStrictEqual(settingsSaveBody(fresh, refreshed), { child: "santiago", expectedErasureGeneration: 2, keyboardLayout: null, missionTitle: null, missionHook: "Neuer Satz", languageVarietyEn: null, languageVarietyEs: null });
  });

  it("stale-write refresh (409): reloading after the refusal resets to the erased state", () => {
    const draft = createSettingsDraft({ child: "santiago", erasureGeneration: 0, settings: { ...blank, missionHook: "OLD" } });
    const afterReload: SettingsSource = { child: "santiago", erasureGeneration: 1, settings: blank };
    equal(settingsSaveBody(draft, afterReload), null);
    equal(reconcileSettingsDraft(draft, afterReload).reset, "records-erased");
  });

  it("other-tab deletion: the same generation on screen keeps the draft; a bumped one resets it", () => {
    const draft = editSettingsDraft(createSettingsDraft(withHook), "hook", "edited");
    equal(reconcileSettingsDraft(draft, withHook).reset, null);
    equal(reconcileSettingsDraft(draft, { ...withHook, erasureGeneration: 2, settings: blank }).reset, "records-erased");
  });

  it("child change resets the draft and refuses a save across children", () => {
    const draft = editSettingsDraft(createSettingsDraft(withHook), "hook", "edited");
    const isabel: SettingsSource = { child: "isabel", erasureGeneration: 1, settings: blank };
    equal(reconcileSettingsDraft(draft, isabel).reset, "child-changed");
    equal(settingsSaveBody(draft, isabel), null);
  });

  it("an unchanged draft saves against its own generation", () => {
    const draft = createSettingsDraft(withHook);
    deepStrictEqual(settingsSaveBody(draft, withHook)?.expectedErasureGeneration, 1);
  });
});
