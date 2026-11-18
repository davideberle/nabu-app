// Nov 18, 2026: the chess coach's spoken German lines in the recorded-narration pipeline.
import { describe, it } from "node:test";
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ADAPTIVE_CHESS_COACH_BUNDLE, ADAPTIVE_CHESS_COACH_LINES_DE } from "../data/adaptive-chess-coach/bundle.generated.ts";
import { renderChessDocument } from "./family-chess-content.ts";
import { CHESS_NARRATION_SLOT, chessClipMap, chessNarrationCatalog, chessVoiceScript, withChessLines } from "./family-chess-narration.ts";
import { asLearningContent } from "./family-learning-content.ts";
import { asIsabelContent } from "./family-learning-isabel.ts";
import { catalogCharacters, catalogKey, narrationCatalog, narrationId, storyCatalog } from "./family-learning-narration.ts";
import { isNarrationLineId, isPublicSafeScript } from "./family-narration-store.ts";

const content = (f: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${f}`, import.meta.url), "utf8"));
// Exactly what servedNarrationCatalog() composed before the chess lines (production 29bbea63).
function learningCatalog() {
  const isabel = narrationCatalog(asIsabelContent(content("isabel-workshop-v4.json"))).map((l) => ({ ...l, child: "isabel" as const }));
  const santiago = storyCatalog(asLearningContent(content("santiago-expedition-v9.json")), "santiago");
  return [...isabel, ...santiago];
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const LINES = ADAPTIVE_CHESS_COACH_LINES_DE;

describe("chess coach narration lines", () => {
  it("leaves every existing learning catalogue line (ids, texts, slots, tags) exactly as on production", () => {
    const base = learningCatalog();
    equal(base.length, 378);
    equal(sha(base.map(catalogKey).join("\n")), "d9e2783472896708d7ab190c57425d0bce294cba5c0c1001217c1014b9663f6f");
    equal(sha(JSON.stringify(base)), "a0ee3c9be04c71d97aa6ea17dd8c5d7bc2daf083ae4170b21f668353a54f7050");
    const served = withChessLines(base, LINES);
    deepStrictEqual(served.slice(0, base.length), base, "the learning lines come first, unchanged");
    equal(served.length, base.length + Object.keys(LINES).length);
  });

  it("adds each chess line once, in the de-female slot, tagged chess, name-free and recordable", () => {
    const chess = chessNarrationCatalog(LINES);
    equal(chess.length, 30);
    equal(new Set(chess.map(catalogKey)).size, 30, "no two chess keys share a recording");
    for (const l of chess) {
      equal(l.slot, "de-female");
      ok(l.where?.[0] === "chess" && l.where[1].startsWith("chess:"));
      equal(l.child, undefined);
      ok(isNarrationLineId(l.id));
      ok(isPublicSafeScript(l.text), `recordable (no child name): ${l.text}`);
      equal(l.text, LINES[l.where![1].slice(6)]);
      ok(!/ß/.test(l.text), "Swiss spelling");
    }
    const chars = catalogCharacters(chess);
    equal(chars, 1394);
    ok(chars < 1500);
  });

  it("refuses a chess line that duplicates a learning line in the same slot", () => {
    const base = learningCatalog();
    const clash = base.find((l) => l.slot === "de-female")!;
    throws(() => withChessLines(base, { "nudge.x": clash.text }), /duplicates/);
  });

  it("maps every key to the clip route of a catalogued (slot, id) pair", () => {
    const served = new Set(withChessLines(learningCatalog(), LINES).map(catalogKey));
    const clips = chessClipMap(LINES);
    deepStrictEqual(Object.keys(clips).sort(), Object.keys(LINES).sort());
    for (const [key, url] of Object.entries(clips)) {
      equal(url, `/api/family/learning/narration/${CHESS_NARRATION_SLOT}/${narrationId(LINES[key])}`);
      ok(served.has(`${CHESS_NARRATION_SLOT}|${narrationId(LINES[key])}`), `${key} is answered by the clip route`);
    }
  });

  it("the embedded line map is the bundled chess-lines-de.js and every key the game can speak", () => {
    const src = ADAPTIVE_CHESS_COACH_BUNDLE["chess-lines-de.js"];
    for (const [k, v] of Object.entries(LINES)) ok(src.includes(`"${k}": ${JSON.stringify(v)}`), k);
    const coach = ADAPTIVE_CHESS_COACH_BUNDLE["chess-coach.js"] + ADAPTIVE_CHESS_COACH_BUNDLE["chess-ui.js"];
    for (const prefix of ["intro.", "idea.", "nudge.", "choice.", "recap.", "next."]) ok(Object.keys(LINES).some((k) => k.startsWith(prefix)), prefix);
    ok(!/speechSynthesis|SpeechSynthesisUtterance/.test(coach), "the game never uses the device voice");
  });

  it("the served document carries the clip map before the game scripts", () => {
    const html = renderChessDocument(ADAPTIVE_CHESS_COACH_BUNDLE, "<script>/*guard*/</script>" + chessVoiceScript(LINES));
    const voiceAt = html.indexOf("window.__CHESS_VOICE__=");
    ok(voiceAt > 0 && voiceAt < html.indexOf('data-chess-asset="chess-ui.js"'));
    ok(html.indexOf('data-chess-asset="chess-lines-de.js"') < html.indexOf('data-chess-asset="chess-coach.js"'), "lines load before the coach");
    const json = /window\.__CHESS_VOICE__=Object\.freeze\((.*?)\);<\/script>/.exec(html)![1];
    const voice = JSON.parse(json);
    equal(voice.rate, 0.85);
    deepStrictEqual(voice.clips, chessClipMap(LINES));
    ok(!chessVoiceScript({ "intro.x": "</script><b>" }).includes("</script><b>"), "script-safe JSON");
  });
});
