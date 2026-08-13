// Unit tests for the dedicated Family Assistant web-app manifest.
//
// The properties that must hold: the manifest describes the Assistant (not the
// Family Board), starts on /family/assistant, installs standalone, and its
// asset paths match what the middleware matcher exempts from auth — Safari
// fetches manifests and Home Screen icons without credentials.
//
// Run with: npm test  (node --test; types stripped natively)

import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FAMILY_ASSISTANT_APPLE_ICON,
  FAMILY_ASSISTANT_ICON_512,
  FAMILY_ASSISTANT_MANIFEST_PATH,
  familyAssistantManifest,
} from "./family-assistant-manifest.ts";

describe("familyAssistantManifest", () => {
  it("names the Family Assistant and starts on its own route", () => {
    equal(familyAssistantManifest.name, "Family Assistant");
    equal(familyAssistantManifest.short_name, "Assistant");
    equal(familyAssistantManifest.start_url, "/family/assistant");
    equal(familyAssistantManifest.display, "standalone");
  });

  it("is served from under its own route, not the global manifest path", () => {
    equal(FAMILY_ASSISTANT_MANIFEST_PATH, "/family/assistant/manifest.webmanifest");
    ok(String(FAMILY_ASSISTANT_MANIFEST_PATH) !== "/manifest.json");
  });

  it("does not overlap the Family Board install identity", () => {
    // The global /manifest.json is "Nabu Family Board" starting on the
    // dashboard; this one must never collide with it. String() widens the
    // literal types so the comparison is a runtime check, not a type identity.
    ok(String(familyAssistantManifest.name) !== "Nabu Family Board");
    ok(String(familyAssistantManifest.start_url) !== "/family/dashboard");
  });

  it("declares PNG icons at the paths the middleware exempts", () => {
    equal(FAMILY_ASSISTANT_APPLE_ICON, "/family-assistant-icon.png");
    equal(FAMILY_ASSISTANT_ICON_512, "/family-assistant-icon-512.png");
    const sources = familyAssistantManifest.icons.map((icon) => icon.src);
    ok(sources.includes(FAMILY_ASSISTANT_APPLE_ICON));
    ok(sources.includes(FAMILY_ASSISTANT_ICON_512));
    for (const icon of familyAssistantManifest.icons) {
      equal(icon.type, "image/png");
    }
  });
});
