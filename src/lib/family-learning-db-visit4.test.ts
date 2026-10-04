// Visit 4 (content version 3) — persistence: a SYNTHETIC compatibility row written by the released content (version 2,
// three scripted finished visits, no `pier` key; no child record is used) is read with version 3, offered Visit 4, driven
// through the chapter and completed with a deduplicated parent review; the same rows read under the version-2 cap are parked/counted, never rewritten. Run: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { asLearningContent, type LearningContent } from "./family-learning-content.ts";
import { applyMutation, ensureLearningTables, readChildView, readEvidence } from "./family-learning-db.ts";
import type { LearningOp } from "./family-learning-state.ts";
import { asVocabularyInventory } from "./family-learning-vocabulary.ts";
import { isChildView } from "./family-learning-view-guard.ts";

const v2 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8")));
const v3 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v3.json", import.meta.url), "utf8")));
const inventory = asVocabularyInventory(JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v2.json", import.meta.url), "utf8")), v3);
const inventoryV1 = asVocabularyInventory(JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v1.json", import.meta.url), "utf8")), v2);

const dir = mkdtempSync(join(tmpdir(), "family-learning-visit4-"));
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
let k = 0;
const key = () => `v4-${(k += 1)}`;
let t = Date.UTC(2026, 9, 4, 8, 0, 0);
const now = () => new Date((t += 60_000));
const TZ = "Europe/Zurich";
const OWNER = "info@davideberle.com";
async function view(client: Client, content: LearningContent = v3) {
  return readChildView(client, "santiago", content, now(), { timeZone: TZ, vocabulary: content === v3 ? inventory : inventoryV1 });
}
async function step(client: Client, op: LearningOp, content: LearningContent = v3, idempotencyKey = key()) {
  const v = await view(client, content);
  const context = { erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null };
  return applyMutation(client, { child: "santiago", op, idempotencyKey, expectedRevision: v.revision, context }, content, now, { timeZone: TZ, vocabulary: content === v3 ? inventory : inventoryV1 });
}
async function must(client: Client, op: LearningOp, content: LearningContent = v3, idempotencyKey = key()) {
  const out = await step(client, op, content, idempotencyKey);
  if (out.status !== "applied" && out.status !== "replayed") throw new Error(`${op.op}: ${out.status} ${"message" in out ? out.message : ""}`);
  return out;
}
async function ack(client: Client, content: LearningContent = v3) {
  const v = await view(client, content);
  if (v.lastLesson) await must(client, { op: "lesson-feedback-seen", id: v.lastLesson.id }, content);
}
const lang = (segmentId: "LANG-EN-WATER" | "LANG-ES-AGUA" | "LANG-ES-STATION" | "LANG-EN-PIER", stepId: string, response: string, modality: "typed" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId, stepId, response, modality });
const stateRow = async (client: Client) => (await client.execute("SELECT state_json, content_version FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];

/** Explicitly synthetic compatibility fixture: three scripted visits written entirely by the RELEASED content (version 2). */
async function compatibilityFixture(client: Client) {
  const c = v2;
  for (const op of [{ op: "start-visit" }, { op: "name-base", name: "Fixture Basis" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }] as LearningOp[]) await must(client, op, c);
  await ack(client, c);
  await must(client, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, c);
  await ack(client, c);
  for (const op of [{ op: "explain", text: "Ich habe geteilt.", modality: "typed" }, lang("LANG-EN-WATER", "listen", "", "listen"), lang("LANG-EN-WATER", "pick", "water", "word-choice"), lang("LANG-EN-WATER", "produce", "water"), lang("LANG-EN-WATER", "reuse", "tools", "word-choice")] as LearningOp[]) await must(client, op, c);
  await ack(client, c);
  await must(client, { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Fixture Basis", seconds: 20 }, c);
  await ack(client, c);
  await must(client, { op: "save-log", text: "Tag eins." }, c);
  await must(client, { op: "reflect", optionId: "easy" }, c);
  await must(client, { op: "start-visit" }, c);
  await must(client, { op: "resume-base" }, c);
  await must(client, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }, c);
  await ack(client, c);
  await must(client, { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, c);
  await must(client, { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 }, c);
  await ack(client, c);
  await must(client, { op: "save-log", text: "Der Garten ist fertig." }, c);
  await must(client, { op: "reflect", optionId: "easy" }, c);
  await must(client, { op: "start-visit" }, c);
  await must(client, { op: "resume-base" }, c);
  await must(client, { op: "choose-station", theme: "turtles" }, c);
  await must(client, { op: "skip-stage", stage: "typing-course", reason: "child" }, c);
  await must(client, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, c);
  await ack(client, c);
  for (const op of [{ op: "explain", text: "Fünf mal sechs.", modality: "typed" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")] as LearningOp[]) await must(client, op, c);
  await ack(client, c);
  for (const op of [{ op: "build-station", spot: "beach" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }, { op: "write-transfer", text: "Morgen beobachten wir die Schildkröten.", modality: "typed" }] as LearningOp[]) await must(client, op, c);
  await ack(client, c);
  await must(client, { op: "summary-seen" }, c);
  await must(client, { op: "reflect", optionId: "easy" }, c);
  // the released build never wrote `pier`: strip the key this build initialises, exactly as a released-build row looks
  const row = await stateRow(client);
  equal(Number(row.content_version), 2);
  const stored = JSON.parse(String(row.state_json));
  delete stored.pier;
  await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(stored)] });
  ok(!("pier" in JSON.parse(String((await stateRow(client)).state_json))));
}

describe("Visit 4 persistence — released-build-shaped rows, forward upgrade, completion, cap", () => {
  it("reads the version-2 compatibility fixture with version 3, offers Besuch 4 once, upgrades additively on the first write only, and finishes with one deduplicated review", async () => {
    const client = await fresh();
    await compatibilityFixture(client);
    const before = JSON.parse(String((await stateRow(client)).state_json));
    const first = await view(client);
    ok(isChildView(first, "santiago"));
    equal(first.contentVersion, 3, "the view is built on the served (upgraded) content");
    equal(first.next.visit, "v5");
    equal(first.next.ordinal, 4);
    equal(first.progress.completedTotal, 3);
    equal(first.progress.next.label, "Besuch 4 — Der Steg in der Bucht");
    deepStrictEqual(JSON.parse(String((await stateRow(client)).state_json)), before, "reads leave the row byte-identical: the stored row stays at version 2 until the child acts");
    const started = await must(client, { op: "start-visit" });
    equal(started.view.visit?.id, "v5");
    const row = JSON.parse(String((await stateRow(client)).state_json));
    equal(row.contentVersion, 3);
    equal(row.upgradedAt, before.upgradedAt, "the pilot upgrade date is untouched by 2 → 3");
    deepStrictEqual(row.pier, { spot: null, built: false, builtAt: null, boatMoored: false });
    deepStrictEqual(Object.keys(row).filter((x) => !(x in before)), ["pier"], "exactly one additive key");
    deepStrictEqual(row.visits.slice(0, 3), before.visits, "history untouched");
    // replay of the start is a replay, not a second visit
    const again = await step(client, { op: "start-visit" });
    equal(again.status === "applied" && (again.result as { resumed?: boolean }).resumed === true, true);
    // the chapter
    await must(client, { op: "resume-base" });
    // the course needs the parent-confirmed layout (settings row); the pure tests cover the rounds — here the stage is skipped
    await must(client, { op: "skip-stage", stage: "typing-course", reason: "child" });
    const atMath = await view(client);
    equal(atMath.visit?.stage, "EQ-PIER");
    equal(atMath.math?.usedWord.past, "verbaut");
    await must(client, { op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" });
    await ack(client);
    for (const op of [{ op: "explain", text: "Sechs mal sieben.", modality: "typed" }, lang("LANG-EN-PIER", "listen", "", "listen"), lang("LANG-EN-PIER", "pick", "wood", "word-choice"), lang("LANG-EN-PIER", "produce", "we need wood"), lang("LANG-EN-PIER", "reuse", "rope", "word-choice")] as LearningOp[]) await must(client, op);
    await ack(client);
    const beforeBuild = await view(client);
    equal(beforeBuild.visit?.stage, "pier-build");
    equal(beforeBuild.scene.pier.built, false);
    equal(beforeBuild.pier?.woodAvailable, true);
    const built = await must(client, { op: "build-pier", spot: "bay" }, v3, "v4-build-once");
    equal(built.view.scene.pier.built, true);
    equal(built.view.scene.pier.boat, true);
    const replayBuild = await step(client, { op: "build-pier", spot: "bay" }, v3, "v4-build-once");
    equal(replayBuild.status, "replayed", "the build is exactly-once by key");
    // a fresh read after the write (as a reload does) still shows the pier
    const reloaded = await readChildView(client, "santiago", v3, now(), { timeZone: TZ, vocabulary: inventory });
    equal(reloaded.scene.pier.built, true);
    for (const op of [{ op: "save-log", text: "Heute steht der Steg." }, { op: "revise-log", text: "Heute steht der Steg." }, { op: "write-transfer", text: "Morgen bringt das Boot 5 Kisten.", modality: "typed" }] as LearningOp[]) await must(client, op);
    await ack(client);
    await must(client, { op: "summary-seen" });
    const finished = await must(client, { op: "reflect", optionId: "right" }, v3, "v4-finish");
    equal(finished.view.progress.completedTotal, 4);
    equal(finished.view.next.reason, "all-visits-done");
    equal(finished.view.reports.find((r) => r.visit === "v5")?.partial, false);
    const replayFinish = await step(client, { op: "reflect", optionId: "right" }, v3, "v4-finish");
    equal(replayFinish.status, "replayed");
    const evidence = await readEvidence(client, "santiago", finished.view.reports[0] ? String(JSON.parse(String((await stateRow(client)).state_json)).missionId) : "", undefined, v3, inventory);
    const completions = evidence.completions.filter((c) => c.visitId === "v5");
    equal(completions.length, 1, "one review per completion, never duplicated");
    equal(completions[0].contentVersion, 3);
    equal(completions[0].historical, false);
    equal(evidence.completions.length, 4);
    ok(evidence.completions.filter((c) => c.visitId === "v4").every((c) => c.contentVersion === 2), "the chapter-3 review keeps its content version");
    const ledger = evidence.vocabulary!;
    const wood = ledger.entries.find((e) => e.entryId === "EN-WOOD")!;
    equal(wood.dimensions.recognition.opportunities, 1);
    equal(wood.dimensions.recall.opportunities, 1);
    ok(evidence.attempts.some((a) => a.taskId === "EQ-PIER" && a.evidence === "independent"));
    ok(evidence.samples.some((s) => s.kind === "writing_transfer" && s.taskId === "WRITE-TRANSFER-2"));
  });
  it("under the version-2 cap the same rows read fine: a running v5 is parked, nothing is written, and the finished v5 is counted; removing the cap resumes exactly", async () => {
    const client = await fresh();
    await compatibilityFixture(client);
    await must(client, { op: "start-visit" });
    await must(client, { op: "resume-base" });
    await must(client, { op: "skip-stage", stage: "typing-course", reason: "child" });
    const rowBefore = String((await stateRow(client)).state_json);
    const capped = await view(client, v2);
    ok(isChildView(capped, "santiago"));
    equal(capped.visit, null);
    equal(capped.next.reason, "chapter-unavailable");
    equal(capped.progress.completedTotal, 3);
    equal(capped.scene.station.built, true);
    const refused = await step(client, { op: "start-visit" }, v2);
    equal(refused.status, "refused");
    equal(String((await stateRow(client)).state_json), rowBefore, "the capped server wrote nothing");
    const resumed = await view(client, v3);
    equal(resumed.visit?.stage, "EQ-PIER", "removing the cap resumes exactly where the child was");
    await must(client, { op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" });
    await ack(client);
    for (const op of [{ op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-PIER", reason: "child" }, { op: "build-pier", spot: "beach" }, { op: "save-log", text: "Steg." }, { op: "skip-stage", stage: "log-revise", reason: "child" }, { op: "skip-stage", stage: "log-transfer", reason: "child" }, { op: "summary-seen" }, { op: "reflect", optionId: "easy" }] as LearningOp[]) await must(client, op);
    const doneCapped = await view(client, v2);
    ok(isChildView(doneCapped, "santiago"));
    equal(doneCapped.progress.completedTotal, 4);
    equal(doneCapped.next.reason, "all-visits-done");
    const evidence = await readEvidence(client, "santiago", String(JSON.parse(String((await stateRow(client)).state_json)).missionId), undefined, v2, inventoryV1);
    equal(evidence.completions.length, 4, "the capped parent view still lists every completion");
    equal(evidence.state?.visits.length, 4);
  });
});
