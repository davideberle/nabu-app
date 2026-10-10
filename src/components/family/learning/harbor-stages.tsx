"use client";

// ---------------------------------------------------------------------------
// Visit 5 stages (content version 4, 2026-10-10; family-assistant DESIGN §7.6
// "Visit 5 — the harbor"): the island hub where the child walks (arrow keys,
// click/tap) or enters a workplace directly, the character beats of the three
// keepers, the harbor plan and the writing review of the child's own
// captain's-log sentence. Presentation only: every status, every finding and
// every line of dialogue comes from the server view / the reviewed content.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView, HarborWorkplaceView } from "@/lib/family-learning-state";
import { chipButton, focusRing, primaryButton, secondaryButton } from "@/app/family/(shell)/learn/mission/styles";
import { useDeliberateFocus } from "./focus";
import { HarborIsland, type IslandDestination, type IslandPlace } from "./harbor-island";
import { SpacingVisual } from "./visuals";
import type { WorldMarker } from "./expedition-world";

type Gate = () => boolean;
const alwaysOpen: Gate = () => true;

function Instruction({ children, kicker }: { children: React.ReactNode; kicker?: string }) {
  return (
    <div>
      {kicker ? <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{kicker}</p> : null}
      <h2 className="mt-1 text-2xl font-semibold leading-tight text-primary sm:text-3xl">{children}</h2>
    </div>
  );
}

const LANGUAGE_LABEL: Record<string, string> = { de: "Deutsch", en: "English", es: "Español" };

/**
 * One line of a keeper in their own language. A German translation is shown only on the child's tap; when `onTranslate` is
 * given (a language task is active) it is recorded as help BEFORE it is shown — on the island hub it is plain dialogue.
 */
export function CharacterBeat({ character, lineId, onTranslate, compact = false, testId = "character-beat" }: { character: NonNullable<HarborWorkplaceView["character"]>; lineId: string; onTranslate?: () => Promise<boolean>; compact?: boolean; testId?: string }) {
  const line = character.lines.find((l) => l.id === lineId) ?? character.lines[0];
  const [shown, setShown] = useState(false);
  const [pending, setPending] = useState(false);
  const translationRef = useRef<HTMLParagraphElement | null>(null);
  // The translate button disappears once the line is shown: keyboard focus moves onto the translation instead of being dropped.
  useEffect(() => {
    if (shown) translationRef.current?.focus();
  }, [shown]);
  if (!line) return null;
  const reveal = async () => {
    if (shown) return;
    if (onTranslate) {
      setPending(true);
      const ok = await onTranslate();
      setPending(false);
      if (!ok) return;
    }
    setShown(true);
  };
  return (
    <figure className={cn("rounded-3xl border border-amber-300/70 bg-[linear-gradient(135deg,#fff7e6,#fde8c4)] p-3 text-stone-900 shadow-xs dark:border-amber-700/50 dark:bg-[linear-gradient(135deg,#3b2a12,#4a3416)] dark:text-amber-50 sm:p-4", compact && "p-3")} data-testid={testId} data-character={character.id} data-language={character.language}>
      <div className="flex items-center gap-3">
        <CharacterFace id={character.id} />
        <figcaption className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-900/80 dark:text-amber-200/80">
          {character.name} · {character.role} · {LANGUAGE_LABEL[character.language] ?? character.language}
        </figcaption>
      </div>
      <blockquote className={cn("mt-2 font-medium leading-snug", compact ? "text-base" : "text-lg")} lang={character.language}>
        {line.text}
      </blockquote>
      {line.de ? (
        shown ? (
          <p ref={translationRef} tabIndex={-1} className={cn("mt-2 rounded-xl bg-white/80 px-3 py-2 text-base dark:bg-stone-900/70", focusRing)} lang="de" data-testid="character-translation">
            {line.de}
          </p>
        ) : (
          <button type="button" onClick={() => void reveal()} disabled={pending} className={cn("mt-2 inline-flex min-h-10 items-center rounded-full border border-amber-700/40 px-3 text-sm font-medium", focusRing)} data-testid="character-translate">
            Was heisst das?{onTranslate ? " (zählt als Hilfe)" : ""}
          </button>
        )
      ) : null}
    </figure>
  );
}

function CharacterFace({ id }: { id: string }) {
  const skin = "#f1c9a5";
  return (
    <svg viewBox="0 0 56 56" className="h-14 w-14 shrink-0" aria-hidden>
      <circle cx={28} cy={28} r={27} fill="#fde68a" stroke="#1c1917" strokeWidth={2} />
      <circle cx={28} cy={24} r={11} fill={skin} stroke="#1c1917" strokeWidth={2} />
      {id === "keeper" ? (
        <>
          <path d="M17 22 q 11 -14 22 0 v 3 q -11 -7 -22 0 Z" fill="#9ca3af" />
          <circle cx={23} cy={25} r={3.5} fill="none" stroke="#1c1917" strokeWidth={1.5} />
          <circle cx={33} cy={25} r={3.5} fill="none" stroke="#1c1917" strokeWidth={1.5} />
          <path d="M13 50 c 2 -12 9 -15 15 -15 s 13 3 15 15 Z" fill="#7c3aed" stroke="#1c1917" strokeWidth={2} />
        </>
      ) : id === "planner" ? (
        <>
          <path d="M15 20 q 13 -14 26 0 l 2 4 h -30 Z" fill="#fde047" stroke="#1c1917" strokeWidth={1.5} />
          <path d="M13 50 c 2 -12 9 -15 15 -15 s 13 3 15 15 Z" fill="#0ea5e9" stroke="#1c1917" strokeWidth={2} />
        </>
      ) : (
        <>
          <path d="M16 21 q 12 -12 24 0 v 2 h -28 Z" fill="#dc2626" />
          <path d="M13 50 c 2 -12 9 -15 15 -15 s 13 3 15 15 Z" fill="#f97316" stroke="#1c1917" strokeWidth={2} />
          <rect x={22} y={38} width={12} height={10} rx={2} fill="#fff7e6" />
        </>
      )}
      <circle cx={24} cy={24} r={1.3} fill="#1c1917" />
      <circle cx={32} cy={24} r={1.3} fill="#1c1917" />
      <path d="M24 29 q 4 3 8 0" stroke="#1c1917" strokeWidth={1.3} fill="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The island hub
// ---------------------------------------------------------------------------

const WORKPLACE_PLACE: Record<HarborWorkplaceView["id"], IslandPlace> = { typing: "workshop", planning: "office", closing: "harbormaster" };
const PLACE_WORKPLACE: Partial<Record<IslandPlace, HarborWorkplaceView["id"]>> = { workshop: "typing", office: "planning", harbormaster: "closing" };

const STATUS_TEXT: Record<string, string> = {
  open: "Offen — du kannst hier anfangen.",
  done: "Schon erledigt — gut gemacht.",
  current: "Angefangen — hier geht es weiter.",
  locked: "Noch zu: zuerst die Tipp-Werkstatt und das Planungsbüro.",
};

export function IslandStage({ view, markers, busy, gate = alwaysOpen, onEnter, onOpenWordbook, onOpenLogbook, onOpenSupplies }: { view: ChildView; markers: WorldMarker[]; busy: boolean; gate?: Gate; onEnter: (workplace: HarborWorkplaceView["id"]) => void; onOpenWordbook?: () => void; onOpenLogbook?: () => void; onOpenSupplies?: () => void }) {
  const harbor = view.harbor;
  const [arrived, setArrived] = useState<IslandDestination | null>(null);
  const [avatarAt, setAvatarAt] = useState<IslandPlace>(harbor?.entered.length ? WORKPLACE_PLACE[harbor.entered[harbor.entered.length - 1]] : "harbor");
  const enterRef = useRef<HTMLButtonElement | null>(null);
  const firstDirectRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(firstDirectRef, "island", { gate });
  useDeliberateFocus(enterRef, arrived && arrived.workplace && arrived.status === "open" ? `arrived:${arrived.id}` : null, { gate, enabled: !!(arrived && arrived.workplace && arrived.status === "open") });
  useEffect(() => {
    setArrived(null);
  }, [view.revision]);
  if (!harbor) return null;
  const wp = (id: HarborWorkplaceView["id"]) => harbor.workplaces.find((w) => w.id === id)!;
  const destinations: IslandDestination[] = [
    { id: "workshop", label: wp("typing").label, action: "Eintreten", enabled: true, status: wp("typing").status, workplace: "typing" },
    { id: "office", label: wp("planning").label, action: "Eintreten", enabled: true, status: wp("planning").status, workplace: "planning" },
    { id: "harbormaster", label: wp("closing").label, action: "Check starten", enabled: true, status: wp("closing").status, workplace: "closing" },
    { id: "shop", label: "Hafenladen · Rosa", action: "Hallo sagen", enabled: true },
    { id: "harbor", label: "Kai", action: "Umschauen", enabled: true },
    { id: "base", label: view.base.name ? `Basis „${view.base.name}“` : "Basis", action: "Umschauen", enabled: true },
    { id: "garden", label: "Garten", action: "Umschauen", enabled: true },
    { id: "station", label: "Station", action: "Umschauen", enabled: true },
    { id: "pier", label: "Steg", action: "Umschauen", enabled: true },
    { id: "wordbook", label: "Wörterbuch", action: "Öffnen", enabled: true },
  ];
  const supplier = harbor.characters.find((c) => c.id === "supplier") ?? null;
  const characterOf = (place: IslandPlace) => (place === "shop" ? supplier : PLACE_WORKPLACE[place] ? wp(PLACE_WORKPLACE[place]!).character : null);
  const arrive = (d: IslandDestination) => {
    setAvatarAt(d.id);
    setArrived(d);
    if (d.id === "wordbook") onOpenWordbook?.();
  };
  const openOnes = harbor.workplaces.filter((w) => w.status === "open" || w.status === "current");
  return (
    <div className="flex flex-col gap-4" data-testid="island-stage">
      <Instruction kicker="Auf der Insel">{openOnes.length === 1 && openOnes[0].id === "closing" ? "Beides geschafft — jetzt der kurze Check beim Hafenmeister." : "Wohin gehst du zuerst?"}</Instruction>
      <p className="text-base text-tertiary">Geh mit den Pfeiltasten oder tippe auf ein Ziel. Oder geh direkt hinein — die Knöpfe unten gehen immer.</p>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-primary bg-sky-200" data-testid="island-stage-frame">
        <HarborIsland scene={view.scene} markers={markers} pages={view.pages.length} harbor={harbor} variant="stage" destinations={destinations} avatarAt={avatarAt} onArrive={arrive} onOpenLogbook={onOpenLogbook} onOpenSupplies={onOpenSupplies} onOpenWordbook={onOpenWordbook} arriveHint={arrived ? null : "Wohin gehst du?"} />
      </div>
      {arrived ? (
        <div className="rounded-3xl border border-primary bg-primary p-4" role="status" data-testid="island-arrived" data-place={arrived.id} data-status={arrived.status ?? ""}>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">Du stehst vor</p>
          <p className="text-xl font-semibold text-primary">{arrived.label}</p>
          {characterOf(arrived.id) ? <div className="mt-2"><CharacterBeat character={characterOf(arrived.id)!} lineId="welcome" compact testId="island-character" /></div> : null}
          {arrived.workplace ? (
            <>
              <p className="mt-2 text-base text-primary" data-testid="island-arrived-status">
                {STATUS_TEXT[arrived.status ?? "locked"]}
              </p>
              {arrived.status === "open" || arrived.status === "current" ? (
                <button ref={enterRef} type="button" disabled={busy} onClick={() => onEnter(arrived.workplace!)} className={cn(primaryButton, "mt-3")} data-testid={`island-enter-${arrived.workplace}`}>
                  {arrived.action}
                </button>
              ) : null}
            </>
          ) : arrived.id === "shop" ? (
            <p className="mt-2 text-base text-tertiary">Rosa hilft dir im Planungsbüro weiter, wenn die Boote etwas brauchen.</p>
          ) : (
            <p className="mt-2 text-base text-tertiary">{placeNote(arrived.id, view)}</p>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Direkt eintreten" data-testid="island-direct">
        {harbor.workplaces.map((w, i) => {
          const enabled = w.status === "open" || w.status === "current";
          return (
            <button key={w.id} ref={i === 0 ? firstDirectRef : undefined} type="button" disabled={busy || !enabled} onClick={() => onEnter(w.id)} className={cn(chipButton, "min-h-14")} data-testid={`island-direct-${w.id}`} data-status={w.status} aria-label={`${w.label}: ${STATUS_TEXT[w.status]}`}>
              <span aria-hidden>{w.status === "done" ? "✓" : w.status === "locked" ? "🔒" : "→"}</span> {w.label}
            </button>
          );
        })}
        {onOpenWordbook ? (
          <button type="button" onClick={onOpenWordbook} className={secondaryButton} data-testid="island-wordbook">
            📖 Wörterbuch
          </button>
        ) : null}
      </div>
      <p className="text-xs text-tertiary">Stopp und speichern geht jederzeit oben links. Fertig ist der Besuch, wenn beide Werkstätten und der kurze Check gemacht sind.</p>
    </div>
  );
}

function placeNote(place: IslandPlace, view: ChildView): string {
  const s = view.scene;
  switch (place) {
    case "harbor":
      return s.harbor.fullBoats ? `${s.harbor.fullBoats} Boote sind voll, ${s.harbor.remaining} Kisten übrig${s.harbor.planned ? " — der Plan ist gespeichert" : ""}.` : "Hier warten die Kisten auf die Boote.";
    case "base":
      return s.name ? `Deine Basis „${s.name}“ — ${s.base === "tent" ? "ein Zelt" : "eine Hütte"}.` : "Noch keine Basis.";
    case "garden":
      return s.beds.filter((b) => b.id.startsWith("garden")).length ? "Die Gartenbeete aus Besuch 2." : "Hier kommt der Garten hin.";
    case "station":
      return s.station.built ? `Die Beobachtungsstation${s.station.lamp ? " — die Lampe brennt" : " — ohne Lampe"}.` : "Hier kommt die Station hin.";
    case "pier":
      return s.pier.built ? `Der Steg aus Besuch 4${s.pier.boat ? " — das Boot hat angelegt" : ""}.` : "Hier kommt der Steg hin.";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// The harbor plan — a reviewed destination, visibly consequential
// ---------------------------------------------------------------------------

export function HarborPlan({ view, busy, gate = alwaysOpen, onPlan }: { view: ChildView; busy: boolean; gate?: Gate; onPlan: (destination: string) => void }) {
  const harbor = view.harbor;
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(firstRef, "harbor-plan", { gate });
  if (!harbor) return null;
  const planner = harbor.workplaces.find((w) => w.id === "planning")?.character ?? null;
  return (
    <div className="flex flex-col gap-4" data-testid="harbor-plan">
      {planner ? <CharacterBeat character={planner} lineId="welcome" compact /> : null}
      <Instruction kicker="Dein Plan">Wohin fahren die Boote?</Instruction>
      {harbor.load ? (
        <p className="text-base text-primary" data-testid="harbor-plan-load">
          {harbor.load.fullBoats} Boote sind voll, {harbor.load.remaining} {harbor.load.remaining === 1 ? "Kiste bleibt" : "Kisten bleiben"} übrig{harbor.load.boatsNeeded ? ` — ${harbor.load.boatsNeeded} Boote fahren los` : ""}.
        </p>
      ) : null}
      <p className="text-base text-tertiary">
        Nach dem Speichern siehst du die Boote im Hafen{harbor.ropesAvailable ? " — mit den Seilen von Rosa festgemacht." : ". Ohne Seile von Rosa liegen die Boote lose am Kai — der Plan gilt trotzdem."}
      </p>
      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Ziel wählen">
        {harbor.destinations.map((d, i) => (
          <button key={d.id} ref={i === 0 ? firstRef : undefined} type="button" disabled={busy || harbor.planned} onClick={() => onPlan(d.id)} className={cn(chipButton, "min-h-20 flex-col")} data-testid={`harbor-destination-${d.id}`}>
            <span className="text-3xl" aria-hidden>
              {d.emoji}
            </span>
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The writing review of the child's own sentence — teach one or two points, keep the original
// ---------------------------------------------------------------------------

export function LogReview({ view, busy, gate = alwaysOpen, onSubmit, onSkip }: { view: ChildView; busy: boolean; gate?: Gate; onSubmit: (text: string, clarifications: Record<string, string>) => void; onSkip: () => void }) {
  const review = view.logReview;
  const [text, setText] = useState(review?.original ?? "");
  const [clarifications, setClarifications] = useState<Record<string, string>>({});
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const nothing = !review || review.taught.length === 0;
  useDeliberateFocus(ref, !nothing ? "log-review" : null, { gate, enabled: !nothing });
  useDeliberateFocus(continueRef, nothing ? "log-review-none" : null, { gate, enabled: nothing });
  if (!review) return null;
  const aspects = [...new Set(review.taught.map((t) => t.aspect))];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim(), clarifications);
      }}
      className="flex flex-col gap-4"
      data-testid="log-review"
      data-taught={aspects.join(",")}
    >
      <Instruction kicker="Dein Satz im Kapitänslogbuch">{nothing ? "An den geprüften Stellen gibt es nichts zu verbessern." : aspects.length === 1 ? `Heute schauen wir eins an: ${review.taught[0].aspectLabel}.` : `Heute schauen wir zwei Dinge an: ${aspects.map((a) => review.taught.find((t) => t.aspect === a)!.aspectLabel).join(" und ")}.`}</Instruction>
      <div className="rounded-2xl bg-secondary p-4">
        <p className="text-sm text-tertiary">Du hast geschrieben</p>
        <p className="mt-1 font-mono text-xl text-primary" data-testid="log-review-original">
          {review.original}
        </p>
      </div>
      <p className="text-base text-primary" data-testid="log-review-summary">
        {review.summary}
      </p>
      {review.taught.length ? (
        <ul className="space-y-2" data-testid="log-review-points">
          {review.taught.map((t) => (
            <li key={t.id} className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-950 dark:bg-amber-950/40 dark:text-amber-50" data-testid="log-review-point" data-aspect={t.aspect}>
              <span className="text-sm font-semibold uppercase tracking-wide text-amber-900/80 dark:text-amber-200/80">{t.aspectLabel}</span>
              <br />
              {t.teaching}
              {t.expected && t.aspect !== "spacing" ? (
                <>
                  {" "}
                  <span className="text-tertiary">Du:</span> <strong className="font-mono">{t.given}</strong> <span className="text-tertiary">→</span> <strong className="font-mono">{t.expected}</strong>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {review.marked ? <SpacingVisual marked={review.marked} /> : null}
      {review.suggestion ? (
        <div className="rounded-2xl border border-primary p-4" data-testid="log-review-suggestion">
          <p className="text-sm text-tertiary">So könnte er aussehen (Hilfe — abschreiben zählt nicht als selbst gemacht):</p>
          <p className="mt-1 font-mono text-xl text-primary">{review.suggestion}</p>
        </div>
      ) : null}
      {review.unknownWords.length ? (
        <div className="rounded-2xl bg-secondary p-4" data-testid="log-review-unknown">
          <p className="text-base text-primary">Ein Wort kenne ich nicht. Sag mir, was du meinst — das wird nicht bewertet.</p>
          {review.unknownWords.map((w) => (
            <label key={w} className="mt-2 flex flex-col gap-1 text-base text-primary">
              Was meinst du mit „{w}“?
              <input value={clarifications[w] ?? ""} onChange={(e) => setClarifications((c) => ({ ...c, [w]: e.target.value }))} maxLength={200} className={cn("min-h-12 rounded-2xl border-2 border-primary bg-primary px-4 text-lg text-primary", focusRing)} data-testid={`log-review-clarify-${w}`} autoComplete="off" />
            </label>
          ))}
        </div>
      ) : null}
      <label className="sr-only" htmlFor="log-review-text">
        Dein Satz
      </label>
      <textarea ref={ref} id="log-review-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-xl text-primary", focusRing)} data-testid="log-review-input" />
      <div className="flex flex-wrap gap-2">
        <button ref={nothing ? continueRef : undefined} type="submit" disabled={busy || !text.trim()} className={primaryButton} data-testid="log-review-save">
          {nothing ? "Weiter" : "Überarbeitung speichern"}
        </button>
        {!nothing ? (
          <button type="button" onClick={onSkip} disabled={busy} className={secondaryButton} data-testid="log-review-skip">
            So lassen
          </button>
        ) : null}
      </div>
      <p className="text-xs text-tertiary">Dein erster Satz bleibt gespeichert. Geprüft werden sechs Dinge (Inhalt, ganzer Satz, Leerzeichen, Grossschreibung, Schreibweise, Satzzeichen) — und nur die. Mehr als zwei Dinge üben wir heute nicht.</p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The wordbook — words met, with picture, meaning, example and a pronounce button; no scores
// ---------------------------------------------------------------------------

export function WordbookPanel({ view, onSay }: { view: ChildView; onSay?: (text: string, language: string) => void }) {
  const wordbook = view.wordbook;
  if (!wordbook || wordbook.languages.length === 0) {
    return (
      <p className="text-base text-tertiary" data-testid="wordbook-empty">
        Noch keine Wörter — sie kommen mit den Aufgaben dazu.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="wordbook">
      {wordbook.languages.map((lang) => (
        <section key={lang.language} aria-labelledby={`wordbook-${lang.language}`} data-testid={`wordbook-${lang.language}`}>
          <h3 id={`wordbook-${lang.language}`} className="text-lg font-semibold text-primary">
            {lang.label}
          </h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {lang.words.map((w) => (
              <li key={w.entryId} className="flex items-start gap-3 rounded-2xl border border-primary bg-primary p-3" data-testid={`wordbook-word-${w.entryId}`}>
                <span className="text-3xl" aria-hidden>
                  {w.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-primary">
                    <span lang={w.language}>{w.lemma}</span> <span className="font-normal text-tertiary">= {w.gloss}</span>
                  </p>
                  <p className="mt-1 text-sm text-tertiary" lang={w.language}>
                    {w.example}
                  </p>
                </div>
                {onSay ? (
                  <button type="button" onClick={() => onSay(w.say, w.language)} className={cn("min-h-12 min-w-12 rounded-full border border-primary text-xl", focusRing)} aria-label={`„${w.lemma}“ anhören`} data-testid="wordbook-say">
                    🔊
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-tertiary">{wordbook.note}</p>
    </div>
  );
}
