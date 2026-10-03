"use client";

// ---------------------------------------------------------------------------
// Story beats (world-first 2026-10-03; UX-1; visual round 1 V3). The
// mission's narrative — who needs help, what is made, what counts as done —
// is shown as SHORT illustrated beats, each with a speaker and a small scene
// illustration (station / garden / lamp / base / team), visibly separate from
// task instructions. Text comes verbatim from the reviewed content; the beat
// adds only the speaker frame and the illustration — nothing is paraphrased.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { cn } from "@/components/ui/nabu";

export type StoryBeatSpeaker = "radio" | "team" | "logbook" | "mara";
export type StoryScene = "station" | "garden" | "lamp" | "base" | "team" | "page" | "none";

function Speaker({ speaker }: { speaker: StoryBeatSpeaker }) {
  return (
    <svg viewBox="0 0 56 56" className="h-14 w-14 shrink-0" aria-hidden>
      <circle cx={28} cy={28} r={27} fill="#fde68a" stroke="#1c1917" strokeWidth={2} />
      {speaker === "mara" ? (
        <>
          <circle cx={28} cy={22} r={9} fill="#f1c9a5" stroke="#1c1917" strokeWidth={2} />
          <path d="M19 20 q 9 -12 18 0 v 4 q -9 -6 -18 0 Z" fill="#5b3a12" />
          <path d="M13 48 c 2 -12 9 -15 15 -15 s 13 3 15 15 Z" fill="#0ea5e9" stroke="#1c1917" strokeWidth={2} />
          <rect x={22} y={34} width={12} height={7} rx={2} fill="#fff7e6" stroke="#1c1917" strokeWidth={1.5} />
        </>
      ) : speaker === "radio" ? (
        <>
          <rect x={15} y={22} width={26} height={18} rx={4} fill="#1c1917" />
          <circle cx={23} cy={31} r={5} fill="#fde68a" />
          <rect x={31} y={27} width={7} height={3} fill="#fde68a" />
          <rect x={31} y={32} width={7} height={3} fill="#fde68a" />
          <line x1={34} y1={22} x2={41} y2={11} stroke="#1c1917" strokeWidth={3} strokeLinecap="round" />
        </>
      ) : speaker === "team" ? (
        <>
          <circle cx={21} cy={22} r={6} fill="#1c1917" />
          <circle cx={35} cy={22} r={6} fill="#1c1917" />
          <path d="M10 42 c 2 -9 8 -12 11 -12 s 9 3 11 12 Z M24 42 c 2 -9 8 -12 11 -12 s 9 3 11 12 Z" fill="#1c1917" />
        </>
      ) : (
        <>
          <rect x={17} y={14} width={22} height={28} rx={2} fill="#1c1917" />
          <rect x={20} y={17} width={16} height={22} rx={1} fill="#fde68a" />
          <line x1={23} y1={23} x2={33} y2={23} stroke="#1c1917" strokeWidth={1.5} />
          <line x1={23} y1={28} x2={33} y2={28} stroke="#1c1917" strokeWidth={1.5} />
          <line x1={23} y1={33} x2={29} y2={33} stroke="#1c1917" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

/** A small original scene illustration for a beat (station tower, beds, lamp, hut, team, page). */
export function SceneArt({ scene, className }: { scene: StoryScene; className?: string }) {
  if (scene === "none") return null;
  return (
    <svg viewBox="0 0 160 110" className={cn("h-24 w-36 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={`beat-sky-${scene}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe6fb" />
          <stop offset="1" stopColor="#fdf1cf" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={160} height={110} rx={14} fill={`url(#beat-sky-${scene})`} />
      <rect x={0} y={70} width={160} height={40} fill="#4fb6e6" opacity={0.6} />
      <ellipse cx={80} cy={82} rx={70} ry={18} fill="#f0dba7" />
      {scene === "station" || scene === "lamp" ? (
        <>
          <rect x={64} y={40} width={32} height={40} rx={3} fill="#cbd5e1" stroke="#475569" strokeWidth={1.5} />
          <rect x={72} y={22} width={16} height={22} rx={2} fill="#e2e8f0" stroke="#475569" strokeWidth={1.5} />
          <circle cx={80} cy={18} r={7} fill={scene === "lamp" ? "#fde68a" : "#94a3b8"} stroke={scene === "lamp" ? "#f59e0b" : "#475569"} strokeWidth={2.5} />
          {scene === "lamp" ? <polygon points="80,18 50,80 110,80" fill="#fde68a" opacity={0.45} /> : null}
          {scene === "station" ? [0, 1, 2].map((i) => <rect key={i} x={20 + i * 14} y={66} width={10} height={8} rx={2} fill="#7c4a2a" />) : null}
        </>
      ) : null}
      {scene === "garden" ? (
        <>
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(${34 + i * 26} 62)`}>
              <rect x={0} y={8} width={22} height={10} rx={2} fill="#7c4a2a" />
              {[4, 11, 18].map((x) => (
                <path key={x} d={`M${x} 8 c 0 -5 1 -8 1 -11 m -1 6 c -4 -1 -6 -4 -5 -7 c 3 1 5 3 5 7`} stroke="#2f7d32" strokeWidth={1.6} fill="none" strokeLinecap="round" />
              ))}
            </g>
          ))}
        </>
      ) : null}
      {scene === "base" ? (
        <>
          <rect x={52} y={48} width={56} height={32} fill="#d8c3a5" stroke="#9a6f43" strokeWidth={1.5} />
          <polygon points="46,48 80,22 114,48" fill="#b2412f" stroke="#7f2d22" strokeWidth={1.5} />
          <rect x={74} y={60} width={12} height={20} fill="#4a2e14" />
        </>
      ) : null}
      {scene === "team" ? (
        <>
          {[52, 80, 108].map((x, i) => (
            <g key={x}>
              <circle cx={x} cy={44} r={9} fill="#f1c9a5" stroke="#1c1917" strokeWidth={1.5} />
              <path d={`M${x - 14} 80 c 2 -14 10 -18 14 -18 s 12 4 14 18 Z`} fill={["#0ea5e9", "#f97316", "#15803d"][i]} stroke="#1c1917" strokeWidth={1.5} />
            </g>
          ))}
        </>
      ) : null}
      {scene === "page" ? (
        <>
          <rect x={52} y={26} width={56} height={60} rx={4} fill="#fff7e6" stroke="#7c2d12" strokeWidth={2} />
          {[40, 50, 60, 70].map((y) => (
            <line key={y} x1={60} y1={y} x2={100 - (y === 70 ? 20 : 0)} y2={y} stroke="#a8a29e" strokeWidth={2} />
          ))}
        </>
      ) : null}
    </svg>
  );
}

const SPEAKER_LABEL: Record<StoryBeatSpeaker, string> = { radio: "Funkspruch", team: "Vom Team", logbook: "Aus dem Logbuch", mara: "Mara, Biologin" };

export type Beat = { text: string; scene?: StoryScene };

/**
 * One or more short beats. Each beat is one reviewed sentence with its own small scene; the speaker frames the whole set.
 * `lines` (legacy) renders a single beat per line without scenes.
 */
export function StoryBeat({ speaker = "radio", beats, lines, aside, compact = false, className, testId = "story-beat" }: { speaker?: StoryBeatSpeaker; beats?: Beat[]; lines?: string[]; aside?: ReactNode; compact?: boolean; className?: string; testId?: string }) {
  const items: Beat[] = beats ?? (lines ?? []).map((text) => ({ text }));
  return (
    <figure className={cn("rounded-3xl border border-amber-300/70 bg-[linear-gradient(135deg,#fff7e6,#fde8c4)] p-3 text-stone-900 shadow-xs dark:border-amber-700/50 dark:bg-[linear-gradient(135deg,#3b2a12,#4a3416)] dark:text-amber-50 sm:p-4", className)} data-testid={testId} data-story-speaker={speaker} data-beats={items.length}>
      <div className="flex items-center gap-3">
        <Speaker speaker={speaker} />
        <figcaption className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-900/80 dark:text-amber-200/80">{SPEAKER_LABEL[speaker]}</figcaption>
      </div>
      <blockquote className={cn("mt-3 grid gap-3", items.length > 1 && !compact && "sm:grid-cols-3")} lang="de">
        {items.map((b, i) => (
          <div key={i} className={cn("flex gap-3", items.length > 1 && !compact ? "flex-col" : "items-center")} data-testid="story-beat-item">
            {b.scene && b.scene !== "none" ? <SceneArt scene={b.scene} className={items.length > 1 && !compact ? "h-24 w-full" : "h-16 w-24"} /> : null}
            <p className={cn("font-medium leading-snug", compact ? "text-base" : "text-lg")}>{b.text}</p>
          </div>
        ))}
      </blockquote>
      {aside ? <div className="mt-2">{aside}</div> : null}
    </figure>
  );
}
