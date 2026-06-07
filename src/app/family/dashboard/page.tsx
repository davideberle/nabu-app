import type { Metadata } from "next";
import { formatWeekId, getISOWeek, getWeekDates, offsetWeek, parseWeekId } from "@/lib/meals";
import { FamilyDashboardClient } from "./client";

export const metadata: Metadata = {
  title: "Family Routines — Nabu",
  description: "iPad family routines dashboard",
};

type Props = { searchParams?: Promise<{ week?: string }> };

function weekNavFor(weekParam?: string) {
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
    prevHref: `/family/dashboard?week=${formatWeekId(prev.year, prev.week)}`,
    currentHref: `/family/dashboard?week=${currentWeekId}`,
    nextHref: `/family/dashboard?week=${formatWeekId(next.year, next.week)}`,
  };
}

export default async function FamilyDashboardPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  return <FamilyDashboardClient weekNav={weekNavFor(params.week)} />;
}
