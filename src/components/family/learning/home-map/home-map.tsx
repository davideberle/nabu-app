"use client";

// ---------------------------------------------------------------------------
// Step 2 B (2026-11-02): the React side of the isometric home map. Pages load this file through next/dynamic with
// ssr:false, and this file loads Phaser itself only after mounting — so the map's code is fetched only by a child whose
// FAMILY_HOME_MAP flag is on, and only on the screens that show the map.
//
// Place names are real buttons over the canvas (readable, focusable, tappable); the canvas does the drawing and walking.
// Arrow keys walk along the paths; Enter at a place starts it. The build animation of newly built pieces plays once per
// device (remembered in localStorage) and any tap or key skips it.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChildId } from "@/lib/family-assistant-turn";
import { deriveHomeWorld, seenKey, type HomeWorld, type Tile } from "@/lib/family-home-map";
import type { HomeMapView } from "@/lib/family-home-map-view";
import type { GameApi, LabelPlacement } from "./home-map-game";
import { HomeMapLoading } from "./home-map-loading";

function readSeen(child: ChildId): string[] | null {
  try {
    const raw = window.localStorage.getItem(seenKey(child));
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function writeSeen(child: ChildId, ids: string[]) {
  try {
    window.localStorage.setItem(seenKey(child), JSON.stringify(ids));
  } catch {
    /* private mode: the animation simply plays again next time */
  }
}

export type HomeMapProps = {
  child: ChildId;
  map: HomeMapView;
  /** The place the avatar stands at (a running mission's position); null = the world's landing spot. */
  at: string | null;
  /** The avatar arrived at a place (tap or keys), or Enter was pressed there. */
  onArrive: (place: string) => void;
  busy?: boolean;
  /** Contextual actions over the map (e.g. «Zum Rückblick»), never permanent chrome. */
  children?: ReactNode;
};

export function HomeMap({ child, map, at, onArrive, busy, children }: HomeMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<GameApi | null>(null);
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  const [seen] = useState<string[] | null>(() => (typeof window === "undefined" ? null : readSeen(child)));
  const world: HomeWorld = useMemo(() => deriveHomeWorld({ ...map.input, seen, lastPlace: at }), [map.input, seen, at]);
  /** Bumped whenever the game reports a new layout (first draw, resize); labels are then measured and placed again. */
  const [layoutTick, setLayoutTick] = useState(0);
  const [placed, setPlaced] = useState<LabelPlacement | null>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [avatar, setAvatar] = useState<{ tile: Tile; walking: boolean }>({ tile: world.avatar, walking: false });
  const [arrival, setArrival] = useState<"none" | "playing" | "done">(world.arrivals.length ? "playing" : "none");
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Keyboard play starts on the map itself (arrows walk, Enter starts, any key skips the build animation).
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  const worldKey = JSON.stringify({ p: world.pieces.map((p) => [p.id, p.stage, p.asset]), pl: world.places.map((p) => [p.id, p.state]) });

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    void import("./home-map-game").then(({ startHomeMap }) => {
      if (cancelled) return;
      apiRef.current = startHomeMap(host, world, {
        onArrive: (place) => arriveRef.current(place),
        onAvatar: (tile, walking) => setAvatar({ tile, walking }),
        onLayout: () => {
          setLayoutTick((t) => t + 1);
        },
        onMissing: setMissing,
        onArrival: (state, ids) => {
          setArrival(state === "playing" ? "playing" : "done");
          if (state === "done") {
            // Everything built is now known to this device (also the pieces that arrived without animation).
            writeSeen(child, Array.from(new Set([...(readSeen(child) ?? []), ...world.pieces.filter((p) => p.stage === "built").map((p) => p.id), ...ids])));
          }
        },
      });
    });
    return () => {
      cancelled = true;
      setPlaced(null);
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // The game is rebuilt only when the world itself changes (a new piece, a new station), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldKey, child]);

  // Place the names once the game has laid out the map: each label is measured as rendered, then the game puts it under its
  // own building (never over another sprite or label). The map is «ready» only when the names are in place.
  useEffect(() => {
    if (!layoutTick) return;
    const raf = requestAnimationFrame(() => {
      const api = apiRef.current;
      if (!api) return;
      const sizes: Record<string, { w: number; h: number }> = {};
      for (const [id, el] of Object.entries(labelRefs.current)) if (el) sizes[id] = { w: el.offsetWidth, h: el.offsetHeight };
      const result = api.placeLabels(sizes);
      if (!result) return;
      setPlaced(result);
      setReady(true);
      // Test hook (render checks): the game's opaque-pixel probe and label anchors; read-only.
      (window as unknown as { __homeMapProbe?: unknown }).__homeMapProbe = { ownersUnder: api.ownersUnder, labelAnchor: api.labelAnchor };
    });
    return () => cancelAnimationFrame(raf);
  }, [layoutTick, worldKey]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (arrival === "playing") {
      apiRef.current?.skipArrival();
      e.preventDefault();
      return;
    }
    const dir = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[e.key as "ArrowUp"];
    if (dir) {
      e.preventDefault();
      apiRef.current?.step(dir);
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && !busy) {
      const here = world.places.find((p) => p.tile.c === avatar.tile.c && p.tile.r === avatar.tile.r && !p.waypoint);
      if (here) {
        e.preventDefault();
        onArrive(here.id);
      }
    }
  };

  const hereLabel = world.places.find((p) => p.tile.c === avatar.tile.c && p.tile.r === avatar.tile.r)?.label ?? null;
  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
      style={{ background: "#3fc1d4" }}
      tabIndex={0}
      role="application"
      aria-label={`Deine Insel.${hereLabel ? ` Du stehst bei: ${hereLabel}.` : ""} Mit den Pfeiltasten gehst du auf den Wegen, mit Enter beginnst du dort.`}
      onKeyDown={onKeyDown}
      data-testid="home-map"
      data-child={child}
      data-ready={ready ? "true" : "false"}
      data-avatar={`${avatar.tile.c},${avatar.tile.r}`}
      data-walking={avatar.walking ? "true" : "false"}
      data-arrival={arrival}
      data-arrivals={world.arrivals.join(" ")}
      data-pieces={world.pieces.map((p) => `${p.id}:${p.stage}`).join(" ")}
      data-unplaced={world.unplaced.join(" ")}
      data-missing={missing.join(" ")}
      data-label-overlaps={placed ? Object.entries(placed.overlaps).filter(([, o]) => o.length).map(([id, o]) => `${id}:${o.join("+")}`).join(" ") : ""}
    >
      <div ref={hostRef} className="absolute inset-0" data-testid="home-map-canvas" />
      {/* Until the map has drawn itself and placed its names: the child's avatar and one short line (never a blank sea). */}
      {!ready ? <HomeMapLoading child={child} /> : null}
      {world.places
        .filter((p) => !p.waypoint)
        .map((p) => {
          const at = placed?.pos[p.id];
          const today = p.state === "current";
          return (
            <button
              key={p.id}
              ref={(el) => {
                labelRefs.current[p.id] = el;
              }}
              type="button"
              disabled={busy || arrival === "playing"}
              onClick={() => apiRef.current?.walkTo(p.id)}
              className="absolute whitespace-nowrap rounded-full px-3 shadow-sm transition-transform hover:scale-105 disabled:opacity-90"
              style={{
                left: at?.x ?? 0,
                top: at?.y ?? 0,
                visibility: at ? "visible" : "hidden",
                // Today's place is the most visible name on the map; earlier places stay small and quiet.
                fontSize: today ? 18 : 13,
                fontWeight: today ? 800 : 600,
                lineHeight: today ? "32px" : "22px",
                background: today ? "#ffe27a" : "rgba(255,253,246,0.82)",
                color: "#4a3520",
                border: today ? "3px solid #d98a00" : "1px solid #d6c3a3",
                boxShadow: today ? "0 3px 10px rgba(74,53,32,0.35)" : undefined,
                zIndex: today ? 3 : 2,
              }}
              data-testid={`home-place-${p.id}`}
              data-state={p.state}
            >
              {p.label}
            </button>
          );
        })}
      {arrival === "playing" ? (
        <button type="button" className="absolute bottom-4 right-4 rounded-full bg-white/85 px-4 py-2 text-base font-semibold text-stone-800 shadow" onClick={() => apiRef.current?.skipArrival()} data-testid="home-map-skip">
          Weiter ▸
        </button>
      ) : null}
      {children}
    </div>
  );
}
