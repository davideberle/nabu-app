// ---------------------------------------------------------------------------
// Step 2 A (2026-11-02): the reviewed, static map from task objective ids (as stored in
// family_learning_attempts.objective) to the skill rows of the parent's level report. One table per child, so a record
// can only ever land on its own child's rows.
//
// Sources (Workspace, learning/competency-map-2026-10-16): COMPETENCY-MAP.md (Santiago), ISABEL-COMPETENCY-MAP.md
// (Isabel, written for this step) and ASSESSMENT-RULES.md. Every Lehrplan 21 code below was re-checked against
// bs.lehrplan.ch on 2026-11-02 with the calibrated page parser (cycle, Grundanspruch and ⊙ markers); every CEFR
// descriptor is a Companion Volume (2020) descriptor with its printed page, as verified on 2026-10-16.
//
// A row is an observation opportunity toward one narrow descriptor. It never says the child "is at" a Lehrplan 21 or
// CEFR level (ASSESSMENT-RULES §1, §5).
//
// Objective ids built at run time get a suffix on top of the authored id (family-learning-mission.ts):
//   `-practice`   typed after the answer was shown — copying, never success;
//   `-hint-check` the small question inside a hint — stored as supported;
//   `-revision`   a revision of the child's own sentence.
// `resolveObjective` maps those to their base id's row with that role. Anything else that is not in the table is
// UNMAPPED and is listed in the parent footnote with its count — never silently dropped.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";

export type SkillSubject = "math" | "german" | "english" | "spanish";

export type Lp21Ref = {
  kind: "lp21";
  code: string;
  url: string;
  cycles: number[];
  /** Grundanspruch: to be reached by the end of the cycle. */
  minimum: boolean;
  /** The ⊙ orientation point follows this level: worked on by the end of grade 4 (Zyklus 2). */
  orientation: boolean;
  /** The bullet the task observes, quoted as on bs.lehrplan.ch. */
  bullet: string;
};

export type CefrStep = "Pre-A1" | "A1" | "A2";

export type CefrDescriptor = { step: CefrStep; scale: string; page: number; text: string };

export type Fit = "direct" | "partial" | "provisional";

export type SkillRow = {
  id: string;
  child: ChildId;
  subject: SkillSubject;
  /** Short English label, e.g. «Division with remainder». */
  label: string;
  /** What the tasks actually ask, in plain English. */
  observes: string;
  /** Row id in the Workspace competency map (M1, D-R1 …), for the reviewer. */
  mapRow: string | null;
  fit: Fit;
  /** Lehrplan 21 rows; CEFR rows use `cefr` instead. */
  lp21?: Lp21Ref;
  /** CEFR rows: the descriptors our tasks are pitched at, lowest step first. */
  cefr?: CefrDescriptor[];
  /** Sentences only, no rubric: shown as «observed, not scored» (ASSESSMENT-RULES §3, D-W2). */
  observedOnly?: boolean;
  /** A row named in the request that no task observes yet (shown honestly as «no task yet»). */
  noTaskYet?: boolean;
};

/**
 * What an attempt on this objective can show for its row:
 *  - `task`        an ordinary task of the row;
 *  - `fresh`       a fresh application in a new story or setting (authored as such);
 *  - `easier`      the easier version — counts, but never as the «new situation»;
 *  - `warmup`      a «Weisst du noch?» warm-up: its teachingReason (`skill:delayed-retention|short-check`) decides «held»;
 *  - `practice`    copying after the answer was shown — never success (ASSESSMENT-RULES §3a);
 *  - `hint-check`  the question inside a hint — help by definition;
 *  - `revision`    the child's revision of an own sentence.
 */
export type ObjectiveRole = "task" | "fresh" | "easier" | "warmup" | "practice" | "hint-check" | "revision";

export type ObjectiveMapping =
  | { kind: "row"; row: string; role: ObjectiveRole; cefrStep?: CefrStep }
  /** Same objective id, different language: decided by the attempt's stimulus language. */
  | { kind: "by-language"; rows: Partial<Record<"de" | "en" | "es", { row: string; role: ObjectiveRole; cefrStep?: CefrStep }>> }
  /** Deliberately not a skill row: the reason is shown to the parent. */
  | { kind: "not-a-skill"; reason: string };

// ---------------------------------------------------------------------------
// Lehrplan 21 references (bs.lehrplan.ch, re-checked 2026-11-02)
// ---------------------------------------------------------------------------

const LP = (path: string) => `https://bs.lehrplan.ch/index.php?code=${path.split("|").join("%7C")}`;

const MA_1_A_3_A: Lp21Ref = { kind: "lp21", code: "MA.1.A.3.a", url: LP("a|5|0|1|1|3"), cycles: [1], minimum: false, orientation: false, bullet: "können im Zahlenraum bis 20 ohne Zählen verdoppeln, halbieren, addieren und subtrahieren." };
const MA_1_A_3_B: Lp21Ref = { kind: "lp21", code: "MA.1.A.3.b", url: LP("a|5|0|1|1|3"), cycles: [1], minimum: true, orientation: false, bullet: "können zweistellige Zahlen in 10er und 1er zerlegen (z.B. 25 in zwei 10er und fünf 1er)." };
const MA_1_A_3_D: Lp21Ref = { kind: "lp21", code: "MA.1.A.3.d", url: LP("a|5|0|1|1|3"), cycles: [2], minimum: false, orientation: false, bullet: "kennen die Produkte des kleinen Einmaleins." };
const MA_1_A_3_E: Lp21Ref = { kind: "lp21", code: "MA.1.A.3.e", url: LP("a|5|0|1|1|3"), cycles: [2], minimum: false, orientation: true, bullet: "können natürliche Zahlen durch einstellige Divisoren dividieren (im Kopf oder mit Notieren eigener Rechenwege, z.B. 231 : 7)." };
const MA_2_A_3_D: Lp21Ref = { kind: "lp21", code: "MA.2.A.3.d", url: LP("a|5|0|2|1|3"), cycles: [2], minimum: false, orientation: true, bullet: "können Flächen mit Einheitsquadraten auszählen (z.B. das Schulzimmer mit Meterquadraten)." };
const MA_2_A_3_E_AREA: Lp21Ref = { kind: "lp21", code: "MA.2.A.3.e", url: LP("a|5|0|2|1|3"), cycles: [2], minimum: true, orientation: false, bullet: "können den Flächeninhalt von Quadraten und Rechtecken berechnen." };
const MA_2_A_3_E_PERIM: Lp21Ref = { kind: "lp21", code: "MA.2.A.3.e", url: LP("a|5|0|2|1|3"), cycles: [2], minimum: true, orientation: false, bullet: "können den Umfang von Vielecken messen und berechnen." };
const MA_3_B_1_C: Lp21Ref = { kind: "lp21", code: "MA.3.B.1.c", url: LP("a|5|0|3|2|1"), cycles: [1], minimum: true, orientation: false, bullet: "können Sachsituationen bezüglich Anzahlen, Strecken, Zeitpunkten, Zeitdauern und Preisen erforschen sowie Zusammenhänge beschreiben und erfragen." };
const MA_3_C_2_D: Lp21Ref = { kind: "lp21", code: "MA.3.C.2.d", url: LP("a|5|0|3|3|2"), cycles: [2], minimum: false, orientation: true, bullet: "können zu Texten, Tabellen und Diagrammen Fragen stellen, eigene Berechnungen ausführen sowie Ergebnisse interpretieren und überprüfen." };
const D_1_B_1_A: Lp21Ref = { kind: "lp21", code: "D.1.B.1.a", url: LP("a|1|11|1|2|1"), cycles: [1], minimum: false, orientation: false, bullet: "können einfache Aufträge und Erklärungen zu bekannten Sachthemen und Alltagssituationen verstehen und ausführen (z.B. alltägliche Abläufe)." };
const D_1_B_1_D: Lp21Ref = { kind: "lp21", code: "D.1.B.1.d", url: LP("a|1|11|1|2|1"), cycles: [1, 2], minimum: false, orientation: false, bullet: "können Wichtiges in einfachen Mitteilungen erkennen (z.B. telefonische Auskunft, Lautsprecherdurchsage)." };
const D_2_A_1_B: Lp21Ref = { kind: "lp21", code: "D.2.A.1.b", url: LP("a|1|11|2|1|1"), cycles: [1], minimum: false, orientation: false, bullet: "können die passende Beziehung zwischen Buchstaben und Lauten herstellen sowie Buchstaben zu Silben und kurzen Wörtern aus dem schulnahen Wortschatz verbinden. können kurze Sätze langsam erlesen." };
const D_2_B_1_F: Lp21Ref = { kind: "lp21", code: "D.2.B.1.f", url: LP("a|1|11|2|2|1"), cycles: [2], minimum: true, orientation: false, bullet: "können die Struktur eines Textes erkennen und explizite Informationen entnehmen." };
const D_4_D_1_C: Lp21Ref = { kind: "lp21", code: "D.4.D.1.c", url: LP("a|1|11|4|4|1"), cycles: [1, 2], minimum: false, orientation: false, bullet: "können ihre Gedanken und Ideen in eine verständliche Abfolge bringen und in passende Worte fassen." };
const D_4_F_1_A: Lp21Ref = { kind: "lp21", code: "D.4.F.1.a", url: LP("a|1|11|4|6|1"), cycles: [1], minimum: true, orientation: false, bullet: "können unter Anleitung bei der formalen Überarbeitung erste Regeln beachten: lautgetreue Schreibweise, Wortgrenzen, Eigennamen und konkrete Nomen gross, Satzanfang gross, Punkt am Satzende." };

/** The typing block's reference (keyboard use; finger use is never observable). */
export const TYPING_REF: Lp21Ref = { kind: "lp21", code: "D.4.A.1.e", url: LP("a|1|11|4|1|1"), cycles: [1, 2], minimum: false, orientation: false, bullet: "können mit verschiedenen Schreibgeräten ihre Texte gestalten (z.B. verschiedene Schreibstifte, Tastatur)." };

// ---------------------------------------------------------------------------
// CEFR Companion Volume (2020) descriptors (printed pages; verified 2026-10-16)
// ---------------------------------------------------------------------------

const CEFR_LISTEN_NUMBERS: CefrDescriptor = { step: "Pre-A1", scale: "Overall oral comprehension", page: 48, text: "Can recognise numbers, prices, dates and days of the week, provided they are delivered slowly and clearly in a defined, familiar everyday context." };
const CEFR_LISTEN_SIMPLE: CefrDescriptor = { step: "Pre-A1", scale: "Overall oral comprehension", page: 48, text: "Can understand short, very simple questions and statements, provided they are delivered slowly and clearly and accompanied by visuals or manual gestures …" };
const CEFR_LISTEN_DIRECTIONS: CefrDescriptor = { step: "A1", scale: "Understanding announcements and instructions", page: 51, text: "Can understand instructions addressed carefully and slowly to them and follow short, simple directions." };
const CEFR_READ_PICTURES: CefrDescriptor = { step: "Pre-A1", scale: "Overall reading comprehension", page: 54, text: "Can recognise familiar words/signs accompanied by pictures …" };
const CEFR_ASK_GESTURE: CefrDescriptor = { step: "Pre-A1", scale: "Obtaining goods and services", page: 78, text: "Can make simple purchases and/or order food or drink when pointing or other gesture can support the verbal reference." };
const CEFR_ASK_THINGS: CefrDescriptor = { step: "A1", scale: "Obtaining goods and services", page: 78, text: "Can ask people for things and give people things." };
const CEFR_COPY: CefrDescriptor = { step: "A1", scale: "Orthographic control", page: 136, text: "Can copy familiar words and short phrases, e.g. simple signs or instructions, names of everyday objects …" };

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const SANTIAGO_ROWS: SkillRow[] = [
  { id: "s-share", child: "santiago", subject: "math", label: "Sharing equally (division, no remainder)", observes: "Share a number of things equally in a story (up to 35 things, groups of up to 5).", mapRow: "M1", fit: "partial", lp21: MA_1_A_3_E },
  { id: "s-remainder", child: "santiago", subject: "math", label: "Division with remainder", observes: "Full groups and what is left over, in a story.", mapRow: "M2, M3", fit: "partial", lp21: MA_1_A_3_E },
  { id: "s-groups-needed", child: "santiago", subject: "math", label: "Using the remainder: groups needed for all", observes: "Decide how many crates, trays or boats are needed so nothing is left behind (one more for the leftovers).", mapRow: "M3, M5", fit: "direct", lp21: MA_3_C_2_D },
  { id: "s-multiply", child: "santiago", subject: "math", label: "Multiplication in a story", observes: "Single times-table facts in context, and comparing a product with an amount.", mapRow: "M4", fit: "partial", lp21: MA_1_A_3_D },
  { id: "s-area-count", child: "santiago", subject: "math", label: "Area: counting unit squares", observes: "Count 1 m fields on a floor plan, and take away the fields of a path.", mapRow: "M8 (new)", fit: "direct", lp21: MA_2_A_3_D },
  { id: "s-area-calc", child: "santiago", subject: "math", label: "Area as a multiplication", observes: "Write the area of a rectangle as rows × fields and calculate it.", mapRow: "M9 (new)", fit: "partial", lp21: MA_2_A_3_E_AREA },
  { id: "s-perimeter", child: "santiago", subject: "math", label: "Perimeter and lengths", observes: "The length around a bed in m and cm, kept apart from the fields inside (area).", mapRow: "M10 (new)", fit: "partial", lp21: MA_2_A_3_E_PERIM },
  { id: "s-plan", child: "santiago", subject: "math", label: "Choosing a plan that meets every rule", observes: "Pick the plan or route that keeps every rule (capacity, path, reef); given options.", mapRow: "M6", fit: "provisional", lp21: MA_3_B_1_C },
  { id: "s-de-read", child: "santiago", subject: "german", label: "Reading: facts in a short text", observes: "Find explicit facts in a short German rule text.", mapRow: "D-R1", fit: "partial", lp21: D_2_B_1_F },
  { id: "s-de-listen", child: "santiago", subject: "german", label: "Listening (German)", observes: "No German listening task so far — Nokt and the story speak German, but nothing checks understanding.", mapRow: null, fit: "partial", lp21: D_1_B_1_D, noTaskYet: true },
  { id: "s-de-write-meaning", child: "santiago", subject: "german", label: "Writing: own sentence (meaning)", observes: "Own typed sentences for a purpose (logbook, journal). No reviewed rubric for meaning, so never scored.", mapRow: "D-W2", fit: "provisional", lp21: D_4_D_1_C, observedOnly: true },
  { id: "s-de-write-mechanics", child: "santiago", subject: "german", label: "Writing: spaces and end mark (mechanics)", observes: "Word gaps and the end mark in own sentences, and fixing them when they are pointed out.", mapRow: "D-W1", fit: "direct", lp21: D_4_F_1_A },
  { id: "s-en-listen", child: "santiago", subject: "english", label: "English listening", observes: "A number or a thing in a short spoken message; short directions (next to, behind, between).", mapRow: "E-L1", fit: "provisional", cefr: [CEFR_LISTEN_NUMBERS, CEFR_LISTEN_DIRECTIONS] },
  { id: "s-en-read", child: "santiago", subject: "english", label: "English reading", observes: "Recognise the needed thing in a short written request.", mapRow: "E-R1", fit: "direct", cefr: [CEFR_READ_PICTURES] },
  { id: "s-en-speak", child: "santiago", subject: "english", label: "English speaking: asking for things", observes: "Complete the word, then make the whole request «We need …» (typed answers count only provisionally).", mapRow: "E-P1", fit: "provisional", cefr: [CEFR_ASK_GESTURE, CEFR_ASK_THINGS] },
  { id: "s-en-write", child: "santiago", subject: "english", label: "English writing", observes: "No English writing task so far.", mapRow: null, fit: "provisional", cefr: [CEFR_COPY], noTaskYet: true },
  { id: "s-es-listen", child: "santiago", subject: "spanish", label: "Spanish listening", observes: "A number in a short spoken reply; a short spoken request from Rosa.", mapRow: "S-L1", fit: "provisional", cefr: [CEFR_LISTEN_NUMBERS, CEFR_LISTEN_SIMPLE] },
  { id: "s-es-read", child: "santiago", subject: "spanish", label: "Spanish reading", observes: "Recognise the needed thing in a short written request.", mapRow: "S-R1", fit: "direct", cefr: [CEFR_READ_PICTURES] },
  { id: "s-es-speak", child: "santiago", subject: "spanish", label: "Spanish speaking: asking for things", observes: "Complete the word, then make the whole request «Necesitamos …», also from memory days later (typed answers count only provisionally).", mapRow: "S-P1, S-RET", fit: "provisional", cefr: [CEFR_ASK_GESTURE, CEFR_ASK_THINGS] },
  { id: "s-es-write", child: "santiago", subject: "spanish", label: "Spanish writing", observes: "No Spanish writing task so far.", mapRow: null, fit: "provisional", cefr: [CEFR_COPY], noTaskYet: true },
];

const ISABEL_ROWS: SkillRow[] = [
  { id: "i-tens", child: "isabel", subject: "math", label: "Tens and ones (place value)", observes: "Count bundles of ten and loose ones with pictures (e.g. 20 + 3, 43); a bundle has 10.", mapRow: "IM1", fit: "partial", lp21: MA_1_A_3_B },
  { id: "i-sums", child: "isabel", subject: "math", label: "Small sums and differences", observes: "Add and take away small numbers with visible counters (within 10, then within 20, also across ten).", mapRow: "IM2", fit: "partial", lp21: MA_1_A_3_A },
  { id: "i-read", child: "isabel", subject: "german", label: "Early reading: words and a first phrase", observes: "Read one short word with pictures to choose from, later a first two-word phrase.", mapRow: "ID1", fit: "partial", lp21: D_2_A_1_B },
  { id: "i-listen", child: "isabel", subject: "german", label: "Listening: a spoken instruction", observes: "Hear a short German instruction and pick the matching picture (one, then two, then three details).", mapRow: "ID2", fit: "partial", lp21: D_1_B_1_A },
];

export const SKILL_ROWS: Record<ChildId, SkillRow[]> = { santiago: SANTIAGO_ROWS, isabel: ISABEL_ROWS };

// ---------------------------------------------------------------------------
// Objective → row (reviewed 2026-11-02). Keys are the authored objective ids of every content version plus the ids the
// engine writes for the earlier (non-mission) visits.
// ---------------------------------------------------------------------------

const row = (r: string, role: ObjectiveRole = "task", cefrStep?: CefrStep): ObjectiveMapping => ({ kind: "row", row: r, role, ...(cefrStep ? { cefrStep } : {}) });
const notASkill = (reason: string): ObjectiveMapping => ({ kind: "not-a-skill", reason });

const LISTEN_ONLY = "Listen-only step with no comprehension check (assessment rules §4) — not evidence for listening or reading.";
const STORY_BEAT = "Story or ending beat — nothing to answer.";

const SANTIAGO_MAP: Record<string, ObjectiveMapping> = {
  // Math
  "equal-sharing": row("s-share"),
  "equal-sharing-with-remainder": row("s-remainder"),
  "quotient-with-remainder": row("s-remainder"),
  "quotient-groups-leftover-warmup": row("s-remainder", "warmup"),
  "quotient-groups-needed": row("s-groups-needed"),
  "quotient-full-rest-needed": row("s-groups-needed"),
  "quotient-groups-needed-application": row("s-groups-needed", "fresh"),
  "quotient-groups-needed-retrieval": row("s-groups-needed"),
  "add-and-group": row("s-groups-needed", "fresh"),
  "multiplication-in-context": row("s-multiply"),
  "multiply-and-compare": row("s-multiply", "fresh"),
  "multiplication-division-liters": row("s-multiply", "fresh"),
  "area-count-fields": row("s-area-count"),
  "area-subtract-path": row("s-area-count", "fresh"),
  "area-written-multiplication-warmup": row("s-area-calc", "warmup"),
  "area-written-multiplication-path": row("s-area-calc"),
  "perimeter-vs-area": row("s-perimeter"),
  "plan-under-constraints": row("s-plan"),
  "plan-judgment-viable": row("s-plan", "fresh"),
  "route-judgment-viable": row("s-plan", "fresh"),
  "explain-own-method": notASkill("Explaining the own way — an opportunity that is never scored (no reviewed rubric; map row M7)."),
  // German
  "reading-for-information": row("s-de-read"),
  "writing-spacing-transfer": row("s-de-write-mechanics", "fresh"),
  "writing-review-revision": row("s-de-write-mechanics", "revision"),
  "writing-own-sentence-spacing": row("s-de-write-mechanics"),
  "writing-own-sentence-revision": row("s-de-write-mechanics", "revision"),
  "writing-two-sentences-revision": row("s-de-write-mechanics", "revision"),
  // English and Spanish (Visits 1–6: segment objectives `language-<lang>-<evidence>`)
  "language-en-listen": notASkill(LISTEN_ONLY),
  "language-es-listen": notASkill(LISTEN_ONLY),
  "language-en-recognition": row("s-en-read", "task", "Pre-A1"),
  "language-es-recognition": row("s-es-read", "task", "Pre-A1"),
  "language-en-completion": row("s-en-speak", "task", "Pre-A1"),
  "language-es-completion": row("s-es-speak", "task", "Pre-A1"),
  "language-en-production": row("s-en-speak", "task", "A1"),
  "language-es-production": row("s-es-speak", "task", "A1"),
  "language-es-request": row("s-es-speak", "fresh", "A1"),
  "language-es-request-retrieval": row("s-es-speak", "task", "A1"),
  "language-es-request-new-supported": row("s-es-speak", "fresh", "A1"),
  "language-es-retrieval": row("s-es-speak", "task", "A1"),
  "language-es-regadera-retrieval": row("s-es-speak", "warmup", "A1"),
  "listening-for-information": { kind: "by-language", rows: { en: { row: "s-en-listen", role: "task", cefrStep: "Pre-A1" }, es: { row: "s-es-listen", role: "task", cefrStep: "Pre-A1" } } },
  "listening-directions": row("s-en-listen", "task", "A1"),
  "listening-en-prepositions": row("s-en-listen", "fresh", "A1"),
  "listening-es-short-request": row("s-es-listen", "task", "Pre-A1"),
  // Typing has its own block (course lesson, accuracy, speed); the mission block is the drill itself.
  "typing-motor-practice": notASkill("Typing block — shown in the typing section (lesson, accuracy, speed), not as a ladder row."),
  story: notASkill(STORY_BEAT),
  outcome: notASkill(STORY_BEAT),
};

const ISABEL_MAP: Record<string, ObjectiveMapping> = {
  "tens-bundles-visible-supported": row("i-tens"),
  "tens-bundles-fresh-check": row("i-tens", "fresh"),
  "tens-bundles-retrieval-visible": row("i-tens"),
  "tens-bundles-fresh-application": row("i-tens", "fresh"),
  "tens-bundle-reteach-count": row("i-tens"),
  "tens-ones-closed-bundles": row("i-tens"),
  "tens-ones-fresh-application": row("i-tens", "fresh"),
  "small-sums-visible-counters": row("i-sums"),
  "small-sums-extended-visible-counters": row("i-sums", "fresh"),
  "small-sums-easier-path": row("i-sums", "easier"),
  "add-subtract-within-20-visible": row("i-sums"),
  "add-bridge-through-ten": row("i-sums", "fresh"),
  "add-within-10-easier": row("i-sums", "easier"),
  "early-reading-word-picture": row("i-read"),
  "early-reading-first-phrase-picture": row("i-read", "fresh"),
  "listening-recognition-german": row("i-listen"),
  "listening-recognition-german-two-details": row("i-listen", "fresh"),
  "listening-recognition-german-three-details": row("i-listen", "fresh"),
  "materials-matching": notASkill("Matching materials (wood, glass, brick) — a science (NMG) task, outside the four strands of this report."),
  "own-choice-not-scored": notASkill("The child's own choice in the story — not scored by design."),
  "real-world-craft-parent-observed": notASkill("Real-world craft — the parent's observation, not a child answer."),
  "real-world-craft-optional-parent-observed": notASkill("Real-world craft — the parent's observation, not a child answer."),
  story: notASkill(STORY_BEAT),
  outcome: notASkill(STORY_BEAT),
};

export const OBJECTIVE_MAP: Record<ChildId, Record<string, ObjectiveMapping>> = { santiago: SANTIAGO_MAP, isabel: ISABEL_MAP };

/** Run-time suffixes the engine appends to an authored objective id, and the role they give it. */
const SUFFIX_ROLES: [string, ObjectiveRole][] = [["-hint-check", "hint-check"], ["-practice", "practice"], ["-revision", "revision"]];

export type ResolvedObjective =
  | { kind: "row"; row: string; role: ObjectiveRole; cefrStep: CefrStep | null; via: string }
  | { kind: "not-a-skill"; reason: string; via: string }
  | { kind: "unmapped" };

/**
 * Where an attempt's objective lands for this child. `language` is the attempt's stimulus language (only consulted
 * for objectives shared across languages). Exact ids win over suffix rules; a suffix keeps the base row and takes the
 * suffix's role (a revision stays a revision even when the base id already ends in «-revision»).
 */
export function resolveObjective(child: ChildId, objective: string, language: string | null): ResolvedObjective {
  const table = OBJECTIVE_MAP[child];
  const pick = (m: ObjectiveMapping | undefined, roleOverride: ObjectiveRole | null, via: string): ResolvedObjective | null => {
    if (!m) return null;
    if (m.kind === "not-a-skill") return { kind: "not-a-skill", reason: m.reason, via };
    if (m.kind === "row") return { kind: "row", row: m.row, role: roleOverride ?? m.role, cefrStep: m.cefrStep ?? null, via };
    const l = (language ?? "") as "de" | "en" | "es";
    const r = m.rows[l];
    return r ? { kind: "row", row: r.row, role: roleOverride ?? r.role, cefrStep: r.cefrStep ?? null, via } : null;
  };
  const exact = pick(table[objective], null, objective);
  if (exact) return exact;
  for (const [suffix, role] of SUFFIX_ROLES) {
    if (!objective.endsWith(suffix)) continue;
    const base = objective.slice(0, -suffix.length);
    const r = pick(table[base], role, base);
    if (r && r.kind === "row") return r;
  }
  return { kind: "unmapped" };
}

/** Parent-entered reference only (David, 2026-11-02). Never computed, never used for a status, never compared. */
export const KUMON_REFERENCE: Record<ChildId, { level: string; enteredBy: string; enteredOn: string }> = {
  santiago: { level: "D", enteredBy: "David", enteredOn: "2026-11-02" },
  isabel: { level: "A", enteredBy: "David", enteredOn: "2026-11-02" },
};

/** «Zyklus 2, by end of grade 4» — the official level's cycle context in plain English (Basel-Stadt). */
export function cycleContext(ref: Lp21Ref): string {
  const c = ref.cycles;
  if (c.length > 1) return `Zyklus ${c[0]}–${c[c.length - 1]} (bridging level)`;
  const z = c[0];
  const end = z === 1 ? 2 : z === 2 ? 6 : 9;
  if (ref.orientation && z === 2) return "Zyklus 2, by end of grade 4";
  if (ref.orientation && z === 3) return "Zyklus 3, by mid grade 8";
  if (ref.minimum) return `Zyklus ${z} minimum, by end of grade ${end}`;
  return z === 1 ? "Zyklus 1 (kindergarten to grade 2)" : z === 2 ? "Zyklus 2 (grades 3–6)" : "Zyklus 3 (grades 7–9)";
}
