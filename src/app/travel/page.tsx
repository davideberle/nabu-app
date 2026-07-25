import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuCard,
  NabuSectionHeader,
  NabuEmptyState,
  NabuIconFrame,
  NabuPill,
} from "@/components/ui/nabu";
import { getUpcomingTrips, getPastTrips, type Trip } from "@/data/travel";

export const metadata = {
  title: "Travel",
};

function TripCard({ trip }: { trip: Trip }) {
  return (
    <NabuCard href={trip.href}>
      <div className="flex min-w-0 items-start gap-3">
        <NabuIconFrame className="bg-stone-100 transition-colors group-hover:bg-stone-200 dark:bg-stone-800 dark:group-hover:bg-stone-700">
          {trip.emoji}
        </NabuIconFrame>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold tracking-[-0.01em] text-primary">
              {trip.name}
            </h3>
            <NabuPill tone={trip.status === "past" ? "stone" : "green"} className="shrink-0">
              {trip.status === "past" ? "Past" : "Upcoming"}
            </NabuPill>
          </div>
          <p className="mt-0.5 text-xs text-quaternary">
            {trip.location} · {trip.dateLabel}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-tertiary">
            {trip.summary}
          </p>
        </div>
      </div>
    </NabuCard>
  );
}

export default function TravelPage() {
  const upcoming = getUpcomingTrips();
  const past = getPastTrips();

  return (
    <NabuPageShell>
      <NabuHeader
        title="Travel"
        eyebrow="Trips"
        backHref="/"
        subtitle="Upcoming and past trips"
        maxWidth="3xl"
      />

      <NabuMain maxWidth="3xl" className="space-y-8 pb-20">
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Upcoming"
            title="Next trips"
          />
          {upcoming.length > 0 ? (
            <div className="space-y-3">
              {upcoming.map((trip) => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </div>
          ) : (
            <NabuEmptyState
              icon="🧭"
              title="No upcoming trips yet"
              description="When the next trip is booked, it will appear here — ready to grow into a planning board with dates, food, hikes, and excursions."
            />
          )}
        </section>

        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Past"
            title="Trip archive"
          />
          <div className="space-y-3">
            {past.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      </NabuMain>
    </NabuPageShell>
  );
}
