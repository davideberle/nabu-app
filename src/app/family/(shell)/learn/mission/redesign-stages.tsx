"use client";

// Visit-4 stages of the approved learning redesign (2026-09-29): station
// choice, the Swiss-German typing course with its input-alignment check, the
// station build, the spacing revision of the child's own sentence and the
// evidence-bound visit summary. Presentation only: every claim shown here
// comes from the server view; every decision is made by the state machine.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { BaseScene } from "@/components/family/learning/base-scene";
import type { ChildView, LearningOp } from "@/lib/family-learning-state";
import type { LearningMutateOutcome } from "@/lib/family-learning-client";
import { applySaveOutcome, commitLine, createTypingDraft, markSaving, previewLine, typeInto, type TypingDraft } from "@/lib/family-learning-typing";
import { nextExpectedChar } from "@/lib/family-learning-typing-metrics";
import { applySubmitOutcome, canSend, markSending, payloadKeyOf, submitDraftFor, type SubmitDraft } from "@/lib/family-learning-submit-draft";
import { clearDraft, loadDraft, saveDraft, type DraftIdentity, type DraftStorage } from "@/lib/family-learning-draft-store";
import { chipButton, focusRing, primaryButton, secondaryButton } from "./styles";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}`);

// ---------------------------------------------------------------------------
// Station choice — a child choice, never an inferred interest
// ---------------------------------------------------------------------------

export function StationChoice({ view, busy, onChoose }: { view: ChildView; busy: boolean; onChoose: (theme: string) => void }) {
  const station = view.station;
  const intro = view.visit?.intro ?? null;
  if (!station) return null;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-primary">Was soll deine Station beobachten?</h2>
      {intro ? (
        <div className="rounded-2xl bg-secondary p-4 text-base text-primary" data-testid="mission-intro">
          <p>{intro.who}</p>
          <p className="mt-1">{intro.make}</p>
          <p className="mt-1 text-tertiary">{intro.done}</p>
        </div>
      ) : null}
      <p className="text-base text-tertiary" data-testid="station-reference" data-reference={station.reference.kind}>
        {station.reference.text}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {station.themes.map((theme) => (
          <button key={theme.id} type="button" disabled={busy} onClick={() => onChoose(theme.id)} className={cn(chipButton, "min-h-24 flex-col items-start text-left")} data-testid={`station-theme-${theme.id}`}>
            <span className="text-2xl" aria-hidden>
              {theme.emoji}
            </span>
            <span>{theme.label}</span>
            <span className="text-sm font-normal text-tertiary">{theme.purpose}</span>
          </button>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={() => onChoose("none")} className={cn(secondaryButton, "self-start")}>
        Lieber eine Station ohne Thema
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Station build — click/keyboard, visibly consequential
// ---------------------------------------------------------------------------

export function StationBuild({ view, busy, onBuild }: { view: ChildView; busy: boolean; onBuild: (spot: string) => void }) {
  const station = view.station;
  if (!station) return null;
  const theme = station.themes.find((t) => t.id === station.theme) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-primary">Wo soll die Station stehen?</h2>
      <p className="text-base text-tertiary">
        {theme ? `${theme.emoji} ${theme.label}. ` : ""}
        Tippe auf einen Platz oder wähle ihn mit der Tastatur. Nach dem Bauen siehst du die Station oben in deiner Basis
        {station.lampAvailable ? " — mit der Lampe, die du bestellt hast." : ". Ohne Lampe: das Team hat keine bekommen — sie bleibt dunkel."}
      </p>
      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Platz für die Station">
        {station.spots.map((spot) => (
          <button key={spot.id} type="button" disabled={busy} onClick={() => onBuild(spot.id)} className={cn(chipButton, "min-h-20 flex-col")} data-testid={`station-spot-${spot.id}`}>
            <span className="text-3xl" aria-hidden>
              {spot.emoji}
            </span>
            {spot.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing course — setup check first, then short bursts with next-key guidance
// ---------------------------------------------------------------------------

const UNAVAILABLE_TEXT: Record<string, string> = {
  "layout-unconfirmed": "Das Finger-Training kommt, sobald deine Eltern die Tastatur bestätigt haben (Einstellungen im Eltern-Bereich).",
  "no-course-for-layout": "Für diese Tastatur gibt es noch keinen Kurs. Es wird nichts anderes ersatzweise geübt.",
};

function AlignmentCheck({ view, busy, onCheck }: { view: ChildView; busy: boolean; onCheck: (observed: string[]) => void }) {
  const course = view.typingCourse!;
  const [observed, setObserved] = useState<string[]>(() => course.alignment.keys.map(() => ""));
  const result = course.alignment.result;
  const complete = observed.every((c) => Array.from(c).length === 1);
  return (
    <div className="rounded-2xl bg-secondary p-4" data-testid="alignment-check">
      <p className="text-base font-semibold text-primary">Tastatur-Check</p>
      <p className="mt-1 text-sm text-tertiary">
        Deine Eltern haben bestätigt: {course.layoutLabel ?? "?"}. Jetzt prüfen wir, ob der Computer dieselben Zeichen schreibt. Drück einfach die Taste — es gibt keine Punkte.
      </p>
      {result && result.result === "mismatch" ? (
        <div className="mt-3 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="alignment-mismatch">
          <p>
            Der Computer schreibt andere Zeichen als die bestätigte Tastatur{result.matchesLayout ? ` (es sieht aus wie „${course.layoutLabels[result.matchesLayout] ?? result.matchesLayout}“)` : ""}. Das Finger-Training bleibt gesperrt, bis die Eingabequelle passt.
          </p>
          <p className="mt-1">Für die Eltern: Systemeinstellungen → Tastatur → Eingabequellen → „Deutsch (Schweiz)“ wählen, dann den Check wiederholen.</p>
          <ul className="mt-1 list-disc pl-5">
            {result.observed.map((o) => (
              <li key={o.id}>
                erwartet „{o.expected}“, bekommen „{o.got}“
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ol className="mt-3 space-y-2">
        {course.alignment.keys.map((key, i) => (
          <li key={key.id} className="flex flex-wrap items-center gap-2">
            <span className="text-base text-primary">{key.prompt}</span>
            <input
              value={observed[i]}
              onChange={(e) => setObserved((o) => o.map((v, j) => (j === i ? Array.from(e.target.value).slice(-1).join("") : v)))}
              maxLength={2}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn("min-h-12 w-16 rounded-xl border border-primary bg-primary text-center font-mono text-2xl text-primary", focusRing)}
              aria-label={key.prompt}
              data-testid={`alignment-key-${key.id}`}
            />
          </li>
        ))}
      </ol>
      <button type="button" disabled={busy || !complete} onClick={() => onCheck(observed)} className={cn(primaryButton, "mt-3")} data-testid="alignment-submit">
        {result ? "Nochmal prüfen" : "Prüfen"}
      </button>
    </div>
  );
}

const COMFORT_LABEL: Record<string, string> = { easy: "Leicht", ok: "Ging gut", hard: "Anstrengend" };

export function TypingCourse({
  view,
  busy,
  onCheck,
  onBurst,
  onContinue,
}: {
  view: ChildView;
  busy: boolean;
  onCheck: (observed: string[]) => void;
  onBurst: (op: LearningOp & { op: "typing-burst" }, idempotencyKey: string) => Promise<LearningMutateOutcome | null>;
  onContinue: () => void;
}) {
  const course = view.typingCourse!;
  const lesson = course.lesson;
  const [draft, setDraft] = useState<TypingDraft | null>(() => (lesson ? createTypingDraft(lesson.id, lesson.lines) : null));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [comfort, setComfort] = useState<"easy" | "ok" | "hard" | null>(null);
  // The durable server decision is restored on mount, reload, after a lost
  // acknowledgement (replayed outcome) and across the lesson change of an
  // "advance" (R2-2): the child sees the decision and its next-step choice
  // instead of a silently restarted full burst. A previous lesson's advance
  // stays visible until the child deliberately starts the next lesson.
  const savedDecision = durableDecision(course, lesson);
  const [lastDecision, setLastDecision] = useState<{ action: string; reason: string } | null>(savedDecision ? { action: savedDecision.action, reason: savedDecision.reason } : null);
  const [choosing, setChoosing] = useState<boolean>(savedDecision !== null);
  const lessonId = lesson?.id ?? null;
  useEffect(() => {
    // A new lesson (after "advance") gets a fresh draft; the decision card stays until the child chooses.
    setDraft(lesson ? createTypingDraft(lesson.id, lesson.lines) : null);
    setComfort(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);
  const startBurst = (lines: readonly string[]) => {
    if (!lesson) return;
    setDraft(createTypingDraft(lesson.id, lines));
    setComfort(null);
    setLastDecision(null);
    setChoosing(false);
  };

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current || !lesson || current.phase === "saving" || !current.idempotencyKey || !comfort) return;
    setDraft(markSaving(current));
    const seconds = current.startedAtMs !== null && current.completedAtMs !== null ? Math.max(0, Math.round((current.completedAtMs - current.startedAtMs) / 1000)) : 0;
    const outcome = await onBurst({ op: "typing-burst", lessonId: lesson.id, lines: [...current.typedLines], seconds, comfort }, current.idempotencyKey);
    const latest = draftRef.current;
    if (!latest || latest.phase !== "saving") return;
    if (!outcome) {
      setDraft(applySaveOutcome(latest, { kind: "network" }));
      return;
    }
    if (outcome.ok && (outcome.status === "applied" || outcome.status === "replayed")) {
      setDraft(applySaveOutcome(latest, { kind: outcome.status }));
      // The decision comes from the server VIEW (durable state), so a replayed
      // retry after a lost acknowledgement restores it exactly like an applied one.
      const d = outcome.view.typingCourse?.decision ?? null;
      if (d && d.action !== "start") {
        setLastDecision({ action: d.action, reason: d.reason });
        setChoosing(true);
      }
      return;
    }
    if (outcome.ok && outcome.status === "stale") {
      setDraft(applySaveOutcome(latest, { kind: "stale", lessonDoneOnServer: false }));
      return;
    }
    if (!outcome.ok && "status" in outcome && outcome.status === "refused") {
      setDraft(applySaveOutcome(latest, { kind: "refused" }));
      return;
    }
    setDraft(applySaveOutcome(latest, { kind: "network" }));
  }, [lesson, onBurst, comfort]);

  // A completed draft with a comfort rating saves exactly once; retries are explicit.
  useEffect(() => {
    if (draft?.phase === "completed" && draft.failure === null && comfort) void save();
  }, [draft?.phase, draft?.failure, comfort, save]);

  if (course.unavailable === "alignment-unchecked" || course.unavailable === "alignment-mismatch") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold text-primary">Tippen</h2>
        <AlignmentCheck view={view} busy={busy} onCheck={onCheck} />
        <button type="button" onClick={onContinue} disabled={busy} className={cn(secondaryButton, "self-start")}>
          Ohne Tipp-Training weiter
        </button>
      </div>
    );
  }
  if (course.unavailable || !lesson) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold text-primary">Tippen</h2>
        <p className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary" role="status" data-testid="typing-unavailable">
          {UNAVAILABLE_TEXT[course.unavailable ?? ""] ?? "Das Tipp-Training ist gerade nicht verfügbar."}
        </p>
        <button type="button" onClick={onContinue} disabled={busy} className={cn(primaryButton, "self-start")}>
          Weiter
        </button>
      </div>
    );
  }

  const currentLine = draft && draft.phase === "typing" ? draft.lines[draft.lineIndex] ?? null : null;
  const nextChar = currentLine ? nextExpectedChar(currentLine, draft!.current) : null;
  const nextFinger = nextChar ? course.fingers[nextChar] ?? null : null;
  const home = course.homePosition;
  const keyChip = (key: string, mark: boolean) => (
    <span key={key} className={cn("flex min-w-11 flex-col items-center rounded-lg border border-primary bg-primary px-1.5 py-1", mark && "ring-2 ring-stone-600 dark:ring-stone-200")} data-key={key} data-next={mark ? "true" : undefined}>
      <span className="text-lg font-semibold text-primary">{key === " " ? "␣" : key}</span>
      <span className="text-[10px] text-tertiary">{(course.fingers[key] ?? "").replace("Finger ", "").replace("kleiner", "klein")}</span>
    </span>
  );
  const commit = () => {
    const current = draftRef.current;
    if (!current) return;
    const next = commitLine(current, { busy: busy || current.phase !== "typing", nowMs: Date.now(), newKey });
    if (next !== current) setDraft(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-primary">Tippen: {lesson.title}</h2>
        <p className="mt-1 text-sm text-tertiary">
          Lektion {lesson.index + 1} von {lesson.count} · neu: {lesson.keys.map((k) => (k === " " ? "Leertaste" : k)).join(", ")}
          {lesson.practiced.length ? ` · schon geübt: ${lesson.practiced.map((k) => (k === " " ? "␣" : k)).join(" ")}` : ""}
        </p>
      </div>
      {home ? (
        <div className="rounded-2xl bg-secondary p-3" aria-label="Grundstellung">
          <p className="text-sm text-tertiary">Grundstellung: linke Finger auf a s d f, rechte auf j k l ö. Zeigefinger fühlen f und j. Daumen liegt auf der Leertaste. Langsam und genau — Tempo zählt nicht.</p>
          <div className="mt-2 flex flex-wrap items-end gap-1">
            {home.left.map((k) => keyChip(k, nextChar === k))}
            <span className="mx-1 text-tertiary" aria-hidden>
              ·
            </span>
            {home.right.map((k) => keyChip(k, nextChar === k))}
            {["g", "h"].filter((k) => lesson.keys.includes(k) || lesson.practiced.includes(k)).map((k) => keyChip(k, nextChar === k))}
            {keyChip(" ", nextChar === " ")}
          </div>
        </div>
      ) : null}

      {choosing && lastDecision && (!draft || draft.phase === "typing") ? (
        <DecisionChoice action={lastDecision.action} lesson={lesson} busy={busy} onFull={() => startBurst(lesson.lines)} onShorter={() => startBurst(lesson.lines.slice(0, 1))} onContinue={onContinue} />
      ) : null}
      {!choosing && draft && draft.phase === "typing" && currentLine ? (
        <div className="rounded-2xl border border-primary p-4">
          <p className="text-sm text-tertiary" aria-live="polite" data-testid="next-key">
            {nextChar === null ? "Zeile fertig — Enter oder „Zeile fertig“." : nextChar === " " ? "Jetzt: Leertaste mit dem Daumen." : `Jetzt: „${nextChar}“ mit dem ${nextFinger ?? "Finger"}.`}
          </p>
          <p className="mt-2 font-mono text-2xl tracking-widest text-primary" aria-label="Zeile zum Abtippen">
            {Array.from(currentLine).map((ch, i) => (
              <span key={i} className={cn(i < draft.current.length && (Array.from(draft.current)[i] === ch ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"), i === Array.from(draft.current).length && "underline")}>
                {ch === " " ? "␣" : ch}
              </span>
            ))}
          </p>
          <input
            value={draft.current}
            onChange={(e) => setDraft((d) => (d ? typeInto(d, e.target.value, Date.now()) : d))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={cn("mt-2 min-h-14 w-full rounded-2xl border border-primary bg-primary px-4 font-mono text-2xl text-primary", focusRing)}
            aria-label="Hier tippen"
            data-testid="course-input"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || draft.current.length === 0} onClick={commit} className={primaryButton}>
              Zeile fertig ({draft.lineIndex + 1}/{draft.lines.length})
            </button>
            <button type="button" disabled={busy} onClick={onContinue} className={secondaryButton}>
              Für heute genug
            </button>
          </div>
        </div>
      ) : null}

      {draft && draft.phase !== "typing" ? (
        <div className="rounded-2xl border border-primary p-4" data-testid="burst-result">
          <ul className="space-y-1 font-mono text-sm text-primary">
            {draft.lines.map((line, i) => {
              const m = previewLine(line, draft.typedLines[i] ?? "");
              return (
                <li key={`${line}-${i}`}>
                  {line} — {m.correct}/{Array.from(line).length} richtig{m.substituted ? `, ${m.substituted} vertauscht` : ""}{m.extra ? `, ${m.extra} zu viel` : ""}{m.omitted ? `, ${m.omitted} fehlen` : ""}
                </li>
              );
            })}
          </ul>
          {!comfort && draft.phase === "completed" && draft.failure === null ? (
            <div className="mt-3" role="group" aria-label="Wie war das?">
              <p className="text-base text-primary">Wie war diese Runde für deine Finger?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["easy", "ok", "hard"] as const).map((c) => (
                  <button key={c} type="button" disabled={busy} onClick={() => setComfort(c)} className={chipButton} data-testid={`comfort-${c}`}>
                    {COMFORT_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {draft.phase === "saving" ? <p className="mt-2 text-sm text-tertiary" role="status">… wird gespeichert</p> : null}
          {draft.failure ? (
            <div className="mt-2 flex flex-wrap items-center gap-2" role="status">
              <span className="text-sm text-primary">{draft.failure === "refused" ? "Das konnte so nicht gespeichert werden." : "Speichern hat nicht geklappt. Deine Runde ist noch da."}</span>
              {draft.failure !== "refused" ? (
                <button type="button" disabled={busy} onClick={() => void save()} className={secondaryButton}>
                  Nochmal speichern
                </button>
              ) : null}
            </div>
          ) : null}
          {draft.phase === "saved" && lastDecision ? (
            <DecisionChoice action={lastDecision.action} lesson={lesson} busy={busy} onFull={() => startBurst(lesson.lines)} onShorter={() => startBurst(lesson.lines.slice(0, 1))} onContinue={onContinue} />
          ) : null}
        </div>
      ) : null}

      {course.burstsThisVisit.length ? (
        <ul className="text-sm text-tertiary" data-testid="bursts-this-visit">
          {course.burstsThisVisit.map((b, i) => (
            <li key={i}>
              Runde {i + 1} ({b.lessonId.replace("TYPE-CH-COURSE-", "L")}{b.lineCount < (lesson.id === b.lessonId ? lesson.lines.length : b.lineCount) ? ", kurz" : ""}): {b.correctChars} von {b.denominator} richtig{b.substitutedChars ? `, ${b.substitutedChars} vertauscht` : ""}{b.extraChars ? `, ${b.extraChars} zu viel` : ""}{b.omittedChars ? `, ${b.omittedChars} fehlen` : ""} · {COMFORT_LABEL[b.comfort]}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-tertiary">Gezählt wird nur der fertige Text jeder Zeile. Welche Finger du benutzt, sieht nur ein Mensch beim Zuschauen.</p>
    </div>
  );
}

/**
 * The durable decision that applies to the lesson on screen: the decision made
 * on this lesson, or an "advance" made on the previous lesson as long as the
 * child has not yet started a burst on the new one (so the lesson change never
 * hides the decision).
 */
function durableDecision(course: NonNullable<ChildView["typingCourse"]>, lesson: NonNullable<ChildView["typingCourse"]>["lesson"]) {
  const d = course.decision;
  if (!d || !lesson || d.action === "start") return null;
  if (d.lessonId === lesson.id) return d;
  if (d.action === "advance" && course.completed.includes(d.lessonId) && !course.burstsThisVisit.some((b) => b.lessonId === lesson.id)) return d;
  return null;
}

/** The server's progression decision with the matching next-step choice (never a silent restart). */
function DecisionChoice({ action, lesson, busy, onFull, onShorter, onContinue }: { action: string; lesson: { title?: string; lines: string[] }; busy: boolean; onFull: () => void; onShorter: () => void; onContinue: () => void }) {
  const text =
    action === "advance"
      ? `Zwei gute Runden — die nächste Lektion${lesson.title ? ` (${lesson.title})` : ""} ist frei. Du entscheidest, ob du sie jetzt anfängst.`
      : action === "stop"
        ? "Der ganze Kurs ist geschafft."
        : action === "smaller"
          ? "Das war anstrengend. Jetzt eine kürzere Runde mit denselben Tasten — oder für heute genug."
          : "Noch eine Runde mit denselben Tasten, dann sehen wir weiter.";
  return (
    <div className="rounded-2xl border border-primary p-4" data-testid="decision-card" data-decision={action}>
      <p className="rounded-xl bg-secondary p-3 text-base text-primary" role="status" data-testid="decision">
        {text}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {action === "smaller" && lesson.lines.length > 1 ? (
          <button type="button" disabled={busy} onClick={onShorter} className={secondaryButton} data-testid="shorter-burst">
            Kürzere Runde (nur Zeile 1)
          </button>
        ) : null}
        {action === "repeat" || action === "smaller" || action === "advance" ? (
          <button type="button" disabled={busy} onClick={onFull} className={secondaryButton} data-testid="another-burst">
            {action === "smaller" ? "Ganze Runde" : action === "advance" ? "Nächste Lektion starten" : "Noch eine Runde"}
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={onContinue} className={primaryButton} data-testid="course-continue">
          {action === "stop" || action === "advance" ? "Weiter" : "Für heute genug"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log revision — the child's original stays; spacing only
// ---------------------------------------------------------------------------

export function LogRevise({ view, busy, onRevise, onSkip }: { view: ChildView; busy: boolean; onRevise: (text: string) => void; onSkip: () => void }) {
  const revise = view.logRevise;
  const [text, setText] = useState(revise?.original ?? "");
  if (!revise) return null;
  const nothing = revise.flags === 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onRevise(text.trim());
      }}
      className="flex flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold text-primary">Schau deinen Satz noch einmal an</h2>
      {nothing ? (
        <p className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary" role="status" data-testid="revise-none">
          An den Stellen, die wir prüfen (Wort neben Zahl, nach einem Punkt oder Komma und ein paar bekannte Wortpaare), fehlt kein Leerzeichen. Andere Stellen haben wir nicht geprüft — dein Satz bleibt so, wie du ihn geschrieben hast.
        </p>
      ) : (
        <div className="rounded-2xl bg-secondary p-4" data-testid="revise-help">
          <p className="text-base text-primary">Zwischen Wörtern, und zwischen Wort und Zahl, kommt ein Leerzeichen. An {revise.flags} {revise.flags === 1 ? "Stelle" : "Stellen"} fehlt eins — der Strich zeigt wo:</p>
          <p className="mt-2 font-mono text-xl text-primary" aria-label="Markierter Satz">
            {revise.marked}
          </p>
          <p className="mt-2 text-sm text-tertiary">Rechtschreibung schauen wir ein andermal an — heute nur die Leerzeichen. Dein erster Satz bleibt gespeichert.</p>
        </div>
      )}
      <label className="text-base font-medium text-primary" htmlFor="revise-text">
        Dein Satz
      </label>
      <textarea id="revise-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border border-primary bg-primary px-4 py-3 text-lg text-primary", focusRing)} data-testid="revise-input" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !text.trim()} className={primaryButton} data-testid="revise-save">
          {nothing ? "Weiter" : "Überarbeitung speichern"}
        </button>
        {!nothing ? (
          <button type="button" onClick={onSkip} disabled={busy} className={secondaryButton} data-testid="revise-skip">
            So lassen
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Fresh transfer sentence — a NEW sentence, never the shown correction (R2-3)
// ---------------------------------------------------------------------------

/** The form passes the identity it was mounted for (R5-1): the request is fenced on it server-side. */
export type SubmitHandler = (payload: Record<string, unknown>, idempotencyKey: string, identity: DraftIdentity | null) => Promise<LearningMutateOutcome | null>;

/** R5-3: an answered auth loss — the draft belongs to the ended sign-in and must not be kept or re-saved. */
const authLost = (outcome: LearningMutateOutcome | null): boolean => !!outcome && !outcome.ok && "failure" in outcome && (outcome.failure === "unauthorized" || outcome.failure === "no-session");

/** Outcome mapping shared by the transfer and reflection drafts (R3-4). */
function outcomeToDraft(outcome: LearningMutateOutcome | null): Parameters<typeof applySubmitOutcome>[1] {
  if (!outcome) return { kind: "network" };
  if (outcome.ok && (outcome.status === "applied" || outcome.status === "replayed")) return { kind: outcome.status };
  if (outcome.ok && outcome.status === "stale") return { kind: "stale" };
  if (!outcome.ok && "status" in outcome && outcome.status === "refused") return { kind: "refused", code: outcome.code };
  return { kind: "network" };
}

const REFUSAL_TEXT: Record<string, string> = {
  "copied-text": "Das ist der Satz von vorhin oder die gezeigte Korrektur. Schreib einen neuen Satz — oder wähle „Heute nicht“.",
};

/** The recoverable-draft context the workspace hands to the single-shot forms (null = no recovery available). */
export type DraftContext = { storage: DraftStorage | null; identity: DraftIdentity | null };

/** A completed submission normalises the sentence exactly as its identity does: one space between words, trimmed. */
export const normaliseSentence = (text: string): string => text.replace(/\s+/g, " ").trim();

export function LogTransfer({ view, busy, onSubmit, onSkip, drafts }: { view: ChildView; busy: boolean; onSubmit: SubmitHandler; onSkip: () => void; drafts?: DraftContext }) {
  const transfer = view.transfer;
  const [text, setText] = useState("");
  // One completed sentence keeps one idempotency key across failed saves, lost acknowledgements and refusals
  // (R3-4) — and across a reload, because the completed draft is kept in the tab until reconciled (R4-2).
  const draftRef = useRef<SubmitDraft | null>(null);
  const [draft, setDraft] = useState<SubmitDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const storage = drafts?.storage ?? null;
  const identity = drafts?.identity ?? null;
  // The identity this form was mounted for (the workspace remounts it when that identity changes) and
  // whether it is still mounted: a late outcome never re-saves a draft after the form is gone (R5-3).
  const mountIdentityRef = useRef<DraftIdentity | null>(identity);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!identity) return;
    const stored = loadDraft(storage, identity, "write-transfer");
    if (!stored) return;
    const payloadText = typeof stored.payload.text === "string" ? stored.payload.text : "";
    setText(payloadText);
    const recovered: SubmitDraft = { payloadKey: stored.payloadKey, idempotencyKey: stored.idempotencyKey, phase: "failed", failure: "network", refusalCode: null, attempts: 1 };
    draftRef.current = recovered;
    setDraft(recovered);
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persist = (d: SubmitDraft, payload: Record<string, unknown>) => {
    if (!identity) return;
    saveDraft(storage, { v: 1, identity, op: "write-transfer", payload, payloadKey: d.payloadKey, idempotencyKey: d.idempotencyKey, savedAt: Date.now() });
  };
  const discard = () => {
    if (identity) clearDraft(storage, identity.child, "write-transfer");
    draftRef.current = null;
    setDraft(null);
    setRestored(false);
    setText("");
  };
  const send = async () => {
    const sentence = normaliseSentence(text);
    if (!sentence) return;
    const payload = { op: "write-transfer", text: sentence, modality: "typed" as const };
    const next = submitDraftFor(draftRef.current, payloadKeyOf({ op: "write-transfer", text: sentence }), newKey);
    if (!canSend(next)) return;
    const sending = markSending(next);
    draftRef.current = sending;
    setDraft(sending);
    // The completed draft is kept BEFORE the request leaves: a failure or a lost acknowledgement is recoverable after a reload.
    persist(sending, payload);
    const outcome = await onSubmit(payload, sending.idempotencyKey, mountIdentityRef.current);
    const settled = applySubmitOutcome(sending, outcomeToDraft(outcome));
    if (!mountedRef.current) return; // the form is gone (left, signed out, remounted for a new identity): nothing is kept or re-saved
    draftRef.current = settled;
    setDraft(settled);
    if (settled.phase === "saved" || settled.failure === "stale" || authLost(outcome)) {
      if (identity) clearDraft(storage, identity.child, "write-transfer");
    } else persist(settled, payload);
  };
  if (!transfer) return null;
  const failed = draft && draft.phase === "failed" ? draft : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex flex-col gap-4"
      data-testid="transfer"
    >
      <h2 className="text-2xl font-semibold text-primary">{transfer.prompt}</h2>
      <p className="text-base text-tertiary">{transfer.instruction}</p>
      <label className="text-base font-medium text-primary" htmlFor="transfer-text">
        Dein neuer Satz
      </label>
      <textarea id="transfer-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600} className={cn("rounded-2xl border border-primary bg-primary px-4 py-3 text-lg text-primary", focusRing)} data-testid="transfer-input" />
      {failed ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="transfer-notice" data-failure={failed.failure} data-code={failed.refusalCode ?? ""} data-restored={restored ? "true" : "false"}>
          {failed.failure === "refused"
            ? REFUSAL_TEXT[failed.refusalCode ?? ""] ?? "Das ging so nicht. Schau deinen Satz nochmal an."
            : failed.failure === "stale"
              ? "Da war schon ein neuerer Stand — schau, wo du jetzt bist."
              : restored
                ? "Dein Satz von vorhin ist noch da — er wurde noch nicht gespeichert. Nochmal speichern oder verwerfen?"
                : "Speichern hat nicht geklappt. Dein Satz ist noch da — nochmal speichern?"}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !text.trim() || draft?.phase === "saving"} className={primaryButton} data-testid="transfer-save">
          {failed && failed.failure === "network" ? "Nochmal speichern" : "Satz speichern"}
        </button>
        {failed && failed.failure === "network" ? (
          <button type="button" onClick={discard} disabled={busy || draft?.phase === "saving"} className={secondaryButton} data-testid="transfer-discard">
            Verwerfen
          </button>
        ) : null}
        <button type="button" onClick={onSkip} disabled={busy || draft?.phase === "saving"} className={secondaryButton} data-testid="transfer-skip">
          Heute nicht
        </button>
      </div>
      <p className="text-xs text-tertiary">Geprüft werden nur die Leerzeichen an den bekannten Stellen (Wort und Zahl, nach einem Punkt, ein paar Wortpaare). Ein Satz ohne so eine Stelle wird nicht bewertet. Rechtschreibung wird hier nicht bewertet.</p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Reflection with optional feedback — all three dimensions optional, each
// with an explicit "rather not" (R3-3); one completed answer set keeps one
// idempotency key across retries (R3-4) and across a reload (R4-2)
// ---------------------------------------------------------------------------

export function ReflectFeedback({ view, busy, onSubmit, drafts }: { view: ChildView; busy: boolean; onSubmit: SubmitHandler; drafts?: DraftContext }) {
  const reflection = view.reflection;
  // undefined = left open, null = explicitly skipped, string = answered
  const [answers, setAnswers] = useState<Record<string, string | null | undefined>>({});
  const draftRef = useRef<SubmitDraft | null>(null);
  const [draft, setDraft] = useState<SubmitDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const storage = drafts?.storage ?? null;
  const identity = drafts?.identity ?? null;
  const mountIdentityRef = useRef<DraftIdentity | null>(identity);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!identity) return;
    const stored = loadDraft(storage, identity, "reflect");
    if (!stored) return;
    const body = stored.payload as { optionId?: string | null; difficultySkipped?: boolean; feedback?: Record<string, string | null | undefined> };
    const next: Record<string, string | null | undefined> = { ...(body.feedback ?? {}) };
    next.difficulty = body.optionId ?? (body.difficultySkipped ? null : undefined);
    setAnswers(next);
    const recovered: SubmitDraft = { payloadKey: stored.payloadKey, idempotencyKey: stored.idempotencyKey, phase: "failed", failure: "network", refusalCode: null, attempts: 1 };
    draftRef.current = recovered;
    setDraft(recovered);
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!reflection) return null;
  const dims = reflection.dimensions;
  const difficultyOptional = reflection.skipLabel !== null;
  const difficulty = answers.difficulty;
  const payload = () => {
    const feedback: Record<string, string | null | undefined> = {};
    for (const dim of dims) feedback[dim.id] = answers[dim.id];
    return { op: "reflect", optionId: difficulty ?? null, difficultySkipped: difficulty === null, feedback };
  };
  const persist = (d: SubmitDraft, body: Record<string, unknown>) => {
    if (!identity) return;
    saveDraft(storage, { v: 1, identity, op: "reflect", payload: body, payloadKey: d.payloadKey, idempotencyKey: d.idempotencyKey, savedAt: Date.now() });
  };
  const discard = () => {
    if (identity) clearDraft(storage, identity.child, "reflect");
    draftRef.current = null;
    setDraft(null);
    setRestored(false);
    setAnswers({});
  };
  const send = async () => {
    if (!difficultyOptional && !difficulty) return;
    const body = payload();
    const next = submitDraftFor(draftRef.current, payloadKeyOf(body), newKey);
    if (!canSend(next)) return;
    const sending = markSending(next);
    draftRef.current = sending;
    setDraft(sending);
    persist(sending, body);
    const outcome = await onSubmit(body, sending.idempotencyKey, mountIdentityRef.current);
    const settled = applySubmitOutcome(sending, outcomeToDraft(outcome));
    if (!mountedRef.current) return;
    draftRef.current = settled;
    setDraft(settled);
    if (settled.phase === "saved" || settled.failure === "stale" || authLost(outcome)) {
      if (identity) clearDraft(storage, identity.child, "reflect");
    } else persist(settled, body);
  };
  const failed = draft && draft.phase === "failed" ? draft : null;
  const row = (id: string, prompt: string, options: { id: string; label: string }[], skipLabel: string | null, big: boolean) => (
    <div key={id}>
      <p className={big ? "text-2xl font-semibold text-primary" : "text-lg font-medium text-primary"}>{prompt}</p>
      <p className="text-sm text-tertiary">Freiwillig — du musst nichts sagen.</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={prompt}>
        {options.map((option) => (
          <button key={option.id} type="button" disabled={busy || draft?.phase === "saving"} aria-pressed={answers[id] === option.id} onClick={() => setAnswers((a) => ({ ...a, [id]: option.id }))} className={cn(chipButton, big && "min-h-16", answers[id] === option.id && "ring-2 ring-stone-600 dark:ring-stone-200")} data-testid={`${id}-${option.id}`}>
            {option.label}
          </button>
        ))}
        {skipLabel ? (
          <button type="button" disabled={busy || draft?.phase === "saving"} aria-pressed={answers[id] === null} onClick={() => setAnswers((a) => ({ ...a, [id]: null }))} className={cn(secondaryButton, answers[id] === null && "ring-2 ring-stone-600 dark:ring-stone-200")} data-testid={`${id}-skip`}>
            {skipLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-5" data-testid="reflect">
      {row("difficulty", reflection.prompt, reflection.options, reflection.skipLabel, true)}
      {dims.map((dim) => row(dim.id, dim.prompt, dim.options, dim.skipLabel, false))}
      {failed ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="reflect-notice" data-failure={failed.failure} data-restored={restored ? "true" : "false"}>
          {failed.failure === "refused" ? "Das ging so nicht. Schau deine Antworten nochmal an." : failed.failure === "stale" ? "Da war schon ein neuerer Stand — schau, wo du jetzt bist." : restored ? "Deine Antworten von vorhin sind noch da — sie wurden noch nicht gespeichert. Nochmal speichern oder verwerfen?" : "Speichern hat nicht geklappt. Deine Antworten sind noch da — nochmal speichern?"}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || draft?.phase === "saving" || (!difficultyOptional && !difficulty)} onClick={() => void send()} className={primaryButton} data-testid="reflect-submit">
          {failed && failed.failure === "network" ? "Nochmal speichern" : "Fertig"}
        </button>
        {failed && failed.failure === "network" ? (
          <button type="button" onClick={discard} disabled={busy || draft?.phase === "saving"} className={secondaryButton} data-testid="reflect-discard">
            Verwerfen
          </button>
        ) : null}
      </div>
      <p className="text-sm text-tertiary">Danach ist der Besuch fertig. Deine Seite ist gespeichert. Was du nicht sagst, bleibt einfach offen.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary — one success, one practice focus, one next step, the artifact
// ---------------------------------------------------------------------------

// The server sentences carry their own label ("Geübt: …", "Nächstes Mal: …"); the card already shows it.
const unlabel = (text: string) => text.replace(/^(Geschafft|Geübt|Nächstes Mal): /, "");

export function Summary({ view, busy, onNext }: { view: ChildView; busy: boolean; onNext: () => void }) {
  const summary = view.summary;
  if (!summary) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="summary">
      <h2 className="text-2xl font-semibold text-primary">Das hast du heute geschafft</h2>
      <ul className="space-y-2">
        <li className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary" data-testid="summary-success">
          <span className="text-sm text-tertiary">Geschafft</span>
          <br />
          {summary.success ? unlabel(summary.success.text) : "Du hast die Basis besucht."}
        </li>
        {summary.practiced ? (
          <li className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary" data-testid="summary-practiced">
            <span className="text-sm text-tertiary">Geübt</span>
            <br />
            {unlabel(summary.practiced.text)}
          </li>
        ) : null}
        <li className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary" data-testid="summary-next">
          <span className="text-sm text-tertiary">Nächstes Mal</span>
          <br />
          {unlabel(summary.next.text)}
        </li>
      </ul>
      {summary.artifact.kind !== "none" ? (
        <div className="rounded-2xl border border-primary p-4" data-testid="summary-artifact">
          <p className="text-sm text-tertiary">{summary.artifact.kind === "station" ? "Gebaut" : "Deine Seite"}</p>
          <p className="mt-1 text-base text-primary">{summary.artifact.text}</p>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-primary">
        <BaseScene scene={view.scene} compact />
      </div>
      <button type="button" onClick={onNext} disabled={busy} className={cn(primaryButton, "self-start")} data-testid="summary-next-button">
        Weiter
      </button>
    </div>
  );
}
