import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
} from "@/components/ui/nabu";
import { categories, TRIP_ID } from "@/data/travel-san-sebastian";
import type { TravelItemStatus } from "@/data/travel-san-sebastian";
import { getTravelItemStates } from "@/lib/db";
import { TravelBoard } from "./travel-board";

export const dynamic = "force-dynamic";

export default async function SanSebastianPage() {
  const statesMap = await getTravelItemStates(TRIP_ID);
  const initialStates: Record<string, TravelItemStatus> = {};
  for (const [itemId, state] of statesMap) {
    initialStates[itemId] = state.status;
  }

  const totalItems = categories.reduce((n, c) => n + c.items.length, 0);
  const planned = Object.values(initialStates).filter((s) => s === "planned").length;
  const done = Object.values(initialStates).filter((s) => s === "done").length;

  return (
    <NabuPageShell>
      <NabuHeader
        title="San Sebastian"
        eyebrow="Travel"
        backHref="/"
        subtitle={`${totalItems} items · ${planned} planned · ${done} done`}
        maxWidth="5xl"
      />

      <NabuMain className="pb-24">
        <div className="mb-6 overflow-hidden rounded-lg border border-primary bg-primary p-4 sm:p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-quaternary">
            Summer 2026
          </p>
          <h2 className="mt-2 text-lg font-semibold text-primary sm:text-xl">
            Family trip planning board
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-tertiary">
            Browse by category, mark items as idea / planned / done. Tap the
            status icon to cycle. Weeks 1–2 kids surf until 19:00; weeks 3–4
            they finish at 15:00. Home base: Aingeru Zaindaria Bidea 45.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-md border border-secondary p-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-quaternary">
                Items
              </p>
              <p className="mt-1 text-xl font-semibold text-primary">
                {totalItems}
              </p>
            </div>
            <div className="rounded-md border border-secondary p-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-quaternary">
                Planned
              </p>
              <p className="mt-1 text-xl font-semibold text-primary">
                {planned}
              </p>
            </div>
            <div className="rounded-md border border-secondary p-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-quaternary">
                Done
              </p>
              <p className="mt-1 text-xl font-semibold text-primary">
                {done}
              </p>
            </div>
          </div>
        </div>

        <TravelBoard categories={categories} initialStates={initialStates} />
      </NabuMain>
    </NabuPageShell>
  );
}
