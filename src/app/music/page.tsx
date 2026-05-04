"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const ROOM_ORDER = ["Living Room", "Cinema", "Penthouse", "Pool"];

type NowPlaying = {
  track: string | null;
  artist: string | null;
  album: string | null;
  albumArtUri: string | null;
  state: string | null;
  volume: number | null;
  trackNo: number | null;
};

type LastMedia = {
  name: string;
  type: string;
  lastPlayed: string | null;
  lastTrack: {
    title?: string | null;
    artist?: string | null;
    trackNo?: number | null;
  } | null;
  playCount: number;
  feedback: string | null;
  room: string;
};

type RoomProjection = {
  room: string;
  nowPlaying: NowPlaying | null;
  lastMedia: LastMedia | null;
};

type DiscoveryCandidate = {
  id: string;
  name: string;
  artist?: string | null;
  type?: string;
  genres?: string[];
  lane?: string;
  score?: number;
  reasons?: string;
  library_status?: string;
  status?: string;
  played_count?: number;
};

type DiscoveryData = {
  summary?: {
    counts?: Record<"inbox" | "trial" | "promoted" | "rejected", number>;
    updated_at?: string | null;
  };
  inbox?: DiscoveryCandidate[];
  trial?: DiscoveryCandidate[];
  promoted?: DiscoveryCandidate[];
  rejected?: DiscoveryCandidate[];
  error?: string;
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(state?: string | null) {
  if (state === "PLAYING") return "Playing";
  if (state === "PAUSED_PLAYBACK") return "Paused";
  if (state === "STOPPED") return "Stopped";
  return "Idle";
}

function typeLabel(type?: string | null) {
  if (!type) return "media";
  if (type === "compilation") return "compilation";
  return type;
}

export default function MusicPage() {
  const [rooms, setRooms] = useState<RoomProjection[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const orderedRooms = useMemo(() => {
    const byName = new Map(rooms.map((room) => [room.room, room]));
    return ROOM_ORDER.map(
      (room) => byName.get(room) || { room, nowPlaying: null, lastMedia: null }
    );
  }, [rooms]);

  const refresh = useCallback(async () => {
    try {
      const [roomsRes, discoveryRes] = await Promise.all([
        fetch("/api/music/rooms", { cache: "no-store" }),
        fetch("/api/music/discovery?limit=6", { cache: "no-store" }),
      ]);

      const roomsJson = await roomsRes.json();
      const discoveryJson = await discoveryRes.json();

      if (!roomsRes.ok && !discoveryRes.ok) {
        throw new Error("Music APIs are unavailable");
      }

      setRooms(Array.isArray(roomsJson.rooms) ? roomsJson.rooms : []);
      setDiscovery(discoveryJson || {});
      setError(roomsJson.error || discoveryJson.error || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Music surface unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function postAction(
    key: string,
    url: string,
    body: Record<string, unknown>,
    success: string
  ) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.message || data.error || "Music action failed");
      }
      setNotice(data.message || success);
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Music action failed");
    } finally {
      setBusy(null);
    }
  }

  const counts = discovery.summary?.counts || {
    inbox: 0,
    trial: 0,
    promoted: 0,
    rejected: 0,
  };
  const inbox = discovery.inbox || [];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← Back
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎵</span>
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Music
              </h1>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Discovery first, Sonos rooms underneath.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {loading ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Loading music…
          </div>
        ) : (
          <>
            {(error || notice) && (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  error
                    ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                    : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200"
                }`}
              >
                {notice || error}
              </div>
            )}

            <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-100 p-6 dark:border-zinc-800">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
                      Discovery inbox
                    </p>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                      {counts.inbox} candidates waiting
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                      New albums, compilations, and playlists from the Sonos music discovery pipeline.
                    </p>
                  </div>
                  <Link
                    href="/music/discovery"
                    className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Open full discovery →
                  </Link>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([
                    ["Inbox", counts.inbox],
                    ["Trial", counts.trial],
                    ["Promoted", counts.promoted],
                    ["Rejected", counts.rejected],
                  ] as const).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-950"
                    >
                      <p className="text-xs text-zinc-500 dark:text-zinc-500">{label}</p>
                      <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {inbox.length === 0 ? (
                  <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
                    No discovery candidates waiting right now.
                  </div>
                ) : (
                  inbox.map((candidate) => (
                    <article
                      key={candidate.id}
                      className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-zinc-950 dark:text-zinc-50">
                            {candidate.name}
                          </h3>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {typeLabel(candidate.type)}
                          </span>
                          {candidate.score != null && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                              {candidate.score}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                          {[candidate.artist, candidate.genres?.join(" · "), candidate.lane]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {candidate.reasons && (
                          <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                            {candidate.reasons}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() =>
                            postAction(
                              `discovery-${candidate.id}-try`,
                              "/api/music/discovery",
                              { id: candidate.id, action: "try" },
                              "Added to trial"
                            )
                          }
                          disabled={busy === `discovery-${candidate.id}-try`}
                          className="rounded-full bg-zinc-950 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                        >
                          Try
                        </button>
                        <button
                          onClick={() =>
                            postAction(
                              `discovery-${candidate.id}-reject`,
                              "/api/music/discovery",
                              { id: candidate.id, action: "reject" },
                              "Rejected"
                            )
                          }
                          disabled={busy === `discovery-${candidate.id}-reject`}
                          className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          Reject
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                  Rooms
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                  Playing now
                </h2>
              </div>

              <div className="space-y-3">
                {orderedRooms.map((room) => {
                  const now = room.nowPlaying;
                  const last = room.lastMedia;
                  const isPlaying = now?.state === "PLAYING";
                  const hasTrack = Boolean(now?.track);

                  return (
                    <article
                      key={room.room}
                      className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                              {room.room}
                            </h3>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                isPlaying
                                  ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                              }`}
                            >
                              {statusLabel(now?.state)}
                            </span>
                          </div>

                          <div className="mt-4 flex gap-4">
                            {now?.albumArtUri ? (
                              <img
                                src={now.albumArtUri}
                                alt={now.album ? `${now.album} cover` : "Album cover"}
                                className="h-20 w-20 shrink-0 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-2xl dark:bg-zinc-800">
                                🎵
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                                Playing now
                              </p>
                              {hasTrack ? (
                                <>
                                  <p className="mt-1 truncate font-medium text-zinc-950 dark:text-zinc-50">
                                    {now?.track}
                                  </p>
                                  <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                                    {now?.artist || "Unknown artist"}
                                  </p>
                                  <p className="truncate text-sm text-zinc-500 dark:text-zinc-500">
                                    {now?.album || "Unknown album"}
                                  </p>
                                </>
                              ) : (
                                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                  Nothing live from Sonos right now.
                                </p>
                              )}
                            </div>
                          </div>

                          {hasTrack && now && (
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <button
                                onClick={() =>
                                  postAction(
                                    `${room.room}-track-love`,
                                    "/api/music/track-feedback",
                                    {
                                      title: now.track,
                                      artist: now.artist,
                                      album: now.album,
                                      action: "love",
                                    },
                                    "Loved track"
                                  )
                                }
                                disabled={busy === `${room.room}-track-love`}
                                className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                ♥ Love track
                              </button>
                              <button
                                onClick={() =>
                                  postAction(
                                    `${room.room}-resume-room`,
                                    "/api/music/resume",
                                    { room: room.room },
                                    `Resumed in ${room.room}`
                                  )
                                }
                                disabled={busy === `${room.room}-resume-room`}
                                className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                Resume room
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="w-full rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-950 lg:max-w-sm">
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                            Last playlist / album
                          </p>
                          {last ? (
                            <>
                              <p className="mt-2 font-medium text-zinc-950 dark:text-zinc-50">
                                {last.name}
                              </p>
                              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                {typeLabel(last.type)} · {formatDate(last.lastPlayed)}
                              </p>
                              {last.lastTrack?.title && (
                                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                                  Last track: {last.lastTrack.artist ? `${last.lastTrack.artist} — ` : ""}
                                  {last.lastTrack.title}
                                  {last.lastTrack.trackNo ? ` (#${last.lastTrack.trackNo})` : ""}
                                </p>
                              )}
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-play-again`,
                                      "/api/music/play-again",
                                      { room: room.room, name: last.name, type: last.type },
                                      `Playing ${last.name}`
                                    )
                                  }
                                  disabled={busy === `${room.room}-play-again`}
                                  className="rounded-full bg-zinc-950 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                                >
                                  Play again
                                </button>
                                <button
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-resume`,
                                      "/api/music/resume",
                                      { room: room.room, name: last.name, type: last.type },
                                      `Resuming ${last.name}`
                                    )
                                  }
                                  disabled={busy === `${room.room}-resume`}
                                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                  Resume
                                </button>
                                <button
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-playlist-love`,
                                      "/api/music/playlist-feedback",
                                      { name: last.name, rating: "love" },
                                      "Marked as loved"
                                    )
                                  }
                                  disabled={busy === `${room.room}-playlist-love`}
                                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                  👍
                                </button>
                                <button
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-playlist-skip`,
                                      "/api/music/playlist-feedback",
                                      { name: last.name, rating: "skip" },
                                      "Marked as skip"
                                    )
                                  }
                                  disabled={busy === `${room.room}-playlist-skip`}
                                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                  👎
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                              No durable play history for this room yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
