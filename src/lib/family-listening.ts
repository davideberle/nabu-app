// The Listening Library wire contract and browser transport.
//
// Client half of the `/v1/listening/*` surface the family-assistant bridge
// serves (family-assistant DESIGN §7.4.2; server:
// `openclaw-plugin/src/listening/http.ts`). Same two hops and the same
// authority chain as a child turn: this module mints the *same* child-scoped
// session token via `POST /api/family/assistant/session` and carries it to
// the tailnet bridge, which composes the library from the family-assistant
// catalog + per-child state and the sonos-music editions. The browser renders;
// it never ranks, resolves, or names a provider URI — playback happens by
// handing back the one-use confirmation token from a preview, exactly like
// the spoken Sonos flow.
//
// Isomorphic and dependency-free on purpose: imported by a client component
// and loaded directly by `node --test` (hence the explicit `.ts` extensions).

import {
  readBridgeOrigin,
  type ChildId,
  // Explicit .ts extension: this module is also loaded directly by
  // `node --test`, whose ESM resolver does not add extensions.
} from "./family-assistant-turn.ts";
import {
  SESSION_MINT_PATH,
  readSessionInfo,
  type ChildBridgeSessionInfo,
} from "./family-assistant-client.ts";

export const LISTENING_BASE_PATH = "/v1/listening";

/** Re-mint this long before token expiry, mirroring the turn client. */
const SESSION_REFRESH_MARGIN_MS = 60_000;

// ---------------------------------------------------------------------------
// View model parsing — every field is untrusted until it is read here
// ---------------------------------------------------------------------------

export type StoryBadge = "hidden" | "in_progress" | "heard" | "liked" | "new";

export type ListeningStoryView = {
  id: string;
  seriesId: string;
  seriesTitle: string;
  episodeNumber: number;
  title: string;
  artist?: string;
  /** https-only; anything else was dropped at parse time. */
  artworkUrl?: string;
  chapterCount: number;
  totalDurationSeconds?: number;
  educational: boolean;
  badge: StoryBadge;
  status: "not_started" | "in_progress" | "completed";
  liked: boolean;
  disliked: boolean;
  alreadyHeard: boolean;
  hidden: boolean;
  resume?: { chapterIndex: number; chapterTitle: string };
};

export type ListeningSeriesView = {
  id: string;
  title: string;
  description?: string;
  ageRange?: string;
  artworkUrl?: string;
  storyIds: string[];
};

export type ListeningLaneEntry = { storyId: string; reason: string };

export type ListeningLanes = {
  continueListening: ListeningLaneEntry[];
  favorites: ListeningLaneEntry[];
  newForYou: ListeningLaneEntry[];
  learnSomething: ListeningLaneEntry[];
  funnyAndAdventurous: ListeningLaneEntry[];
};

export type ListeningLibrary = {
  child: ChildId;
  lanes: ListeningLanes;
  series: ListeningSeriesView[];
  stories: Record<string, ListeningStoryView>;
};

export type ListeningPreview = {
  confirmationToken: string;
  room: "Living Room" | "Cinema";
  card: { title: string; subtitle?: string; meta?: string; imageUrl?: string };
  resume: { chapterIndex: number; chapterTitle: string } | null;
  chapterCount: number;
};

export type ListeningNowPlaying = {
  storyId: string;
  title: string;
  chapterIndex: number;
  chapterTitle: string | null;
  chapterCount: number;
  state: string;
  elapsedSeconds: number | null;
  room: string;
} | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHttpsUrl(value: unknown): string | undefined {
  // Last hop before a shared iPad loads it: https only, checked here rather
  // than trusted, same rule as card artwork in the turn contract.
  return typeof value === "string" && value.startsWith("https://") ? value : undefined;
}

function readText(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}

const BADGES: readonly StoryBadge[] = ["hidden", "in_progress", "heard", "liked", "new"];

export function readStoryView(value: unknown): ListeningStoryView | null {
  if (!isRecord(value)) return null;
  const id = readText(value.id, 80);
  const title = readText(value.title);
  const seriesTitle = readText(value.seriesTitle);
  if (!id || !title) return null;
  const badge = BADGES.includes(value.badge as StoryBadge) ? (value.badge as StoryBadge) : "new";
  const status =
    value.status === "in_progress" || value.status === "completed" ? value.status : "not_started";
  const chapterCount =
    typeof value.chapterCount === "number" && Number.isInteger(value.chapterCount) && value.chapterCount > 0
      ? value.chapterCount
      : 0;
  if (chapterCount === 0) return null;
  const resume = isRecord(value.resume)
    ? {
        chapterIndex:
          typeof value.resume.chapterIndex === "number" && Number.isInteger(value.resume.chapterIndex)
            ? value.resume.chapterIndex
            : 0,
        chapterTitle: readText(value.resume.chapterTitle),
      }
    : undefined;
  const artist = readText(value.artist, 100);
  const artworkUrl = readHttpsUrl(value.artworkUrl);
  const totalDurationSeconds =
    typeof value.totalDurationSeconds === "number" && value.totalDurationSeconds > 0
      ? Math.floor(value.totalDurationSeconds)
      : undefined;
  return {
    id,
    seriesId: readText(value.seriesId, 80),
    seriesTitle,
    episodeNumber: typeof value.episodeNumber === "number" ? value.episodeNumber : 0,
    title,
    ...(artist ? { artist } : {}),
    ...(artworkUrl ? { artworkUrl } : {}),
    chapterCount,
    ...(totalDurationSeconds !== undefined ? { totalDurationSeconds } : {}),
    educational: value.educational === true,
    badge,
    status,
    liked: value.liked === true,
    disliked: value.disliked === true,
    alreadyHeard: value.alreadyHeard === true,
    hidden: value.hidden === true,
    ...(resume ? { resume } : {}),
  };
}

function readLane(value: unknown, stories: Record<string, ListeningStoryView>): ListeningLaneEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ListeningLaneEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const storyId = readText(raw.storyId, 80);
    if (!storyId || !stories[storyId]) continue;
    entries.push({ storyId, reason: readText(raw.reason, 120) });
  }
  return entries;
}

/** Parses the library payload. Fail-safe: junk shrinks the view, never throws. */
export function readListeningLibrary(value: unknown, expectedChild: ChildId): ListeningLibrary | null {
  if (!isRecord(value)) return null;
  // A library that answers about a different child is a server bug: refuse it
  // rather than render the sibling's shelf.
  if (value.child !== expectedChild) return null;
  const stories: Record<string, ListeningStoryView> = {};
  if (isRecord(value.stories)) {
    for (const raw of Object.values(value.stories)) {
      const story = readStoryView(raw);
      if (story) stories[story.id] = story;
    }
  }
  const series: ListeningSeriesView[] = [];
  if (Array.isArray(value.series)) {
    for (const raw of value.series) {
      if (!isRecord(raw)) continue;
      const id = readText(raw.id, 80);
      const title = readText(raw.title);
      if (!id || !title) continue;
      const storyIds = Array.isArray(raw.storyIds)
        ? raw.storyIds.filter((entry): entry is string => typeof entry === "string" && Boolean(stories[entry]))
        : [];
      if (storyIds.length === 0) continue;
      const description = readText(raw.description, 400);
      const ageRange = readText(raw.ageRange, 16);
      const artworkUrl = readHttpsUrl(raw.artworkUrl);
      series.push({
        id,
        title,
        ...(description ? { description } : {}),
        ...(ageRange ? { ageRange } : {}),
        ...(artworkUrl ? { artworkUrl } : {}),
        storyIds,
      });
    }
  }
  const lanesRaw = isRecord(value.lanes) ? value.lanes : {};
  return {
    child: expectedChild,
    lanes: {
      continueListening: readLane(lanesRaw.continueListening, stories),
      favorites: readLane(lanesRaw.favorites, stories),
      newForYou: readLane(lanesRaw.newForYou, stories),
      learnSomething: readLane(lanesRaw.learnSomething, stories),
      funnyAndAdventurous: readLane(lanesRaw.funnyAndAdventurous, stories),
    },
    series,
    stories,
  };
}

export function readListeningPreview(value: unknown): ListeningPreview | null {
  if (!isRecord(value) || value.status !== "ok") return null;
  const confirmationToken = readText(value.confirmationToken, 300);
  if (!confirmationToken) return null;
  const room = value.room === "Cinema" ? "Cinema" : "Living Room";
  const cardRaw = isRecord(value.card) ? value.card : {};
  const title = readText(cardRaw.title);
  if (!title) return null;
  const subtitle = readText(cardRaw.subtitle, 120);
  const meta = readText(cardRaw.meta, 120);
  const imageUrl = readHttpsUrl(cardRaw.imageUrl);
  const resume = isRecord(value.resume)
    ? {
        chapterIndex: typeof value.resume.chapterIndex === "number" ? value.resume.chapterIndex : 0,
        chapterTitle: readText(value.resume.chapterTitle),
      }
    : null;
  return {
    confirmationToken,
    room,
    card: {
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(meta ? { meta } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    },
    resume,
    chapterCount: typeof value.chapterCount === "number" ? value.chapterCount : 0,
  };
}

export function readListeningNow(value: unknown): ListeningNowPlaying {
  if (!isRecord(value) || !isRecord(value.playing)) return null;
  const playing = value.playing;
  const storyId = readText(playing.storyId, 80);
  const title = readText(playing.title);
  if (!storyId || !title) return null;
  return {
    storyId,
    title,
    chapterIndex: typeof playing.chapterIndex === "number" ? playing.chapterIndex : 0,
    chapterTitle: typeof playing.chapterTitle === "string" ? playing.chapterTitle : null,
    chapterCount: typeof playing.chapterCount === "number" ? playing.chapterCount : 0,
    state: readText(playing.state, 40) || "unknown",
    elapsedSeconds: typeof playing.elapsedSeconds === "number" ? playing.elapsedSeconds : null,
    room: readText(playing.room, 40),
  };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export const LISTENING_FEEDBACK_ACTIONS = [
  "like",
  "dislike",
  "clear_feedback",
  "mark_heard",
  "clear_heard",
  "hide",
  "unhide",
] as const;

export type ListeningFeedbackAction = (typeof LISTENING_FEEDBACK_ACTIONS)[number];

export type ListeningFailure = "no-session" | "network" | "bad-response" | "refused";

export type ListeningOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ListeningFailure; message?: string };

export type ListeningClientDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type ListeningClient = {
  loadLibrary: (childId: ChildId, options?: { signal?: AbortSignal }) => Promise<ListeningOutcome<ListeningLibrary>>;
  sendFeedback: (
    childId: ChildId,
    params: { storyId: string; action: ListeningFeedbackAction },
    options?: { signal?: AbortSignal },
  ) => Promise<ListeningOutcome<unknown>>;
  preview: (
    childId: ChildId,
    params: { storyId: string; room?: "living_room" | "cinema" },
    options?: { signal?: AbortSignal },
  ) => Promise<ListeningOutcome<ListeningPreview>>;
  confirmPlay: (
    childId: ChildId,
    params: { confirmationToken: string },
    options?: { signal?: AbortSignal },
  ) => Promise<ListeningOutcome<{ title: string; room: string; chapterIndex: number }>>;
  refreshNow: (childId: ChildId, options?: { signal?: AbortSignal }) => Promise<ListeningOutcome<ListeningNowPlaying>>;
  reset: () => void;
};

export function createListeningClient(deps: ListeningClientDeps = {}): ListeningClient {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  let cached: ChildBridgeSessionInfo | null = null;

  async function session(childId: ChildId, signal: AbortSignal | undefined, force: boolean) {
    const usable =
      !force &&
      cached !== null &&
      cached.child === childId &&
      cached.expiresAt - now() > SESSION_REFRESH_MARGIN_MS;
    if (usable && cached) return cached;
    // Same surface session as the conversation ("ipad"), so a confirmation
    // minted here is bound to the same session key the spoken flow uses.
    const response = await doFetch(SESSION_MINT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childId, sessionSuffix: "ipad" }),
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return null;
    const info = readSessionInfo(await response.json());
    if (!info || info.child !== childId) return null;
    cached = info;
    return info;
  }

  async function call<T>(
    childId: ChildId,
    endpoint: string,
    options: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
    parse: (value: unknown) => T | null,
  ): Promise<ListeningOutcome<T>> {
    let info = await session(childId, options.signal, false).catch(() => null);
    if (!info) return { ok: false, failure: "no-session" };
    const request = (target: ChildBridgeSessionInfo) =>
      doFetch(`${readBridgeOrigin(target.bridgeUrl)}${LISTENING_BASE_PATH}/${endpoint}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${target.token}`,
          ...(options.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.method === "POST" ? { body: JSON.stringify(options.body ?? {}) } : {}),
        cache: "no-store",
        ...(options.signal ? { signal: options.signal } : {}),
      });
    let response: Response;
    try {
      response = await request(info);
      if (response.status === 401) {
        const refreshed = await session(childId, options.signal, true).catch(() => null);
        if (!refreshed) return { ok: false, failure: "no-session" };
        info = refreshed;
        response = await request(info);
      }
    } catch {
      return { ok: false, failure: "network" };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, failure: "bad-response" };
    }
    if (!response.ok) {
      const message = isRecord(body) && isRecord(body.error) ? readText(body.error.message, 200) : "";
      return { ok: false, failure: "refused", ...(message ? { message } : {}) };
    }
    const parsed = parse(body);
    return parsed === null ? { ok: false, failure: "bad-response" } : { ok: true, value: parsed };
  }

  return {
    reset() {
      cached = null;
    },
    loadLibrary: (childId, options = {}) =>
      call(childId, "library", { method: "GET", ...(options.signal ? { signal: options.signal } : {}) }, (value) =>
        readListeningLibrary(value, childId),
      ),
    sendFeedback: (childId, params, options = {}) =>
      call(
        childId,
        "feedback",
        { method: "POST", body: params, ...(options.signal ? { signal: options.signal } : {}) },
        (value) => value ?? {},
      ),
    preview: (childId, params, options = {}) =>
      call(
        childId,
        "preview",
        { method: "POST", body: params, ...(options.signal ? { signal: options.signal } : {}) },
        readListeningPreview,
      ),
    confirmPlay: (childId, params, options = {}) =>
      call(
        childId,
        "play",
        { method: "POST", body: params, ...(options.signal ? { signal: options.signal } : {}) },
        (value) => {
          if (!isRecord(value) || !isRecord(value.started)) return null;
          return {
            title: readText(value.started.title),
            room: readText(value.started.room, 40),
            chapterIndex: typeof value.started.chapterIndex === "number" ? value.started.chapterIndex : 0,
          };
        },
      ),
    refreshNow: (childId, options = {}) =>
      call(
        childId,
        "now",
        { method: "GET", ...(options.signal ? { signal: options.signal } : {}) },
        // `null` playing is a valid answer, so wrap it to distinguish from a
        // parse failure.
        (value) => ({ playing: readListeningNow(value) }),
      ).then((outcome) =>
        outcome.ok ? { ok: true as const, value: outcome.value.playing } : outcome,
      ),
  };
}
