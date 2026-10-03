// ---------------------------------------------------------------------------
// Learning cockpit persistence on the app's Turso/libSQL database.
//
// Family Assistant owns the schema (`data/family-learning/schema.sql`, mirrored
// and rendered into `schema.generated.ts`) and the rules (`family-learning-
// state.ts`). This module only executes them: idempotent table guards, a
// revision-guarded mutation transaction with an idempotency ledger, append-only
// evidence rows, parent settings/corrections/deletion and the unlock ledger.
//
// Every function takes the child id from its caller, which must have derived
// it from a verified credential — nothing here reads a request.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { Client, InValue, Transaction } from "@libsql/client";
// Relative .ts imports: this module is loaded directly by `node --test`.
import { FAMILY_LEARNING_SCHEMA_STATEMENTS } from "../data/family-learning/schema.generated.ts";
import type { ChildId } from "./family-assistant-turn.ts";
import { isKeyboardLayoutId, type LearningContent } from "./family-learning-content.ts";
import {
  applyLearningOp,
  buildChildView,
  ensureItemShown,
  EMPTY_PARENT_SETTINGS,
  LearningOpError,
  newMissionState,
  upgradeMissionState,
  type ChildView,
  type LearningOp,
  type MissionState,
  type ParentSettings,
  type Records,
} from "./family-learning-state.ts";
import { sanitizeTelemetryEvents } from "./family-learning-telemetry-schema.ts";
import { buildParentReview, LEARNING_RULES_VERSION, REVIEW_VERSION, completionIdentity, summariseTelemetry, type ParentReview, type TelemetryEvent, type TelemetrySummary } from "./family-learning-summary.ts";
import { visitLessonFeedback } from "./family-learning-feedback.ts";
import type { ProgressSources } from "./family-learning-progress.ts";
import { buildVocabularyLedger, type ParentCorrectionMap, type VocabularyInventory, type VocabularyLedger } from "./family-learning-vocabulary.ts";

type Db = Client | Transaction;

/**
 * Begin a write transaction, retrying briefly on SQLITE_BUSY. On a local file
 * database libsql does not wait for the lock; after a failed BEGIN the stale
 * connection must be dropped (`reconnect`) or it keeps the file locked. Turso
 * serializes writers server-side, so this is mostly a local/test concern.
 */
async function beginWrite(client: Client): Promise<Transaction> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.transaction("write");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "SQLITE_BUSY" || attempt >= 10) throw error;
      try {
        await client.reconnect();
      } catch {
        /* the next transaction() opens a fresh connection anyway */
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

/** Close a finished transaction's connection; never throws. */
function release(tx: Transaction): void {
  try {
    tx.close();
  } catch {
    /* already closed */
  }
}

/** Roll back and close a transaction after a failure; never throws. */
async function abandon(tx: Transaction): Promise<void> {
  try {
    await tx.rollback();
      release(tx);
  } catch {
    /* already rolled back or closed */
  }
  try {
    tx.close();
  } catch {
    /* already closed */
  }
}

const ensured = new WeakSet<Client>();

export async function ensureLearningTables(client: Client): Promise<void> {
  if (ensured.has(client)) return;
  for (const statement of FAMILY_LEARNING_SCHEMA_STATEMENTS) await client.execute(statement);
  ensured.add(client);
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Erasure fence
// ---------------------------------------------------------------------------

/** Content-free erasure generation for a child; 0 until the first deletion. */
export async function readErasureGeneration(db: Db, child: ChildId): Promise<number> {
  const result = await db.execute({ sql: "SELECT erasure_generation FROM family_learning_child_epochs WHERE child_id = ?", args: [child] });
  return result.rows.length ? Number(result.rows[0].erasure_generation) : 0;
}

/**
 * Read a set of child rows together with the erasure generation as ONE
 * coherent snapshot: the generation is read before and after the content;
 * if a deletion bumped it in between, the read is repeated. The generation is
 * monotonic, so equal brackets prove the content belongs to that generation
 * (works identically on Turso and on the local file database, which cannot
 * hold a read lock across a concurrent deletion's commit).
 */
export async function readWithErasureSnapshot<T>(
  db: Db,
  child: ChildId,
  read: () => Promise<T>,
  /** test hook: runs between the first generation read and the content read */
  afterFirstRead?: () => Promise<void>,
): Promise<{ erasureGeneration: number; value: T }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = await readErasureGeneration(db, child);
    if (afterFirstRead && attempt === 0) await afterFirstRead();
    const value = await read();
    const after = await readErasureGeneration(db, child);
    if (before === after) return { erasureGeneration: after, value };
  }
  throw new Error("could not read a coherent erasure snapshot");
}

/** Settings and their generation from one coherent snapshot (for GET and the form). */
export async function readParentSettingsSnapshot(client: Client, child: ChildId, afterFirstRead?: () => Promise<void>): Promise<{ settings: ParentSettings; erasureGeneration: number }> {
  await ensureLearningTables(client);
  const snapshot = await readWithErasureSnapshot(client, child, () => readParentSettings(client, child), afterFirstRead);
  return { settings: snapshot.value, erasureGeneration: snapshot.erasureGeneration };
}

export class StaleErasureGenerationError extends Error {
  readonly current: number;
  constructor(current: number) {
    super("this request was prepared before the child's records were deleted; reload and decide again");
    this.name = "StaleErasureGenerationError";
    this.current = current;
  }
}

// ---------------------------------------------------------------------------
// Parent settings
// ---------------------------------------------------------------------------

const SETTING_KEYS = ["keyboard_layout", "mission_title", "mission_hook", "language_variety_en", "language_variety_es"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export async function readParentSettings(db: Db, child: ChildId): Promise<ParentSettings> {
  const result = await db.execute({ sql: "SELECT key, value FROM family_learning_parent_settings WHERE child_id = ?", args: [child] });
  const settings: ParentSettings = { ...EMPTY_PARENT_SETTINGS };
  for (const row of result.rows) {
    const key = String(row.key);
    const value = String(row.value);
    if (key === "keyboard_layout" && isKeyboardLayoutId(value)) settings.keyboardLayout = value;
    if (key === "mission_title") settings.missionTitle = value;
    if (key === "mission_hook") settings.missionHook = value;
    if (key === "language_variety_en") settings.languageVarietyEn = value;
    if (key === "language_variety_es") settings.languageVarietyEs = value;
  }
  return settings;
}

export async function writeParentSetting(db: Db, child: ChildId, key: SettingKey, value: string | null): Promise<void> {
  if (!SETTING_KEYS.includes(key)) throw new Error(`unknown setting ${key}`);
  if (value === null || value === "") {
    await db.execute({ sql: "DELETE FROM family_learning_parent_settings WHERE child_id = ? AND key = ?", args: [child, key] });
    return;
  }
  await db.execute({
    sql: `INSERT INTO family_learning_parent_settings (child_id, key, value, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(child_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [child, key, value, nowIso()],
  });
}

// ---------------------------------------------------------------------------
// Mission state
// ---------------------------------------------------------------------------

/**
 * Load a saved mission. With `content` given, the state is upgraded IN MEMORY
 * to that content version (additive defaults only, idempotent); the upgraded
 * shape is persisted by the next mutation. Without content the raw saved
 * state is returned (no upgrade, no write).
 */
export async function loadMissionState(db: Db, child: ChildId, missionId: string, content?: LearningContent): Promise<MissionState | null> {
  const result = await db.execute({
    sql: "SELECT state_json, revision FROM family_learning_missions WHERE child_id = ? AND mission_id = ?",
    args: [child, missionId],
  });
  if (result.rows.length === 0) return null;
  const state = JSON.parse(String(result.rows[0].state_json)) as MissionState;
  state.revision = Number(result.rows[0].revision);
  if (!content) return state;
  return upgradeMissionState(state, content, nowIso()).state;
}

async function insertRecords(db: Db, child: ChildId, missionId: string, records: Records): Promise<void> {
  for (const row of records.exposures) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO family_learning_exposures (child_id, task_id, task_version, kind, source, first_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [child, row.taskId, row.taskVersion, row.kind, row.source, row.at],
    });
  }
  for (const row of records.supports) {
    await db.execute({
      sql: `INSERT INTO family_learning_support_events (id, child_id, mission_id, visit_id, task_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [row.id, child, missionId, row.visitId, row.taskId, row.kind, JSON.stringify(row.payload ?? null), row.at],
    });
  }
  for (const row of records.attempts) {
    await db.execute({
      sql: `INSERT INTO family_learning_attempts (id, child_id, mission_id, visit_id, task_id, task_version, objective, attempt_no, answer_json, correct, evidence, support_json, exposure_before, stimulus_language, response_language, modality, uncertainty, teaching_move, teaching_reason, seconds_since_teaching, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.id, child, missionId, row.visitId, row.taskId, row.taskVersion, row.objective, row.attemptNo,
        JSON.stringify(row.answer), row.correct === null ? null : row.correct ? 1 : 0, row.evidence, JSON.stringify(row.support),
        row.exposureBefore, row.stimulusLanguage, row.responseLanguage, row.modality, row.uncertainty, row.teachingMove,
        row.teachingReason, row.secondsSinceTeaching, row.at,
      ],
    });
  }
  for (const row of records.samples) {
    await db.execute({
      sql: `INSERT INTO family_learning_work_samples (id, child_id, mission_id, visit_id, task_id, kind, language, modality, text, metrics_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [row.id, child, missionId, row.visitId, row.taskId, row.kind, row.language, row.modality, row.text, JSON.stringify(row.metrics ?? null), row.at],
    });
  }
}

async function writeState(db: Db, state: MissionState, expectedRevision: number): Promise<boolean> {
  const json = JSON.stringify(state);
  if (expectedRevision === 0) {
    const inserted = await db.execute({
      sql: `INSERT OR IGNORE INTO family_learning_missions (child_id, mission_id, content_version, revision, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [state.child, state.missionId, state.contentVersion, state.revision, json, state.createdAt, state.updatedAt],
    });
    if (inserted.rowsAffected === 1) return true;
  }
  const updated = await db.execute({
    sql: `UPDATE family_learning_missions SET revision = ?, state_json = ?, content_version = ?, updated_at = ? WHERE child_id = ? AND mission_id = ? AND revision = ?`,
    args: [state.revision, json, state.contentVersion, state.updatedAt, state.child, state.missionId, expectedRevision],
  });
  return updated.rowsAffected === 1;
}

/**
 * R5-1: the immutable identity the client rendered its request against — the
 * erasure generation and the running visit instance (id + start). A request
 * whose context no longer matches the stored child is stale, whatever its
 * revision number says: erasure and recreation can reproduce a revision, but
 * never the generation or the visit instance. Checked inside the write
 * transaction, before the idempotency lookup and before anything is stored.
 */
export type MutationContext = { erasureGeneration: number; visit: { id: string; startedAt: string } | null };

/** `context` is required on the HTTP route (see mission/route.ts); trusted server-side callers may omit it. */
export type MutationInput = { child: ChildId; op: LearningOp; idempotencyKey: string; expectedRevision: number; context?: MutationContext };

export type MutationOutcome =
  | { status: "applied" | "replayed"; view: ChildView; result: Record<string, unknown> }
  | { status: "stale"; view: ChildView; reason?: "generation" | "visit" | "revision" }
  | { status: "refused"; code: LearningOpError["code"]; message: string; view: ChildView };

/**
 * Settle the durable `shown` exposure for whatever scored item is active in
 * the given state, then return the state that is safe to render. Runs before
 * EVERY response that could expose an item (GET, and every PUT outcome —
 * applied, replayed, stale, refused), so a client never sees a scored prompt
 * whose exposure row does not exist yet. A concurrent writer simply wins the
 * revision race and the fresh state is re-read and settled again (bounded).
 */
async function settleShown(client: Client, child: ChildId, content: LearningContent, now: Date, initial: MissionState | null): Promise<MissionState> {
  let state = initial ?? (await loadMissionState(client, child, content.contentId, content)) ?? newMissionState(content, child, now.toISOString());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = ensureItemShown(state, content, now);
    if (!shown.changed) return state;
    const tx = await beginWrite(client);
    try {
      const next = { ...shown.state, revision: state.revision + 1, updatedAt: now.toISOString() };
      const ok = await writeState(tx, next, state.revision);
      if (ok) {
        await insertRecords(tx, child, content.contentId, shown.records);
        await tx.commit();
    release(tx);
        return next;
      }
      await tx.rollback();
      release(tx);
    } catch (error) {
      await abandon(tx);
      throw error;
    }
    state = (await loadMissionState(client, child, content.contentId, content)) ?? state;
  }
  // Fail closed: never hand out a scored item whose exposure is unconfirmed.
  if (ensureItemShown(state, content, now).changed) throw new ExposureUnsettledError();
  return state;
}

/** Thrown when the durable `shown` exposure could not be written; routes answer 503. */
export class ExposureUnsettledError extends Error {
  constructor() {
    super("the item's exposure could not be settled; refusing to render it");
    this.name = "ExposureUnsettledError";
  }
}

/** Read the child's current view with the active item's exposure settled first. */
/**
 * Per-request view inputs (follow-on): the learner's IANA time zone for the
 * Monday–Sunday week of the progress strip, and the served vocabulary
 * inventory. Both are optional; nothing here grants authority.
 */
export type ViewOptions = { timeZone?: string | null; vocabulary?: VocabularyInventory | null };

/**
 * The stored parent reviews the progress strip may quote (read-only). Read
 * from the completion rows of this child and mission; a review is cited by
 * the exact completion identity (visit id + start), never by position.
 */
export async function readProgressSources(db: Db, child: ChildId, missionId: string): Promise<ProgressSources> {
  const rows = await db.execute({ sql: "SELECT visit_id, visit_started_at, historical, review_json FROM family_learning_completions WHERE child_id = ? AND mission_id = ?", args: [child, missionId] });
  const reviews: ProgressSources["reviews"] = [];
  for (const row of rows.rows) {
    const review = parseJson(row.review_json) as ParentReview | null;
    reviews.push({
      visitId: String(row.visit_id),
      visitStartedAt: String(row.visit_started_at),
      historical: Number(row.historical) === 1,
      reviewVersion: typeof review?.identity?.reviewVersion === "number" ? review.identity.reviewVersion : null,
      childSummary: review?.learning?.childSummary ?? null,
    });
  }
  return { reviews };
}

/** Build the child view with its per-request inputs; the reviews are read from `db` (a transaction or the client). */
async function viewOf(db: Db, child: ChildId, state: MissionState, content: LearningContent, settings: ParentSettings, now: Date, erasureGeneration: number, options: ViewOptions): Promise<ChildView> {
  const progressSources = await readProgressSources(db, child, content.contentId);
  return buildChildView(state, content, settings, now, erasureGeneration, { timeZone: options.timeZone ?? null, progressSources, vocabulary: options.vocabulary ?? null });
}

export async function readChildView(client: Client, child: ChildId, content: LearningContent, now = new Date(), options: ViewOptions = {}): Promise<ChildView> {
  await ensureLearningTables(client);
  // The generation the view reports is the one the state was read under
  // (coherent snapshot); the client echoes it with every telemetry batch.
  const { erasureGeneration, value } = await readWithErasureSnapshot(client, child, async () => {
    const settings = await readParentSettings(client, child);
    const state = await settleShown(client, child, content, now, null);
    const progressSources = await readProgressSources(client, child, content.contentId);
    return { settings, state, progressSources };
  });
  return buildChildView(value.state, content, value.settings, now, erasureGeneration, { timeZone: options.timeZone ?? null, progressSources: value.progressSources, vocabulary: options.vocabulary ?? null });
}

/**
 * Apply one mutation under the idempotency + revision contract:
 *  - a known idempotency key returns the stored outcome without re-applying;
 *  - a stale `expectedRevision` is refused with the current view;
 *  - the state row is updated only if its revision still matches, inside one
 *    write transaction together with the evidence rows and the ledger row.
 */
export async function applyMutation(
  client: Client,
  input: MutationInput,
  content: LearningContent,
  now: () => Date = () => new Date(),
  options: ViewOptions = {},
): Promise<MutationOutcome> {
  await ensureLearningTables(client);
  const settings = await readParentSettings(client, input.child);
  const env = { content, settings, now, newId: () => randomUUID() };
  const tx = await beginWrite(client);
  try {
    // R5-1: the generation is read FIRST, inside the write transaction (a deletion is a
    // competing writer and cannot interleave). A request rendered against an erased
    // generation is stale before the ledger is consulted and before anything is stored.
    const generation = await readErasureGeneration(tx, input.child);
    if (input.context && input.context.erasureGeneration !== generation) {
      await tx.rollback();
      release(tx);
      const settled = await settleShown(client, input.child, content, now(), null);
      return { status: "stale", reason: "generation", view: await viewOf(client, input.child, settled, content, settings, now(), await readErasureGeneration(client, input.child), options) };
    }
    const existing = await tx.execute({
      sql: "SELECT revision_after FROM family_learning_mutations WHERE child_id = ? AND idempotency_key = ?",
      args: [input.child, input.idempotencyKey],
    });
    const current = (await loadMissionState(tx, input.child, content.contentId, content)) ?? newMissionState(content, input.child, now().toISOString());
    if (existing.rows.length > 0) {
      // A known key in THIS generation is the legitimate lost-ACK retry: replay the stored outcome.
      await tx.rollback();
      release(tx);
      const settled = await settleShown(client, input.child, content, now(), current);
      return { status: "replayed", view: await viewOf(client, input.child, settled, content, settings, now(), await readErasureGeneration(client, input.child), options), result: { replayed: true, revisionAfter: Number(existing.rows[0].revision_after) } };
    }
    if (input.context) {
      // The running visit instance must be the one the client rendered (id AND start); a
      // replaced or finished visit — or none where one was expected — makes the request stale.
      // The comparison uses the visit AS THE SERVED CONTENT KNOWS IT — exactly what the client's view showed: a
      // chapter parked under the content cap (ROLLBACK-CONTRACT §2) is not in the view, so the client's honest
      // "no visit" context matches, and the op then meets the ordinary rule refusal, not a stale answer.
      const runningRaw = current.currentVisit ? current.visits.find((v) => v.id === current.currentVisit && v.finishedAt === null) ?? null : null;
      const running = runningRaw && content.visits.some((v) => v.id === runningRaw.id) ? runningRaw : null;
      const expected = input.context.visit;
      const matches = expected === null ? running === null : running !== null && running.id === expected.id && running.startedAt === expected.startedAt;
      if (!matches) {
        await tx.rollback();
        release(tx);
        const settled = await settleShown(client, input.child, content, now(), current);
        return { status: "stale", reason: "visit", view: await viewOf(client, input.child, settled, content, settings, now(), await readErasureGeneration(client, input.child), options) };
      }
    }
    if (current.revision !== input.expectedRevision) {
      await tx.rollback();
      release(tx);
      const settled = await settleShown(client, input.child, content, now(), current);
      return { status: "stale", reason: "revision", view: await viewOf(client, input.child, settled, content, settings, now(), await readErasureGeneration(client, input.child), options) };
    }
    let applied;
    try {
      applied = applyLearningOp(current, input.op, env);
    } catch (error) {
      await tx.rollback();
      release(tx);
      if (error instanceof LearningOpError) {
        const settled = await settleShown(client, input.child, content, now(), current);
        return { status: "refused", code: error.code, message: error.message, view: await viewOf(client, input.child, settled, content, settings, now(), await readErasureGeneration(client, input.child), options) };
      }
      throw error;
    }
    // The applied transition may have advanced to a scored item: its `shown`
    // exposure is written in the SAME transaction, before this response.
    const shown = ensureItemShown(applied.state, content, now());
    const finalState = shown.changed ? { ...shown.state, revision: applied.state.revision } : applied.state;
    const ok = await writeState(tx, finalState, current.revision);
    if (!ok) {
      await tx.rollback();
      release(tx);
      const settled = await settleShown(client, input.child, content, now(), null);
      return { status: "stale", view: await viewOf(client, input.child, settled, content, settings, now(), await readErasureGeneration(client, input.child), options) };
    }
    await insertRecords(tx, input.child, content.contentId, applied.records);
    if (shown.changed) await insertRecords(tx, input.child, content.contentId, shown.records);
    // A finished visit yields exactly one durable completion/review row for
    // its identity (child/mission/visit/start), written in THIS transaction:
    // a lost acknowledgement or a retry replays the ledger and never reaches
    // this line; INSERT OR IGNORE guards the identity regardless.
    if (applied.finishedVisit) {
      // R4-1: the answered feedback dimensions are written by the SERVER in this same transaction, as one
      // telemetry batch keyed by the mutation's idempotency key (INSERT OR IGNORE): durable with the completion,
      // never dependent on the client seeing the acknowledgement or delivering a later POST, never doubled by a
      // replay (a replayed key never reaches this line) and erased with the child. Skipped / open / not-offered
      // dimensions produce no event. Only content that offers the feedback dimensions (version 2+) records them;
      // a reflection under version-1 content keeps its version-1 meaning (no telemetry at all).
      if (input.op.op === "reflect" && (content.reflection.dimensions?.length ?? 0) > 0) await insertFeedbackTelemetry(tx, input.child, finalState, applied.finishedVisit, generation, input.idempotencyKey, now());
      await insertCompletion(tx, input.child, finalState, content, applied.finishedVisit, false, now());
    }
    await tx.execute({
      sql: `INSERT INTO family_learning_mutations (child_id, idempotency_key, mission_id, op, revision_after, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [input.child, input.idempotencyKey, content.contentId, input.op.op, applied.state.revision, now().toISOString()],
    });
    // The strip may quote the completion written in this very transaction: read the sources before the commit.
    const progressSources = await readProgressSources(tx, input.child, content.contentId);
    await tx.commit();
    release(tx);
    return { status: "applied", view: buildChildView(finalState, content, settings, now(), generation, { timeZone: options.timeZone ?? null, progressSources, vocabulary: options.vocabulary ?? null }), result: applied.result };
  } catch (error) {
    try {
      await tx.rollback();
      release(tx);
    } catch {
      /* already closed */
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Parent evidence, corrections, deletion
// ---------------------------------------------------------------------------

export type EvidenceAttempt = {
  id: string;
  visitId: string;
  taskId: string;
  taskVersion: number;
  objective: string;
  attemptNo: number;
  answer: unknown;
  correct: boolean | null;
  evidence: string;
  support: string[];
  exposureBefore: string;
  stimulusLanguage: string;
  responseLanguage: string | null;
  modality: string;
  uncertainty: string | null;
  teachingMove: string | null;
  teachingReason: string | null;
  secondsSinceTeaching: number | null;
  createdAt: string;
  parentCorrection: { evidence?: string; note?: string; by: string; at: string } | null;
};

/**
 * R5-4: how the served review relates to the stored derivation.
 *  - current:   the stored review is at the current rule version (refreshed on read where possible).
 *  - projected: the stored learning classification is current (rules ≥ LEARNING_RULES_VERSION) but the
 *               review could not be re-derived under the served content; its UX summary is recomputed in
 *               memory from the raw telemetry rows. Nothing is written.
 *  - obsolete:  the stored learning classification predates the current rules and cannot be re-derived
 *               under the served content (e.g. a chapter-4 review under the version-1 cap). The review is
 *               NOT served; only raw facts (the child's own answers, the UX summary) are retained. Nothing
 *               is written, reclassified or lost — the row is byte-identical.
 */
export type ReviewDerivation =
  | { status: "current" }
  | { status: "projected"; storedVersion: number; currentVersion: number; reason: "no-content" | "visit-not-served" | "visit-not-finished-in-state"; note: string }
  | { status: "obsolete"; storedVersion: number; currentVersion: number; reason: "no-content" | "visit-not-served" | "visit-not-finished-in-state"; note: string; retained: { childFeedback: ParentReview["experience"]["childFeedback"] | null; telemetry: TelemetrySummary; title: string | null } };

export type CompletionRecord = {
  completionId: string;
  missionId: string;
  contentVersion: number;
  visitId: string;
  visitStartedAt: string;
  finishedAt: string;
  historical: boolean;
  review: ParentReview | null;
  derivation: ReviewDerivation;
  delivery: { channel: "cockpit"; clavus: string } | null;
  createdAt: string;
};

export type EvidenceBundle = {
  child: ChildId;
  /** Content-free erasure fence; parent writes must echo it. */
  erasureGeneration: number;
  state: MissionState | null;
  /** One review per completed visit (deduplicated by completion identity). */
  completions: CompletionRecord[];
  /** Telemetry presence only (counts); events are summarised inside each review. */
  telemetry: { batches: number; events: number; byVisit: Record<string, number> };
  attempts: EvidenceAttempt[];
  supports: { id: string; visitId: string; taskId: string | null; kind: string; payload: unknown; createdAt: string }[];
  samples: { id: string; visitId: string; taskId: string | null; kind: string; language: string | null; modality: string; text: string; metrics: unknown; createdAt: string }[];
  exposures: { taskId: string; taskVersion: number; kind: string; source: string; firstAt: string }[];
  settings: ParentSettings;
  /** Vocabulary evidence ledger (follow-on M3): derived from the immutable records above; null when no inventory is served. */
  vocabulary: VocabularyLedger | null;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function readEvidence(client: Client, child: ChildId, missionId: string, afterFirstRead?: () => Promise<void>, content?: LearningContent, vocabulary?: VocabularyInventory | null): Promise<EvidenceBundle> {
  await ensureLearningTables(client);
  // Visits completed before the completion table existed get one clearly
  // marked historical review each (additive, idempotent, no telemetry).
  if (content) await ensureHistoricalCompletions(client, child, content);
  // Reviews derived under older rules are re-derived from the preserved records (R4-3).
  if (content) await refreshStaleReviews(client, child, content);
  // Every child row and the generation come from one coherent snapshot, so the
  // bundle can never label pre-deletion content with a post-deletion generation.
  const { erasureGeneration, value } = await readWithErasureSnapshot(
    client,
    child,
    async () => {
      const [state, settings, attempts, supports, samples, exposures, completions, telemetry] = await Promise.all([
        loadMissionState(client, child, missionId, content),
        readParentSettings(client, child),
        client.execute({ sql: "SELECT * FROM family_learning_attempts WHERE child_id = ? ORDER BY created_at ASC", args: [child] }),
        client.execute({ sql: "SELECT * FROM family_learning_support_events WHERE child_id = ? ORDER BY created_at ASC", args: [child] }),
        client.execute({ sql: "SELECT * FROM family_learning_work_samples WHERE child_id = ? ORDER BY created_at ASC", args: [child] }),
        client.execute({ sql: "SELECT * FROM family_learning_exposures WHERE child_id = ? ORDER BY first_at ASC", args: [child] }),
        client.execute({ sql: "SELECT * FROM family_learning_completions WHERE child_id = ? ORDER BY finished_at ASC", args: [child] }),
        client.execute({ sql: "SELECT visit_id, events_json FROM family_learning_telemetry WHERE child_id = ?", args: [child] }),
      ]);
      return { state, settings, attempts, supports, samples, exposures, completions, telemetry };
    },
    afterFirstRead,
  );
  const { state, settings, attempts, supports, samples, exposures, completions, telemetry } = value;
  const completionRecords: CompletionRecord[] = [];
  for (const row of completions.rows) {
    const stored = parseJson(row.review_json) as ParentReview | null;
    const visitId = String(row.visit_id);
    const historical = Number(row.historical) === 1;
    const { review, derivation } = await projectReview(client, child, visitId, historical, stored, state, content);
    completionRecords.push({
      completionId: String(row.completion_id),
      missionId: String(row.mission_id),
      contentVersion: Number(row.content_version),
      visitId,
      visitStartedAt: String(row.visit_started_at),
      finishedAt: String(row.finished_at),
      historical,
      review,
      derivation,
      delivery: parseJson(row.delivery_json) as CompletionRecord["delivery"],
      createdAt: String(row.created_at),
    });
  }
  const byVisit: Record<string, number> = {};
  let events = 0;
  for (const row of telemetry.rows) {
    const list = parseJson(row.events_json);
    const n = Array.isArray(list) ? list.length : 0;
    events += n;
    const key = row.visit_id === null ? "?" : String(row.visit_id);
    byVisit[key] = (byVisit[key] ?? 0) + n;
  }
  // Parent corrections on language attempts exclude the linked vocabulary observation from the counts (shown, never hidden).
  const corrections: ParentCorrectionMap = new Map();
  for (const row of attempts.rows) {
    const correction = parseJson(row.parent_correction_json) as { evidence?: string; note?: string; by?: string; at?: string } | null;
    if (correction) corrections.set(`${String(row.task_id)}#${Number(row.attempt_no)}`, correction);
  }
  return {
    child,
    erasureGeneration,
    state,
    completions: completionRecords,
    telemetry: { batches: telemetry.rows.length, events, byVisit },
    settings,
    vocabulary: content && vocabulary ? buildVocabularyLedger(state, content, vocabulary, corrections) : null,
    attempts: attempts.rows.map((row) => ({
      id: String(row.id),
      visitId: String(row.visit_id),
      taskId: String(row.task_id),
      taskVersion: Number(row.task_version),
      objective: String(row.objective),
      attemptNo: Number(row.attempt_no),
      answer: parseJson(row.answer_json),
      correct: row.correct === null ? null : Number(row.correct) === 1,
      evidence: String(row.evidence),
      support: (parseJson(row.support_json) as string[] | null) ?? [],
      exposureBefore: String(row.exposure_before),
      stimulusLanguage: String(row.stimulus_language),
      responseLanguage: row.response_language === null ? null : String(row.response_language),
      modality: String(row.modality),
      uncertainty: row.uncertainty === null ? null : String(row.uncertainty),
      teachingMove: row.teaching_move === null ? null : String(row.teaching_move),
      teachingReason: row.teaching_reason === null ? null : String(row.teaching_reason),
      secondsSinceTeaching: row.seconds_since_teaching === null ? null : Number(row.seconds_since_teaching),
      createdAt: String(row.created_at),
      parentCorrection: (parseJson(row.parent_correction_json) as EvidenceAttempt["parentCorrection"]) ?? null,
    })),
    supports: supports.rows.map((row) => ({
      id: String(row.id),
      visitId: String(row.visit_id),
      taskId: row.task_id === null ? null : String(row.task_id),
      kind: String(row.kind),
      payload: parseJson(row.payload_json),
      createdAt: String(row.created_at),
    })),
    samples: samples.rows.map((row) => ({
      id: String(row.id),
      visitId: String(row.visit_id),
      taskId: row.task_id === null ? null : String(row.task_id),
      kind: String(row.kind),
      language: row.language === null ? null : String(row.language),
      modality: String(row.modality),
      text: String(row.text),
      metrics: parseJson(row.metrics_json),
      createdAt: String(row.created_at),
    })),
    exposures: exposures.rows.map((row) => ({
      taskId: String(row.task_id),
      taskVersion: Number(row.task_version),
      kind: String(row.kind),
      source: String(row.source),
      firstAt: String(row.first_at),
    })),
  };
}

const EVIDENCE_VALUES = ["independent", "supported", "answer_exposed", "incorrect", "unscored"] as const;

/**
 * A parent correction annotates an attempt; it never rewrites the child's
 * recorded answer or evidence and is shown separately in the cockpit.
 */
export async function correctAttempt(
  client: Client,
  params: { child: ChildId; attemptId: string; evidence: string | null; note: string | null; adminEmail: string; /** test hook: runs inside the transaction, between UPDATE and audit INSERT */ beforeAudit?: () => Promise<void> },
): Promise<boolean> {
  await ensureLearningTables(client);
  if (params.evidence !== null && !(EVIDENCE_VALUES as readonly string[]).includes(params.evidence)) throw new Error("invalid evidence value");
  const correction = { ...(params.evidence ? { evidence: params.evidence } : {}), ...(params.note ? { note: params.note.slice(0, 500) } : {}), by: params.adminEmail, at: nowIso() };
  // Correction and its audit row are one write transaction, so a concurrent
  // deletion either runs entirely before (the UPDATE then touches 0 rows and
  // nothing is audited) or entirely after (and removes both). Never between.
  const tx = await beginWrite(client);
  try {
    const result = await tx.execute({
      sql: "UPDATE family_learning_attempts SET parent_correction_json = ?, parent_corrected_at = ? WHERE id = ? AND child_id = ?",
      args: [JSON.stringify(correction), correction.at, params.attemptId, params.child],
    });
    if (result.rowsAffected !== 1) {
      await tx.rollback();
      release(tx);
      return false;
    }
    if (params.beforeAudit) await params.beforeAudit();
    await tx.execute({
      sql: "INSERT INTO family_learning_parent_audit (id, admin_email, action, child_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [randomUUID(), params.adminEmail, "correction", params.child, params.attemptId, JSON.stringify(correction), nowIso()],
    });
    await tx.commit();
    release(tx);
    return true;
  } catch (error) {
    await abandon(tx);
    throw error;
  }
}

/** Write several parent settings and their audit row in one transaction. */
export async function writeParentSettings(
  client: Client,
  child: ChildId,
  changes: { key: SettingKey; value: string | null }[],
  adminEmail: string,
  /** The erasure generation the caller's view was loaded from; checked inside the transaction. */
  expectedErasureGeneration: number,
  /** test hook: runs immediately before the write transaction is acquired */
  beforeTransaction?: () => Promise<void>,
): Promise<ParentSettings> {
  await ensureLearningTables(client);
  if (beforeTransaction) await beforeTransaction();
  const tx = await beginWrite(client);
  try {
    // Erasure fence: a request prepared before a deletion (in-flight or from a
    // stale tab) carries an older generation and is refused here, inside the
    // same transaction that would write — nothing deleted can come back.
    const current = await readErasureGeneration(tx, child);
    if (current !== expectedErasureGeneration) {
      await tx.rollback();
      release(tx);
      throw new StaleErasureGenerationError(current);
    }
    for (const change of changes) await writeParentSetting(tx, child, change.key, change.value);
    await tx.execute({
      sql: "INSERT INTO family_learning_parent_audit (id, admin_email, action, child_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [randomUUID(), adminEmail, "settings", child, null, JSON.stringify(changes), nowIso()],
    });
    const settings = await readParentSettings(tx, child);
    await tx.commit();
    release(tx);
    return settings;
  } catch (error) {
    await abandon(tx);
    throw error;
  }
}

/** Deletes every learning row for the child (state, ledger, evidence, settings). Audited. */
export async function deleteChildRecords(client: Client, child: ChildId, adminEmail: string): Promise<Record<string, number>> {
  await ensureLearningTables(client);
  // Source rows AND every derived/queued store (completion reviews, telemetry)
  // go in one transaction (redesign F6/R4); only the content-free receipt and
  // the erasure generation remain.
  const tables = [
    "family_learning_missions",
    "family_learning_mutations",
    "family_learning_attempts",
    "family_learning_exposures",
    "family_learning_support_events",
    "family_learning_work_samples",
    "family_learning_parent_settings",
    "family_learning_completions",
    "family_learning_telemetry",
  ];
  const counts: Record<string, number> = {};
  const tx = await beginWrite(client);
  try {
    for (const table of tables) {
      const result = await tx.execute({ sql: `DELETE FROM ${table} WHERE child_id = ?`, args: [child] });
      counts[table] = result.rowsAffected;
    }
    // Earlier audit rows for this child carry child-specific content
    // (correction notes, mission title/hook values): scrub them too. Only the
    // content-free receipt below remains.
    const audit = await tx.execute({ sql: "DELETE FROM family_learning_parent_audit WHERE child_id = ?", args: [child] });
    counts.family_learning_parent_audit = audit.rowsAffected;
    await tx.execute({
      sql: `INSERT INTO family_learning_child_epochs (child_id, erasure_generation, updated_at) VALUES (?, 1, ?)
            ON CONFLICT(child_id) DO UPDATE SET erasure_generation = erasure_generation + 1, updated_at = excluded.updated_at`,
      args: [child, nowIso()],
    });
    await tx.execute({
      sql: "INSERT INTO family_learning_parent_audit (id, admin_email, action, child_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [randomUUID(), adminEmail, "delete_records", child, null, JSON.stringify(counts), nowIso()],
    });
    await tx.commit();
    release(tx);
  } catch (error) {
    await abandon(tx);
    throw error;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Completions (one review per finished visit) and telemetry
// ---------------------------------------------------------------------------

/** Where a review is delivered. The owner cockpit is the delivery; no adult-side Clavus contract is verified for this project. */
export const REVIEW_DELIVERY = {
  channel: "cockpit" as const,
  clavus: "unavailable: no supported adult-side Clavus ingestion contract for the family assistant (the Typewise adapter's loopback /api/threads endpoints and its delivery identity are project-owned and not authorised for reuse); reviews are shown in the owner cockpit",
};

export async function readTelemetryEvents(db: Db, child: ChildId, visitId: string | null): Promise<TelemetryEvent[] | null> {
  const rows = await db.execute({ sql: "SELECT events_json FROM family_learning_telemetry WHERE child_id = ? AND visit_id = ? ORDER BY created_at ASC", args: [child, visitId] });
  if (rows.rows.length === 0) return null;
  const events: TelemetryEvent[] = [];
  for (const row of rows.rows) {
    const list = parseJson(row.events_json);
    if (Array.isArray(list)) for (const e of list) if (e && typeof e === "object") events.push(e as TelemetryEvent);
  }
  return events;
}

async function insertFeedbackTelemetry(db: Db, child: ChildId, state: MissionState, visitId: MissionState["visits"][number]["id"], generation: number, idempotencyKey: string, now: Date): Promise<boolean> {
  const visit = state.visits.find((v) => v.id === visitId && v.finishedAt);
  if (!visit) return false;
  const answers: Record<string, string> = { ...(visit.feedback?.answers ?? {}) };
  if (visit.reflection && !answers.difficulty) answers.difficulty = visit.reflection;
  const events = sanitizeTelemetryEvents(Object.entries(answers).map(([dimension, option]) => ({ t: now.getTime(), kind: "feedback", stage: "reflect", detail: { dimension, option } })), MAX_TELEMETRY_EVENTS);
  if (events.length === 0) return false;
  const inserted = await db.execute({
    sql: "INSERT OR IGNORE INTO family_learning_telemetry (child_id, batch_id, mission_id, visit_id, visit_started_at, erasure_generation, events_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [child, `fb-${idempotencyKey}`, state.missionId, visit.id, visit.startedAt, generation, JSON.stringify(events), now.toISOString()],
  });
  return inserted.rowsAffected === 1;
}

/**
 * Refresh stored reviews whose derivation version is older than the current
 * rules (R4-3): the review is re-derived from the preserved state (whose
 * records were upgraded additively), keeping the completion identity, dates,
 * historical flag and content version, and appending the earlier derivation
 * to `previousReviews` for provenance. Runs inside one write transaction so
 * it is fenced against erasure; a visit the served content does not know is
 * left untouched (content cap). Idempotent: a review at the current version
 * is never rewritten.
 */
/**
 * R5-4: decide how a stored review is served when it is not at the current rule version and the
 * read-time refresh could not re-derive it (no served content, a visit the served content does not
 * know — chapter 4 under the version-1 cap — or a visit not finished in the state). Pure projection:
 * nothing is written. Stored learning credit older than LEARNING_RULES_VERSION is never served as
 * current evidence; the child's own answers and a fresh UX summary from the raw telemetry rows are.
 */
async function projectReview(client: Client, child: ChildId, visitId: string, historical: boolean, stored: ParentReview | null, state: MissionState | null, content: LearningContent | undefined): Promise<{ review: ParentReview | null; derivation: ReviewDerivation }> {
  if (!stored) return { review: null, derivation: { status: "current" } };
  const storedVersion = stored.identity?.reviewVersion ?? 1;
  if (storedVersion === REVIEW_VERSION) return { review: stored, derivation: { status: "current" } };
  const reason: "no-content" | "visit-not-served" | "visit-not-finished-in-state" = !content ? "no-content" : !content.visits.some((v) => v.id === visitId) ? "visit-not-served" : "visit-not-finished-in-state";
  const events = historical ? null : await readTelemetryEvents(client, child, visitId);
  const batches = events ? Number((await client.execute({ sql: "SELECT COUNT(*) AS c FROM family_learning_telemetry WHERE child_id = ? AND visit_id = ?", args: [child, visitId] })).rows[0]?.c ?? 0) : 0;
  const stages = content?.visits.find((v) => v.id === visitId)?.stages ?? null;
  const telemetry = summariseTelemetry(events, batches, stages);
  void state;
  if (storedVersion < LEARNING_RULES_VERSION) {
    return {
      review: null,
      derivation: {
        status: "obsolete",
        storedVersion,
        currentVersion: REVIEW_VERSION,
        reason,
        note: `Die gespeicherte Auswertung stammt aus Regelfassung ${storedVersion} und kann unter den aktuell bereitgestellten Inhalten nicht neu abgeleitet werden; ihre Einstufungen werden deshalb nicht als aktuelle Bewertung angezeigt. Die Aufzeichnungen (Kennung, Daten, Texte, Versuche) sind unverändert erhalten.`,
        retained: { childFeedback: stored.experience?.childFeedback ?? null, telemetry, title: stored.learning?.childSummary?.title ?? null },
      },
    };
  }
  const projected: ParentReview = {
    ...stored,
    experience: {
      ...stored.experience,
      telemetry,
      hypotheses: telemetry.uxObserved ? stored.experience.hypotheses : [],
      missing: [
        ...(stored.experience.missing ?? []).filter((m) => !/^Keine Telemetrie|^Bedienungs-Daten/.test(m)),
        ...(telemetry.supported && !telemetry.uxObserved ? ["Bedienungs-Daten: nicht erfasst — vom Gerät kam keine Beobachtung an (nur die Antworten des Kindes sind gespeichert). Aktive Zeit, Fenster-Wechsel, Pausen, Speicherfehler und Wiederholungen sind unbekannt, nicht null."] : []),
        ...(!telemetry.supported ? ["Keine Telemetrie für diesen Besuch: Zeiten, Wiederholungen und Speicherfehler sind unbekannt."] : []),
      ],
    },
  };
  return { review: projected, derivation: { status: "projected", storedVersion, currentVersion: REVIEW_VERSION, reason, note: `Lern-Einstufung wie gespeichert (Regelfassung ${storedVersion}, inhaltlich aktuell); Bedienungs-Daten nach aktueller Regel aus den Rohdaten zusammengefasst. Nichts wurde geschrieben.` } };
}

export async function refreshStaleReviews(client: Client, child: ChildId, content: LearningContent): Promise<number> {
  await ensureLearningTables(client);
  const tx = await beginWrite(client);
  try {
    const state = await loadMissionState(tx, child, content.contentId, content);
    if (!state) {
      await tx.rollback();
      release(tx);
      return 0;
    }
    const rows = await tx.execute({ sql: "SELECT completion_id, visit_id, historical, content_version, review_json FROM family_learning_completions WHERE child_id = ? AND mission_id = ?", args: [child, content.contentId] });
    let refreshed = 0;
    for (const row of rows.rows) {
      const old = parseJson(row.review_json) as ParentReview | null;
      if (old?.identity?.reviewVersion === REVIEW_VERSION) continue;
      const visitId = String(row.visit_id) as MissionState["visits"][number]["id"];
      if (!content.visits.some((v) => v.id === visitId)) continue;
      if (!state.visits.some((v) => v.id === visitId && v.finishedAt)) continue;
      const historical = Number(row.historical) === 1;
      const telemetry = historical ? null : await readTelemetryEvents(tx, child, visitId);
      const batches = telemetry ? Number((await tx.execute({ sql: "SELECT COUNT(*) AS c FROM family_learning_telemetry WHERE child_id = ? AND visit_id = ?", args: [child, visitId] })).rows[0]?.c ?? 0) : 0;
      const visitRecord = state.visits.find((v) => v.id === visitId && v.finishedAt)!;
      const review = buildParentReview(state, content, visitId, telemetry, { historical, contentVersion: Number(row.content_version), telemetryBatches: batches, lessons: visitLessonFeedback(state, content, visitRecord) });
      const previous = [...(old?.previousReviews ?? [])];
      if (old) previous.push({ reviewVersion: old.identity?.reviewVersion ?? 1, derivedAt: old.identity?.derivedAt ?? null, objectives: old.learning?.objectives ?? [], whatHappened: old.learning?.whatHappened ?? [] });
      review.previousReviews = previous.slice(-3);
      await tx.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = ? AND completion_id = ?", args: [JSON.stringify(review), child, String(row.completion_id)] });
      refreshed += 1;
    }
    await tx.commit();
    release(tx);
    return refreshed;
  } catch (error) {
    await abandon(tx);
    throw error;
  }
}

async function insertCompletion(db: Db, child: ChildId, state: MissionState, content: LearningContent, visitId: MissionState["visits"][number]["id"], historical: boolean, now: Date): Promise<boolean> {
  const visit = state.visits.find((v) => v.id === visitId && v.finishedAt);
  if (!visit || !visit.finishedAt) return false;
  const telemetry = historical ? null : await readTelemetryEvents(db, child, visitId);
  const batches = telemetry ? Number((await db.execute({ sql: "SELECT COUNT(*) AS c FROM family_learning_telemetry WHERE child_id = ? AND visit_id = ?", args: [child, visitId] })).rows[0]?.c ?? 0) : 0;
  const contentVersion = historical && state.upgradedAt && visit.finishedAt < state.upgradedAt ? 1 : state.contentVersion;
  const review = buildParentReview(state, content, visitId, telemetry, { historical, contentVersion, telemetryBatches: batches, lessons: visitLessonFeedback(state, content, visit) });
  const inserted = await db.execute({
    sql: `INSERT OR IGNORE INTO family_learning_completions (child_id, completion_id, mission_id, content_version, visit_id, visit_started_at, finished_at, historical, review_json, delivery_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [child, completionIdentity(state, visit), state.missionId, contentVersion, visit.id, visit.startedAt, visit.finishedAt, historical ? 1 : 0, JSON.stringify(review), JSON.stringify(REVIEW_DELIVERY), now.toISOString()],
  });
  return inserted.rowsAffected === 1;
}

/** Create the clearly marked historical review for every finished visit that has none (idempotent). */
export async function ensureHistoricalCompletions(client: Client, child: ChildId, content: LearningContent): Promise<number> {
  await ensureLearningTables(client);
  // The state, the existing identities and the inserts are read and written
  // inside ONE write transaction (independent repair P3): a deletion can only
  // commit before it (then there is no state and nothing is created) or after
  // it (then the deletion removes the rows). No snapshot taken outside the
  // transaction can be inserted after erasure.
  const tx = await beginWrite(client);
  try {
    const state = await loadMissionState(tx, child, content.contentId, content);
    if (!state) {
      await tx.rollback();
      release(tx);
      return 0;
    }
    // Only visits this content knows can be reviewed under it (a capped/rolled-back content leaves later chapters untouched).
    const finished = state.visits.filter((v) => v.finishedAt && content.visits.some((d) => d.id === v.id));
    if (finished.length === 0) {
      await tx.rollback();
      release(tx);
      return 0;
    }
    const existing = await tx.execute({ sql: "SELECT completion_id FROM family_learning_completions WHERE child_id = ?", args: [child] });
    const have = new Set(existing.rows.map((r) => String(r.completion_id)));
    const missing = finished.filter((v) => !have.has(completionIdentity(state, v)));
    let created = 0;
    for (const visit of missing) if (await insertCompletion(tx, child, state, content, visit.id, true, new Date())) created += 1;
    await tx.commit();
    release(tx);
    return created;
  } catch (error) {
    await abandon(tx);
    throw error;
  }
}

const MAX_TELEMETRY_EVENTS = 200;

export type TelemetryBatchInput = { batchId: string; visitId: string; visitStartedAt: string; erasureGeneration: number; events: unknown[] };
export type TelemetryStoreResult = { stored: boolean; accepted: number; reason?: "no-visit" | "generation" };

/**
 * Store one bounded telemetry batch, idempotent by batch id. Everything —
 * the erasure-generation check, the visit-instance check and the insert —
 * happens inside ONE write transaction (independent repair P1/P2): a
 * deletion can only commit before it (then the generation no longer matches
 * and the batch is dropped) or after it (then the deletion removes the row).
 * The batch must name the generation and the visit instance (visit id + its
 * startedAt) the client saw in the server view; an old batch replayed against
 * a fresh visit after erasure never attaches. Events are reduced to the closed
 * privacy schema (P4) — unknown kinds, keys, stages and free text are dropped.
 */
export async function recordTelemetry(client: Client, child: ChildId, missionId: string, batch: TelemetryBatchInput): Promise<TelemetryStoreResult> {
  await ensureLearningTables(client);
  const events = sanitizeTelemetryEvents(batch.events, MAX_TELEMETRY_EVENTS);
  const tx = await beginWrite(client);
  try {
    const generation = await readErasureGeneration(tx, child);
    if (!Number.isInteger(batch.erasureGeneration) || batch.erasureGeneration !== generation) {
      await tx.rollback();
      release(tx);
      return { stored: false, accepted: 0, reason: "generation" };
    }
    const owner = await loadMissionState(tx, child, missionId);
    const visit = owner?.visits.find((v) => v.id === batch.visitId && v.startedAt === batch.visitStartedAt) ?? null;
    if (!visit) {
      await tx.rollback();
      release(tx);
      return { stored: false, accepted: 0, reason: "no-visit" };
    }
    const inserted = await tx.execute({
      sql: "INSERT OR IGNORE INTO family_learning_telemetry (child_id, batch_id, mission_id, visit_id, visit_started_at, erasure_generation, events_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [child, batch.batchId, missionId, visit.id, visit.startedAt, generation, JSON.stringify(events), nowIso()],
    });
    await tx.commit();
    release(tx);
    return { stored: inserted.rowsAffected === 1, accepted: events.length };
  } catch (error) {
    await abandon(tx);
    throw error;
  }
}

export async function audit(client: Client, adminEmail: string, action: string, child: ChildId | null, targetId: string | null, payload: unknown): Promise<void> {
  await client.execute({
    sql: "INSERT INTO family_learning_parent_audit (id, admin_email, action, child_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), adminEmail, action, child, targetId, JSON.stringify(payload ?? null), nowIso()],
  });
}

export type { InValue };
