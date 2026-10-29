"use client";

// ---------------------------------------------------------------------------------------------------------------------
// Visit narration in the UI (Isabel Visit 2, 2026-10-29; I2-04): ONE control per screen.
//  - After the deliberate start the current screen's script plays by itself, once per new state (`script.key`).
//  - While speaking the control is «Stopp»; afterwards «Nochmal hören»; before any tap (reload) or when the browser refused to
//    play, one big «Vorlesen» — the tap unlocks audio and reads the current screen. Nothing here advances the visit.
//  - A new screen supersedes the old speech at once (the player drops late audio); leaving the page stops it.
// ---------------------------------------------------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { NarrationScript } from "@/lib/family-learning-narration";
import type { NarrationPlayer, NarrationStatus } from "@/lib/family-narration-player";

export type NarrationTelemetry = (name: "narration-replay" | "narration-stop" | "narration-unlock") => void;

/** Plays `script` whenever its key changes (if audio was unlocked by a tap). Returns the player status and the two actions. */
export function useNarration(player: NarrationPlayer, script: NarrationScript | null, telemetry?: NarrationTelemetry) {
  const [status, setStatus] = useState<NarrationStatus>(player.status());
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const run = useCallback(async (s: NarrationScript | null) => {
    if (!s) {
      player.stop();
      setStatus(player.status());
      return;
    }
    const p = player.play(s);
    setStatus(player.status());
    await p;
    setStatus(player.status());
  }, [player]);
  const key = script?.key ?? "";
  useEffect(() => {
    void run(scriptRef.current);
  }, [key, run]);
  // Leaving the screen (unmount, route change) silences it.
  useEffect(() => () => player.stop(), [player]);
  const replay = useCallback(() => {
    const unlocking = !player.isUnlocked() || player.status() === "blocked";
    if (unlocking) {
      player.unlock();
      telemetry?.("narration-unlock");
    } else telemetry?.("narration-replay");
    void run(scriptRef.current);
  }, [player, run, telemetry]);
  const stop = useCallback(() => {
    telemetry?.("narration-stop");
    player.stop();
    setStatus(player.status());
  }, [player, telemetry]);
  return { status, replay, stop };
}

const SpeakerGlyph = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden fill="currentColor">
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
);

/** The one narration control of a screen. `big` = the prominent «Vorlesen» before audio is unlocked. */
export function NarrationControl({ status, onReplay, onStop, className }: { status: NarrationStatus; onReplay: () => void; onStop: () => void; className?: string }) {
  const base = "inline-flex min-h-14 items-center justify-center gap-2 rounded-full px-5 text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
  if (status === "speaking")
    return (
      <button type="button" className={cn(base, className)} style={{ background: "#3d5a2a", color: "white" }} onClick={onStop} data-testid="narration-control" data-state="speaking" aria-label="Vorlesen stoppen">
        <span aria-hidden>■</span> Stopp
      </button>
    );
  if (status === "locked" || status === "blocked")
    return (
      <button type="button" className={cn(base, "min-h-16 px-7 text-xl ring-4 ring-amber-300", className)} style={{ background: "#3d5a2a", color: "white" }} onClick={onReplay} data-testid="narration-control" data-state={status} aria-label="Vorlesen">
        <span aria-hidden>▶</span> Vorlesen
      </button>
    );
  if (status === "unavailable")
    return (
      <button type="button" className={cn(base, className)} style={{ background: "#f3efe6", color: "#5b4a33" }} onClick={onReplay} data-testid="narration-control" data-state="unavailable" aria-label="Keine deutsche Stimme auf diesem Gerät. Nochmal versuchen">
        <span aria-hidden>🔇</span> Keine Stimme
      </button>
    );
  return (
    <button type="button" className={cn(base, className)} style={{ background: "#e7efd9", color: "#2f4a1f" }} onClick={onReplay} data-testid="narration-control" data-state="idle" aria-label="Nochmal hören">
      <SpeakerGlyph /> Nochmal hören
    </button>
  );
}
