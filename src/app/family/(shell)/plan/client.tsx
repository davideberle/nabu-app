"use client";

// ---------------------------------------------------------------------------
// Plan — the child shell's weekly-board destination.
//
// This is deliberately a thin wrapper: the board itself is the real
// `PersonBoardClient` from `/family/dashboard/[person]`, driven by the same
// family APIs and model. The shell only decides *which child* is projected
// and keeps every week-navigation href inside `/family/plan`.
//
// The shell chrome (avatar, tabs, switcher) and the selected child live in
// the persistent `(shell)` layout provider, so navigating here never
// remounts them. Atomic switching: the board is keyed by the selected child,
// so a switch unmounts the previous child's board (dropping its modals and
// in-flight UI state) and mounts a fresh one that loads through the normal
// API path. There is no intermediate render mixing two children.
// ---------------------------------------------------------------------------

import { PersonBoardClient } from "../../dashboard/[person]/client";
import { useChildShell } from "@/components/family/child-shell-provider";
import { buildPlanWeekNav, type ChildShellWeekInfo } from "@/lib/family-child-shell";

export function FamilyPlanClient({
  weekInfo,
  canManageParentControls,
}: {
  weekInfo: ChildShellWeekInfo;
  canManageParentControls: boolean;
}) {
  const { child } = useChildShell();
  if (!child) return null;
  return (
    <PersonBoardClient
      key={child}
      personId={child}
      weekNav={buildPlanWeekNav(weekInfo, child)}
      canManageParentControls={canManageParentControls}
    />
  );
}
