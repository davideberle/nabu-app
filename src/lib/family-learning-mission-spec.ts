// ---------------------------------------------------------------------------
// Family Assistant learning — reviewed MISSION specification (content v5, Visit 6).
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
};

export type MissionCalc = {
  prompt: string;
  fields: MissionField[];
  clarification: string;
  /** A counters picture: `total` objects drawn in rows of `perGroup` (help, recorded before it is shown). */
  representation: { text: string; total: number; perGroup: number; unit: string };
  teach: string;
};

export type MissionChoiceOption = { id: string; label: string; valid: boolean; best: boolean; feedback: string };

export type MissionStepKind = "story" | "read" | "listen" | "calc" | "choice" | "produce" | "recall" | "typing-block" | "outcome";

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
  /** Conditional retrieval: the step is offered only when the named step did NOT end independent (else `not-needed`). */
  when?: { step: string; unlessEvidence: "independent" };
  /** Read: the written text (shown, never read aloud). Listen: the audio script (played, never shown before the support is recorded). */
  text?: { language: MissionLanguage; body: string; de?: string | null };
  questions?: MissionQuestion[];
  calc?: MissionCalc;
  choice?: { prompt: string; options: MissionChoiceOption[]; teach: string };
  produce?: MissionProduce;
  /** Recall steps: the earlier evidence this retrieval revisits (an open practice focus id or a step of this mission). */
  retrieval?: { focus?: string; step?: string; note: string };
  /** Supplies granted when the step ends (any outcome that lets the mission continue). */
  supplies?: Record<string, number>;
};

export type MissionWorldChange = {
  id: string;
  /** The step whose completion (done, practiced, taught or unresolved-but-given) shows the change. */
  after: string;
  prop: "crates" | "tool-crates" | "boats" | "ropes" | "route" | "radio" | "sail";
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

export type MissionDef = {
  id: string;
  version: number;
  visit: string;
  title: string;
  objective: string;
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

export const MISSION_STEP_KINDS: readonly MissionStepKind[] = ["story", "read", "listen", "calc", "choice", "produce", "recall", "typing-block", "outcome"];

/** Exact inventory of content version 5, by stable id (reconciliation contract). */
export const EXPECTED_MISSION_IDS_V5: readonly string[] = ["MISSION-SHIP-SUPPLY"];
export const EXPECTED_MISSION_STEP_IDS_V5: readonly string[] = [
  "S1-BRIEF", "S2-BOARD", "S3-RADIO", "S4-WATER", "S5-CRATES", "S6-ROSA", "S7-ROSA-REPLY", "S8-TOOLS", "S9-LOAD", "S10-ROPES", "S11-ROUTE", "S12-TYPING", "S13-RECALL-CUERDAS", "S14-LAUNCH",
];

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFC").replace(/[.,!?;:¡¿"'’]/g, " ").replace(/\s+/g, " ").trim();
}

/** Validates the reviewed mission documents of a content file; every problem is reported, nothing is repaired. */
export function checkMissions(raw: unknown, problems: string[]): void {
  if (!Array.isArray(raw)) {
    problems.push("missions: list required from content version 5");
    return;
  }
  const ids = raw.map((m) => (isRecord(m) && typeof m.id === "string" ? m.id : "?"));
  const missing = EXPECTED_MISSION_IDS_V5.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !EXPECTED_MISSION_IDS_V5.includes(id));
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
  const missing = EXPECTED_MISSION_STEP_IDS_V5.filter((id) => !stepIds.includes(id));
  const extra = stepIds.filter((id) => !EXPECTED_MISSION_STEP_IDS_V5.includes(id));
  if (missing.length) problems.push(`${label}: steps missing ${missing.join(", ")}`);
  if (extra.length) problems.push(`${label}: unexpected steps ${extra.join(", ")}`);
  const dupes = stepIds.filter((id, i) => stepIds.indexOf(id) !== i);
  if (dupes.length) problems.push(`${label}: duplicate steps ${dupes.join(", ")}`);
  let calcs = 0;
  let choices = 0;
  let typingBlocks = 0;
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
      default:
        break;
    }
  }
  if (calcs < 3 || calcs > 5) problems.push(`${label}: 3–5 connected calculations per mission (got ${calcs}); counts are tunable visit data`);
  if (choices < 1) problems.push(`${label}: at least one planning/logic choice`);
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

export function checkNextInterest(raw: unknown, problems: string[]): void {
  const n = isRecord(raw) ? raw : null;
  if (!n || !["prompt", "hint", "unsureLabel", "noPreferenceLabel", "declineLabel", "entryPrompt", "note"].every((k) => str(n[k]))) problems.push("reflection.nextInterest: prompt, hint, unsure/no-preference/decline labels, entry prompt and note required from content version 5");
}
