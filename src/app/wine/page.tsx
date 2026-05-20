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

  return (
    <NabuPageShell>
      <NabuHeader
        title="Wine Cellar"
        backHref="/"
        subtitle={`${available.length} in stock · ${out.length} consumed`}
        maxWidth="6xl"
      />

      <NabuMain maxWidth="6xl" className="pb-24">
        <section className="mb-6 grid min-w-0 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-primary bg-primary p-4 shadow-sm dark:shadow-none">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-quaternary">
              Ready
            </p>
            <p className="mt-2 text-2xl font-semibold text-primary">
              {available.length}
            </p>
            <p className="mt-1 text-sm text-tertiary">available bottles</p>
          </div>
          <div className="rounded-2xl border border-primary bg-primary p-4 shadow-sm dark:shadow-none">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-quaternary">
              Reds
            </p>
            <p className="mt-2 text-2xl font-semibold text-primary">
              {reds.length}
            </p>
            <p className="mt-1 text-sm text-tertiary">imported and photographed</p>
          </div>
          <div className="rounded-2xl border border-primary bg-primary p-4 shadow-sm dark:shadow-none">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-quaternary">
              Whites
            </p>
            <p className="mt-2 text-2xl font-semibold text-primary">
              {whites.length}
            </p>
            <p className="mt-1 text-sm text-tertiary">pending identification</p>
          </div>
        </section>

        <NabuSectionHeader
          className="mb-4"
          eyebrow="Home stock"
          title="Available bottles"
        />

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {reds.map((bottle) => (
            <WineBottleCard key={bottle.id} bottle={bottle} />
          ))}
          {roses.map((bottle) => (
            <WineBottleCard key={bottle.id} bottle={bottle} />
          ))}
          {whites.map((bottle) => (
            <WineBottleCard key={bottle.id} bottle={bottle} />
          ))}
        </div>

        {out.length > 0 && (
          <>
            <NabuSectionHeader
              className="mb-4 mt-8"
              eyebrow="Consumed"
              title="We're out"
            />
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {out.map((bottle) => (
                <WineBottleCard key={bottle.id} bottle={bottle} />
              ))}
            </div>
          </>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
