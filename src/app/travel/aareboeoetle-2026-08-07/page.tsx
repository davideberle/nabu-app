import { notFound } from "next/navigation";
import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSurface,
  NabuSectionHeader,
  NabuKicker,
  NabuPill,
} from "@/components/ui/nabu";
import {
  getTripById,
  type TripHighlight,
  type TripPlanStop,
} from "@/data/travel";

export const metadata = {
  title: "Aareböötle — Uttigen to Bern",
};

/** Render a date-only ISO string without letting the server's zone shift it. */
function formatPublishedOn(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ScheduleRow({ stop }: { stop: TripPlanStop }) {
  return (
    <div className="min-w-0 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="shrink-0 text-xs font-semibold tabular-nums text-utility-orange-600">
          {stop.time}
        </span>
        <h3 className="min-w-0 text-sm font-semibold tracking-[-0.01em] text-primary">
          {stop.title}
        </h3>
      </div>
      <p className="mt-0.5 text-sm leading-relaxed text-tertiary">
        {stop.detail}
      </p>
    </div>
  );
}

function HighlightRow({ highlight }: { highlight: TripHighlight }) {
  return (
    <div className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-utility-orange-400"
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold tracking-[-0.01em] text-primary">
          {highlight.title}
        </h3>
        <p className="mt-0.5 text-sm leading-relaxed text-tertiary">
          {highlight.detail}
        </p>
      </div>
    </div>
  );
}

export default function AareboeoetlePage() {
  const trip = getTripById("aareboeoetle-2026-08-07");
  if (!trip?.plan) {
    notFound();
  }

  const { note, schedule, anchors, decisions, conditions, safety } = trip.plan;

  return (
    <NabuPageShell>
      <NabuHeader
        title={trip.name}
        eyebrow="Upcoming trip"
        backHref="/travel"
        subtitle={`${trip.location} · ${trip.dateLabel}`}
        maxWidth="3xl"
      />

      <NabuMain maxWidth="3xl" className="space-y-8 pb-20">
        {/* The finalized note */}
        <NabuSurface tone="accent" className="p-4 sm:p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <NabuKicker>The day</NabuKicker>
            {trip.workPolicy ? (
              <NabuPill tone="green">{trip.workPolicy}</NabuPill>
            ) : null}
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
            {note}
          </p>
        </NabuSurface>

        {/* Before leaving — the recheck gate */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Before leaving"
            title="Friday-morning recheck"
          />
          <NabuSurface tone="muted" className="p-4 sm:p-5">
            <p className="max-w-2xl text-sm leading-relaxed text-secondary">
              {conditions.gate}
            </p>
            <p className="mt-4 text-xs text-quaternary">
              Checked {conditions.checkedAt}
            </p>
            <ul className="mt-1.5 space-y-1">
              {conditions.readings.map((reading) => (
                <li
                  key={reading}
                  className="text-xs leading-relaxed text-tertiary"
                >
                  {reading}
                </li>
              ))}
            </ul>
          </NabuSurface>
        </section>

        {/* Plan */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Plan"
            title="How the day runs"
          />
          <NabuSurface tone="default" className="px-4 py-2 sm:px-5">
            <div className="divide-y divide-secondary">
              {schedule.map((stop) => (
                <ScheduleRow key={stop.title} stop={stop} />
              ))}
            </div>
          </NabuSurface>
        </section>

        {/* Anchors */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Confirmed"
            title="Anchors on the river"
          />
          <NabuSurface tone="default" className="px-4 py-2 sm:px-5">
            <div className="divide-y divide-secondary">
              {anchors.map((anchor) => (
                <HighlightRow key={anchor.title} highlight={anchor} />
              ))}
            </div>
          </NabuSurface>
        </section>

        {/* Bern finish */}
        {decisions && decisions.length > 0 ? (
          <section>
            <NabuSectionHeader
              className="mb-3"
              eyebrow="Open on the day"
              title="Finishing in Bern"
            />
            <NabuSurface tone="muted" className="px-4 py-2 sm:px-5">
              <div className="divide-y divide-secondary">
                {decisions.map((decision) => (
                  <HighlightRow key={decision.title} highlight={decision} />
                ))}
              </div>
            </NabuSurface>
          </section>
        ) : null}

        {/* Safety */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Non-negotiable"
            title="On the water"
          />
          <NabuSurface tone="default" className="p-4 sm:p-5">
            <ul className="space-y-2">
              {safety.map((item) => (
                <li key={item} className="flex min-w-0 gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-utility-orange-400"
                  />
                  <span className="min-w-0 flex-1 text-sm leading-relaxed text-secondary">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </NabuSurface>
        </section>

        {/* Provenance — restrained, and never the raw source slug */}
        {trip.source ? (
          <p className="text-xs leading-relaxed text-quaternary">
            Published {formatPublishedOn(trip.source.publishedOn)} from a
            finalized plan. Booking records stay with{" "}
            {trip.source.factOwners.map((owner) => owner.system).join(" and ")}{" "}
            — nothing here restates them.
          </p>
        ) : null}
      </NabuMain>
    </NabuPageShell>
  );
}
