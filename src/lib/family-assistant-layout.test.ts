// Regression tests for the Family Assistant interaction-size and
// responsive-composition contract.
//
// Run with: npm test  (node --test; types stripped natively)
//
// There is no DOM test harness in this repo, so the contract is enforced two
// ways: the numeric constants are checked directly, and `client.tsx` is
// scanned as source to prove it actually applies them — the same way the
// bridge and minter assert a shared golden vector across repositories.

import { equal, match, ok, doesNotMatch } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ORDINARY_TARGET_MIN_PX,
  PRIMARY_INPUT_HEIGHT_CLASS,
  PRIMARY_INPUT_MIN_PX,
  SEND_BUTTON_SIZE_CLASS,
  SIDE_BY_SIDE_VARIANT_PREFIX,
  TALK_BUTTON_MIN_PX,
  TALK_BUTTON_SIZE_CLASS,
} from "./family-assistant-layout.ts";

const clientSource = readFileSync(
  new URL("../app/family/assistant/client.tsx", import.meta.url),
  "utf8",
);

/** Resolves `h-[136px]` to 136 and scale utilities like `h-14` to 14*4=56. */
function pxOf(classes: string, axis: "h" | "w"): number {
  const arbitrary = classes.match(new RegExp(`\\b${axis}-\\[(\\d+)px\\]`));
  if (arbitrary) return Number(arbitrary[1]);
  const scale = classes.match(new RegExp(`\\b${axis}-(\\d+(?:\\.\\d+)?)\\b`));
  ok(scale, `no ${axis}-* utility in "${classes}"`);
  return Number(scale[1]) * 4; // Tailwind spacing scale: 1 unit = 0.25rem = 4px
}

describe("push-to-talk control size", () => {
  it("is at least the contract minimum on both axes, and square", () => {
    const h = pxOf(TALK_BUTTON_SIZE_CLASS, "h");
    const w = pxOf(TALK_BUTTON_SIZE_CLASS, "w");
    ok(h >= TALK_BUTTON_MIN_PX, `talk button height ${h} < ${TALK_BUTTON_MIN_PX}`);
    equal(h, w, "talk button must be a circle: equal height and width");
  });

  it("keeps the documented minimum at 132px", () => {
    equal(TALK_BUTTON_MIN_PX, 132);
  });
});

describe("typed fallback sizes", () => {
  it("input is at least the primary-control minimum height", () => {
    ok(pxOf(PRIMARY_INPUT_HEIGHT_CLASS, "h") >= PRIMARY_INPUT_MIN_PX);
    equal(PRIMARY_INPUT_MIN_PX, 56);
  });

  it("send control meets the primary minimum on both axes", () => {
    ok(pxOf(SEND_BUTTON_SIZE_CLASS, "h") >= PRIMARY_INPUT_MIN_PX);
    ok(pxOf(SEND_BUTTON_SIZE_CLASS, "w") >= ORDINARY_TARGET_MIN_PX);
  });
});

describe("client.tsx applies the contract", () => {
  it("uses every contract class constant by name", () => {
    for (const name of [
      "TALK_BUTTON_SIZE_CLASS",
      "PRIMARY_INPUT_HEIGHT_CLASS",
      "SEND_BUTTON_SIZE_CLASS",
    ]) {
      ok(clientSource.includes(name), `client.tsx does not use ${name}`);
    }
  });

  it("labels the talk control for both states", () => {
    ok(clientSource.includes('"Stop listening"'));
    ok(clientSource.includes('"Tap to talk"'));
  });

  it("keeps the listening pulse ring decorative so the whole circle stays clickable", () => {
    match(clientSource, /pointer-events-none[^"]*animate-ping|animate-ping[^"]*pointer-events-none/);
  });
});

describe("responsive composition", () => {
  it("splits into columns only under the landscape-qualified variant", () => {
    equal(SIDE_BY_SIDE_VARIANT_PREFIX, "lg:landscape:");
    // Any bare `lg:` utility would re-open the iPad-portrait desktop split.
    doesNotMatch(clientSource, /\blg:(?!landscape:)/);
    ok(clientSource.includes("lg:landscape:flex-row"));
  });

  it("keeps the portrait talk dock and the landscape rail dock mutually exclusive", () => {
    ok(clientSource.includes("lg:landscape:hidden"), "portrait footer dock must vanish in landscape");
    ok(clientSource.includes("hidden lg:landscape:flex"), "rail dock must exist only in landscape");
  });

  it("has no sub-48px targets left from the first design round", () => {
    doesNotMatch(clientSource, /\bmin-h-11\b/);
    doesNotMatch(clientSource, /\bh-11 w-11\b/);
  });
});
