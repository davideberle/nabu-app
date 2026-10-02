import { notFound } from "next/navigation";
import { NabuPageShell, NabuHeader, NabuMain } from "@/components/ui/nabu";
import { getTripById } from "@/data/travel";
import { TripGuide } from "./trip-guide";

export const metadata = { title: "Alpnach" };

export default function AlpnachPage() {
  const trip = getTripById("alpnach-2026");
  if (!trip) notFound();

  return (
    <NabuPageShell>
      <NabuHeader title={trip.name} eyebrow="Upcoming trip" backHref="/travel"
        subtitle={`${trip.location} · ${trip.dateLabel}`} maxWidth="5xl" />
      <NabuMain maxWidth="5xl" className="pb-20">
        <p className="mb-4 text-sm text-tertiary">
          <a href="/travel/alpnach-2026/guide" className="underline underline-offset-4">Open guide full screen</a>
        </p>
        <TripGuide />
      </NabuMain>
    </NabuPageShell>
  );
}
