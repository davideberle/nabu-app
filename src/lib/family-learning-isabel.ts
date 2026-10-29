// ---------------------------------------------------------------------------
// Isabel Visit 1 — «Old Lilas kleine Werkstatt» (approved by David, 2026-10-26 15:37; PROJECT.md I1-01…I1-09).
//
// Isabel's OWN content line (`isabel-workshop`, version 1): a separate reviewed document, reconciled here by its own rules,
// executed by the shared mission engine and stored in her own child-scoped record. It never inherits Santiago's course,
// visits, typing or outcomes, and Santiago's content rules (`reconcileLearningContent`) are untouched by it.
//
// What the validator enforces (each line maps to an acceptance requirement):
//  - I1-01  exactly one visit `v1` (mission → reflect), the companion is named «Old Lila»;
//  - I1-02  visually led: short instructions (≤ 2 lines of ≤ 110 characters per beat), every answer is a tap on a picture
//           or a number; no typing block, no sentence writing, no foreign-language production;
//  - I1-03  the materials task pictures a wooden chair, a glass windowpane and a brick wall with pictured materials, and no
//           line asserts what the family's own home is built of;
//  - I1-04  small visible sums first (5 + 2, 8 − 2), then ten-bundles (20 + 1) with hints only after the first try, a fresh
//           check (20 + 3) only when that was not independent, and an easier small-number path after it; every pictured
//           quantity agrees with its answer;
//  - I1-05  the reading word is never part of a spoken line before the attempt; supported letter/word learning exists;
//  - I1-06  a separate German listening instruction answered by tapping a picture;
//  - I1-07  a real-world craft with a pictured «three wooden things» search; no number about trees per house;
//  - I1-08  one outcome with her chosen room element and a factual recap; pictured next-interest choices; no praise lines
//           after practice/teaching.
// ---------------------------------------------------------------------------

import type { LearningContent } from "./family-learning-content.ts";
import { COUNTER_ICONS, WORKSHOP_PICTURES, type MissionDef, type MissionStep } from "./family-learning-mission-spec.ts";

export const ISABEL_CONTENT_ID = "isabel-workshop";
export const ISABEL_CONTENT_VERSIONS: readonly number[] = [1, 2];
export const ISABEL_MISSION_ID = "MISSION-OLD-LILA-WORKSHOP";
export const ISABEL_GARDEN_MISSION_ID = "MISSION-IDA-GARDEN";
/** Isabel's assistant identity (approved October 18). In Visit 1 she was also the story character; from Visit 2 on she is not. */
export const ISABEL_COMPANION = "Old Lila";
export const EXPECTED_WORKSHOP_STEPS: readonly string[] = ["W1-HELLO", "W2-MAKE", "W3-MATERIALS", "W4-COUNT", "W5-TENS", "W6-TENS-AGAIN", "W7-EASIER", "W8-READ", "W9-LISTEN", "W10-CRAFT", "W11-ROOM"];
export const EXPECTED_GARDEN_STEPS: readonly string[] = ["IG1-HELLO", "IG2-PLANT", "IG3-STICKS", "IG4-STICKS-AGAIN", "IG5-PLANTING", "IG6-PLANTING-EASIER", "IG7-READ", "IG8-LISTEN", "IG9-CRAFT", "IG10-GARDEN"];

/** What each of Isabel's missions must be (by visit). The generic rules below apply to all of them. */
type WorkshopSpec = {
  id: string;
  visit: string;
  steps: readonly string[];
  character: { id: string; name: string | null };
  place: string;
  decide: string;
  /** The tens retrieval, its fresh application (only when the retrieval was not independent) and what follows that application. */
  tens: string;
  tensAgain: string;
  /** The step that may only run when another one was not independent ([step, condition step]). */
  easier: [string, string];
  /** The world change prop that shows her choice. */
  worldProp: string;
  /** From Visit 2 on: automatic narration and a story character that is not her assistant. */
  narrated: boolean;
};
const SPECS: readonly WorkshopSpec[] = [
  { id: ISABEL_MISSION_ID, visit: "v1", steps: EXPECTED_WORKSHOP_STEPS, character: { id: "lila", name: ISABEL_COMPANION }, place: "workshop", decide: "W2-MAKE", tens: "W5-TENS", tensAgain: "W6-TENS-AGAIN", easier: ["W7-EASIER", "W6-TENS-AGAIN"], worldProp: "room", narrated: false },
  { id: ISABEL_GARDEN_MISSION_ID, visit: "v2", steps: EXPECTED_GARDEN_STEPS, character: { id: "ida", name: null }, place: "garden", decide: "IG2-PLANT", tens: "IG3-STICKS", tensAgain: "IG4-STICKS-AGAIN", easier: ["IG6-PLANTING-EASIER", "IG5-PLANTING"], worldProp: "garden", narrated: true },
];

const FORBIDDEN_KINDS = new Set(["typing-block", "write", "produce", "recall", "calc", "choice"]);
const MAX_LINES = 2;
const MAX_LINE_CHARS = 110;
const PRAISE = /muy bien|sehr gut|super|toll|perfekt|bravo|great|well done|klasse|prima/i;
/** A claim about what HER family's home is built of (I1-03: never asserted without evidence). */
const HOME_CLAIM = /\b(euer|eures|eurem|dein|deines|deinem|unser|unseres|unserem)\s+(haus|zuhause|wohnung)\s+(ist|sind|besteht|wurde)\b/i;
/** A trees-per-house estimate (I1-07: explored by finding wooden things, never a fabricated number). */
const TREES_NUMBER = /\d+\s*(bäume|baeume|baum)\b|bäume\s+(für|pro)\s+(ein|jedes)\s+haus/i;

export type IsabelReconciliation = { ok: boolean; version: number | null; problems: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const picture = (v: unknown) => typeof v === "string" && (WORKSHOP_PICTURES as readonly string[]).includes(v);

function linesOf(step: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const key of ["intro", "done"]) if (Array.isArray(step[key])) out.push(...(step[key] as unknown[]).filter(isRecord));
  if (isRecord(step.doneBy)) for (const v of Object.values(step.doneBy)) if (Array.isArray(v)) out.push(...v.filter(isRecord));
  return out;
}

/** Pictured quantity of a counting question: `a ± b`, or — asking for the missing part to a full frame — `b`. */
function countersValue(c: Record<string, unknown>): number {
  if (c.ask === "missing") return Number(c.b);
  return c.op === "+" ? Number(c.a) + Number(c.b) : Number(c.a) - Number(c.b);
}

/** The answers of every ten-bundle question of a mission (I2-03: a later visit must not re-ask the same quantity as "fresh"). */
function bundleAnswers(m: Record<string, unknown>): number[] {
  const steps = Array.isArray(m.steps) ? (m.steps as unknown[]).filter(isRecord) : [];
  return steps.flatMap((s) => (isRecord(s.solve) && Array.isArray(s.solve.parts) ? s.solve.parts.filter(isRecord) : []).filter((p) => isRecord(p.counters) && p.counters.bundles === true).map((p) => Number(p.answer)));
}
const readWord = (m: Record<string, unknown>) => ((Array.isArray(m.steps) ? (m.steps as unknown[]).filter(isRecord) : []).find((s) => s.kind === "read" && isRecord(s.text))?.text as Record<string, unknown> | undefined)?.body;

export function checkWorkshopMission(m: unknown, problems: string[], spec: WorkshopSpec = SPECS[0], earlier: Record<string, unknown>[] = []): void {
  if (!isRecord(m)) {
    problems.push("workshop mission missing");
    return;
  }
  const label = `mission ${String(m.id)}`;
  if (m.id !== spec.id) problems.push(`${label}: the workshop mission id must be ${spec.id}`);
  if (m.visit !== spec.visit) problems.push(`${label}: this mission belongs to visit ${spec.visit}`);
  if (m.presentation !== "workshop") problems.push(`${label}: presentation must be workshop`);
  if ("typingBlock" in m) problems.push(`${label}: Isabel's workshop has no typing block (no typing is asked of her)`);
  const chars = Array.isArray(m.characters) ? m.characters.filter(isRecord) : [];
  const ch = chars[0];
  if (chars.length !== 1 || ch.id !== spec.character.id || ch.language !== "de" || !str(ch.name) || (spec.character.name !== null && ch.name !== spec.character.name)) problems.push(`${label}: exactly one character, ${spec.character.name ? `«${spec.character.name}» ` : ""}(id ${spec.character.id}), speaking German`);
  if (spec.narrated) {
    // I2-02: the story character is never her assistant; Old Lila is not re-cast as a gardener, teacher or narrator.
    if (ch && (ch.id === "lila" || /old\s*lila/i.test(String(ch.name)))) problems.push(`${label}: the story character must not be Old Lila (her assistant)`);
    const n = isRecord(m.narration) ? m.narration : null;
    if (!n || n.mode !== "auto") problems.push(`${label}: narration.mode must be auto (spoken after the deliberate start, one replay/stop control)`);
  } else if ("narration" in m) problems.push(`${label}: Visit 1 stays exactly as released (no narration block)`);
  const map = isRecord(m.map) ? m.map : null;
  const places = Array.isArray(map?.places) ? (map!.places as unknown[]).filter(isRecord) : [];
  if (places.length !== 1 || places[0].id !== map?.start || map?.start !== spec.place) problems.push(`${label}: one place (${spec.place}), which is the start`);
  const steps = Array.isArray(m.steps) ? (m.steps as unknown[]).filter(isRecord) : [];
  const ids = steps.map((s) => String(s.id));
  if (ids.join(",") !== spec.steps.join(",")) problems.push(`${label}: steps must be exactly ${spec.steps.join(", ")} in this order`);
  const byId = new Map(steps.map((s) => [String(s.id), s]));
  for (const s of steps) {
    const sl = `${label}/${String(s.id)}`;
    if (s.version !== 1) problems.push(`${sl}: version must be 1`);
    if (FORBIDDEN_KINDS.has(String(s.kind))) problems.push(`${sl}: ${String(s.kind)} is not part of Isabel's visually led visit`);
    if (s.place !== map?.start) problems.push(`${sl}: every beat is in the ${spec.place}`);
    if (s.character !== null && s.character !== spec.character.id) problems.push(`${sl}: only ${String(ch?.name ?? spec.character.id)} speaks`);
    if (!Array.isArray(s.requires) || s.requires.some((r) => !ids.includes(String(r)))) problems.push(`${sl}: requires must name steps of this mission`);
    if (typeof s.required !== "boolean" || !str(s.title) || !str(s.objective)) problems.push(`${sl}: title, objective and required flag required`);
    const intro = Array.isArray(s.intro) ? s.intro : [];
    if (intro.length < 1 || intro.length > MAX_LINES) problems.push(`${sl}: one or two short instruction lines`);
    for (const line of linesOf(s)) {
      if (line.language !== "de" || !str(line.text)) problems.push(`${sl}: lines are German`);
      else if (String(line.text).length > MAX_LINE_CHARS) problems.push(`${sl}: a line is longer than ${MAX_LINE_CHARS} characters (short instructions)`);
      if (spec.narrated && line.speaker !== spec.character.id) problems.push(`${sl}: every line is spoken by ${spec.character.id}`);
      if (spec.narrated && /ß/.test(String(line.text))) problems.push(`${sl}: Swiss standard orthography (ss, never ß)`);
      if (HOME_CLAIM.test(String(line.text))) problems.push(`${sl}: a line asserts what the family's home is built of`);
      if (TREES_NUMBER.test(String(line.text))) problems.push(`${sl}: a line gives a trees-per-house number`);
    }
    if (isRecord(s.doneBy)) for (const [k, v] of Object.entries(s.doneBy)) if (k !== "independent" && Array.isArray(v) && v.some((l) => isRecord(l) && PRAISE.test(String(l.text)))) problems.push(`${sl}: doneBy.${k} must not praise`);
    if (s.picture !== undefined && !picture(s.picture)) problems.push(`${sl}: unknown picture ${String(s.picture)}`);
    for (const q of Array.isArray(s.questions) ? s.questions.filter(isRecord) : []) {
      const options = Array.isArray(q.options) ? q.options.map(String) : [];
      if (q.kind !== "pick" || options.length < 2 || !options.includes(String(q.answer))) problems.push(`${sl}/${String(q.id)}: a picture choice with the answer among its options`);
      const pics = isRecord(q.pictures) ? q.pictures : null;
      if (!pics || options.some((o) => !picture(pics[o]))) problems.push(`${sl}/${String(q.id)}: every option needs its picture`);
      if (q.picture !== undefined && !picture(q.picture)) problems.push(`${sl}/${String(q.id)}: unknown picture`);
      if (!str(q.retryHint)) problems.push(`${sl}/${String(q.id)}: a neutral retry hint`);
    }
    if (s.kind === "solve") {
      const parts = isRecord(s.solve) && Array.isArray(s.solve.parts) ? s.solve.parts.filter(isRecord) : [];
      if (!parts.length) problems.push(`${sl}: a counting task needs its questions`);
      for (const p of parts) {
        const c = isRecord(p.counters) ? p.counters : null;
        if (!c || !Number.isInteger(c.a) || !Number.isInteger(c.b) || (c.op !== "+" && c.op !== "-") || !str(c.unit)) problems.push(`${sl}/${String(p.id)}: every question shows its exact quantities (counters)`);
        else if (countersValue(c) !== p.answer) problems.push(`${sl}/${String(p.id)}: the pictured quantities (${String(c.a)} ${String(c.op)} ${String(c.b)}${c.ask === "missing" ? ", missing part" : ""}) must equal the answer ${String(p.answer)}`);
        if (c && c.ask !== undefined && (c.ask !== "missing" || c.op !== "+" || !Number.isInteger(c.frame) || Number(c.a) + Number(c.b) !== c.frame || c.bundles)) problems.push(`${sl}/${String(p.id)}: a missing-part question shows a full frame (a + b = frame)`);
        if (c && c.frame !== undefined && c.ask !== "missing") problems.push(`${sl}/${String(p.id)}: a frame belongs to a missing-part question`);
        if (c && c.actor !== undefined && (!str(c.actor) || c.op !== "-")) problems.push(`${sl}/${String(p.id)}: an actor names who takes away (subtraction)`);
        if (c && c.icon !== undefined && !(COUNTER_ICONS as readonly string[]).includes(String(c.icon))) problems.push(`${sl}/${String(p.id)}: unknown counter icon`);
        if (c?.bundles && Number(c.a) % 10 !== 0) problems.push(`${sl}/${String(p.id)}: bundles are full tens`);
        if (!str(p.teach) || !str(p.recheck) || !str(p.stuck) || !Array.isArray(p.hints)) problems.push(`${sl}/${String(p.id)}: recheck, stuck line, hints and worked teaching required`);
        if (c?.bundles && p.hintsAfterFirstAttempt !== true) problems.push(`${sl}/${String(p.id)}: bundling is explained after a first try (hintsAfterFirstAttempt)`);
      }
    }
    if (s.kind === "read") {
      const body = isRecord(s.text) ? String(s.text.body ?? "") : "";
      if (!body || body.length > 8) problems.push(`${sl}: one short word to read`);
      const spoken = linesOf(s).filter((l) => (Array.isArray(s.intro) ? s.intro : []).includes(l));
      if (body && spoken.some((l) => new RegExp(`\\b${body}\\b`, "i").test(String(l.text)))) problems.push(`${sl}: the instruction must not say the word before the reading attempt`);
      const q0 = Array.isArray(s.questions) && isRecord(s.questions[0]) ? s.questions[0] : null;
      if (body && q0 && new RegExp(`\\b${body}\\b`, "i").test(String(q0.prompt ?? ""))) problems.push(`${sl}: the question must not say the word before the reading attempt`);
      const letters = isRecord(s.letters) ? s.letters : null;
      if (!letters || String(letters.word).toUpperCase() !== body.toUpperCase() || !Array.isArray(letters.letters) || letters.letters.length !== body.length || !str(letters.spoken) || !str(letters.teach)) problems.push(`${sl}: supported letter/word learning for the same word`);
      for (const e of earlier) if (body && String(readWord(e) ?? "").toUpperCase() === body.toUpperCase()) problems.push(`${sl}: the reading word ${body} was already read in ${String(e.visit)} (a new word is required)`);
    }
    if (s.kind === "listen") {
      const t = isRecord(s.text) ? s.text : null;
      if (!t || t.language !== "de" || !str(t.body)) problems.push(`${sl}: a German listening instruction`);
      for (const e of earlier) for (const es of (Array.isArray(e.steps) ? (e.steps as unknown[]).filter(isRecord) : []).filter((x) => x.kind === "listen")) if (isRecord(es.text) && t && es.text.body === t.body) problems.push(`${sl}: the listening instruction repeats ${String(e.visit)}`);
    }
    if (s.kind === "decide") {
      const opts = isRecord(s.decide) && Array.isArray(s.decide.options) ? s.decide.options.filter(isRecord) : [];
      if (opts.length < 3 || opts.some((o) => o.viable !== true || !picture(o.picture) || !str(o.feedback))) problems.push(`${sl}: at least three pictured, equally valid things to make`);
    }
    if (s.kind === "craft") {
      const c = isRecord(s.craft) ? s.craft : null;
      const find = c && isRecord(c.find) ? c.find : null;
      if (!c || !Array.isArray(c.tasks) || !c.tasks.length || !str(c.parentNote)) problems.push(`${sl}: real-world tasks and the parent note`);
      if (c && c.optional !== undefined && typeof c.optional !== "boolean") problems.push(`${sl}: optional is a flag`);
      if (c && Array.isArray(c.tasks) && c.tasks.some((t) => !isRecord(t) || !str(t.id) || !str(t.text) || (t.picture !== undefined && !picture(t.picture)))) problems.push(`${sl}: every real-world task has an id, a short text and (optionally) a known picture`);
      if (!find || find.count !== 3 || !Array.isArray(find.options) || find.options.length < 4 || find.options.some((o) => !isRecord(o) || !picture(o.picture) || !str(o.label)) || !str(find.fact)) problems.push(`${sl}: «find three things» with at least four pictured candidates and a fact`);
      if (find && TREES_NUMBER.test(String(find.fact))) problems.push(`${sl}: no trees-per-house number`);
    }
    if (spec.narrated && ["solve", "read", "listen"].includes(String(s.kind))) {
      // Narrated endings are spoken: every task carries its reviewed success/open line (no generated sentence).
      const e = isRecord(s.ending) ? s.ending : null;
      if (!e || !str(e.success) || !str(e.open) || String(e.success).length > MAX_LINE_CHARS || String(e.open).length > MAX_LINE_CHARS || PRAISE.test(String(e.success)) || PRAISE.test(String(e.open)) || /ß/.test(`${String(e.success)}${String(e.open)}`)) problems.push(`${sl}: ending.success and ending.open — short reviewed lines, no praise words`);
      if (e && s.kind === "read" && isRecord(s.text) && new RegExp(`\\b${String(s.text.body)}\\b`, "i").test(String(e.open))) problems.push(`${sl}: the open line must not name the word`);
    } else if (s.ending !== undefined) problems.push(`${sl}: ending lines belong to a narrated mission's tasks`);
    if (s.when !== undefined) {
      const w = isRecord(s.when) ? s.when : null;
      if (!w || w.unlessEvidence !== "independent" || !byId.has(String(w.step))) problems.push(`${sl}: when names an earlier step of this mission`);
    }
  }
  const tens = byId.get(spec.tens);
  const again = byId.get(spec.tensAgain);
  const [easierId, easierAfter] = spec.easier;
  const easier = byId.get(easierId);
  if (!isRecord(again?.when) || again!.when.step !== spec.tens || !isRecord(again!.solve) || !isRecord(again!.solve.application) || again!.solve.application.of !== spec.tens) problems.push(`${label}: the fresh tens check follows ${spec.tens} only when that was not independent`);
  if (!isRecord(easier?.when) || easier!.when.step !== easierAfter) problems.push(`${label}: the easier path follows ${easierAfter} only when that was not independent`);
  if (tens && isRecord(tens.solve) && Array.isArray(tens.solve.parts) && !tens.solve.parts.every((p) => isRecord(p) && isRecord(p.counters) && p.counters.bundles === true)) problems.push(`${label}: ${spec.tens} shows ten-bundles`);
  // I2-03: a later visit's tens retrieval is FRESH — no quantity an earlier visit asked (Visit 1: 21 and 23).
  const before = new Set(earlier.flatMap(bundleAnswers));
  for (const n of bundleAnswers(m)) if (before.has(n)) problems.push(`${label}: the ten-bundle quantity ${n} was already asked in an earlier visit (not fresh)`);
  const outcome = steps.filter((s) => s.kind === "outcome");
  if (outcome.length !== 1 || outcome[0].recap !== true || outcome[0].fromChoice !== spec.decide) problems.push(`${label}: one outcome showing her chosen element and a factual recap`);
  const na = isRecord(m.nextAdventure) ? m.nextAdventure : null;
  const choices = Array.isArray(na?.choices) ? (na!.choices as unknown[]) : [];
  if (!na || !str(na.prompt) || !str(na.hint) || !str(na.ownIdeaLabel) || choices.length < 2 || choices.length > 3 || choices.some((c) => !isRecord(c) || !str(c.id) || !str(c.label) || !picture(c.picture))) problems.push(`${label}: nextAdventure needs two or three pictured choices and the own-idea label`);
  const r = isRecord(m.rules) ? m.rules : null;
  if (!r || !Number.isInteger(r.maxPartAttempts) || (r.maxPartAttempts as number) < 3 || !Number.isInteger(r.maxPracticeAttempts) || !Number.isInteger(r.maxQuestionAttempts) || (r.maxQuestionAttempts as number) < 2) problems.push(`${label}: rules.maxPartAttempts (≥ 3), maxPracticeAttempts and maxQuestionAttempts (≥ 2) required`);
  const world = Array.isArray(m.world) ? m.world.filter(isRecord) : [];
  for (const w of world) if (w.prop !== spec.worldProp || !isRecord(w.choice) || w.choice.step !== spec.decide) problems.push(`${label}: a world change shows the ${spec.worldProp} element she chose`);
}

/** Reconciles Isabel's content by its own rules (never Santiago's version inventory). */
export function reconcileIsabelContent(raw: unknown): IsabelReconciliation {
  const problems: string[] = [];
  if (!isRecord(raw)) return { ok: false, version: null, problems: ["content is not an object"] };
  const version = typeof raw.contentVersion === "number" && ISABEL_CONTENT_VERSIONS.includes(raw.contentVersion) ? raw.contentVersion : null;
  if (version === null) problems.push(`Isabel's contentVersion must be one of ${ISABEL_CONTENT_VERSIONS.join(", ")}`);
  if (raw.child !== "isabel") problems.push("content.child must be isabel");
  if (raw.contentId !== ISABEL_CONTENT_ID) problems.push(`contentId must be ${ISABEL_CONTENT_ID}`);
  if (raw.anchorLanguage !== "de") problems.push("anchorLanguage must be de");
  const visits = Array.isArray(raw.visits) ? raw.visits.filter(isRecord) : [];
  const specs = SPECS.slice(0, version ?? 1);
  if (visits.length !== specs.length || visits.some((v, i) => v.id !== specs[i].visit || !Array.isArray(v.stages) || v.stages.join(",") !== "mission,reflect")) problems.push(`exactly the visits ${specs.map((x) => x.visit).join(", ")}, each with stages mission → reflect`);
  for (const v of visits) {
    const intro = isRecord(v.intro) ? v.intro : null;
    if (!intro || !str(intro.who) || !str(intro.make) || !str(intro.done)) problems.push(`visit ${String(v.id)}: intro must say who needs help, what is made and what counts as done`);
    // From Visit 2 on, the hub/start wording comes from the visit itself (Visit 1 keeps its released wording).
    if (v.id !== "v1") {
      const t = isRecord(v.childText) ? v.childText : null;
      if (!t || !str(t.hub) || !str(t.mission) || !str(t.done) || !str(t.start)) problems.push(`visit ${String(v.id)}: childText (hub, mission, done, start) required`);
    } else if ("childText" in v) problems.push("visit v1: unchanged (no childText)");
  }
  // Nothing of Santiago's course: no math items, language segments, typing lessons or labels.
  const math = isRecord(raw.math) ? raw.math : null;
  const language = isRecord(raw.language) ? raw.language : null;
  const typing = isRecord(raw.typing) ? raw.typing : null;
  if (!math || !Array.isArray(math.items) || math.items.length) problems.push("math.items must be empty (Isabel's arithmetic lives in her mission)");
  if (!language || !Array.isArray(language.segments) || language.segments.length) problems.push("language.segments must be empty");
  if (!typing || !Array.isArray(typing.lessons) || typing.lessons.length || !Array.isArray(typing.labelTasks) || typing.labelTasks.length || "course" in typing) problems.push("typing must be empty (no typing course for Isabel)");
  const missions = Array.isArray(raw.missions) ? raw.missions : [];
  if (missions.length !== specs.length) problems.push(`exactly ${specs.length} mission(s), one per visit`);
  else specs.forEach((spec, i) => checkWorkshopMission(missions[i], problems, spec, missions.slice(0, i).filter(isRecord)));
  const reflection = isRecord(raw.reflection) ? raw.reflection : null;
  const ni = reflection && isRecord(reflection.nextInterest) ? reflection.nextInterest : null;
  if (!reflection || !str(reflection.prompt) || !Array.isArray(reflection.options) || reflection.options.length < 2 || !ni || !str(ni.prompt) || !str(ni.unsureLabel) || !str(ni.declineLabel)) problems.push("reflection with options and the next-interest question required");
  if (!isRecord(raw.retention) || !str(raw.retention.policy)) problems.push("retention policy required");
  return { ok: problems.length === 0, version, problems };
}

export function asIsabelContent(raw: unknown): LearningContent {
  const r = reconcileIsabelContent(raw);
  if (!r.ok) throw new Error(`Isabel content refused: ${r.problems.join("; ")}`);
  return raw as LearningContent;
}

/** The workshop mission of Isabel's content for a visit (typed); without a visit, her first (Visit 1). */
export function workshopMission(content: LearningContent, visit?: string): MissionDef | null {
  return content.child === "isabel" ? (content.missions ?? []).find((m) => m.presentation === "workshop" && (visit === undefined || m.visit === visit)) ?? null : null;
}

export type { MissionStep };
