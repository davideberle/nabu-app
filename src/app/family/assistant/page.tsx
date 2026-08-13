import type { Metadata } from "next";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
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

type Props = { searchParams?: Promise<{ child?: string }> };

export default async function FamilyAssistantPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const session = await auth();
  const current = getISOWeek(new Date());
  const initialChild =
    params.child === "santiago" || params.child === "isabel" ? params.child : null;
  return (
    <FamilyAssistantClient
      weekId={formatWeekId(current.year, current.week)}
      initialChild={initialChild}
      trackerOnly={isTrackerOnlyEmail(session?.user?.email)}
    />
  );
}
