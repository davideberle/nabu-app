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
const planSource = readFileSync(
  new URL("../app/family/(shell)/plan/client.tsx", import.meta.url),
  "utf8",
);
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
const chessClientSource = readFileSync(
  new URL("../app/family/rewards/chess/client.tsx", import.meta.url),
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
    doesNotMatch(stripComments(planSource), /\blg:(?!landscape:)/);
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
  const personBoardSource = readFileSync(
    new URL("../app/family/dashboard/[person]/client.tsx", import.meta.url),
    "utf8",
  );

  it("Rewards offers a retry after a failed load", () => {
    ok(rewardsSource.includes("Try again"));
    ok(rewardsSource.includes("setLoadAttempt"));
  });

  it("the Plan person board fails visibly, with a retry", () => {
    ok(personBoardSource.includes("loadError"));
    ok(personBoardSource.includes("Try again"));
    ok(personBoardSource.includes("setLoadAttempt"));
    // The load effect checks every response before parsing it, so an API
    // refusal cannot strand the board on the loading spinner.
    ok(personBoardSource.includes("if (!compRes.ok || !redRes.ok || !cfgRes.ok)"));
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
      ["plan", planSource],
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

  it("the provider is the single owner of selection persistence", () => {
    ok(providerSource.includes("storeSelectedChild"));
    ok(providerSource.includes("readStoredChild"));
    ok(providerSource.includes("normalizeChildId"));
    for (const [name, source] of [
      ["plan", planSource],
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

  it("every destination consumes the shared child context", () => {
    ok(planSource.includes("useChildShell"));
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

  it("keys the Plan board by the selected child", () => {
    ok(planSource.includes("key={child}"));
  });
});

describe("destinations render the real family model", () => {
  it("Plan reuses the real person board, not a duplicate", () => {
    ok(planSource.includes("PersonBoardClient"));
    ok(planSource.includes('from "../../dashboard/[person]/client"'));
    doesNotMatch(planSource, /initialCompletions|initialRewards/);
  });

  it("Rewards projects the shared wallet math over the real APIs", () => {
    ok(rewardsSource.includes("computeChildWallet"));
    ok(rewardsSource.includes("/api/family/completions?week="));
    ok(rewardsSource.includes("/api/family/redemptions?week="));
    ok(rewardsSource.includes('"/api/family/config"'));
    doesNotMatch(rewardsSource, /initialCompletions|initialRewards/);
  });

  it("Rewards keeps the game corner behind the fail-closed identity seam", () => {
    ok(rewardsSource.includes("childGameIdentity"));
    ok(rewardsSource.includes("approvedGameLibrary"));
  });

  it("the chess launch surface validates the child strictly on the server", () => {
    ok(chessPageSource.includes("normalizeChildId"));
    ok(chessPageSource.includes('redirect("/family/rewards")'));
  });

  it("chess stays full-screen outside the shell group", () => {
    ok(
      existsSync(
        fileURLToPath(
          new URL("../app/family/rewards/chess/page.tsx", import.meta.url),
        ),
      ),
    );
    doesNotMatch(chessClientSource, /ChildShellBar|ChildSwitcherOverlay/);
  });
});

describe("route compatibility", () => {
  it("keeps the assistant's dedicated install metadata", () => {
    ok(assistantPageSource.includes("FAMILY_ASSISTANT_MANIFEST_PATH"));
  });

  it("keeps the Family Board Home Screen start URL", () => {
    const manifest = JSON.parse(rootManifest) as { start_url?: string };
    equal(manifest.start_url, "/family/dashboard");
  });
});
