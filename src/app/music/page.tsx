"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

const ROOMS = ["Living Room", "Cinema", "Penthouse", "Pool"];

interface CurrentTrack {
  artist: string;
  title: string;
  album: string;
  albumArtUri?: string;
  type?: string;
}

interface RoomState {
  currentTrack?: CurrentTrack;
  playbackState?: "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED";
  volume?: number;
  error?: string;
}

export default function MusicPage() {
  const [states, setStates] = useState<Record<string, RoomState>>({});
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchStates = useCallback(async () => {
    const results: Record<string, RoomState> = {};
    await Promise.all(
      ROOMS.map(async (room) => {
        try {
          const res = await fetch(
            `/api/music/${encodeURIComponent(room)}/state`
          );
          if (res.ok) {
            results[room] = await res.json();
          } else {
            results[room] = { error: "unavailable" };
          }
        } catch {
          results[room] = { error: "unavailable" };
        }
      })
    );
    setStates(results);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStates();
    const interval = setInterval(fetchStates, 10000);
    return () => clearInterval(interval);
  }, [fetchStates]);

  async function handlePlayPause(room: string, currentState?: string) {
    const action = currentState === "PLAYING" ? "pause" : "play";
    setActionInProgress(`${room}-${action}`);
    try {
      await fetch(`/api/music/${encodeURIComponent(room)}/${action}`);
      // Brief delay then refresh to get updated state
      setTimeout(fetchStates, 500);
    } catch {
      // ignore
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleFeedback(
    room: string,
    track: CurrentTrack,
    action: "like" | "dislike"
  ) {
    setActionInProgress(`${room}-${action}`);
    try {
      await fetch("/api/music/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room,
          track: track.title,
          artist: track.artist,
          album: track.album,
          action,
        }),
      });
    } catch {
      // ignore
    } finally {
      setActionInProgress(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎵</span>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Music
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-16 text-zinc-500 dark:text-zinc-400">
            <span className="text-4xl mb-4 block">🎵</span>
            <p className="text-lg">Loading rooms...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ROOMS.map((room) => {
              const state = states[room];
              const isPlaying = state?.playbackState === "PLAYING";
              const isStopped =
                !state ||
                state.error ||
                state.playbackState === "STOPPED" ||
                !state.currentTrack;
              const track = state?.currentTrack;

              return (
                <div
                  key={room}
                  className="rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {room}
                    </h2>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        isPlaying
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {state?.error
                        ? "Offline"
                        : isPlaying
                          ? "Playing"
                          : state?.playbackState === "PAUSED_PLAYBACK"
                            ? "Paused"
                            : "Stopped"}
                    </span>
                  </div>

                  {track && !state?.error ? (
                    <div className="flex gap-4 mb-4">
                      {track.albumArtUri && (
                        <img
                          src={track.albumArtUri}
                          alt={`${track.album} cover`}
                          className="w-16 h-16 rounded object-cover flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {track.title}
                        </p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 truncate">
                          {track.artist}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-500 truncate">
                          {track.album}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Not playing
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        handlePlayPause(room, state?.playbackState)
                      }
                      disabled={!!state?.error}
                      className="px-3 py-1.5 text-sm rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionInProgress === `${room}-play` ||
                      actionInProgress === `${room}-pause`
                        ? "..."
                        : isPlaying
                          ? "⏸ Pause"
                          : "▶ Play"}
                    </button>

                    {track && !isStopped && (
                      <>
                        <button
                          onClick={() =>
                            handleFeedback(room, track, "like")
                          }
                          disabled={actionInProgress === `${room}-like`}
                          className="px-2 py-1.5 text-sm rounded-md hover:bg-green-100 dark:hover:bg-green-900 transition-colors"
                          title="Like this track"
                        >
                          👍
                        </button>
                        <button
                          onClick={() =>
                            handleFeedback(room, track, "dislike")
                          }
                          disabled={actionInProgress === `${room}-dislike`}
                          className="px-2 py-1.5 text-sm rounded-md hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
                          title="Dislike this track"
                        >
                          👎
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
