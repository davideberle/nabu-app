"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSurface,
  NabuCard,
  NabuSectionHeader,
  NabuKicker,
  NabuButton,
  NabuLinkButton,
  NabuBadge,
  NabuStat,
  NabuEmptyState,
} from "@/components/ui/nabu";

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
    <NabuPageShell>
      <NabuHeader
        title="Music"
        backHref="/"
        subtitle="Discovery first, Sonos rooms underneath."
        icon="🎵"
      />

      <NabuMain>
        {loading ? (
          <NabuEmptyState title="Loading music…" />
        ) : (
          <div className="space-y-6">
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

            {/* Discovery section */}
            <NabuSurface as="section">
              <div className="border-b border-zinc-100 p-6 dark:border-zinc-800">
                <NabuSectionHeader
                  eyebrow="Discovery inbox"
                  title={`${counts.inbox} candidates waiting`}
                  description="New albums, compilations, and playlists from the Sonos music discovery pipeline."
                  action={
                    <NabuLinkButton href="/music/discovery" tone="secondary" size="sm">
                      Open full discovery →
                    </NabuLinkButton>
                  }
                />

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <NabuStat label="Inbox" value={counts.inbox} tone="blue" />
                  <NabuStat label="Trial" value={counts.trial} tone="amber" />
                  <NabuStat label="Promoted" value={counts.promoted} tone="green" />
                  <NabuStat label="Rejected" value={counts.rejected} tone="stone" />
                </div>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {inbox.length === 0 ? (
                  <p className="p-6 text-sm text-tertiary">
                    No discovery candidates waiting right now.
                  </p>
                ) : (
                  inbox.map((candidate) => (
                    <article
                      key={candidate.id}
                      className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-primary">
                            {candidate.name}
                          </h3>
                          <NabuBadge tone="stone">{typeLabel(candidate.type)}</NabuBadge>
                          {candidate.score != null && (
                            <NabuBadge tone="blue">{candidate.score}</NabuBadge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-tertiary">
                          {[candidate.artist, candidate.genres?.join(" · "), candidate.lane]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {candidate.reasons && (
                          <p className="mt-1 line-clamp-2 text-sm text-tertiary">
                            {candidate.reasons}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <NabuButton
                          tone="primary"
                          size="sm"
                          disabled={busy === `discovery-${candidate.id}-try`}
                          onClick={() =>
                            postAction(
                              `discovery-${candidate.id}-try`,
                              "/api/music/discovery",
                              { id: candidate.id, action: "try" },
                              "Added to trial"
                            )
                          }
                        >
                          Try
                        </NabuButton>
                        <NabuButton
                          tone="ghost"
                          size="sm"
                          disabled={busy === `discovery-${candidate.id}-reject`}
                          onClick={() =>
                            postAction(
                              `discovery-${candidate.id}-reject`,
                              "/api/music/discovery",
                              { id: candidate.id, action: "reject" },
                              "Rejected"
                            )
                          }
                        >
                          Reject
                        </NabuButton>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </NabuSurface>

            {/* Rooms section */}
            <section className="space-y-3">
              <NabuSectionHeader eyebrow="Rooms" title="Playing now" />

              <div className="space-y-3">
                {orderedRooms.map((room) => {
                  const now = room.nowPlaying;
                  const last = room.lastMedia;
                  const isPlaying = now?.state === "PLAYING";
                  const hasTrack = Boolean(now?.track);

                  return (
                    <NabuCard key={room.room}>
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-lg font-semibold text-primary">
                              {room.room}
                            </h3>
                            <NabuBadge tone={isPlaying ? "green" : "stone"}>
                              {statusLabel(now?.state)}
                            </NabuBadge>
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
                              <NabuKicker>Playing now</NabuKicker>
                              {hasTrack ? (
                                <>
                                  <p className="mt-1 truncate font-medium text-primary">
                                    {now?.track}
                                  </p>
                                  <p className="truncate text-sm text-tertiary">
                                    {now?.artist || "Unknown artist"}
                                  </p>
                                  <p className="truncate text-sm text-quaternary">
                                    {now?.album || "Unknown album"}
                                  </p>
                                </>
                              ) : (
                                <p className="mt-1 text-sm text-tertiary">
                                  Nothing live from Sonos right now.
                                </p>
                              )}
                            </div>
                          </div>

                          {hasTrack && now && (
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <NabuButton
                                tone="secondary"
                                size="sm"
                                disabled={busy === `${room.room}-track-love`}
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
                              >
                                ♥ Love track
                              </NabuButton>
                              <NabuButton
                                tone="secondary"
                                size="sm"
                                disabled={busy === `${room.room}-resume-room`}
                                onClick={() =>
                                  postAction(
                                    `${room.room}-resume-room`,
                                    "/api/music/resume",
                                    { room: room.room },
                                    `Resumed in ${room.room}`
                                  )
                                }
                              >
                                Resume room
                              </NabuButton>
                            </div>
                          )}
                        </div>

                        <NabuSurface
                          tone="muted"
                          as="div"
                          className="w-full p-4 lg:max-w-sm"
                        >
                          <NabuKicker>Last playlist / album</NabuKicker>
                          {last ? (
                            <>
                              <p className="mt-2 font-medium text-primary">
                                {last.name}
                              </p>
                              <p className="mt-1 text-sm text-tertiary">
                                {typeLabel(last.type)} · {formatDate(last.lastPlayed)}
                              </p>
                              {last.lastTrack?.title && (
                                <p className="mt-2 text-sm text-tertiary">
                                  Last track:{" "}
                                  {last.lastTrack.artist
                                    ? `${last.lastTrack.artist} — `
                                    : ""}
                                  {last.lastTrack.title}
                                  {last.lastTrack.trackNo
                                    ? ` (#${last.lastTrack.trackNo})`
                                    : ""}
                                </p>
                              )}
                              <div className="mt-4 flex flex-wrap gap-2">
                                <NabuButton
                                  tone="primary"
                                  size="sm"
                                  disabled={busy === `${room.room}-play-again`}
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-play-again`,
                                      "/api/music/play-again",
                                      { room: room.room, name: last.name, type: last.type },
                                      `Playing ${last.name}`
                                    )
                                  }
                                >
                                  Play again
                                </NabuButton>
                                <NabuButton
                                  tone="secondary"
                                  size="sm"
                                  disabled={busy === `${room.room}-resume`}
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-resume`,
                                      "/api/music/resume",
                                      { room: room.room, name: last.name, type: last.type },
                                      `Resuming ${last.name}`
                                    )
                                  }
                                >
                                  Resume
                                </NabuButton>
                                <NabuButton
                                  tone="ghost"
                                  size="sm"
                                  disabled={busy === `${room.room}-playlist-love`}
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-playlist-love`,
                                      "/api/music/playlist-feedback",
                                      { name: last.name, rating: "love" },
                                      "Marked as loved"
                                    )
                                  }
                                >
                                  👍
                                </NabuButton>
                                <NabuButton
                                  tone="ghost"
                                  size="sm"
                                  disabled={busy === `${room.room}-playlist-skip`}
                                  onClick={() =>
                                    postAction(
                                      `${room.room}-playlist-skip`,
                                      "/api/music/playlist-feedback",
                                      { name: last.name, rating: "skip" },
                                      "Marked as skip"
                                    )
                                  }
                                >
                                  👎
                                </NabuButton>
                              </div>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-tertiary">
                              No durable play history for this room yet.
                            </p>
                          )}
                        </NabuSurface>
                      </div>
                    </NabuCard>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
