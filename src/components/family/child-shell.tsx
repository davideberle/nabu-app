"use client";

// ---------------------------------------------------------------------------
// Family Child Shell chrome — the persistent profile switch, the Home link
// and the wallet chip shared by every child surface (Home, Ask Nabu, Record,
// Activity, Redeem, Learn, Games, Hörspiele) on any authorized device.
//
// Wording is device-independent on purpose (FH-03): "Choose your profile",
// never a question about which device is in use.
//
// Layout invariants (asserted by family-child-shell-layout.test.ts):
// - every control presents at least a 48 CSS px target (h-12 / min-h-12);
// - the bar is a normal flow element (`shrink-0` sibling), never fixed or
//   absolute, so it can never cover the assistant's 136 px talk dock;
// - the only fixed-position element is the modal switcher overlay;
// - no bare `lg:` variants — the assistant's composition contract allows the
//   desktop split only under `lg:landscape:` and this chrome takes no part
//   in it. Class strings stay literal so Tailwind's scanner sees them.
// ---------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { cn } from "@/components/ui/nabu";
import { AssistantAvatar } from "@/app/family/(shell)/assistant/avatar";
import {
  assistantProfiles,
  assistantProfileById,
} from "@/data/family-assistant";
import {
  childShellHeaderDestinations,
  childShellDestinationHref,
  type ChildId,
  type ChildShellDestinationId,
} from "@/lib/family-child-shell";
import type { ShellWalletState } from "./child-shell-provider";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

const tintSoftBg = {
  amber: "bg-amber-50 dark:bg-amber-950/30",
  emerald: "bg-emerald-50 dark:bg-emerald-950/30",
} as const;

const tintBorder = {
  amber: "border-amber-200 dark:border-amber-800",
  emerald: "border-emerald-200 dark:border-emerald-800",
} as const;

const tintText = {
  amber: "text-amber-700 dark:text-amber-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
} as const;

// ---------------------------------------------------------------------------
// Header navigation — Home only; everything else is reached from Home
// ---------------------------------------------------------------------------

export function ChildShellNav({
  active,
  child,
  weekId,
}: {
  active: ChildShellDestinationId;
  child: ChildId | null;
  weekId?: string | null;
}) {
  return (
    <nav aria-label="Family shell" className="flex flex-wrap items-center gap-2">
      {childShellHeaderDestinations.map((destination) => {
        const isActive = destination.id === active;
        return (
          <Link
            key={destination.id}
            href={childShellDestinationHref(destination.id, child, weekId)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex min-h-12 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
              isActive
                ? "border-primary bg-secondary text-primary"
                : "border-primary bg-primary text-secondary hover:bg-secondary",
              focusRing,
            )}
          >
            <span aria-hidden="true">{destination.icon}</span>
            {destination.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Wallet chip — the same server projection Home and Redeem show (FH-06)
// ---------------------------------------------------------------------------

export function ChildShellWalletChip({
  child,
  wallet,
  onRetry,
}: {
  child: ChildId | null;
  wallet: ShellWalletState;
  onRetry: () => void;
}) {
  if (!child) return null;
  const base =
    "inline-flex min-h-12 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-secondary";
  if (wallet.status === "error" && !wallet.wallet) {
    return (
      <button
        type="button"
        onClick={onRetry}
        aria-label="Couldn't load your wallet — try again"
        title="Couldn't load your wallet — try again"
        className={cn(base, focusRing)}
      >
        <span aria-hidden="true">🪙</span>
        <span>?</span>
        <span className="sr-only">coins unknown, tap to retry</span>
      </button>
    );
  }
  const known = wallet.status === "ready" ? wallet.wallet : wallet.status === "loading" || wallet.status === "error" ? wallet.wallet : null;
  const stale = wallet.status !== "ready" && known !== null;
  return (
    <Link
      href={childShellDestinationHref("rewards", child)}
      aria-label={known ? `${known.balance} coins${stale ? " (updating)" : ""} — redeem` : "Loading your coins"}
      className={cn(base, stale && "opacity-70", focusRing)}
    >
      <span aria-hidden="true">🪙</span>
      <span>{known ? known.balance : "…"}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Active-profile avatar button — the profile switch
// ---------------------------------------------------------------------------

export function ChildShellAvatarButton({
  child,
  onOpenSwitcher,
  subtitle,
}: {
  child: ChildId;
  onOpenSwitcher: () => void;
  subtitle?: string;
}) {
  const profile = assistantProfileById(child);
  if (!profile) return null;
  return (
    <button
      type="button"
      onClick={onOpenSwitcher}
      aria-haspopup="dialog"
      aria-label={`${profile.displayName}'s profile — switch profile`}
      className={cn(
        "flex min-h-12 min-w-0 items-center gap-3 rounded-full border py-1 pl-1 pr-4 text-left transition-colors",
        tintBorder[profile.tint],
        tintSoftBg[profile.tint],
        focusRing,
      )}
    >
      <AssistantAvatar
        state="ready"
        tint={profile.tint}
        crest={profile.crest}
        label=""
        className="h-12 w-12 shrink-0"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-primary">
          {profile.displayName}
        </span>
        <span className={cn("block text-[11px] font-medium", tintText[profile.tint])}>
          {subtitle ?? "Switch profile"}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The large one-tap two-profile chooser
// ---------------------------------------------------------------------------

export function ChildSwitcherOverlay({
  open,
  activeChild,
  onPick,
  onClose,
  /** When false the shell has no child yet — choosing is required. */
  dismissable = true,
}: {
  open: boolean;
  activeChild: ChildId | null;
  onPick: (child: ChildId) => void;
  onClose: () => void;
  dismissable?: boolean;
}) {
  const firstCardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) firstCardRef.current?.focus();
  }, [open]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape" && dismissable) onClose();
    },
    [dismissable, onClose],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose your profile"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-secondary/95 p-5 backdrop-blur-sm"
    >
      <h2 className="text-xl font-semibold text-primary">Choose your profile</h2>
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {assistantProfiles.map((profile, index) => {
          const isActive = profile.id === activeChild;
          return (
            <button
              key={profile.id}
              ref={index === 0 ? firstCardRef : undefined}
              type="button"
              onClick={() => onPick(profile.id)}
              aria-pressed={isActive}
              className={cn(
                "flex min-w-0 flex-col items-center gap-3 rounded-3xl border-2 p-6 text-center transition-all hover:-translate-y-1 hover:shadow-lg",
                tintBorder[profile.tint],
                tintSoftBg[profile.tint],
                focusRing,
              )}
            >
              <AssistantAvatar
                state="ready"
                tint={profile.tint}
                crest={profile.crest}
                label=""
                className="h-32 w-32"
              />
              <span className="text-2xl font-semibold text-primary">
                {profile.displayName}
              </span>
              <span className={cn("text-sm font-medium", tintText[profile.tint])}>
                {isActive ? "That's you — tap to stay" : `Open ${profile.displayName}'s Home`}
              </span>
            </button>
          );
        })}
      </div>
      {dismissable ? (
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "inline-flex min-h-12 items-center rounded-full border border-primary bg-primary px-5 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
            focusRing,
          )}
        >
          Keep {activeChild ? assistantProfileById(activeChild)?.displayName : "going"}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The persistent shell bar: profile · Home · wallet
// ---------------------------------------------------------------------------

export function ChildShellBar({
  active,
  child,
  weekId,
  switcherOpen,
  onOpenSwitcher,
  subtitle,
  wallet,
  onRetryWallet,
  extraNav,
}: {
  active: ChildShellDestinationId;
  child: ChildId | null;
  weekId?: string | null;
  switcherOpen: boolean;
  onOpenSwitcher: () => void;
  /** Optional avatar-button subtitle (e.g. the assistant's companion name). */
  subtitle?: string;
  wallet: ShellWalletState;
  onRetryWallet: () => void;
  extraNav?: ReactNode;
}) {
  return (
    <header
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-secondary bg-primary/80 px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-6"
      aria-hidden={switcherOpen || undefined}
    >
      <div className="flex min-w-0 items-center gap-3">
        {child ? (
          <ChildShellAvatarButton
            child={child}
            onOpenSwitcher={onOpenSwitcher}
            subtitle={subtitle}
          />
        ) : (
          <p className="text-sm font-medium text-tertiary">Choose your profile</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ChildShellNav active={active} child={child} weekId={weekId} />
        <ChildShellWalletChip child={child} wallet={wallet} onRetry={onRetryWallet} />
        {extraNav}
      </div>
    </header>
  );
}
