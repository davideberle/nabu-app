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
function formatIsoDate(iso: string): string {
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

/**
 * The archived Aare day.
 *
 * The trip is past, so this page is a record rather than a briefing: it shows
 * the plan as it was finalized and the conditions that were on file, and it
 * claims nothing about how the day actually went, because nothing was written
 * back. Two parts of the plan are deliberately not rendered — the
 * pre-departure recheck gate (dropped from the projection once the trip was
 * archived) and `plan.safety`, which is a packing-and-launch checklist and
 * would read as a pending instruction here. Both stay useful upstream in
 * `projects/travel/`; `plan.safety` also stays in the projection so the
 * finalized plan is preserved intact.
 */
export default function AareboeoetlePage() {
  const trip = getTripById("aareboeoetle-2026-08-07");
  if (!trip?.plan || !trip.archive) {
    notFound();
  }

  const { note, schedule, anchors, decisions, conditions } = trip.plan;
  const { snapshot } = trip.archive;

  return (
    <NabuPageShell>
      <NabuHeader
        title={trip.name}
        eyebrow="Past trip"
        backHref="/travel"
        subtitle={`${trip.location} · ${trip.dateLabel}`}
        maxWidth="3xl"
      />

      <NabuMain maxWidth="3xl" className="space-y-8 pb-20">
        {/* What the day was */}
        <NabuSurface tone="accent" className="p-4 sm:p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <NabuKicker>Snapshot</NabuKicker>
            {trip.workPolicy ? (
              <NabuPill tone="stone">{trip.workPolicy}</NabuPill>
            ) : null}
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
            {snapshot}
          </p>
        </NabuSurface>

        {/* The plan of record */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Plan of record"
            title="How the day was meant to run"
            description={note}
          />
          <NabuSurface tone="default" className="px-4 py-2 sm:px-5">
            <div className="divide-y divide-secondary">
              {schedule.map((stop) => (
                <ScheduleRow key={stop.title} stop={stop} />
              ))}
            </div>
          </NabuSurface>
        </section>

        {/* Anchors — the factual river reference, useful again on a repeat */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Reference"
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

        {/* The finish, which the record never resolves */}
        {decisions && decisions.length > 0 ? (
          <section>
            <NabuSectionHeader
              className="mb-3"
              eyebrow="Never resolved"
              title="How the evening ended"
              description="The finish was left to the day itself and no outcome was recorded, so these stay options — the record does not say which one was taken."
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

        {/* Conditions as they stood — readings only, no launch gate */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="On file"
            title="Conditions before the day"
          />
          <NabuSurface tone="muted" className="p-4 sm:p-5">
            <p className="text-xs text-quaternary">
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

        {/* Provenance — restrained, and never the raw source slug */}
        {trip.source ? (
          <p className="text-xs leading-relaxed text-quaternary">
            Published {formatIsoDate(trip.source.publishedOn)} from a finalized
            plan
            {trip.source.archivedOn
              ? `, archived ${formatIsoDate(trip.source.archivedOn)}`
              : ""}
            . Booking records stay with{" "}
            {trip.source.factOwners.map((owner) => owner.system).join(" and ")}{" "}
            — nothing here restates them.
          </p>
        ) : null}
      </NabuMain>
    </NabuPageShell>
  );
}
