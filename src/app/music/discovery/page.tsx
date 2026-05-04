"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Candidate = {
  id: string;
  name: string;
  artist?: string | null;
  type?: string;
  genres?: string[];
  lane?: string;
  score?: number;
  reasons?: string;
  status?: "inbox" | "trial" | "promoted" | "rejected";
  played_count?: number;
  last_played_at?: string | null;
};

type Discovery = {
  summary?: { counts?: Record<"inbox" | "trial" | "promoted" | "rejected", number>; updated_at?: string | null };
  inbox?: Candidate[];
  trial?: Candidate[];
  promoted?: Candidate[];
  rejected?: Candidate[];
  error?: string;
};

const GROUPS: Array<{
  key: "inbox" | "trial" | "promoted" | "rejected";
  title: string;
  empty: string;
}> = [
  { key: "inbox", title: "Inbox", empty: "No new candidates waiting." },
  { key: "trial", title: "Trial pool", empty: "Nothing in trial yet." },
  { key: "promoted", title: "Promoted", empty: "Nothing promoted yet." },
  { key: "rejected", title: "Rejected", empty: "No rejected candidates." },
];

function formatCandidate(candidate: Candidate) {
  return [candidate.artist, candidate.genres?.join(" · "), candidate.lane]
    .filter(Boolean)
    .join(" · ");
}

export default function MusicDiscoveryPage() {
  const [data, setData] = useState<Discovery>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/music/discovery?limit=50", { cache: "no-store" });
      const json = await res.json();
      setData(json || {});
    } catch (error) {
      setData({ error: error instanceof Error ? error.message : "Discovery unavailable" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function transition(candidate: Candidate, action: string) {
    setBusy(`${candidate.id}-${action}`);
    setNotice(null);
    try {
      const res = await fetch("/api/music/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: candidate.id, action }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.message || json.error || "Action failed");
      setNotice(json.message || "Updated");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const counts = data.summary?.counts || { inbox: 0, trial: 0, promoted: 0, rejected: 0 };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
          <Link href="/music" className="text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
            ← Music
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Music Discovery</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Review candidates from the sonos-music discovery pipeline.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {loading ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Loading discovery…
          </div>
        ) : (
          <>
            {(data.error || notice) && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                {notice || data.error}
              </div>
            )}

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {GROUPS.map((group) => (
                <div key={group.key} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{group.title}</p>
                  <p className="mt-1 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">{counts[group.key]}</p>
                </div>
              ))}
            </section>

            {GROUPS.map((group) => {
              const candidates = data[group.key] || [];
              return (
                <section key={group.key} className="overflow-hidden rounded-3xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{group.title}</h2>
                  </div>
                  {candidates.length === 0 ? (
                    <p className="p-5 text-sm text-zinc-500 dark:text-zinc-400">{group.empty}</p>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {candidates.map((candidate) => (
                        <article key={candidate.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-medium text-zinc-950 dark:text-zinc-50">{candidate.name}</h3>
                              {candidate.type && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{candidate.type}</span>}
                              {candidate.score != null && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">{candidate.score}</span>}
                            </div>
                            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{formatCandidate(candidate)}</p>
                            {candidate.reasons && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{candidate.reasons}</p>}
                            {group.key === "trial" && <p className="mt-1 text-xs text-zinc-500">Played {candidate.played_count || 0} time(s)</p>}
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            {group.key === "inbox" && (
                              <>
                                <button disabled={busy === `${candidate.id}-try`} onClick={() => transition(candidate, "try")} className="rounded-full bg-zinc-950 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950">Try</button>
                                <button disabled={busy === `${candidate.id}-reject`} onClick={() => transition(candidate, "reject")} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Reject</button>
                              </>
                            )}
                            {group.key === "trial" && (
                              <>
                                <button disabled={busy === `${candidate.id}-promote`} onClick={() => transition(candidate, "promote")} className="rounded-full bg-zinc-950 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950">Promote</button>
                                <button disabled={busy === `${candidate.id}-reject`} onClick={() => transition(candidate, "reject")} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Reject</button>
                              </>
                            )}
                            {group.key === "rejected" && (
                              <button disabled={busy === `${candidate.id}-undo_reject`} onClick={() => transition(candidate, "undo_reject")} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Undo</button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
