// Layout, atomicity and route-compatibility invariants for the Family Child
// Shell (Assistant / Plan / Rewards).
//
// There is no DOM test harness in this repo, so — like
// family-assistant-layout.test.ts — these assertions work on the source of
// the shell chrome, the persistent `(shell)` layout provider, and the
// destination clients:
//
// - every shell control keeps at least a 48 px target;
// - the shell bar is a flow element and can never cover the assistant's
//   136 px talk dock (the only fixed-position element is the switcher
//   overlay);
// - the assistant's composition contract stays intact (no bare `lg:`);
// - the shell chrome and the selected child live in ONE persistent
//   route-group layout, so navigating between destinations never remounts
//   the avatar and cannot desynchronize the child identity — destination
//   clients must not mount their own bar/switcher;
// - child switching stays atomic: the assistant workspace and the Plan board
//   are keyed by the selected child, so a switch unmounts the previous
//   child's subtree (and with it every in-flight turn, recording and speech
//   teardown the assistant already owns);
// - Plan renders the real person board and Rewards uses the real APIs — no
//   route re-introduces the static prototype seed data;
// - installed Home Screen entry points keep their URLs (route groups do not
//   appear in the URL, so /family/assistant et al. are unchanged);
// - the chess launch surface stays full-screen outside the shell group.

import { doesNotMatch, equal, match, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellSource = readFileSync(
  new URL("../components/family/child-shell.tsx", import.meta.url),
  "utf8",
);
const providerSource = readFileSync(
  new URL("../components/family/child-shell-provider.tsx", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("../app/family/(shell)/layout.tsx", import.meta.url),
  "utf8",
);
/** Comment-stripped view for assertions about code rather than prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const shellCode = stripComments(shellSource);
const providerCode = stripComments(providerSource);
const planPageSource = readFileSync(
  new URL("../app/family/(shell)/plan/page.tsx", import.meta.url),
  "utf8",
);
const rewardsSource = readFileSync(
  new URL("../app/family/(shell)/rewards/client.tsx", import.meta.url),
  "utf8",
);
const assistantSource = readFileSync(
  new URL("../app/family/(shell)/assistant/client.tsx", import.meta.url),
  "utf8",
);
const assistantPageSource = readFileSync(
  new URL("../app/family/(shell)/assistant/page.tsx", import.meta.url),
  "utf8",
);
const chessPageSource = readFileSync(
  new URL("../app/family/rewards/chess/page.tsx", import.meta.url),
  "utf8",
);
const rootManifest = readFileSync(
  new URL("../../public/manifest.json", import.meta.url),
  "utf8",
);

describe("shell chrome touch targets", () => {
  it("uses 48px-or-larger targets for every shell control", () => {
    ok(shellSource.includes("min-h-12"));
    ok(shellSource.includes("h-12 w-12"));
    doesNotMatch(shellSource, /\bmin-h-11\b/);
    doesNotMatch(shellSource, /\bh-11 w-11\b/);
    doesNotMatch(shellSource, /\bmin-h-10\b/);
    doesNotMatch(shellSource, /\bh-10 w-10\b/);
    // The provider's own controls (the Nabu escape link) follow the same rule.
    ok(providerSource.includes("min-h-12"));
    doesNotMatch(providerSource, /\bmin-h-11\b|\bmin-h-10\b/);
  });

  it("keeps visible focus states on shell controls", () => {
    match(shellSource, /focus-visible:outline-2/);
    match(providerSource, /focus-visible:outline-2/);
  });

  it("is safe-area aware at the top edge", () => {
    ok(shellSource.includes("env(safe-area-inset-top)"));
  });
});

describe("shell bar never covers the talk dock", () => {
  it("renders the bar as a flow element (shrink-0), not fixed/absolute", () => {
    ok(shellCode.includes("shrink-0"));
    // The one fixed-position element in the shell chrome is the modal
    // switcher overlay.
    const fixedUses = shellCode.match(/\bfixed\b/g) ?? [];
    equal(fixedUses.length, 1);
    match(shellCode, /fixed inset-0 z-50/);
    doesNotMatch(shellCode, /\babsolute\b/);
    doesNotMatch(providerCode, /\bfixed\b|\babsolute\b/);
  });

  it("takes no part in the assistant's landscape split (no bare lg:)", () => {
    doesNotMatch(shellCode, /\blg:(?!landscape:)/);
    doesNotMatch(providerCode, /\blg:(?!landscape:)/);
    doesNotMatch(stripComments(rewardsSource), /\blg:(?!landscape:)/);
  });
});

describe("switcher accessibility", () => {
  it("is a labelled modal dialog with an aria-pressed active child", () => {
    ok(shellSource.includes('role="dialog"'));
    ok(shellSource.includes('aria-modal="true"'));
    ok(shellSource.includes("aria-label"));
    ok(shellSource.includes("aria-pressed"));
  });

  it("marks the active destination for assistive tech", () => {
    ok(shellSource.includes("aria-current"));
  });

  it("makes everything behind the open switcher inert", () => {
    // The bar and the destination content are wrapped together and marked
    // `inert` while the modal is up, so focus cannot tab behind the dialog
    // and assistive tech does not read the covered surface. The wrapper is
    // `display: contents` so it takes no part in the flex layout.
    match(providerCode, /className="contents"\s+inert=\{overlayOpen/);
  });
});

describe("destination load failures are recoverable", () => {
  // The installed shared-iPad app has no browser chrome, so "reload the
  // page" is not a recovery path a child can take. A failed family-API load
  // must surface a visible retry control instead of a dead end (Rewards) or
  // an endless spinner (the Plan person board).
  it("Coins offers a retry after a failed wallet load", () => {
    ok(rewardsSource.includes("Try again"));
    ok(rewardsSource.includes("refreshWallet"));
  });

  it("the legacy Plan page redirects into Activity with the child kept and the week dropped (UI-05)", () => {
    ok(planPageSource.includes('redirect(child ? `/family/activity?child=${encodeURIComponent(child)}` : "/family/activity")'));
    doesNotMatch(stripComments(planPageSource), /PersonBoardClient|week=/);
  });
});

describe("one persistent shell layout owns chrome and identity", () => {
  it("the (shell) route-group layout mounts the persistent provider", () => {
    ok(layoutSource.includes("ChildShellLayoutClient"));
    // Route groups keep URLs unchanged; the layout is what persists across
    // Assistant/Plan/Rewards navigation.
    ok(
      existsSync(
        fileURLToPath(new URL("../app/family/(shell)/layout.tsx", import.meta.url)),
      ),
    );
  });

  it("the provider renders the bar and the switcher exactly once", () => {
    ok(providerSource.includes("ChildShellBar"));
    ok(providerSource.includes("ChildSwitcherOverlay"));
    // Destination clients must not mount their own chrome — a second copy
    // would reintroduce per-page remounting and identity desync.
    for (const [name, source] of [
      ["rewards", rewardsSource],
      ["assistant", assistantSource],
    ] as const) {
      doesNotMatch(source, /ChildShellBar/, `${name} client mounts its own bar`);
      doesNotMatch(
        source,
        /ChildSwitcherOverlay/,
        `${name} client mounts its own switcher`,
      );
    }
  });

  it("the provider is the single owner of the selected profile, read from the URL only (FH-02)", () => {
    ok(providerSource.includes("normalizeChildId"));
    // A bare entry must open the chooser: nothing is restored from storage.
    doesNotMatch(providerSource, /readStoredChild|storeSelectedChild|localStorage/);
    ok(providerSource.includes("searchParams.get(\"child\")"));
    for (const [name, source] of [
      ["rewards", rewardsSource],
      ["assistant", assistantSource],
    ] as const) {
      doesNotMatch(
        source,
        /storeSelectedChild|readStoredChild/,
        `${name} client duplicates selection persistence`,
      );
    }
  });

  it("the provider owns the one wallet projection and switching profiles opens that child's Home", () => {
    ok(providerSource.includes("/api/family/wallet"));
    ok(providerSource.includes("refreshWallet"));
    ok(providerSource.includes('childShellDestinationHref("home", applied)'));
  });

  it("the exposed wallet is derived synchronously from the selected child — a sibling's projection is never handed to any consumer (FH-06)", () => {
    ok(providerSource.includes("storedWallet.child !== child"));
    ok(providerSource.includes('return { status: "loading", wallet: null }'));
    // No consumer reads the raw stored state; everyone goes through the derived value.
    doesNotMatch(shellSource, /storedWallet/);
    doesNotMatch(readFileSync(new URL("../app/family/(shell)/home/client.tsx", import.meta.url), "utf8"), /storedWallet/);
  });

  it("uses device-independent wording (FH-03)", () => {
    doesNotMatch(shellSource, /iPad/);
    ok(shellSource.includes("Choose your profile"));
    ok(shellSource.includes("Switch profile"));
  });

  it("every destination consumes the shared child context", () => {
    ok(rewardsSource.includes("useChildShell"));
    ok(assistantSource.includes("useChildShell"));
  });
});

describe("atomic child switching", () => {
  it("keeps the assistant workspace keyed by the selected child", () => {
    // The `key` change is what unmounts the previous child's conversation
    // subtree; its cleanup aborts the in-flight turn, cancels the recording
    // and stops speech (client.tsx unmount effect). Do not remove.
    ok(assistantSource.includes("key={profile.id}"));
  });

  it("keys the Coins surface by the selected child", () => {
    ok(rewardsSource.includes("key={child}"));
  });
});

describe("destinations render the real family model", () => {
  it("Coins consumes the server-owned permanent wallet projection and nothing weekly (UI-03)", () => {
    ok(rewardsSource.includes("useChildShell"));
    ok(rewardsSource.includes("wallet.projection.epochWeek"));
    const coinsCode = stripComments(rewardsSource);
    for (const forbidden of ["/api/family/completions?week=", "/api/family/redemptions?week=", "weekPoints", "Previous week", "Next week", "earned this week", "redeemedCount", "Get it", "daily", "weekly", "long-term"]) {
      ok(!coinsCode.includes(forbidden), `Coins must not contain ${JSON.stringify(forbidden)}`);
    }
    doesNotMatch(rewardsSource, /initialCompletions|initialRewards/);
  });

  it("Coins points game spending at the one Studio purchase flow on Games", () => {
    ok(rewardsSource.includes('childShellDestinationHref("games", child)'));
    ok(rewardsSource.includes("PLAY_BLOCK_COINS"));
  });

  it("guarded play hosts chess itself — no bounce back to the legacy launch page (a loop the self-check caught)", () => {
    const playPage = readFileSync(new URL("../app/family/games/play/page.tsx", import.meta.url), "utf8");
    doesNotMatch(stripComments(playPage), /rewards\/chess/);
    ok(playPage.includes("<GuardedPlayClient child={child} gameId={params.game} />"));
  });

  it("the legacy chess launch page redirects into guarded play with the child validated on the server (DA-04)", () => {
    ok(chessPageSource.includes("normalizeChildId"));
    ok(chessPageSource.includes('redirect("/family/home")'));
    ok(chessPageSource.includes("/family/games/play?game=${DAILY_CHESS_GAME_ID}&child="));
    ok(
      !existsSync(
        fileURLToPath(
          new URL("../app/family/rewards/chess/client.tsx", import.meta.url),
        ),
      ),
      "no separate chess launch client remains",
    );
  });
});

describe("route compatibility", () => {
  it("keeps the assistant's dedicated install metadata", () => {
    ok(assistantPageSource.includes("FAMILY_ASSISTANT_MANIFEST_PATH"));
  });

  it("the root Home Screen manifest starts in Family Home; the legacy board start URL still redirects there (UI-09)", () => {
    const manifest = JSON.parse(rootManifest) as { start_url?: string };
    equal(manifest.start_url, "/family/home");
    const dashboardPage = readFileSync(new URL("../app/family/dashboard/page.tsx", import.meta.url), "utf8");
    ok(dashboardPage.includes('"/family/parent" : "/family/home"'));
    const trackerPage = readFileSync(new URL("../app/family/tracker/page.tsx", import.meta.url), "utf8");
    ok(trackerPage.includes('redirect("/family/home")'));
  });
});
