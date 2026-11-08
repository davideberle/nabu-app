// Step 2 B (2026-11-02): the home map's world state, derived read-only from records shaped like both children's real
// histories (visit ids, finished dates and choices only — no child text); the flag (off → the view is unchanged); child
// isolation; the walk graph; and the sprite manifest (every piece the derivation can ask for exists, sizes follow the grid).
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent } from "./family-learning-content.ts";
import { asIsabelContent } from "./family-learning-isabel.ts";
import { buildChildView, EMPTY_PARENT_SETTINGS, newMissionState, type MissionState } from "./family-learning-state.ts";
import { deriveHomeWorld, homeMapEnabled, homeMapFlag, walkPath, WORLDS, type HomeWorldInput } from "./family-home-map.ts";
import { missionChoices } from "./family-home-map-view.ts";
import { ASSETS, ART_SCALE, TILE_H, TILE_W } from "./family-home-map-assets.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const v8 = asLearningContent(read("santiago-expedition-v8.json"));
const i3 = asIsabelContent(read("isabel-workshop-v3.json"));
const NOW = new Date("2026-11-02T12:00:00.000Z");
const day = (d: string) => `${d}T15:00:00.000Z`;

/** Santiago after Visit 8 (v1, v2, v4–v9 finished; Visit 9 = v10 next); Isabel after Visit 2 (v1, v2 finished; Visit 3 = v4 next). */
function santiagoState(): MissionState {
  const s = newMissionState(v8, "santiago", day("2026-09-29"));
  s.visits = ["v1", "v2", "v4", "v5", "v6", "v7", "v8", "v9"].map((id, i) => ({ id, startedAt: day(`2026-10-${String(1 + i * 3).padStart(2, "0")}`), finishedAt: day(`2026-10-${String(1 + i * 3).padStart(2, "0")}`), stageIndex: 99, skippedStages: [], reflection: "easy" })) as MissionState["visits"];
  return s;
}
function isabelState(choice: string | null = "flowers"): MissionState {
  const s = newMissionState(i3, "isabel", day("2026-10-28"));
  s.visits = [
    { id: "v1", startedAt: day("2026-10-28"), finishedAt: day("2026-10-28"), stageIndex: 99, skippedStages: [], reflection: "right" },
    { id: "v2", startedAt: day("2026-11-01"), finishedAt: day("2026-11-01"), stageIndex: 99, skippedStages: [], reflection: "right" },
  ] as MissionState["visits"];
  if (choice) {
    s.missions = { "MISSION-IDA-GARDEN": { missionId: "MISSION-IDA-GARDEN", version: 1, visit: "v2", startedAt: day("2026-11-01"), position: "garden", visited: [], active: null, steps: { "IG2-PLANT": { status: "done", openedAt: day("2026-11-01"), finishedAt: day("2026-11-01"), attempts: [{ no: 1, at: day("2026-11-01"), raw: "x", choice, correct: true, evidence: "unscored", support: [], modality: "pick", kind: "answer" }], support: [], plays: 0, questions: {}, phase: "answer", outcome: "independent" } }, facts: {}, shownWords: [], typing: null, finishedAt: day("2026-11-01") } } as unknown as MissionState["missions"];
  }
  return s;
}

const ids = (w: ReturnType<typeof deriveHomeWorld>, stage: "built" | "site") => w.pieces.filter((p) => p.stage === stage).map((p) => p.id).sort();

describe("flag", () => {
  it("FAMILY_HOME_MAP: off by default, only the four documented values", () => {
    equal(homeMapFlag({}), "off");
    equal(homeMapFlag({ FAMILY_HOME_MAP: "ALL" }), "all");
    equal(homeMapFlag({ FAMILY_HOME_MAP: "santiago" }), "santiago");
    equal(homeMapFlag({ FAMILY_HOME_MAP: "yes" }), "off");
    ok(homeMapEnabled("all", "isabel") && homeMapEnabled("isabel", "isabel") && !homeMapEnabled("santiago", "isabel") && !homeMapEnabled("off", "santiago"));
  });
  it("off → the child view is exactly the view without the option (no homeMap field)", () => {
    for (const [state, content] of [[santiagoState(), v8], [isabelState(), i3]] as const) {
      const plain = buildChildView(state, content, EMPTY_PARENT_SETTINGS, NOW);
      deepStrictEqual(buildChildView(state, content, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "off" }), plain);
      equal("homeMap" in plain, false);
    }
  });
  it("the flag for one child never adds the map to the other child's view", () => {
    equal(buildChildView(isabelState(), i3, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "santiago" }).homeMap, undefined);
    equal(buildChildView(santiagoState(), v8, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "isabel" }).homeMap, undefined);
    ok(buildChildView(isabelState(), i3, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "isabel" }).homeMap);
  });
});

describe("world state from records", () => {
  it("Santiago after Visit 8: harbor, shop, office, typing workshop, garden beds, greenhouse and its wing built; tank and pipe are today's sites", () => {
    const view = buildChildView(santiagoState(), v8, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "all" });
    const w = deriveHomeWorld({ ...view.homeMap!.input, seen: null });
    deepStrictEqual(ids(w, "built"), ["s-dock", "s-garden-beds", "s-greenhouse", "s-greenhouse-wing", "s-office", "s-shop", "s-workshop"]);
    deepStrictEqual(ids(w, "site"), ["s-pipe", "s-water-tank"]);
    equal(view.homeMap!.input.current?.visit, "v10");
    // Visit 9 starts at the planning office: that is today's highlighted place.
    deepStrictEqual(w.places.filter((p) => p.state === "current").map((p) => p.id), ["office"]);
    ok(w.places.some((p) => p.id === "greenhouse" && p.state === "quiet"));
    deepStrictEqual(w.unplaced, []);
  });
  it("after Visit 9 is finished, the water tank and the pipe are built (and arrive once)", () => {
    const s = santiagoState();
    s.visits.push({ id: "v10", startedAt: day("2026-11-07"), finishedAt: day("2026-11-07"), stageIndex: 99, skippedStages: [], reflection: "easy" } as MissionState["visits"][number]);
    const view = buildChildView(s, v8, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "all" });
    const seenBefore = ["s-dock", "s-shop", "s-office", "s-workshop", "s-garden-beds", "s-greenhouse", "s-greenhouse-wing"];
    const w = deriveHomeWorld({ ...view.homeMap!.input, seen: seenBefore });
    ok(ids(w, "built").includes("s-water-tank") && ids(w, "built").includes("s-pipe"));
    deepStrictEqual(w.arrivals.sort(), ["s-pipe", "s-water-tank"]);
    deepStrictEqual(deriveHomeWorld({ ...view.homeMap!.input, seen: [...seenBefore, "s-pipe", "s-water-tank"] }).arrivals, []);
  });
  it("Isabel after Visit 2: garden house, stick fence and her chosen garden built; vegetable patch and harvest table are today's sites", () => {
    const view = buildChildView(isabelState("flowers"), i3, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "all" });
    const w = deriveHomeWorld({ ...view.homeMap!.input, seen: null });
    deepStrictEqual(ids(w, "built"), ["i-flower-garden", "i-garden-house", "i-stick-fence"]);
    deepStrictEqual(ids(w, "site"), ["i-harvest-table", "i-vegetable-patch"]);
    equal(w.pieces.find((p) => p.id === "i-flower-garden")!.asset, "i-flower-garden-flowers-built");
    deepStrictEqual(w.places.filter((p) => p.state === "current").map((p) => p.id), ["garden"]);
  });
  it("Isabel's own choice picks the variant (a tree) — read from her mission run, not hard-coded", () => {
    const st = isabelState("tree");
    deepStrictEqual(missionChoices(st, i3), { "IG2-PLANT": "tree" });
    const view = buildChildView(st, i3, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "isabel" });
    equal(deriveHomeWorld({ ...view.homeMap!.input, seen: [] }).pieces.find((p) => p.id === "i-flower-garden")!.asset, "i-flower-garden-tree-built");
  });
  it("first time on a device: only the latest finished visit's pieces arrive, not the whole history", () => {
    const view = buildChildView(santiagoState(), v8, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "all" });
    deepStrictEqual(deriveHomeWorld({ ...view.homeMap!.input, seen: null }).arrivals, ["s-greenhouse-wing"]);
  });
  it("nothing finished → empty grass (no pieces); the first visit's place is today's", () => {
    const s = newMissionState(i3, "isabel", day("2026-10-28"));
    const view = buildChildView(s, i3, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "isabel" });
    const w = deriveHomeWorld({ ...view.homeMap!.input, seen: null });
    deepStrictEqual(ids(w, "built"), []);
    deepStrictEqual(ids(w, "site"), ["i-garden-house"]);
  });
  it("is deterministic and read-only: the same records give the same world, and the state is not touched", () => {
    const s = santiagoState();
    const before = JSON.stringify(s);
    const a = buildChildView(s, v8, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "all" }).homeMap;
    const b = buildChildView(s, v8, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: "all" }).homeMap;
    deepStrictEqual(a, b);
    equal(JSON.stringify(s), before);
  });
});

describe("child isolation", () => {
  it("each world only knows its own pieces and places; one child's records never build the other's world", () => {
    const sIds = new Set(WORLDS.santiago.pieces.map((p) => p.id));
    ok(WORLDS.isabel.pieces.every((p) => !sIds.has(p.id)));
    // Santiago's history fed into Isabel's world builds nothing of Santiago's.
    const input: HomeWorldInput = { child: "isabel", visits: [{ id: "v6", finishedAt: day("2026-10-14") }, { id: "v7", finishedAt: day("2026-10-21") }], choices: {}, current: null, seen: null };
    const w = deriveHomeWorld(input);
    ok(w.pieces.every((p) => p.id.startsWith("i-")));
  });
});

describe("walking", () => {
  it("every place of both worlds is reachable from the landing spot along the paths", () => {
    for (const w of Object.values(WORLDS)) for (const [id, tile] of Object.entries(w.places)) ok(walkPath(w.paths, w.spawn, tile), `${w.child}: ${id}`);
  });
  it("every current-visit place in the content has a tile (Santiago v10, Isabel v4)", () => {
    for (const [content, child, visit] of [[v8, "santiago", "v10"], [i3, "isabel", "v4"]] as const) {
      const def = content.missions!.find((m) => m.visit === visit)!;
      for (const p of def.map.places) ok(WORLDS[child].places[p.id], `${child} ${visit}: ${p.id}`);
    }
  });
});

describe("sprite manifest", () => {
  it("every piece asset the derivation can ask for exists (all stages, all variants)", () => {
    const have = new Set(ASSETS.map((a) => a.id));
    const missing: string[] = [];
    for (const w of Object.values(WORLDS)) for (const p of w.pieces) {
      const vars = p.variant ? Object.values(p.variant.options) : [null];
      for (const v of vars) if (!have.has(p.builtAsset ?? `${p.id}${v ? `-${v}` : ""}-built`)) missing.push(`${p.id}${v ? `-${v}` : ""}-built`);
    }
    deepStrictEqual(missing, []);
    // Sites exist for the visits still to come (Santiago v10, Isabel v4).
    for (const id of ["s-water-tank-site", "s-pipe-site", "i-vegetable-patch-site", "i-harvest-table-site"]) ok(have.has(id), id);
  });
  it("every asset the derived worlds of both histories ask for exists (sites of variant pieces included)", () => {
    const have = new Set(ASSETS.map((a) => a.id));
    for (const [state, content, child] of [[santiagoState(), v8, "santiago"], [isabelState("corn"), i3, "isabel"], [isabelState(null), i3, "isabel"]] as const) {
      const view = buildChildView(state, content, EMPTY_PARENT_SETTINGS, NOW, 0, { homeMap: child });
      for (const p of deriveHomeWorld({ ...view.homeMap!.input, seen: null }).pieces) ok(have.has(p.asset), `${child}: ${p.asset}`);
    }
  });
  it("piece sizes and anchors follow the footprint: width (w+h)·tile, anchor on the south corner", () => {
    for (const a of ASSETS.filter((x) => x.kind === "piece")) {
      equal(a.size.w, (a.footprint!.w + a.footprint!.h) * (TILE_W / 2) * ART_SCALE, a.id);
      equal(a.anchor.x, a.footprint!.w * (TILE_W / 2) * ART_SCALE, a.id);
      equal(a.anchor.y, a.size.h, a.id);
      ok(a.size.h >= (a.footprint!.w + a.footprint!.h) * (TILE_H / 2) * ART_SCALE, a.id);
    }
  });
  it("the placeholder files exist with the manifest's exact pixel sizes", async () => {
    const { createRequire } = await import("node:module");
    const sharp = createRequire(import.meta.url)("sharp");
    for (const a of ASSETS) {
      const meta = await sharp(new URL(`../../public/family/home-map/${a.id}.${a.format}`, import.meta.url).pathname).metadata();
      deepStrictEqual([meta.width, meta.height], [a.size.w, a.size.h], a.id);
    }
  });
});

describe("layout", () => {
  it("every place stands in front of its piece (never hidden behind it) and no path runs under a footprint", () => {
    for (const w of Object.values(WORLDS)) {
      const under = (t: { c: number; r: number }) => w.pieces.find((p) => t.c >= p.tile.c && t.c < p.tile.c + p.footprint.w && t.r >= p.tile.r && t.r < p.tile.r + p.footprint.h);
      for (const t of w.paths) equal(under(t), undefined, `${w.child}: path ${t.c},${t.r} under ${under(t)?.id}`);
      for (const p of w.pieces.filter((x) => x.place)) {
        const t = w.places[p.place!];
        const frontLeft = t.r === p.tile.r + p.footprint.h && t.c >= p.tile.c && t.c < p.tile.c + p.footprint.w;
        const frontRight = t.c === p.tile.c + p.footprint.w && t.r >= p.tile.r && t.r < p.tile.r + p.footprint.h;
        ok(frontLeft || frontRight, `${w.child}: ${p.id} place ${p.place} at ${t.c},${t.r}`);
      }
      for (const a of w.pieces) for (const b of w.pieces) {
        if (a === b) continue;
        const overlap = a.tile.c < b.tile.c + b.footprint.w && b.tile.c < a.tile.c + a.footprint.w && a.tile.r < b.tile.r + b.footprint.h && b.tile.r < a.tile.r + a.footprint.h;
        ok(!overlap, `${w.child}: ${a.id} overlaps ${b.id}`);
      }
    }
  });
});

describe("child-device access to the sprites", () => {
  it("the shared child account may load exactly the manifest's files, nothing else in that folder", async () => {
    const { isTrackerAllowedPath } = await import("./access.ts");
    const { assetUrl } = await import("./family-home-map-assets.ts");
    for (const a of ASSETS) ok(isTrackerAllowedPath(assetUrl(a)), assetUrl(a));
    ok(!isTrackerAllowedPath("/family/home-map/other.png"));
    ok(!isTrackerAllowedPath("/family/home-map/"));
    equal(ASSETS.length, 41);
  });
});

describe("1× ground for windows up to 1440 px", () => {
  it("the islands and the water have half-size companions (resized, same aspect), and the child device may load exactly those too", async () => {
    const { createRequire } = await import("node:module");
    const sharp = createRequire(import.meta.url)("sharp");
    const { ALL_ASSET_URLS, assetUrl1x } = await import("./family-home-map-assets.ts");
    const { isTrackerAllowedPath } = await import("./access.ts");
    const ones = ASSETS.filter((a) => a.oneX);
    deepStrictEqual(ones.map((a) => a.id).sort(), ["isabel-island", "santiago-island", "water"]);
    for (const a of ones) {
      const meta = await sharp(new URL(`../../public/family/home-map/${a.id}@1x.${a.format}`, import.meta.url).pathname).metadata();
      deepStrictEqual([meta.width, meta.height], [a.size.w / 2, a.size.h / 2], a.id);
      ok(isTrackerAllowedPath(assetUrl1x(a)), assetUrl1x(a));
    }
    equal(ALL_ASSET_URLS.length, 44);
    ok(!isTrackerAllowedPath("/family/home-map/s-dock-built@1x.png"));
  });
});
