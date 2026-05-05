"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSurface,
  NabuSectionHeader,
  NabuButton,
  NabuBadge,
  NabuStat,
} from "@/components/ui/nabu";

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
  statTone: "blue" | "amber" | "green" | "stone";
}> = [
  { key: "inbox", title: "Inbox", empty: "No new candidates waiting.", statTone: "blue" },
  { key: "trial", title: "Trial pool", empty: "Nothing in trial yet.", statTone: "amber" },
  { key: "promoted", title: "Promoted", empty: "Nothing promoted yet.", statTone: "green" },
  { key: "rejected", title: "Rejected", empty: "No rejected candidates.", statTone: "stone" },
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
    <NabuPageShell>
      <NabuHeader
        title="Music Discovery"
        backHref="/music"
        subtitle="Review candidates from the sonos-music discovery pipeline."
      />

      <NabuMain>
        {loading ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Loading discovery…
          </div>
        ) : (
          <div className="space-y-6">
            {(data.error || notice) && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                {notice || data.error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {GROUPS.map((group) => (
                <NabuStat
                  key={group.key}
                  label={group.title}
                  value={counts[group.key]}
                  tone={group.statTone}
                />
              ))}
            </div>

            {GROUPS.map((group) => {
              const candidates = data[group.key] || [];
              return (
                <NabuSurface key={group.key} as="section">
                  <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <NabuSectionHeader title={group.title} />
                  </div>
                  {candidates.length === 0 ? (
                    <p className="p-5 text-sm text-tertiary">{group.empty}</p>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {candidates.map((candidate) => (
                        <article
                          key={candidate.id}
                          className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-medium text-primary">{candidate.name}</h3>
                              {candidate.type && (
                                <NabuBadge tone="stone">{candidate.type}</NabuBadge>
                              )}
                              {candidate.score != null && (
                                <NabuBadge tone="blue">{candidate.score}</NabuBadge>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-tertiary">{formatCandidate(candidate)}</p>
                            {candidate.reasons && (
                              <p className="mt-1 text-sm text-tertiary">{candidate.reasons}</p>
                            )}
                            {group.key === "trial" && (
                              <p className="mt-1 text-xs text-quaternary">
                                Played {candidate.played_count || 0} time(s)
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            {group.key === "inbox" && (
                              <>
                                <NabuButton
                                  tone="primary"
                                  size="sm"
                                  disabled={busy === `${candidate.id}-try`}
                                  onClick={() => transition(candidate, "try")}
                                >
                                  Try
                                </NabuButton>
                                <NabuButton
                                  tone="ghost"
                                  size="sm"
                                  disabled={busy === `${candidate.id}-reject`}
                                  onClick={() => transition(candidate, "reject")}
                                >
                                  Reject
                                </NabuButton>
                              </>
                            )}
                            {group.key === "trial" && (
                              <>
                                <NabuButton
                                  tone="primary"
                                  size="sm"
                                  disabled={busy === `${candidate.id}-promote`}
                                  onClick={() => transition(candidate, "promote")}
                                >
                                  Promote
                                </NabuButton>
                                <NabuButton
                                  tone="ghost"
                                  size="sm"
                                  disabled={busy === `${candidate.id}-reject`}
                                  onClick={() => transition(candidate, "reject")}
                                >
                                  Reject
                                </NabuButton>
                              </>
                            )}
                            {group.key === "rejected" && (
                              <NabuButton
                                tone="secondary"
                                size="sm"
                                disabled={busy === `${candidate.id}-undo_reject`}
                                onClick={() => transition(candidate, "undo_reject")}
                              >
                                Undo
                              </NabuButton>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </NabuSurface>
              );
            })}
          </div>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
