// ---------------------------------------------------------------------------
// Family Assistant learning — reviewed MISSION specification (content v5, Visit 6; content v6, Visit 7).
//
// A mission is data, not a component: the learning domain reviews one document
// per mission (places and paths of the walkable map, characters and their
// languages, the information dependencies between steps, the calculations, the
// plan/logic choice, reading vs listening mode, the support policy, retrieval
// items, the finite typing block, the visible world changes and the closing
// interest question). The app executes it (`family-learning-mission.ts`) and
// renders it (`mission-world.tsx`). A new visit with a different theme is a new
// reviewed document — never a new component or completion rule.
//
// Pure module: types plus the validator `checkMissions`, used by the content
// reconciliation (`family-learning-content.ts`) for content version 5.
// ---------------------------------------------------------------------------

export type MissionLanguage = "de" | "en" | "es";

export type MissionPlace = {
  id: string;
  label: string;
  /** Ground point on the 1600 × 900 stage (where the avatar stands when it arrives). */
  x: number;
  y: number;
  /** "place" can host steps; "waypoint" only shapes the walkable path network. */
  kind: "place" | "waypoint";
  /** The character standing here, if any. */
  character?: string;
};

export type MissionCharacter = { id: string; name: string; role: string; language: MissionLanguage; plate: string };

/** A line of a story beat or a character; `de` is the reviewed German translation (opening it is recorded as support). */
export type MissionLine = { speaker: string | null; text: string; language: MissionLanguage; de?: string | null };

export type MissionQuestion = {
  id: string;
  prompt: string;
  /** `pick` shows the reviewed options; `number` asks for a whole number. */
  kind: "pick" | "number";
  options?: string[];
  answer: string;
  /** The fact this answer establishes for later steps (displayed in the child's notebook). */
  fact?: { key: string; label: string };
  /** Reviewed neutral hint after a first wrong answer. */
  retryHint: string;
};

export type MissionField = { key: string; label: string; answer: number };

export type MissionRepairWord = {
  /** The reviewed written form (lowercase, as it appears in `accepted`). */
  word: string;
  /** German meaning used in "Du möchtest sagen: …". */
  meaningDe: string;
  /** Reviewed spelling explanation, e.g. "„Seile“ schreibt man auf Spanisch cuerdas, mit c." */
  spellingNote: string;
  /** Reviewed misspellings that map to this word regardless of edit distance. */
  misspellings?: string[];
};

export type MissionProduce = {
  language: Exclude<MissionLanguage, "de">;
  frame: string;
  instruction: string;
  accepted: string[];
  lexical: string[];
  keywords: string[];
  distractors: string[];
  /** The German meaning of the accepted sentence (used by the repair line). */
  sentenceDe: string;
  /** Words the bounded repair may recognise (frame words and the target word). */
  repairWords: MissionRepairWord[];
  /** Reviewed child-facing lines; never a matcher error. */
  feedback: { distractor: string; unclear: string; lexical: string };
  /** Word bank (help, recorded before it is shown). */
  wordBank: string[];
  /** Content v6 (V6-F07): acknowledge the understood word first, then ONE specific spelling correction per try. */
  nearMiss?: { ack: string };
};

/** Content v6: an exact quantity picture (`total` objects in containers of `perGroup`); numbers come from the data, never from art. */
export type MissionDiagram = { total: number; perGroup: number; unit: string; container: string };

/** Content v6: the optional small check inside a reviewed hint — a meaningful child response, recorded apart from the main answer. */
export type MissionHintCheck = {
  prompt: string;
  kind: "number" | "pick";
  options?: string[];
  answer: string;
  unit?: string;
  /** Reviewed reply after a correct check. */
  correct: string;
  /** Reviewed reply after a wrong check (a different representation follows when `representation` is set). */
  wrong: string;
  /** A different representation shown after a wrong check (recorded support before it is shown). */
  representation?: MissionDiagram | null;
  /** Parts whose answer the representation after a wrong check makes visible (answer exposure, recorded). */
  exposesOnWrong?: string[];
};

/** Content v6: one reviewed, pre-programmed hint (N7-01). Revealed one level at a time on explicit request; the exact hint is recorded. */
export type MissionHint = {
  id: string;
  level: number;
  type: "grouping" | "subtract" | "extra-tray" | "count-all" | "compare" | "word-options";
  text: string;
  check?: MissionHintCheck;
  diagram?: MissionDiagram | null;
  /** Parts whose answer this hint makes visible as soon as it is shown (answer exposure, recorded). */
  exposes?: string[];
};

/** Content v6: one clear question with its unit, answered on its own (V7-D02). */
export type MissionPart = {
  id: string;
  question: string;
  unit: string;
  answer: number;
  /** Neutral recheck after the first substantive miss (V7-D05). */
  recheck: string;
  /** After the second substantive miss when no verified tutor is available: points to the hint, never interrogates. */
  stuck: string;
  hints: MissionHint[];
  /** Worked teaching after the last miss; states the answer (answer exposure, recorded before it is shown). */
  teach: string;
  /** Fresh application: hints are offered only after the first attempt. */
  hintsAfterFirstAttempt?: boolean;
  /** Planned reflection (N7-04c): asked by the verified tutor only; without it the explanation stays missing evidence. */
  reflect?: { prompt: string };
};

/** Content v6: a reviewed problem with one question per part. */
export type MissionSolve = {
  /** The facts the problem rests on — visible the whole time (reference, never a hint). */
  facts: string[];
  parts: MissionPart[];
  /** The visible consequence once the problem is resolved (exact counts). */
  diagram?: MissionDiagram | null;
  /** A fresh same-day application of an earlier problem: never delayed retention. */
  application?: { of: string; kind: "same-day-application" };
};

/** Content v6: one own German sentence with the existing mechanical spacing review (D-W1). */
export type MissionWrite = { prompt: string; instruction: string; placeholder?: string; thanks: string; correctionIntro: string; keep: string };

export type MissionCalc = {
  prompt: string;
  fields: MissionField[];
  clarification: string;
  /** A counters picture: `total` objects drawn in rows of `perGroup` (help, recorded before it is shown). */
  representation: { text: string; total: number; perGroup: number; unit: string };
  teach: string;
};

export type MissionChoiceOption = { id: string; label: string; valid: boolean; best: boolean; feedback: string };

export type MissionStepKind = "story" | "read" | "listen" | "calc" | "choice" | "produce" | "recall" | "typing-block" | "outcome" | "solve" | "write";

/** Content v6 (V6-F06): reviewed closing lines per actual outcome. Success lines are never shown after practice, teaching or an open item. */
export type MissionDoneBy = Partial<Record<"independent" | "supported" | "practiced" | "taught" | "unresolved", MissionLine[]>>;

export type MissionStep = {
  id: string;
  version: number;
  kind: MissionStepKind;
  title: string;
  place: string;
  character: string | null;
  requires: string[];
  required: boolean;
  /** Recorded objective of the attempt rows ("story" / "outcome" record none). */
  objective: string;
  intro: MissionLine[];
  done: MissionLine[];
  /** Content v6: outcome-specific closing lines (fallback: neutral engine lines for non-success outcomes). */
  doneBy?: MissionDoneBy;
  /** Conditional retrieval: the step is offered only when the named step did NOT end independent (else `not-needed`). */
  when?: { step: string; unlessEvidence: "independent" };
  /** Read: the written text (shown, never read aloud). Listen: the audio script (played, never shown before the support is recorded). */
  text?: { language: MissionLanguage; body: string; de?: string | null };
  questions?: MissionQuestion[];
  calc?: MissionCalc;
  choice?: { prompt: string; options: MissionChoiceOption[]; teach: string };
  produce?: MissionProduce;
  /** Content v6: a problem answered question by question. */
  solve?: MissionSolve;
  /** Content v6: one own sentence. */
  write?: MissionWrite;
  /** Content v6: an exact quantity picture shown with a story/outcome step. */
  diagram?: MissionDiagram | null;
  /** Content v6: several labelled quantity pictures (e.g. two shipments), each with exact counts. */
  shipments?: { label: string; diagram: MissionDiagram }[];
  /** Recall steps: the earlier evidence this retrieval revisits (an open practice focus id or a step of this mission). */
  retrieval?: { focus?: string; step?: string; note: string };
  /** Supplies granted when the step ends (any outcome that lets the mission continue). */
  supplies?: Record<string, number>;
};

export type MissionWorldChange = {
  id: string;
  /** The step whose completion (done, practiced, taught or unresolved-but-given) shows the change. */
  after: string;
  prop: "crates" | "tool-crates" | "boats" | "ropes" | "route" | "radio" | "sail" | "trays" | "garden";
  place: string;
  count: number;
  label: string;
};

export type MissionTypingBlock = {
  id: string;
  version: number;
  /** Calibration target of focused typing (active time), NOT a research-proven optimum. */
  targetActiveSeconds: number;
  minDrills: number;
  maxDrills: number;
  /** Pace used when no prior burst has a measured duration (characters per second). */
  fallbackCharsPerSecond: number;
  /** A pause between keystrokes longer than this is idle, not active typing. */
  idleGapSeconds: number;
  /** One optional extra drill after the required block. */
  extraDrills: 1;
  /** A drill counts as attempted when at least this share of the expected characters was typed. */
  minTypedShare: number;
  /** Drill sources in order (cycled): current course lesson, the previous lesson as review, a line with an open focus key. */
  pattern: ("current" | "review" | "focus")[];
  announce: string;
  note: string;
};

/** Content v6 (V7-D13): concrete next-story directions offered at the end; the child may also write an own idea or leave without choosing. */
export type MissionNextAdventure = { prompt: string; hint: string; choices: { id: string; label: string; picture: "greenhouse" | "water" }[]; ownIdeaLabel: string };

export type MissionDef = {
  id: string;
  version: number;
  visit: string;
  title: string;
  objective: string;
  /** Content v6: `scene` = one illustrated scene with a speech bubble and the beats in their reviewed order; absent = the walkable map. */
  presentation?: "walk" | "scene";
  /** Content v6: the painted scene (build-time static asset id) and its description. */
  scene?: { art: string; alt: string };
  nextAdventure?: MissionNextAdventure;
  /** Where the theme comes from — a saved child choice or an explicit owner/child decision, never an invented interest. */
  theme: { basis: "continues-saved-choice" | "child-chosen" | "owner-chosen"; source: string; value: string; note: string };
  map: { start: string; places: MissionPlace[]; paths: [string, string][] };
  characters: MissionCharacter[];
  steps: MissionStep[];
  world: MissionWorldChange[];
  typingBlock: MissionTypingBlock;
  /** Planned length in minutes — a calibration estimate, never a countdown. */
  estimatedMinutes: { min: number; max: number };
  rules: {
    /** Calculation: 1st wrong → clarification, 2nd → representation, 3rd → teach (answer revealed). */
    maxCalcAttempts: number;
    /** Listening/reading question: wrong answers before the answer is shown. */
    maxQuestionAttempts: number;
    /** Language production: attempts before supported practice / an explicit unresolved item. */
    maxProduceAttempts: number;
    maxChoiceAttempts: number;
    /** Content v6: substantive misses per question before worked teaching (1st → recheck, 2nd → stuck/diagnostic offer). */
    maxPartAttempts?: number;
    /** Content v6: copy attempts after a shown sentence or worked teaching before only "keep for later" remains. */
    maxPracticeAttempts?: number;
  };
};

/** The closing question about the next visit (content v5: every normal closing sequence asks it). */
export type NextInterestDef = {
  prompt: string;
  hint: string;
  unsureLabel: string;
  noPreferenceLabel: string;
  declineLabel: string;
  entryPrompt: string;
  note: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export const MISSION_STEP_KINDS: readonly MissionStepKind[] = ["story", "read", "listen", "calc", "choice", "produce", "recall", "typing-block", "outcome", "solve", "write"];

/** Exact inventory of content version 5, by stable id (reconciliation contract). */
export const EXPECTED_MISSION_IDS_V5: readonly string[] = ["MISSION-SHIP-SUPPLY"];
export const EXPECTED_MISSION_STEP_IDS_V5: readonly string[] = [
  "S1-BRIEF", "S2-BOARD", "S3-RADIO", "S4-WATER", "S5-CRATES", "S6-ROSA", "S7-ROSA-REPLY", "S8-TOOLS", "S9-LOAD", "S10-ROPES", "S11-ROUTE", "S12-TYPING", "S13-RECALL-CUERDAS", "S14-LAUNCH",
];
/** Content version 6 (Visit 7): version 5 plus the garden mission of visit v8, by stable id. */
export const EXPECTED_MISSION_IDS_V6: readonly string[] = [...EXPECTED_MISSION_IDS_V5, "MISSION-ISLAND-GARDEN"];
export const EXPECTED_MISSION_STEP_IDS_GARDEN: readonly string[] = ["G1-REQUEST", "G2-PACK", "G3-DELIVERY", "G4-RADIO", "G5-TOOLS", "G6-TYPING", "G7-FRESH", "G8-JOURNAL", "G9-HOME"];
export const EXPECTED_MISSION_STEPS: Readonly<Record<string, readonly string[]>> = { "MISSION-SHIP-SUPPLY": EXPECTED_MISSION_STEP_IDS_V5, "MISSION-ISLAND-GARDEN": EXPECTED_MISSION_STEP_IDS_GARDEN };
/** Every known mission step id (closed telemetry vocabulary). */
export const ALL_MISSION_STEP_IDS: readonly string[] = [...EXPECTED_MISSION_STEP_IDS_V5, ...EXPECTED_MISSION_STEP_IDS_GARDEN];

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFC").replace(/[.,!?;:¡¿"'’]/g, " ").replace(/\s+/g, " ").trim();
}

/** Validates the reviewed mission documents of a content file; every problem is reported, nothing is repaired. */
export function checkMissions(raw: unknown, problems: string[], contentVersion = 5): void {
  if (!Array.isArray(raw)) {
    problems.push("missions: list required from content version 5");
    return;
  }
  const expectedIds = contentVersion >= 6 ? EXPECTED_MISSION_IDS_V6 : EXPECTED_MISSION_IDS_V5;
  const ids = raw.map((m) => (isRecord(m) && typeof m.id === "string" ? m.id : "?"));
  const missing = expectedIds.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !expectedIds.includes(id));
  if (missing.length) problems.push(`missions: missing ${missing.join(", ")}`);
  if (extra.length) problems.push(`missions: unexpected ${extra.join(", ")}`);
  for (const m of raw) if (isRecord(m)) checkMission(m, problems);
}

function checkMission(m: Record<string, unknown>, problems: string[]) {
  const label = `mission ${String(m.id)}`;
  if (m.version !== 1) problems.push(`${label}: version must be 1`);
  for (const k of ["visit", "title", "objective"]) if (!str(m[k])) problems.push(`${label}: ${k} required`);
  const theme = isRecord(m.theme) ? m.theme : null;
  if (!theme || !["continues-saved-choice", "child-chosen", "owner-chosen"].includes(String(theme.basis)) || !str(theme.source) || !str(theme.note)) problems.push(`${label}: theme must name its basis (saved choice / child / owner) and source — never an invented interest`);
  const map = isRecord(m.map) ? m.map : null;
  const places = Array.isArray(map?.places) ? (map!.places as unknown[]) : [];
  const placeIds = new Set<string>();
  for (const p of places) {
    if (!isRecord(p) || !str(p.id) || !str(p.label) || !num(p.x) || !num(p.y) || (p.kind !== "place" && p.kind !== "waypoint")) {
      problems.push(`${label}: malformed place`);
      continue;
    }
    if ((p.x as number) < 0 || (p.x as number) > 1600 || (p.y as number) < 0 || (p.y as number) > 900) problems.push(`${label}: place ${String(p.id)} outside the 1600 × 900 stage`);
    if (placeIds.has(p.id as string)) problems.push(`${label}: duplicate place ${String(p.id)}`);
    placeIds.add(p.id as string);
  }
  if (!map || !placeIds.has(String(map.start))) problems.push(`${label}: map.start must be a place`);
  const paths = Array.isArray(map?.paths) ? (map!.paths as unknown[]) : [];
  for (const e of paths) if (!Array.isArray(e) || e.length !== 2 || !placeIds.has(String(e[0])) || !placeIds.has(String(e[1])) || e[0] === e[1]) problems.push(`${label}: malformed path ${JSON.stringify(e)}`);
  // Every place must be reachable on foot from the start (a walkable map, not a menu).
  if (map && placeIds.size) {
    const adj = new Map<string, string[]>();
    for (const e of paths) if (Array.isArray(e)) for (const [a, b] of [[e[0], e[1]], [e[1], e[0]]]) adj.set(String(a), [...(adj.get(String(a)) ?? []), String(b)]);
    const seen = new Set<string>([String(map.start)]);
    const queue = [String(map.start)];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    for (const id of placeIds) if (!seen.has(id)) problems.push(`${label}: place ${id} is not reachable on a path from ${String(map.start)}`);
  }
  const characters = Array.isArray(m.characters) ? (m.characters as unknown[]) : [];
  const charIds = new Set<string>();
  for (const c of characters) {
    if (!isRecord(c) || !str(c.id) || !str(c.name) || !["de", "en", "es"].includes(String(c.language)) || !str(c.plate)) problems.push(`${label}: malformed character`);
    else charIds.add(c.id as string);
  }
  const steps = Array.isArray(m.steps) ? (m.steps as unknown[]) : [];
  const stepIds = steps.map((s) => (isRecord(s) ? String(s.id) : "?"));
  const expectedSteps = EXPECTED_MISSION_STEPS[String(m.id)] ?? [];
  const missing = expectedSteps.filter((id) => !stepIds.includes(id));
  const extra = stepIds.filter((id) => !expectedSteps.includes(id));
  const scene = m.presentation === "scene";
  if (m.presentation !== undefined && m.presentation !== "walk" && !scene) problems.push(`${label}: presentation must be walk or scene`);
  if (scene && (!isRecord(m.scene) || !str(m.scene.art) || !str(m.scene.alt))) problems.push(`${label}: a scene mission names its painted art and its description`);
  if (missing.length) problems.push(`${label}: steps missing ${missing.join(", ")}`);
  if (extra.length) problems.push(`${label}: unexpected steps ${extra.join(", ")}`);
  const dupes = stepIds.filter((id, i) => stepIds.indexOf(id) !== i);
  if (dupes.length) problems.push(`${label}: duplicate steps ${dupes.join(", ")}`);
  let calcs = 0;
  let choices = 0;
  let typingBlocks = 0;
  let solves = 0;
  for (const s of steps) {
    if (!isRecord(s)) continue;
    const sl = `${label}/${String(s.id)}`;
    if (s.version !== 1) problems.push(`${sl}: version must be 1`);
    if (!MISSION_STEP_KINDS.includes(s.kind as MissionStepKind)) problems.push(`${sl}: unknown kind ${String(s.kind)}`);
    if (!placeIds.has(String(s.place))) problems.push(`${sl}: place ${String(s.place)} is not on the map`);
    if (s.character !== null && !charIds.has(String(s.character))) problems.push(`${sl}: unknown character ${String(s.character)}`);
    if (!Array.isArray(s.requires) || s.requires.some((r) => !stepIds.includes(String(r)))) problems.push(`${sl}: requires must name steps of this mission`);
    if (typeof s.required !== "boolean" || !str(s.title) || !str(s.objective)) problems.push(`${sl}: title, objective and required flag required`);
    if (!Array.isArray(s.intro) || !Array.isArray(s.done)) problems.push(`${sl}: intro and done lines required`);
    for (const line of [...(Array.isArray(s.intro) ? s.intro : []), ...(Array.isArray(s.done) ? s.done : [])]) {
      if (!isRecord(line) || !str(line.text) || !["de", "en", "es"].includes(String(line.language))) problems.push(`${sl}: malformed line`);
      else if (line.language !== "de" && !str(line.de)) problems.push(`${sl}: a ${String(line.language)} line needs its reviewed German translation`);
    }
    if (s.doneBy !== undefined) {
      const db = isRecord(s.doneBy) ? s.doneBy : null;
      if (!db || Object.keys(db).some((k) => !["independent", "supported", "practiced", "taught", "unresolved"].includes(k))) problems.push(`${sl}: doneBy names only independent / supported / practiced / taught / unresolved`);
      for (const [k, lines] of Object.entries(db ?? {})) {
        if (!Array.isArray(lines) || !lines.length) problems.push(`${sl}: doneBy.${k} needs at least one line`);
        for (const line of Array.isArray(lines) ? lines : []) if (!isRecord(line) || !str(line.text) || !["de", "en", "es"].includes(String(line.language)) || (line.language !== "de" && !str(line.de))) problems.push(`${sl}: malformed doneBy.${k} line`);
        // Praise never follows practice, teaching or an open item (V6-F06).
        if (k !== "independent" && k !== "supported") for (const line of Array.isArray(lines) ? lines : []) if (isRecord(line) && /muy bien|sehr gut|super|toll|perfekt|bravo|great|well done/i.test(`${String(line.text)} ${String(line.de ?? "")}`)) problems.push(`${sl}: doneBy.${k} must not praise`);
      }
    }
    if (s.diagram !== undefined && s.diagram !== null && !checkDiagram(s.diagram)) problems.push(`${sl}: malformed diagram`);
    if (s.shipments !== undefined && (!Array.isArray(s.shipments) || s.shipments.some((x) => !isRecord(x) || !str(x.label) || !checkDiagram(x.diagram)))) problems.push(`${sl}: malformed shipments`);
    if (s.when !== undefined) {
      const w = isRecord(s.when) ? s.when : null;
      if (!w || !stepIds.includes(String(w.step)) || w.unlessEvidence !== "independent") problems.push(`${sl}: when must name a step and unlessEvidence "independent"`);
      if (s.required) problems.push(`${sl}: a conditional retrieval step is required only when offered — mark it required: false`);
    }
    const questions = Array.isArray(s.questions) ? s.questions : [];
    switch (s.kind) {
      case "read":
      case "listen": {
        const t = isRecord(s.text) ? s.text : null;
        if (!t || !str(t.body) || !["de", "en", "es"].includes(String(t.language))) problems.push(`${sl}: ${String(s.kind)} needs its text`);
        if (s.kind === "listen" && t && t.language !== "de" && !str(t.de)) problems.push(`${sl}: a foreign-language listening text needs its reviewed German translation (recorded support)`);
        if (!questions.length) problems.push(`${sl}: at least one question`);
        for (const q of questions) {
          if (!isRecord(q) || !str(q.id) || !str(q.prompt) || !str(q.answer) || !str(q.retryHint) || (q.kind !== "pick" && q.kind !== "number")) {
            problems.push(`${sl}: malformed question`);
            continue;
          }
          if (q.kind === "pick" && (!Array.isArray(q.options) || q.options.length < 2 || !q.options.includes(q.answer))) problems.push(`${sl}/${String(q.id)}: the answer must be one of at least two options`);
          if (q.kind === "number" && !/^\d+$/.test(String(q.answer))) problems.push(`${sl}/${String(q.id)}: a number answer must be a whole number`);
        }
        break;
      }
      case "calc": {
        calcs += 1;
        const c = isRecord(s.calc) ? s.calc : null;
        if (!c || !str(c.prompt) || !str(c.clarification) || !str(c.teach) || !Array.isArray(c.fields) || !c.fields.length) {
          problems.push(`${sl}: calc needs prompt, fields, clarification and teaching`);
          break;
        }
        for (const f of c.fields as unknown[]) if (!isRecord(f) || !str(f.key) || !str(f.label) || !Number.isInteger(f.answer) || (f.answer as number) < 0) problems.push(`${sl}: malformed field`);
        const r = isRecord(c.representation) ? c.representation : null;
        if (!r || !str(r.text) || !Number.isInteger(r.total) || !Number.isInteger(r.perGroup) || (r.perGroup as number) < 1 || (r.total as number) > 60 || !str(r.unit)) problems.push(`${sl}: representation needs text, total (≤ 60), perGroup and unit`);
        // The teaching text must state every answer (it is the reviewed worked result).
        for (const f of c.fields as Record<string, unknown>[]) if (isRecord(f) && Number.isInteger(f.answer) && !new RegExp(`\\b${f.answer}\\b`).test(String(c.teach))) problems.push(`${sl}: teaching text does not state ${String(f.key)} = ${String(f.answer)}`);
        // The clarification never states an answer.
        for (const f of c.fields as Record<string, unknown>[]) if (isRecord(f) && Number.isInteger(f.answer) && new RegExp(`=\\s*${f.answer}\\b`).test(String(c.clarification))) problems.push(`${sl}: clarification must not state the result of ${String(f.key)}`);
        break;
      }
      case "choice": {
        choices += 1;
        const ch = isRecord(s.choice) ? s.choice : null;
        const opts = Array.isArray(ch?.options) ? (ch!.options as unknown[]) : [];
        if (!ch || !str(ch.prompt) || !str(ch.teach) || opts.length < 3) problems.push(`${sl}: a plan choice needs a prompt, teaching and at least three options`);
        const best = opts.filter((o) => isRecord(o) && o.best === true);
        if (best.length !== 1) problems.push(`${sl}: exactly one best option`);
        for (const o of opts) if (!isRecord(o) || !str(o.id) || !str(o.label) || typeof o.valid !== "boolean" || typeof o.best !== "boolean" || !str(o.feedback) || (o.best && !o.valid)) problems.push(`${sl}: malformed option`);
        break;
      }
      case "produce":
      case "recall": {
        const p = isRecord(s.produce) ? s.produce : null;
        if (!p) {
          problems.push(`${sl}: produce rubric required`);
          break;
        }
        for (const k of ["accepted", "lexical", "keywords", "distractors", "wordBank"]) if (!Array.isArray(p[k]) || !(p[k] as unknown[]).length) problems.push(`${sl}: ${k} must be a non-empty reviewed list`);
        if (!["en", "es"].includes(String(p.language)) || !str(p.frame) || !str(p.sentenceDe) || !str(p.instruction)) problems.push(`${sl}: language, frame, instruction and sentenceDe required`);
        const fb = isRecord(p.feedback) ? p.feedback : null;
        if (!fb || !str(fb.distractor) || !str(fb.unclear) || !str(fb.lexical)) problems.push(`${sl}: reviewed feedback lines (distractor, unclear, lexical) required`);
        if (fb && /zuordnen|zugeordnet|matcher|nicht bewertet/i.test(`${fb.unclear} ${fb.distractor}`)) problems.push(`${sl}: child-facing feedback must not expose matcher wording`);
        const kw = Array.isArray(p.keywords) ? (p.keywords as string[]).map(normalize) : [];
        for (const a of [...(Array.isArray(p.accepted) ? p.accepted : []), ...(Array.isArray(p.lexical) ? p.lexical : [])] as string[]) if (!normalize(a).split(" ").some((t) => kw.includes(t))) problems.push(`${sl}: "${a}" contains no keyword`);
        for (const d of (Array.isArray(p.distractors) ? p.distractors : []) as string[]) if (kw.includes(normalize(d))) problems.push(`${sl}: distractor "${d}" is also a keyword`);
        const words = Array.isArray(p.repairWords) ? (p.repairWords as unknown[]) : [];
        if (!words.length) problems.push(`${sl}: repairWords required (bounded spelling repair)`);
        for (const w of words) if (!isRecord(w) || !str(w.word) || !str(w.meaningDe) || !str(w.spellingNote)) problems.push(`${sl}: malformed repair word`);
        if (s.kind === "recall") {
          const r = isRecord(s.retrieval) ? s.retrieval : null;
          if (!r || (!str(r.focus) && !str(r.step)) || !str(r.note)) problems.push(`${sl}: a recall step must name the evidence it revisits`);
          if (r && str(r.step) && !stepIds.includes(String(r.step))) problems.push(`${sl}: retrieval step ${String(r.step)} unknown`);
        }
        break;
      }
      case "typing-block":
        typingBlocks += 1;
        break;
      case "solve": {
        solves += 1;
        checkSolve(s.solve, sl, stepIds, problems);
        break;
      }
      case "write": {
        const w = isRecord(s.write) ? s.write : null;
        if (!w || !["prompt", "instruction", "thanks", "correctionIntro", "keep"].every((k) => str(w[k]))) problems.push(`${sl}: write needs prompt, instruction, thanks, correctionIntro and keep`);
        break;
      }
      default:
        break;
    }
    if ((s.kind === "produce" || s.kind === "recall") && isRecord(s.produce) && s.produce.nearMiss !== undefined && (!isRecord(s.produce.nearMiss) || !str(s.produce.nearMiss.ack))) problems.push(`${sl}: nearMiss needs its acknowledgement line`);
  }
  if (scene) {
    // Scene missions (content v6): problems answered question by question, one listening task, one request, one own sentence.
    if (solves < 1) problems.push(`${label}: a scene mission needs at least one reviewed problem`);
    if (!steps.some((s) => isRecord(s) && s.kind === "write")) problems.push(`${label}: a scene mission needs its own sentence`);
    const r = isRecord(m.rules) ? m.rules : null;
    if (!r || !Number.isInteger(r.maxPartAttempts) || (r.maxPartAttempts as number) < 3 || !Number.isInteger(r.maxPracticeAttempts) || (r.maxPracticeAttempts as number) < 1) problems.push(`${label}: rules.maxPartAttempts (≥ 3: recheck, stuck, teach) and maxPracticeAttempts required`);
    const na = isRecord(m.nextAdventure) ? m.nextAdventure : null;
    const choiceList = Array.isArray(na?.choices) ? (na!.choices as unknown[]) : [];
    if (!na || !str(na.prompt) || !str(na.hint) || !str(na.ownIdeaLabel) || choiceList.length < 2 || choiceList.length > 3 || choiceList.some((c) => !isRecord(c) || !str(c.id) || !str(c.label) || !["greenhouse", "water"].includes(String(c.picture)))) problems.push(`${label}: nextAdventure needs a prompt, a hint, two or three pictured choices and the own-idea label`);
  } else {
    if (calcs < 3 || calcs > 5) problems.push(`${label}: 3–5 connected calculations per mission (got ${calcs}); counts are tunable visit data`);
    if (choices < 1) problems.push(`${label}: at least one planning/logic choice`);
  }
  if (typingBlocks !== 1) problems.push(`${label}: exactly one typing block step`);
  const outcome = steps.filter((s) => isRecord(s) && s.kind === "outcome");
  if (outcome.length !== 1) problems.push(`${label}: exactly one outcome step`);
  // The dependency graph must be acyclic.
  const byId = new Map(steps.filter(isRecord).map((s) => [String(s.id), (Array.isArray(s.requires) ? s.requires : []).map(String)]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return true;
    if (state.get(id) === 1) return false;
    state.set(id, 1);
    for (const r of byId.get(id) ?? []) if (!visit(r)) return false;
    state.set(id, 2);
    return true;
  };
  for (const id of byId.keys()) if (!visit(id)) {
    problems.push(`${label}: the step dependencies contain a cycle`);
    break;
  }
  const world = Array.isArray(m.world) ? (m.world as unknown[]) : [];
  for (const w of world) if (!isRecord(w) || !str(w.id) || !stepIds.includes(String(w.after)) || !placeIds.has(String(w.place)) || !Number.isInteger(w.count) || !str(w.label)) problems.push(`${label}: malformed world change`);
  const tb = isRecord(m.typingBlock) ? m.typingBlock : null;
  if (!tb || !str(tb.id) || tb.version !== 1 || !num(tb.targetActiveSeconds) || !Number.isInteger(tb.minDrills) || !Number.isInteger(tb.maxDrills) || (tb.minDrills as number) < 1 || (tb.maxDrills as number) < (tb.minDrills as number) || !num(tb.fallbackCharsPerSecond) || !num(tb.idleGapSeconds) || tb.extraDrills !== 1 || !num(tb.minTypedShare) || !Array.isArray(tb.pattern) || !tb.pattern.length || !str(tb.announce) || !str(tb.note)) problems.push(`${label}: malformed typing block`);
  else if (!/not .*research|kein.*Forschung|calibration/i.test(String(tb.note))) problems.push(`${label}: the typing block note must state that its duration is a calibration, not a research-proven optimum`);
  const rules = isRecord(m.rules) ? m.rules : null;
  if (!rules || !["maxCalcAttempts", "maxQuestionAttempts", "maxProduceAttempts", "maxChoiceAttempts"].every((k) => Number.isInteger(rules[k]) && (rules[k] as number) >= 1)) problems.push(`${label}: rules (attempt bounds) required`);
  const est = isRecord(m.estimatedMinutes) ? m.estimatedMinutes : null;
  if (!est || !num(est.min) || !num(est.max)) problems.push(`${label}: estimatedMinutes required`);
}

function checkDiagram(d: unknown): boolean {
  return isRecord(d) && Number.isInteger(d.total) && (d.total as number) >= 1 && (d.total as number) <= 40 && Number.isInteger(d.perGroup) && (d.perGroup as number) >= 1 && str(d.unit) && str(d.container);
}

const ANSWER_FORM = (n: number) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`);

/** Content v6: one question per part, an ordered complete hint ladder, worked teaching that states the answer, no answer in the question. */
function checkSolve(raw: unknown, sl: string, stepIds: string[], problems: string[]) {
  const sv = isRecord(raw) ? raw : null;
  if (!sv || !Array.isArray(sv.facts) || !sv.facts.length || sv.facts.some((f) => !str(f)) || !Array.isArray(sv.parts) || !sv.parts.length) {
    problems.push(`${sl}: solve needs its visible facts and at least one part`);
    return;
  }
  if (sv.diagram !== undefined && sv.diagram !== null && !checkDiagram(sv.diagram)) problems.push(`${sl}: malformed diagram`);
  if (sv.application !== undefined) {
    const a = isRecord(sv.application) ? sv.application : null;
    if (!a || !stepIds.includes(String(a.of)) || a.kind !== "same-day-application") problems.push(`${sl}: application must name an earlier step and kind same-day-application`);
  }
  const partIds = (sv.parts as unknown[]).map((p) => (isRecord(p) ? String(p.id) : "?"));
  if (new Set(partIds).size !== partIds.length) problems.push(`${sl}: duplicate part ids`);
  for (const p of sv.parts as unknown[]) {
    if (!isRecord(p) || !str(p.id) || !str(p.question) || !str(p.unit) || !Number.isInteger(p.answer) || (p.answer as number) < 0 || !str(p.recheck) || !str(p.stuck) || !str(p.teach) || !Array.isArray(p.hints)) {
      problems.push(`${sl}: malformed part`);
      continue;
    }
    const pl = `${sl}/${String(p.id)}`;
    if (!String(p.question).trim().endsWith("?")) problems.push(`${pl}: the question must be one complete question`);
    if (!ANSWER_FORM(p.answer as number).test(String(p.teach))) problems.push(`${pl}: the teaching must state the answer ${String(p.answer)}`);
    for (const k of ["recheck", "stuck"]) if (ANSWER_FORM(p.answer as number).test(String(p[k]))) problems.push(`${pl}: ${k} must not state the answer`);
    if (!(p.hints as unknown[]).length) problems.push(`${pl}: at least one reviewed hint`);
    const levels: number[] = [];
    const hintIds = new Set<string>();
    for (const h of p.hints as unknown[]) {
      if (!isRecord(h) || !str(h.id) || !Number.isInteger(h.level) || !str(h.text) || !["grouping", "subtract", "extra-tray", "count-all", "compare", "word-options"].includes(String(h.type))) {
        problems.push(`${pl}: malformed hint`);
        continue;
      }
      if (hintIds.has(String(h.id))) problems.push(`${pl}: duplicate hint ${String(h.id)}`);
      hintIds.add(String(h.id));
      levels.push(h.level as number);
      const exposes = Array.isArray(h.exposes) ? (h.exposes as unknown[]).map(String) : [];
      if (exposes.some((x) => !partIds.includes(x))) problems.push(`${pl}/${String(h.id)}: exposes names an unknown part`);
      // Exposure is DECLARED by the reviewed content (a number in a hint may be the group size, not the answer); the engine records it.
      if (h.diagram !== undefined && h.diagram !== null && !checkDiagram(h.diagram)) problems.push(`${pl}/${String(h.id)}: malformed diagram`);
      if (h.check !== undefined) {
        const c = isRecord(h.check) ? h.check : null;
        if (!c || !str(c.prompt) || !str(c.answer) || !str(c.correct) || !str(c.wrong) || (c.kind !== "number" && c.kind !== "pick")) problems.push(`${pl}/${String(h.id)}: malformed hint check (prompt, answer, correct and wrong replies)`);
        else {
          if (c.kind === "pick" && (!Array.isArray(c.options) || c.options.length < 2 || !c.options.includes(c.answer))) problems.push(`${pl}/${String(h.id)}: the check answer must be one of its options`);
          if (c.kind === "number" && !/^\d+$/.test(String(c.answer))) problems.push(`${pl}/${String(h.id)}: a number check needs a whole-number answer`);
          if (c.representation !== undefined && c.representation !== null && !checkDiagram(c.representation)) problems.push(`${pl}/${String(h.id)}: malformed representation`);
          const eow = Array.isArray(c.exposesOnWrong) ? (c.exposesOnWrong as unknown[]).map(String) : [];
          if (eow.some((x) => !partIds.includes(x))) problems.push(`${pl}/${String(h.id)}: exposesOnWrong names an unknown part`);
        }
      }
    }
    if (levels.some((l, i) => l !== i + 1)) problems.push(`${pl}: hint levels must be 1, 2, 3 … in order`);
    if (p.reflect !== undefined && (!isRecord(p.reflect) || !str(p.reflect.prompt))) problems.push(`${pl}: reflect needs its prompt`);
  }
}

export function checkNextInterest(raw: unknown, problems: string[]): void {
  const n = isRecord(raw) ? raw : null;
  if (!n || !["prompt", "hint", "unsureLabel", "noPreferenceLabel", "declineLabel", "entryPrompt", "note"].every((k) => str(n[k]))) problems.push("reflection.nextInterest: prompt, hint, unsure/no-preference/decline labels, entry prompt and note required from content version 5");
}
