import { notFound } from "next/navigation";
import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSurface,
  NabuSectionHeader,
  NabuKicker,
} from "@/components/ui/nabu";
import { getTripById, type TripHighlight } from "@/data/travel";

export const metadata = {
  title: "San Sebastian",
};

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

export default function SanSebastianPage() {
  const trip = getTripById("san-sebastian");
  if (!trip?.archive) {
    notFound();
  }

  const { snapshot, highlights, leftOpen } = trip.archive;

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
        {/* Snapshot */}
        <NabuSurface tone="accent" className="p-4 sm:p-5">
          <NabuKicker>Snapshot</NabuKicker>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
            {snapshot}
          </p>
        </NabuSurface>

        {/* Highlights */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Highlights"
            title="What stood out"
          />
          <NabuSurface tone="default" className="px-4 py-2 sm:px-5">
            <div className="divide-y divide-secondary">
              {highlights.map((highlight) => (
                <HighlightRow key={highlight.title} highlight={highlight} />
              ))}
            </div>
          </NabuSurface>
        </section>

        {/* Left open */}
        {leftOpen.length > 0 ? (
          <section>
            <NabuSectionHeader
              className="mb-3"
              eyebrow="Left open"
              title="For a return trip"
            />
            <NabuSurface tone="muted" className="px-4 py-2 sm:px-5">
              <div className="divide-y divide-secondary">
                {leftOpen.map((highlight) => (
                  <HighlightRow key={highlight.title} highlight={highlight} />
                ))}
              </div>
            </NabuSurface>
          </section>
        ) : null}
      </NabuMain>
    </NabuPageShell>
  );
}
