"use client";

// ---------------------------------------------------------------------------
// Family Child Shell provider — the one persistent owner of the selected
// child and the shell chrome.
//
// Mounted from the `(shell)` route-group layout, so it survives navigation
// between Assistant, Plan and Rewards: the top-corner avatar and the
// destination tabs never remount, and the selected child cannot
// desynchronize between destinations because exactly one copy of it exists.
//
// Identity rules (unchanged from the per-page era, now in one place):
// - the URL's `?child=` is the strongest signal (deep links, back/forward
//   re-entry, and the shell's own destination hrefs);
// - otherwise the persisted localStorage selection is restored once on mount;
// - otherwise the non-dismissable switcher asks who is playing.
//
// The selected child stays UI-owned projection state. It is never an API
// authority: the family APIs return whole-family data and project
// client-side, and the assistant bridge token is minted server-side from its
// own allowlist, so a tampered stored/URL value can at worst re-open the
// chooser (`normalizeChildId` is the strict gate on every read).
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { ChildShellBar, ChildSwitcherOverlay } from "./child-shell";
import {
  WEEK_ID_PATTERN,
  browserChildShellStorage,
  childShellDestinationHref,
  normalizeChildId,
  readStoredChild,
  storeSelectedChild,
  type ChildId,
  type ChildShellDestinationId,
} from "@/lib/family-child-shell";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

export type ChildShellContextValue = {
  /** The active child, or null while the chooser is deciding. */
  child: ChildId | null;
  /** True once the persisted selection has been checked (anti-flash gate). */
  restored: boolean;
  /** Whether the session is a tracker-only (shared iPad) account. */
  trackerOnly: boolean;
  /** Open the two-child switcher overlay. */
  openSwitcher: () => void;
  /** Atomically select a child for every destination at once. */
  applyChild: (id: ChildId) => void;
};

const ChildShellContext = createContext<ChildShellContextValue | null>(null);

export function useChildShell(): ChildShellContextValue {
  const value = useContext(ChildShellContext);
  if (!value) {
    throw new Error("useChildShell must be rendered inside the family (shell) layout");
  }
  return value;
}

/** Map the current pathname to the shell destination it belongs to. */
export function activeShellDestination(pathname: string): ChildShellDestinationId {
  if (pathname.startsWith("/family/plan")) return "plan";
  if (pathname.startsWith("/family/rewards")) return "rewards";
  return "assistant";
}

export function ChildShellLayoutClient({
  trackerOnly,
  children,
}: {
  trackerOnly: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeShellDestination(pathname);
  const urlChild = normalizeChildId(searchParams.get("child"));
  const weekParam = searchParams.get("week");
  const weekId = weekParam && WEEK_ID_PATTERN.test(weekParam) ? weekParam : null;

  const [child, setChild] = useState<ChildId | null>(urlChild);
  const [restored, setRestored] = useState(urlChild !== null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const applyChild = useCallback(
    (id: ChildId) => {
      const applied = normalizeChildId(id);
      if (!applied) return;
      setChild(applied);
      setSwitcherOpen(false);
      storeSelectedChild(browserChildShellStorage(), applied);
      try {
        window.history.replaceState(
          null,
          "",
          childShellDestinationHref(active, applied, weekId),
        );
      } catch {
        /* history not writable — selection still works */
      }
    },
    [active, weekId],
  );

  // Follow the URL when navigation or back/forward names a different child.
  useEffect(() => {
    if (urlChild && urlChild !== child) {
      setChild(urlChild);
      storeSelectedChild(browserChildShellStorage(), urlChild);
    }
  }, [urlChild, child]);

  // Restore the persisted selection once, when nothing named a child. This
  // must not re-run on navigation — the provider outlives the pages, so a
  // selection made anywhere in the shell survives every route change.
  useEffect(() => {
    if (child === null) {
      const stored = readStoredChild(browserChildShellStorage());
      if (stored) applyChild(stored);
    } else {
      // The URL named the child (deep link / installed Home Screen shortcut):
      // persist it so a later param-less open keeps the same child instead of
      // re-opening the chooser.
      storeSelectedChild(browserChildShellStorage(), child);
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
  }, []);

  const openSwitcher = useCallback(() => setSwitcherOpen(true), []);

  const value = useMemo<ChildShellContextValue>(
    () => ({ child, restored, trackerOnly, openSwitcher, applyChild }),
    [child, restored, trackerOnly, openSwitcher, applyChild],
  );

  const profile = child ? assistantProfileById(child) : null;
  const subtitle =
    active === "assistant" && profile
      ? `with ${profile.companionName} — tap to switch`
      : undefined;
  const overlayOpen = switcherOpen || (restored && child === null);

  return (
    <ChildShellContext.Provider value={value}>
      <div
        className={cn(
          "flex w-full flex-col bg-secondary text-primary",
          // The Assistant is a viewport-locked conversation surface with its
          // own internal scrolling; Plan and Rewards scroll as normal pages.
          active === "assistant" ? "h-dvh min-h-0 overflow-hidden" : "min-h-dvh",
        )}
      >
        {/* While the modal switcher is up, everything behind it is `inert`:
            focus cannot tab out of the dialog and assistive tech does not
            read the covered surface. `display: contents` keeps the wrapper
            out of the flex layout. */}
        <div className="contents" inert={overlayOpen || undefined}>
          <ChildShellBar
            active={active}
            child={child}
            weekId={weekId}
            switcherOpen={overlayOpen}
            onOpenSwitcher={openSwitcher}
            subtitle={subtitle}
            extraNav={
              !trackerOnly ? (
                <Link
                  href="/"
                  className={cn(
                    "inline-flex min-h-12 items-center rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
                    focusRing,
                  )}
                >
                  Nabu
                </Link>
              ) : null
            }
          />
          {children}
        </div>
        <ChildSwitcherOverlay
          open={overlayOpen}
          activeChild={child}
          onPick={applyChild}
          onClose={() => setSwitcherOpen(false)}
          dismissable={child !== null}
        />
      </div>
    </ChildShellContext.Provider>
  );
}
