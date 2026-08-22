// The Family Assistant child-turn wire contract, as seen by the browser.
//
// This is the *client* half of the envelope defined by the tailnet bridge in
// `projects/family-assistant/openclaw-plugin/src/bridge/envelope.ts`. The two
// live in different repositories and cannot share a package, so this module is
// deliberately small, dependency-free, and isomorphic (no `node:` imports): it
// is imported by a client component.
//
// ## Why blocks, when today there is only text
//
// Phase 3 of the Family Assistant design adds Sonos candidate cards, generated
// explanatory images and routine/points projections. Those are NOT built in
// this milestone. But shipping `{ text: string }` now and changing it later
// would break every iPad already running the old bundle, so the reply is always
// an ordered list of blocks and the renderer already has the loop.
//
// ## The forward-compatibility rule
//
// Render the block types you know; never fail on one you do not.
// `readAssistantBlocks` maps an unrecognized entry to `{ type: "unknown" }`
// instead of throwing, so an older iPad talking to a newer bridge degrades to
// "shows the text, skips the card" rather than showing a child an error.

/** Envelope version this client understands. */
export const CHILD_TURN_ENVELOPE_VERSION = 1;

/** Longest utterance the bridge accepts. Mirrors the ingress contract. */
export const MAX_CHILD_TURN_CHARS = 4000;

/** Session suffix shape the bridge's token accepts. */
export const CHILD_SESSION_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** The two child agents. There is no third, and no "any child" value. */
export const CHILD_IDS = ["santiago", "isabel"] as const;
export type ChildId = (typeof CHILD_IDS)[number];

export function isChildId(value: unknown): value is ChildId {
  return typeof value === "string" && (CHILD_IDS as readonly string[]).includes(value);
}

export type ChildTurnStatus = "ok" | "error" | "timeout" | "busy" | "rejected";

// ---------------------------------------------------------------------------
// Bridge origin
// ---------------------------------------------------------------------------

/**
 * Loopback hostnames, as `URL.hostname` reports them (IPv6 keeps its brackets).
 *
 * Only these may be reached over plaintext HTTP: the traffic never leaves the
 * machine, so there is no wire to sniff.
 */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.trim().toLowerCase());
}

/**
 * Validates a bridge URL and reduces it to its origin, or `null`.
 *
 * The rule, enforced identically when the server mints a session and when the
 * browser reads one back:
 *
 *  - **`https:` for every non-loopback host.** The tailnet is private, but it is
 *    still a network: a plaintext hop would put a child's utterance and a live
 *    bearer token on the wire for anything else on the tailnet to read. The Mac
 *    mini's `tailscale cert` material exists precisely so this is not a
 *    tradeoff.
 *  - **`http:` only for loopback**, which is how a local acceptance run and the
 *    `bridge-probe.mjs` checks talk to a bridge on the same machine.
 *
 * Everything past the origin is dropped: the bridge owns its own paths, and a
 * stray path here would silently produce 404s.
 */
export function readBridgeOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol === "https:") return parsed.origin;
  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) return parsed.origin;
  return null;
}

export type AssistantBlock =
  | { type: "text"; text: string }
  /**
   * A media candidate or choice. `imageUrl` is optional artwork; it is https
   * only, checked here rather than trusted, because this is the last hop before
   * a shared iPad loads it.
   */
  | { type: "card"; title: string; subtitle?: string; meta?: string; imageUrl?: string }
  /** Reserved for Phase 3. */
  | { type: "image"; url: string; alt: string }
  /** A block this build does not understand. Renderers skip it silently. */
  | { type: "unknown"; raw: unknown };

export type ChildTurnEnvelope = {
  v: number;
  status: ChildTurnStatus;
  child: string;
  blocks: AssistantBlock[];
  meta: { requestId: string; durationMs?: number };
  error?: { code: string; message: string; retryable?: boolean };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Plain-text normalization
// ---------------------------------------------------------------------------

/**
 * Strips the markdown emphasis markers a general-purpose model emits by habit.
 *
 * ## Why this is a strip and not a renderer
 *
 * The child surface renders replies as text nodes and speaks them through
 * `SpeechSynthesisUtterance`. Both are safe by construction: nothing the agent
 * says can become an element on the page. Teaching the surface to *render*
 * markdown would trade that away — it means an HTML seam, and the reply is
 * model output on a page a seven-year-old uses unsupervised. So the answer to
 * "a child sees `**3 apples**`" is to remove the markers, not to honour them.
 * There is deliberately no `dangerouslySetInnerHTML` and no HTML renderer
 * anywhere on this path.
 *
 * ## What it touches
 *
 * Emphasis pairs (`**`, `__`, `*`, `_`, `~~`), inline code backticks, and
 * leading ATX heading hashes. Nothing else: list markers, punctuation, links
 * and the agent's own line breaks pass through unchanged, because they read
 * correctly both on screen and aloud.
 *
 * Every rule is a single bounded pass — no loop, no re-scan, no backtracking
 * over nested alternations — so a long reply cannot turn this into a stall.
 *
 * ## What it must not break
 *
 * `snake_case`, `2 * 3`, and a bare `*` all survive: a marker only counts when
 * it is delimited by a non-word character and wraps non-space content. Only
 * lookaheads are used; a lookbehind would be cleaner to read but is not safe to
 * assume on an older iPad's Safari.
 */
export function plainTextForChild(raw: string): string {
  return raw
    .replace(/\*\*([^*\n]*[^*\s\n]|[^*\s\n])\*\*/g, "$1")
    .replace(/__([^_\n]*[^_\s\n]|[^_\s\n])__/g, "$1")
    .replace(/~~([^~\n]*[^~\s\n]|[^~\s\n])~~/g, "$1")
    .replace(/(^|[^\w*])\*([^*\s\n][^*\n]*[^*\s\n]|[^*\s\n])\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\s\n][^_\n]*[^_\s\n]|[^_\s\n])_(?![\w_])/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
}

/**
 * Parses an untrusted `blocks` array.
 *
 * Never throws, never drops an entry. This one function is the whole
 * forward-compatibility guarantee.
 *
 * Text is normalized here, at the single point where a reply enters the app, so
 * the rendered bubble and the spoken sentence cannot drift apart: there is no
 * path that reads a block's text without going through this.
 */
export function readAssistantBlocks(value: unknown): AssistantBlock[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry): AssistantBlock => {
    if (!isRecord(entry)) return { type: "unknown", raw: entry };
    if (entry.type === "text" && typeof entry.text === "string") {
      return { type: "text", text: plainTextForChild(entry.text) };
    }
    if (entry.type === "card" && typeof entry.title === "string") {
      return {
        type: "card",
        title: plainTextForChild(entry.title),
        ...(typeof entry.subtitle === "string" ? { subtitle: plainTextForChild(entry.subtitle) } : {}),
        ...(typeof entry.meta === "string" ? { meta: plainTextForChild(entry.meta) } : {}),
        // Artwork is optional and https-only. A card with a rejected image URL
        // still renders — the picture is decoration, the title is the choice.
        ...(typeof entry.imageUrl === "string" && entry.imageUrl.startsWith("https://")
          ? { imageUrl: entry.imageUrl }
          : {}),
      };
    }
    if (entry.type === "image" && typeof entry.url === "string" && typeof entry.alt === "string") {
      return { type: "image", url: entry.url, alt: entry.alt };
    }
    return { type: "unknown", raw: entry };
  });
}

function readStatus(value: unknown): ChildTurnStatus | null {
  return value === "ok" || value === "error" || value === "timeout" || value === "busy" || value === "rejected"
    ? value
    : null;
}

/**
 * Normalizes an untrusted bridge response.
 *
 * Fails closed in the only way that matters to a child: a body that is not a
 * recognizable envelope, or an `ok` status with no renderable text, becomes an
 * `error` envelope rather than an empty answer bubble.
 */
export function parseChildTurnEnvelope(value: unknown): ChildTurnEnvelope {
  const record = isRecord(value) ? value : {};
  const status = readStatus(record.status) ?? "error";
  const blocks = readAssistantBlocks(record.blocks);
  const meta = isRecord(record.meta) ? record.meta : {};
  const errorRecord = isRecord(record.error) ? record.error : null;
  const hasRenderable = blocks.some((block) => block.type !== "unknown");
  const effectiveStatus: ChildTurnStatus = status === "ok" && !hasRenderable ? "error" : status;

  return {
    v: typeof record.v === "number" ? record.v : CHILD_TURN_ENVELOPE_VERSION,
    status: effectiveStatus,
    child: typeof record.child === "string" ? record.child : "unknown",
    blocks,
    meta: {
      requestId: typeof meta.requestId === "string" ? meta.requestId : "unknown",
      ...(typeof meta.durationMs === "number" ? { durationMs: meta.durationMs } : {}),
    },
    ...(effectiveStatus === "ok"
      ? {}
      : {
          error: {
            code: typeof errorRecord?.code === "string" ? errorRecord.code : "turn_failed",
            message:
              typeof errorRecord?.message === "string" ? errorRecord.message : "the assistant did not answer",
            ...(typeof errorRecord?.retryable === "boolean" ? { retryable: errorRecord.retryable } : {}),
          },
        }),
  };
}

/** Concatenates the renderable text of an envelope, for speech and for aria. */
export function envelopeSpokenText(envelope: ChildTurnEnvelope): string {
  return envelope.blocks
    .filter((block): block is Extract<AssistantBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

/**
 * Child-facing wording for a failed turn.
 *
 * The bridge sends an adult-readable message; the UI owns what a seven- and a
 * ten-year-old actually see, so the mapping lives here rather than on the wire.
 * `null` means "use the bridge's own message", which only happens for the
 * validation failures an adult is meant to read.
 */
export function childFacingRecovery(envelope: ChildTurnEnvelope): string {
  const code = envelope.error?.code;
  switch (code) {
    case "busy":
      return "I'm still thinking about your last question — give me a moment and ask again.";
    case "timeout":
      return "That one took me too long. Try asking it again, maybe a bit shorter.";
    case "rate_limited":
      return "That's a lot of questions very fast! Let's take a breath and try again in a minute.";
    case "unauthorized":
      return "I lost my connection for a second. Tap to try again.";
    case "not_configured":
    case "upstream_unavailable":
      return "I can't reach my brain right now. Tell a grown-up, and try again in a bit.";
    case "too_large":
      return "That was a very long message! Try a shorter one.";
    default:
      return "Something went wrong while I was thinking. Try asking again.";
  }
}

/** True when retrying the same question could plausibly work. */
export function isRetryable(envelope: ChildTurnEnvelope): boolean {
  if (envelope.status === "ok") return false;
  if (envelope.error?.retryable === true) return true;
  return envelope.error?.code === "busy" || envelope.error?.code === "timeout";
}
