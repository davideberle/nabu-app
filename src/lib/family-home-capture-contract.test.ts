// ---------------------------------------------------------------------------
// Source contract for the child Home and the guided "Record something I did"
// flow (family-assistant DESIGN.md §2.1 / Family DESIGN.md Phase R7 /
// companion-app DESIGN.md Phase I5). Same style as the other UI contract
// suites: `node --test` has no DOM, so the load-bearing invariants are pinned
// against the client source.
// ---------------------------------------------------------------------------

import { doesNotMatch, match, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("child Home contract", () => {
  const client = readSource("../app/family/(shell)/assistant/client.tsx");

  it("presents exactly the four approved Home actions", () => {
    match(client, /Record something I did/);
    match(client, /Ask Nabu/);
    match(client, />Music</);
    match(client, /Hörspiele/);
  });

  it("routes Record and Hörspiele with the selected child", () => {
    match(client, /\/family\/assistant\/record\?child=\$\{profile\.id\}/);
    match(client, /\/family\/listen\?child=\$\{profile\.id\}/);
  });

  it("keeps Home actions at large tap sizes", () => {
    match(client, /min-h-24 items-center gap-4 rounded-2xl/);
  });

  it("starts on Home and keeps the talk dock out of it", () => {
    match(client, /useState<Stage>\(\{ kind: "home" \}\)/);
    match(client, /stage\.kind !== "home" && \(/);
  });

  it("keeps Music on the existing conversation contract, not a new transport", () => {
    match(client, /enterConversation\("music"\)/);
    // Music framing changes copy/starters only; the turn still goes through
    // the one child-turn client.
    doesNotMatch(client, /\/api\/music\//);
  });
});

describe("guided record flow contract", () => {
  const client = readSource("../app/family/(shell)/assistant/record/client.tsx");

  it("is a shell surface owned by the selected child", () => {
    match(client, /useChildShell\(\)/);
    // Keyed by child so a mid-capture profile switch discards the draft
    // instead of submitting it under the sibling's identity.
    match(client, /<RecordWorkspace key=\{child\} child=\{child\} \/>/);
  });

  it("hides categories whose routine a parent disabled", () => {
    match(client, /resolveShellRoutines\(config\)/);
  });

  it("a hung transcription is escapable and abortable", () => {
    match(client, /AbortController/);
    match(client, /signal: abort\.signal/);
  });

  it("captures through the hardened push-to-talk and Scribe v2 path", () => {
    match(client, /startPushToTalk/);
    match(client, /\/api\/family\/transcribe/);
    // Truthful startup: never claims recording before the recorder is live.
    match(client, /Turning the microphone on/);
  });

  it("shows and speaks the task-specific prompt", () => {
    match(client, /category\.prompt/);
    match(client, /speak\(\{ childId: child, text: category\.prompt \}\)/);
  });

  it("offers one large Start/Stop control at the talk-button size", () => {
    match(client, /TALK_BUTTON_SIZE_CLASS/);
    match(client, /"Stop recording"/);
    match(client, /"Start recording"/);
  });

  it("reviews an editable transcript with retry and cancel", () => {
    match(client, /<textarea/);
    match(client, /Say it again/);
    match(client, /Cancel/);
    match(client, /checkChildUtterance/);
  });

  it("submits every guided capture as pending_review with the routine identity", () => {
    match(client, /status: "pending_review"/);
    match(client, /guidedRoutineFor\(child, category\.id\)/);
    // No path in this surface can submit an instantly-earning completion.
    doesNotMatch(client, /status: "done"/);
  });

  it("shows a calm awaiting-review receipt with no provisional coin", () => {
    match(client, /waiting for Mama or Papa/);
    // No coin language or glyphs anywhere in the rendered code — the word
    // appears only in comments describing this exact rule.
    const codeOnly = client
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    doesNotMatch(codeOnly, /coin/i);
    doesNotMatch(codeOnly, /🪙/);
    doesNotMatch(codeOnly, /earned/i);
  });

  it("never persists audio", () => {
    // The blob goes to the transcription route and nowhere else: no object
    // URLs kept, no upload to storage, no audio in the completion payload.
    doesNotMatch(client, /createObjectURL/);
    doesNotMatch(client, /voiceMemoUrl/);
    doesNotMatch(client, /new FileReader/);
  });

  it("keeps ordinary controls at or above the 48 px floor", () => {
    match(client, /min-h-12/);
    doesNotMatch(client, /min-h-11/);
    doesNotMatch(client, /\bh-11 w-11\b/);
    // No bare lg: variants (the shell's responsive contract).
    doesNotMatch(client, /\blg:(?!landscape:)/);
  });
});

describe("canonical review queue consumers", () => {
  it("the compact parent tools render the canonical cross-week queue and act by identity with the expected status and submission time", () => {
    const parent = readSource("../app/family/parent/client.tsx");
    match(parent, /\/api\/family\/review-queue/);
    match(parent, /snapshotId/);
    match(parent, /expectedStatus: item\.status, expectedSubmittedAt: item\.submittedAt \?\? null/);
    match(parent, /res\.status === 409/);
    // Every retained parent action lives here (PR-01): approve/hold/redo, undo, count correction, config, parent-assisted capture.
    match(parent, /action: "set-credit-count"/);
    match(parent, /method: "DELETE"/);
    match(parent, /"\/api\/family\/config", \{ method: "PUT"/);
    match(parent, /parentAssisted: true/);
  });

  it("the legacy board and person grid are gone; only redirects remain", () => {
    ok(!existsSync(new URL("../app/family/dashboard/client.tsx", import.meta.url)));
    ok(!existsSync(new URL("../app/family/dashboard/[person]/client.tsx", import.meta.url)));
    const board = readSource("../app/family/dashboard/page.tsx");
    match(board, /redirect\(/);
  });

  it("the queue route is read-only and never cached", () => {
    const route = readSource("../app/api/family/review-queue/route.ts");
    match(route, /export async function GET/);
    ok(!route.includes("export async function POST"));
    ok(!route.includes("export async function PATCH"));
    ok(!route.includes("export async function DELETE"));
    match(route, /no-store, private/);
    match(route, /buildReviewQueueSnapshot/);
    // Trusted-runtime bearer read for the briefing/Nabu adapter, fail closed.
    match(route, /getTrustedRuntimeToken/);
    match(route, /tokensMatch/);
    match(route, /isAdminEmail/);
  });
});
