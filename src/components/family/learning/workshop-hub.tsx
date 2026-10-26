"use client";

// ---------------------------------------------------------------------------
// Isabel Visit 1 — her own learning entry: the workshop hub (Family → Lernen) and the start screen of the mission page.
// Built from HER view only (her content, her record): never Santiago's island, base, typing course or progress.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRef } from "react";
import { cn } from "@/components/ui/nabu";
import { AssistantPortrait } from "@/components/family/assistant-portrait";
import type { ChildView } from "@/lib/family-learning-state";
import type { ChildId } from "@/lib/family-assistant-turn";
import { WorkshopPictureView, WorkshopRoom } from "./workshop-pictures";

const big = "inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl px-8 text-xl font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";
const primary = { background: "#7a4a22", color: "white" } as const;

function Lila({ child, children }: { child: ChildId; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-3xl p-5" style={{ background: "#f6ecdc" }} data-testid="workshop-lila">
      <AssistantPortrait child={child} className="h-24 w-24 shrink-0" />
      <div className="grid gap-1">
        <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#7a4a22" }}>Old Lila</p>
        {children}
      </div>
    </div>
  );
}

/** Family → Lernen for Isabel: one action (start / continue), her finished visits, nothing else. */
export function IsabelHub({ child, view }: { child: ChildId; view: ChildView }) {
  const running = view.visit;
  const done = view.progress.completedTotal;
  const missionHref = `/family/learn/mission?child=${child}`;
  const made = view.latestInterest;
  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-6" data-testid="world-screen" data-world-next={view.next.visit ?? ""} data-world-running={running?.id ?? ""} data-child="isabel">
      <Link href={`/family/home?child=${child}`} className="justify-self-start text-base text-tertiary underline underline-offset-4">
        ← Home
      </Link>
      <Lila child={child}>
        <h1 className="text-3xl font-semibold text-primary">Old Lilas kleine Werkstatt</h1>
        <p className="text-xl text-primary" data-testid="world-next-step">
          {view.nextStep}
        </p>
      </Lila>
      <div className="flex flex-wrap items-center gap-4">
        <WorkshopPictureView id="chair-wood" className="h-20 w-20" />
        <WorkshopPictureView id="window-glass" className="h-20 w-20" />
        <WorkshopPictureView id="wall-brick" className="h-20 w-20" />
        <WorkshopPictureView id="shelf-wood" className="h-20 w-20" />
      </div>
      {running || view.next.visit ? (
        <Link href={missionHref} className={cn(big, "justify-self-start")} style={primary} data-testid="cockpit-start">
          {running ? "Weiter in der Werkstatt" : "Zur Werkstatt"} <span aria-hidden>→</span>
        </Link>
      ) : null}
      {done ? (
        <p className="text-base text-tertiary" data-testid="isabel-done">
          {done === 1 ? "Ein Besuch fertig." : `${done} Besuche fertig.`}
          {made?.text ? ` Für nächstes Mal: «${made.text}».` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** The mission page before (or between) visits, for Isabel. */
export function IsabelStart({ child, view, busy, onStart, notice }: { child: ChildId; view: ChildView; busy: boolean; onStart: () => void; notice: string | null }) {
  const startRef = useRef<HTMLButtonElement | null>(null);
  const nextDef = view.next.visit;
  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-6" data-testid="start-screen" data-child="isabel">
      <Link href={`/family/learn?child=${child}`} className="justify-self-start text-base text-tertiary underline underline-offset-4">
        ← Zurück
      </Link>
      <Lila child={child}>
        <p className="text-2xl text-primary">{view.hook}</p>
      </Lila>
      <WorkshopRoom made={null} label="Ein leeres Zimmer — was baust du hinein?" />
      <div className="grid gap-3">
        <h1 className="text-2xl font-semibold text-primary">{view.nextStep}</h1>
        {notice ? <p className="text-base text-primary">{notice}</p> : null}
        {nextDef ? (
          <button ref={startRef} type="button" onClick={onStart} disabled={busy} className={cn(big, "justify-self-start")} style={primary} data-testid="start-visit" data-visit={nextDef}>
            Los geht&apos;s
          </button>
        ) : null}
      </div>
    </div>
  );
}
