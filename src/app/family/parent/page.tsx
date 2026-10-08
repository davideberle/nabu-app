import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { formatMilestoneDate, getComputedMilestones } from "@/data/family";
import { FamilyParentClient } from "./client";

export const metadata: Metadata = {
  title: "Parent tools — Nabu",
  description: "Review the children's activity, correct and undo, configure routines, enter a day for a child, see chess status and upcoming dates",
};

/**
 * The compact parent tools (October 8, 2026; PR-01, UI-06/UI-07/UI-08/UI-11).
 * Owner session only: every other session — including a tracker-only shared
 * device and any other household account — lands in Family Home. Permission
 * is decided here from the session, never from a selected child.
 */
export default async function FamilyParentPage() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) redirect("/family/home");
  const milestones = getComputedMilestones().slice(0, 8).map((m) => ({ id: m.id, label: m.label, when: formatMilestoneDate(m.nextOccurrence), daysUntil: m.daysUntil, planning: m.planningLabel, status: m.planningStatus }));
  return <FamilyParentClient milestones={milestones} />;
}
