"use client";

// ---------------------------------------------------------------------------
// Small visual explanations (world-first 2026-10-03; UX-5a/5b). Each renders
// one `MistakeVisual` from the server view: the key with its finger on the
// hand diagram, the equal groups with their counters, the full beds with the
// leftovers beside them, the word with its gloss, the sentence with the
// spacing marks, the label target against what was typed. Pure presentation;
// the numbers and texts are the reviewed content the server put into the view.
// ---------------------------------------------------------------------------

import type { MistakeVisual } from "@/lib/family-learning-feedback";
import { HandsKeyboard, type HomePosition } from "./hands-keyboard";

export function SharingVisual({ quantity, groups, answer, unit, group }: { quantity: number; groups: number; answer: number; unit: string; group: string }) {
  const cols = Math.min(groups, 5);
  return (
    <figure className="rounded-2xl bg-white p-3 dark:bg-stone-900" data-testid="visual-sharing" aria-label={`${quantity} ${unit} auf ${groups} ${group}: ${answer} pro ${group}`}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: groups }).map((_, g) => (
          <div key={g} className="flex flex-col items-center gap-1 rounded-xl bg-amber-50 p-2 dark:bg-amber-950/40">
            <svg viewBox="0 0 60 60" className="h-14 w-14" aria-hidden>
              {Array.from({ length: Math.min(answer, 12) }).map((_, i) => {
                const per = Math.min(answer, 12) <= 6 ? 3 : 4;
                const cx = 12 + (i % per) * (36 / Math.max(1, per - 1));
                const cy = 14 + Math.floor(i / per) * 14;
                return <circle key={i} cx={cx} cy={cy} r={5} fill="#b45309" />;
              })}
            </svg>
            <span className="text-lg font-semibold text-primary">{answer}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-center text-base text-primary">
        {quantity} ÷ {groups} = <strong>{answer}</strong> {unit} pro {group.split("/")[0]}
      </figcaption>
    </figure>
  );
}

export function RemainderVisual({ quantity, groups, perGroup, used, remaining, unit, group }: { quantity: number; groups: number; perGroup: number; used: number; remaining: number; unit: string; group: string }) {
  return (
    <figure className="rounded-2xl bg-white p-3 dark:bg-stone-900" data-testid="visual-remainder" aria-label={`${groups} ${group} mit je ${perGroup}: ${used} ${unit} gepflanzt, ${remaining} übrig`}>
      <div className="flex flex-wrap items-end gap-2">
        {Array.from({ length: groups }).map((_, g) => (
          <div key={g} className="flex flex-col items-center gap-1 rounded-xl bg-amber-50 p-2 dark:bg-amber-950/40">
            <svg viewBox="0 0 60 44" className="h-12 w-14" aria-hidden>
              <rect x={2} y={28} width={56} height={12} rx={3} fill="#7c4a2a" />
              {Array.from({ length: perGroup }).map((_, i) => (
                <path key={i} d={`M${8 + i * 9} 28 c 0 -6 1 -10 2 -14 m -2 8 c -6 -1 -8 -5 -6 -9 c 4 1 6 4 6 9 m 2 -4 c 6 -1 8 -5 6 -9 c -4 1 -6 4 -6 9`} stroke="#2f7d32" strokeWidth={1.8} fill="none" strokeLinecap="round" />
              ))}
            </svg>
            <span className="text-base font-semibold text-primary">{perGroup}</span>
          </div>
        ))}
        <div className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-stone-400 p-2">
          <svg viewBox="0 0 60 44" className="h-12 w-14" aria-hidden>
            {Array.from({ length: Math.min(remaining, 6) }).map((_, i) => (
              <path key={i} d={`M${12 + i * 9} 40 c 0 -6 1 -10 2 -14 m -2 8 c -6 -1 -8 -5 -6 -9 c 4 1 6 4 6 9`} stroke="#2f7d32" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            ))}
          </svg>
          <span className="text-base font-semibold text-primary">{remaining} übrig</span>
        </div>
      </div>
      <figcaption className="mt-2 text-base text-primary">
        {groups} × {perGroup} = <strong>{used}</strong> gepflanzt · {quantity} − {used} = <strong>{remaining}</strong> übrig
      </figcaption>
    </figure>
  );
}

export function WordVisual({ word, gloss, emoji, language }: { word: string; gloss: string; emoji: string | null; language: "en" | "es" }) {
  return (
    <figure className="flex items-center gap-4 rounded-2xl bg-white p-4 dark:bg-stone-900" data-testid="visual-word">
      <span className="text-4xl" aria-hidden>
        {emoji ?? "🗣️"}
      </span>
      <div>
        <p className="text-2xl font-semibold text-primary" lang={language}>
          {word}
        </p>
        <p className="text-base text-tertiary" lang="de">
          = {gloss}
        </p>
      </div>
    </figure>
  );
}

export function SpacingVisual({ marked }: { marked: string }) {
  return (
    <figure className="rounded-2xl bg-white p-4 dark:bg-stone-900" data-testid="visual-spacing">
      <p className="font-mono text-xl text-primary" aria-label="Markierter Satz">
        {marked.split("|").map((part, i, all) => (
          <span key={i}>
            {part}
            {i < all.length - 1 ? <span className="mx-0.5 inline-block h-6 w-1 translate-y-1 rounded bg-amber-600 align-middle" aria-label="hier fehlt ein Leerzeichen" /> : null}
          </span>
        ))}
      </p>
    </figure>
  );
}

/** The label target against what was typed, character by character (mismatches underlined). */
export function LabelVisual({ target, typed }: { target: string; typed: string }) {
  const t = Array.from(target);
  const y = Array.from(typed);
  return (
    <figure className="rounded-2xl bg-white p-4 dark:bg-stone-900" data-testid="visual-label">
      <p className="text-sm text-tertiary">Auf dem Schild steht</p>
      <p className="font-mono text-2xl text-primary">{target}</p>
      <p className="mt-2 text-sm text-tertiary">Du hast geschrieben</p>
      <p className="font-mono text-2xl text-primary">
        {y.map((ch, i) => (
          <span key={i} className={ch === t[i] ? undefined : "text-red-700 underline decoration-wavy dark:text-red-300"}>
            {ch}
          </span>
        ))}
        {y.length < t.length ? <span className="text-tertiary">{"·".repeat(t.length - y.length)}</span> : null}
      </p>
    </figure>
  );
}

export function MistakeVisualView({ visual, fingers, home, compact = false }: { visual: MistakeVisual | null; fingers?: Record<string, string>; home?: HomePosition | null; compact?: boolean }) {
  if (!visual) return null;
  switch (visual.kind) {
    case "key":
      return (
        <div className="rounded-2xl bg-white p-2 dark:bg-stone-900" data-testid="visual-key">
          <HandsKeyboard fingers={fingers ?? {}} home={home ?? { left: ["a", "s", "d", "f"], right: ["j", "k", "l", "ö"], anchors: ["f", "j"], thumb: " " }} nextKey={visual.key} wrongKey={visual.typed} compact={compact} />
        </div>
      );
    case "sharing":
      return <SharingVisual {...visual} />;
    case "remainder":
      return <RemainderVisual {...visual} />;
    case "word":
      return <WordVisual {...visual} />;
    case "spacing":
      return <SpacingVisual marked={visual.marked} />;
    case "label":
      return <LabelVisual target={visual.target} typed={visual.typed} />;
  }
}
