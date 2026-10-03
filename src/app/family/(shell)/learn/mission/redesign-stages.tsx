"use client";

// Visit-4 stages of the approved learning redesign (2026-09-29) in the
// world-first presentation (2026-10-03): station choice, the Swiss-German
// typing course with its input-alignment check, visible hands and keys, the
// first-use placement demonstration, the station build, the spacing revision
// of the child's own sentence, the fresh transfer sentence, the pre-report
// summary and the reflection. Presentation only: every claim shown here comes
// from the server view; every decision is made by the state machine. The
// lesson-end feedback after a typing round is rendered by the workspace from
// the server's `lastLesson` (lesson-end.tsx), not here.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { isComposing, useDeliberateFocus } from "@/components/family/learning/focus";
import { HandsKeyboard, PlacementDemo, reachOriginOf } from "@/components/family/learning/hands-keyboard";
import { StoryBeat } from "@/components/family/learning/story-beat";
import type { ChildView, LearningOp } from "@/lib/family-learning-state";
import type { LearningMutateOutcome } from "@/lib/family-learning-client";
import { applySaveOutcome, commitLine, createTypingDraft, markSaving, typeInto, type TypingDraft } from "@/lib/family-learning-typing";
import { nextExpectedChar } from "@/lib/family-learning-typing-metrics";
import { applySubmitOutcome, canSend, markSending, payloadKeyOf, submitDraftFor, type SubmitDraft } from "@/lib/family-learning-submit-draft";
import { clearDraft, loadDraft, saveDraft, type DraftIdentity, type DraftStorage } from "@/lib/family-learning-draft-store";
import { chipButton, focusRing, primaryButton, secondaryButton } from "./styles";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}`);
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

// ---------------------------------------------------------------------------
// Station choice — a child choice, never an inferred interest
// ---------------------------------------------------------------------------

export function StationChoice({ view, busy, gate = alwaysOpen, onChoose }: { view: ChildView; busy: boolean; gate?: Gate; onChoose: (theme: string) => void }) {
  const station = view.station;
  const intro = view.visit?.intro ?? null;
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(firstRef, "station-choice", { gate });
  if (!station) return null;
  return (
    <div className="flex flex-col gap-4">
      {intro ? <StoryBeat speaker="radio" beats={[{ text: intro.make, scene: "station" }]} testId="mission-intro" compact /> : null}
      <Instruction kicker="Station">Was soll deine Station beobachten?</Instruction>
      <p className="text-base text-tertiary" data-testid="station-reference" data-reference={station.reference.kind}>
        {station.reference.text}
      </p>
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Thema wählen">
        {station.themes.map((theme, i) => (
          <button key={theme.id} ref={i === 0 ? firstRef : undefined} type="button" disabled={busy} onClick={() => onChoose(theme.id)} className={cn(chipButton, "min-h-24 flex-col items-start text-left")} data-testid={`station-theme-${theme.id}`}>
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

export function StationBuild({ view, busy, gate = alwaysOpen, onBuild }: { view: ChildView; busy: boolean; gate?: Gate; onBuild: (spot: string) => void }) {
  const station = view.station;
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(firstRef, "station-build", { gate });
  if (!station) return null;
  const theme = station.themes.find((t) => t.id === station.theme) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Instruction kicker="Bauen">Wo soll die Station stehen?</Instruction>
      <p className="text-base text-tertiary">
        {theme ? `${theme.emoji} ${theme.label}. ` : ""}
        Nach dem Bauen siehst du die Station in deiner Welt{station.lampAvailable ? " — mit der Lampe, die du bestellt hast." : ". Ohne Lampe: das Team hat keine bekommen — sie bleibt dunkel."}
      </p>
      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Platz für die Station">
        {station.spots.map((spot, i) => (
          <button key={spot.id} ref={i === 0 ? firstRef : undefined} type="button" disabled={busy} onClick={() => onBuild(spot.id)} className={cn(chipButton, "min-h-20 flex-col")} data-testid={`station-spot-${spot.id}`}>
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
// Typing course — setup check first, hands and keys, then short rounds
// ---------------------------------------------------------------------------

const UNAVAILABLE_TEXT: Record<string, string> = {
  "layout-unconfirmed": "Das Finger-Training kommt, sobald deine Eltern die Tastatur bestätigt haben (Einstellungen im Eltern-Bereich).",
  "no-course-for-layout": "Für diese Tastatur gibt es noch keinen Kurs. Es wird nichts anderes ersatzweise geübt.",
};

function AlignmentCheck({ view, busy, gate, onCheck }: { view: ChildView; busy: boolean; gate: Gate; onCheck: (observed: string[]) => void }) {
  const course = view.typingCourse!;
  const [observed, setObserved] = useState<string[]>(() => course.alignment.keys.map(() => ""));
  const result = course.alignment.result;
  const complete = observed.every((c) => Array.from(c).length === 1);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);
  useDeliberateFocus(firstRef, "alignment", { gate });
  return (
    <div className="flex flex-col gap-3" data-testid="alignment-check">
      <Instruction kicker="Tastatur-Check">Drück die drei Tasten — es gibt keine Punkte.</Instruction>
      <p className="text-base text-tertiary">Deine Eltern haben bestätigt: {course.layoutLabel ?? "?"}. Jetzt prüfen wir, ob der Computer dieselben Zeichen schreibt.</p>
      {result && result.result === "mismatch" ? (
        <div className="rounded-2xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="alignment-mismatch">
          <p>Der Computer schreibt andere Zeichen als die bestätigte Tastatur{result.matchesLayout ? ` (es sieht aus wie „${course.layoutLabels[result.matchesLayout] ?? result.matchesLayout}“)` : ""}. Das Finger-Training bleibt gesperrt, bis die Eingabequelle passt.</p>
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
      <ol className="space-y-2">
        {course.alignment.keys.map((key, i) => (
          <li key={key.id} className="flex flex-wrap items-center gap-3">
            <input
              ref={(el) => {
                refs.current[i] = el;
                if (i === 0) firstRef.current = el;
              }}
              value={observed[i]}
              onChange={(e) => {
                const ch = Array.from(e.target.value).slice(-1).join("");
                setObserved((o) => o.map((v, j) => (j === i ? ch : v)));
                // One key typed → the next field, then the check button: the whole check runs without a mouse.
                if (ch) window.requestAnimationFrame(() => (i + 1 < course.alignment.keys.length ? refs.current[i + 1]?.focus() : submitRef.current?.focus()));
              }}
              onKeyDown={(e) => (e.key === "Enter" && isComposing(e) ? e.preventDefault() : undefined)}
              maxLength={2}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              className={cn("min-h-14 w-16 rounded-xl border-2 border-primary bg-primary text-center font-mono text-3xl text-primary", focusRing)}
              aria-label={key.prompt}
              data-testid={`alignment-key-${key.id}`}
            />
            <span className="text-lg text-primary">{key.prompt}</span>
          </li>
        ))}
      </ol>
      <button ref={submitRef} type="button" disabled={busy || !complete} onClick={() => onCheck(observed)} className={cn(primaryButton, "self-start")} data-testid="alignment-submit">
        {result ? "Nochmal prüfen" : "Prüfen"}
      </button>
    </div>
  );
}

const COMFORT_LABEL: Record<string, string> = { easy: "Leicht", ok: "Ging gut", hard: "Anstrengend" };
const DEMO_SEEN_KEY = "family-learning-placement-demo-seen";

export function TypingCourse({ view, busy, gate = alwaysOpen, reminder = null, onCheck, onBurst, onContinue }: {
  view: ChildView;
  busy: boolean;
  gate?: Gate;
  /** The one next-lesson cue (UX-5c), shown before and during a round — not while the finished round is being rated or saved. */
  reminder?: React.ReactNode;
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
  const savedDecision = durableDecision(course, lesson);
  const [lastDecision, setLastDecision] = useState<{ action: string; reason: string } | null>(savedDecision ? { action: savedDecision.action, reason: savedDecision.reason } : null);
  const [choosing, setChoosing] = useState<boolean>(savedDecision !== null);
  // First use: the short placement demonstration before the first ever round; replayable any time.
  const firstUse = course.burstsThisVisit.length === 0 && course.completed.length === 0 && (!course.decision || course.decision.action === "start");
  const [demoOpen, setDemoOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return firstUse && window.sessionStorage.getItem(DEMO_SEEN_KEY) !== "1";
    } catch {
      return firstUse;
    }
  });
  const lessonId = lesson?.id ?? null;
  useEffect(() => {
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
  const closeDemo = () => {
    setDemoOpen(false);
    try {
      window.sessionStorage.setItem(DEMO_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
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

  useEffect(() => {
    if (draft?.phase === "completed" && draft.failure === null && comfort) void save();
  }, [draft?.phase, draft?.failure, comfort, save]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const comfortRef = useRef<HTMLButtonElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const typing = !demoOpen && !choosing && draft?.phase === "typing";
  useDeliberateFocus(inputRef, typing && draft ? `course:${lesson?.id}:${draft.lineIndex}:${draft.typedLines.length}` : null, { gate, enabled: typing });
  useDeliberateFocus(comfortRef, draft?.phase === "completed" && !comfort && draft.failure === null ? "comfort" : null, { gate, enabled: draft?.phase === "completed" && !comfort && draft.failure === null });
  useDeliberateFocus(retryRef, draft?.failure && draft.failure !== "refused" ? `failure:${draft.failure}` : null, { gate, enabled: !!draft?.failure && draft.failure !== "refused" });
  useDeliberateFocus(continueRef, course.unavailable && course.unavailable !== "alignment-unchecked" && course.unavailable !== "alignment-mismatch" ? "unavailable" : null, { gate, enabled: !!course.unavailable && course.unavailable !== "alignment-unchecked" && course.unavailable !== "alignment-mismatch" });

  if (course.unavailable === "alignment-unchecked" || course.unavailable === "alignment-mismatch") {
    return (
      <div className="flex flex-col gap-4">
        <AlignmentCheck view={view} busy={busy} gate={gate} onCheck={onCheck} />
        <button type="button" onClick={onContinue} disabled={busy} className={cn("inline-flex min-h-12 items-center self-start rounded-full px-4 text-base text-tertiary hover:text-primary", focusRing)}>
          Ohne Tipp-Training weiter
        </button>
      </div>
    );
  }
  if (course.unavailable || !lesson) {
    return (
      <div className="flex flex-col gap-4">
        <Instruction kicker="Tippen">Heute ohne Finger-Training.</Instruction>
        <p className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary" role="status" data-testid="typing-unavailable">
          {UNAVAILABLE_TEXT[course.unavailable ?? ""] ?? "Das Tipp-Training ist gerade nicht verfügbar."}
        </p>
        <button ref={continueRef} type="button" onClick={onContinue} disabled={busy} className={cn(primaryButton, "self-start")}>
          Weiter
        </button>
      </div>
    );
  }

  const home = course.homePosition ?? { left: ["a", "s", "d", "f"], right: ["j", "k", "l", "ö"], anchors: ["f", "j"], thumb: " " };
  const lessonKeys = Array.from(new Set(lesson.lines.join("").split("")));
  if (demoOpen) {
    return (
      <div className="flex flex-col gap-4" data-testid="typing-course">
        <Instruction kicker={`Tippen · Lektion ${lesson.index + 1} von ${lesson.count}`}>So liegen die Hände.</Instruction>
        <PlacementDemo fingers={course.fingers} home={home} lessonKeys={lessonKeys} onDone={closeDemo} autoFocus={gate()} />
      </div>
    );
  }

  const currentLine = draft && draft.phase === "typing" ? draft.lines[draft.lineIndex] ?? null : null;
  const nextChar = currentLine ? nextExpectedChar(currentLine, draft!.current) : null;
  const nextFinger = nextChar ? course.fingers[nextChar] ?? null : null;
  const commit = () => {
    const current = draftRef.current;
    if (!current) return;
    const next = commitLine(current, { busy: busy || current.phase !== "typing", nowMs: Date.now(), newKey });
    if (next !== current) setDraft(next);
  };
  const wrongNow = currentLine && draft ? (() => {
    const typed = Array.from(draft.current);
    const expected = Array.from(currentLine);
    const i = typed.length - 1;
    return i >= 0 && i < expected.length && typed[i] !== expected[i] ? typed[i] : null;
  })() : null;

  return (
    <div className="flex flex-col gap-4" data-testid="typing-course" data-lesson={lesson.id}>
      {reminder && (typing || (choosing && lastDecision)) ? reminder : null}
      {/* The replay button keeps its place at the right; a longer instruction wraps inside its own column (no extra row, the practice screen keeps fitting 900 px). */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
        <Instruction kicker={`Tippen · Lektion ${lesson.index + 1} von ${lesson.count} · ${lesson.title}`}>
          {choosing && lastDecision ? "Runde gespeichert." : typing ? (nextChar === null ? "Zeile fertig — Enter." : nextChar === " " ? "Jetzt: Leertaste mit dem Daumen." : reachOriginOf(nextChar) ? `„${nextChar}“ mit dem ${nextFinger ?? "Finger"} — zurück auf „${reachOriginOf(nextChar)}“.` : `Jetzt: „${nextChar}“ mit dem ${nextFinger ?? "Finger"}.`) : draft?.phase === "completed" && !comfort ? "Wie war das für deine Finger?" : "Tippen"}
        </Instruction>
        </div>
        <button type="button" onClick={() => setDemoOpen(true)} className={cn("inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border border-primary px-4 text-base text-primary hover:bg-secondary", focusRing)} data-testid="demo-replay-open">
          ✋ Hände zeigen
        </button>
      </div>

      {choosing && lastDecision && (!draft || draft.phase === "typing" || draft.phase === "saved") ? (
        <DecisionChoice action={lastDecision.action} lesson={lesson} busy={busy} gate={gate} onFull={() => startBurst(lesson.lines)} onShorter={() => startBurst(lesson.lines.slice(0, 1))} onContinue={onContinue} />
      ) : null}

      {typing && draft && currentLine ? (
        <>
          <p className="font-mono text-3xl tracking-widest text-primary sm:text-4xl" aria-label="Zeile zum Abtippen" data-testid="course-line">
            {Array.from(currentLine).map((ch, i) => {
              const typedChars = Array.from(draft.current);
              const state = i < typedChars.length ? (typedChars[i] === ch ? "ok" : "bad") : i === typedChars.length ? "next" : "todo";
              return (
                <span key={i} className={cn(state === "ok" && "text-green-700 dark:text-green-300", state === "bad" && "text-red-700 underline decoration-wavy dark:text-red-300", state === "next" && "underline decoration-4 underline-offset-4")}>
                  {ch === " " ? "␣" : ch}
                </span>
              );
            })}
          </p>
          <input
            ref={inputRef}
            value={draft.current}
            onChange={(e) => setDraft((d) => (d ? typeInto(d, e.target.value, Date.now()) : d))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e)) {
                e.preventDefault();
                commit();
              }
            }}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            className={cn("min-h-16 w-full rounded-2xl border-2 border-primary bg-primary px-4 font-mono text-3xl text-primary", focusRing)}
            aria-label="Hier tippen"
            data-testid="course-input"
          />
          <div className="mx-auto w-full max-w-[680px] rounded-3xl border border-primary bg-white p-1 dark:bg-stone-900" data-testid="practice-cue">
            <HandsKeyboard fingers={course.fingers} home={home} nextKey={nextChar} wrongKey={wrongNow} introduced={lessonKeys} compact />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || draft.current.length === 0} onClick={commit} className={primaryButton} data-testid="course-commit">
              Zeile fertig ({draft.lineIndex + 1}/{draft.lines.length})
            </button>
            <button type="button" disabled={busy} onClick={onContinue} className={cn("inline-flex min-h-12 items-center rounded-full px-4 text-base text-tertiary hover:text-primary", focusRing)} data-testid="course-enough">
              Für heute genug
            </button>
          </div>
        </>
      ) : null}

      {draft && draft.phase !== "typing" && !(choosing && draft.phase === "saved") ? (
        <div className="rounded-3xl border border-primary p-4" data-testid="burst-result">
          {!comfort && draft.phase === "completed" && draft.failure === null ? (
            <div role="group" aria-label="Wie war das?">
              <p className="text-base text-primary">Deine Runde ist fertig. Wie war sie für deine Finger?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["easy", "ok", "hard"] as const).map((c) => (
                  <button key={c} ref={c === "ok" ? comfortRef : undefined} type="button" disabled={busy} onClick={() => setComfort(c)} className={chipButton} data-testid={`comfort-${c}`}>
                    {COMFORT_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {draft.phase === "saving" ? <p className="text-sm text-tertiary" role="status">… wird gespeichert</p> : null}
          {draft.failure ? (
            <div className="mt-2 flex flex-wrap items-center gap-2" role="status">
              <span className="text-sm text-primary">{draft.failure === "refused" ? "Das konnte so nicht gespeichert werden." : "Speichern hat nicht geklappt. Deine Runde ist noch da."}</span>
              {draft.failure !== "refused" ? (
                <button ref={retryRef} type="button" disabled={busy} onClick={() => void save()} className={secondaryButton} data-testid="burst-retry-save">
                  Nochmal speichern
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {course.burstsThisVisit.length ? (
        <p className="text-sm text-tertiary" data-testid="bursts-this-visit">
          Runden heute: {course.burstsThisVisit.length} · Gezählt wird nur der fertige Text jeder Zeile — welche Finger du benutzt, sieht nur ein Mensch beim Zuschauen.
        </p>
      ) : (
        <p className="text-sm text-tertiary">Gezählt wird nur der fertige Text jeder Zeile — welche Finger du benutzt, sieht nur ein Mensch beim Zuschauen.</p>
      )}
    </div>
  );
}

function durableDecision(course: NonNullable<ChildView["typingCourse"]>, lesson: NonNullable<ChildView["typingCourse"]>["lesson"]) {
  const d = course.decision;
  if (!d || !lesson || d.action === "start") return null;
  if (d.lessonId === lesson.id) return d;
  if (d.action === "advance" && course.completed.includes(d.lessonId) && !course.burstsThisVisit.some((b) => b.lessonId === lesson.id)) return d;
  return null;
}

/** The server's progression decision with the matching next-step choice (never a silent restart). */
function DecisionChoice({ action, lesson, busy, gate, onFull, onShorter, onContinue }: { action: string; lesson: { title?: string; lines: string[] }; busy: boolean; gate: Gate; onFull: () => void; onShorter: () => void; onContinue: () => void }) {
  const text =
    action === "advance"
      ? `Zwei gute Runden — die nächste Lektion${lesson.title ? ` (${lesson.title})` : ""} ist frei. Du entscheidest, ob du sie jetzt anfängst.`
      : action === "stop"
        ? "Der ganze Kurs ist geschafft."
        : action === "smaller"
          ? "Das war anstrengend. Jetzt eine kürzere Runde mit denselben Tasten — oder für heute genug."
          : "Noch eine Runde mit denselben Tasten, dann sehen wir weiter.";
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(primaryRef, `decision:${action}`, { gate });
  const focusOnFull = action === "repeat" || action === "advance";
  const focusOnShorter = action === "smaller";
  return (
    <div className="rounded-3xl border border-primary p-4" data-testid="decision-card" data-decision={action}>
      <p className="rounded-xl bg-secondary p-3 text-base text-primary" role="status" data-testid="decision">
        {text}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {action === "smaller" && lesson.lines.length > 1 ? (
          <button ref={focusOnShorter ? primaryRef : undefined} type="button" disabled={busy} onClick={onShorter} className={primaryButton} data-testid="shorter-burst">
            Kürzere Runde (nur Zeile 1)
          </button>
        ) : null}
        {action === "repeat" || action === "smaller" || action === "advance" ? (
          <button ref={focusOnFull ? primaryRef : undefined} type="button" disabled={busy} onClick={onFull} className={focusOnFull ? primaryButton : secondaryButton} data-testid="another-burst">
            {action === "smaller" ? "Ganze Runde" : action === "advance" ? "Nächste Lektion starten" : "Noch eine Runde"}
          </button>
        ) : null}
        <button ref={action === "stop" ? primaryRef : undefined} type="button" disabled={busy} onClick={onContinue} className={action === "stop" ? primaryButton : secondaryButton} data-testid="course-continue">
          {action === "stop" || action === "advance" ? "Weiter" : "Für heute genug"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log revision — the child's original stays; spacing only
// ---------------------------------------------------------------------------

export function LogRevise({ view, busy, gate = alwaysOpen, onRevise, onSkip }: { view: ChildView; busy: boolean; gate?: Gate; onRevise: (text: string) => void; onSkip: () => void }) {
  const revise = view.logRevise;
  const [text, setText] = useState(revise?.original ?? "");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const nothing = !revise || revise.flags === 0;
  useDeliberateFocus(ref, !nothing ? "revise" : null, { gate, enabled: !nothing });
  useDeliberateFocus(continueRef, nothing ? "revise-none" : null, { gate, enabled: nothing });
  if (!revise) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onRevise(text.trim());
      }}
      className="flex flex-col gap-4"
    >
      <Instruction kicker="Schreiben">{nothing ? "Dein Satz passt." : "Schau deinen Satz noch einmal an."}</Instruction>
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
      <label className="sr-only" htmlFor="revise-text">
        Dein Satz
      </label>
      <textarea ref={ref} id="revise-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-xl text-primary", focusRing)} data-testid="revise-input" />
      <div className="flex flex-wrap gap-2">
        <button ref={nothing ? continueRef : undefined} type="submit" disabled={busy || !text.trim()} className={primaryButton} data-testid="revise-save">
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

export type SubmitHandler = (payload: Record<string, unknown>, idempotencyKey: string, identity: DraftIdentity | null) => Promise<LearningMutateOutcome | null>;

const authLost = (outcome: LearningMutateOutcome | null): boolean => !!outcome && !outcome.ok && "failure" in outcome && (outcome.failure === "unauthorized" || outcome.failure === "no-session");

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

export type DraftContext = { storage: DraftStorage | null; identity: DraftIdentity | null };

export const normaliseSentence = (text: string): string => text.replace(/\s+/g, " ").trim();

export function LogTransfer({ view, busy, gate = alwaysOpen, onSubmit, onSkip, drafts }: { view: ChildView; busy: boolean; gate?: Gate; onSubmit: SubmitHandler; onSkip: () => void; drafts?: DraftContext }) {
  const transfer = view.transfer;
  const [text, setText] = useState("");
  const draftRef = useRef<SubmitDraft | null>(null);
  const [draft, setDraft] = useState<SubmitDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const storage = drafts?.storage ?? null;
  const identity = drafts?.identity ?? null;
  const mountIdentityRef = useRef<DraftIdentity | null>(identity);
  const mountedRef = useRef(true);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useDeliberateFocus(ref, "transfer", { gate });
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
    persist(sending, payload);
    const outcome = await onSubmit(payload, sending.idempotencyKey, mountIdentityRef.current);
    const settled = applySubmitOutcome(sending, outcomeToDraft(outcome));
    if (!mountedRef.current) return;
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
      <Instruction kicker="Neuer Satz">{transfer.prompt}</Instruction>
      <p className="text-base text-tertiary">{transfer.instruction}</p>
      <label className="sr-only" htmlFor="transfer-text">
        Dein neuer Satz
      </label>
      <textarea ref={ref} id="transfer-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-xl text-primary", focusRing)} data-testid="transfer-input" />
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
// Reflection with optional feedback — all three dimensions optional
// ---------------------------------------------------------------------------

export function ReflectFeedback({ view, busy, gate = alwaysOpen, onSubmit, drafts }: { view: ChildView; busy: boolean; gate?: Gate; onSubmit: SubmitHandler; drafts?: DraftContext }) {
  const reflection = view.reflection;
  const [answers, setAnswers] = useState<Record<string, string | null | undefined>>({});
  const draftRef = useRef<SubmitDraft | null>(null);
  const [draft, setDraft] = useState<SubmitDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const storage = drafts?.storage ?? null;
  const identity = drafts?.identity ?? null;
  const mountIdentityRef = useRef<DraftIdentity | null>(identity);
  const mountedRef = useRef(true);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(firstRef, "reflect", { gate });
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
        {options.map((option, i) => (
          <button key={option.id} ref={big && i === 0 ? firstRef : undefined} type="button" disabled={busy || draft?.phase === "saving"} aria-pressed={answers[id] === option.id} onClick={() => setAnswers((a) => ({ ...a, [id]: option.id }))} className={cn(chipButton, big && "min-h-16", answers[id] === option.id && "ring-2 ring-stone-600 dark:ring-stone-200")} data-testid={`${id}-${option.id}`}>
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
      <Instruction kicker="Zum Schluss">Wie war es heute?</Instruction>
      {row("difficulty", reflection.prompt, reflection.options, reflection.skipLabel, true)}
      {dims.map((dim) => row(dim.id, dim.prompt, dim.options, dim.skipLabel, false))}
      {failed ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="reflect-notice" data-failure={failed.failure} data-restored={restored ? "true" : "false"}>
          {failed.failure === "refused" ? "Das ging so nicht. Schau deine Antworten nochmal an." : failed.failure === "stale" ? "Da war schon ein neuerer Stand — schau, wo du jetzt bist." : restored ? "Deine Antworten von vorhin sind noch da — sie wurden noch nicht gespeichert. Nochmal speichern oder verwerfen?" : "Speichern hat nicht geklappt. Deine Antworten sind noch da — nochmal speichern?"}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || draft?.phase === "saving" || (!difficultyOptional && !difficulty)} onClick={() => void send()} className={primaryButton} data-testid="reflect-submit">
          {failed && failed.failure === "network" ? "Nochmal speichern" : "Fertig — zum Bericht"}
        </button>
        {failed && failed.failure === "network" ? (
          <button type="button" onClick={discard} disabled={busy || draft?.phase === "saving"} className={secondaryButton} data-testid="reflect-discard">
            Verwerfen
          </button>
        ) : null}
      </div>
      <p className="text-sm text-tertiary">Danach siehst du deinen Bericht. Deine Seite ist gespeichert. Was du nicht sagst, bleibt einfach offen.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary stage (content stage of chapter 4) — the pre-report glance; the full
// reopenable report follows the reflection
// ---------------------------------------------------------------------------

const unlabel = (text: string) => text.replace(/^(Geschafft|Geübt|Nächstes Mal): /, "");

export function Summary({ view, busy, gate = alwaysOpen, onNext }: { view: ChildView; busy: boolean; gate?: Gate; onNext: () => void }) {
  const summary = view.summary;
  const ref = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(ref, "summary", { gate });
  if (!summary) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="summary">
      <Instruction kicker="Fast fertig">Das hast du heute geschafft.</Instruction>
      <ul className="grid gap-2 sm:grid-cols-3">
        <li className="rounded-2xl bg-green-50 px-4 py-3 text-base text-primary dark:bg-green-950/30" data-testid="summary-success">
          <span className="text-sm font-semibold uppercase tracking-wide text-tertiary">Geschafft</span>
          <br />
          {summary.success ? unlabel(summary.success.text) : "Du hast die Basis besucht."}
        </li>
        {summary.practiced ? (
          <li className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-primary dark:bg-amber-950/30" data-testid="summary-practiced">
            <span className="text-sm font-semibold uppercase tracking-wide text-tertiary">Geübt</span>
            <br />
            {unlabel(summary.practiced.text)}
          </li>
        ) : null}
        <li className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary" data-testid="summary-next">
          <span className="text-sm font-semibold uppercase tracking-wide text-tertiary">Nächstes Mal</span>
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
      <p className="text-sm text-tertiary">Noch eine Frage, dann kommt dein ganzer Bericht.</p>
      <button ref={ref} type="button" onClick={onNext} disabled={busy} className={cn(primaryButton, "self-start")} data-testid="summary-next-button">
        Weiter
      </button>
    </div>
  );
}
