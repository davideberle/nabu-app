"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSurface,
  NabuButton,
  NabuBadge,
  NabuEmptyState,
} from "@/components/ui/nabu";
import {
  artworkUrl,
  feedbackLabel,
  feedbackTone,
  summarizeRequest,
  type NewPlayAction,
  type NewPlayListItem,
} from "@/lib/music-new-plays-view";

type ListResponse = {
  items?: NewPlayListItem[];
  syncedAt?: string | null;
  error?: string;
};

const ZURICH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "Tue 16 Sep, 14:05" in Europe/Zurich regardless of the browser zone. */
function formatPlayedAt(value: string) {
  try {
    const parts = ZURICH_FORMAT.formatToParts(new Date(value));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
  } catch {
    return value;
  }
}

function noveltyLabel(kind: string) {
  if (kind === "unfamiliar") return "New for you";
  if (kind === "archaeology") return "Older, new to you";
  return kind;
}


function libraryLabel(state: string): { label: string; tone: "green" | "amber" | "red" | "stone" } {
  switch (state) {
    case "in-library":
      return { label: "In Apple Music library", tone: "green" };
    case "not-in-library":
      return { label: "Not in library", tone: "stone" };
    case "add-pending":
      return { label: "Library add pending", tone: "amber" };
    case "add-failed":
      return { label: "Library add failed", tone: "red" };
    default:
      return { label: "Library state unknown", tone: "stone" };
  }
}

function profileLabel(profile: NewPlayListItem["profileState"]) {
  if (profile.approved && profile.contexts.length > 0) {
    return `Approved for: ${profile.contexts.join(", ")}`;
  }
  if (profile.approved) return "Approved in DJ profile";
  return "Not in DJ profile";
}

function actionLabel(action: string, context: string | null) {
  switch (action) {
    case "love":
      return "Love";
    case "more_like_this":
      return "More like this";
    case "wrong_context":
      return `Wrong context${context ? ` (${context})` : ""}`;
    case "not_for_me":
      return "Not for me";
    case "add_to_apple_library":
      return "Add to Apple Music";
    case "approve_for_context":
      return `Approve for ${context ?? "context"}`;
    default:
      return action;
  }
}

type RowNotice = { tone: "ok" | "error"; text: string };

export default function MusicNewPlaysPage() {
  const [items, setItems] = useState<NewPlayListItem[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, RowNotice>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/music/new-plays?limit=100", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as ListResponse;
      if (!res.ok) throw new Error(json.error || `New plays unavailable (${res.status})`);
      setItems(Array.isArray(json.items) ? json.items : []);
      setSyncedAt(json.syncedAt ?? null);
      setError(json.error ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "New plays unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function requestAction(row: NewPlayListItem, action: NewPlayAction, context: string | null) {
    const key = `${row.playId}:${action}:${context ?? ""}`;
    setBusy(key);
    setNotices((prev) => {
      const next = { ...prev };
      delete next[row.playId];
      return next;
    });
    try {
      const res = await fetch("/api/music/new-plays/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playId: row.playId, action, context }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.status === 202 && json.ok) {
        setNotices((prev) => ({
          ...prev,
          [row.playId]: { tone: "ok", text: "Queued — applied on the home runtime" },
        }));
        await refresh();
        return;
      }
      throw new Error(json.error || `Could not queue action (${res.status})`);
    } catch (err) {
      setNotices((prev) => ({
        ...prev,
        [row.playId]: {
          tone: "error",
          text: err instanceof Error ? err.message : "Could not queue action",
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  function isQueued(row: NewPlayListItem, action: NewPlayAction, context: string | null) {
    return row.pendingActions.some(
      (pending) =>
        pending.status === "pending" &&
        pending.action === action &&
        (pending.context ?? "") === (context ?? ""),
    );
  }

  return (
    <NabuPageShell>
      <NabuHeader
        title="New plays"
        backHref="/music"
        subtitle="History of unfamiliar items the DJ actually played. Actions are applied by the music domain on the home runtime; Apple Music and DJ-profile changes are separate, explicit steps."
      />

      <NabuMain>
        {loading ? (
          <NabuEmptyState title="Loading new plays…" />
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {error}
              </div>
            )}

            <p className="text-xs text-quaternary">
              {syncedAt
                ? `Mirror last pushed ${formatPlayedAt(syncedAt)} · ${items.length} play${items.length === 1 ? "" : "s"}`
                : "Mirror not pushed yet."}
            </p>

            {items.length === 0 ? (
              <NabuEmptyState icon="🎵" title="No unfamiliar plays yet." />
            ) : (
              <NabuSurface as="section">
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {items.map((row) => {
                    const context = row.requestContext.context;
                    const art = artworkUrl(row.artwork, 160);
                    const library = libraryLabel(row.libraryState);
                    const currentFeedback = feedbackLabel(row.feedback);
                    const notice = notices[row.playId];
                    const approvedHere = Boolean(
                      context && row.profileState.approved && row.profileState.contexts.includes(context),
                    );
                    const libraryLocked =
                      row.libraryState === "in-library" || row.libraryState === "add-pending";
                    const title = row.name ?? "Untitled";

                    const button = (
                      action: NewPlayAction,
                      label: string,
                      actionContext: string | null,
                      options: { disabled?: boolean; tone?: "primary" | "secondary" | "ghost" } = {},
                    ) => {
                      const key = `${row.playId}:${action}:${actionContext ?? ""}`;
                      const queued = isQueued(row, action, actionContext);
                      return (
                        <NabuButton
                          tone={options.tone ?? "secondary"}
                          size="sm"
                          disabled={Boolean(options.disabled) || queued || busy === key}
                          onClick={() => requestAction(row, action, actionContext)}
                        >
                          {label}
                        </NabuButton>
                      );
                    };

                    return (
                      <article key={row.playId} className="flex flex-col gap-4 p-5">
                        <div className="flex min-w-0 gap-4">
                          {art ? (
                            <img
                              src={art}
                              alt={`${title} cover`}
                              className="h-20 w-20 shrink-0 rounded-xl object-cover"
                            />
                          ) : (
                            <div
                              aria-hidden
                              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-2xl dark:bg-zinc-800"
                            >
                              🎵
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-medium text-primary">{title}</h3>
                              {row.type && <NabuBadge tone="stone">{row.type}</NabuBadge>}
                              <NabuBadge tone={row.noveltyKind === "archaeology" ? "violet" : "blue"}>
                                {noveltyLabel(row.noveltyKind)}
                              </NabuBadge>
                              {row.releaseYear != null && (
                                <NabuBadge tone="stone">{row.releaseYear}</NabuBadge>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-tertiary">
                              {row.artist ?? "Unknown artist"}
                              {row.genres.length > 0 ? ` · ${row.genres.join(" · ")}` : ""}
                            </p>
                            <p className="mt-1 text-sm text-tertiary">
                              {formatPlayedAt(row.playedAt)}
                              {row.room ? ` · ${row.room}` : ""}
                            </p>
                            <p className="mt-1 text-sm text-tertiary">{summarizeRequest(row)}</p>
                            {(row.source || row.reason) && (
                              <p className="mt-1 line-clamp-2 text-sm text-quaternary">
                                {[row.source, row.reason].filter(Boolean).join(" — ")}
                              </p>
                            )}

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {currentFeedback && (
                                <NabuBadge tone={feedbackTone(row.feedback?.type)}>{currentFeedback}</NabuBadge>
                              )}
                              <NabuBadge tone={library.tone}>{library.label}</NabuBadge>
                              <NabuBadge tone={row.profileState.approved ? "green" : "stone"}>
                                {profileLabel(row.profileState)}
                              </NabuBadge>
                              {row.pendingActions.map((pending) => (
                                <NabuBadge
                                  key={pending.id}
                                  tone={pending.status === "failed" ? "red" : "amber"}
                                  title={pending.resultMessage ?? undefined}
                                >
                                  {pending.status === "failed" ? "Failed" : "Queued"}:{" "}
                                  {actionLabel(pending.action, pending.context)}
                                </NabuBadge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {button("love", "Love", null, { tone: "primary" })}
                          {button("more_like_this", "More like this", null)}
                          {button("wrong_context", "Wrong context", context, { disabled: !context, tone: "ghost" })}
                          {button("not_for_me", "Not for me", null, { tone: "ghost" })}
                          {button("add_to_apple_library", "Add to Apple Music", null, { disabled: libraryLocked })}
                          {button(
                            "approve_for_context",
                            context ? `Approve for ${context}` : "Approve for context",
                            context,
                            { disabled: !context || approvedHere },
                          )}
                        </div>

                        {notice && (
                          <p
                            className={
                              notice.tone === "ok"
                                ? "text-sm text-green-700 dark:text-green-300"
                                : "text-sm text-red-700 dark:text-red-300"
                            }
                          >
                            {notice.text}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </NabuSurface>
            )}
          </div>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
