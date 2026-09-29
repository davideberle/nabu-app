"use client";

// The saved base as a picture. Pure presentation of the server view: the
// location sets the backdrop, the supplies the child has secured appear as
// crates, seedlings, samples and deliveries. Nothing here scores anything.

import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";

const BACKDROP: Record<string, string> = {
  crater: "from-orange-200 via-amber-100 to-stone-100 dark:from-orange-950 dark:via-stone-900 dark:to-stone-950",
  ice: "from-sky-200 via-cyan-100 to-white dark:from-sky-950 dark:via-slate-900 dark:to-stone-950",
  forest: "from-emerald-200 via-green-100 to-stone-100 dark:from-emerald-950 dark:via-stone-900 dark:to-stone-950",
  shore: "from-cyan-200 via-yellow-100 to-stone-100 dark:from-cyan-950 dark:via-stone-900 dark:to-stone-950",
};

const SUPPLY_EMOJI: Record<string, string> = {
  Essenspakete: "🥫",
  Setzlinge: "🌱",
  Proben: "🧪",
  water: "💧",
  tools: "🔧",
  seeds: "🌰",
  lamp: "🔦",
  agua: "💧",
  herramientas: "🔧",
  semillas: "🌰",
  lámpara: "🔦",
};

const SUPPLY_LABEL: Record<string, string> = {
  water: "Wasser",
  tools: "Werkzeug",
  seeds: "Samen",
  lamp: "Lampe",
  agua: "Wasser",
  herramientas: "Werkzeug",
  semillas: "Samen",
  lámpara: "Lampe",
};

export function BaseScene({
  base,
  locations,
  compact = false,
  children,
}: {
  base: ChildView["base"];
  locations: ChildView["locations"];
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const location = base.location ?? locations.find((l) => l.id === null) ?? null;
  const backdrop = location ? BACKDROP[location.id] ?? BACKDROP.crater : "from-stone-200 to-stone-100 dark:from-stone-800 dark:to-stone-950";
  const supplies = Object.entries(base.supplies).filter(([, n]) => n > 0);
  return (
    <div className={cn("relative w-full bg-gradient-to-b", backdrop, compact ? "min-h-40" : "min-h-56")} role="img" aria-label={base.name ? `Basis ${base.name}${location ? `, ${location.label}` : ""}` : "Noch keine Basis"}>
      <div className="absolute inset-x-0 bottom-0 h-10 bg-stone-300/60 dark:bg-stone-800/70" aria-hidden />
      <div className="relative flex h-full min-h-[inherit] flex-col justify-end p-4">
        <div className="flex items-end gap-3">
          <span className={cn("select-none", compact ? "text-5xl" : "text-6xl")} aria-hidden>
            {location?.emoji ?? "🗺️"}
          </span>
          <span className={cn("select-none", compact ? "text-5xl" : "text-6xl")} aria-hidden>
            {base.name ? "🏕️" : "⛺"}
          </span>
          <div className="flex flex-wrap gap-2 pb-1">
            {supplies.map(([key, count]) => (
              <span key={key} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-sm font-medium text-stone-800 shadow-xs dark:bg-stone-900/80 dark:text-stone-100">
                <span aria-hidden>{SUPPLY_EMOJI[key] ?? "📦"}</span>
                {count} {SUPPLY_LABEL[key] ?? key}
              </span>
            ))}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
