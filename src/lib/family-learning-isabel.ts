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
import { WORKSHOP_PICTURES, type MissionDef, type MissionStep } from "./family-learning-mission-spec.ts";

export const ISABEL_CONTENT_ID = "isabel-workshop";
export const ISABEL_CONTENT_VERSIONS: readonly number[] = [1];
export const ISABEL_MISSION_ID = "MISSION-OLD-LILA-WORKSHOP";
export const ISABEL_COMPANION = "Old Lila";
export const EXPECTED_WORKSHOP_STEPS: readonly string[] = ["W1-HELLO", "W2-MAKE", "W3-MATERIALS", "W4-COUNT", "W5-TENS", "W6-TENS-AGAIN", "W7-EASIER", "W8-READ", "W9-LISTEN", "W10-CRAFT", "W11-ROOM"];

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

export function checkWorkshopMission(m: unknown, problems: string[]): void {
  if (!isRecord(m)) {
    problems.push("workshop mission missing");
    return;
  }
  const label = `mission ${String(m.id)}`;
  if (m.id !== ISABEL_MISSION_ID) problems.push(`${label}: the workshop mission id must be ${ISABEL_MISSION_ID}`);
  if (m.visit !== "v1") problems.push(`${label}: Isabel's first visit is v1`);
  if (m.presentation !== "workshop") problems.push(`${label}: presentation must be workshop`);
  if ("typingBlock" in m) problems.push(`${label}: Isabel's workshop has no typing block (no typing is asked of her)`);
  const chars = Array.isArray(m.characters) ? m.characters.filter(isRecord) : [];
  if (chars.length !== 1 || chars[0].id !== "lila" || chars[0].name !== ISABEL_COMPANION || chars[0].language !== "de") problems.push(`${label}: exactly one character, «${ISABEL_COMPANION}» (id lila), speaking German`);
  const map = isRecord(m.map) ? m.map : null;
  const places = Array.isArray(map?.places) ? (map!.places as unknown[]).filter(isRecord) : [];
  if (places.length !== 1 || places[0].id !== map?.start) problems.push(`${label}: one place (the workshop), which is the start`);
  const steps = Array.isArray(m.steps) ? (m.steps as unknown[]).filter(isRecord) : [];
  const ids = steps.map((s) => String(s.id));
  if (ids.join(",") !== EXPECTED_WORKSHOP_STEPS.join(",")) problems.push(`${label}: steps must be exactly ${EXPECTED_WORKSHOP_STEPS.join(", ")} in this order`);
  const byId = new Map(steps.map((s) => [String(s.id), s]));
  for (const s of steps) {
    const sl = `${label}/${String(s.id)}`;
    if (s.version !== 1) problems.push(`${sl}: version must be 1`);
    if (FORBIDDEN_KINDS.has(String(s.kind))) problems.push(`${sl}: ${String(s.kind)} is not part of Isabel's visually led visit`);
    if (s.place !== map?.start) problems.push(`${sl}: every beat is in the workshop`);
    if (s.character !== null && s.character !== "lila") problems.push(`${sl}: only Old Lila speaks`);
    if (!Array.isArray(s.requires) || s.requires.some((r) => !ids.includes(String(r)))) problems.push(`${sl}: requires must name steps of this mission`);
    if (typeof s.required !== "boolean" || !str(s.title) || !str(s.objective)) problems.push(`${sl}: title, objective and required flag required`);
    const intro = Array.isArray(s.intro) ? s.intro : [];
    if (intro.length < 1 || intro.length > MAX_LINES) problems.push(`${sl}: one or two short instruction lines`);
    for (const line of linesOf(s)) {
      if (line.language !== "de" || !str(line.text)) problems.push(`${sl}: lines are German`);
      else if (String(line.text).length > MAX_LINE_CHARS) problems.push(`${sl}: a line is longer than ${MAX_LINE_CHARS} characters (short instructions)`);
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
        const value = c ? (c.op === "+" ? Number(c.a) + Number(c.b) : Number(c.a) - Number(c.b)) : NaN;
        if (!c || !Number.isInteger(c.a) || !Number.isInteger(c.b) || (c.op !== "+" && c.op !== "-") || !str(c.unit)) problems.push(`${sl}/${String(p.id)}: every question shows its exact quantities (counters)`);
        else if (value !== p.answer) problems.push(`${sl}/${String(p.id)}: the pictured quantities (${String(c.a)} ${String(c.op)} ${String(c.b)}) must equal the answer ${String(p.answer)}`);
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
      const letters = isRecord(s.letters) ? s.letters : null;
      if (!letters || String(letters.word).toUpperCase() !== body.toUpperCase() || !Array.isArray(letters.letters) || letters.letters.length !== body.length || !str(letters.spoken) || !str(letters.teach)) problems.push(`${sl}: supported letter/word learning for the same word`);
    }
    if (s.kind === "listen") {
      const t = isRecord(s.text) ? s.text : null;
      if (!t || t.language !== "de" || !str(t.body)) problems.push(`${sl}: a German listening instruction`);
    }
    if (s.kind === "decide") {
      const opts = isRecord(s.decide) && Array.isArray(s.decide.options) ? s.decide.options.filter(isRecord) : [];
      if (opts.length < 3 || opts.some((o) => o.viable !== true || !picture(o.picture) || !str(o.feedback))) problems.push(`${sl}: at least three pictured, equally valid things to make`);
    }
    if (s.kind === "craft") {
      const c = isRecord(s.craft) ? s.craft : null;
      const find = c && isRecord(c.find) ? c.find : null;
      if (!c || !Array.isArray(c.tasks) || !c.tasks.length || !str(c.parentNote)) problems.push(`${sl}: real-world tasks and the parent note`);
      if (!find || find.count !== 3 || !Array.isArray(find.options) || find.options.length < 4 || find.options.some((o) => !isRecord(o) || !picture(o.picture) || !str(o.label)) || !str(find.fact)) problems.push(`${sl}: «find three wooden things» with at least four pictured candidates and a fact`);
      if (find && TREES_NUMBER.test(String(find.fact))) problems.push(`${sl}: no trees-per-house number`);
    }
    if (s.when !== undefined) {
      const w = isRecord(s.when) ? s.when : null;
      if (!w || w.unlessEvidence !== "independent" || !byId.has(String(w.step))) problems.push(`${sl}: when names an earlier step of this mission`);
    }
  }
  const tens = byId.get("W5-TENS");
  const again = byId.get("W6-TENS-AGAIN");
  const easier = byId.get("W7-EASIER");
  if (!isRecord(again?.when) || again!.when.step !== "W5-TENS" || !isRecord(again!.solve) || !isRecord(again!.solve.application) || again!.solve.application.of !== "W5-TENS") problems.push(`${label}: the fresh tens check follows W5-TENS only when that was not independent`);
  if (!isRecord(easier?.when) || easier!.when.step !== "W6-TENS-AGAIN") problems.push(`${label}: the easier path follows the fresh check only when that was not independent`);
  if (tens && isRecord(tens.solve) && Array.isArray(tens.solve.parts) && !tens.solve.parts.every((p) => isRecord(p) && isRecord(p.counters) && p.counters.bundles === true)) problems.push(`${label}: W5-TENS shows ten-bundles`);
  const outcome = steps.filter((s) => s.kind === "outcome");
  if (outcome.length !== 1 || outcome[0].recap !== true || outcome[0].fromChoice !== "W2-MAKE") problems.push(`${label}: one outcome showing her chosen element and a factual recap`);
  const na = isRecord(m.nextAdventure) ? m.nextAdventure : null;
  const choices = Array.isArray(na?.choices) ? (na!.choices as unknown[]) : [];
  if (!na || !str(na.prompt) || !str(na.hint) || !str(na.ownIdeaLabel) || choices.length < 2 || choices.length > 3 || choices.some((c) => !isRecord(c) || !str(c.id) || !str(c.label) || !picture(c.picture))) problems.push(`${label}: nextAdventure needs two or three pictured choices and the own-idea label`);
  const r = isRecord(m.rules) ? m.rules : null;
  if (!r || !Number.isInteger(r.maxPartAttempts) || (r.maxPartAttempts as number) < 3 || !Number.isInteger(r.maxPracticeAttempts) || !Number.isInteger(r.maxQuestionAttempts) || (r.maxQuestionAttempts as number) < 2) problems.push(`${label}: rules.maxPartAttempts (≥ 3), maxPracticeAttempts and maxQuestionAttempts (≥ 2) required`);
  const world = Array.isArray(m.world) ? m.world.filter(isRecord) : [];
  for (const w of world) if (w.prop !== "room" || !isRecord(w.choice) || w.choice.step !== "W2-MAKE") problems.push(`${label}: a world change shows the room element she chose`);
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
  if (visits.length !== 1 || visits[0].id !== "v1" || !Array.isArray(visits[0].stages) || visits[0].stages.join(",") !== "mission,reflect") problems.push("exactly one visit v1 with stages mission → reflect");
  const intro = visits[0] && isRecord(visits[0].intro) ? visits[0].intro : null;
  if (!intro || !str(intro.who) || !str(intro.make) || !str(intro.done)) problems.push("visit v1: intro must say who needs help, what is made and what counts as done");
  // Nothing of Santiago's course: no math items, language segments, typing lessons or labels.
  const math = isRecord(raw.math) ? raw.math : null;
  const language = isRecord(raw.language) ? raw.language : null;
  const typing = isRecord(raw.typing) ? raw.typing : null;
  if (!math || !Array.isArray(math.items) || math.items.length) problems.push("math.items must be empty (Isabel's arithmetic lives in her mission)");
  if (!language || !Array.isArray(language.segments) || language.segments.length) problems.push("language.segments must be empty");
  if (!typing || !Array.isArray(typing.lessons) || typing.lessons.length || !Array.isArray(typing.labelTasks) || typing.labelTasks.length || "course" in typing) problems.push("typing must be empty (no typing course for Isabel)");
  const missions = Array.isArray(raw.missions) ? raw.missions : [];
  if (missions.length !== 1) problems.push("exactly one mission (the workshop)");
  else checkWorkshopMission(missions[0], problems);
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

/** The workshop mission of Isabel's content (typed). */
export function workshopMission(content: LearningContent): MissionDef | null {
  return content.child === "isabel" ? (content.missions ?? []).find((m) => m.presentation === "workshop") ?? null : null;
}

export type { MissionStep };
