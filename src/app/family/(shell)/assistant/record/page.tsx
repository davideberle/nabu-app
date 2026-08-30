import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyRecordClient } from "./client";

export const metadata: Metadata = {
  title: "Record something I did — Nabu",
  description: "Guided activity capture for Santiago and Isabel",
};

// The guided "Record something I did" flow (family-assistant DESIGN.md §2.1,
// Family DESIGN.md Phase R7). Lives inside the `(shell)` route group so the
// persistent provider owns the selected child; it is reached from the child
// Home rather than adding a fourth shell destination. The `auth()` read keeps
// the route explicitly session-bound (dynamic), like the other shell pages.
export default async function FamilyRecordPage() {
  await auth();
  return <FamilyRecordClient />;
}
