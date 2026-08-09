/**
 * Choosing the image a staged web recipe is stored with (Kitchen DESIGN.md
 * §4.3, "Shelf presentation contract").
 *
 * The old rule was "take the first value of Recipe JSON-LD `image`". On the two
 * sources that hurt most that is the *smallest* rendition the page publishes:
 *
 *   Cookie and Kate ships `image: [ …-225x225.jpg, …-260x195.jpg,
 *     …-320x180.jpg, ….jpg ]` — the original is last
 *   BBC Good Food ships cropped `resize=` renditions and a much wider `srcset`
 *
 * So the shelf ended up with 225×225 thumbnails stretched across a 4:3 card.
 *
 * The contract here is deliberately narrow:
 *
 *   1. Collect candidates that are *the same photograph* — every structured
 *      image value, then Open Graph / `srcset` / the un-suffixed original, but
 *      only when they share the structured image's identity. A page's social
 *      card can be a logo; a bigger picture of the wrong thing is not a fix.
 *   2. Download and measure the real pixel size of each. Declared `width` /
 *      `height` in JSON-LD is a hint for ordering only — never evidence.
 *   3. Keep the largest that clears the floor. Nothing is ever resized, so a
 *      small thumbnail can never be presented as full card artwork; if the only
 *      renditions are undersized the image is refused and the idea is skipped.
 *
 * Pure and injectable: the download step is a parameter, so the whole selection
 * is testable without network access.
 */

import { readImageDimensions } from "./image-dimensions.ts";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Below this an image is not card artwork. The planner card is a 4:3 tile up to
 * roughly 400 CSS px wide, so a 225×225 thumbnail is both too small and the
 * wrong shape — it can only be shown by stretching it.
 */
export const MIN_CARD_IMAGE = { width: 400, height: 300 } as const;

/**
 * Past this width an image is a print-resolution original: worth preferring a
 * smaller rendition of the same photo rather than paying storage and transfer
 * for pixels no card will ever use. Only used when a smaller one qualifies.
 */
export const MAX_STORE_WIDTH = 2400;

/** Downloads attempted per recipe. Ordering below decides which ones. */
export const MAX_IMAGE_CANDIDATES = 6;

/** A recipe photo larger than this is not a recipe photo. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Anything smaller than this is an error page or a tracking pixel. */
export const MIN_IMAGE_BYTES = 1024;

/**
 * Ordering weight for a candidate whose width nothing declares. An un-suffixed
 * WordPress upload and an Open Graph card are usually the largest renditions on
 * the page, so "unknown" ranks ahead of a declared 900px variant but behind a
 * declared 1600px one.
 */
const ASSUMED_UNKNOWN_WIDTH = 1400;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ImageCandidateOrigin = "structured" | "og" | "srcset" | "original";

export type ImageCandidate = {
  url: string;
  from: ImageCandidateOrigin;
  /** Declared width, used only to order the download attempts. */
  hintWidth: number | null;
  hintHeight: number | null;
};

export type DownloadedImage = {
  bytes: Uint8Array;
  contentType: string;
};

export type MeasuredImage = DownloadedImage & {
  url: string;
  from: ImageCandidateOrigin;
  width: number;
  height: number;
};

export type ImageCandidateOutcome =
  | "chosen"
  | "passed-over"
  | "too-small"
  | "unreadable"
  | "not-an-image"
  | "unavailable";

export type ImageSelection = {
  chosen: MeasuredImage | null;
  considered: {
    url: string;
    from: ImageCandidateOrigin;
    outcome: ImageCandidateOutcome;
    width?: number;
    height?: number;
  }[];
};

// ---------------------------------------------------------------------------
// URL identity
// ---------------------------------------------------------------------------

/** `…/photo-1024x768.jpg` → `…/photo.jpg`. The WordPress rendition convention. */
const WORDPRESS_SIZE_SUFFIX = /-(\d{2,5})x(\d{2,5})(?=\.[a-z0-9]{2,5}$)/i;

/**
 * The identity of the *photograph* behind a URL: origin + path, with any
 * rendition suffix and every query parameter dropped.
 *
 * This is what makes it safe to pull extra candidates out of Open Graph tags
 * and `srcset` attributes. `…/dahl.jpg?resize=440,400` and
 * `…/dahl.jpg?resize=900,817` are the same picture at two sizes;
 * `…/site-logo.png` is not, and never becomes a candidate.
 */
export function imageIdentity(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const pathname = parsed.pathname.replace(WORDPRESS_SIZE_SUFFIX, "");
  return `${parsed.host.toLowerCase()}${pathname}`;
}

/** The un-suffixed, un-parameterised original this URL is a rendition of. */
export function originalImageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(WORDPRESS_SIZE_SUFFIX, "");
  return parsed.toString();
}

/**
 * A size hint read out of the URL itself: the WordPress `-WxH` suffix, or the
 * `resize=W,H` / `w=` / `width=` parameters CDNs use. Ordering only.
 */
export function dimensionHintFromUrl(url: string): { width: number | null; height: number | null } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { width: null, height: null };
  }

  const suffix = WORDPRESS_SIZE_SUFFIX.exec(parsed.pathname);
  if (suffix) return { width: Number(suffix[1]), height: Number(suffix[2]) };

  const resize = parsed.searchParams.get("resize");
  if (resize) {
    const [w, h] = resize.split(",").map((part) => Number.parseInt(part.trim(), 10));
    if (Number.isFinite(w)) return { width: w, height: Number.isFinite(h) ? h : null };
  }
  for (const key of ["w", "width", "wid"]) {
    const value = parsed.searchParams.get(key);
    const parsedWidth = value ? Number.parseInt(value, 10) : NaN;
    if (Number.isFinite(parsedWidth)) return { width: parsedWidth, height: null };
  }
  return { width: null, height: null };
}

// ---------------------------------------------------------------------------
// srcset
// ---------------------------------------------------------------------------

/**
 * Parse a `srcset` attribute into its candidates.
 *
 * Written as a token walk rather than a split on commas because the URLs these
 * sources publish contain commas themselves — BBC Good Food ships
 * `…?crop=3px,23px,895px,813px&resize=440,400 440w,https://…`, which a naive
 * `split(",")` shreds into nonsense. Descriptors are whitespace-separated from
 * their URL, so tokenising on whitespace is the reliable seam.
 */
export function parseSrcset(value: string | null | undefined): { url: string; width: number | null }[] {
  const tokens = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const out: { url: string; width: number | null }[] = [];
  let pending: string | null = null;

  const flush = (url: string | null, width: number | null) => {
    const cleaned = (url ?? "").replace(/^,+/, "").replace(/,+$/, "");
    if (cleaned && !cleaned.startsWith("data:")) out.push({ url: cleaned, width });
  };

  for (const token of tokens) {
    // "440w" or "2x", optionally carrying the separator to the next candidate.
    const descriptorOnly = /^(\d+(?:\.\d+)?)([wx]),?$/.exec(token);
    if (descriptorOnly && pending !== null) {
      flush(pending, descriptorOnly[2] === "w" ? Number(descriptorOnly[1]) : null);
      pending = null;
      continue;
    }
    // "440w,https://…" — no whitespace after the separating comma.
    const descriptorThenUrl = /^(\d+(?:\.\d+)?)([wx]),(.+)$/.exec(token);
    if (descriptorThenUrl && pending !== null) {
      flush(pending, descriptorThenUrl[2] === "w" ? Number(descriptorThenUrl[1]) : null);
      pending = descriptorThenUrl[3];
      continue;
    }
    // A new URL while one is still pending means that one had no descriptor.
    if (pending !== null) flush(pending, null);
    pending = token;
  }
  if (pending !== null) flush(pending, null);

  return out;
}

// ---------------------------------------------------------------------------
// Candidate collection
// ---------------------------------------------------------------------------

type StructuredImageValue = { url: string; width: number | null; height: number | null };

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Flatten a Recipe JSON-LD `image` value into every URL it offers, keeping any
 * declared size. Strings, arrays, `ImageObject`s and nested combinations of the
 * three all appear in the wild.
 */
export function flattenStructuredImage(value: unknown, out: StructuredImageValue[] = []): StructuredImageValue[] {
  if (!value) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push({ url: value.trim(), width: null, height: null });
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStructuredImage(item, out);
    return out;
  }
  if (typeof value !== "object") return out;

  const object = value as Record<string, unknown>;
  const url = typeof object.url === "string" ? object.url : typeof object.contentUrl === "string" ? object.contentUrl : null;
  if (url && url.trim()) {
    out.push({ url: url.trim(), width: finiteOrNull(object.width), height: finiteOrNull(object.height) });
  }
  // `thumbnailUrl` is a legitimate extra rendition; identity filtering keeps it
  // honest, and it is only ever chosen if it measures largest, which it will not.
  if (typeof object.thumbnailUrl === "string" && object.thumbnailUrl.trim()) {
    out.push({ url: object.thumbnailUrl.trim(), width: null, height: null });
  }
  return out;
}

function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const match = re.exec(html);
  return match ? decodeEntities(match[1]).trim() || null : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absolute(url: string, pageUrl: string | null): string | null {
  try {
    return pageUrl ? new URL(url, pageUrl).toString() : new URL(url).toString();
  } catch {
    return null;
  }
}

export type CollectImageCandidatesInput = {
  /** The raw Recipe JSON-LD `image` value, whatever shape it arrived in. */
  structuredImage?: unknown;
  /** Extra source-specific renditions, e.g. FOOBY's `images.large`/`medium`. */
  extraImages?: readonly (string | null | undefined)[];
  /** The recipe page HTML, for Open Graph tags and `srcset` attributes. */
  html?: string | null;
  /** Base for resolving relative URLs. */
  pageUrl?: string | null;
};

/**
 * Every trustworthy rendition of the recipe's photograph, best first.
 *
 * "Trustworthy" is the identity rule: page metadata only contributes when it
 * points at the same photo the structured data already named. When a page has
 * no structured image at all, Open Graph is allowed to stand alone — that is
 * the only image claim the page makes.
 */
export function collectImageCandidates(input: CollectImageCandidatesInput): ImageCandidate[] {
  const pageUrl = input.pageUrl ?? null;
  const html = input.html ?? "";

  const structured: StructuredImageValue[] = [
    ...flattenStructuredImage(input.structuredImage),
    ...(input.extraImages ?? [])
      .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      .map((url) => ({ url: url.trim(), width: null, height: null })),
  ];

  const candidates: ImageCandidate[] = [];
  const seen = new Set<string>();
  const identities = new Set<string>();

  const add = (rawUrl: string | null | undefined, from: ImageCandidateOrigin, width: number | null, height: number | null) => {
    if (!rawUrl) return;
    const url = absolute(decodeEntities(rawUrl), pageUrl);
    if (!url || seen.has(url)) return;
    if (!/^https?:$/.test(new URL(url).protocol)) return;
    seen.add(url);
    const hint = dimensionHintFromUrl(url);
    candidates.push({
      url,
      from,
      hintWidth: width ?? hint.width,
      hintHeight: height ?? hint.height,
    });
  };

  for (const value of structured) {
    const url = absolute(decodeEntities(value.url), pageUrl);
    if (url) identities.add(imageIdentity(url) ?? url);
    add(value.url, "structured", value.width, value.height);
  }

  const sharesIdentity = (url: string): boolean => {
    const identity = imageIdentity(url);
    return identity !== null && identities.has(identity);
  };

  // Open Graph / Twitter cards. Allowed to stand alone only when the page made
  // no structured image claim at all.
  const metaUrls = [
    metaContent(html, "og:image:secure_url"),
    metaContent(html, "og:image"),
    metaContent(html, "twitter:image"),
  ].filter((value): value is string => Boolean(value));
  for (const raw of metaUrls) {
    const url = absolute(decodeEntities(raw), pageUrl);
    if (!url) continue;
    if (identities.size === 0) {
      identities.add(imageIdentity(url) ?? url);
      add(raw, "og", null, null);
      continue;
    }
    if (sharesIdentity(url)) add(raw, "og", null, null);
  }

  // `srcset` renditions of the same photograph — this is where BBC Good Food
  // keeps everything wider than the cropped 440px variant its JSON-LD names.
  if (html) {
    for (const match of html.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
      for (const entry of parseSrcset(decodeEntities(match[1]))) {
        const url = absolute(entry.url, pageUrl);
        if (!url || !sharesIdentity(url)) continue;
        add(entry.url, "srcset", entry.width, null);
      }
    }
  }

  // The un-suffixed, un-parameterised original behind each known rendition.
  for (const identity of [...identities]) {
    const source = candidates.find((candidate) => (imageIdentity(candidate.url) ?? candidate.url) === identity);
    if (!source) continue;
    add(originalImageUrl(source.url), "original", null, null);
  }

  return orderCandidates(candidates);
}

const ORIGIN_RANK: Record<ImageCandidateOrigin, number> = {
  original: 0,
  structured: 1,
  og: 2,
  srcset: 3,
};

/**
 * Widest-declared first, with unknown widths treated as probably-original.
 * Deterministic all the way down so the same page always produces the same
 * download order — and therefore the same stored image.
 */
function orderCandidates(candidates: readonly ImageCandidate[]): ImageCandidate[] {
  return [...candidates].sort((a, b) => {
    const aw = a.hintWidth ?? ASSUMED_UNKNOWN_WIDTH;
    const bw = b.hintWidth ?? ASSUMED_UNKNOWN_WIDTH;
    if (aw !== bw) return bw - aw;
    if (ORIGIN_RANK[a.from] !== ORIGIN_RANK[b.from]) return ORIGIN_RANK[a.from] - ORIGIN_RANK[b.from];
    return a.url.localeCompare(b.url);
  });
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function clearsFloor(image: { width: number; height: number }): boolean {
  return image.width >= MIN_CARD_IMAGE.width && image.height >= MIN_CARD_IMAGE.height;
}

/**
 * Is `a` the better stored image than `b`?
 *
 * Larger wins, except that a print-resolution original loses to any qualifying
 * rendition that is not oversized — the card cannot use those pixels and the
 * blob store pays for them.
 */
export function isBetterImage(a: MeasuredImage, b: MeasuredImage | null): boolean {
  if (!b) return true;
  const aOversized = a.width > MAX_STORE_WIDTH;
  const bOversized = b.width > MAX_STORE_WIDTH;
  if (aOversized !== bOversized) return bOversized;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA !== areaB) return aOversized ? areaA < areaB : areaA > areaB;
  return a.url.localeCompare(b.url) < 0;
}

/**
 * Download the candidates and keep the best one that is genuinely large enough.
 *
 * `download` returns the bytes or `null` for anything it could not fetch; it is
 * a parameter so the whole rule is testable without network access.
 */
export async function selectRecipeImage(
  candidates: readonly ImageCandidate[],
  download: (url: string) => Promise<DownloadedImage | null>,
  options: { limit?: number } = {},
): Promise<ImageSelection> {
  const limit = options.limit ?? MAX_IMAGE_CANDIDATES;
  const considered: ImageSelection["considered"] = [];
  let best: MeasuredImage | null = null;

  for (const candidate of candidates.slice(0, limit)) {
    let downloaded: DownloadedImage | null = null;
    try {
      downloaded = await download(candidate.url);
    } catch {
      downloaded = null;
    }
    if (!downloaded) {
      considered.push({ url: candidate.url, from: candidate.from, outcome: "unavailable" });
      continue;
    }
    if (!downloaded.contentType.toLowerCase().startsWith("image/")) {
      considered.push({ url: candidate.url, from: candidate.from, outcome: "not-an-image" });
      continue;
    }
    if (downloaded.bytes.length < MIN_IMAGE_BYTES || downloaded.bytes.length > MAX_IMAGE_BYTES) {
      considered.push({ url: candidate.url, from: candidate.from, outcome: "unavailable" });
      continue;
    }

    const size = readImageDimensions(downloaded.bytes);
    if (!size) {
      considered.push({ url: candidate.url, from: candidate.from, outcome: "unreadable" });
      continue;
    }
    if (!clearsFloor(size)) {
      considered.push({
        url: candidate.url,
        from: candidate.from,
        outcome: "too-small",
        width: size.width,
        height: size.height,
      });
      continue;
    }

    const measured: MeasuredImage = {
      ...downloaded,
      url: candidate.url,
      from: candidate.from,
      width: size.width,
      height: size.height,
    };
    considered.push({
      url: candidate.url,
      from: candidate.from,
      outcome: "passed-over",
      width: size.width,
      height: size.height,
    });
    if (isBetterImage(measured, best)) best = measured;
  }

  if (best) {
    const record = considered.find((entry) => entry.url === best!.url);
    if (record) record.outcome = "chosen";
  }

  return { chosen: best, considered };
}
