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
import { createSettingsDraft, editSettingsDraft, reconcileSettingsDraft, settingsSaveBody, type SettingsDraft, type SettingsSource } from "@/lib/family-learning-parent-draft";
import { beginRequest, clearEvidence, createEvidenceStore, describeTypingMetrics, invalidateAuthorization, isCurrentEpoch, receiveEvidence, renderableEvidence, selectChild, type EvidenceStore } from "@/lib/family-learning-parent-evidence";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const primaryButton = cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-stone-900 px-5 text-base font-semibold text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900", focusRing);
const secondaryButton = cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary bg-primary px-4 text-base font-medium text-primary hover:bg-secondary disabled:opacity-50", focusRing);
const dangerButton = cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-red-600 px-4 text-base font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40", focusRing);

type Evidence = EvidenceBundle & { prepared: boolean; contentCounts: Record<string, number> | null; owner: string };

type Tab = "math" | "de" | "en" | "es" | "typing" | "settings";

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
  const math = evidence.attempts.filter((a) => a.objective === "equal-sharing");
  const lang = (code: string) => evidence.attempts.filter((a) => a.stimulusLanguage === code && a.objective.startsWith("language-"));
  const samplesDe = evidence.samples.filter((s) => s.kind === "explanation" || s.kind === "expedition_log");
  const typingSamples = evidence.samples.filter((s) => s.kind === "typing_practice" || s.kind === "typed_label");
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
          <AttemptTable title="Gleichmässig teilen (EQ-Aufgaben)" attempts={math} child={child} ops={ops} empty="Noch kein Mathe-Versuch aufgezeichnet." />
          <DelayedCheck evidence={evidence} />
          <SupportList evidence={evidence} filter={(k) => k !== "gloss"} />
        </>
      ) : null}
      {tab === "de" ? (
        <>
          <SampleList title="Erklärungen und Logbuch (Deutsch)" samples={samplesDe} empty="Noch keine Erklärung oder Logbuchseite." />
          <p className="text-sm text-tertiary">Deutsch ist die Anker-Sprache: Vorlesen zählt als Zugangs-Hilfe und wird bei den Mathe-Versuchen ausgewiesen, nicht als Lese-Evidenz.</p>
        </>
      ) : null}
      {tab === "en" ? <LanguageView code="en" attempts={lang("en")} samples={evidence.samples.filter((s) => s.language === "en")} child={child} ops={ops} /> : null}
      {tab === "es" ? <LanguageView code="es" attempts={lang("es")} samples={evidence.samples.filter((s) => s.language === "es")} child={child} ops={ops} /> : null}
      {tab === "typing" ? (
        <>
          {!evidence.settings.keyboardLayout ? <p className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary">Tastatur-Layout noch nicht bestätigt — Finger-Übungen sind gesperrt. Bestätigen unter „Einstellungen“.</p> : null}
          <SampleList title="Tipp-Übungen und Schilder" samples={typingSamples} empty="Noch keine Tipp-Aufzeichnung." showMetrics />
          <p className="text-sm text-tertiary">Aufgezeichnet wird nur die Genauigkeit innerhalb der Aufgabe. Welche Finger benutzt wurden, kann nur ein Erwachsener beim Zuschauen beurteilen.</p>
        </>
      ) : null}
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
  const delay = math.filter((a) => a.taskId === "EQ-DELAY");
  let text: string;
  if (!state || state.visits.length === 0) text = "Noch kein Besuch. Der nächste Schritt ist der erste Besuch: Basis bauen, 24 Pakete gerecht teilen.";
  else if (fresh.length === 0) text = "Erster Besuch läuft. Nächster Schritt: der frische Check nach der Erklärung (EQ-FRESH).";
  else if (ret.length === 0) text = "Nächster Schritt: Besuch 2 mit dem Transfer-Check (Setzlinge, EQ-RETURN) — noch nicht geprüft.";
  else if (delay.length === 0) text = "Nächster Schritt: der späte Check (EQ-DELAY) rund eine Woche nach dem Unterricht — noch nicht geprüft.";
  else text = "Alle fünf Inhalte sind durchlaufen. Weitere Aufgaben brauchen neue, geprüfte Inhalte.";
  return (
    <div className="rounded-2xl bg-secondary px-4 py-3">
      <p className="text-sm font-medium text-tertiary">Vorgeschlagener nächster Schritt</p>
      <p className="mt-1 text-base text-primary">{text}</p>
    </div>
  );
}

function DelayedCheck({ evidence }: { evidence: Evidence }) {
  const delay = evidence.attempts.filter((a) => a.taskId === "EQ-DELAY");
  const state = evidence.state;
  const anchor = state?.teachingFirstAt ?? state?.visits.find((v) => v.id === "v1")?.finishedAt ?? null;
  return (
    <div className="rounded-2xl border border-primary p-4">
      <p className="text-base font-semibold text-primary">Später Check</p>
      {delay.length === 0 ? (
        <p className="mt-1 text-base text-tertiary">Ausstehend. {anchor ? `Anker: ${fmt(anchor)} — frühestens 6 Tage danach.` : "Noch kein Anker (kein abgeschlossener erster Besuch)."} Die Wartezeit wird nie simuliert.</p>
      ) : (
        <p className="mt-1 text-base text-primary">
          Beobachtet am {fmt(delay[delay.length - 1].createdAt)} · {Math.round((delay[delay.length - 1].secondsSinceTeaching ?? 0) / 86400)} Tage nach dem Anker · {EVIDENCE_LABEL[delay[delay.length - 1].evidence]?.label}
        </p>
      )}
    </div>
  );
}

function AttemptTable({ title, attempts, child, ops, empty }: { title: string; attempts: EvidenceAttempt[]; child: ChildId; ops: ParentOps; empty: string }) {
  const [open, setOpen] = useState<string | null>(null);
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
                    <p>Besuch {a.visitId} · Modalität {a.modality} · Sprache {a.stimulusLanguage}{a.responseLanguage ? ` → ${a.responseLanguage}` : ""}</p>
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
                    {describeTypingMetrics(m as { expectedChars: number; typedChars?: number; correctChars: number; extraChars?: number; omittedChars?: number; denominator?: number })} in {String(m.seconds ?? "?")} s
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LanguageView({ code, attempts, samples, child, ops }: { code: "en" | "es"; attempts: EvidenceAttempt[]; samples: Evidence["samples"]; child: ChildId; ops: ParentOps }) {
  const byKind = (k: string) => attempts.filter((a) => a.objective.endsWith(k));
  const label = code === "en" ? "Englisch" : "Spanisch";
  return (
    <>
      <p className="text-sm text-tertiary">Hören, Erkennen (Bild wählen) und Produzieren (schreiben/sprechen) werden getrennt gezählt. Glossar und Audio sind ausgewiesene Hilfe.</p>
      <AttemptTable title={`${label}: Hören`} attempts={byKind("listen")} child={child} ops={ops} empty="Noch nicht gehört." />
      <AttemptTable title={`${label}: Erkennen`} attempts={byKind("recognition")} child={child} ops={ops} empty="Noch keine Erkennungs-Aufgabe." />
      <AttemptTable title={`${label}: Wort ergänzen (lexikalisch)`} attempts={byKind("completion")} child={child} ops={ops} empty="Noch keine Wort-Ergänzung." />
      <AttemptTable title={`${label}: Satz produzieren`} attempts={byKind("production")} child={child} ops={ops} empty="Noch keine eigene Satz-Produktion." />
      <SampleList title={`${label}: Arbeitsproben`} samples={samples} empty="Noch keine Probe." />
    </>
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
  const contentLine = useMemo(() => (counts ? `Inhalte v1: ${counts.math} Mathe-Einträge, ${counts.language} Sprach-Segmente, ${counts.typingLessons} Tipp-Lektionen, ${counts.typingLabels} Schild-Aufgaben.` : null), [counts]);
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
