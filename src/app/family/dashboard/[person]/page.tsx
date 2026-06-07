import type { Metadata } from "next";
import { familyMembers } from "@/data/family-routines";
import { formatWeekId, getISOWeek, getWeekDates, offsetWeek, parseWeekId } from "@/lib/meals";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { PersonBoardClient } from "./client";

type Props = {
  params: Promise<{ person: string }>;
  searchParams?: Promise<{ week?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { person: personId } = await params;
  const person = familyMembers.find((p) => p.id === personId);
  return {
    title: person
      ? `${person.displayName} — Routines — Nabu`
      : "Routines — Nabu",
  };
}

export default async function PersonBoardPage({ params, searchParams }: Props) {
  const { person: personId } = await params;
  const query = searchParams ? await searchParams : {};
  const session = await auth();
  return (
    <PersonBoardClient
      personId={personId}
      weekNav={weekNavFor(personId, query.week)}
      canManageParentControls={isAdminEmail(session?.user?.email)}
    />
  );
}

function weekNavFor(personId: string, weekParam?: string) {
  const current = getISOWeek(new Date());
  const parsed = weekParam ? parseWeekId(weekParam) : null;
  const active = parsed ?? current;
  const weekId = formatWeekId(active.year, active.week);
  const currentWeekId = formatWeekId(current.year, current.week);
  const prev = offsetWeek(active.year, active.week, -1);
  const next = offsetWeek(active.year, active.week, 1);
  const dates = getWeekDates(active.year, active.week);

  return {
    weekId,
    currentWeekId,
    rangeLabel: `${dates[0].dayOfWeek.slice(0, 3)} ${dates[0].date.slice(5)} - ${dates[6].dayOfWeek.slice(0, 3)} ${dates[6].date.slice(5)}`,
    prevHref: `/family/dashboard/${personId}?week=${formatWeekId(prev.year, prev.week)}`,
    currentHref: `/family/dashboard/${personId}?week=${currentWeekId}`,
    nextHref: `/family/dashboard/${personId}?week=${formatWeekId(next.year, next.week)}`,
    overviewHref: `/family/dashboard?week=${weekId}`,
  };
}
