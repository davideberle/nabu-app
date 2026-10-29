// ---------------------------------------------------------------------------------------------------------------------
// Visit narration (Isabel Visit 2, 2026-10-29; I2-04 / I2-05 / I2-06) — WHAT is spoken, as one pure, testable function.
//
// The standard (folded into the learning contract): after a deliberate start, every scene speaks its essential instruction,
// its feedback and its ending BY ITSELF — once per state — with one replay/stop control instead of a speech button per line.
// The visible text stays short and next to the task. Narration never advances anything: the child still taps.
//
// What is never spoken (I2-05), enforced here and covered by unit tests:
//  - a reading word, its letters or the picture options of a reading question BEFORE her attempt — the word is spoken only
//    after the supported letter help was recorded, or after the attempt (correct, or shown after the misses);
//  - the options of a listening question (the listening sentence itself is the task's own recorded play, not narration);
//  - a math answer before it was answered or taught (questions, recheck/stuck lines and hints carry no answer; the
//    «Richtig! 32 Stäbe.» line exists only after her own correct answer, the worked teaching only after it was shown).
// The child's own typed numbers are never spoken (an «Das ist wieder 12.» repeat prefix stays visible only).
//
// Every line this module can produce for a narrated mission is in `narrationCatalog(content)` — a finite, reviewed set built
// from the content and the engine's fixed templates. Only catalogued lines can ever be prerecorded (no free text reaches a
// voice provider). Isomorphic and dependency-free (node --test).
// ---------------------------------------------------------------------------------------------------------------------

import type { LearningContent } from "./family-learning-content.ts";
import type { MissionActiveView, MissionView } from "./family-learning-mission.ts";
import type { MissionDef } from "./family-learning-mission-spec.ts";
import { characterGender, isVoiceSlot, slotFor, type VoiceSlot } from "./family-voice-registry.ts";

/**
 * `slot`: the story voice slot that speaks the line (six-slot registry). The recording of a line is keyed by slot AND text: the
 * same words in two voices are two recordings. `where` (catalogue only): the screens that speak it.
 */
export type NarrationLine = { id: string; text: string; slot?: VoiceSlot; where?: string[]; /** Catalogue only: whose visits speak it. */ child?: "isabel" | "santiago" };
/** One screen's narration: `key` changes exactly when something new should be said (a new beat, a new answer, a new hint). */
export type NarrationScript = { key: string; lines: NarrationLine[] };

/** Fixed child-facing lines of the narrated screens (also the visible wording). */
export const NARRATION_UI = {
  readCorrect: "Richtig.",
  readCorrectWithLetters: "Richtig — zusammen mit den Buchstaben.",
  readGiven: (word: string) => `Das Wort heisst: ${word}.`,
  listenCorrect: "Richtig.",
  listenGiven: (answer: string) => `Gemeint war: ${answer}.`,
  practiceNow: "Trag die Zahl jetzt selbst ein.",
  noOpenNext: "Gleich wählst du, was du nächstes Mal machen möchtest.",
  closingDifficulty: "Wie war es heute?",
  closingEnjoyment: "Hat es dir Spass gemacht?",
  ownIdea: "Oder sag Papa oder Mama deine eigene Idee.",
  thenFinish: "Dann tipp auf «Fertig».",
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Stable line ids (cyrb53 with two seeds over the normalised UTF-8 text): the same text always has the same id, client and
// server. Not a security property — the clip route serves only catalogued ids.
// ---------------------------------------------------------------------------------------------------------------------

export function normaliseNarration(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function cyrb53(bytes: Uint8Array, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function narrationId(text: string): string {
  const bytes = new TextEncoder().encode(normaliseNarration(text));
  return `n${cyrb53(bytes, 0)}${cyrb53(bytes, 0x9e3779b9)}`;
}

export const line = (text: string, slot?: VoiceSlot | null): NarrationLine => ({ id: narrationId(text), text: normaliseNarration(text), ...(slot ? { slot } : {}) });
const linesIn = (slot: VoiceSlot | null) => (texts: (string | null | undefined)[]): NarrationLine[] => texts.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => line(t, slot));
/** The story voice slot of a narrated mission (its one story character), or null. */
export const missionSlot = (m: { characters?: { voice?: unknown }[] } | null | undefined): VoiceSlot | null => (isVoiceSlot(m?.characters?.[0]?.voice) ? (m!.characters![0].voice as VoiceSlot) : null);

/** The child's own typed number repeated back («Das ist wieder 12. ») stays visible but is never spoken. */
export const stripRepeat = (text: string) => text.replace(/^Das ist wieder [^.]{1,12}\.\s*/, "");

/** A mission narrates by itself only when its content asks for it (Isabel Visit 2+); every other mission is unchanged. */
export function narrated(m: Pick<MissionView, "narration"> | Pick<MissionDef, "narration"> | null | undefined): boolean {
  return m?.narration?.mode === "auto";
}

// ---------------------------------------------------------------------------------------------------------------------
// The script of the current mission screen
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `seenParts`: counting questions already resolved whose success the child has moved past (the UI's «Nächste Frage»).
 * Returns null when there is nothing to say (no open beat).
 */
export function missionNarration(mission: MissionView, seenParts: readonly string[] = []): NarrationScript | null {
  if (!narrated(mission)) return null;
  const a = mission.active;
  if (!a) return null;
  const lines = linesIn(missionSlot(mission));
  const finished = a.status !== "active";
  const keyParts: (string | number)[] = [a.id, a.status];
  let out: NarrationLine[] = [];
  switch (a.kind) {
    case "story":
      out = lines(finished ? a.done.map((l) => l.text) : a.intro.map((l) => l.text));
      break;
    case "outcome":
      out = finished ? lines(a.done.map((l) => l.text)) : lines([...a.intro.map((l) => l.text), a.recap, a.ending?.success, a.ending?.next]);
      break;
    case "decide": {
      const d = a.decide;
      const chosen = d?.picked.find((p) => p.viable) ?? null;
      keyParts.push(d?.chosen ?? "");
      out = chosen ? lines([chosen.feedback, ...(finished ? a.done.map((l) => l.text) : [])]) : lines(a.intro.map((l) => l.text));
      break;
    }
    case "solve": {
      const sv = a.solve;
      if (!sv) break;
      const resolved = sv.parts.filter((p) => p.status !== "open");
      const lastResolved = resolved[resolved.length - 1] ?? null;
      const waiting = !finished && lastResolved && !seenParts.includes(lastResolved.id) && sv.parts.some((p) => p.status === "open") ? lastResolved : null;
      const current = waiting ? null : sv.parts.find((p) => p.status === "open") ?? null;
      const first = sv.parts[0];
      if (waiting) {
        keyParts.push(waiting.id, "waiting");
        out = lines([waiting.feedback ? stripRepeat(waiting.feedback.text) : null]);
      } else if (current) {
        const lastHint = current.hints[current.hints.length - 1] ?? null;
        // The hint is the newest thing on screen when no answer came after it was opened.
        const hintLatest = !!lastHint && (lastHint.afterAttempts === undefined || lastHint.afterAttempts >= current.tries);
        keyParts.push(current.id, current.tries, current.phase, current.hints.length, lastHint?.check?.result ?? "");
        if (current.phase === "taught") out = lines([current.teach, NARRATION_UI.practiceNow, current.feedback?.tone === "practice-wrong" ? current.feedback.text : null]);
        else if (hintLatest && lastHint && (lastHint.check === null || lastHint.check.result === null)) out = lines([lastHint.text, lastHint.check?.prompt]);
        else if (hintLatest && lastHint?.check?.result) out = lines([lastHint.check.reply, current.question]);
        else if (current.feedback && current.tries > 0) out = lines([stripRepeat(current.feedback.text)]);
        else out = lines([...(current === first && current.tries === 0 ? a.intro.map((l) => l.text) : []), current.question]);
      } else if (finished) {
        out = lines([lastResolved?.feedback ? stripRepeat(lastResolved.feedback.text) : null, ...a.done.map((l) => l.text)]);
      }
      break;
    }
    case "read": {
      const q = a.questions[0];
      const shown = a.letters?.shown ?? null;
      keyParts.push(q?.status ?? "", q?.tries ?? 0, shown ? "letters" : "");
      if (!q) break;
      if (q.status === "open") {
        // Before the attempt: the instruction only. The letters (and so the word) only after the recorded switch.
        if (shown) out = lines([shown.spoken, shown.teach, q.hint]);
        else out = lines(q.tries ? [q.hint] : a.intro.map((l) => l.text));
      } else {
        out = lines([q.status === "correct" ? (shown ? NARRATION_UI.readCorrectWithLetters : NARRATION_UI.readCorrect) : NARRATION_UI.readGiven(q.shownAnswer ?? ""), ...(finished ? a.done.map((l) => l.text) : [])]);
      }
      break;
    }
    case "listen": {
      const q = a.questions[0];
      keyParts.push(q?.status ?? "", q?.tries ?? 0);
      if (!q) break;
      if (q.status === "open") out = lines(q.tries ? [q.hint] : a.intro.map((l) => l.text));
      else out = lines([q.status === "correct" ? NARRATION_UI.listenCorrect : NARRATION_UI.listenGiven(q.shownAnswer ?? ""), ...(finished ? a.done.map((l) => l.text) : [])]);
      break;
    }
    case "craft":
      out = finished ? lines(a.done.map((l) => l.text)) : lines([...a.intro.map((l) => l.text), ...(a.craft?.tasks ?? []).map((t) => t.text), a.craft?.find?.prompt]);
      break;
    default:
      out = lines((finished ? a.done : a.intro).map((l) => l.text));
  }
  if (!out.length) return null;
  return { key: `${mission.id}|${keyParts.join("|")}|${out.map((l) => l.id).join(",")}`, lines: out };
}

/**
 * The closing screens' spoken lines — ONE source for the screen and the catalogue. Each question, its pictured answers and
 * the honest ways out (skip / «weiss ich noch nicht» / «lieber nicht sagen») are spoken so she can answer without reading.
 */
export type ClosingSource = {
  reflection: { prompt: string; options: { label: string }[]; skipLabel?: string; dimensions?: { id: string; prompt: string; options: { label: string }[]; skipLabel: string }[]; nextInterest?: { prompt: string; unsureLabel: string; declineLabel: string } | null };
  adventure: { prompt: string; choices: { label: string }[] } | null;
};
export function closingLines(kind: "difficulty" | "enjoyment" | "next", src: ClosingSource): string[] {
  const r = src.reflection;
  if (kind === "difficulty") return [r.prompt, ...r.options.map((o) => o.label), r.skipLabel ?? "Lieber nicht sagen"];
  if (kind === "enjoyment") {
    const d = (r.dimensions ?? []).find((x) => x.id === "enjoyment");
    return d ? [d.prompt, ...d.options.map((o) => o.label), d.skipLabel] : [];
  }
  return [src.adventure?.prompt ?? r.nextInterest?.prompt ?? "", ...(src.adventure?.choices ?? []).map((c) => c.label), NARRATION_UI.ownIdea, r.nextInterest?.unsureLabel ?? "Weiss ich noch nicht", r.nextInterest?.declineLabel ?? "Lieber nicht sagen", NARRATION_UI.thenFinish].filter(Boolean);
}

/** The closing questions, one per screen (the same lines the screen shows). */
export function closingNarration(kind: "difficulty" | "enjoyment" | "next" | "farewell", content: { prompt: string; options: { label: string }[] } | { lines: string[] }, slot: VoiceSlot | null = null): NarrationScript {
  const lines = linesIn(slot);
  const out = "lines" in content ? lines(content.lines) : lines([content.prompt, ...content.options.map((o) => o.label)]);
  return { key: `closing|${kind}|${slot ?? ""}|${out.map((l) => l.id).join(",")}`, lines: out };
}

// ---------------------------------------------------------------------------------------------------------------------
// The catalogue: every line a narrated mission of this content can produce (for prerecording and the clip route's allow-list)
// ---------------------------------------------------------------------------------------------------------------------

export function narrationCatalog(content: LearningContent): NarrationLine[] {
  const out = new Map<string, NarrationLine>();
  let where = "";
  let slot: VoiceSlot | null = null;
  const add = (t: string | null | undefined) => {
    if (typeof t === "string" && t.trim()) {
      const l = line(t, slot);
      const k = `${slot ?? ""}|${l.id}`;
      const prev = out.get(k);
      out.set(k, { ...l, where: [...new Set([...(prev?.where ?? []), where])] });
    }
  };
  const missions = (content.missions ?? []).filter((m) => narrated(m));
  if (!missions.length) return [];
  for (const m of missions) {
    slot = missionSlot(m);
    for (const s of m.steps) {
      where = s.id;
      for (const l of [...(s.intro ?? []), ...(s.done ?? []), ...Object.values(s.doneBy ?? {}).flat()]) add(l?.text);
      for (const o of s.decide?.options ?? []) add(o.feedback);
      for (const p of s.solve?.parts ?? []) {
        add(p.question);
        add(p.recheck);
        add(p.stuck);
        add(p.teach);
        add(`Richtig! ${p.answer} ${p.unit}.`);
        add(`Genau, ${p.answer} ${p.unit}. Das haben wir zusammen gelöst.`);
        for (const h of p.hints ?? []) {
          add(h.text);
          add(h.check?.prompt);
          add(h.check?.correct);
          add(h.check?.wrong);
        }
      }
      if (s.solve) {
        add("Das heben wir fürs nächste Mal auf.");
        add("Das stimmt noch nicht. Heb die Frage fürs nächste Mal auf.");
        add("Noch nicht. Schau die Lösung oben noch einmal an und trag die Zahl ein.");
        add(NARRATION_UI.practiceNow);
      }
      for (const q of s.questions ?? []) {
        add(q.retryHint);
        if (s.kind === "read") add(NARRATION_UI.readGiven(String(q.answer)));
        if (s.kind === "listen") add(NARRATION_UI.listenGiven(String(q.answer)));
      }
      if (s.kind === "read") {
        add(NARRATION_UI.readCorrect);
        add(NARRATION_UI.readCorrectWithLetters);
        add(s.letters?.spoken);
        add(s.letters?.teach);
      }
      if (s.kind === "listen") {
        add(NARRATION_UI.listenCorrect);
        // The listening sentence itself: played only on her explicit, recorded tap — never as automatic narration.
        add(s.text?.body);
      }
      for (const t of s.craft?.tasks ?? []) add(t.text);
      add(s.craft?.find?.prompt);
      add(s.ending?.success);
      add(s.ending?.open);
    }
    where = m.steps.find((x) => x.kind === "outcome")?.id ?? "outcome";
    for (const w of m.world) add(w.label);
    add(NARRATION_UI.noOpenNext);
    // The closing screens and the goodbye of this mission's visit — the same functions the screens use.
    const src: ClosingSource = { reflection: content.reflection as ClosingSource["reflection"], adventure: m.nextAdventure ?? null };
    for (const k of ["difficulty", "enjoyment", "next"] as const) {
      where = `closing-${k}`;
      for (const t of closingLines(k, src)) add(t);
    }
    where = "farewell";
    for (const t of farewellLines(content, m)) add(t);
  }
  return [...out.values()].sort((x, y) => (`${x.slot}|${x.id}` < `${y.slot}|${y.id}` ? -1 : 1));
}

/**
 * The story lines a NON-narrated mission speaks today (Santiago's scenes; unchanged presentation): every foreign-language bubble
 * line of a `scene` mission (its «Anhören») and every listening message (all presentations), each in the slot of the LINE'S OWN
 * language × its speaking character's gender. German bubble lines are read, not spoken, in his scenes — so they are not recorded.
 * A line whose character has no known gender, or an assistant, gets no slot and is not catalogued (it keeps its earlier route).
 */
export function storyCatalog(content: LearningContent, child: "isabel" | "santiago"): NarrationLine[] {
  const out = new Map<string, NarrationLine>();
  const add = (text: string | null | undefined, speaker: string | null | undefined, language: string | null | undefined, m: MissionDef, where: string) => {
    if (typeof text !== "string" || !text.trim()) return;
    const character = m.characters.find((c) => c.id === speaker) ?? null;
    const slot = slotFor(characterGender(content.contentId, character), language);
    if (!slot) return;
    const l = line(text, slot);
    const k = catalogKey(l);
    const prev = out.get(k);
    out.set(k, { ...l, child, where: [...new Set([...(prev?.where ?? []), where])] });
  };
  for (const m of (content.missions ?? []).filter((x) => !narrated(x))) {
    for (const st of m.steps) {
      const where = `${child}:${m.visit}/${st.id}`;
      if (m.presentation === "scene") for (const l of [...(st.intro ?? []), ...(st.done ?? []), ...Object.values(st.doneBy ?? {}).flat()]) if (l && l.language !== "de") add(l.text, l.speaker, l.language, m, where);
      if (st.kind === "listen" && st.text) add(st.text.body, st.character, st.text.language, m, where);
    }
  }
  return [...out.values()].sort((x, y) => (catalogKey(x) < catalogKey(y) ? -1 : 1));
}

/** The catalogue key of a line (slot + text id). */
export const catalogKey = (l: { slot?: string | null; id: string }) => `${l.slot ?? ""}|${l.id}`;

/** The spoken goodbye of a narrated mission: its outcome's reviewed done lines + the visit's saved line. */
export function farewellLines(content: LearningContent, m: MissionDef): string[] {
  const outcome = m.steps.find((x) => x.kind === "outcome");
  const done = (content.visits.find((v) => v.id === m.visit) as { childText?: { done?: string } } | undefined)?.childText?.done;
  return [...(outcome?.done ?? []).map((l) => l.text), ...(done ? [done] : [])];
}

/** Total characters of a catalogue (the unit a TTS provider bills; cost = characters × the provider's current rate). */
export function catalogCharacters(c: NarrationLine[]): number {
  return c.reduce((n, l) => n + l.text.length, 0);
}

export type { MissionActiveView };
