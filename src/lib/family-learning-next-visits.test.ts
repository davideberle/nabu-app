// Nov 8: Santiago Visit 10 «Die Schildkröte» and Isabel Visit 4 «Ein Zuhause für die Vögel». Every number here is NEXT-VISITS.md:
// the test reads the served content and recomputes each answer from the numbers on the screen. Fictional and offline.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent } from "./family-learning-content.ts";
import { asIsabelContent } from "./family-learning-isabel.ts";
import { deriveHomeWorld, WORLDS } from "./family-home-map.ts";
import { ASSETS } from "./family-home-map-assets.ts";
import { fillStoryTokens, sanitizeStoryName } from "./family-learning-mission.ts";
import { narrationCatalog, NARRATION_UI, storyCatalog } from "./family-learning-narration.ts";
import { resolveObjective } from "./family-learning-skill-map.ts";

const rd = (n: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${n}`, import.meta.url), "utf8"));
const s9 = asLearningContent(rd("santiago-expedition-v9.json"));
const i4 = asIsabelContent(rd("isabel-workshop-v4.json"));
const turtle = s9.missions!.find((m) => m.visit === "v11")!;
const birds = i4.missions!.find((m) => m.visit === "v5")!;
const st = (m: typeof turtle, id: string) => m.steps.find((s) => s.id === id)!;
const solve = (m: typeof turtle, id: string, part: string) => st(m, id).solve!.parts.find((p) => p.id === part)!;

describe("Santiago Visit 10 — every number recomputed", () => {
  const around = (a: number, b: number) => 2 * (a + b);
  it("warm-ups", () => {
    equal(solve(turtle, "T2-AROUND", "around").answer, around(5, 3));
    equal(solve(turtle, "T2-AROUND", "around").answer, 16);
    equal(solve(turtle, "T2G-GRID", "all").answer, 6 * 4);
    deepEqual(solve(turtle, "T2G-GRID", "all").calculation, { factors: [6, 4] });
    ok(st(turtle, "T2S-TUBO").produce!.keywords.includes("tubo"));
    ok(st(turtle, "T2S-TUBO").produce!.bankAfterAttempt, "word list only after one miss");
  });
  it("every warm-up is under the delayed-retention rule", () => {
    for (const id of ["T2-AROUND", "T2G-GRID", "T2S-TUBO"]) ok(st(turtle, id).warmup?.taughtIn.length, id);
  });
  it("area versions: normal, easier, harder", () => {
    equal(solve(turtle, "T4-AREA", "all").answer, 12);
    equal(solve(turtle, "T4E-SMALL", "all").answer, 6);
    equal(solve(turtle, "T4H-BEACH", "all").answer, 16);
  });
  it("stones: 14 m, 14 stones; easier 10 m; harder one every 50 cm is 28", () => {
    equal(solve(turtle, "T5-STONES", "around").answer, around(4, 3));
    equal(solve(turtle, "T5-STONES", "stones").answer, 14);
    equal(solve(turtle, "T5E-SMALL", "around").answer, around(3, 2));
    equal(solve(turtle, "T5H-HALF", "half").answer, (14 * 100) / 50);
  });
  it("the spot: only A keeps both rules (shade, at most 3 × 4 m = 12 m)", () => {
    const spots = [["a", true, 8], ["b", true, 15], ["c", false, 6]] as const;
    const d = st(turtle, "T6-SPOT").decide!;
    for (const [id, shade, m] of spots) equal(d.options.find((o) => o.id === id)!.viable, shade && m <= 3 * 4, id);
    equal(d.noktAfterWrong, 2);
  });
  it("listening answers are on the option list and in the audio", () => {
    const t3 = st(turtle, "T3-MATEO");
    ok(/cuatro metros de largo y tres metros de ancho/.test(t3.text!.body));
    equal(t3.questions![0].answer, "4 m lang, 3 m breit");
    ok(/un metro de hondo/.test(st(turtle, "T3H-DEPTH").text!.body));
    ok(/next to the pond/.test(st(turtle, "T7-JUNE").text!.body) && /behind the crate/.test(st(turtle, "T7-JUNE").text!.body));
    ok(/between the pond and the tree/.test(st(turtle, "T7H-BETWEEN").text!.body));
    ok(st(turtle, "T8-PIEDRAS").produce!.keywords.includes("piedras"));
    for (const id of ["T3-MATEO", "T3E-LENGTH", "T3H-DEPTH", "T7-JUNE", "T7H-BETWEEN"]) for (const q of st(turtle, id).questions!) { ok(q.options!.includes(q.answer), q.id); for (const o of q.options!) ok(q.pictures?.[o], `${id}/${o}`); }
  });
  it("Dr. Mateo: es-male, Spanish only, and the turtle on every scene", () => {
    const vet = turtle.characters.find((c) => c.id === "vet")!;
    equal(vet.voice, "es-male");
    for (const s of turtle.steps) for (const l of [...s.intro, ...s.done]) if (l.speaker === "vet") equal(l.language, "es");
    equal(turtle.companion?.id, "turtle");
  });
  it("no next-visit question: the name is the choice", () => {
    equal(turtle.noNextChoice, true);
    equal(turtle.nextAdventure, undefined);
    equal(st(turtle, "T11-NAME").decide!.storyKey, "turtleName");
  });
  it("home task, cliffhanger, no craft", () => {
    ok(/4 m/.test(st(turtle, "T12-END").home!.text));
    equal(turtle.closing?.cliffhanger, "Morgen muss Wasser in den Teich. Aber wie viel braucht er?");
    ok(!turtle.steps.some((s) => s.kind === "craft"));
  });
});

describe("Isabel Visit 4 — every number recomputed from what she sees", () => {
  const c = (id: string, p: string) => solve(birds, id, p).counters!;
  it("bundles are 10 each", () => {
    equal(solve(birds, "IV2-WARM", "sticks").answer, 4 * 10 + 5);
    equal(solve(birds, "IV2E-WARM-EASY", "sticks").answer, 2 * 10 + 3);
    equal(solve(birds, "IV3-WALLS", "walls").answer, 2 * 10 + 6);
    equal(solve(birds, "IV3E-WALLS-EASY", "walls").answer, 1 * 10 + 3);
  });
  it("the missing part", () => {
    for (const [id, have, need, ans] of [["IV4-ENOUGH", 26, 30, 4], ["IV4E-ENOUGH-EASY", 8, 10, 2], ["IV4H-ENOUGH-MORE", 26, 40, 14]] as const) {
      equal(solve(birds, id, "more").answer, ans);
      equal(need - have, ans, id);
      equal(c(id, "more").a, have);
      equal(c(id, "more").frame, need);
    }
  });
  it("nails", () => {
    equal(solve(birds, "IV5-NAILS", "nails").answer, 8 + 5);
    equal(solve(birds, "IV5E-NAILS-EASY", "nails").answer, 6 + 3);
    equal(solve(birds, "IV5H-NAILS-MORE", "nails").answer, 8 + 6);
  });
  it("reading: NEST (retrieval), VOGEL, HAUS, EIN VOGELHAUS; letters only after a miss", () => {
    deepEqual(["IV2N-NEST", "IV6-VOGEL", "IV7-HAUS", "IV8-PHRASE"].map((id) => st(birds, id).text!.body), ["NEST", "VOGEL", "HAUS", "EIN VOGELHAUS"]);
    for (const id of ["IV2N-NEST", "IV6-VOGEL", "IV7-HAUS", "IV8-PHRASE"]) equal(st(birds, id).letters?.afterMiss, true);
    ok(st(birds, "IV2N-NEST").warmup, "a retrieval under the delayed rule");
  });
  it("listening has three details and four pictures", () => {
    const l = st(birds, "IV9-LISTEN");
    ok(/grossen Baum/.test(l.text!.body) && /hoch oben/.test(l.text!.body) && /neben das Fenster/.test(l.text!.body));
    equal(l.questions![0].options!.length, 4);
  });
  it("roof color is a story choice; the next step is pictures inside the arc", () => {
    const d = st(birds, "IV10-ROOF").decide!;
    equal(d.storyKey, "roofColor");
    deepEqual(d.options.map((o) => o.id), ["red", "blue", "yellow"]);
    deepEqual(birds.nextAdventure!.choices.map((x) => x.id), ["food", "nest", "bath"]);
    equal(birds.closing?.prompt, "Wie leicht war es?");
    ok(birds.closing?.liked);
  });
  it("cliffhanger and home task", () => {
    deepEqual(st(birds, "IV11-HOME").done.map((l) => l.text), ["Schau! Die zwei Vögel landen auf dem Dach.", "Ob sie einziehen?"]);
    ok(/Fenster/.test(st(birds, "IV11-HOME").home!.text) && !birds.steps.some((s) => s.kind === "craft"));
  });
});

describe("The chosen name", () => {
  it("letters only, 2 to 12, first letter capital", () => {
    equal(sanitizeStoryName("kira"), "Kira");
    equal(sanitizeStoryName("  ÉLA "), "Éla");
    for (const bad of ["a", "ab1", "Tu la", "<b>", "abcdefghijklm", 7, null, "x;y"]) equal(sanitizeStoryName(bad), null, String(bad));
  });
  it("shows on screen, and falls back before there is one", () => {
    const line = { text: "{Turtle} ruht. Wir füttern {turtle}." };
    deepEqual(fillStoryTokens(line, { turtleName: { value: "Kira" } }), { text: "Kira ruht. Wir füttern Kira." });
    deepEqual(fillStoryTokens(line, undefined), { text: "Die Schildkröte ruht. Wir füttern die Schildkröte." });
  });
  it("no recorded line carries a name or a placeholder", () => {
    const all = [...narrationCatalog(i4), ...storyCatalog(s9, "santiago")];
    for (const l of all) ok(!/[{}]|Tula|Pepe|Flip|Santi\b|Isabel/.test(l.text), l.text);
  });
});

describe("The new map pieces", () => {
  const input = (child: "santiago" | "isabel", visits: { id: string; finishedAt: string | null }[], current: string | null, choices = {}, story?: { turtleName?: { value: string } }) => ({ child, visits, choices, current: current ? { visit: current, mission: "M", places: [], start: null } : null, seen: [], story });
  const piece = (w: ReturnType<typeof deriveHomeWorld>, id: string) => w.pieces.find((p) => p.id === id);
  it("offered, not started: pond site, no crate yet", () => {
    const w = deriveHomeWorld(input("santiago", [], "v11"));
    equal(piece(w, "s-pond")?.asset, "s-pond-site");
    equal(piece(w, "s-turtle-crate"), undefined);
  });
  it("from the start of the visit the crate stands; after it the pond is dug", () => {
    const running = deriveHomeWorld(input("santiago", [{ id: "v11", finishedAt: null }], "v11"));
    equal(piece(running, "s-turtle-crate")?.asset, "s-turtle-crate-built");
    equal(piece(running, "s-pond")?.asset, "s-pond-site");
    equal(piece(deriveHomeWorld(input("santiago", [{ id: "v11", finishedAt: "2026-11-14T12:00:00Z" }], null)), "s-pond")?.asset, "s-pond-dug-built");
  });
  it("the crate's label is the chosen name", () => {
    equal(piece(deriveHomeWorld(input("santiago", [{ id: "v11", finishedAt: null }], "v11", {}, { turtleName: { value: "Kira" } })), "s-turtle-crate")?.label, "Kira");
  });
  it("the birdhouse follows her roof color and the robins circle it once the visit started", () => {
    for (const c of ["red", "blue", "yellow"]) equal(piece(deriveHomeWorld(input("isabel", [{ id: "v5", finishedAt: "2026-11-14T12:00:00Z" }], null, { "IV10-ROOF": c })), "i-birdhouse")?.asset, `i-birdhouse-${c}-built`);
    equal(deriveHomeWorld(input("isabel", [], "v5")).effects.length, 0);
    deepEqual(deriveHomeWorld(input("isabel", [{ id: "v5", finishedAt: null }], "v5")).effects.map((e) => e.asset), ["i-robins"]);
  });
  it("no path runs under a new piece, and every new place stands on a path", () => {
    for (const [child, ids] of [["santiago", ["s-pond", "s-turtle-crate"]], ["isabel", ["i-birdhouse"]]] as const) {
      const w = WORLDS[child];
      for (const id of ids) {
        const p = w.pieces.find((x) => x.id === id)!;
        for (let c = p.tile.c; c < p.tile.c + p.footprint.w; c += 1) for (let r = p.tile.r; r < p.tile.r + p.footprint.h; r += 1) ok(!w.paths.some((t) => t.c === c && t.r === r), `${id} ${c},${r}`);
        ok(w.paths.some((t) => t.c === w.places[p.place!].c && t.r === w.places[p.place!].r), p.place!);
      }
    }
  });
  it("every requested file is in the manifest", () => {
    const have = new Set(ASSETS.map((a) => a.id));
    for (const id of ["s-pond-site", "s-pond-dug-built", "s-turtle-crate-built", "i-birdhouse-site", "i-birdhouse-red-built", "i-birdhouse-blue-built", "i-birdhouse-yellow-built", "i-robins", "portrait-dr-mateo", "turtle-scene"]) ok(have.has(id), id);
  });
});

describe("Review of the lines and the mapping", () => {
  const all = [...narrationCatalog(i4), ...storyCatalog(s9, "santiago")].map((l) => l.text);
  it("the corrected lines are in the catalogue and the old wording is gone", () => {
    for (const t of ["La tortuga necesita un estanque tranquilo durante unas semanas.", "Da steht: Ein Vogelhaus.", "Ein. Vogel. Haus. Ein Vogelhaus.", "Dein Vogelhaus steht jetzt im Garten. Bis bald!", "Ida meinte: am grossen Baum, hoch oben, neben dem Fenster."]) ok(all.includes(t), t);
    for (const t of ["Das Wort heisst: Ein Vogelhaus.", "E. I. N. Vogel. Haus. Ein Vogelhaus.", "Dein Vogelhaus ist gespeichert.", "Gemeint war: Grosser Baum, hoch, neben dem Fenster."]) ok(!all.includes(t), t);
  });
  it("the default «given» wording still applies to single words", () => ok(all.includes(NARRATION_UI.readGiven("Vogel"))));
  it("no tech word in anything either visit says or shows", () => {
    const RX = /gespeichert|version|aufgabe|modus/i;
    const walk = (v: unknown, key: string): void => {
      if (typeof v === "string") ok(!RX.test(v) || ["objective", "note", "parentNote", "source"].includes(key), `${key}: ${v}`);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "theme" || k === "objective") continue; walk(x, k); }
    };
    walk(turtle, "");
    walk(birds, "");
    walk(s9.visits.find((v) => v.id === "v11"), "");
    walk(i4.visits.find((v) => v.id === "v5"), "");
  });
  it("Isabel's missing-part tasks sit on the agreed rows", () => {
    const row = (o: string) => { const r = resolveObjective("isabel", o, "de"); return r.kind === "row" ? r.row : r.kind; };
    equal(st(birds, "IV4-ENOUGH").objective, "complete-to-next-ten");
    equal(st(birds, "IV4H-ENOUGH-MORE").objective, "complete-to-next-ten");
    equal(row("complete-to-next-ten"), "i-tens");
    equal(row(st(birds, "IV4E-ENOUGH-EASY").objective), "i-sums");
  });
});
