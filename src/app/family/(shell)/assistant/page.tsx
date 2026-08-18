import type { Metadata } from "next";
import { auth } from "@/auth";
import {
  FAMILY_ASSISTANT_APPLE_ICON,
  FAMILY_ASSISTANT_MANIFEST_PATH,
} from "@/lib/family-assistant-manifest";
import { formatWeekId, getISOWeek } from "@/lib/meals";
import { FamilyAssistantClient } from "./client";

export const metadata: Metadata = {
  title: "Family Assistant — Nabu",
  description: "Conversational companion for Santiago and Isabel",
  // This route installs as its own iPad Home Screen app. The page-level
  // manifest/appleWebApp/icons override the root layout's Family Board values
  // for this route only; the global /manifest.json is untouched.
  manifest: FAMILY_ASSISTANT_MANIFEST_PATH,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Assistant",
  },
  icons: {
    apple: FAMILY_ASSISTANT_APPLE_ICON,
  },
};

// The selected child and the tracker-only capability both come from the
// persistent `(shell)` layout, whose provider validates the URL `?child=`
// with `normalizeChildId`; this page only resolves the current week. The
// `auth()` read keeps the route explicitly session-bound (dynamic) exactly
// as before.
export default async function FamilyAssistantPage() {
  await auth();
  const current = getISOWeek(new Date());
  return (
    <FamilyAssistantClient weekId={formatWeekId(current.year, current.week)} />
  );
}
