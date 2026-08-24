"use client";

// ---------------------------------------------------------------------------
// The Listening Library — /family/listen (family-assistant DESIGN §7.4.2).
//
// Presentation only, by design: the bridge composes the lanes, series,
// per-story state and recommendation reasons; this client renders them and
// sends back typed actions. Playback is the same two-stage contract as the
// spoken flow, made visible: tapping Play fetches a *preview* (one candidate
// card + a one-use confirmation token), and nothing reaches a speaker until
// the child confirms that exact card. There is no code path here that names a
// provider URI or skips the confirmation.
//
// The selected child comes from the persistent shell provider; every request
// is authorized by the same server-minted child-scoped token as a
// conversation turn, so a tampered client can at worst re-open the chooser.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NabuBadge, cn } from "@/components/ui/nabu";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import {
  createListeningClient,
  type ListeningFeedbackAction,
  type ListeningLibrary,
  type ListeningNowPlaying,
  type ListeningPreview,
  type ListeningStoryView,
} from "@/lib/family-listening";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

/** Poll cadence for attributable progress while the page is open. */
const NOW_POLL_MS = 20_000;

const BADGE_LABEL: Record<ListeningStoryView["badge"], { label: string; tone: "stone" | "green" | "amber" | "blue" | "violet" }> = {
  new: { label: "New", tone: "blue" },
  in_progress: { label: "In progress", tone: "amber" },
  heard: { label: "Heard", tone: "green" },
  liked: { label: "Liked", tone: "violet" },
  hidden: { label: "Hidden", tone: "stone" },
};

function formatDuration(totalSeconds?: number): string | null {
  if (!totalSeconds) return null;
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} min`;
}

function Artwork({ story, sizeClass }: { story: ListeningStoryView; sizeClass: string }) {
  if (story.artworkUrl) {
    // Catalog artwork from the bridge (https-enforced at parse time), not a
    // build-time asset, so next/image's optimizer has nothing to do here.
    // Alt is empty on purpose: the visible title says the same thing.
    return (
      <img
        src={story.artworkUrl}
        alt=""
        loading="lazy"
        className={cn(sizeClass, "shrink-0 rounded-xl bg-secondary object-cover")}
      />
    );
  }
  return (
    <span className={cn(sizeClass, "grid shrink-0 place-items-center rounded-xl bg-secondary text-3xl")} aria-hidden>
      🎧
    </span>
  );
}

function StoryCard({
  story,
  reason,
  onOpen,
}: {
  story: ListeningStoryView;
  reason?: string;
  onOpen: (story: ListeningStoryView) => void;
}) {
  const badge = BADGE_LABEL[story.badge];
  return (
    <button
      type="button"
      onClick={() => onOpen(story)}
      className={cn(
        "flex w-44 shrink-0 flex-col gap-2 rounded-2xl border border-primary bg-primary p-3 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
        focusRing,
      )}
    >
      <Artwork story={story} sizeClass="aspect-square w-full" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-primary">{story.title}</span>
        <span className="block truncate text-xs text-tertiary">{story.seriesTitle}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <NabuBadge tone={badge.tone}>{badge.label}</NabuBadge>
        {story.liked && story.badge !== "liked" ? <span aria-label="liked">👍</span> : null}
      </span>
      {reason ? <span className="text-xs text-quaternary">{reason}</span> : null}
    </button>
  );
}

function Lane({
  title,
  icon,
  entries,
  stories,
  onOpen,
}: {
  title: string;
  icon: string;
  entries: { storyId: string; reason: string }[];
  stories: Record<string, ListeningStoryView>;
  onOpen: (story: ListeningStoryView) => void;
}) {
  const visible = entries.map((entry) => ({ entry, story: stories[entry.storyId] })).filter(
    (item): item is { entry: { storyId: string; reason: string }; story: ListeningStoryView } =>
      item.story !== undefined && !item.story.hidden,
  );
  if (visible.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-primary">
        <span aria-hidden>{icon}</span>
        {title}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {visible.map(({ entry, story }) => (
          <StoryCard key={story.id} story={story} reason={entry.reason} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

/**
 * One episode row on a series page: the complete ordered list shows every
 * approved episode with its state, including hidden ones (dimmed), so
 * "complete series view" stays true even after a child hides a story.
 */
function EpisodeRow({
  story,
  onOpen,
}: {
  story: ListeningStoryView;
  onOpen: (story: ListeningStoryView) => void;
}) {
  const badge = BADGE_LABEL[story.badge];
  const duration = formatDuration(story.totalDurationSeconds);
  return (
    <button
      type="button"
      onClick={() => onOpen(story)}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 rounded-2xl border border-primary bg-primary px-3 py-2 text-left transition-colors hover:bg-secondary",
        story.hidden ? "opacity-60" : "",
        focusRing,
      )}
    >
      <Artwork story={story} sizeClass="h-14 w-14" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-primary">{story.title}</span>
        <span className="block text-sm text-tertiary">
          {story.chapterCount} chapters{duration ? ` · ${duration}` : ""}
          {story.resume ? ` · at chapter ${story.resume.chapterIndex + 1}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {story.liked ? <span aria-label="liked">👍</span> : null}
        {story.disliked ? <span aria-label="disliked">👎</span> : null}
        <NabuBadge tone={badge.tone}>{badge.label}</NabuBadge>
      </span>
    </button>
  );
}

type SheetPhase =
  | { kind: "detail" }
  | { kind: "previewing" }
  | { kind: "confirm"; preview: ListeningPreview }
  | { kind: "starting"; preview: ListeningPreview }
  | { kind: "started"; title: string; room: string; chapterIndex: number }
  | { kind: "error"; message: string };

/** The story sheet: state, feedback, and the visible two-stage play flow. */
function StorySheet({
  child,
  story,
  onClose,
  onFeedback,
  onPreview,
  onConfirm,
  busyAction,
}: {
  child: ChildId;
  story: ListeningStoryView;
  onClose: () => void;
  onFeedback: (story: ListeningStoryView, action: ListeningFeedbackAction) => void;
  onPreview: (story: ListeningStoryView, room: "living_room" | "cinema") => Promise<ListeningPreview | string>;
  onConfirm: (preview: ListeningPreview) => Promise<{ title: string; room: string; chapterIndex: number } | string>;
  busyAction: boolean;
}) {
  const [phase, setPhase] = useState<SheetPhase>({ kind: "detail" });
  const [room, setRoom] = useState<"living_room" | "cinema">("living_room");
  const duration = formatDuration(story.totalDurationSeconds);

  const startPreview = async () => {
    setPhase({ kind: "previewing" });
    const result = await onPreview(story, room);
    setPhase(typeof result === "string" ? { kind: "error", message: result } : { kind: "confirm", preview: result });
  };

  const confirm = async (preview: ListeningPreview) => {
    setPhase({ kind: "starting", preview });
    const result = await onConfirm(preview);
    setPhase(typeof result === "string" ? { kind: "error", message: result } : { kind: "started", ...result });
  };

  const actionButton = (label: string, active: boolean, action: ListeningFeedbackAction, activeAction: ListeningFeedbackAction) => (
    <button
      type="button"
      disabled={busyAction}
      onClick={() => onFeedback(story, active ? activeAction : action)}
      aria-pressed={active}
      className={cn(
        "min-h-12 rounded-full border px-4 text-sm font-medium transition-colors",
        active ? "border-primary bg-primary text-secondary" : "border-primary bg-primary text-primary hover:bg-secondary",
        focusRing,
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={story.title}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-primary bg-primary p-5 shadow-lg">
        <div className="flex items-start gap-4">
          <Artwork story={story} sizeClass="h-24 w-24" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-primary">{story.title}</p>
            <p className="text-sm text-tertiary">
              {story.seriesTitle}
              {story.artist && story.artist !== story.seriesTitle ? ` · ${story.artist}` : ""}
            </p>
            <p className="mt-1 text-sm text-tertiary">
              {story.chapterCount} chapters{duration ? ` · ${duration}` : ""}
              {story.educational ? " · learn something" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-full border border-primary text-lg", focusRing)}
          >
            ✕
          </button>
        </div>

        {phase.kind === "detail" || phase.kind === "previewing" || phase.kind === "error" ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {actionButton(story.liked ? "👍 Liked" : "👍 Like", story.liked, "like", "clear_feedback")}
              {actionButton(story.disliked ? "👎 Not for me" : "👎 Not for me", story.disliked, "dislike", "clear_feedback")}
              {actionButton(
                story.alreadyHeard || story.status === "completed" ? "✓ Heard it" : "Mark as heard",
                story.alreadyHeard,
                "mark_heard",
                "clear_heard",
              )}
              {actionButton(story.hidden ? "Hidden" : "Hide", story.hidden, "hide", "unhide")}
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm text-quaternary">Where should it play?</p>
              <div className="flex gap-2" role="radiogroup" aria-label="Room">
                {(
                  [
                    { id: "living_room", label: "Living Room" },
                    { id: "cinema", label: "Cinema" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={room === option.id}
                    onClick={() => setRoom(option.id)}
                    className={cn(
                      "min-h-12 rounded-full border px-4 text-sm font-medium",
                      room === option.id
                        ? "border-primary bg-primary text-secondary"
                        : "border-primary bg-primary text-primary hover:bg-secondary",
                      focusRing,
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {phase.kind === "error" ? (
              <p className="mt-3 rounded-xl bg-secondary p-3 text-sm text-primary" role="alert">
                {phase.message}
              </p>
            ) : null}

            <button
              type="button"
              disabled={phase.kind === "previewing"}
              onClick={startPreview}
              className={cn(
                "mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-secondary transition-opacity",
                "border border-primary disabled:opacity-60",
                focusRing,
              )}
            >
              {phase.kind === "previewing"
                ? "Getting it ready…"
                : story.resume
                  ? `▶ Resume from chapter ${story.resume.chapterIndex + 1}`
                  : "▶ Play"}
            </button>
          </>
        ) : null}

        {phase.kind === "confirm" || phase.kind === "starting" ? (
          <div className="mt-4 rounded-2xl border border-primary bg-secondary p-4">
            <p className="text-sm text-quaternary">Ready to play for {child === "santiago" ? "Santiago" : "Isabel"}:</p>
            <p className="mt-1 text-base font-semibold text-primary">{phase.preview.card.title}</p>
            {phase.preview.card.meta ? <p className="text-sm text-tertiary">{phase.preview.card.meta}</p> : null}
            {phase.preview.resume ? (
              <p className="mt-1 text-sm text-tertiary">
                Continues at chapter {phase.preview.resume.chapterIndex + 1}: {phase.preview.resume.chapterTitle}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={phase.kind === "starting"}
                onClick={() => confirm(phase.preview)}
                className={cn(
                  "min-h-14 flex-1 rounded-2xl border border-primary bg-primary text-base font-semibold text-secondary disabled:opacity-60",
                  focusRing,
                )}
              >
                {phase.kind === "starting" ? "Starting…" : "Yes, play it"}
              </button>
              <button
                type="button"
                disabled={phase.kind === "starting"}
                onClick={() => setPhase({ kind: "detail" })}
                className={cn("min-h-14 rounded-2xl border border-primary bg-primary px-5 text-base text-primary", focusRing)}
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "started" ? (
          <div className="mt-4 rounded-2xl border border-primary bg-secondary p-4" role="status">
            <p className="text-base font-semibold text-primary">
              🎵 Playing in the {phase.room}
              {phase.chapterIndex > 0 ? `, from chapter ${phase.chapterIndex + 1}` : ""}!
            </p>
            <button
              type="button"
              onClick={onClose}
              className={cn("mt-3 min-h-12 w-full rounded-2xl border border-primary bg-primary text-base text-primary", focusRing)}
            >
              Done
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function FamilyListenClient() {
  const { child, restored } = useChildShell();
  const client = useMemo(() => createListeningClient(), []);
  const [library, setLibrary] = useState<ListeningLibrary | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(null);
  const [openStoryId, setOpenStoryId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<ListeningNowPlaying>(null);
  const [busyAction, setBusyAction] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (target: ChildId) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadState("loading");
      const outcome = await client.loadLibrary(target, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (outcome.ok) {
        setLibrary(outcome.value);
        setLoadState("ready");
      } else {
        setLoadState("error");
      }
    },
    [client],
  );

  // Load for the selected child; a profile switch atomically reloads and
  // drops any open sheet, so no intermediate render mixes two children.
  useEffect(() => {
    if (!child) return;
    client.reset();
    setLibrary(null);
    setOpenSeriesId(null);
    setOpenStoryId(null);
    setNowPlaying(null);
    void load(child);
    return () => abortRef.current?.abort();
  }, [child, client, load]);

  // Attributable progress: poll while the page is open. The bridge updates
  // verified chapter state only for this child's own confirmed playback.
  useEffect(() => {
    if (!child || loadState !== "ready") return;
    let cancelled = false;
    const poll = async () => {
      const outcome = await client.refreshNow(child);
      if (!cancelled && outcome.ok) setNowPlaying(outcome.value);
    };
    void poll();
    const timer = setInterval(() => void poll(), NOW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [child, client, loadState]);

  const handleFeedback = useCallback(
    async (story: ListeningStoryView, action: ListeningFeedbackAction) => {
      if (!child) return;
      setBusyAction(true);
      const outcome = await client.sendFeedback(child, { storyId: story.id, action });
      if (outcome.ok) await load(child);
      setBusyAction(false);
    },
    [child, client, load],
  );

  const handlePreview = useCallback(
    async (story: ListeningStoryView, room: "living_room" | "cinema") => {
      if (!child) return "Choose who is listening first";
      const outcome = await client.preview(child, { storyId: story.id, room });
      if (!outcome.ok) return outcome.message ?? "That didn't work — try again in a moment";
      return outcome.value;
    },
    [child, client],
  );

  const handleConfirm = useCallback(
    async (preview: ListeningPreview) => {
      if (!child) return "Choose who is listening first";
      const outcome = await client.confirmPlay(child, { confirmationToken: preview.confirmationToken });
      if (!outcome.ok) return outcome.message ?? "The speakers didn't answer — try again";
      // Reload so Continue listening reflects the new in-progress state.
      void load(child);
      void client.refreshNow(child).then((now) => now.ok && setNowPlaying(now.value));
      return outcome.value;
    },
    [child, client, load],
  );

  if (!restored || !child) return null;

  const openStory = openStoryId && library ? (library.stories[openStoryId] ?? null) : null;
  const openSeries = openSeriesId && library ? (library.series.find((series) => series.id === openSeriesId) ?? null) : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {openSeries ? (
            <button
              type="button"
              onClick={() => setOpenSeriesId(null)}
              className={cn("grid h-12 w-12 place-items-center rounded-full border border-primary text-lg", focusRing)}
              aria-label="Back to the library"
            >
              ←
            </button>
          ) : (
            <Link
              href={`/family/assistant?child=${child}`}
              className={cn("grid h-12 w-12 place-items-center rounded-full border border-primary text-lg", focusRing)}
              aria-label="Back to the assistant"
            >
              ←
            </Link>
          )}
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-primary">
            {openSeries ? openSeries.title : "🎧 Stories"}
          </h1>
        </div>
      </div>

      {loadState === "loading" ? (
        <div className="grid place-items-center py-20 text-tertiary" role="status">
          <p className="text-lg">Getting your stories…</p>
        </div>
      ) : null}

      {loadState === "error" ? (
        <div className="grid place-items-center gap-4 py-20" role="alert">
          <p className="text-lg text-primary">The story shelf didn&apos;t load.</p>
          <button
            type="button"
            onClick={() => child && void load(child)}
            className={cn(
              "min-h-12 rounded-full border border-primary bg-primary px-6 text-base font-medium text-primary hover:bg-secondary",
              focusRing,
            )}
          >
            Try again
          </button>
        </div>
      ) : null}

      {loadState === "ready" && library && !openSeries ? (
        <div className="space-y-8">
          <Lane
            title="Continue listening"
            icon="⏯"
            entries={library.lanes.continueListening}
            stories={library.stories}
            onOpen={(story) => setOpenStoryId(story.id)}
          />
          <Lane
            title="Favorites"
            icon="⭐"
            entries={library.lanes.favorites}
            stories={library.stories}
            onOpen={(story) => setOpenStoryId(story.id)}
          />
          <Lane
            title="New for you"
            icon="✨"
            entries={library.lanes.newForYou}
            stories={library.stories}
            onOpen={(story) => setOpenStoryId(story.id)}
          />
          <Lane
            title="Learn something"
            icon="🔍"
            entries={library.lanes.learnSomething}
            stories={library.stories}
            onOpen={(story) => setOpenStoryId(story.id)}
          />
          <Lane
            title="Funny and adventurous"
            icon="🎢"
            entries={library.lanes.funnyAndAdventurous}
            stories={library.stories}
            onOpen={(story) => setOpenStoryId(story.id)}
          />

          <section aria-label="All series">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-primary">
              <span aria-hidden>📚</span>
              All series
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {library.series.map((series) => (
                <button
                  key={series.id}
                  type="button"
                  onClick={() => setOpenSeriesId(series.id)}
                  className={cn(
                    "flex min-h-20 items-center gap-3 rounded-2xl border border-primary bg-primary p-3 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
                    focusRing,
                  )}
                >
                  {series.artworkUrl ? (
                    <img src={series.artworkUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-secondary text-2xl" aria-hidden>
                      📖
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-primary">{series.title}</span>
                    <span className="block text-sm text-tertiary">
                      {series.storyIds.length} {series.storyIds.length === 1 ? "story" : "stories"}
                      {series.ageRange ? ` · ${series.ageRange}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {loadState === "ready" && library && openSeries ? (
        <div className="space-y-3">
          {openSeries.description ? <p className="text-base text-tertiary">{openSeries.description}</p> : null}
          {openSeries.storyIds.map((storyId) => {
            const story = library.stories[storyId];
            if (!story) return null;
            return <EpisodeRow key={storyId} story={story} onOpen={(target) => setOpenStoryId(target.id)} />;
          })}
        </div>
      ) : null}

      {nowPlaying ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-primary bg-primary px-4 py-3" role="status">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <span aria-hidden className="text-xl">🎵</span>
            <span className="min-w-0 flex-1 truncate text-sm text-primary">
              {nowPlaying.title} — chapter {nowPlaying.chapterIndex + 1} of {nowPlaying.chapterCount} in the {nowPlaying.room}
            </span>
          </div>
        </div>
      ) : null}

      {openStory ? (
        <StorySheet
          child={child}
          story={openStory}
          onClose={() => setOpenStoryId(null)}
          onFeedback={handleFeedback}
          onPreview={handlePreview}
          onConfirm={handleConfirm}
          busyAction={busyAction}
        />
      ) : null}
    </main>
  );
}
