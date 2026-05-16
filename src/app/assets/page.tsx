import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSurface,
  NabuSectionHeader,
  NabuBadge,
  NabuKicker,
  NabuStat,
} from "@/components/ui/nabu";
import { houseAssets } from "@/data/house-assets";
import type { HouseAsset } from "@/data/house-assets";

const statusTone = {
  available: "green",
  pending: "amber",
  "not-tracked": "stone",
} as const;

const statusLabel = {
  available: "Available",
  pending: "Pending",
  "not-tracked": "Not tracked",
} as const;

function AssetCard({ asset }: { asset: HouseAsset }) {
  return (
    <NabuSurface className="p-5 sm:p-6">
      <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <NabuKicker>{asset.category}</NabuKicker>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-primary">
            {asset.name}
          </h2>
          <p className="mt-1 text-sm leading-6 text-tertiary">
            {asset.description}
          </p>
        </div>
        <NabuBadge tone="stone">{asset.acquiredYear}</NabuBadge>
      </div>

      {/* Status areas */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        {asset.statusAreas.map((area) => (
          <NabuStat
            key={area.label}
            label={area.label}
            value={statusLabel[area.status]}
            tone={statusTone[area.status]}
          />
        ))}
      </div>

      {/* Maintenance schedule */}
      <NabuSectionHeader eyebrow="Maintenance" className="mb-3" />
      <div className="space-y-3">
        {asset.maintenance.map((task) => (
          <div
            key={task.task}
            className="rounded-xl border border-secondary bg-secondary p-3"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <span className="text-sm font-medium text-primary">
                {task.task}
              </span>
              <NabuBadge tone="blue" className="shrink-0">
                {task.frequency}
              </NabuBadge>
            </div>
            {task.notes && (
              <p className="mt-1.5 text-xs leading-5 text-quaternary">
                {task.notes}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Warnings */}
      {asset.warnings && asset.warnings.length > 0 && (
        <>
          <NabuSectionHeader eyebrow="Important" className="mb-3 mt-5" />
          <div className="space-y-2">
            {asset.warnings.map((warning) => (
              <div
                key={warning}
                className="rounded-xl border border-utility-orange-200 bg-utility-orange-50/50 px-3 py-2.5 text-xs leading-5 text-stone-700 dark:border-utility-orange-700/40 dark:bg-utility-orange-950/20 dark:text-stone-300"
              >
                {warning}
              </div>
            ))}
          </div>
        </>
      )}
    </NabuSurface>
  );
}

export default function AssetsPage() {
  return (
    <NabuPageShell>
      <NabuHeader
        title="House Assets"
        backHref="/"
        subtitle={`${houseAssets.length} tracked`}
      />

      <NabuMain>
        <NabuSectionHeader
          className="mb-4"
          eyebrow="Inventory"
          title="Tracked assets"
          description="Maintenance schedules, warranties, and service records for household equipment."
        />

        <div className="space-y-5">
          {houseAssets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      </NabuMain>
    </NabuPageShell>
  );
}
