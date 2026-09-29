import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { evaluateParentLearningAccess } from "@/lib/access";
import { FamilyLearnParentClient } from "./client";

export const metadata: Metadata = {
  title: "Lern-Evidenz — Nabu",
  description: "Parent evidence cockpit for the learning expedition",
};

// The parent evidence cockpit (family-assistant DESIGN §7.6, screen 3). Lives
// outside the child `(shell)` group on purpose: it is an adult surface with
// its own header. Access is the exact owner session (account rule of
// 2026-09-29), decided by the same `evaluateParentLearningAccess` every parent
// API uses (`lib/family-learning-auth.ts`); middleware already redirects the
// tracker-only assistant account before this runs. Anything else is sent to
// the family dashboard (or to login when there is no session at all).
export default async function FamilyLearnParentPage() {
  const session = await auth();
  const decision = evaluateParentLearningAccess(session);
  if (!decision.allowed) redirect(decision.status === 401 ? "/login" : "/family/dashboard");
  return <FamilyLearnParentClient />;
}
