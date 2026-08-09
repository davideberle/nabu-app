/**
 * Read the real pixel dimensions of an encoded image from its bytes.
 *
 * The web importer has to know how large a candidate image *actually* is
 * before it persists it — a `225x225` WordPress thumbnail and a 1200px original
 * are indistinguishable by URL, and the declared `width`/`height` in Recipe
 * JSON-LD is frequently wrong or absent. Measuring the downloaded bytes is the
 * only claim that cannot drift.
 *
 * Deliberately dependency-free: it reads only the headers of each container, so
 * it never decodes pixels, never needs a native module, and can be imported by
 * `node --test`, the plain-JS importer, and the app alike. `sharp` would do the
 * same job with a native install step and a much larger surface for a question
 * this small.
 *
 * Returns `null` when the format is unknown or the header is truncated. Callers
 * treat that as "unmeasurable", which is a refusal — never a guess.
 */

export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "avif";

export type ImageDimensions = {
  width: number;
  height: number;
  format: ImageFormat;
};

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

function u32le(b: Uint8Array, at: number): number {
  return b[at] + (b[at + 1] << 8) + (b[at + 2] << 16) + ((b[at + 3] << 24) >>> 0);
}

function ascii(b: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = at; i < at + length && i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}

/** PNG: IHDR is always the first chunk, at a fixed offset. */
function readPng(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null;
  if (!(b[0] === 0x89 && ascii(b, 1, 3) === "PNG")) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20), format: "png" };
}

/** GIF87a/89a: little-endian logical screen size right after the signature. */
function readGif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  if (ascii(b, 0, 3) !== "GIF") return null;
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), format: "gif" };
}

/**
 * JPEG: walk the marker segments to the first Start-Of-Frame, which is the only
 * place the frame size is written. Progressive (`SOF2`) and the other SOF
 * variants carry it in the same layout; `DHT`/`DAC`/`RST`/`SOS` do not and are
 * skipped by length.
 */
function readJpeg(b: Uint8Array): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;
  while (at + 3 < b.length) {
    if (b[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = b[at + 1];
    // Padding fill bytes and the standalone markers carry no length field.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (at + 9 >= b.length) return null;
      return { height: u16be(b, at + 5), width: u16be(b, at + 7), format: "jpeg" };
    }
    // Entropy-coded data follows SOS; the frame header is always before it.
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

/** WebP: the simple (VP8), lossless (VP8L) and extended (VP8X) chunk layouts. */
function readWebp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);

  if (chunk === "VP8X") {
    // 24-bit little-endian, stored as (value - 1).
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width, height, format: "webp" };
  }
  if (chunk === "VP8 ") {
    // Key-frame header: 3-byte frame tag, 3-byte start code, then 14-bit sizes.
    if (b.length < 30) return null;
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
    return {
      width: (b[26] | (b[27] << 8)) & 0x3fff,
      height: (b[28] | (b[29] << 8)) & 0x3fff,
      format: "webp",
    };
  }
  if (chunk === "VP8L") {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
      format: "webp",
    };
  }
  return null;
}

/**
 * AVIF/HEIF: find the `ispe` (image spatial extents) box anywhere in the header
 * region. A full ISOBMFF walk would be more precise, but `ispe` has a fixed
 * 12-byte payload and appears before any media data, so a bounded scan of the
 * first chunk of the file is enough to answer "how big is this".
 */
function readAvif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const brand = ascii(b, 8, 4);
  if (!/^(avif|avis|mif1|msf1|heic|heix|hevc|heim)$/.test(brand)) return null;
  const limit = Math.min(b.length - 12, 65_536);
  for (let at = 0; at < limit; at++) {
    if (ascii(b, at, 4) !== "ispe") continue;
    // 4-byte version/flags, then two 32-bit extents.
    const width = u32be(b, at + 8);
    const height = u32be(b, at + 12);
    if (width > 0 && height > 0) return { width, height, format: "avif" };
  }
  return null;
}

/**
 * Measure an encoded image. Returns `null` for an unrecognised container or a
 * header too short to read — both mean "cannot be trusted as card artwork".
 */
export function readImageDimensions(input: Uint8Array | ArrayBuffer): ImageDimensions | null {
  const bytes = toBytes(input);
  if (bytes.length < 16) return null;
  return (
    readPng(bytes) ??
    readGif(bytes) ??
    readWebp(bytes) ??
    readAvif(bytes) ??
    readJpeg(bytes)
  );
}
