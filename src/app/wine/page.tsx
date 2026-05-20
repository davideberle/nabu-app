import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSectionHeader,
} from "@/components/ui/nabu";
import { wineBottles } from "@/data/wine-cellar";
import { getWineCellarStatuses } from "@/lib/db";
import { WineBottleCard } from "./wine-bottle-card";

export const dynamic = "force-dynamic";

export default async function WinePage() {
  const statuses = await getWineCellarStatuses();
  const bottles = wineBottles.map((b) => ({
    ...b,
    status: (statuses.get(b.id)?.status ?? "available") as "available" | "out",
  }));

  const available = bottles.filter((b) => b.status === "available");
  const out = bottles.filter((b) => b.status === "out");
  const reds = available.filter((b) => b.color === "red");
  const whites = available.filter((b) => b.color === "white");
  const roses = available.filter((b) => b.color === "rosé");
  const availableSections = [
    {
      key: "red",
      eyebrow: "Reds",
      title: "Red bottles",
      summary: "Bigger food, tomato, grill and slow-cooked dinners.",
      bottles: reds,
    },
    {
      key: "white",
      eyebrow: "Whites",
      title: "White bottles",
      summary: "Fresh, herbal and food-flexible bottles for lighter plates.",
      bottles: whites,
    },
    {
      key: "rose",
      eyebrow: "Rosé",
      title: "Rosé bottles",
      summary: "Chilled bottles for salads, vegetables and casual food.",
      bottles: roses,
    },
  ].filter((section) => section.bottles.length > 0);

  return (
    <NabuPageShell>
      <NabuHeader
        title="Wine Cellar"
        backHref="/"
        subtitle={`${available.length} in stock · ${out.length} consumed`}
        maxWidth="6xl"
      />

      <NabuMain maxWidth="6xl" className="pb-24">
        <section className="mb-8 overflow-hidden rounded-lg border border-primary bg-primary">
          <div className="grid min-w-0 gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-quaternary">
                Home stock
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-primary sm:text-3xl">
                {bottles.length} bottles tracked, {available.length} ready to open
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-tertiary">
                Reds and whites are now imported into the cellar. Unknown vintages
                are shown plainly when David's bottle photo did not expose the year.
              </p>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              <div className="rounded-md border border-secondary p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
                  Ready
                </p>
                <p className="mt-2 text-2xl font-semibold text-primary">
                  {available.length}
                </p>
              </div>
              <div className="rounded-md border border-secondary p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
                  Reds
                </p>
                <p className="mt-2 text-2xl font-semibold text-primary">
                  {reds.length}
                </p>
              </div>
              <div className="rounded-md border border-secondary p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
                  Whites
                </p>
                <p className="mt-2 text-2xl font-semibold text-primary">
                  {whites.length}
                </p>
              </div>
              <div className="rounded-md border border-secondary p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
                  Out
                </p>
                <p className="mt-2 text-2xl font-semibold text-primary">
                  {out.length}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="space-y-8">
          {availableSections.map((section) => (
            <section key={section.key}>
              <NabuSectionHeader
                className="mb-4"
                eyebrow={section.eyebrow}
                title={section.title}
                description={section.summary}
              />
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                {section.bottles.map((bottle) => (
                  <WineBottleCard key={bottle.id} bottle={bottle} />
                ))}
              </div>
            </section>
          ))}
        </div>

        {out.length > 0 && (
          <section>
            <NabuSectionHeader
              className="mb-4 mt-8"
              eyebrow="Consumed"
              title="We're out"
              description="Bottles already marked as consumed stay here for cellar memory."
            />
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {out.map((bottle) => (
                <WineBottleCard key={bottle.id} bottle={bottle} />
              ))}
            </div>
          </section>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
