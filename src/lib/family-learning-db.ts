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
  type ChildView,
  type LearningOp,
  type MissionState,
  type ParentSettings,
  type Records,
} from "./family-learning-state.ts";

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

export async function loadMissionState(db: Db, child: ChildId, missionId: string): Promise<MissionState | null> {
  const result = await db.execute({
    sql: "SELECT state_json, revision FROM family_learning_missions WHERE child_id = ? AND mission_id = ?",
    args: [child, missionId],
  });
  if (result.rows.length === 0) return null;
  const state = JSON.parse(String(result.rows[0].state_json)) as MissionState;
  state.revision = Number(result.rows[0].revision);
  return state;
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
    sql: `UPDATE family_learning_missions SET revision = ?, state_json = ?, updated_at = ? WHERE child_id = ? AND mission_id = ? AND revision = ?`,
    args: [state.revision, json, state.updatedAt, state.child, state.missionId, expectedRevision],
  });
  return updated.rowsAffected === 1;
}

export type MutationInput = { child: ChildId; op: LearningOp; idempotencyKey: string; expectedRevision: number };

export type MutationOutcome =
  | { status: "applied" | "replayed"; view: ChildView; result: Record<string, unknown> }
  | { status: "stale"; view: ChildView }
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
  let state = initial ?? (await loadMissionState(client, child, content.contentId)) ?? newMissionState(content, child, now.toISOString());
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
    state = (await loadMissionState(client, child, content.contentId)) ?? state;
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
export async function readChildView(client: Client, child: ChildId, content: LearningContent, now = new Date()): Promise<ChildView> {
  await ensureLearningTables(client);
  const settings = await readParentSettings(client, child);
  const state = await settleShown(client, child, content, now, null);
  return buildChildView(state, content, settings, now);
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
): Promise<MutationOutcome> {
  await ensureLearningTables(client);
  const settings = await readParentSettings(client, input.child);
  const env = { content, settings, now, newId: () => randomUUID() };
  const tx = await beginWrite(client);
  try {
    const existing = await tx.execute({
      sql: "SELECT revision_after FROM family_learning_mutations WHERE child_id = ? AND idempotency_key = ?",
      args: [input.child, input.idempotencyKey],
    });
    const current = (await loadMissionState(tx, input.child, content.contentId)) ?? newMissionState(content, input.child, now().toISOString());
    if (existing.rows.length > 0) {
      await tx.rollback();
      release(tx);
      const settled = await settleShown(client, input.child, content, now(), current);
      return { status: "replayed", view: buildChildView(settled, content, settings, now()), result: { replayed: true, revisionAfter: Number(existing.rows[0].revision_after) } };
    }
    if (current.revision !== input.expectedRevision) {
      await tx.rollback();
      release(tx);
      const settled = await settleShown(client, input.child, content, now(), current);
      return { status: "stale", view: buildChildView(settled, content, settings, now()) };
    }
    let applied;
    try {
      applied = applyLearningOp(current, input.op, env);
    } catch (error) {
      await tx.rollback();
      release(tx);
      if (error instanceof LearningOpError) {
        const settled = await settleShown(client, input.child, content, now(), current);
        return { status: "refused", code: error.code, message: error.message, view: buildChildView(settled, content, settings, now()) };
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
      return { status: "stale", view: buildChildView(settled, content, settings, now()) };
    }
    await insertRecords(tx, input.child, content.contentId, applied.records);
    if (shown.changed) await insertRecords(tx, input.child, content.contentId, shown.records);
    await tx.execute({
      sql: `INSERT INTO family_learning_mutations (child_id, idempotency_key, mission_id, op, revision_after, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [input.child, input.idempotencyKey, content.contentId, input.op.op, applied.state.revision, now().toISOString()],
    });
    await tx.commit();
    release(tx);
    return { status: "applied", view: buildChildView(finalState, content, settings, now()), result: applied.result };
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

export type EvidenceBundle = {
  child: ChildId;
  /** Content-free erasure fence; parent writes must echo it. */
  erasureGeneration: number;
  state: MissionState | null;
  attempts: EvidenceAttempt[];
  supports: { id: string; visitId: string; taskId: string | null; kind: string; payload: unknown; createdAt: string }[];
  samples: { id: string; visitId: string; taskId: string | null; kind: string; language: string | null; modality: string; text: string; metrics: unknown; createdAt: string }[];
  exposures: { taskId: string; taskVersion: number; kind: string; source: string; firstAt: string }[];
  settings: ParentSettings;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function readEvidence(client: Client, child: ChildId, missionId: string, afterFirstRead?: () => Promise<void>): Promise<EvidenceBundle> {
  await ensureLearningTables(client);
  // Every child row and the generation come from one coherent snapshot, so the
  // bundle can never label pre-deletion content with a post-deletion generation.
  const { erasureGeneration, value } = await readWithErasureSnapshot(
    client,
    child,
    async () => {
      const [state, settings, attempts, supports, samples, exposures] = await Promise.all([
        loadMissionState(client, child, missionId),
        readParentSettings(client, child),
        client.execute({ sql: "SELECT * FROM family_learning_attempts WHERE child_id = ? ORDER BY created_at ASC", args: [child] }),
        client.execute({ sql: "SELECT * FROM family_learning_support_events WHERE child_id = ? ORDER BY created_at ASC", args: [child] }),
        client.execute({ sql: "SELECT * FROM family_learning_work_samples WHERE child_id = ? ORDER BY created_at ASC", args: [child] }),
        client.execute({ sql: "SELECT * FROM family_learning_exposures WHERE child_id = ? ORDER BY first_at ASC", args: [child] }),
      ]);
      return { state, settings, attempts, supports, samples, exposures };
    },
    afterFirstRead,
  );
  const { state, settings, attempts, supports, samples, exposures } = value;
  return {
    child,
    erasureGeneration,
    state,
    settings,
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
  const tables = [
    "family_learning_missions",
    "family_learning_mutations",
    "family_learning_attempts",
    "family_learning_exposures",
    "family_learning_support_events",
    "family_learning_work_samples",
    "family_learning_parent_settings",
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

export async function audit(client: Client, adminEmail: string, action: string, child: ChildId | null, targetId: string | null, payload: unknown): Promise<void> {
  await client.execute({
    sql: "INSERT INTO family_learning_parent_audit (id, admin_email, action, child_id, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), adminEmail, action, child, targetId, JSON.stringify(payload ?? null), nowIso()],
  });
}

export type { InValue };
