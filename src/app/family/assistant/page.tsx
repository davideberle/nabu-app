import type { Metadata } from "next";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { formatWeekId, getISOWeek } from "@/lib/meals";
import { FamilyAssistantClient } from "./client";

export const metadata: Metadata = {
  title: "Family Assistant — Nabu",
  description: "Conversational companion prototype for Santiago and Isabel",
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
