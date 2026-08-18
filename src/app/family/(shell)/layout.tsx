import type { ReactNode } from "react";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { ChildShellLayoutClient } from "@/components/family/child-shell-provider";

// The persistent child-shell layout. Everything inside the `(shell)` route
// group — Assistant, Plan, Rewards — renders under one long-lived client
// provider, so the top-corner avatar, the destination tabs and the selected
// child identity survive navigation instead of remounting per page.
// `/family/rewards/chess` deliberately lives outside the group: the game is a
// full-screen surface with its own minimal header.
export default async function FamilyChildShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  return (
    <ChildShellLayoutClient trackerOnly={isTrackerOnlyEmail(session?.user?.email)}>
      {children}
    </ChildShellLayoutClient>
  );
}
