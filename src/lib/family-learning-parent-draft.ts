// ---------------------------------------------------------------------------
// Parent settings draft bound to its origin (review R4-2).
//
// The editable form text is tied to the child and the erasure generation of
// the evidence it was initialised from. When refreshed evidence carries a
// different identity — same-tab deletion, a 409 stale-write refresh, another
// tab's deletion, a child switch — the draft is reset from the fresh evidence
// instead of silently carrying old text under a new generation. A save is
// only sendable when the draft's identity still matches the evidence shown.
// Pure so it is unit-testable; the component just applies it.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import type { KeyboardLayoutId } from "./family-learning-content.ts";

export type SettingsSource = {
  child: ChildId;
  erasureGeneration: number;
  settings: {
    keyboardLayout: KeyboardLayoutId | null;
    missionTitle: string | null;
    missionHook: string | null;
    languageVarietyEn: string | null;
    languageVarietyEs: string | null;
  };
};

export type SettingsDraft = {
  /** Identity of the evidence this draft was initialised from. */
  origin: { child: ChildId; erasureGeneration: number };
  layout: string;
  title: string;
  hook: string;
  varietyEn: string;
  varietyEs: string;
  /** True once the parent typed into this draft. */
  dirty: boolean;
};

export function draftIdentity(source: Pick<SettingsSource, "child" | "erasureGeneration">): string {
  return `${source.child}:${source.erasureGeneration}`;
}

export function createSettingsDraft(source: SettingsSource): SettingsDraft {
  return {
    origin: { child: source.child, erasureGeneration: source.erasureGeneration },
    layout: source.settings.keyboardLayout ?? "",
    title: source.settings.missionTitle ?? "",
    hook: source.settings.missionHook ?? "",
    varietyEn: source.settings.languageVarietyEn ?? "",
    varietyEs: source.settings.languageVarietyEs ?? "",
    dirty: false,
  };
}

/**
 * Reconcile a draft with freshly loaded evidence. Any identity change (child
 * or erasure generation) discards the draft — even dirty text — and restarts
 * from the fresh evidence; the caller tells the parent why.
 */
export function reconcileSettingsDraft(draft: SettingsDraft, source: SettingsSource): { draft: SettingsDraft; reset: null | "child-changed" | "records-erased" } {
  if (draft.origin.child !== source.child) return { draft: createSettingsDraft(source), reset: "child-changed" };
  if (draft.origin.erasureGeneration !== source.erasureGeneration) return { draft: createSettingsDraft(source), reset: "records-erased" };
  return { draft, reset: null };
}

export function editSettingsDraft(draft: SettingsDraft, field: "layout" | "title" | "hook" | "varietyEn" | "varietyEs", value: string): SettingsDraft {
  return { ...draft, [field]: value, dirty: true };
}

/** The PUT body — only when the draft still matches the evidence on screen. */
export function settingsSaveBody(draft: SettingsDraft, source: Pick<SettingsSource, "child" | "erasureGeneration">): Record<string, unknown> | null {
  if (draftIdentity(draft.origin) !== draftIdentity(source)) return null;
  return {
    child: draft.origin.child,
    expectedErasureGeneration: draft.origin.erasureGeneration,
    keyboardLayout: draft.layout || null,
    missionTitle: draft.title || null,
    missionHook: draft.hook || null,
    languageVarietyEn: draft.varietyEn || null,
    languageVarietyEs: draft.varietyEs || null,
  };
}
