-- Family Assistant — learning cockpit persistence (DESIGN §7.6).
--
-- Canonical schema, owned by Family Assistant. Companion App mirrors this file
-- verbatim into `app/src/data/family-learning/schema.sql` and executes each
-- statement as an idempotent runtime guard against its existing Turso/libSQL
-- database (the app's established pattern; no migrations directory). The
-- mirror is checked against this file by `scripts/sync-family-learning.mjs`.
--
-- Every child-bound row carries `child_id`; every table is additive, so the
-- feature-off rollback path is: stop serving the routes, leave the tables.
-- Statements are separated by a line containing only `;;` so the mirror can be
-- split without an SQL parser.

CREATE TABLE IF NOT EXISTS family_learning_missions (
  child_id        TEXT NOT NULL,
  mission_id      TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  revision        INTEGER NOT NULL,
  state_json      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (child_id, mission_id)
)
;;
-- One row per accepted mutation: the idempotency ledger. A duplicate submission
-- returns the stored result instead of applying the operation twice.
CREATE TABLE IF NOT EXISTS family_learning_mutations (
  child_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  mission_id      TEXT NOT NULL,
  op              TEXT NOT NULL,
  revision_after  INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (child_id, idempotency_key)
)
;;
-- Scored and unscored attempts. `evidence` is the honest category:
-- independent | supported | answer_exposed | incorrect | unscored.
CREATE TABLE IF NOT EXISTS family_learning_attempts (
  id                  TEXT PRIMARY KEY,
  child_id            TEXT NOT NULL,
  mission_id          TEXT NOT NULL,
  visit_id            TEXT NOT NULL,
  task_id             TEXT NOT NULL,
  task_version        INTEGER NOT NULL,
  objective           TEXT NOT NULL,
  attempt_no          INTEGER NOT NULL,
  answer_json         TEXT NOT NULL,
  correct             INTEGER,
  evidence            TEXT NOT NULL,
  support_json        TEXT NOT NULL,
  exposure_before     TEXT NOT NULL,
  stimulus_language   TEXT NOT NULL,
  response_language   TEXT,
  modality            TEXT NOT NULL,
  uncertainty         TEXT,
  teaching_move       TEXT,
  teaching_reason     TEXT,
  seconds_since_teaching INTEGER,
  created_at          TEXT NOT NULL,
  parent_correction_json TEXT,
  parent_corrected_at TEXT
)
;;
CREATE INDEX IF NOT EXISTS idx_family_learning_attempts_child
  ON family_learning_attempts (child_id, task_id, created_at)
;;
-- Durable item/answer exposure. kind: shown | example_shown | answer_revealed.
-- Written before the item is rendered or before a tutor turn is dispatched, so a
-- reload, retry or cancelled turn can never make an item look fresh again.
CREATE TABLE IF NOT EXISTS family_learning_exposures (
  child_id     TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  source       TEXT NOT NULL,
  first_at     TEXT NOT NULL,
  PRIMARY KEY (child_id, task_id, task_version, kind)
)
;;
-- Support events: read_aloud | gloss | counters | representation | clarification |
-- example | tutor_question | tutor_reply | direct_teaching | step_down.
CREATE TABLE IF NOT EXISTS family_learning_support_events (
  id           TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL,
  mission_id   TEXT NOT NULL,
  visit_id     TEXT NOT NULL,
  task_id      TEXT,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
)
;;
CREATE INDEX IF NOT EXISTS idx_family_learning_support_child
  ON family_learning_support_events (child_id, created_at)
;;
-- Work samples: explanation | expedition_log | typed_label | language_response |
-- typing_practice. Never scored as mastery; shown to the parent as-is.
CREATE TABLE IF NOT EXISTS family_learning_work_samples (
  id           TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL,
  mission_id   TEXT NOT NULL,
  visit_id     TEXT NOT NULL,
  task_id      TEXT,
  kind         TEXT NOT NULL,
  language     TEXT,
  modality     TEXT NOT NULL,
  text         TEXT NOT NULL,
  metrics_json TEXT,
  created_at   TEXT NOT NULL
)
;;
CREATE INDEX IF NOT EXISTS idx_family_learning_samples_child
  ON family_learning_work_samples (child_id, created_at)
;;
-- Parent-owned settings per child: keyboard_layout, language_variety_en,
-- language_variety_es, mission_title, mission_hook.
-- Note (2026-09-29): parent access is the owner's authenticated session; the
-- earlier candidate unlock/challenge ledgers were never created in production
-- and are not part of this schema.
CREATE TABLE IF NOT EXISTS family_learning_parent_settings (
  child_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (child_id, key)
)
;;
-- Durable, content-free erasure fence per child. Deletion bumps the
-- generation inside the deletion transaction; every parent write carries the
-- generation its view was loaded from and is refused when it no longer matches,
-- so an in-flight or stale-tab request from before a deletion cannot restore
-- deleted content. Deliberate new writes after reloading are allowed.
CREATE TABLE IF NOT EXISTS family_learning_child_epochs (
  child_id           TEXT PRIMARY KEY,
  erasure_generation INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL
)
;;
-- Parent administration audit: correction | delete_records | settings.
-- Payloads for a child are scrubbed when that child's records are deleted;
-- only a content-free deletion receipt (row counts) remains.
CREATE TABLE IF NOT EXISTS family_learning_parent_audit (
  id           TEXT PRIMARY KEY,
  admin_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  child_id     TEXT,
  target_id    TEXT,
  payload_json TEXT,
  created_at   TEXT NOT NULL
)
