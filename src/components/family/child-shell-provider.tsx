"use client";

// ---------------------------------------------------------------------------
// Family Child Shell provider — the one persistent owner of the selected
// child, the shared wallet projection and the shell chrome.
//
// Mounted from the `(shell)` route-group layout, so it survives navigation
// between Home, Ask Nabu, Activity, Redeem, Learn, Games and Hörspiele: the
// header never remounts, and the selected child cannot desynchronize between
// surfaces because exactly one copy of it exists.
//
// Identity rules (family-assistant DESIGN.md §7.5, accepted 2026-10-04):
// - the URL's `?child=` is the only signal (deep links, child shortcuts,
//   back/forward re-entry, and the shell's own hrefs);
// - a bare entry — no `?child=` — always shows the profile chooser. Nothing
//   is restored from local storage, so a fresh entry never silently reopens
//   the sibling's profile (FH-02);
// - picking the other profile cancels the current surface (it unmounts, which
//   releases microphone/speech and aborts pending work) and opens that
//   child's Home.
//
// The selected profile stays UI-owned projection state. It is never an API
// authority: family APIs return whole-family data and project client-side,
// and every scoped credential (bridge, learning, games) is minted server-side
// from its own allowlist, so a tampered URL value can at worst re-open the
// chooser (`normalizeChildId` is the strict gate on every read).
//
// The wallet lives here too (FH-06): one fetch of the server projection per
// child, shared by the header chip, Home and Redeem, refreshed after every
// committed write and on return to Home. A failed fetch is an explicit
// "unknown" state with retry — never a zero, never a demo balance.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { ChildShellBar, ChildSwitcherOverlay } from "./child-shell";
import {
  WEEK_ID_PATTERN,
  activeShellDestination,
  childShellDestinationHref,
  normalizeChildId,
  type ChildId,
} from "@/lib/family-child-shell";
import type { FamilyWallet, FamilyWalletProjection } from "@/lib/family-wallet";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

export type ShellWalletState =
  | { status: "idle" }
  | { status: "loading"; wallet: FamilyWallet | null }
  | { status: "ready"; wallet: FamilyWallet; projection: FamilyWalletProjection }
  | { status: "error"; wallet: FamilyWallet | null };

export type ChildShellContextValue = {
  /** The active child, or null while the chooser is deciding. */
  child: ChildId | null;
  /** True once the URL has been read (kept for API compatibility; always true after mount). */
  restored: boolean;
  /** Whether the session is a tracker-only (shared child device) account. */
  trackerOnly: boolean;
  /** Open the two-profile switcher overlay. */
  openSwitcher: () => void;
  /** Atomically select a child for every surface at once. */
  applyChild: (id: ChildId) => void;
  /** The authoritative wallet projection for the selected child. */
  wallet: ShellWalletState;
  /** Re-read the wallet from the server (after a committed write, on return to Home). */
  refreshWallet: () => void;
};

const ChildShellContext = createContext<ChildShellContextValue | null>(null);

export function useChildShell(): ChildShellContextValue {
  const value = useContext(ChildShellContext);
  if (!value) {
    throw new Error("useChildShell must be rendered inside the family (shell) layout");
  }
  return value;
}

export { activeShellDestination };

export function ChildShellLayoutClient({
  trackerOnly,
  children,
}: {
  trackerOnly: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = activeShellDestination(pathname);
  const urlChild = normalizeChildId(searchParams.get("child"));
  const weekParam = searchParams.get("week");
  const weekId = weekParam && WEEK_ID_PATTERN.test(weekParam) ? weekParam : null;

  const [child, setChild] = useState<ChildId | null>(urlChild);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const applyChild = useCallback(
    (id: ChildId) => {
      const applied = normalizeChildId(id);
      if (!applied) return;
      setSwitcherOpen(false);
      if (child !== null && applied !== child) {
        // A profile switch: leave the current surface (unmounting it cancels
        // recordings, speech, leases and in-flight loads) and open that
        // child's Home with the explicit child context.
        setChild(applied);
        router.push(childShellDestinationHref("home", applied));
        return;
      }
      setChild(applied);
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
    [active, child, router, weekId],
  );

  // Follow the URL when navigation or back/forward names a different child;
  // a navigation to a bare URL re-opens the chooser.
  useEffect(() => {
    if (urlChild !== child) setChild(urlChild);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL is the only source
  }, [urlChild, pathname]);

  const openSwitcher = useCallback(() => setSwitcherOpen(true), []);

  // ------------------------------------------------------------------
  // Wallet — one server projection per child, shared by every surface
  // ------------------------------------------------------------------
  const [wallet, setWallet] = useState<ShellWalletState>({ status: "idle" });
  const walletSeq = useRef(0);
  const [walletAttempt, setWalletAttempt] = useState(0);
  const refreshWallet = useCallback(() => setWalletAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!child) {
      setWallet({ status: "idle" });
      return;
    }
    const seq = (walletSeq.current += 1);
    const controller = new AbortController();
    setWallet((prev) => ({ status: "loading", wallet: prev.status === "ready" || prev.status === "loading" || prev.status === "error" ? prev.wallet : null }));
    (async () => {
      try {
        const res = await fetch("/api/family/wallet", { signal: controller.signal, cache: "no-store" });
        if (seq !== walletSeq.current) return;
        if (!res.ok) throw new Error(`wallet ${res.status}`);
        const projection = (await res.json()) as FamilyWalletProjection;
        if (seq !== walletSeq.current) return;
        const entry = projection.wallets[child];
        if (!entry) throw new Error("wallet missing");
        setWallet({ status: "ready", wallet: entry, projection });
      } catch {
        if (seq !== walletSeq.current || controller.signal.aborted) return;
        setWallet((prev) => ({ status: "error", wallet: prev.status === "loading" ? prev.wallet : null }));
      }
    })();
    return () => {
      controller.abort();
    };
  }, [child, walletAttempt]);

  // Returning to Home re-reads the balance (proposal: wallet contract 5).
  useEffect(() => {
    if (active === "home" && child) setWalletAttempt((n) => n + 1);
  }, [active, child]);

  const value = useMemo<ChildShellContextValue>(
    () => ({ child, restored: true, trackerOnly, openSwitcher, applyChild, wallet, refreshWallet }),
    [child, trackerOnly, openSwitcher, applyChild, wallet, refreshWallet],
  );

  const profile = child ? assistantProfileById(child) : null;
  const subtitle =
    active === "assistant" && profile
      ? `with ${profile.companionName} — switch profile`
      : undefined;
  const overlayOpen = switcherOpen || child === null;

  return (
    <ChildShellContext.Provider value={value}>
      <div
        className={cn(
          "flex w-full flex-col bg-secondary text-primary",
          // The Assistant is a viewport-locked conversation surface with its
          // own internal scrolling; every other surface scrolls as a page.
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
            wallet={wallet}
            onRetryWallet={refreshWallet}
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
