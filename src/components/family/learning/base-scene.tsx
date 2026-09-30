"use client";

// The base as a persistent illustrated scene (approved redesign 2026-09-29,
// F3a). Pure presentation of the server-derived `SceneModel`: every element
// corresponds to a durable record — a named/placed base is a tent, a base
// with a finished first visit is a hut, EQ-RETURN fills four garden beds,
// EQ-STATION fills five station beds (six each) with the leftovers visibly
// beside them, the observation station appears where it was built and its
// lamp glows only if the Spanish request actually supplied one. Nothing here
// scores anything, nothing animates on its own; the only transition is the
// gentle appearance of newly built parts, disabled under reduced motion.

import { cn } from "@/components/ui/nabu";
import type { SceneModel } from "@/lib/family-learning-summary";

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

const LOCATION_LABEL: Record<string, string> = { crater: "Am Kraterrand", ice: "Auf dem Eisfeld", forest: "Im Nebelwald", shore: "An der Küste" };
const LOCATION_EMOJI: Record<string, string> = { crater: "🌋", ice: "🧊", forest: "🌲", shore: "🏝️" };
const SPOT_LABEL: Record<string, string> = { beach: "am Strand", rocks: "auf den Felsen", dune: "auf der Düne" };
const THEME_EMOJI: Record<string, string> = { turtles: "🐢", waves: "🌊", none: "🔭" };

/** Plain-language description of what the scene shows (for assistive tech and the parent). */
export function describeScene(scene: SceneModel): string {
  const parts: string[] = [];
  if (!scene.name) return "Noch keine Basis.";
  parts.push(`Basis „${scene.name}“${scene.location ? `, ${LOCATION_LABEL[scene.location] ?? scene.location}` : ""}`);
  parts.push(scene.base === "tent" ? "ein Zelt" : "eine Hütte");
  const garden = scene.beds.filter((b) => b.id.startsWith("garden"));
  const stationBeds = scene.beds.filter((b) => b.id.startsWith("station"));
  if (garden.length) parts.push(`${garden.length} Gartenbeete mit je ${garden[0].filled} Setzlingen`);
  if (stationBeds.length) parts.push(`${stationBeds.length} Stationsbeete mit je ${stationBeds[0].filled} Setzlingen${scene.leftovers ? `, ${scene.leftovers} Setzlinge übrig daneben` : ""}`);
  if (scene.station.built) parts.push(`die Beobachtungsstation ${scene.station.spot ? SPOT_LABEL[scene.station.spot] ?? scene.station.spot : ""}${scene.station.lamp ? ", die Lampe brennt" : ", ohne Lampe"}`);
  if (scene.stores.length) parts.push(`Vorräte: ${scene.stores.map((s) => `${s.count} ${SUPPLY_LABEL[s.key] ?? s.key}`).join(", ")}`);
  return parts.join(" · ") + ".";
}

export function BaseScene({ scene, compact = false, children }: { scene: SceneModel; compact?: boolean; children?: React.ReactNode }) {
  const backdrop = scene.location ? BACKDROP[scene.location] ?? BACKDROP.crater : "from-stone-200 to-stone-100 dark:from-stone-800 dark:to-stone-950";
  const garden = scene.beds.filter((b) => b.id.startsWith("garden"));
  const stationBeds = scene.beds.filter((b) => b.id.startsWith("station"));
  const description = describeScene(scene);
  const stationSpotClass = scene.station.spot === "rocks" ? "left-[58%]" : scene.station.spot === "dune" ? "left-[72%]" : "left-[44%]";
  return (
    <div className={cn("relative w-full overflow-hidden bg-gradient-to-b", backdrop, compact ? "min-h-44" : "min-h-64")} role="img" aria-label={description} data-scene-base={scene.base} data-scene-station={scene.station.built ? "built" : "none"} data-scene-lamp={scene.station.lamp ? "on" : "off"} data-scene-beds={scene.beds.length}>
      {/* ground */}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-stone-300/60 dark:bg-stone-800/70" aria-hidden />
      {scene.location === "shore" ? <div className="absolute inset-x-0 bottom-12 h-3 bg-cyan-300/50 dark:bg-cyan-900/50" aria-hidden /> : null}
      <div className="relative flex h-full min-h-[inherit] flex-col justify-end p-3 sm:p-4">
        <div className="relative flex min-h-24 items-end gap-2">
          {/* location marker */}
          <span className={cn("select-none", compact ? "text-4xl" : "text-5xl")} aria-hidden>
            {scene.location ? LOCATION_EMOJI[scene.location] ?? "🗺️" : "🗺️"}
          </span>
          {/* base building */}
          <span className={cn("select-none", compact ? "text-5xl" : "text-6xl", "motion-safe:transition-transform motion-safe:duration-500")} aria-hidden data-part="base">
            {scene.base === "none" ? "⛺" : scene.base === "tent" ? "🏕️" : "🛖"}
          </span>
          {/* garden beds */}
          {garden.length ? (
            <span className="flex items-end gap-0.5" aria-hidden data-part="garden">
              {garden.map((b) => (
                <span key={b.id} className={cn("flex flex-col items-center rounded-md bg-amber-800/70 px-1 pb-0.5", compact ? "text-base" : "text-xl")}>
                  <span>{"🌱".repeat(Math.min(3, Math.max(1, Math.round(b.filled / 3))))}</span>
                </span>
              ))}
            </span>
          ) : null}
          {/* station beds with leftovers */}
          {stationBeds.length ? (
            <span className="flex items-end gap-0.5" aria-hidden data-part="station-beds">
              {stationBeds.map((b) => (
                <span key={b.id} className={cn("flex flex-col items-center rounded-md bg-amber-900/70 px-1 pb-0.5", compact ? "text-sm" : "text-lg")}>
                  <span>🌱🌱🌱</span>
                </span>
              ))}
              {scene.leftovers > 0 ? (
                <span className={cn("ml-1 rounded-md bg-white/70 px-1 text-xs font-medium text-stone-800 dark:bg-stone-900/70 dark:text-stone-100")} data-part="leftovers">
                  {"🌱".repeat(scene.leftovers)} übrig
                </span>
              ) : null}
            </span>
          ) : null}
          {/* observation station */}
          {scene.station.built ? (
            <span className={cn("absolute bottom-0 flex flex-col items-center motion-safe:transition-opacity motion-safe:duration-700", stationSpotClass)} aria-hidden data-part="station">
              <span className={cn(compact ? "text-2xl" : "text-3xl")}>{THEME_EMOJI[scene.station.theme ?? "none"] ?? "🔭"}</span>
              <span className={cn(compact ? "text-4xl" : "text-5xl")}>🛖</span>
              <span className={cn("absolute -top-3 right-0 rounded-full px-1", scene.station.lamp ? "bg-yellow-300/80 shadow-[0_0_12px_rgba(253,224,71,0.9)]" : "bg-stone-400/40")} data-part="lamp">
                {scene.station.lamp ? "💡" : "🔦"}
              </span>
            </span>
          ) : null}
        </div>
        {scene.stores.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5" data-part="stores">
            {scene.stores.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-stone-800 shadow-xs dark:bg-stone-900/80 dark:text-stone-100">
                <span aria-hidden>{SUPPLY_EMOJI[s.key] ?? "📦"}</span>
                {s.count} {SUPPLY_LABEL[s.key] ?? s.key}
              </span>
            ))}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
