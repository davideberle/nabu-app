"use client";

// ---------------------------------------------------------------------------------------------------------------------
// Owner-only listening check of the prerecorded visit narration (Isabel Visit 2 pre-release review, 2026-10-29).
// Lives on the parent page (owner session only). Lists every catalogued line grouped by the screen that speaks it and plays it
// through the SAME player and clip route the child's visit uses — on the real device, in the exact deployed build, without
// starting or touching any child's visit (works while Visit 2 is parked under FAMILY_LEARNING_ISABEL_CONTENT_CAP=1).
// Shows for each line what actually played: the recording, a German device voice (name), or nothing.
// The «record missing lines» action is PAID and owner-confirmed: it sends only the catalogue, capped at the missing characters.
// ---------------------------------------------------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { createNarrationPlayer, type LineOutcome } from "@/lib/family-narration-player";
import { line } from "@/lib/family-learning-narration";

type Readiness = { voiceConfigured: boolean; providerKeyConfigured: boolean; storeConfigured: boolean; model: string; lines: number; characters: number; recorded: number; missing: number; missingCharacters: number };
type CatalogLine = { id: string; text: string; where: string[]; recorded: boolean };
const SOURCE_DE: Record<LineOutcome, string> = { recorded: "Aufnahme", "device-de": "Gerätestimme", "no-german-voice": "keine deutsche Stimme", blocked: "vom Browser blockiert", failed: "Fehler" };
const btn = "inline-flex min-h-9 items-center rounded-lg border border-primary px-3 text-sm font-medium text-primary disabled:opacity-50";

export function NarrationAudition() {
  const [data, setData] = useState<{ readiness: Readiness; lines: CatalogLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [confirmSpend, setConfirmSpend] = useState(false);
  const [prepare, setPrepare] = useState<string | null>(null);
  const player = useMemo(() => createNarrationPlayer({ onLine: (l, outcome, voice) => setHeard((h) => ({ ...h, [l.id]: `${SOURCE_DE[outcome]}${voice ? ` (${voice})` : ""}` })) }), []);
  const load = async () => {
    const r = await fetch("/api/family/learning/parent/narration", { cache: "no-store" });
    if (!r.ok) return setError(`Nicht verfügbar (${r.status})`);
    setData(await r.json());
  };
  useEffect(() => {
    void load();
    return () => player.stop();
  }, [player]);
  const groups = useMemo(() => {
    const g = new Map<string, CatalogLine[]>();
    for (const l of data?.lines ?? []) for (const w of l.where.length ? l.where.slice(0, 1) : ["?"]) g.set(w, [...(g.get(w) ?? []), l]);
    // In visit order: the beats (IG1 … IG10), then the closing screens and the goodbye.
    const rank = (w: string) => (/^IG(\d+)-/.test(w) ? Number(/^IG(\d+)-/.exec(w)![1]) : ["closing-difficulty", "closing-enjoyment", "closing-next", "farewell"].indexOf(w) + 100);
    return [...g.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [data]);
  const play = async (ls: CatalogLine[], key: string) => {
    player.unlock();
    setPlaying(key);
    await player.play({ key: `audition|${key}|${Date.now()}`, lines: ls.map((l) => line(l.text)) });
    setPlaying(null);
  };
  const runPrepare = async () => {
    if (!data || !confirmSpend) return;
    setPrepare("läuft …");
    const r = await fetch("/api/family/learning/parent/narration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "prepare-narration", maxCharacters: data.readiness.missingCharacters }) });
    const j = await r.json().catch(() => ({}));
    setPrepare(`${j?.result?.status ?? r.status}: ${j?.result?.recorded ?? 0} aufgenommen, ${j?.result?.charactersSent ?? 0} Zeichen gesendet, ${j?.result?.remaining ?? "?"} offen`);
    setConfirmSpend(false);
    void load();
  };
  if (error) return <p className="text-sm text-tertiary" data-testid="narration-audition-error">{error}</p>;
  if (!data) return null;
  const r = data.readiness;
  return (
    <section className="rounded-2xl border border-primary bg-primary p-4" data-testid="narration-audition" data-recorded={r.recorded} data-lines={r.lines}>
      <h3 className="text-base font-semibold text-primary">Vorlese-Stimme (Probehören)</h3>
      <p className="mt-1 text-sm text-tertiary">
        Stimme eingestellt: {r.voiceConfigured ? "ja" : "nein"} · Anbieter-Schlüssel vorhanden: {r.providerKeyConfigured ? "ja (Gültigkeit nicht geprüft)" : "nein"} · Speicher: {r.storeConfigured ? "ja" : "nein"} · Modell {r.model} · {r.recorded}/{r.lines} Sätze aufgenommen, {r.missingCharacters} Zeichen fehlen
      </p>
      <p className="mt-1 text-sm text-tertiary">Hier hören Sie jeden Satz so, wie er im Besuch kommt — ohne einen Besuch zu starten. Ohne Aufnahme spricht die deutsche Gerätestimme, ohne sie nichts.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => void play(data.lines, "all")} disabled={playing !== null} data-testid="audition-all">▶ Alle der Reihe nach</button>
        <button type="button" className={btn} onClick={() => player.stop()} data-testid="audition-stop">■ Stopp</button>
      </div>
      <div className="mt-3 grid gap-3">
        {groups.map(([where, ls]) => (
          <details key={where} className="rounded-xl border border-secondary p-2" data-testid={`audition-group-${where}`}>
            <summary className="cursor-pointer text-sm font-medium text-primary">{where} · {ls.length} {ls.length === 1 ? "Satz" : "Sätze"}</summary>
            <ul className="mt-2 grid gap-1">
              {ls.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`audition-line-${l.id}`} data-heard={heard[l.id] ?? ""}>
                  <button type="button" className={btn} onClick={() => void play([l], l.id)} disabled={playing !== null} aria-label={`Anhören: ${l.text}`}>▶</button>
                  <span className="text-primary">{l.text}</span>
                  <span className="text-tertiary">{l.recorded ? "· aufgenommen" : "· keine Aufnahme"}{heard[l.id] ? ` · gehört: ${heard[l.id]}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      {r.missing > 0 ? (
        <div className="mt-4 grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="audition-prepare">
          <p>Fehlende Aufnahmen erstellen: {r.missing} Sätze, {r.missingCharacters} Zeichen, einmalig mit der eingestellten Stimme ({r.model}). <strong>Kostenpflichtig</strong> (Zeichen werden vom Konto abgebucht). Gesendet wird nur der geprüfte Text oben, nie Antworten eines Kindes.</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={confirmSpend} onChange={(e) => setConfirmSpend(e.target.checked)} data-testid="audition-confirm" /> Ich habe die Kosten freigegeben.</label>
          <button type="button" className={btn} disabled={!confirmSpend || !r.voiceConfigured || prepare === "läuft …"} onClick={() => void runPrepare()} data-testid="audition-prepare-run">Aufnahmen erstellen</button>
          {prepare ? <p data-testid="audition-prepare-result">{prepare}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
