/**
 * Web-image ingestion: candidate collection, real-dimension measurement, and
 * the rule that a thumbnail never wins when a larger rendition of the same
 * photograph exists.
 *
 * Run with: npm test  (node --test; Node 24 strips types natively)
 *
 * No network. The two fixtures are trimmed from the live pages on 2026-08-09
 * and are otherwise verbatim: the Recipe JSON-LD `image` value, the Open Graph
 * tag, and the `srcset` attributes are exactly what those sites publish. They
 * are the two sources whose W33 imports were persisted at 225x225 and 440x400.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { readImageDimensions } from "./image-dimensions.ts";
import {
  collectImageCandidates,
  flattenStructuredImage,
  imageIdentity,
  isBetterImage,
  originalImageUrl,
  parseSrcset,
  selectRecipeImage,
  MAX_STORE_WIDTH,
  MIN_CARD_IMAGE,
  type DownloadedImage,
} from "./recipe-image-selection.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COOKIE_AND_KATE = readFileSync(
  join(__dirname, "fixtures", "cookieandkate-green-goddess-tortellini-salad.html"),
  "utf8",
);
const COOKIE_AND_KATE_URL = "https://cookieandkate.com/green-goddess-tortellini-salad/";

const BBC_GOOD_FOOD = readFileSync(
  join(__dirname, "fixtures", "bbcgoodfood-chickpea-coconut-dhal.html"),
  "utf8",
);
const BBC_GOOD_FOOD_URL = "https://www.bbcgoodfood.com/recipes/quick-easy-chickpea-coconut-dhal";

// ---------------------------------------------------------------------------
// Encoded-image builders
//
// Only the container headers matter: `readImageDimensions` never decodes
// pixels. Each buffer is padded past the 1 KB "this is not an error page"
// floor so the selection path treats it as a real download.
// ---------------------------------------------------------------------------

function pad(header: number[]): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set(header, 0);
  return bytes;
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngBytes(width: number, height: number): Uint8Array {
  return pad([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), 0x49, 0x48, 0x44, 0x52,
    ...be32(width), ...be32(height),
    8, 6, 0, 0, 0,
  ]);
}

function jpegBytes(width: number, height: number): Uint8Array {
  return pad([
    0xff, 0xd8,
    // APP0/JFIF, skipped by length — proves the marker walk does not stop at
    // the first segment the way a fixed-offset read would.
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    // SOF0
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    3,
  ]);
}

function webpBytes(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return pad([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ]);
}

function gifBytes(width: number, height: number): Uint8Array {
  return pad([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
}

// ---------------------------------------------------------------------------
// Dimension reading
// ---------------------------------------------------------------------------

describe("readImageDimensions", () => {
  it("reads each container the trusted sources actually serve", () => {
    deepStrictEqual(readImageDimensions(jpegBytes(1456, 2184)), { width: 1456, height: 2184, format: "jpeg" });
    deepStrictEqual(readImageDimensions(pngBytes(696, 696)), { width: 696, height: 696, format: "png" });
    deepStrictEqual(readImageDimensions(webpBytes(895, 813)), { width: 895, height: 813, format: "webp" });
    deepStrictEqual(readImageDimensions(gifBytes(320, 240)), { width: 320, height: 240, format: "gif" });
  });

  it("refuses rather than guesses when the bytes are not a readable image", () => {
    equal(readImageDimensions(new Uint8Array(0)), null);
    equal(readImageDimensions(new TextEncoder().encode("<!doctype html><html>404</html>")), null);
    equal(readImageDimensions(jpegBytes(800, 600).slice(0, 12)), null);
  });
});

// ---------------------------------------------------------------------------
// URL identity and hints
// ---------------------------------------------------------------------------

describe("image identity", () => {
  it("treats every rendition of one photograph as the same image", () => {
    const identity = imageIdentity("https://cookieandkate.com/images/2023/05/salad.jpg");
    equal(imageIdentity("https://cookieandkate.com/images/2023/05/salad-225x225.jpg"), identity);
    equal(imageIdentity("https://cookieandkate.com/images/2023/05/salad-1100x1650.jpg"), identity);
    equal(imageIdentity("https://images.example.com/a/dahl.jpg?resize=440,400"), imageIdentity("https://images.example.com/a/dahl.jpg?resize=900,836"));
  });

  it("does not merge two different photographs", () => {
    ok(imageIdentity("https://cookieandkate.com/images/salad.jpg") !== imageIdentity("https://cookieandkate.com/images/logo-696.png"));
  });

  it("resolves the un-suffixed original behind a rendition", () => {
    equal(
      originalImageUrl("https://images.example.com/a/dahl.jpg?quality=90&resize=440,400"),
      "https://images.example.com/a/dahl.jpg",
    );
    equal(
      originalImageUrl("https://cookieandkate.com/images/2023/05/salad-225x225.jpg"),
      "https://cookieandkate.com/images/2023/05/salad.jpg",
    );
  });
});

describe("parseSrcset", () => {
  it("survives URLs that contain commas", () => {
    // Verbatim from BBC Good Food: the crop/resize parameters are
    // comma-separated *inside* the URL and the candidate separator has no
    // trailing space, so a split(",") produces nothing usable.
    const raw =
      "https://img.example.com/dahl.jpg?quality=90&crop=3px,23px,895px,813px&resize=350,318 350w," +
      "https://img.example.com/dahl.jpg?quality=90&crop=3px,23px,895px,813px&resize=900,817 900w";
    deepStrictEqual(parseSrcset(raw), [
      { url: "https://img.example.com/dahl.jpg?quality=90&crop=3px,23px,895px,813px&resize=350,318", width: 350 },
      { url: "https://img.example.com/dahl.jpg?quality=90&crop=3px,23px,895px,813px&resize=900,817", width: 900 },
    ]);
  });

  it("handles whitespace-separated candidates and pixel-density descriptors", () => {
    deepStrictEqual(parseSrcset("/a.jpg 1x, /b.jpg 2x"), [
      { url: "/a.jpg", width: null },
      { url: "/b.jpg", width: null },
    ]);
    deepStrictEqual(parseSrcset("  "), []);
    deepStrictEqual(parseSrcset(null), []);
  });
});

describe("flattenStructuredImage", () => {
  it("reads every shape JSON-LD uses for `image`", () => {
    deepStrictEqual(flattenStructuredImage("https://a/x.jpg").map((v) => v.url), ["https://a/x.jpg"]);
    deepStrictEqual(
      flattenStructuredImage([{ "@type": "ImageObject", url: "https://a/x.jpg", width: 900, height: 836 }]),
      [{ url: "https://a/x.jpg", width: 900, height: 836 }],
    );
    deepStrictEqual(flattenStructuredImage({ contentUrl: "https://a/y.jpg" }).map((v) => v.url), ["https://a/y.jpg"]);
    deepStrictEqual(flattenStructuredImage(null), []);
  });
});

// ---------------------------------------------------------------------------
// Candidate collection from the real pages
// ---------------------------------------------------------------------------

describe("collectImageCandidates", () => {
  it("collects every Cookie and Kate rendition, original first", () => {
    const recipeImage = JSON.parse(
      /"image":(\[[^\]]*\])/.exec(COOKIE_AND_KATE)![1].replace(/\\\//g, "/"),
    );
    const candidates = collectImageCandidates({
      structuredImage: recipeImage,
      html: COOKIE_AND_KATE,
      pageUrl: COOKIE_AND_KATE_URL,
    });

    ok(candidates.length >= 8, `expected the full rendition ladder, got ${candidates.length}`);
    equal(
      candidates[0].url,
      "https://cookieandkate.com/images/2023/05/green-goddess-tortellini-salad.jpg",
      "the un-suffixed original must be tried before any thumbnail",
    );
    ok(
      candidates.some((c) => c.from === "srcset" && c.hintWidth === 1100),
      "the srcset ladder must contribute its wider renditions",
    );
    const thumbnailIndex = candidates.findIndex((c) => c.url.includes("-225x225"));
    ok(thumbnailIndex > 0, "the 225x225 thumbnail must not be first");
  });

  it("collects BBC Good Food's wider srcset renditions, not just the JSON-LD crop", () => {
    const recipeImage = JSON.parse(
      /"image":(\[.*?\}\])/.exec(BBC_GOOD_FOOD)![1],
    );
    const candidates = collectImageCandidates({
      structuredImage: recipeImage,
      html: BBC_GOOD_FOOD,
      pageUrl: BBC_GOOD_FOOD_URL,
    });

    ok(candidates.some((c) => c.url.endsWith("Dahl-d267922.jpg")), "the uncropped original is a candidate");
    ok(candidates.some((c) => c.from === "srcset" && c.hintWidth === 900), "the 900w srcset rendition is a candidate");
    ok(candidates.some((c) => c.from === "og"), "the Open Graph card shares the identity and is a candidate");
    // Every candidate is the same photograph.
    const identities = new Set(candidates.map((c) => imageIdentity(c.url)));
    equal(identities.size, 1);
  });

  it("never adopts page metadata that points at a different picture", () => {
    const html = `<html><head>
      <meta property="og:image" content="https://site.example/brand/site-logo-1200x630.png" />
      </head><body><img srcset="https://site.example/brand/hero-2000x1000.jpg 2000w" /></body></html>`;
    const candidates = collectImageCandidates({
      structuredImage: "https://site.example/photos/dish.jpg",
      html,
      pageUrl: "https://site.example/recipes/dish",
    });
    deepStrictEqual(candidates.map((c) => c.url), ["https://site.example/photos/dish.jpg"]);
  });

  it("falls back to Open Graph when the page makes no structured image claim", () => {
    const html = `<html><head><meta property="og:image" content="https://site.example/photos/dish.jpg" /></head></html>`;
    const candidates = collectImageCandidates({ structuredImage: null, html, pageUrl: "https://site.example/r/d" });
    deepStrictEqual(candidates.map((c) => c.url), ["https://site.example/photos/dish.jpg"]);
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function downloaderFor(sizes: Record<string, { width: number; height: number } | null>) {
  return async (url: string): Promise<DownloadedImage | null> => {
    const size = sizes[url];
    if (!size) return null;
    return { bytes: jpegBytes(size.width, size.height), contentType: "image/jpeg" };
  };
}

describe("selectRecipeImage", () => {
  it("does not pick the thumbnail when a larger valid source exists", async () => {
    const recipeImage = JSON.parse(
      /"image":(\[[^\]]*\])/.exec(COOKIE_AND_KATE)![1].replace(/\\\//g, "/"),
    );
    const candidates = collectImageCandidates({
      structuredImage: recipeImage,
      html: COOKIE_AND_KATE,
      pageUrl: COOKIE_AND_KATE_URL,
    });

    const base = "https://cookieandkate.com/images/2023/05/green-goddess-tortellini-salad";
    const selection = await selectRecipeImage(
      candidates,
      downloaderFor({
        [`${base}.jpg`]: { width: 1456, height: 2184 },
        [`${base}-1100x1650.jpg`]: { width: 1100, height: 1650 },
        [`${base}-1024x1536.jpg`]: { width: 1024, height: 1536 },
        [`${base}-768x1152.jpg`]: { width: 768, height: 1152 },
        [`${base}-550x824.jpg`]: { width: 550, height: 824 },
        [`${base}-400x600.jpg`]: { width: 400, height: 600 },
        [`${base}-320x180.jpg`]: { width: 320, height: 180 },
        [`${base}-260x195.jpg`]: { width: 260, height: 195 },
        [`${base}-225x225.jpg`]: { width: 225, height: 225 },
      }),
    );

    ok(selection.chosen);
    equal(selection.chosen.url, `${base}.jpg`);
    equal(selection.chosen.width, 1456);
    ok(selection.chosen.width > 225 && selection.chosen.height > 225);
  });

  it("prefers BBC Good Food's full rendition over the 440x400 crop", async () => {
    const recipeImage = JSON.parse(/"image":(\[.*?\}\])/.exec(BBC_GOOD_FOOD)![1]);
    const candidates = collectImageCandidates({
      structuredImage: recipeImage,
      html: BBC_GOOD_FOOD,
      pageUrl: BBC_GOOD_FOOD_URL,
    });

    const sizes: Record<string, { width: number; height: number }> = {};
    for (const candidate of candidates) {
      const hint = /resize=(\d+)[,%]?[0-9C]*,?(\d+)?/.exec(decodeURIComponent(candidate.url));
      sizes[candidate.url] = hint
        ? { width: Number(hint[1]), height: Number(hint[2] ?? Math.round(Number(hint[1]) * 0.9)) }
        : { width: 895, height: 813 };
    }
    const selection = await selectRecipeImage(candidates, downloaderFor(sizes));

    ok(selection.chosen);
    ok(selection.chosen.width >= 895, `chose ${selection.chosen.width}px wide`);
    ok(!selection.chosen.url.includes("resize=440"), "the 440x400 crop must not win");
  });

  it("refuses an image that is only available below the card floor", async () => {
    const selection = await selectRecipeImage(
      [{ url: "https://site.example/thumb-225x225.jpg", from: "structured", hintWidth: 225, hintHeight: 225 }],
      downloaderFor({ "https://site.example/thumb-225x225.jpg": { width: 225, height: 225 } }),
    );
    equal(selection.chosen, null);
    deepStrictEqual(selection.considered.map((c) => c.outcome), ["too-small"]);
  });

  it("never upscales: the stored size is the source's own size", async () => {
    const selection = await selectRecipeImage(
      [{ url: "https://site.example/dish.jpg", from: "structured", hintWidth: null, hintHeight: null }],
      downloaderFor({ "https://site.example/dish.jpg": { width: 900, height: 675 } }),
    );
    ok(selection.chosen);
    deepStrictEqual(readImageDimensions(selection.chosen.bytes), { width: 900, height: 675, format: "jpeg" });
  });

  it("skips a candidate whose bytes are not an image and keeps looking", async () => {
    const selection = await selectRecipeImage(
      [
        { url: "https://site.example/gone.jpg", from: "original", hintWidth: null, hintHeight: null },
        { url: "https://site.example/dish.jpg", from: "structured", hintWidth: 900, hintHeight: null },
      ],
      async (url) => {
        if (url.endsWith("gone.jpg")) return { bytes: new Uint8Array(4096), contentType: "text/html" };
        return { bytes: jpegBytes(900, 675), contentType: "image/jpeg" };
      },
    );
    ok(selection.chosen);
    equal(selection.chosen.url, "https://site.example/dish.jpg");
    deepStrictEqual(selection.considered.map((c) => c.outcome), ["not-an-image", "chosen"]);
  });

  it("stops after the download budget rather than walking a long ladder", async () => {
    const attempted: string[] = [];
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      url: `https://site.example/r-${1200 - i * 50}.jpg`,
      from: "srcset" as const,
      hintWidth: 1200 - i * 50,
      hintHeight: null,
    }));
    await selectRecipeImage(
      candidates,
      async (url) => {
        attempted.push(url);
        return { bytes: jpegBytes(800, 600), contentType: "image/jpeg" };
      },
      { limit: 4 },
    );
    equal(attempted.length, 4);
  });
});

describe("isBetterImage", () => {
  it("prefers the larger image", () => {
    const at = (width: number, height: number) => ({
      url: `https://x/${width}.jpg`,
      from: "structured" as const,
      bytes: jpegBytes(width, height),
      contentType: "image/jpeg",
      width,
      height,
    });
    ok(isBetterImage(at(1200, 800), at(440, 400)));
    ok(!isBetterImage(at(440, 400), at(1200, 800)));
    ok(isBetterImage(at(600, 450), null));
  });

  it("prefers a usable rendition over a print-resolution original", () => {
    const oversized = {
      url: "https://x/huge.jpg",
      from: "original" as const,
      bytes: jpegBytes(MAX_STORE_WIDTH + 1200, 3000),
      contentType: "image/jpeg",
      width: MAX_STORE_WIDTH + 1200,
      height: 3000,
    };
    const usable = {
      url: "https://x/1600.jpg",
      from: "srcset" as const,
      bytes: jpegBytes(1600, 1200),
      contentType: "image/jpeg",
      width: 1600,
      height: 1200,
    };
    ok(isBetterImage(usable, oversized));
    ok(!isBetterImage(oversized, usable));
  });
});

describe("the card floor", () => {
  it("is larger than the thumbnails that caused the regression", () => {
    ok(MIN_CARD_IMAGE.width > 225 && MIN_CARD_IMAGE.height > 225);
  });
});
