// Pure, browser-safe half of the New plays mirror: types, row normalization,
// action-request validation, and display helpers. No database import, so the
// client page can use it without pulling libsql into the bundle. The full
// module (`./music-new-plays.ts`) re-exports everything here and adds the
// persistence functions.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NewPlayFeedback = { type: string; at: string; context: string | null };

/**
 * Public feedback vocabulary. The domain ledger keeps internal event names
 * (`explicit_love`, `not_for_context`); the projection already maps them, and
 * this map is the UI-side belt so a row from an older producer still renders
 * "Loved" / "Wrong context" instead of a raw internal token.
 */
export const PUBLIC_FEEDBACK_TYPES: Readonly<Record<string, string>> = Object.freeze({
  explicit_love: "love",
  not_for_context: "wrong_context",
  love: "love",
  more_like_this: "more_like_this",
  wrong_context: "wrong_context",
  not_for_me: "not_for_me",
});

export function publicFeedbackType(type: string | null | undefined): string | null {
  if (!type) return null;
  const key = type.trim().toLowerCase();
  return PUBLIC_FEEDBACK_TYPES[key] ?? key;
}

export function feedbackLabel(feedback: NewPlayFeedback | null | undefined): string | null {
  if (!feedback) return null;
  switch (publicFeedbackType(feedback.type)) {
    case "love":
      return "Loved";
    case "more_like_this":
      return "More like this";
    case "wrong_context":
      return `Wrong context${feedback.context ? ` (${feedback.context})` : ""}`;
    case "not_for_me":
      return "Not for me";
    default:
      return feedback.type;
  }
}

export function feedbackTone(type: string | null | undefined): "green" | "blue" | "amber" | "red" | "stone" {
  switch (publicFeedbackType(type)) {
    case "love":
      return "green";
    case "more_like_this":
      return "blue";
    case "wrong_context":
      return "amber";
    case "not_for_me":
      return "red";
    default:
      return "stone";
  }
}

export type NewPlayRow = {
  playId: string;
  /** ISO timestamp of the play. */
  playedAt: string;
  room: string | null;
  requestContext: {
    intent?: string | null;
    context: string | null;
    genre?: string | null;
    query?: string | null;
    source?: string | null;
  };
  name: string | null;
  artist: string | null;
  /** "album" | "playlist" | ... — rendered verbatim. */
  type: string | null;
  appleId: string | null;
  playbackUri: string | null;
  url: string | null;
  releaseYear: number | null;
  genres: string[];
  artwork: { url: string; width?: number; height?: number } | null;
  noveltyKind: string;
  source: string | null;
  reason: string | null;
  confidence: number | null;
  announced: boolean;
  feedback: NewPlayFeedback | null;
  feedbackHistory: NewPlayFeedback[];
  /** "in-library" | "not-in-library" | "add-pending" | "add-failed" | "unknown" */
  libraryState: string;
  profileState: { approved: boolean; contexts: string[]; at?: string };
  reviewed: boolean;
};

export const NEW_PLAY_ACTIONS = [
  "love",
  "more_like_this",
  "wrong_context",
  "not_for_me",
  "add_to_apple_library",
  "approve_for_context",
] as const;

export type NewPlayAction = (typeof NEW_PLAY_ACTIONS)[number];

/** Actions that only make sense against a specific request context. */
const CONTEXT_REQUIRED_ACTIONS: ReadonlySet<NewPlayAction> = new Set([
  "wrong_context",
  "approve_for_context",
]);

export type NewPlayActionRequest = {
  playId: string;
  action: NewPlayAction;
  context?: string | null;
};

export type NewPlayActionStatus = "pending" | "applied" | "failed";

export type NewPlayActionRecord = {
  id: string;
  playId: string;
  action: NewPlayAction;
  context: string | null;
  requestedAt: string;
  requestedBy: string;
  status: NewPlayActionStatus;
  resultMessage: string | null;
  resultCode: string | null;
  eventId: string | null;
  appliedAt: string | null;
};

export type NewPlayPendingAction = {
  id: string;
  action: NewPlayAction;
  context: string | null;
  requestedAt: string;
  status: NewPlayActionStatus;
  resultMessage: string | null;
};

export type NewPlayListItem = NewPlayRow & { pendingActions: NewPlayPendingAction[] };

export type NewPlayActionAckResult = {
  id: string;
  ok: boolean;
  message?: string | null;
  code?: string | null;
  eventId?: string | null;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.trim().toLowerCase());
  if (typeof value === "number") return value !== 0;
  return false;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? asString(entry) : null))
    .filter((entry): entry is string => entry !== null);
}

function asFeedback(value: unknown): NewPlayFeedback | null {
  if (!isRecord(value)) return null;
  const type = asString(value.type);
  const at = asString(value.at);
  if (!type || !at) return null;
  return { type: publicFeedbackType(type) ?? type, at, context: asString(value.context) };
}

function asArtwork(value: unknown): NewPlayRow["artwork"] {
  if (typeof value === "string") {
    const url = asString(value);
    return url ? { url } : null;
  }
  if (!isRecord(value)) return null;
  const url = asString(value.url);
  if (!url) return null;
  const artwork: NonNullable<NewPlayRow["artwork"]> = { url };
  const width = asInteger(value.width);
  const height = asInteger(value.height);
  if (width !== null && width > 0) artwork.width = width;
  if (height !== null && height > 0) artwork.height = height;
  return artwork;
}

/**
 * Coerce a pushed projection row into the shape the page renders.
 *
 * Throws on a missing `playId` or `playedAt` — both are identity, and a row
 * without them cannot be mirrored or acted on. Everything else is coerced
 * defensively so a slightly different producer version never breaks the list.
 */
export function normalizeNewPlayRow(input: unknown): NewPlayRow {
  if (!isRecord(input)) throw new Error("Row must be an object");

  const playId = asString(input.playId ?? input.play_id);
  if (!playId) throw new Error("Row is missing playId");

  const playedAtRaw = asString(input.playedAt ?? input.played_at);
  if (!playedAtRaw) throw new Error(`Row ${playId} is missing playedAt`);
  const playedAtMs = Date.parse(playedAtRaw);
  if (!Number.isFinite(playedAtMs)) throw new Error(`Row ${playId} has an invalid playedAt`);
  const playedAt = new Date(playedAtMs).toISOString();

  const contextInput = isRecord(input.requestContext) ? input.requestContext : {};
  const requestContext: NewPlayRow["requestContext"] = {
    intent: asString(contextInput.intent),
    context: asString(contextInput.context),
    genre: asString(contextInput.genre),
    query: asString(contextInput.query),
    source: asString(contextInput.source),
  };

  const profileInput = isRecord(input.profileState) ? input.profileState : {};
  const profileState: NewPlayRow["profileState"] = {
    approved: asBoolean(profileInput.approved),
    contexts: asStringArray(profileInput.contexts),
  };
  const profileAt = asString(profileInput.at);
  if (profileAt) profileState.at = profileAt;

  const feedbackHistory = Array.isArray(input.feedbackHistory)
    ? input.feedbackHistory
        .map((entry) => asFeedback(entry))
        .filter((entry): entry is NewPlayFeedback => entry !== null)
    : [];

  return {
    playId,
    playedAt,
    room: asString(input.room),
    requestContext,
    name: asString(input.name),
    artist: asString(input.artist),
    type: asString(input.type),
    appleId: asString(input.appleId),
    playbackUri: asString(input.playbackUri),
    url: asString(input.url),
    releaseYear: asInteger(input.releaseYear),
    genres: asStringArray(input.genres),
    artwork: asArtwork(input.artwork),
    noveltyKind: asString(input.noveltyKind) ?? "unknown",
    source: asString(input.source),
    reason: asString(input.reason),
    confidence: asNumber(input.confidence),
    announced: asBoolean(input.announced),
    feedback: asFeedback(input.feedback),
    feedbackHistory,
    libraryState: asString(input.libraryState) ?? "unknown",
    profileState,
    reviewed: asBoolean(input.reviewed),
  };
}

export type ValidatedActionRequest =
  | { ok: true; value: NewPlayActionRequest }
  | { ok: false; error: string };

/**
 * Validate an action request from the browser (or anyone else).
 *
 * `wrong_context` and `approve_for_context` fail closed without a non-empty
 * context: the domain applies them per context, and an unscoped one would
 * have to guess. Apple-library and profile approval are deliberately
 * separate actions; there is no combined one.
 */
export function validateActionRequest(input: unknown): ValidatedActionRequest {
  if (!isRecord(input)) return { ok: false, error: "Request body must be an object" };

  const playId = asString(input.playId);
  if (!playId) return { ok: false, error: "playId is required" };

  const action = asString(input.action);
  if (!action) return { ok: false, error: "action is required" };
  if (!(NEW_PLAY_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: `Unknown action: ${action}` };
  }
  const typedAction = action as NewPlayAction;

  if (input.context !== undefined && input.context !== null && typeof input.context !== "string") {
    return { ok: false, error: "context must be a string when provided" };
  }
  const context = asString(input.context);

  if (CONTEXT_REQUIRED_ACTIONS.has(typedAction) && !context) {
    return { ok: false, error: `${typedAction} requires a non-empty context` };
  }

  return { ok: true, value: { playId, action: typedAction, context } };
}

/**
 * Resolve an Apple artwork URL template (`{w}`/`{h}` placeholders) to a
 * concrete square size. Non-template URLs pass through unchanged.
 */
export function artworkUrl(artwork: NewPlayRow["artwork"], size = 300): string | null {
  if (!artwork?.url) return null;
  const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 300;
  return artwork.url.replace(/\{w\}/g, String(px)).replace(/\{h\}/g, String(px));
}

const INTENT_LABELS: Record<string, string> = {
  play: "Play music",
  play_music: "Play music",
  dj: "DJ",
  dj_session: "DJ session",
  context: "Play music",
  genre: "Play genre",
  request: "Request",
};

function intentLabel(intent: string | null | undefined): string {
  if (!intent) return "Play music";
  const key = intent.trim().toLowerCase();
  if (INTENT_LABELS[key]) return INTENT_LABELS[key];
  return key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Short human string for what was asked when this play happened, e.g.
 * "Play music · daytime · Living Room" or "Play genre · jazz · dinner".
 */
export function summarizeRequest(row: Pick<NewPlayRow, "requestContext" | "room">): string {
  const ctx = row.requestContext ?? { context: null };
  const parts: string[] = [intentLabel(ctx.intent)];
  if (ctx.genre) parts.push(ctx.genre);
  if (ctx.query && ctx.query !== ctx.genre) parts.push(`"${ctx.query}"`);
  if (ctx.context) parts.push(ctx.context);
  if (row.room) parts.push(row.room);
  return parts.join(" · ");
}
