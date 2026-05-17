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

  return (
    <NabuPageShell>
      <NabuHeader
        title="Wine Cellar"
        backHref="/"
        subtitle={`${available.length} in stock`}
      />

      <NabuMain>
        <NabuSectionHeader
          className="mb-4"
          eyebrow="Home stock"
          title="Known bottles"
          description="Tap 'We're out' when a bottle is finished."
        />

        <div className="space-y-5">
          {available.map((bottle) => (
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
            <div className="space-y-5">
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
