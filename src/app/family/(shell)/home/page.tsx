import type { Metadata } from "next";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { FamilyHomeClient } from "./client";

export const metadata: Metadata = {
  title: "Family Home — Nabu",
  description: "Choose your profile, then your Home: wallet, learning, Ask Nabu, games, music and stories",
};

// The unified Family Home (family-assistant DESIGN §7.5, accepted 2026-10-04).
// A bare visit always shows the profile chooser (the shell provider owns
// that); `?child=` opens that child's Home after ordinary household
// authentication. Selection is UI context, never a permission grant.
export default async function FamilyHomePage() {
  const session = await auth();
  return <FamilyHomeClient canSeeFamilyOverview={!isTrackerOnlyEmail(session?.user?.email)} />;
}
