// Persistence contract: idempotent tables, idempotency ledger, revision guard,
// durable exposure on read, child separation, correction and deletion.
// Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { asLearningContent } from "./family-learning-content.ts";
import {
  applyMutation,
  correctAttempt,
  ExposureUnsettledError,
  readErasureGeneration,
  readParentSettingsSnapshot,
  StaleErasureGenerationError,
  writeParentSettings,
  deleteChildRecords,
  ensureLearningTables,
  readChildView,
  readEvidence,
  readParentSettings,
  writeParentSetting,
} from "./family-learning-db.ts";

const content = asLearningContent(
  JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")),
);

// A file-backed database per test: libsql opens a new connection after a
// transaction, and a `:memory:` connection would come back empty.
const dir = mkdtempSync(join(tmpdir(), "family-learning-test-"));
let n = 0;
const clients: Client[] = [];
async function fresh(): Promise<Client> {
  const client = createClient({ url: `file:${join(dir, `db-${(n += 1)}.sqlite`)}` });
  clients.push(client);
  await ensureLearningTables(client);
  return client;
}
after(() => {
  for (const client of clients) client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ensureLearningTables", () => {
  it("is idempotent", async () => {
    const client = await fresh();
    await ensureLearningTables(client);
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'family_learning_%' ORDER BY name");
    equal(tables.rows.length, 11);
  });
});

describe("applyMutation", () => {
  it("applies, replays the same key without re-applying, and refuses a stale revision", async () => {
    const client = await fresh();
    const first = await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    equal(first.status, "applied");
    equal(first.view.revision, 1);
    equal(first.view.visit?.stage, "name-base");
    const replay = await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    equal(replay.status, "replayed");
    equal(replay.view.revision, 1);
    const stale = await applyMutation(client, { child: "santiago", op: { op: "name-base", name: "X" }, idempotencyKey: "k2", expectedRevision: 0 }, content);
    equal(stale.status, "stale");
    equal(stale.view.revision, 1);
    const named = await applyMutation(client, { child: "santiago", op: { op: "name-base", name: "Sternwarte" }, idempotencyKey: "k2", expectedRevision: 1 }, content);
    equal(named.status, "applied");
    equal(named.view.base.name, "Sternwarte");
    const ledger = await client.execute("SELECT COUNT(*) AS n FROM family_learning_mutations");
    equal(Number(ledger.rows[0].n), 2);
  });

  it("refuses an out-of-stage op without touching state and reports the code", async () => {
    const client = await fresh();
    const refused = await applyMutation(client, { child: "santiago", op: { op: "name-base", name: "X" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    equal(refused.status, "refused");
    if (refused.status === "refused") equal(refused.code, "not-allowed");
    const ledger = await client.execute("SELECT COUNT(*) AS n FROM family_learning_mutations");
    equal(Number(ledger.rows[0].n), 0);
  });

  it("keeps children separate: the same key and ops do not cross child ids", async () => {
    const client = await fresh();
    await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    const isabel = await readChildView(client, "isabel", content);
    equal(isabel.revision, 0);
    equal(isabel.visit, null);
    const santiago = await readChildView(client, "santiago", content);
    equal(santiago.revision, 1);
  });
});

describe("readChildView", () => {
  it("writes the shown exposure durably before returning a scored item, once", async () => {
    const client = await fresh();
    let r = await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    r = await applyMutation(client, { child: "santiago", op: { op: "name-base", name: "Basis" }, idempotencyKey: "k2", expectedRevision: r.view.revision }, content);
    r = await applyMutation(client, { child: "santiago", op: { op: "place-base", locationId: "ice" }, idempotencyKey: "k3", expectedRevision: r.view.revision }, content);
    const view1 = await readChildView(client, "santiago", content);
    equal(view1.visit?.stage, "EQ-ENTRY");
    const view2 = await readChildView(client, "santiago", content);
    equal(view2.revision, view1.revision);
    const exposures = await client.execute("SELECT task_id, kind FROM family_learning_exposures WHERE child_id = 'santiago'");
    deepStrictEqual(exposures.rows.map((row) => [row.task_id, row.kind]), [["EQ-ENTRY", "shown"]]);
    // Answering with the revision from the view works; the attempt row lands.
    const answered = await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "k4", expectedRevision: view2.revision }, content);
    equal(answered.status, "applied");
    // The transition advanced to EQ-FRESH: its exposure is written in the same
    // transaction as the answer, before the response is built (#3).
    equal(answered.view.visit?.stage, "EQ-FRESH");
    const afterAnswer = await readEvidence(client, "santiago", content.contentId);
    deepStrictEqual(afterAnswer.exposures.map((e) => e.taskId), ["EQ-ENTRY", "EQ-FRESH"]);
    equal((await readChildView(client, "santiago", content)).visit?.stage, "EQ-FRESH");
    const evidence = await readEvidence(client, "santiago", content.contentId);
    equal(evidence.attempts.length, 1);
    equal(evidence.attempts[0].evidence, "independent");
    equal(evidence.exposures.length, 2);
  });
});

describe("parent settings, corrections, deletion, unlock ledger", () => {
  it("round-trips settings and ignores unknown layouts", async () => {
    const client = await fresh();
    await writeParentSetting(client, "santiago", "keyboard_layout", "ch-de-qwertz");
    await writeParentSetting(client, "santiago", "mission_title", "Die Eisbasis");
    const settings = await readParentSettings(client, "santiago");
    equal(settings.keyboardLayout, "ch-de-qwertz");
    equal(settings.missionTitle, "Die Eisbasis");
    await client.execute("UPDATE family_learning_parent_settings SET value = 'dvorak' WHERE key = 'keyboard_layout'");
    equal((await readParentSettings(client, "santiago")).keyboardLayout, null);
    await writeParentSetting(client, "santiago", "mission_title", null);
    equal((await readParentSettings(client, "santiago")).missionTitle, null);
  });

  it("annotates an attempt with a correction that does not overwrite the child's evidence", async () => {
    const client = await fresh();
    let r = await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    r = await applyMutation(client, { child: "santiago", op: { op: "name-base", name: "Basis" }, idempotencyKey: "k2", expectedRevision: r.view.revision }, content);
    r = await applyMutation(client, { child: "santiago", op: { op: "place-base", locationId: "ice" }, idempotencyKey: "k3", expectedRevision: r.view.revision }, content);
    const view = await readChildView(client, "santiago", content);
    await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "k4", expectedRevision: view.revision }, content);
    const before = await readEvidence(client, "santiago", content.contentId);
    const ok1 = await correctAttempt(client, { child: "santiago", attemptId: before.attempts[0].id, evidence: "supported", note: "Ich habe ihm geholfen.", adminEmail: "info@davideberle.com" });
    equal(ok1, true);
    const wrongChild = await correctAttempt(client, { child: "isabel", attemptId: before.attempts[0].id, evidence: "supported", note: null, adminEmail: "info@davideberle.com" });
    equal(wrongChild, false);
    const after1 = await readEvidence(client, "santiago", content.contentId);
    equal(after1.attempts[0].evidence, "independent");
    equal(after1.attempts[0].parentCorrection?.evidence, "supported");
    const audit = await client.execute("SELECT action FROM family_learning_parent_audit");
    deepStrictEqual(audit.rows.map((row) => row.action), ["correction"]);
  });

  it("deletes every learning row for one child only, and audits it", async () => {
    const client = await fresh();
    await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    await applyMutation(client, { child: "isabel", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    await writeParentSetting(client, "santiago", "keyboard_layout", "us-qwerty");
    const counts = await deleteChildRecords(client, "santiago", "info@davideberle.com");
    equal(counts.family_learning_missions, 1);
    equal(counts.family_learning_parent_settings, 1);
    equal((await readChildView(client, "santiago", content)).revision, 0);
    equal((await readChildView(client, "isabel", content)).revision, 1);
    const audit = await client.execute("SELECT action, child_id FROM family_learning_parent_audit");
    deepStrictEqual(audit.rows.map((row) => [row.action, row.child_id]), [["delete_records", "santiago"]]);
  });

});

describe("regressions from the independent review (2026-09-28)", () => {
  async function toEntry(client: Client) {
    let r = await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: "k1", expectedRevision: 0 }, content);
    r = await applyMutation(client, { child: "santiago", op: { op: "name-base", name: "Basis" }, idempotencyKey: "k2", expectedRevision: r.view.revision }, content);
    r = await applyMutation(client, { child: "santiago", op: { op: "place-base", locationId: "ice" }, idempotencyKey: "k3", expectedRevision: r.view.revision }, content);
    return r;
  }

  it("#3 exposure is settled on the applied, stale, replayed and refused paths", async () => {
    const client = await fresh();
    // place-base advances to EQ-ENTRY: applied response already carries the exposure.
    const placed = await toEntry(client);
    equal(placed.view.visit?.stage, "EQ-ENTRY");
    deepStrictEqual((await readEvidence(client, "santiago", content.contentId)).exposures.map((e) => e.taskId), ["EQ-ENTRY"]);
    // A stale tab (old revision) answering EQ-ENTRY correctly with the right revision from another tab:
    const tabA = placed.view.revision;
    const answered = await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "kA", expectedRevision: tabA }, content);
    equal(answered.status, "applied");
    equal(answered.view.visit?.stage, "EQ-FRESH");
    // Tab B, still at the old revision, gets "stale" with the settled current view (EQ-FRESH shown).
    const staleB = await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "kB", expectedRevision: tabA }, content);
    equal(staleB.status, "stale");
    equal(staleB.view.visit?.stage, "EQ-FRESH");
    // Replay of A returns the settled view too; a refused op likewise.
    const replay = await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "kA", expectedRevision: tabA }, content);
    equal(replay.status, "replayed");
    equal(replay.view.visit?.stage, "EQ-FRESH");
    const refused = await applyMutation(client, { child: "santiago", op: { op: "name-base", name: "X" }, idempotencyKey: "kC", expectedRevision: replay.view.revision }, content);
    equal(refused.status, "refused");
    equal(refused.view.visit?.stage, "EQ-FRESH");
    const exposures = (await readEvidence(client, "santiago", content.contentId)).exposures.map((e) => e.taskId);
    deepStrictEqual(exposures, ["EQ-ENTRY", "EQ-FRESH"]);
    // Direct teaching and stopping also advance: exposure of the next item lands with the response.
    const wrong1 = await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-FRESH", answer: 1, raw: "1", modality: "typed" }, idempotencyKey: "kD", expectedRevision: refused.view.revision }, content);
    const wrong2 = await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-FRESH", answer: 2, raw: "2", modality: "typed" }, idempotencyKey: "kE", expectedRevision: wrong1.view.revision }, content);
    ok(wrong2.status === "applied" && wrong2.view.math?.phase === "represent" && wrong2.view.math.teachingOffered);
    const wrong3 = await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-FRESH", answer: 3, raw: "3", modality: "typed" }, idempotencyKey: "kF", expectedRevision: wrong2.view.revision }, content);
    ok(wrong3.status === "applied" && wrong3.view.math?.phase === "teach-or-stop");
    const stopped = await applyMutation(client, { child: "santiago", op: { op: "stop-item", itemId: "EQ-FRESH" }, idempotencyKey: "kG", expectedRevision: wrong3.view.revision }, content);
    equal(stopped.status, "applied");
    equal(stopped.view.visit?.stage, "explain");
  });


  it("R2-3 a deletion interleaved with a correction cannot resurrect the private note", async () => {
    const client = await fresh();
    const r = await toEntry(client);
    void r;
    const view = await readChildView(client, "santiago", content);
    await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "k4", expectedRevision: view.revision }, content);
    const attemptId = (await readEvidence(client, "santiago", content.contentId)).attempts[0].id;
    // The correction transaction is open; deletion is started between its UPDATE and its audit INSERT
    // and must wait for the transaction (write lock), then remove everything the correction wrote.
    let deletion: Promise<Record<string, number>> | null = null;
    const corrected = await correctAttempt(client, {
      child: "santiago",
      attemptId,
      evidence: null,
      note: "PRIVATE CORRECTION CONTENT",
      adminEmail: "info@davideberle.com",
      beforeAudit: async () => {
        deletion = deleteChildRecords(client, "santiago", "info@davideberle.com");
        await new Promise((resolve) => setTimeout(resolve, 150));
      },
    });
    equal(corrected, true);
    ok(deletion);
    await deletion!;
    const audit = await client.execute("SELECT action, payload_json FROM family_learning_parent_audit");
    equal(audit.rows.length, 1);
    equal(audit.rows[0].action, "delete_records");
    equal(JSON.stringify(audit.rows.map((row) => row.payload_json)).includes("PRIVATE"), false);
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'santiago'")).rows[0].n), 0);
    // Settings + audit are one transaction as well; after deletion nothing remains.
    await writeParentSettings(client, "santiago", [{ key: "mission_hook", value: "PRIVATE HOOK" }], "info@davideberle.com", 1);
    await deleteChildRecords(client, "santiago", "info@davideberle.com");
    const after = await client.execute("SELECT payload_json FROM family_learning_parent_audit");
    equal(JSON.stringify(after.rows.map((row) => row.payload_json)).includes("PRIVATE"), false);
  });

  it("settleShown fails closed when the exposure cannot be written", async () => {
    const client = await fresh();
    await toEntry(client);
    // A client whose write transactions never affect the state row simulates a
    // writer that keeps losing the revision race.
    // libsql's client uses private fields, so a Proxy is rejected; delegate explicitly.
    const stubborn = {
      execute: (stmt: never) => client.execute(stmt),
      batch: (stmts: never, mode: never) => client.batch(stmts, mode),
      reconnect: () => client.reconnect(),
      close: () => client.close(),
      transaction: async (mode: "write" | "read" | "deferred") => {
        const tx = await client.transaction(mode);
        return {
          execute: async (stmt: { sql: string; args: unknown[] } | string) => {
            const sql = typeof stmt === "string" ? stmt : stmt.sql;
            if (sql.startsWith("UPDATE family_learning_missions")) return { rowsAffected: 0, rows: [], columns: [], columnTypes: [], lastInsertRowid: undefined };
            return tx.execute(stmt as never);
          },
          commit: () => tx.commit(),
          rollback: () => tx.rollback(),
          close: () => tx.close(),
        };
      },
    } as unknown as Client;
    // The state still has EQ-ENTRY shown from toEntry(); move to a state where an unshown item is active.
    const view = await readChildView(client, "santiago", content);
    await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "kx", expectedRevision: view.revision }, content);
    // Remove the EQ-FRESH exposure the applied path wrote, so a read must settle it again.
    await client.execute("DELETE FROM family_learning_exposures WHERE task_id = 'EQ-FRESH'");
    await client.execute(`UPDATE family_learning_missions SET state_json = json_set(state_json, '$.math."EQ-FRESH".shownAt', null, '$.math."EQ-FRESH".exposure', 'none') WHERE child_id = 'santiago'`);
    let thrown: unknown = null;
    try {
      await readChildView(stubborn, "santiago", content);
    } catch (error) {
      thrown = error;
    }
    ok(thrown instanceof ExposureUnsettledError);
  });

  it("#6 deletion scrubs earlier audit payloads and leaves a content-free receipt", async () => {
    const client = await fresh();
    const r = await toEntry(client);
    const view = await readChildView(client, "santiago", content);
    void r;
    await applyMutation(client, { child: "santiago", op: { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, idempotencyKey: "k4", expectedRevision: view.revision }, content);
    const before = await readEvidence(client, "santiago", content.contentId);
    await correctAttempt(client, { child: "santiago", attemptId: before.attempts[0].id, evidence: null, note: "SECRET-NOTE", adminEmail: "info@davideberle.com" });
    await writeParentSetting(client, "santiago", "mission_hook", "SECRET-HOOK");
    await client.execute({ sql: "INSERT INTO family_learning_parent_audit (id, admin_email, action, child_id, target_id, payload_json, created_at) VALUES ('a1', 'info@davideberle.com', 'settings', 'santiago', NULL, ?, '2026-09-28T10:00:00Z')", args: [JSON.stringify([{ key: "mission_hook", value: "SECRET-HOOK" }])] });
    await deleteChildRecords(client, "santiago", "info@davideberle.com");
    const audit = await client.execute("SELECT action, child_id, payload_json FROM family_learning_parent_audit");
    equal(audit.rows.length, 1);
    equal(audit.rows[0].action, "delete_records");
    const remaining = JSON.stringify(audit.rows.map((row) => row.payload_json));
    equal(remaining.includes("SECRET"), false);
    const everywhere = await Promise.all(
      ["family_learning_attempts", "family_learning_parent_settings", "family_learning_work_samples", "family_learning_support_events", "family_learning_missions"].map((t) => client.execute(`SELECT COUNT(*) AS n FROM ${t} WHERE child_id = 'santiago'`)),
    );
    deepStrictEqual(everywhere.map((res) => Number(res.rows[0].n)), [0, 0, 0, 0, 0]);
  });
});

describe("regressions from the independent review, round 3 (2026-09-28)", () => {
  it("R3-1 a settings request prepared before a deletion is refused; a deliberate fresh one after reloading is allowed", async () => {
    const client = await fresh();
    const admin = "info@davideberle.com";
    equal(await readErasureGeneration(client, "santiago"), 0);
    // Ordering A: request prepared (generation 0), paused before its transaction; deletion completes; request resumes.
    let refused: unknown = null;
    try {
      await writeParentSettings(client, "santiago", [{ key: "mission_hook", value: "PRIVATE HOOK" }], admin, 0, async () => {
        await deleteChildRecords(client, "santiago", admin);
      });
    } catch (error) {
      refused = error;
    }
    ok(refused instanceof StaleErasureGenerationError && refused.current === 1);
    const settings = await client.execute("SELECT value FROM family_learning_parent_settings WHERE child_id = 'santiago'");
    equal(settings.rows.length, 0);
    const audit = await client.execute("SELECT action, payload_json FROM family_learning_parent_audit WHERE child_id = 'santiago'");
    deepStrictEqual(audit.rows.map((r) => r.action), ["delete_records"]);
    equal(JSON.stringify(audit.rows.map((r) => r.payload_json)).includes("PRIVATE"), false);
    // A stale tab still holding generation 0 is refused too, without a race.
    let staleTab: unknown = null;
    try {
      await writeParentSettings(client, "santiago", [{ key: "mission_title", value: "OLD TAB" }], admin, 0);
    } catch (error) {
      staleTab = error;
    }
    ok(staleTab instanceof StaleErasureGenerationError);
    // Ordering B: after reloading (generation 1) a deliberate new setting is allowed.
    const fresh1 = await readErasureGeneration(client, "santiago");
    equal(fresh1, 1);
    const written = await writeParentSettings(client, "santiago", [{ key: "keyboard_layout", value: "us-qwerty" }], admin, fresh1);
    equal(written.keyboardLayout, "us-qwerty");
    // Deleting again bumps the fence; the just-used generation is stale afterwards.
    await deleteChildRecords(client, "santiago", admin);
    equal(await readErasureGeneration(client, "santiago"), 2);
    let again: unknown = null;
    try {
      await writeParentSettings(client, "santiago", [{ key: "keyboard_layout", value: "us-qwerty" }], admin, 1);
    } catch (error) {
      again = error;
    }
    ok(again instanceof StaleErasureGenerationError);
    // The sibling's fence is untouched.
    equal(await readErasureGeneration(client, "isabel"), 0);
  });
});

describe("regressions from the independent review, round 4 (2026-09-28)", () => {
  it("R4-1 a settings snapshot read across a deletion never labels old content with the new generation; the PUT composition is refused", async () => {
    const client = await fresh();
    const admin = "info@davideberle.com";
    await writeParentSettings(client, "santiago", [{ key: "mission_hook", value: "PRIVATE HOOK" }], admin, 0);
    // GET-equivalent: the first generation read has happened, then deletion completes, then the content is read.
    const snapshot = await readParentSettingsSnapshot(client, "santiago", async () => {
      await deleteChildRecords(client, "santiago", admin);
    });
    // Coherent: the snapshot re-read after the bump, so it is the post-deletion state.
    equal(snapshot.erasureGeneration, 1);
    equal(snapshot.settings.missionHook, null);
    // Sending the snapshot's own pair through the write path cannot restore anything (there is nothing to restore).
    const written = await writeParentSettings(client, "santiago", [{ key: "mission_hook", value: snapshot.settings.missionHook }], admin, snapshot.erasureGeneration);
    equal(written.missionHook, null);
    // The pair a naive read would have produced (old content + new generation) is exactly what the snapshot prevents:
    // an old-content pair carries the OLD generation and is refused.
    let refused: unknown = null;
    try {
      await writeParentSettings(client, "santiago", [{ key: "mission_hook", value: "PRIVATE HOOK" }], admin, 0);
    } catch (error) {
      refused = error;
    }
    ok(refused instanceof StaleErasureGenerationError);
    const audit = await client.execute("SELECT payload_json FROM family_learning_parent_audit");
    equal(JSON.stringify(audit.rows.map((r) => r.payload_json)).includes("PRIVATE"), false);
  });

  it("R4-1 the evidence bundle is read as one snapshot too", async () => {
    const client = await fresh();
    const admin = "info@davideberle.com";
    await writeParentSettings(client, "santiago", [{ key: "mission_title", value: "PRIVATE TITLE" }], admin, 0);
    const bundle = await readEvidence(client, "santiago", content.contentId, async () => {
      await deleteChildRecords(client, "santiago", admin);
    });
    equal(bundle.erasureGeneration, 1);
    equal(bundle.settings.missionTitle, null);
    // Without interference the snapshot is the current state at generation 1.
    const again = await readEvidence(client, "santiago", content.contentId);
    equal(again.erasureGeneration, 1);
    equal(again.settings.missionTitle, null);
    // Deletion completed before the read: a deliberate fresh write with the read generation succeeds.
    const fresh2 = await writeParentSettings(client, "santiago", [{ key: "mission_title", value: "Neu" }], admin, again.erasureGeneration);
    equal(fresh2.missionTitle, "Neu");
  });
});
