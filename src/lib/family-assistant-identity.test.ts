import { deepStrictEqual, equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assistantProfiles, assistantProfileById } from "../data/family-assistant.ts";
import { isTrackerAllowedPath } from "./access.ts";
import identities from "../data/family-assistant-identities.json" with { type: "json" };

test("approved assistants never rename children or change child IDs", () => {
  deepStrictEqual(assistantProfiles.map(({id, displayName, companionName}) => ({id, displayName, companionName})), [
    {id: "santiago", displayName: "Santiago", companionName: "Nokt"},
    {id: "isabel", displayName: "Isabel", companionName: "Old Lila"},
  ]);
  equal(assistantProfileById("nokt"), null);
  equal(assistantProfileById("old-lila"), null);
  equal(assistantProfileById(undefined), null);
});

test("deployed artwork is byte-identical to the two approved originals", () => {
  const approved = {
    santiago: "f1ce057ee230af45b363d7e9657305249fa24f0a4b343f1e5afefa77b2f0400e",
    isabel: "0a92fe7193c456f7ac5877bba2388b1e96e5d9badefb3255d2849688eef65d70",
  };
  for (const child of ["santiago", "isabel"] as const) {
    const identity = identities[child];
    const bytes = readFileSync(new URL(`../../public${identity.image}`, import.meta.url));
    equal(createHash("sha256").update(bytes).digest("hex"), approved[child]);
    equal(identity.sha256, approved[child]);
    equal(assistantProfileById(child)!.companionName, identity.name);
  }
});

test("child asset access is limited to the two approved paths", () => {
  for (const identity of Object.values(identities)) equal(isTrackerAllowedPath(identity.image), true);
  for (const path of ["/family-assistant/avatars/other.webp", "/family-assistant/avatars/nokt.webp/extra", "/family-assistant/private", "/family/learn/parent"]) equal(isTrackerAllowedPath(path), false);
});
