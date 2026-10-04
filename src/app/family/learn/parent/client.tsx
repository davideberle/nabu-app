"use client";

// ---------------------------------------------------------------------------
// Parent evidence cockpit — /family/learn/parent (family-assistant DESIGN §7.6).
//
// Shows each child's attempts, support, fresh checks, delayed checks, work
// samples and the proposed next step, in separate math / German / English /
// Spanish / typing views with honest empty states. Detail exposes task and
// version, the actual answer, the rubric outcome, support and uncertainty.
// Corrections annotate; they never masquerade as child attempts. Deletion
// warns first and reports the separately managed conversation retention.
//
// Access is the owner's authenticated session (account rule settled
// 2026-09-29): the page is server-rendered only for info@davideberle.com and
// every parent API re-checks that identity. There is no unlock, cookie or
// re-authentication step.
//
// Authorization invalidation (independent browser review, 2026-09-29): the
// moment any parent call is refused (401/403) or a session probe finds no
// user, the client invalidates its authorization epoch — synchronously, in a
// ref — before React re-renders. Every evidence load, settings save, deletion
// and correction captures the epoch it started under and drops its result if
// the epoch moved, so an owner response fetched before the switch can never
// restore cleared data, and no stale handler can trigger a reload or flip the
// view back to "owner". The view re-checks the session on visibility return,
// window focus and pageshow (BFCache restore), so a sign-out or account switch
// in another tab clears this tab as well. Child selection and erasure
// generation fences are unchanged.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NabuBadge, cn } from "@/components/ui/nabu";
import { CHILD_IDS, type ChildId } from "@/lib/family-assistant-turn";
import type { EvidenceAttempt, EvidenceBundle } from "@/lib/family-learning-db";
import type { KeyboardLayoutId } from "@/lib/family-learning-content";
import type { DelayedCheckInfo, ParentReview } from "@/lib/family-learning-summary";
import { createSettingsDraft, editSettingsDraft, reconcileSettingsDraft, settingsSaveBody, type SettingsDraft, type SettingsSource } from "@/lib/family-learning-parent-draft";
import { beginRequest, clearEvidence, createEvidenceStore, describeTypingMetrics, invalidateAuthorization, isCurrentEpoch, receiveEvidence, renderableEvidence, selectChild, type EvidenceStore } from "@/lib/family-learning-parent-evidence";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const primaryButton = cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-stone-900 px-5 text-base font-semibold text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900", focusRing);
const secondaryButton = cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary bg-primary px-4 text-base font-medium text-primary hover:bg-secondary disabled:opacity-50", focusRing);
const dangerButton = cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-red-600 px-4 text-base font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40", focusRing);

type Evidence = EvidenceBundle & { prepared: boolean; contentCounts: Record<string, number> | null; owner: string; delayedCheck?: DelayedCheckInfo | null; visits?: { id: string; ordinal: number | null; label: string; retired: boolean }[] };

/** Learner-facing visit name (server-computed): "Besuch 3 — Die Beobachtungsstation (v4)"; falls back to the id. */
function visitName(evidence: Evidence, id: string): string {
  const v = evidence.visits?.find((x) => x.id === id);
  return v ? `${v.label} (${id})` : id;
}

type Tab = "math" | "de" | "en" | "es" | "typing" | "review" | "settings";

/**
 * A parent operation's ticket: `current()` is true only while the
 * authorization epoch it started under is still the live one. Handlers call
 * it after every await and drop the result otherwise.
 */
type OperationTicket = { current: () => boolean };
type ParentOps = { onChanged: () => void; onLocked: () => void; begin: () => OperationTicket };

const CHILD_LABEL: Record<ChildId, string> = { santiago: "Santiago", isabel: "Isabel" };
const LAYOUTS: { id: KeyboardLayoutId; label: string }[] = [
  { id: "ch-de-qwertz", label: "Schweizer Tastatur (QWERTZ, de-CH)" },
  { id: "de-qwertz", label: "Deutsche Tastatur (QWERTZ, de-DE)" },
  { id: "us-qwerty", label: "US-Tastatur (QWERTY)" },
];

const EVIDENCE_LABEL: Record<string, { label: string; tone: "green" | "amber" | "stone" | "blue" | "violet" }> = {
  independent: { label: "selbständig", tone: "green" },
  supported: { label: "mit Hilfe", tone: "amber" },
  answer_exposed: { label: "Lösung war sichtbar", tone: "violet" },
  incorrect: { label: "falsch", tone: "stone" },
  unscored: { label: "nicht bewertet", tone: "blue" },
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function api<T>(input: string, init?: RequestInit): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: Record<string, unknown> }> {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: data as T };
  return { ok: false, status: response.status, data: (data as Record<string, unknown>) ?? {} };
}

export function FamilyLearnParentClient() {
  const [tab, setTab] = useState<Tab>("math");
  // Evidence orchestration (lib/family-learning-parent-evidence.ts): selecting
  // a child clears the shown bundle at once; a response is adopted only if it
  // is the latest request, names the selected child and does not regress the
  // generation already shown for that child. The rendered evidence is always
  // the selected child's own bundle, so a form can never bind another child's
  // settings to the selection.
  const [store, setStore] = useState<EvidenceStore<Evidence>>(() => createEvidenceStore<Evidence>("santiago"));
  const storeRef = useRef(store);
  storeRef.current = store;
  const child = store.selected;
  const evidence = renderableEvidence(store);
  const [access, setAccess] = useState<"checking" | "owner" | "denied" | "error">("checking");
  const [notice, setNotice] = useState<string | null>(null);
  const setChild = (next: ChildId) => {
    const selected = selectChild<Evidence>(storeRef.current, next);
    storeRef.current = selected;
    setStore(selected);
  };

  /** Ticket for an operation starting now (see `OperationTicket`). */
  const begin = useCallback((): OperationTicket => {
    const epoch = storeRef.current.authEpoch;
    return { current: () => isCurrentEpoch(storeRef.current, epoch) };
  }, []);

  /**
   * The server decided the session is not the owner's (or the session is
   * gone): invalidate synchronously in the ref so any response already in
   * flight — evidence, settings, deletion, correction — is superseded before
   * it can be applied, then drop everything shown.
   */
  const denied = useCallback(() => {
    const invalidated = invalidateAuthorization<Evidence>(storeRef.current);
    storeRef.current = invalidated;
    setStore(invalidated);
    setNotice(null);
    setAccess("denied");
  }, []);

  const loadEvidence = useCallback(async (which: ChildId) => {
    // Request against the CURRENT selection only; the sequence fences the
    // response by child/generation and the ticket by authorization epoch.
    if (storeRef.current.selected !== which) return;
    const ticket = begin();
    const begun = beginRequest<Evidence>(storeRef.current);
    storeRef.current = begun.store;
    setStore(begun.store);
    const result = await api<Evidence>(`/api/family/learning/parent/evidence?child=${which}`);
    // Fetched under an authorization that has since been invalidated: the
    // sequence is already superseded and the outcome is dropped either way.
    if (!ticket.current()) return;
    if (result.ok) {
      const received = receiveEvidence<Evidence>(storeRef.current, begun.seq, result.data);
      storeRef.current = received.store;
      setStore(received.store);
      // Only an adopted, current response may present the view as the owner's.
      if (received.outcome === "adopted") {
        setAccess("owner");
        setNotice(null);
      }
      return;
    }
    if (result.status === 401 || result.status === 403) {
      denied();
      return;
    }
    const cleared = clearEvidence<Evidence>(storeRef.current, begun.seq);
    storeRef.current = cleared;
    setStore(cleared);
    setAccess("error");
    setNotice("Die Evidenz konnte nicht geladen werden. Versuch es gleich nochmal.");
  }, [begin, denied]);

  useEffect(() => {
    void loadEvidence(child);
  }, [child, loadEvidence]);

  /**
   * Re-check the session whenever this tab comes back: visibility return,
   * window focus, and pageshow (including a BFCache restore). A sign-out or
   * account switch in another tab is then answered by the server with 401/403
   * and clears this view. The evidence reload is the only probe on purpose:
   * the parent API answers without re-issuing the session cookie, whereas a
   * `/api/auth/session` call would re-sign it and could resurrect a session
   * that was signed out while the call was in flight.
   */
  const revalidate = useCallback(() => {
    void loadEvidence(storeRef.current.selected);
  }, [loadEvidence]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    const onReturn = () => revalidate();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [revalidate]);

  const ops: ParentOps = useMemo(() => ({ onChanged: () => void loadEvidence(storeRef.current.selected), onLocked: denied, begin }), [loadEvidence, denied, begin]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/family/dashboard" className={cn("text-sm text-tertiary hover:text-primary", focusRing)}>
            ← Familie
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.02em] text-primary">Lern-Evidenz</h1>
          <p className="mt-1 text-base text-tertiary">Was die Kinder in der Expedition gezeigt haben — getrennt nach Hilfe, frischem Check und Wiederholung.</p>
        </div>
        {access === "owner" && evidence ? <NabuBadge tone="green">Eltern-Konto {evidence.owner}</NabuBadge> : null}
      </header>

      {access === "denied" ? (
        <section className="mt-6 rounded-3xl border border-primary bg-primary p-6">
          <h2 className="text-xl font-semibold text-primary">Nur mit dem Eltern-Konto</h2>
          <p className="mt-2 text-base text-tertiary">
            Diese Ansicht öffnet nur die Anmeldung mit dem Eltern-Konto (info@davideberle.com). Das gemeinsame Kinder-Gerät ist mit dem Assistenten-Konto angemeldet und sieht nur die Kinder-Ansichten. Bitte auf dem eigenen Gerät mit dem Eltern-Konto anmelden.
          </p>
          <p className="mt-2 text-sm text-tertiary">Hinweis: Eine aktive Anmeldung mit dem Eltern-Konto genügt — wer an einem entsperrten Eltern-Gerät sitzt, sieht diese Ansicht.</p>
        </section>
      ) : null}
      {notice ? <p className="mt-6 rounded-2xl bg-secondary px-4 py-3 text-base text-primary">{notice}</p> : null}

      {access !== "denied" ? (
        <>
          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Kind">
            {CHILD_IDS.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={child === id} onClick={() => setChild(id)} className={cn(secondaryButton, child === id && "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900")}>
                {CHILD_LABEL[id]}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Bereich">
            {(
              [
                ["math", "Mathe"],
                ["de", "Deutsch"],
                ["en", "Englisch"],
                ["es", "Spanisch"],
                ["typing", "Tippen"],
                ["review", "Rückblick"],
                ["settings", "Einstellungen"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn(secondaryButton, tab === id && "bg-secondary")}>
                {label}
              </button>
            ))}
          </div>

          {evidence && evidence.child === child ? (
            <EvidenceView key={evidence.child} evidence={evidence} tab={tab} child={evidence.child} ops={ops} />
          ) : (
            <p className="mt-6 text-base text-tertiary">Evidenz wird geladen …</p>
          )}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EvidenceView({ evidence, tab, child, ops }: { evidence: Evidence; tab: Tab; child: ChildId; ops: ParentOps }) {
  const math = evidence.attempts.filter((a) => a.objective === "equal-sharing" || a.objective === "equal-sharing-with-remainder");
  const lang = (code: string) => evidence.attempts.filter((a) => a.stimulusLanguage === code && a.objective.startsWith("language-"));
  const samplesDe = evidence.samples.filter((s) => s.kind === "explanation" || s.kind === "expedition_log" || s.kind === "expedition_log_revision" || s.kind === "writing_transfer");
  const typingSamples = evidence.samples.filter((s) => s.kind === "typing_practice" || s.kind === "typed_label" || s.kind === "typing_burst" || s.kind === "typing_retry");
  const state = evidence.state;

  if (!evidence.prepared && evidence.attempts.length === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-primary bg-primary p-6">
        <p className="text-base text-primary">Für {CHILD_LABEL[child]} ist noch keine Mission vorbereitet. Es gibt keine Aufzeichnungen.</p>
      </section>
    );
  }

  return (
    <section className="mt-6 space-y-6">
      {tab === "math" ? (
        <>
          <NextStep evidence={evidence} />
          <AttemptTable title="Gleichmässig teilen (EQ-Aufgaben, inkl. Rest bei EQ-STATION)" attempts={math} child={child} ops={ops} empty="Noch kein Mathe-Versuch aufgezeichnet." visits={evidence.visits} />
          <DelayedCheck evidence={evidence} />
          <SupportList evidence={evidence} filter={(k) => k !== "gloss"} />
        </>
      ) : null}
      {tab === "de" ? (
        <>
          <SampleList title="Erklärungen und Logbuch (Deutsch)" samples={samplesDe} empty="Noch keine Erklärung oder Logbuchseite." />
          <LogRevisions evidence={evidence} />
          <Transfers evidence={evidence} />
          <p className="text-sm text-tertiary">Deutsch ist die Anker-Sprache: Vorlesen zählt als Zugangs-Hilfe und wird bei den Mathe-Versuchen ausgewiesen, nicht als Lese-Evidenz.</p>
        </>
      ) : null}
      {tab === "en" ? <LanguageView code="en" attempts={lang("en")} samples={evidence.samples.filter((s) => s.language === "en")} child={child} ops={ops} evidence={evidence} /> : null}
      {tab === "es" ? <LanguageView code="es" attempts={lang("es")} samples={evidence.samples.filter((s) => s.language === "es")} child={child} ops={ops} evidence={evidence} /> : null}
      {tab === "typing" ? (
        <>
          <TypingSetup evidence={evidence} />
          <SampleList title="Tipp-Übungen, Kurs-Runden und Schilder" samples={typingSamples} empty="Noch keine Tipp-Aufzeichnung." showMetrics />
          <p className="text-sm text-tertiary">Aufgezeichnet wird nur die Genauigkeit innerhalb der Aufgabe (Metrik v1: Position für Position; Metrik v2: Zeichen-Ausrichtung — Einfügungen und Auslassungen verschieben nicht die ganze Zeile). Welche Finger benutzt wurden, kann nur ein Erwachsener beim Zuschauen beurteilen.</p>
        </>
      ) : null}
      {tab === "review" ? <ReviewTab evidence={evidence} /> : null}
      {tab === "settings" ? <Settings key={`${evidence.child}:${evidence.erasureGeneration}`} evidence={evidence} child={evidence.child} ops={ops} /> : null}
      {state ? (
        <p className="text-xs text-tertiary">
          Mission {state.missionId} v{state.contentVersion} · Stand {fmt(state.updatedAt)} · Revision {state.revision} · Besuche abgeschlossen: {state.visits.filter((v) => v.finishedAt).length}
        </p>
      ) : null}
    </section>
  );
}

function NextStep({ evidence }: { evidence: Evidence }) {
  const state = evidence.state;
  const math = evidence.attempts.filter((a) => a.objective === "equal-sharing");
  const fresh = math.filter((a) => a.taskId === "EQ-FRESH");
  const ret = math.filter((a) => a.taskId === "EQ-RETURN");
  const v4Done = !!state?.visits.some((v) => v.id === "v4" && v.finishedAt);
  const v4Running = !!state?.visits.some((v) => v.id === "v4" && !v.finishedAt);
  const v3Running = !!state?.visits.some((v) => v.id === "v3" && !v.finishedAt);
  const chapter = evidence.visits?.find((v) => v.id === "v4")?.label ?? "Besuch 3 — Die Beobachtungsstation";
  const v5Served = !!evidence.visits?.some((v) => v.id === "v5");
  const v5Done = !!state?.visits.some((v) => v.id === "v5" && v.finishedAt);
  const v5Running = !!state?.visits.some((v) => v.id === "v5" && !v.finishedAt);
  const chapter5 = evidence.visits?.find((v) => v.id === "v5")?.label ?? "Besuch 4 — Der Steg in der Bucht";
  let text: string;
  if (!state || state.visits.length === 0) text = "Noch kein Besuch. Der nächste Schritt ist der erste Besuch: Basis bauen, 24 Pakete gerecht teilen.";
  else if (fresh.length === 0) text = "Erster Besuch läuft. Nächster Schritt: der frische Check nach der Erklärung (EQ-FRESH).";
  else if (ret.length === 0) text = "Nächster Schritt: Besuch 2 mit dem Transfer-Check (Setzlinge, EQ-RETURN) — noch nicht geprüft.";
  else if (v3Running) text = "Ein vor dem 30. September angefangener später Check (v3) wartet noch auf seinen Abschluss; danach folgt die Beobachtungsstation. Er wird nicht mehr neu angeboten.";
  else if (v4Running) text = `${chapter} läuft (intern v4, Rest-Aufgabe EQ-STATION).`;
  else if (!v4Done) text = `Nächster Schritt: ${chapter} (intern v4, Beobachtungsstation mit Rest-Aufgabe EQ-STATION) — sofort verfügbar. Der frühere späte Check (v3, EQ-DELAY) ist seit dem 30. September zurückgezogen und keine ausstehende Arbeit.`;
  else if (v5Running) text = `${chapter5} läuft (intern v5, Rest-Aufgabe EQ-PIER, englische Anfrage LANG-EN-PIER).`;
  else if (v5Served && !v5Done) text = `Nächster Schritt: ${chapter5} (intern v5: Rest-Aufgabe EQ-PIER mit 45 Brettern, englische Anfrage LANG-EN-PIER, Steg bauen, neuer Satz WRITE-TRANSFER-2) — sofort verfügbar.`;
  else if (v5Done) text = "Alle Inhalte (Besuche 1–4) sind durchlaufen. Weitere Aufgaben brauchen neue, geprüfte Inhalte; eine spätere Abruf-Aufgabe mit Abstand wäre eine neue, separat geprüfte Aktivität.";
  else text = "Alle Inhalte (Besuche 1–3) sind durchlaufen. Weitere Aufgaben brauchen neue, geprüfte Inhalte; eine spätere Abruf-Aufgabe mit Abstand wäre eine neue, separat geprüfte Aktivität.";
  return (
    <div className="rounded-2xl bg-secondary px-4 py-3" data-testid="parent-next-step">
      <p className="text-sm font-medium text-tertiary">Vorgeschlagener nächster Schritt</p>
      <p className="mt-1 text-base text-primary">{text}</p>
    </div>
  );
}

function DelayedCheck({ evidence }: { evidence: Evidence }) {
  const delay = evidence.attempts.filter((a) => a.taskId === "EQ-DELAY");
  return (
    <div className="rounded-2xl border border-primary p-4">
      <p className="text-base font-semibold text-primary">Später Check (zurückgezogen)</p>
      {delay.length === 0 ? (
        <p className="mt-1 text-base text-tertiary" data-testid="delayed-check-parent" data-status={evidence.delayedCheck?.status ?? "none"}>
          {evidence.delayedCheck ? evidence.delayedCheck.parentText : "Der späte Check (EQ-DELAY, v3) wurde am 30. September 2026 zurückgezogen; er wird nicht mehr angeboten und hat keinen Termin."}
        </p>
      ) : (
        <p className="mt-1 text-base text-primary">
          Beobachtet am {fmt(delay[delay.length - 1].createdAt)} · {Math.round((delay[delay.length - 1].secondsSinceTeaching ?? 0) / 86400)} Tage nach dem Anker · {EVIDENCE_LABEL[delay[delay.length - 1].evidence]?.label}
        </p>
      )}
    </div>
  );
}

function AttemptTable({ title, attempts, child, ops, empty, visits }: { title: string; attempts: EvidenceAttempt[]; child: ChildId; ops: ParentOps; empty: string; visits?: Evidence["visits"] }) {
  const [open, setOpen] = useState<string | null>(null);
  const visitName = (id: string) => {
    const v = visits?.find((x) => x.id === id);
    return v ? `${v.label} (${id})` : `Besuch ${id}`;
  };
  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {attempts.length === 0 ? (
        <p className="mt-2 text-base text-tertiary">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {attempts.map((a) => {
            const answer = a.answer as { value?: unknown; raw?: unknown; response?: unknown } | null;
            const shown = answer?.raw ?? answer?.value ?? answer?.response ?? "—";
            const tone = EVIDENCE_LABEL[a.evidence] ?? { label: a.evidence, tone: "stone" as const };
            return (
              <li key={a.id} className="rounded-2xl border border-primary bg-primary p-3">
                <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className={cn("flex w-full flex-wrap items-center gap-2 text-left", focusRing)} aria-expanded={open === a.id}>
                  <span className="font-mono text-sm text-tertiary">
                    {a.taskId} v{a.taskVersion} · #{a.attemptNo}
                  </span>
                  <span className="text-base text-primary">Antwort: {String(shown)}</span>
                  <NabuBadge tone={tone.tone}>{tone.label}</NabuBadge>
                  {a.parentCorrection ? <NabuBadge tone="blue">Korrektur: {a.parentCorrection.evidence ? EVIDENCE_LABEL[a.parentCorrection.evidence]?.label : "Notiz"}</NabuBadge> : null}
                  <span className="ml-auto text-sm text-tertiary">{fmt(a.createdAt)}</span>
                </button>
                {open === a.id ? (
                  <div className="mt-3 space-y-1 text-sm text-primary">
                    <p>{visitName(a.visitId)} · Modalität {a.modality} · Sprache {a.stimulusLanguage}{a.responseLanguage ? ` → ${a.responseLanguage}` : ""}</p>
                    <p>Korrekt: {a.correct === null ? "nicht bewertet" : a.correct ? "ja" : "nein"} · Exposition vorher: {a.exposureBefore}</p>
                    <p>Hilfe: {a.support.length ? a.support.join(", ") : "keine"}</p>
                    {a.uncertainty ? <p>Unsicherheit: {a.uncertainty}</p> : null}
                    {a.teachingMove ? <p>Lehr-Schritt danach: {a.teachingMove} ({a.teachingReason})</p> : null}
                    {a.secondsSinceTeaching !== null ? <p>Seit Anker: {Math.round(a.secondsSinceTeaching / 3600)} h</p> : null}
                    {a.parentCorrection ? <p className="text-tertiary">Eltern-Korrektur ({fmt(a.parentCorrection.at)}): {a.parentCorrection.evidence ?? ""} {a.parentCorrection.note ?? ""}</p> : null}
                    <CorrectionForm attempt={a} child={child} ops={ops} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CorrectionForm({ attempt, child, ops }: { attempt: EvidenceAttempt; child: ChildId; ops: ParentOps }) {
  const [evidence, setEvidence] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const ticket = ops.begin();
        const result = await api("/api/family/learning/parent/corrections", { method: "POST", body: JSON.stringify({ child, attemptId: attempt.id, evidence: evidence || null, note: note || null }) });
        setBusy(false);
        // Started under an authorization that has since been invalidated: drop the result.
        if (!ticket.current()) return;
        if (!result.ok) {
          if (result.status === 401 || result.status === 403) {
            ops.onLocked();
            return;
          }
          setError(String(result.data.error ?? "Korrektur nicht gespeichert"));
          return;
        }
        setNote("");
        setEvidence("");
        ops.onChanged();
      }}
      className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-secondary p-2"
    >
      <label className="flex flex-col text-xs text-tertiary">
        Evidenz korrigieren
        <select value={evidence} onChange={(e) => setEvidence(e.target.value)} className={cn("min-h-10 rounded-lg border border-primary bg-primary px-2 text-sm text-primary", focusRing)}>
          <option value="">— unverändert —</option>
          {Object.entries(EVIDENCE_LABEL).map(([id, v]) => (
            <option key={id} value={id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-48 flex-1 flex-col text-xs text-tertiary">
        Notiz (z. B. „Ich habe geholfen“)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={cn("min-h-10 rounded-lg border border-primary bg-primary px-2 text-sm text-primary", focusRing)} />
      </label>
      <button type="submit" disabled={busy || (!evidence && !note.trim())} className={secondaryButton}>
        Korrektur speichern
      </button>
      {error ? <span className="text-sm text-red-700 dark:text-red-300">{error}</span> : null}
    </form>
  );
}

function SupportList({ evidence, filter }: { evidence: Evidence; filter: (kind: string) => boolean }) {
  const items = evidence.supports.filter((s) => filter(s.kind));
  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">Hilfe und Tutor</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-base text-tertiary">Keine Hilfe aufgezeichnet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-primary">
          {items.map((s) => {
            const payload = (s.payload ?? {}) as Record<string, unknown>;
            return (
              <li key={s.id} className="rounded-xl bg-secondary px-3 py-2">
                <span className="font-mono text-tertiary">{fmt(s.createdAt)}</span> · {s.kind} {s.taskId ? `(${s.taskId})` : ""}
                {typeof payload.text === "string" && payload.text ? <span className="block text-tertiary">„{payload.text.slice(0, 240)}“</span> : null}
                {payload.classification ? <span className="block text-tertiary">Einstufung: {String(payload.classification)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TypingSetup({ evidence }: { evidence: Evidence }) {
  const layout = evidence.settings.keyboardLayout;
  const alignment = evidence.state?.typing.alignment ?? null;
  const course = evidence.state?.typing.course ?? null;
  const layoutLabel = LAYOUTS.find((l) => l.id === layout)?.label ?? layout;
  return (
    <div className="rounded-2xl border border-primary p-4" data-testid="typing-setup">
      <p className="text-base font-semibold text-primary">Tastatur-Einrichtung</p>
      {!layout ? (
        <p className="mt-1 text-base text-primary">Tastatur-Layout noch nicht bestätigt — Finger-Übungen und Finger-Kurs sind gesperrt. Bestätigen unter „Einstellungen“.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-base text-primary">
          <li>Physische Tastatur (von dir bestätigt): {layoutLabel}</li>
          <li>
            Eingabequelle am Gerät:{" "}
            {!alignment || alignment.layout !== layout
              ? "noch nicht geprüft — der Kurs bleibt gesperrt, bis das Kind den Tastatur-Check gemacht hat (drei Tasten, keine Punkte)."
              : alignment.result === "match"
                ? `passt (geprüft ${fmt(alignment.checkedAt)}).`
                : `passt NICHT (geprüft ${fmt(alignment.checkedAt)})${alignment.matchesLayout ? ` — die Zeichen sehen aus wie ${LAYOUTS.find((l) => l.id === alignment.matchesLayout)?.label ?? alignment.matchesLayout}` : ""}. Bitte am Mac unter Systemeinstellungen → Tastatur → Eingabequellen „Deutsch (Schweiz)“ wählen und den Check wiederholen. Es wird nichts ersatzweise geübt.`}
          </li>
          {alignment && alignment.result === "mismatch" ? <li className="text-sm text-tertiary">{alignment.observed.map((o) => `${o.id}: erwartet „${o.expected}“, bekommen „${o.got}“`).join(" · ")}</li> : null}
          {course ? (
            <li>
              Finger-Kurs: Lektion {course.lessonIndex + 1} · {course.bursts.length} Runden insgesamt · abgeschlossen: {course.completed.length ? course.completed.join(", ") : "—"}
              {course.decision ? ` · letzte Entscheidung: ${course.decision.action} (${course.decision.reason})` : ""}
            </li>
          ) : (
            <li className="text-sm text-tertiary">Finger-Kurs: noch keine Runde.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function LogRevisions({ evidence }: { evidence: Evidence }) {
  const revisions = evidence.state?.logRevisions ?? [];
  if (revisions.length === 0) return null;
  return (
    <div className="rounded-2xl border border-primary p-4" data-testid="log-revisions">
      <p className="text-base font-semibold text-primary">Überarbeitung (Leerzeichen)</p>
      <ul className="mt-1 space-y-2">
        {revisions.map((r, i) => (
          <li key={`${r.at}-${i}`} className="text-base text-primary">
            <p className="text-sm text-tertiary">
              {fmt(r.at)} · {r.flagged.length} {r.flagged.length === 1 ? "Stelle" : "Stellen"} markiert{r.helpShown ? " (Hilfe gezeigt)" : ""} · Ergebnis: {r.outcome === "revised" ? "alle behoben" : r.outcome === "partial" ? `${r.resolved} von ${r.flagged.length} behoben` : r.outcome === "unchanged" ? "unverändert gelassen" : r.outcome === "skipped" ? "übersprungen („So lassen“)" : "keine geprüfte Stelle betroffen (nur die drei geprüften Fälle, keine Aussage über den ganzen Satz)"}
            </p>
            <p>Original: {r.original}</p>
            {r.revised !== null && r.revised !== r.original ? <p>Überarbeitet: {r.revised}</p> : null}
            {r.flagged.length ? <p className="text-sm text-tertiary">Markiert: {r.flagged.map((f) => `${f.before}|${f.after}`).join(", ")}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One of: the answer, "nicht gesagt" (explicit skip), "offen gelassen" (left open), "nicht abgefragt" (content offered nothing). */
function feedbackWord(fb: ParentReview["experience"]["childFeedback"], dim: "difficulty" | "enjoyment" | "clarity"): string {
  const value = fb[dim];
  if (value) return value;
  if (fb.skipped.includes(dim)) return "nicht gesagt";
  if ((fb.unanswered ?? []).includes(dim)) return "offen gelassen";
  if (fb.notOffered.includes(dim)) return "nicht abgefragt";
  return "—";
}

function Transfers({ evidence }: { evidence: Evidence }) {
  const transfers = evidence.state?.transfers ?? [];
  if (transfers.length === 0) return null;
  return (
    <div className="rounded-2xl border border-primary p-4" data-testid="transfers">
      <p className="text-base font-semibold text-primary">Neuer Satz (Transfer der Leerzeichen-Regel)</p>
      <ul className="mt-1 space-y-2">
        {transfers.map((t, i) => (
          <li key={`${t.at}-${i}`} className="text-base text-primary">
            <p className="text-sm text-tertiary">
              {fmt(t.at)} · {t.id} v{t.version} ·{" "}
              {t.outcome === "skipped"
                ? "übersprungen"
                : t.assessed === undefined
                  ? "Aufzeichnung vor Runde 3 — nicht bewertet"
                  : t.outcome === "unassessable"
                    ? "keine geprüfte Stelle im Satz — nicht bewertet (kein Erfolg, kein Fehler)"
                    : t.outcome === "clean"
                      ? `${t.assessed} geprüfte ${t.assessed === 1 ? "Stelle" : "Stellen"}, alle richtig`
                      : `${t.assessed} geprüfte ${t.assessed === 1 ? "Stelle" : "Stellen"}, ${t.flagged.length} ohne Leerzeichen`}{" "}
              · Hilfe vorher gezeigt: {t.helpExposed ? "ja" : "nein"} · {t.modality}
            </p>
            {t.text ? <p>{t.text}</p> : null}
            {t.flagged.length ? <p className="text-sm text-tertiary">Markiert: {t.flagged.map((f) => `${f.before}|${f.after}`).join(", ")}</p> : null}
            <p className="text-xs text-tertiary">Nur die drei geprüften Leerzeichen-Fälle; keine Aussage über Rechtschreibung.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewTab({ evidence }: { evidence: Evidence }) {
  const completions = [...evidence.completions].sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
  return (
    <div className="space-y-4" data-testid="review-tab">
      <p className="text-sm text-tertiary">
        Ein Rückblick pro abgeschlossenem Besuch, gespeichert genau einmal (Kennung Kind/Mission/Besuch/Start). Zustellung: nur hier im Eltern-Bereich — es gibt keinen belegten Weg, Erwachsenen-Nachrichten über Clavus zu senden. Lernen (Was war, Belege, nächster Unterricht) und Erlebnis (Bedienung, Hypothesen) sind getrennt.
      </p>
      {completions.length === 0 ? <p className="text-base text-tertiary">Noch kein abgeschlossener Besuch.</p> : null}
      {completions.map((c) => (
        <ReviewCard key={c.completionId} completion={c} visitTitle={evidence.visits?.find((v) => v.id === c.visitId)?.label ?? null} />
      ))}
    </div>
  );
}

function TelemetryLine({ t }: { t: ParentReview["experience"]["telemetry"] }) {
  if (!t.supported) return <p className="mt-2 text-sm text-tertiary">Keine Bedienungs-Daten für diesen Besuch.</p>;
  if (!t.uxObserved) {
    return (
      <p className="mt-2 text-sm text-primary" data-testid="ux-missing">
        <span className="font-medium">Bedienungs-Daten: nicht erfasst.</span> Vom Gerät kam keine Beobachtung an — nur die Antworten des Kindes ({t.feedbackEvents} Angabe{t.feedbackEvents === 1 ? "" : "n"}) sind gespeichert. Aktive Zeit, Fenster-Wechsel, Pausen, Speicherfehler und Wiederholungen sind unbekannt, nicht null.
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-primary" data-testid="ux-observed">
      {t.batches} Pakete, {t.uxEvents} Bedienungs-Ereignisse{t.feedbackEvents ? ` + ${t.feedbackEvents} Angaben des Kindes` : ""} · aktive Zeit im Vordergrund {t.foregroundActiveSeconds ?? "—"} s (Leerlauf-Regel {t.idleRuleSeconds} s; ein Schätzwert für Eingabe-Aktivität, kein Aufmerksamkeits-Mass) · {t.hiddenIntervals ?? "—"}× Fenster verlassen · {t.pauses ?? "—"}× Stopp/Pause (Pausenzeit zählt nicht als aktiv) · {t.saveFailures ?? "—"} Speicherfehler · {t.retries ?? "—"} Wiederholungen
      {t.unobservedStages?.length ? <span className="text-tertiary"> · ohne Beobachtung: {t.unobservedStages.join(", ")} (übersprungen oder nicht übermittelt)</span> : null}
      <span className="text-tertiary"> · nur übermittelte Pakete; nicht angekommene fehlen ohne Hinweis</span>
    </p>
  );
}

function ReviewCard({ completion, visitTitle }: { completion: Evidence["completions"][number]; visitTitle: string | null }) {
  const r: ParentReview | null = completion.review;
  const derivation = completion.derivation ?? { status: "current" as const };
  if (derivation.status === "obsolete") {
    // R5-4: a stored derivation older than the current learning rules that cannot be re-derived under the
    // served content is not shown as evidence; only raw facts are, and the records stay untouched.
    const t = derivation.retained.telemetry;
    const fb = derivation.retained.childFeedback;
    return (
      <article className="rounded-3xl border border-amber-300 bg-primary p-5" data-testid={`review-${completion.visitId}`} data-historical={completion.historical ? "true" : "false"} data-derivation="obsolete">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-primary">{visitTitle ?? derivation.retained.title ?? completion.visitId}</h2>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-primary">Inhalte v{completion.contentVersion}</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Auswertung nicht verfügbar — überholte Regelfassung</span>
        </div>
        <p className="mt-1 text-sm text-tertiary">
          Abgeschlossen {fmt(completion.finishedAt)} · Kennung {completion.completionId} · Zustellung: {completion.delivery?.channel === "cockpit" ? "Eltern-Bereich" : "—"} · gespeicherte Regelfassung {derivation.storedVersion}, aktuell {derivation.currentVersion}
        </p>
        <div className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="review-obsolete">
          <p className="font-medium">Rückblick nicht verfügbar.</p>
          <p className="mt-1">{derivation.note}</p>
          <p className="mt-1">Sobald die passenden Inhalte wieder bereitgestellt sind, wird der Rückblick aus den Aufzeichnungen neu abgeleitet und die frühere Fassung offengelegt. Die Rohdaten sind unter „Deutsch“, „Mathe“ und „Tippen“ weiterhin einsehbar.</p>
        </div>
        <section className="mt-3 rounded-2xl bg-secondary p-4">
          <h3 className="text-base font-semibold text-primary">Erlebnis und Bedienung</h3>
          {fb ? (
            <div className="mt-2 rounded-xl bg-primary p-2 text-sm text-primary" data-testid="child-feedback">
              <span className="font-medium">Vom Kind gesagt:</span> Schwierigkeit {feedbackWord(fb, "difficulty")} · Spass {feedbackWord(fb, "enjoyment")} · Klarheit {feedbackWord(fb, "clarity")}
              <span className="text-tertiary"> (Antworten des Kindes, keine Hypothesen; Leerstellen bleiben leer.)</span>
            </div>
          ) : null}
          <TelemetryLine t={t} />
        </section>
      </article>
    );
  }
  return (
    <article className="rounded-3xl border border-primary bg-primary p-5" data-testid={`review-${completion.visitId}`} data-historical={completion.historical ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-primary">{visitTitle ?? r?.learning.childSummary.title ?? completion.visitId}</h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-primary">Inhalte v{completion.contentVersion} · intern {completion.visitId}</span>
        {completion.historical ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Rückwirkend aus Aufzeichnungen erstellt — keine Bedienungs-Daten</span> : null}
      </div>
      <p className="mt-1 text-sm text-tertiary">
        Abgeschlossen {fmt(completion.finishedAt)} · Kennung {completion.completionId} · Zustellung: {completion.delivery?.channel === "cockpit" ? "Eltern-Bereich" : "—"}
        {r?.identity.reviewVersion ? ` · Ableitung Fassung ${r.identity.reviewVersion}${r.identity.derivedAt ? ` (${fmt(r.identity.derivedAt)})` : ""}` : ""}
      </p>
      {derivation.status === "projected" ? (
        <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="review-projected">
          Hinweis: {derivation.note} (gespeicherte Regelfassung {derivation.storedVersion}, aktuell {derivation.currentVersion})
        </p>
      ) : null}
      {r?.previousReviews?.length ? (
        <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="review-refreshed">
          <p className="font-medium">Dieser Rückblick wurde aus den gespeicherten Aufzeichnungen neu abgeleitet (Kennung, Daten und Originaltexte unverändert).</p>
          <ul className="mt-1 list-disc pl-5">
            {r.previousReviews.map((prev, i) => {
              const changed = prev.objectives.filter((po) => {
                const now = r.learning.objectives.find((o) => o.taskId === po.taskId);
                return !now || now.evidence !== po.evidence || now.outcome !== po.outcome;
              });
              return (
                <li key={i}>
                  Frühere Fassung {prev.reviewVersion}
                  {prev.derivedAt ? ` (${fmt(prev.derivedAt)})` : ""}:{" "}
                  {changed.length
                    ? changed.map((po) => {
                        const now = r.learning.objectives.find((o) => o.taskId === po.taskId);
                        return `${po.taskId} war „${po.outcome}/${po.evidence}“, jetzt „${now ? `${now.outcome}/${now.evidence}` : "nicht mehr bewertet"}“`;
                      }).join("; ")
                    : "keine geänderte Einstufung"}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {r ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl bg-secondary p-4">
            <h3 className="text-base font-semibold text-primary">Lernen</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-base text-primary">
              {r.learning.whatHappened.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            {r.learning.objectives.length ? (
              <ul className="mt-3 space-y-2 text-sm text-primary">
                {r.learning.objectives.map((o) => (
                  <li key={o.taskId} className="rounded-xl bg-primary p-2">
                    <span className="font-medium">
                      {o.taskId} v{o.version}
                    </span>{" "}
                    · {o.objective} · <span className="font-medium">{EVIDENCE_LABEL[o.outcome]?.label ?? o.outcome}</span>
                    <br />
                    {o.evidence}
                    {o.support.length ? <span className="text-tertiary"> · Hilfe: {o.support.join(", ")}</span> : null}
                    {o.uncertainty ? <span className="text-tertiary"> · Unsicherheit: {o.uncertainty}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {r.learning.lessons?.length ? (
              <div className="mt-3" data-testid="review-lessons">
                <p className="text-sm font-medium text-primary">Schritt für Schritt — genau so, wie das Kind es im Bericht sieht</p>
                <ul className="mt-1 space-y-1 text-sm text-primary">
                  {r.learning.lessons.map((l) => (
                    <li key={l.id} className="rounded-xl bg-primary p-2" data-lesson-kind={l.lesson.kind} data-close={l.close.kind}>
                      <span className="font-medium">{l.lesson.title}</span> · {l.close.text}
                      {l.success ? <span className="text-tertiary"> · Erfolg: {l.success.text}</span> : null}
                      {l.mistakes.length ? <span className="text-tertiary"> · Fehler: {l.mistakes.map((m) => `${m.given} → ${m.expected}${m.count > 1 ? ` (${m.count}×)` : ""}`).join("; ")}</span> : null}
                      {l.unscored.length ? <span className="text-tertiary"> · Unbewertet: {l.unscored.map((m) => m.given).join("; ")}</span> : null}
                      {l.repair.retries.length ? <span className="text-tertiary"> · {l.lesson.kind === "typing" ? "Wiederholungen" : "Weitere Versuche"}: {l.repair.retries.map((x) => (x.result === "correct" ? "richtig" : "noch nicht")).join(", ")}{l.repair.explanation?.recorded ? " · Beispiel gezeigt" : ""}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 text-base text-primary">
              <span className="font-medium">Als Nächstes unterrichten:</span> {r.learning.teachNext.text}
            </p>
            <p className="text-sm text-tertiary">Warum: {r.learning.teachNext.why}</p>
            <p className="text-sm text-tertiary">Unsicherheit: {r.learning.teachNext.uncertainty}</p>
            <p className="mt-2 text-sm text-tertiary">Empfehlung für das Kind ({r.recommendation.branch}): {r.recommendation.text}</p>
          </section>
          <section className="rounded-2xl bg-secondary p-4">
            <h3 className="text-base font-semibold text-primary">Erlebnis und Bedienung</h3>
            <div className="mt-2 rounded-xl bg-primary p-2 text-sm text-primary" data-testid="child-feedback">
              <span className="font-medium">Vom Kind gesagt:</span> Schwierigkeit {feedbackWord(r.experience.childFeedback, "difficulty")} · Spass {feedbackWord(r.experience.childFeedback, "enjoyment")} · Klarheit {feedbackWord(r.experience.childFeedback, "clarity")}
              <span className="text-tertiary"> (Antworten des Kindes, keine Hypothesen; Leerstellen bleiben leer.)</span>
            </div>
            <TelemetryLine t={r.experience.telemetry} />
            {r.experience.hypotheses.length ? (
              <ul className="mt-2 space-y-2 text-sm text-primary">
                {r.experience.hypotheses.map((h, i) => (
                  <li key={i} className="rounded-xl bg-primary p-2">
                    <span className="font-medium">Beobachtung:</span> {h.observation}
                    <br />
                    <span className="font-medium">Andere Erklärungen:</span> {h.alternatives.join("; ")}
                    <br />
                    <span className="font-medium">Vorschlag (Entscheidung liegt bei dir):</span> {h.suggestion}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-tertiary">Keine Bedienungs-Hypothese aus diesem Besuch.</p>
            )}
            {r.experience.missing.length ? (
              <div className="mt-3">
                <p className="text-sm font-medium text-primary">Nicht erfasst</p>
                <ul className="list-disc pl-5 text-sm text-tertiary">
                  {r.experience.missing.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        <p className="mt-2 text-base text-tertiary">Kein Rückblick gespeichert.</p>
      )}
    </article>
  );
}

function SampleList({ title, samples, empty, showMetrics }: { title: string; samples: Evidence["samples"]; empty: string; showMetrics?: boolean }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {samples.length === 0 ? (
        <p className="mt-2 text-base text-tertiary">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {samples.map((s) => {
            const m = (s.metrics ?? {}) as Record<string, unknown>;
            return (
              <li key={s.id} className="rounded-2xl border border-primary bg-primary p-3">
                <p className="text-sm text-tertiary">
                  {fmt(s.createdAt)} · {s.kind} · {s.modality} {s.taskId ? `· ${s.taskId}` : ""}
                </p>
                <p className="mt-1 text-base text-primary">{s.text}</p>
                {showMetrics && typeof m.expectedChars === "number" && typeof m.correctChars === "number" ? (
                  <p className="mt-1 text-sm text-tertiary">
                    {/* Stored per-line denominator for lessons; max(expected, typed) only for single-label records. */}
                    {describeTypingMetrics(m as { expectedChars: number; typedChars?: number; correctChars: number; extraChars?: number; omittedChars?: number; denominator?: number })}
                    {typeof m.substitutedChars === "number" && m.substitutedChars > 0 ? `, ${m.substitutedChars} vertauscht` : ""} in {String(m.seconds ?? "?")} s · Metrik v{String(m.metricVersion ?? 1)}
                    {typeof m.comfort === "string" ? ` · Gefühl: ${m.comfort}` : ""}
                  </p>
                ) : null}
                {showMetrics && Array.isArray(m.lines) ? (
                  <ul className="mt-1 text-xs text-tertiary" data-testid="burst-lines">
                    {(m.lines as { expectedChars: number; typedChars: number; correctChars: number; extraChars: number; omittedChars: number; substitutedChars?: number }[]).map((line, i) => (
                      <li key={i}>
                        Zeile {i + 1}: {line.correctChars} von {Math.max(line.expectedChars, line.typedChars)} richtig{line.substitutedChars ? `, ${line.substitutedChars} vertauscht` : ""}{line.extraChars ? `, ${line.extraChars} zu viel` : ""}{line.omittedChars ? `, ${line.omittedChars} fehlen` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LanguageView({ code, attempts, samples, child, ops, evidence }: { code: "en" | "es"; attempts: EvidenceAttempt[]; samples: Evidence["samples"]; child: ChildId; ops: ParentOps; evidence: Evidence }) {
  const byKind = (k: string) => attempts.filter((a) => a.objective.endsWith(k));
  const label = code === "en" ? "Englisch" : "Spanisch";
  return (
    <>
      <p className="text-sm text-tertiary">Hören, Erkennen (Bild wählen) und Produzieren (schreiben/sprechen) werden getrennt gezählt. Glossar und Audio sind ausgewiesene Hilfe.</p>
      <VocabularyView code={code} evidence={evidence} />
      <AttemptTable title={`${label}: Hören`} attempts={byKind("listen")} child={child} ops={ops} empty="Noch nicht gehört." visits={evidence.visits} />
      <AttemptTable title={`${label}: Erkennen`} attempts={byKind("recognition")} child={child} ops={ops} empty="Noch keine Erkennungs-Aufgabe." visits={evidence.visits} />
      <AttemptTable title={`${label}: Wort ergänzen (lexikalisch)`} attempts={byKind("completion")} child={child} ops={ops} empty="Noch keine Wort-Ergänzung." visits={evidence.visits} />
      <AttemptTable title={`${label}: Satz produzieren`} attempts={byKind("production")} child={child} ops={ops} empty="Noch keine eigene Satz-Produktion." visits={evidence.visits} />
      <SampleList title={`${label}: Arbeitsproben`} samples={samples} empty="Noch keine Probe." />
    </>
  );
}

const DIMENSION_LABEL: Record<string, string> = { recognition: "Erkennen", recall: "Abrufen (auf Aufforderung)", writing: "Schreibweise", spontaneous: "Freie Verwendung" };
const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "stone" | "blue" | "violet" }> = {
  "no-opportunity": { label: "keine Aufgabe dafür", tone: "stone" },
  "not-observed": { label: "nicht beobachtet", tone: "stone" },
  practice: { label: "üben", tone: "amber" },
  "supported-only": { label: "nur mit Hilfe", tone: "amber" },
  independent: { label: "selbständig (einzeln)", tone: "blue" },
  "independent-repeated": { label: "wiederholt selbständig", tone: "green" },
  "review-pending": { label: "zur Durchsicht", tone: "violet" },
};
const OUTCOME_LABEL: Record<string, string> = { correct: "richtig", incorrect: "falsch", unscored: "unbewertet", review: "zur Durchsicht" };

/**
 * Vocabulary evidence ledger (follow-on M3): per word, the four dimensions
 * with counts, distinct contexts and visits, honest missingness, and the
 * observation rows (task/step/version, stimulus, response, modality, help,
 * context, visit, time, outcome). Derived from the immutable records;
 * deleted with them. Never a mastery claim.
 */
function VocabularyView({ code, evidence }: { code: "en" | "es"; evidence: Evidence }) {
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const ledger = evidence.vocabulary;
  if (!ledger) {
    return (
      <div className="rounded-2xl border border-primary p-4" data-testid={`vocabulary-${code}`}>
        <p className="text-base font-semibold text-primary">Wortschatz — Beobachtungen</p>
        <p className="mt-1 text-base text-tertiary">Kein Wortschatz-Inventar bereitgestellt; es gibt keine abgeleiteten Beobachtungen.</p>
      </div>
    );
  }
  const entries = ledger.entries.filter((e) => e.language === code);
  const observations = ledger.observations.filter((o) => o.language === code);
  return (
    <div className="rounded-2xl border border-primary p-4" data-testid={`vocabulary-${code}`} data-inventory-version={ledger.inventoryVersion} data-ledger-version={ledger.ledgerVersion}>
      <p className="text-base font-semibold text-primary">Wortschatz — Beobachtungen (Inventar v{ledger.inventoryVersion}, Ableitung v{ledger.ledgerVersion})</p>
      <p className="mt-1 text-sm text-tertiary">
        Regel für „wiederholt selbständig“: mindestens {ledger.policy.independentSuccesses} selbständig richtige Beobachtungen in {ledger.policy.distinctContexts} verschiedenen Kontexten und {ledger.policy.separateVisits} getrennten Besuchen — ein Pilot-Parameter, kein nachgewiesenes Optimum. Status des Inventars: {ledger.reviewed.status}.
      </p>
      <ul className="mt-2 text-xs text-tertiary">
        {ledger.notes.map((n) => (
          <li key={n}>· {n}</li>
        ))}
      </ul>
      {entries.length === 0 ? <p className="mt-2 text-base text-tertiary">Keine Einträge für diese Sprache.</p> : null}
      <ul className="mt-3 space-y-2">
        {entries.map((e) => (
          <li key={e.entryId} className="rounded-2xl bg-secondary p-3" data-testid={`vocab-entry-${e.entryId}`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-primary">
                <span lang={e.language}>{e.lemma}</span> <span className="font-normal text-tertiary">= {e.gloss}</span>
              </p>
              <span className="text-xs text-tertiary">{e.sense}</span>
            </div>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {(["recognition", "recall", "writing", "spontaneous"] as const).map((d) => {
                const s = e.dimensions[d];
                const st = STATUS_LABEL[s.status] ?? { label: s.status, tone: "stone" as const };
                return (
                  <li key={d} className="flex flex-wrap items-center gap-2 text-sm text-primary" data-testid={`vocab-dim-${e.entryId}-${d}`} data-status={s.status}>
                    <span className="min-w-40 font-medium">{DIMENSION_LABEL[d]}</span>
                    <NabuBadge tone={st.tone}>{st.label}</NabuBadge>
                    {s.observations > 0 ? (
                      <span className="text-tertiary">
                        {s.independentCorrect} selbständig richtig · {s.supportedCorrect} mit Hilfe richtig · {s.incorrect} falsch · {s.unscored} unbewertet · {s.review} zur Durchsicht · {s.distinctContexts} Kontext(e) · {s.separateVisits} Besuch(e)
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {e.missing.length ? (
              <ul className="mt-2 text-xs text-tertiary" data-testid={`vocab-missing-${e.entryId}`}>
                {e.missing.map((m) => (
                  <li key={m}>· {m}</li>
                ))}
              </ul>
            ) : null}
            {e.note ? <p className="mt-1 text-xs text-tertiary">{e.note}</p> : null}
            {observations.some((o) => o.entryId === e.entryId) ? (
              <button type="button" onClick={() => setOpenEntry(openEntry === e.entryId ? null : e.entryId)} className={cn(secondaryButton, "mt-2")} aria-expanded={openEntry === e.entryId}>
                {openEntry === e.entryId ? "Beobachtungen ausblenden" : `Beobachtungen zeigen (${observations.filter((o) => o.entryId === e.entryId).length})`}
              </button>
            ) : null}
            {openEntry === e.entryId ? (
              <ul className="mt-2 space-y-1" data-testid={`vocab-observations-${e.entryId}`}>
                {observations
                  .filter((o) => o.entryId === e.entryId)
                  .map((o) => (
                    <li key={o.id} className="rounded-xl bg-primary p-2 text-xs text-primary" data-testid="vocab-observation" data-dimension={o.dimension} data-outcome={o.outcome} data-independent={o.independent ? "true" : "false"}>
                      <span className="font-medium">{DIMENSION_LABEL[o.dimension]}</span> · {OUTCOME_LABEL[o.outcome] ?? o.outcome} · {o.independent ? "selbständig" : o.support.length ? `mit Hilfe: ${o.support.join(", ")}` : o.outcome === "correct" ? "nicht selbständig" : "—"}
                      {o.productionKind ? ` · Produktion: ${o.productionKind}` : ""}
                      <br />
                      Aufgabe {o.taskId}
                      {o.stepId ? `/${o.stepId}` : ""} v{o.taskVersion} · Kontext {o.contextId} · {o.visit ? visitName(evidence, o.visit) : "Besuch unbekannt (alte Aufzeichnung ausserhalb jedes Besuchsfensters)"} · {fmt(o.at)} · {o.modality}
                      <br />
                      {o.stimulus ? <>Reiz: „{o.stimulus}“ · </> : null}Antwort: „{o.response}“
                      {o.uncertainty ? <> · Unsicherheit: {o.uncertainty}</> : null}
                      {o.correction ? <> · <NabuBadge tone="blue">Eltern-Korrektur: {o.correction.evidence ?? "Notiz"} — nicht gezählt</NabuBadge></> : null}
                      {!o.countable && !o.correction && o.outcome !== "review" && o.outcome !== "unscored" ? " · nicht gezählt" : ""}
                    </li>
                  ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Settings({ evidence, child, ops }: { evidence: Evidence; child: ChildId; ops: ParentOps }) {
  // The draft is bound to the child + erasure generation it was initialised
  // from. Refreshed evidence with a different identity (same-tab deletion, a
  // 409 stale-write reload, another tab's deletion, a child switch) resets the
  // draft — old text never silently acquires the new generation. The parent
  // also keys this component by identity, so a remount does the same.
  // Origin is the bundle's OWN identity, never the selection prop.
  const source: SettingsSource = { child: evidence.child, erasureGeneration: evidence.erasureGeneration, settings: evidence.settings };
  const [draft, setDraft] = useState<SettingsDraft>(() => createSettingsDraft(source));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const result = reconcileSettingsDraft(draft, source);
    if (result.reset) {
      setDraft(result.draft);
      setMessage(result.reset === "records-erased" ? "Die Aufzeichnungen wurden gelöscht — das Formular wurde zurückgesetzt. Entscheide neu, was gespeichert werden soll." : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child, evidence.erasureGeneration]);
  const counts = evidence.contentCounts;
  const contentLine = useMemo(() => (counts ? `Inhalte v${counts.version ?? 1}: ${counts.math} Mathe-Einträge, ${counts.language} Sprach-Segmente, ${counts.typingLessons} Tipp-Lektionen, ${counts.typingCourse ?? 0} Kurs-Lektionen (Finger-Kurs), ${counts.typingLabels} Schild-Aufgaben.` : null), [counts]);
  const edit = (field: "layout" | "title" | "hook" | "varietyEn" | "varietyEs") => (value: string) => setDraft((d) => editSettingsDraft(d, field, value));
  const saveBody = settingsSaveBody(draft, source);

  const save = async () => {
    if (!saveBody) {
      setMessage("Das Formular gehört zu einem älteren Stand. Es wurde neu geladen — bitte noch einmal prüfen.");
      setDraft(createSettingsDraft(source));
      return;
    }
    setBusy(true);
    setMessage(null);
    const ticket = ops.begin();
    const result = await api("/api/family/learning/parent/settings", { method: "PUT", body: JSON.stringify(saveBody) });
    setBusy(false);
    // Started under an authorization that has since been invalidated: drop the result.
    if (!ticket.current()) return;
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        ops.onLocked();
        return;
      }
      if (result.status === 409 && result.data.code === "stale-after-deletion") {
        setMessage("Diese Einstellungen stammen von vor dem Löschen. Die Ansicht wird neu geladen — entscheide dann noch einmal.");
        ops.onChanged();
        return;
      }
      setMessage(String(result.data.error ?? "Nicht gespeichert"));
      return;
    }
    setMessage("Gespeichert.");
    ops.onChanged();
  };

  const remove = async () => {
    setBusy(true);
    const ticket = ops.begin();
    const result = await api<{ counts: Record<string, number>; retainedElsewhere: string }>(`/api/family/learning/parent/records?child=${child}&confirm=${child}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDelete(false);
    if (!ticket.current()) return;
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        ops.onLocked();
        return;
      }
      setMessage(String(result.data.error ?? "Löschen fehlgeschlagen"));
      return;
    }
    const total = Object.values(result.data.counts).reduce((a, b) => a + b, 0);
    setMessage(`${total} Datensätze gelöscht. ${result.data.retainedElsewhere}`);
    ops.onChanged();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary bg-primary p-5">
        <h2 className="text-lg font-semibold text-primary">Vor dem ersten Einsatz prüfen</h2>
        {contentLine ? <p className="mt-1 text-sm text-tertiary">{contentLine}</p> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-tertiary">
            Tastatur / Eingabe-Layout (Mac mini)
            <select value={draft.layout} onChange={(e) => edit("layout")(e.target.value)} className={cn("min-h-12 rounded-xl border border-primary bg-primary px-3 text-base text-primary", focusRing)}>
              <option value="">Noch nicht bestätigt — Finger-Übungen gesperrt</option>
              {LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-tertiary">
            Missions-Titel
            <input value={draft.title} onChange={(e) => edit("title")(e.target.value)} maxLength={60} placeholder="Die Expedition" className={cn("min-h-12 rounded-xl border border-primary bg-primary px-3 text-base text-primary", focusRing)} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-tertiary sm:col-span-2">
            Einstiegs-Satz
            <input value={draft.hook} onChange={(e) => edit("hook")(e.target.value)} maxLength={160} placeholder="Baue eine kleine Basis und versorge dein Team." className={cn("min-h-12 rounded-xl border border-primary bg-primary px-3 text-base text-primary", focusRing)} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-tertiary">
            Englisch-Variante — nur Prüfnotiz, wirkt NICHT auf die Sprachausgabe
            <input value={draft.varietyEn} onChange={(e) => edit("varietyEn")(e.target.value)} maxLength={40} className={cn("min-h-12 rounded-xl border border-primary bg-primary px-3 text-base text-primary", focusRing)} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-tertiary">
            Spanisch-Variante — nur Prüfnotiz, wirkt NICHT auf die Sprachausgabe
            <input value={draft.varietyEs} onChange={(e) => edit("varietyEs")(e.target.value)} maxLength={40} className={cn("min-h-12 rounded-xl border border-primary bg-primary px-3 text-base text-primary", focusRing)} />
          </label>
        </div>
        <p className="mt-2 text-xs text-tertiary">
          Nicht verfügbar: Die Sprachausgabe (bestehende Kinderstimme) unterstützt keine Varianten-Auswahl. Diese Felder dokumentieren die Prüfung vor dem Kinder-Einsatz und ändern nichts an der Wiedergabe.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void save()} disabled={busy || !saveBody} className={primaryButton}>
            Speichern
          </button>
          {message ? <span className="text-sm text-primary">{message}</span> : null}
        </div>
      </div>

      <div className="rounded-3xl border border-red-300 p-5 dark:border-red-900">
        <h2 className="text-lg font-semibold text-primary">Aufzeichnungen löschen</h2>
        <p className="mt-1 text-sm text-tertiary">
          Löscht für {CHILD_LABEL[child]} die Mission, alle Versuche, Hilfe-Ereignisse, Expositionen, Arbeitsproben und Einstellungen — endgültig. Die Tutor-Gespräche liegen getrennt auf der Familien-Bridge und werden hier nicht gelöscht. Aufzeichnungen bleiben sonst, bis ein Elternteil sie löscht.
        </p>
        {confirmDelete ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void remove()} disabled={busy} className={dangerButton}>
              Ja, endgültig löschen
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className={secondaryButton}>
              Abbrechen
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className={cn(dangerButton, "mt-3")}>
            Löschen …
          </button>
        )}
      </div>
    </div>
  );
}
