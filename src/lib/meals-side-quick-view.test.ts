import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const mealsPage = readFileSync(
  new URL("../app/meals/page.tsx", import.meta.url),
  "utf8",
);

const acceptedSides =
  mealsPage.split("{/* Accepted sides */}")[1]?.split("{/* Serve-with notes */}")[0] ?? "";
const serveWithNotes =
  mealsPage.split("{/* Serve-with notes */}")[1]?.split("{editingServeWith === i && (")[0] ?? "";

test("structured sides open recipe Quick View without activating their day card", () => {
  assert.match(acceptedSides, /slot\.meal\.sides\.map\(\(side\) =>/);
  assert.match(acceptedSides, /e\.stopPropagation\(\);\s*void handleQuickView\(side\.id\);/);
  assert.match(acceptedSides, /aria-label=\{`View \$\{side\.name\} recipe`\}/);
});

test("side removal remains isolated and plain serve-with notes do not open recipes", () => {
  assert.match(acceptedSides, /e\.stopPropagation\(\);\s*handleRemoveComplement\(i, side\.id\);/);
  assert.match(serveWithNotes, /slot\.meal\.serveWith\.join\(", "\)/);
  assert.doesNotMatch(serveWithNotes, /handleQuickView/);
});
