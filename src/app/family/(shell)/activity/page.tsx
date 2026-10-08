import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyActivityClient } from "./client";

export const metadata: Metadata = {
  title: "Activity — Nabu",
  description: "What happened when: recorded, reviewed and redeemed, with the coins each one changed",
};

// Activity (FH-08, UI-04): the chronological, dated history — the child's one
// view of what they did. The weekly routine grid is retired.
export default async function FamilyActivityPage() {
  await auth();
  return <FamilyActivityClient />;
}
