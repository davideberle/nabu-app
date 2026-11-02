"use client";

// Step 2 B: the home map is loaded on demand (client only). A page imports THIS file; the map's own code and Phaser are
// fetched only when a child whose FAMILY_HOME_MAP flag is on actually sees the map.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { HomeMapProps } from "./home-map";
import { HomeMapLoading } from "./home-map-loading";

const HomeMapInner = dynamic(() => import("./home-map").then((m) => m.HomeMap), { ssr: false, loading: () => null });

/** The map with its loading card underneath: the card shows at once; the map covers it only once it has drawn itself. */
export function HomeMapLazy(props: HomeMapProps) {
  return (
    <div className="relative h-full w-full" data-testid="home-map-loading">
      <HomeMapLoading child={props.child} />
      <div className="absolute inset-0 z-40">
        <HomeMapInner {...props} />
      </div>
    </div>
  );
}

/**
 * The map fills exactly the space left below its top edge (the shell bar and any header above it vary), so the page never
 * scrolls at 1440×780. Re-measured on resize.
 */
export function useFillViewport(bottomGap = 0): { ref: (el: HTMLDivElement | null) => void; style: CSSProperties } {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const measure = useCallback(() => {
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    setHeight(Math.max(480, Math.floor(window.innerHeight - top - bottomGap)));
  }, [el, bottomGap]);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  return { ref: setEl, style: height === null ? { height: "calc(100dvh - 5rem)" } : { height } };
}
