import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyLearnClient } from "./client";

export const metadata: Metadata = {
  title: "Lernen — Nabu",
  description: "The selected child's learning cockpit: the expedition base, the next step and saved expedition pages",
};

// The child learning cockpit (family-assistant DESIGN §7.6, screen 1). Lives
// inside the `(shell)` route group so the persistent avatar/profile switch
// owns the selected child; it is reached from the child Home like Record and
// Hörspiele rather than adding a permanent shell destination. All state comes
// from the server view under a child-scoped learning credential.
export default async function FamilyLearnPage() {
  await auth();
  return <FamilyLearnClient />;
}
