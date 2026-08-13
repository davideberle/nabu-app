#!/usr/bin/env node
/**
 * Generates the Family Assistant Home Screen icons:
 *   public/family-assistant-icon.png      (180x180, apple-touch-icon)
 *   public/family-assistant-icon-512.png  (512x512, manifest icon)
 *
 * Run manually (`node scripts/generate-family-assistant-icon.mjs`) when the
 * design changes; the PNGs are committed. Dependency-free: draws pixels and
 * encodes the PNG with node's own zlib.
 *
 * The drawing is the assistant's companion face: a warm amber-to-emerald
 * gradient orb (the two children's tints) with simple eyes and a smile, on the
 * app's cream background — matching the avatar the children already know.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [0xf5, 0xf3, 0xf0]; // app cream
  const amber = [0xf5, 0x9e, 0x0b]; // amber-500 (Santiago)
  const emerald = [0x10, 0xb9, 0x81]; // emerald-500 (Isabel)
  const dark = [0x29, 0x25, 0x24]; // stone-800

  const cx = size / 2;
  const cy = size / 2;
  const orbR = size * 0.36;
  const eyeR = size * 0.045;
  const eyeDx = size * 0.115;
  const eyeDy = size * 0.05;
  const smileR = size * 0.16;
  const smileW = size * 0.028;

  const put = (i, rgb, alphaMix = 1) => {
    px[i] = mix(px[i], rgb[0], alphaMix);
    px[i + 1] = mix(px[i + 1], rgb[1], alphaMix);
    px[i + 2] = mix(px[i + 2], rgb[2], alphaMix);
    px[i + 3] = 0xff;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      put(i, bg);
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);

      // Gradient orb, amber upper-left to emerald lower-right, soft edge.
      if (d < orbR + 1.5) {
        const t = Math.min(1, Math.max(0, (dx + dy + orbR * 2) / (orbR * 4)));
        const rgb = [
          mix(amber[0], emerald[0], t),
          mix(amber[1], emerald[1], t),
          mix(amber[2], emerald[2], t),
        ];
        const edge = Math.min(1, Math.max(0, orbR + 1.5 - d) / 1.5);
        put(i, rgb, edge);
      }

      // Eyes.
      for (const side of [-1, 1]) {
        const ed = Math.hypot(dx - side * eyeDx, dy + eyeDy);
        if (ed < eyeR + 1) put(i, dark, Math.min(1, Math.max(0, eyeR + 1 - ed)));
      }

      // Smile: lower arc of a circle centred slightly above mouth level, with
      // the arc ends faded by angle so they finish in soft round tips.
      const sy = dy - size * 0.02;
      const sd = Math.hypot(dx, sy);
      if (Math.abs(sd - smileR) < smileW) {
        const angle = Math.atan2(sy, dx); // 0..PI is the lower half
        const arcT = Math.min(1, Math.max(0, (angle - 0.45) / 0.25)) *
          Math.min(1, Math.max(0, (Math.PI - 0.45 - angle) / 0.25));
        if (arcT > 0) {
          const a = Math.min(1, (smileW - Math.abs(sd - smileR)) / (smileW * 0.5));
          put(i, dark, Math.min(1, a) * arcT);
        }
      }
    }
  }
  return px;
}

const here = dirname(fileURLToPath(import.meta.url));
for (const [size, name] of [
  [180, "family-assistant-icon.png"],
  [512, "family-assistant-icon-512.png"],
]) {
  const file = join(here, "..", "public", name);
  writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log(`wrote ${file} (${size}x${size})`);
}
