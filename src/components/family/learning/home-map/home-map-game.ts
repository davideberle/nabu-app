// ---------------------------------------------------------------------------
// Step 2 B (2026-11-02): the Phaser scene of the children's isometric home map. Imported ONLY through a dynamic import
// from home-map.tsx (client-only), so Phaser never enters the server bundle or any page without the map.
//
// Everything visual comes from the sprite manifest (lib/family-home-map-assets.ts): final art replaces the files under
// /family/home-map/ with the same sizes and anchors and needs no code change here.
// ---------------------------------------------------------------------------

import Phaser from "phaser";
import { ART_SCALE, ASSETS, assetUrl, TILE_H, TILE_W, type AssetDef } from "@/lib/family-home-map-assets";
import { walkPath, type HomeWorld, type Tile } from "@/lib/family-home-map";

export type GameCallbacks = {
  /** The avatar stopped on a place tile (by tap or keys). */
  onArrive: (place: string) => void;
  /** Avatar tile / walking changed (for the DOM overlay and the test hooks). */
  onAvatar: (tile: Tile, walking: boolean) => void;
  /** Screen positions of the places changed (after layout, resize or camera move). */
  onLayout: (positions: Record<string, { x: number; y: number }>, zoom: number) => void;
  /** The build animation started / finished (finished also when skipped). */
  onArrival: (state: "playing" | "done", ids: string[]) => void;
  /** Pieces that could not be drawn (no manifest entry or the file did not load) — must stay empty. */
  onMissing: (ids: string[]) => void;
};

export type GameApi = {
  walkTo: (place: string) => void;
  step: (dir: "up" | "down" | "left" | "right") => void;
  skipArrival: () => void;
  destroy: () => void;
};

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
/** World position of a tile's top corner. */
const top = (t: Tile) => ({ x: (t.c - t.r) * HALF_W, y: (t.c + t.r) * HALF_H });
const centre = (t: Tile) => ({ x: (t.c - t.r) * HALF_W, y: (t.c + t.r) * HALF_H + HALF_H });
const keyOf = (t: Tile) => `${t.c},${t.r}`;
/** The world area the camera keeps in view: the 12×12 grid, its cliffs and the tallest pieces. */
const FIT = { x: -800, y: -170, w: 1600, h: 1030 };
const STEP_MS = 170;
const ARRIVAL_MS = 2000;

function assetsFor(world: HomeWorld): AssetDef[] {
  const pieceIds = new Set(world.pieces.map((p) => p.asset));
  return ASSETS.filter((a) => (a.kind === "piece" ? pieceIds.has(a.id) : a.world === "shared" || a.world === world.child));
}

export function startHomeMap(parent: HTMLElement, world: HomeWorld, cb: GameCallbacks): GameApi {
  let scene: HomeScene | null = null;
  class HomeScene extends Phaser.Scene {
    avatar!: Phaser.GameObjects.Sprite;
    at: Tile = world.avatar;
    walking = false;
    /** Spritesheet row of the last walking direction (0 se, 1 sw, 2 ne, 3 nw); frame 0 of the row is the standing pose. */
    row = 0;
    queue: Tile[] = [];
    arrivalTweens: Phaser.Tweens.Tween[] = [];
    arriving: Phaser.GameObjects.Image[] = [];
    arrivalDone = false;
    constructor() {
      super("home");
    }
    preload() {
      for (const a of assetsFor(world)) {
        if (a.frames) this.load.spritesheet(a.id, assetUrl(a), { frameWidth: a.frames.w, frameHeight: a.frames.h });
        else this.load.image(a.id, assetUrl(a));
      }
    }
    create() {
      scene = this;
      const water = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, "water").setOrigin(0).setScrollFactor(0).setTileScale(1 / ART_SCALE).setDepth(-1000);
      const island = ASSETS.find((a) => a.id === `${world.child}-island`)!;
      this.add.image(0, 0, island.id).setOrigin(island.anchor.x / island.size.w, island.anchor.y / island.size.h).setScale(1 / ART_SCALE).setDepth(-900);
      const pathTile = ASSETS.find((a) => a.id === "path-tile")!;
      const seen = new Set<string>();
      for (const t of world.paths) {
        if (seen.has(keyOf(t))) continue;
        seen.add(keyOf(t));
        const p = top(t);
        this.add.image(p.x, p.y, "path-tile").setOrigin(pathTile.anchor.x / pathTile.size.w, 0).setScale(1 / ART_SCALE).setDepth(-800);
      }
      for (const pl of world.places) {
        const c = centre(pl.tile);
        if (pl.state === "current" && !pl.waypoint) {
          const ring = this.add.image(c.x, c.y, "marker-current").setScale(1 / ART_SCALE).setDepth(-700);
          this.tweens.add({ targets: ring, alpha: { from: 0.55, to: 1 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        }
        if (!pl.waypoint) {
          const sign = ASSETS.find((a) => a.id === "sign")!;
          this.add.image(c.x + 34, c.y - 6, "sign").setOrigin(sign.anchor.x / sign.size.w, sign.anchor.y / sign.size.h).setScale(1 / ART_SCALE).setDepth(c.y - 6).setAlpha(pl.state === "current" ? 1 : 0.85);
        }
      }
      const missing: string[] = [];
      for (const p of world.pieces) {
        const a = ASSETS.find((x) => x.id === p.asset);
        if (!a || !this.textures.exists(a.id)) {
          missing.push(p.asset);
          continue;
        }
        const south = top({ c: p.tile.c + p.footprint.w, r: p.tile.r + p.footprint.h });
        const img = this.add.image(south.x, south.y, a.id).setOrigin(a.anchor.x / a.size.w, a.anchor.y / a.size.h).setScale(1 / ART_SCALE).setDepth(south.y);
        if (p.arriving) {
          img.setData("finalY", south.y).setAlpha(0).setY(south.y + 40);
          this.arriving.push(img);
        }
      }
      cb.onMissing(missing);
      const av = ASSETS.find((a) => a.id === `${world.child}-avatar`)!;
      const c0 = centre(this.at);
      this.avatar = this.add.sprite(c0.x, c0.y, av.id, 0).setOrigin(av.anchor.x / av.frames!.w, av.anchor.y / av.frames!.h).setScale(1 / ART_SCALE).setDepth(c0.y + 1);
      const rows = ["se", "sw", "ne", "nw"];
      rows.forEach((d, i) => this.anims.create({ key: `walk-${d}`, frames: this.anims.generateFrameNumbers(av.id, { start: i * 4, end: i * 4 + 3 }), frameRate: 10, repeat: -1 }));
      if (this.textures.exists("build-puff")) this.anims.create({ key: "puff", frames: this.anims.generateFrameNumbers("build-puff", { start: 0, end: 7 }), frameRate: 8, repeat: 0 });

      this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
        if (this.arriving.length && !this.arrivalDone) return this.skipArrival();
        const w = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
        let best: string | null = null;
        let bestD = 70;
        for (const pl of world.places) {
          const c = centre(pl.tile);
          const d = Math.hypot(c.x - w.x, (c.y - w.y) * 1.6);
          if (d < bestD) {
            bestD = d;
            best = pl.id;
          }
        }
        if (best) this.walkTo(best);
      });
      const fit = () => {
        const cam = this.cameras.main;
        const zoom = Math.min(this.scale.width / FIT.w, this.scale.height / FIT.h);
        cam.setZoom(zoom);
        cam.centerOn(FIT.x + FIT.w / 2, FIT.y + FIT.h / 2);
        water.setSize(this.scale.width, this.scale.height);
        // worldView is refreshed at render; report positions right after it.
        this.time.delayedCall(0, () => this.reportLayout());
      };
      this.scale.on("resize", fit);
      fit();
      cb.onAvatar(this.at, false);
      this.playArrival();
    }
    reportLayout() {
      const cam = this.cameras.main;
      cam.preRender();
      const out: Record<string, { x: number; y: number }> = {};
      for (const pl of world.places) {
        const c = centre(pl.tile);
        out[pl.id] = { x: (c.x - cam.worldView.x) * cam.zoom, y: (c.y - cam.worldView.y) * cam.zoom };
      }
      cb.onLayout(out, cam.zoom);
    }
    playArrival() {
      if (!this.arriving.length) {
        this.arrivalDone = true;
        cb.onArrival("done", []);
        return;
      }
      const ids = world.pieces.filter((p) => p.arriving).map((p) => p.id);
      cb.onArrival("playing", ids);
      const each = ARRIVAL_MS / this.arriving.length;
      this.arriving.forEach((img, i) => {
        if (this.textures.exists("build-puff")) {
          this.time.delayedCall(i * each, () => {
            if (this.arrivalDone) return;
            const puff = this.add.sprite(img.x, img.getData("finalY"), "build-puff").setScale(1 / ART_SCALE).setDepth(img.depth + 1).setOrigin(0.5, 0.875);
            puff.play("puff");
            puff.once("animationcomplete", () => puff.destroy());
          });
        }
        this.arrivalTweens.push(this.tweens.add({ targets: img, alpha: 1, y: img.getData("finalY"), delay: i * each + 150, duration: Math.max(400, each - 150), ease: "Back.easeOut", onComplete: () => i === this.arriving.length - 1 && this.finishArrival() }));
      });
    }
    finishArrival() {
      if (this.arrivalDone) return;
      this.arrivalDone = true;
      cb.onArrival("done", world.pieces.filter((p) => p.arriving).map((p) => p.id));
    }
    skipArrival() {
      if (this.arrivalDone) return;
      for (const t of this.arrivalTweens) t.stop();
      for (const img of this.arriving) img.setAlpha(1).setY(img.getData("finalY"));
      this.finishArrival();
    }
    placeAt(t: Tile): string | null {
      return world.places.find((p) => p.tile.c === t.c && p.tile.r === t.r)?.id ?? null;
    }
    walkTo(place: string) {
      const target = world.places.find((p) => p.id === place);
      if (!target || this.walking) return;
      if (target.tile.c === this.at.c && target.tile.r === this.at.r) {
        cb.onArrive(place);
        return;
      }
      const route = walkPath(world.paths, this.at, target.tile);
      if (!route) return;
      this.queue = route.slice(1);
      this.walking = true;
      cb.onAvatar(this.at, true);
      this.next(() => cb.onArrive(place));
    }
    step(dir: "up" | "down" | "left" | "right") {
      if (this.walking) return;
      const want = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[dir];
      const walk = new Set(world.paths.map(keyOf));
      let best: Tile | null = null;
      let bestDot = 0.1;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { c: this.at.c + dc, r: this.at.r + dr };
        if (!walk.has(keyOf(n))) continue;
        const sx = (dc - dr) * HALF_W;
        const sy = (dc + dr) * HALF_H;
        const len = Math.hypot(sx, sy);
        const dot = (sx * want.x + sy * want.y) / len;
        if (dot > bestDot) {
          bestDot = dot;
          best = n;
        }
      }
      if (!best) return;
      this.queue = [best];
      this.walking = true;
      cb.onAvatar(this.at, true);
      this.next(() => {
        const pl = this.placeAt(this.at);
        if (pl) cb.onArrive(pl);
      });
    }
    next(done: () => void) {
      const t = this.queue.shift();
      if (!t) {
        this.walking = false;
        this.avatar.anims.stop();
        this.avatar.setFrame(this.row * 4);
        cb.onAvatar(this.at, false);
        done();
        return;
      }
      const dc = t.c - this.at.c;
      const dr = t.r - this.at.r;
      const dir = dc > 0 ? "se" : dc < 0 ? "nw" : dr > 0 ? "sw" : "ne";
      this.row = ["se", "sw", "ne", "nw"].indexOf(dir);
      if (this.avatar.anims.currentAnim?.key !== `walk-${dir}` || !this.avatar.anims.isPlaying) this.avatar.play(`walk-${dir}`);
      const c = centre(t);
      this.tweens.add({
        targets: this.avatar,
        x: c.x,
        y: c.y,
        duration: STEP_MS,
        onUpdate: () => this.avatar.setDepth(this.avatar.y + 1),
        onComplete: () => {
          this.at = t;
          cb.onAvatar(this.at, true);
          this.next(done);
        },
      });
    }
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#3fc1d4",
    scale: { mode: Phaser.Scale.NONE, width: Math.max(320, parent.clientWidth), height: Math.max(240, parent.clientHeight) },
    render: { antialias: true, roundPixels: false },
    audio: { noAudio: true },
    input: { keyboard: false },
    banner: false,
    scene: HomeScene,
  });
  // The canvas follows its container (the page layout decides the size; Phaser's own RESIZE mode only watches the window).
  const ro = new ResizeObserver(() => {
    const w = Math.max(320, parent.clientWidth);
    const h = Math.max(240, parent.clientHeight);
    if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
  });
  ro.observe(parent);
  return {
    walkTo: (place) => scene?.walkTo(place),
    step: (dir) => scene?.step(dir),
    skipArrival: () => scene?.skipArrival(),
    destroy: () => {
      ro.disconnect();
      game.destroy(true);
    },
  };
}
