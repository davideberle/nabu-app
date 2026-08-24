import type { Metadata } from "next";
import { FamilyListenClient } from "./client";

export const metadata: Metadata = {
  title: "Stories — Nabu",
  description: "The selected child's Hörspiel listening library",
};

// The Listening Library (family-assistant DESIGN §7.4.2). Lives inside the
// `(shell)` route group so the persistent avatar/profile switch owns the
// selected child, but it is reached from the Assistant rather than adding a
// fourth permanent shell destination. All data comes from the tailnet bridge
// with the same child-scoped token as a conversation turn; this page renders
// and never ranks or resolves anything itself.
export default function FamilyListenPage() {
  return <FamilyListenClient />;
}
