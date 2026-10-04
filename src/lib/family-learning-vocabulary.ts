// ---------------------------------------------------------------------------
// Vocabulary evidence ledger (DESIGN §7.6, September 30 follow-on).
//
// A per-child, per-language, versioned ledger of OBSERVATIONS, derived
// deterministically from the immutable language records in the saved mission
// state (and, for spontaneous use, from the child's own free texts) against a
// reviewed inventory of lexical entries. Nothing here is persisted: the
// ledger is a pure projection, so erasing the sources erases it, a reload
// re-derives exactly the same rows with the same stable ids, and a later
// inventory version can be applied without rewriting history.
//
// Dimensions stay separate and are never merged: recognition (picking the
// pictured supply for the word in a sentence), prompted recall (producing the
// word for the frame), writing (the canonical written form, typed), and
// spontaneous use (the word appearing in the child's own free text — always
// "review", never credited). Audio, a gloss, the word list, tutor help,
// retries and feedback make an observation SUPPORTED; only an observation
// with no recorded support is independent. One correct observation is an
// observation; "repeated independent" needs the policy's number of
// independent successes across distinct contexts and separate visits, and
// that policy is a configurable pilot parameter, never a research claim.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import { isLanguageSegmentId, type LanguageSegmentId, type LearningContent, type VisitId } from "./family-learning-content.ts";
import type { LanguageStepRecord, MissionState } from "./family-learning-state.ts";
import { visitOrdinal } from "./family-learning-summary.ts";

export const VOCABULARY_LEDGER_VERSION = 1;

export type VocabularyDimension = "recognition" | "recall" | "writing" | "spontaneous";
export const VOCABULARY_DIMENSIONS: readonly VocabularyDimension[] = ["recognition", "recall", "writing", "spontaneous"];

export type VocabularyContext = {
  id: string;
  taskId: LanguageSegmentId;
  stepId: string;
  version: number;
  dimension: "recognition" | "recall";
  stimulus: string;
  target?: string;
  variants?: Record<string, string>;
};

export type VocabularyEntry = {
  id: string;
  language: "en" | "es";
  lemma: string;
  partOfSpeech: string;
  concept: string;
  sense: string;
  gloss: string;
  /** Reviewed recognisable forms (lowercase, may include accent-less variants). */
  forms: string[];
  /** Forms that count as accurately written (subset of `forms`). */
  writtenForms: string[];
  contexts: VocabularyContext[];
  note?: string;
};

export type VocabularyPolicy = { independentSuccesses: number; distinctContexts: number; separateVisits: number; note: string };

export type VocabularyInventory = {
  inventoryId: string;
  inventoryVersion: number;
  child: ChildId;
  contentId: string;
  reviewed: { status: string; note: string };
  policy: VocabularyPolicy;
  entries: VocabularyEntry[];
};

export type VocabularyOutcome = "correct" | "incorrect" | "unscored" | "review";

export type VocabularyObservation = {
  /** Stable: entry / task / step / attempt number / dimension (free texts: entry / kind / index / spontaneous). */
  id: string;
  entryId: string;
  language: "en" | "es";
  lemma: string;
  dimension: VocabularyDimension;
  taskId: string;
  stepId: string | null;
  taskVersion: number;
  contextId: string;
  stimulus: string;
  response: string;
  modality: string;
  /** The visit the record belongs to; `null` for a legacy record (no visit id) whose timestamp falls outside every visit window — never guessed. */
  visit: VisitId | null;
  visitOrdinal: number | null;
  at: string;
  /** Recorded support/exposure kinds at the time (gloss, audio, word-choice, tutor, retry, feedback), exactly as the attempt row carries them; empty = independent. */
  support: string[];
  productionKind: string | null;
  outcome: VocabularyOutcome;
  independent: boolean;
  /** Link to the attempts table row (task_id + attempt_no) when one exists. */
  attemptRef: { taskId: string; attemptNo: number } | null;
  /** A parent correction on the linked attempt (shown; the observation is then excluded from counts). */
  correction: { evidence?: string; note?: string; by?: string; at?: string } | null;
  /** Counted in the summaries: a scored outcome without parent correction. */
  countable: boolean;
  uncertainty: string | null;
};

export type VocabularyStatus = "no-opportunity" | "not-observed" | "practice" | "supported-only" | "independent" | "independent-repeated" | "review-pending";

export type VocabularyDimensionSummary = {
  dimension: VocabularyDimension;
  /** Reviewed contexts in the served content that offer this dimension for the entry. */
  opportunities: number;
  observations: number;
  independentCorrect: number;
  supportedCorrect: number;
  incorrect: number;
  unscored: number;
  review: number;
  distinctContexts: number;
  separateVisits: number;
  lastAt: string | null;
  lastOutcome: VocabularyOutcome | null;
  status: VocabularyStatus;
};

export type VocabularyEntrySummary = {
  entryId: string;
  language: "en" | "es";
  lemma: string;
  gloss: string;
  sense: string;
  dimensions: Record<VocabularyDimension, VocabularyDimensionSummary>;
  /** Honest missingness lines for the parent. */
  missing: string[];
  note: string | null;
};

export type VocabularyLedger = {
  ledgerVersion: number;
  inventoryId: string;
  inventoryVersion: number;
  reviewed: { status: string; note: string };
  policy: VocabularyPolicy;
  derivedFrom: "mission-state";
  entries: VocabularyEntrySummary[];
  observations: VocabularyObservation[];
  notes: string[];
};

export type ParentCorrectionMap = Map<string, NonNullable<VocabularyObservation["correction"]>>;

// ---------------------------------------------------------------------------
// Inventory reconciliation (by stable id, against the served content)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

export function reconcileVocabularyInventory(raw: unknown, content: LearningContent): { ok: boolean; problems: string[]; counts: { entries: number; contexts: number; served: number } } {
  const problems: string[] = [];
  const counts = { entries: 0, contexts: 0, served: 0 };
  if (!isRecord(raw)) return { ok: false, problems: ["inventory is not an object"], counts };
  if (typeof raw.inventoryId !== "string" || !raw.inventoryId) problems.push("inventoryId missing");
  if (raw.inventoryVersion !== 1 && raw.inventoryVersion !== 2) problems.push(`inventoryVersion must be 1 or 2, got ${String(raw.inventoryVersion)}`);
  if (raw.child !== content.child) problems.push(`inventory child ${String(raw.child)} does not match content child ${content.child}`);
  if (raw.contentId !== content.contentId) problems.push(`inventory contentId ${String(raw.contentId)} does not match ${content.contentId}`);
  if (!isRecord(raw.reviewed) || typeof raw.reviewed.status !== "string" || typeof raw.reviewed.note !== "string") problems.push("reviewed.status/note missing");
  const policy = isRecord(raw.policy) ? raw.policy : null;
  for (const key of ["independentSuccesses", "distinctContexts", "separateVisits"]) {
    const v = policy?.[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10) problems.push(`policy.${key} must be an integer 1..10`);
  }
  if (typeof policy?.note !== "string" || !/pilot/i.test(policy.note)) problems.push("policy.note must state that the threshold is a pilot parameter");
  const entries = Array.isArray(raw.entries) ? raw.entries : null;
  if (!entries || entries.length === 0) problems.push("entries missing");
  const ids = new Set<string>();
  const ctxIds = new Set<string>();
  for (const e of entries ?? []) {
    if (!isRecord(e)) {
      problems.push("malformed entry");
      continue;
    }
    counts.entries += 1;
    const id = String(e.id);
    if (ids.has(id)) problems.push(`duplicate entry id ${id}`);
    ids.add(id);
    if (e.language !== "en" && e.language !== "es") problems.push(`${id}: language must be en or es`);
    for (const key of ["lemma", "partOfSpeech", "concept", "sense", "gloss"]) if (typeof e[key] !== "string" || !(e[key] as string).length) problems.push(`${id}: ${key} missing`);
    if (!isStrArray(e.forms) || e.forms.length === 0) problems.push(`${id}: forms missing`);
    else {
      if (typeof e.lemma === "string" && !e.forms.includes(e.lemma.toLowerCase())) problems.push(`${id}: forms must include the lemma`);
      for (const f of e.forms) if (f !== f.toLowerCase() || /\s/.test(f)) problems.push(`${id}: form "${f}" must be a lowercase single token`);
    }
    if (!isStrArray(e.writtenForms) || e.writtenForms.length === 0) problems.push(`${id}: writtenForms missing`);
    else if (isStrArray(e.forms)) for (const w of e.writtenForms) if (!e.forms.includes(w)) problems.push(`${id}: writtenForm "${w}" is not one of the forms`);
    if (!Array.isArray(e.contexts)) {
      problems.push(`${id}: contexts must be an array`);
      continue;
    }
    if (e.contexts.length === 0 && typeof e.note !== "string") problems.push(`${id}: an entry without contexts must say so in a note`);
    for (const c of e.contexts) {
      if (!isRecord(c)) {
        problems.push(`${id}: malformed context`);
        continue;
      }
      counts.contexts += 1;
      const cid = String(c.id);
      if (ctxIds.has(cid)) problems.push(`duplicate context id ${cid}`);
      ctxIds.add(cid);
      if (!isLanguageSegmentId(c.taskId)) {
        problems.push(`${cid}: taskId ${String(c.taskId)} is not a language segment id`);
        continue;
      }
      if (c.dimension !== "recognition" && c.dimension !== "recall") problems.push(`${cid}: dimension must be recognition or recall`);
      if (typeof c.stimulus !== "string" || !c.stimulus) problems.push(`${cid}: stimulus missing`);
      // Contexts of a segment the served content does not carry (content cap) are not served; they must still be well-formed.
      const segment = content.language.segments.find((s) => s.id === c.taskId);
      if (!segment) continue;
      counts.served += 1;
      if (segment.version !== c.version) problems.push(`${cid}: version ${String(c.version)} does not match served segment version ${segment.version}`);
      const step = segment.steps.find((s) => s.id === c.stepId);
      if (!step) {
        problems.push(`${cid}: step ${String(c.stepId)} does not exist in ${segment.id}`);
        continue;
      }
      const forms = isStrArray(e.forms) ? e.forms : [];
      if (c.dimension === "recognition") {
        if (step.kind !== "pick-supply") problems.push(`${cid}: recognition context must name a pick-supply step`);
        else {
          if (!forms.includes(step.answer.toLowerCase())) problems.push(`${cid}: the step's answer "${step.answer}" is not a form of ${id}`);
          if (step.sentence !== c.stimulus) problems.push(`${cid}: stimulus differs from the reviewed step sentence`);
          const variants = isRecord(c.variants) ? c.variants : null;
          if (step.variants && (!variants || Object.keys(step.variants).some((k) => variants[k] !== step.variants?.[k]))) problems.push(`${cid}: variants differ from the reviewed step variants`);
          if (!step.variants && variants) problems.push(`${cid}: variants given for a step without variants`);
        }
      } else {
        if (step.kind !== "produce") problems.push(`${cid}: recall context must name a produce step`);
        else {
          if (!step.keywords.some((k) => forms.includes(k.toLowerCase()))) problems.push(`${cid}: none of the step's keywords is a form of ${id}`);
          if (step.frame !== c.stimulus) problems.push(`${cid}: stimulus differs from the reviewed step frame`);
          if (typeof c.target !== "string" || c.target !== step.target) problems.push(`${cid}: target differs from the reviewed step target`);
        }
      }
    }
  }
  return { ok: problems.length === 0, problems, counts };
}

export function asVocabularyInventory(raw: unknown, content: LearningContent): VocabularyInventory {
  const r = reconcileVocabularyInventory(raw, content);
  if (!r.ok) throw new Error(`vocabulary inventory does not reconcile: ${r.problems.join("; ")}`);
  return raw as VocabularyInventory;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Lowercase tokens; accents kept (the reviewed forms decide what counts). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function bounded(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function recordsOf(state: MissionState, segmentId: LanguageSegmentId): LanguageStepRecord[] {
  return state.language[segmentId]?.records ?? [];
}

function correctionKey(taskId: string, attemptNo: number): string {
  return `${taskId}#${attemptNo}`;
}

export function buildVocabularyLedger(state: MissionState | null, content: LearningContent, inventory: VocabularyInventory, corrections: ParentCorrectionMap | null = null): VocabularyLedger {
  const observations: VocabularyObservation[] = [];
  const notes: string[] = [
    "Beobachtungen, keine Noten: eine richtige Antwort ist eine Beobachtung, keine Beherrschung.",
    "Erkennen, abgerufenes Wort, Schreibweise und freie Verwendung werden getrennt geführt und nie verrechnet.",
    "Hilfe (Glossar, Vorlesen, Wortliste, Tutor, zweiter Versuch, Rückmeldung) macht eine Beobachtung 'mit Hilfe'; nur ohne jede aufgezeichnete Hilfe gilt sie als selbständig.",
    "Aus einem Satz-Ergebnis wird kein Wortwissen abgeleitet; gezählt wird nur das Zielwort des jeweils geprüften Schritts.",
    "Beim Erkennen ist die Auswahl per Knopf die Aufgabe selbst und zählt nicht als Hilfe; eine geöffnete Wortliste zählt als Hilfe. Dieselbe Regel gilt für die Versuchs-Tabelle: beide Ansichten stufen denselben Versuch gleich ein. Aufzeichnungen von vor dem 30. September 2026 führen die Knopf-Auswahl nach der damaligen Regel als Hilfe und bleiben 'mit Hilfe' (nichts wird rückwirkend umgestuft).",
    "Freie Verwendung (Logbuch, neuer Satz, Erklärung) wird nur zur Durchsicht gesammelt und nie gewertet.",
    "Eine alte Aufzeichnung ohne Besuchs-Kennung, deren Zeitpunkt in kein Besuchsfenster fällt, wird keinem Besuch zugeordnet ('Besuch unbekannt') und zählt nicht für getrennte Besuche.",
  ];
  if (state) {
    for (const entry of inventory.entries) {
      for (const ctx of entry.contexts) {
        const segment = content.language.segments.find((s) => s.id === ctx.taskId);
        if (!segment) continue;
        const step = segment.steps.find((s) => s.id === ctx.stepId);
        if (!step) continue;
        const records = recordsOf(state, ctx.taskId);
        let attemptNo = 0;
        for (const rec of records) {
          if (rec.stepId !== ctx.stepId) continue;
          attemptNo += 1;
          // Legacy records (no visit id) are attributed by the visit window only; outside every window the visit is unknown, never v1.
          const visit: VisitId | null = rec.visit ?? state.visits.find((v) => rec.at >= v.startedAt && rec.at <= (v.finishedAt ?? "9999"))?.id ?? null;
          const taskId = `${ctx.taskId}/${ctx.stepId}`;
          const correction = corrections?.get(correctionKey(taskId, attemptNo)) ?? null;
          const stimulus = ctx.dimension === "recognition" && step.kind === "pick-supply" ? (rec.variant ? step.variants?.[rec.variant] ?? step.sentence : step.sentence) : ctx.stimulus;
          const productionKind = typeof rec.support === "object" && step.kind === "produce" ? (rec.support.includes("word-choice") ? "copying" : rec.support.includes("audio") ? "repetition" : rec.support.length > 0 ? "glossed" : "independent") : null;
          const base = {
            entryId: entry.id,
            language: entry.language,
            lemma: entry.lemma,
            taskId: ctx.taskId,
            stepId: ctx.stepId,
            taskVersion: segment.version,
            contextId: ctx.id,
            stimulus,
            response: bounded(rec.response),
            modality: rec.modality,
            visit,
            visitOrdinal: visit ? visitOrdinal(state, visit) : null,
            at: rec.at,
            support: [...rec.support],
            productionKind,
            attemptRef: { taskId, attemptNo },
            correction,
            uncertainty: rec.uncertainty ?? null,
          };
          if (ctx.dimension === "recognition") {
            if (rec.evidence !== "recognition") continue;
            const outcome: VocabularyOutcome = rec.correct === null ? "unscored" : rec.correct ? "correct" : "incorrect";
            // The record's support list is the ONE classification (written by the state engine into the attempt row as
            // well): the button pick itself is not in it, an opened word list is. No remapping here.
            observations.push({ id: `${entry.id}/${taskId}/${attemptNo}/recognition`, dimension: "recognition", ...base, outcome, independent: outcome === "correct" && rec.support.length === 0, countable: outcome !== "unscored" && correction === null });
          } else {
            if (rec.evidence !== "production" && rec.evidence !== "completion") continue;
            const outcome: VocabularyOutcome = rec.correct === null ? "unscored" : rec.correct ? "correct" : "incorrect";
            const independent = outcome === "correct" && rec.support.length === 0 && productionKind === "independent";
            observations.push({ id: `${entry.id}/${taskId}/${attemptNo}/recall`, dimension: "recall", ...base, outcome, independent, countable: outcome !== "unscored" && correction === null });
            // Writing: only a typed, correct response; the canonical written form counts, a reviewed variant spelling goes to review.
            if (rec.modality === "typed" && outcome === "correct") {
              const tokens = tokenize(rec.response);
              const written = tokens.some((t) => entry.writtenForms.includes(t));
              const variant = !written && tokens.some((t) => entry.forms.includes(t));
              if (written || variant) {
                const wOutcome: VocabularyOutcome = written ? "correct" : "review";
                observations.push({ id: `${entry.id}/${taskId}/${attemptNo}/writing`, dimension: "writing", ...base, outcome: wOutcome, independent: wOutcome === "correct" && independent, countable: wOutcome === "correct" && correction === null, uncertainty: written ? base.uncertainty : "Schreibweise weicht von der geprüften Form ab (z. B. ohne Akzent) — zur Durchsicht, nicht bewertet." });
              }
            }
          }
        }
      }
    }
    // Spontaneous use: the word appears in the child's own free text. Always "review", never credited.
    const freeTexts: { kind: "page" | "transfer" | "explanation"; index: number; text: string; visit: VisitId; at: string; modality: string }[] = [];
    state.pages.forEach((p, i) => freeTexts.push({ kind: "page", index: i, text: p.text, visit: p.visit, at: p.at, modality: p.modality ?? "typed" }));
    (state.transfers ?? []).forEach((t, i) => t.text && freeTexts.push({ kind: "transfer", index: i, text: t.text, visit: t.visit, at: t.at, modality: t.modality }));
    state.explanations.forEach((e, i) => freeTexts.push({ kind: "explanation", index: i, text: e.text, visit: e.visit, at: e.at, modality: e.modality }));
    for (const entry of inventory.entries) {
      for (const ft of freeTexts) {
        const tokens = tokenize(ft.text);
        if (!tokens.some((t) => entry.forms.includes(t))) continue;
        observations.push({
          id: `${entry.id}/free-text/${ft.kind}/${ft.index}/spontaneous`,
          entryId: entry.id,
          language: entry.language,
          lemma: entry.lemma,
          dimension: "spontaneous",
          taskId: `free-text/${ft.kind}`,
          stepId: null,
          taskVersion: 0,
          contextId: `free-text/${ft.kind}`,
          stimulus: "",
          response: bounded(ft.text),
          modality: ft.modality,
          visit: ft.visit,
          visitOrdinal: visitOrdinal(state, ft.visit),
          at: ft.at,
          support: [],
          productionKind: null,
          outcome: "review",
          independent: false,
          attemptRef: null,
          correction: null,
          countable: false,
          uncertainty: "Das Wort kommt in einem freien Text vor; ob es passend verwendet wurde, entscheidet die Durchsicht — keine automatische Wertung.",
        });
      }
    }
  }
  observations.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const entries: VocabularyEntrySummary[] = inventory.entries.map((entry) => {
    const own = observations.filter((o) => o.entryId === entry.id);
    const dims = {} as Record<VocabularyDimension, VocabularyDimensionSummary>;
    for (const dimension of VOCABULARY_DIMENSIONS) {
      const obs = own.filter((o) => o.dimension === dimension);
      const opportunities = dimension === "spontaneous" ? 0 : entry.contexts.filter((c) => (dimension === "writing" ? c.dimension === "recall" : c.dimension === dimension) && content.language.segments.some((s) => s.id === c.taskId)).length;
      const counted = obs.filter((o) => o.countable);
      const indep = counted.filter((o) => o.outcome === "correct" && o.independent);
      const summary: VocabularyDimensionSummary = {
        dimension,
        opportunities,
        observations: obs.length,
        independentCorrect: indep.length,
        supportedCorrect: counted.filter((o) => o.outcome === "correct" && !o.independent).length,
        incorrect: counted.filter((o) => o.outcome === "incorrect").length,
        unscored: obs.filter((o) => o.outcome === "unscored").length,
        review: obs.filter((o) => o.outcome === "review").length,
        distinctContexts: new Set(indep.map((o) => o.contextId)).size,
        separateVisits: new Set(indep.filter((o) => o.visit !== null).map((o) => o.visit as string)).size,
        lastAt: obs.length ? obs[obs.length - 1].at : null,
        lastOutcome: obs.length ? obs[obs.length - 1].outcome : null,
        status: "not-observed",
      };
      if (dimension === "spontaneous") summary.status = obs.length ? "review-pending" : "not-observed";
      else if (opportunities === 0) summary.status = "no-opportunity";
      else if (obs.length === 0) summary.status = "not-observed";
      else if (summary.independentCorrect >= inventory.policy.independentSuccesses && summary.distinctContexts >= inventory.policy.distinctContexts && summary.separateVisits >= inventory.policy.separateVisits) summary.status = "independent-repeated";
      else if (summary.independentCorrect >= 1) summary.status = "independent";
      else if (summary.supportedCorrect >= 1) summary.status = "supported-only";
      else summary.status = "practice";
      dims[dimension] = summary;
    }
    const missing: string[] = [];
    if (dims.recognition.status === "no-opportunity") missing.push("Erkennen: keine Aufgabe dafür in den geprüften Inhalten.");
    else if (dims.recognition.status === "not-observed") missing.push("Erkennen: noch nicht beobachtet.");
    if (dims.recall.status === "no-opportunity") missing.push("Abrufen: keine Aufgabe dafür in den geprüften Inhalten.");
    else if (dims.recall.status === "not-observed") missing.push("Abrufen: noch nicht beobachtet.");
    if (dims.writing.status === "no-opportunity") missing.push("Schreiben: keine Aufgabe dafür in den geprüften Inhalten.");
    else if (dims.writing.status === "not-observed") missing.push("Schreiben: noch nicht beobachtet (nur getippte richtige Antworten zählen; gesprochene nicht).");
    if (dims.spontaneous.status === "not-observed") missing.push("Freie Verwendung: nicht beobachtet.");
    for (const d of ["recognition", "recall"] as const) {
      if (dims[d].opportunities > 0 && dims[d].opportunities < inventory.policy.distinctContexts) missing.push(`${d === "recognition" ? "Erkennen" : "Abrufen"}: nur ${dims[d].opportunities} geprüfter Kontext vorhanden — 'wiederholt selbständig' braucht ${inventory.policy.distinctContexts}; dafür sind neue geprüfte Aufgaben nötig.`);
    }
    return { entryId: entry.id, language: entry.language, lemma: entry.lemma, gloss: entry.gloss, sense: entry.sense, dimensions: dims, missing, note: entry.note ?? null };
  });

  return {
    ledgerVersion: VOCABULARY_LEDGER_VERSION,
    inventoryId: inventory.inventoryId,
    inventoryVersion: inventory.inventoryVersion,
    reviewed: inventory.reviewed,
    policy: inventory.policy,
    derivedFrom: "mission-state",
    entries,
    observations,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Child cue — concrete words and what to try next; no counts, no ranks
// ---------------------------------------------------------------------------

export type ChildVocabularyWord = { entryId: string; lemma: string; gloss: string; language: "en" | "es"; try: string; upcoming: boolean };
export type ChildVocabularyCue = { inventoryVersion: number; words: ChildVocabularyWord[]; note: string };

const STATUS_ORDER: Record<VocabularyStatus, number> = { practice: 0, "supported-only": 1, independent: 2, "not-observed": 3, "independent-repeated": 4, "review-pending": 5, "no-opportunity": 6 };

export function childVocabularyCue(ledger: VocabularyLedger, content: LearningContent, state: MissionState): ChildVocabularyCue {
  const finished = new Set(state.visits.filter((v) => v.finishedAt).map((v) => v.id));
  const words: (ChildVocabularyWord & { rank: number })[] = [];
  for (const entry of ledger.entries) {
    const seen = ledger.observations.some((o) => o.entryId === entry.entryId && o.dimension !== "spontaneous");
    if (!seen) continue; // only words the child has actually met; never a preview of an unseen answer
    const recall = entry.dimensions.recall;
    const recognition = entry.dimensions.recognition;
    const primary = recall.opportunities > 0 ? recall : recognition;
    if (primary.status === "independent-repeated") continue;
    const inv = ledger.observations.find((o) => o.entryId === entry.entryId);
    const produceStep = content.language.segments.flatMap((s) => s.steps).find((s) => s.kind === "produce" && s.keywords.some((k) => k.toLowerCase() === entry.lemma.toLowerCase() || stripAccents(k.toLowerCase()) === stripAccents(entry.lemma.toLowerCase())));
    const target = entry.dimensions.recall.opportunities > 0 && produceStep && produceStep.kind === "produce" ? produceStep.target : entry.lemma;
    const upcoming = content.language.segments.some((s) => !finished.has(s.visit) && s.steps.some((st) => (st.kind === "pick-supply" && st.answer.toLowerCase() === entry.lemma.toLowerCase()) || (st.kind === "produce" && st.keywords.some((k) => k.toLowerCase() === entry.lemma.toLowerCase()))));
    const recallOffered = recall.opportunities > 0;
    let tryText: string;
    switch (primary.status) {
      case "practice":
        tryText = recallOffered ? `„${entry.lemma}“ heisst „${entry.gloss}“. Schau es dir nochmal an und sag dann den ganzen Satz: „${target}“.` : `„${entry.lemma}“ heisst „${entry.gloss}“. Schau es dir nochmal an — beim nächsten Mal erkennst du es bestimmt.`;
        break;
      case "supported-only":
        tryText = recallOffered ? `Probier „${target}“ einmal ganz ohne Wortliste und ohne Vorlesen.` : `Probier, „${entry.lemma}“ beim nächsten Mal ohne Hilfe zu erkennen.`;
        break;
      case "independent":
        tryText = recallOffered ? `Sag „${target}“ in einer neuen Situation — zum Beispiel jemandem zu Hause.` : `Du hast „${entry.lemma}“ (= ${entry.gloss}) erkannt. Probier, es selbst zu sagen — ohne nachzuschauen.`;
        break;
      default:
        tryText = `Beim nächsten Mal: „${entry.lemma}“ = „${entry.gloss}“${recallOffered ? ` — sag den ganzen Satz „${target}“` : ""}.`;
    }
    if (upcoming) tryText += " Das Wort kommt im nächsten Kapitel wieder vor.";
    words.push({ entryId: entry.entryId, lemma: entry.lemma, gloss: entry.gloss, language: entry.language, try: tryText, upcoming, rank: STATUS_ORDER[primary.status] * 10 + (inv ? 0 : 1) });
  }
  words.sort((a, b) => a.rank - b.rank || a.lemma.localeCompare(b.lemma));
  return { inventoryVersion: ledger.inventoryVersion, words: words.slice(0, 3).map(({ rank, ...w }) => (void rank, w)), note: "Wörter zum Üben — Beobachtungen, keine Noten." };
}
