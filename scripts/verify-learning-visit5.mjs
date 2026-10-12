// Visit 5 (content version 4, 2026-10-10) — browser + HTTP + database evidence for the harbor chapter `v6` (learner-visible
// Besuch 5): the one next action from the completed-four-visits shape, the island hub with keyboard/click movement and direct
// entry, the free workplace order, the two-part harbor item, the reasoning conversation in the Nabu sidebar (typed path; the
// microphone's failure path under a denied permission; the speech route blocked by the audio guard), the Spanish supplier with
// the recorded translation, the plan, the captain's log, the typing round, the closing check, the writing review, the report,
// the map after the visit, reopening, the parent evidence, stale/replay requests, sibling isolation and the version-3 cap
// parking a running v6. LOCAL production server, synthetic AUTH_SECRET, isolated NABU_DB_DIR; headless Chromium with the
// project audio guard; the TTS and transcription routes are aborted at the browser (nothing leaves the machine). Repair round 1:
// the bridge hop goes to a loopback STUB bridge started by this harness (scripted replies, a synthetic signing secret on the
// app server). The stub proves the PLUMBING — dispatch recorded before send, the reply bound to its turn, the deterministic
// gate overruling a gullible assistant, the semantic review bound to the sentence — and is NOT evidence of the live assistant's
// behaviour; live conversational acceptance is a separate human/Nabu run against the real bridge.
//
//   AUTH_SECRET=<server secret> node scripts/verify-learning-visit5.mjs --base http://127.0.0.1:3182 \
//       --out <dir> --db /tmp/<fixture>/nabu.db [--cap-base http://127.0.0.1:3183]
//
// The fixture is built through the child API (deletion through the owner route, then every visit's ops) and the stored row is
// stripped to the released version-3 shape once (short-lived connection while the server is idle). No child record is used.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";
import http from "node:http";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const require = createRequire(import.meta.url);
const { createClient } = require("@libsql/client");
const BASE = opt("--base", "http://127.0.0.1:3182").replace(/\/$/, "");
const CAP_BASE = opt("--cap-base", null);
const OUT = opt("--out", "/tmp/family-learning-visit5");
const DB = opt("--db", null);
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32 || !DB) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) and --db are required");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";

// ---------------------------------------------------------------------------
// The loopback STUB bridge (never the real one): scripted replies by mode; every call recorded for provenance checks.
// ---------------------------------------------------------------------------
const STUB_PORT = Number(opt("--stub-port", "3190"));
/** --ordinary (UI pass 2026-10-11): ONLY the ordinary learner journey, content, reporting and visuals. Skips every receipt/replay/
 *  binding/forgery probe (R2-01/02, R5-01/02/06, IV5-02/03/12 at the API, the unsigned free question, the '10 Metal stake' unverified
 *  path). Those probes belong to the interrupted independent security review and are NOT re-run in this lane; the earlier full runs
 *  are kept as builder regression evidence only. */
const ORDINARY = process.argv.includes("--ordinary");
/** --d3-only (round 4): targeted rendered reproduction of the deferred report wording fixtures only (S1/S2 and the rest of S3 skipped). */
const D3_ONLY = process.argv.includes("--d3-only");
const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;
const stub = { reasoning: "honest", writing: "ok", down: false, sign: true, calls: [] };
const STUB_SECRET = process.env.FAMILY_BRIDGE_TOKEN_SECRET_STUB || "fable-visit5-stub-bridge-secret-0123456789abcdef";
import { createHmac, createHash } from "node:crypto";
/** The reviewed clarification prompt P2 as served (read from the mirrored content, never hardcoded: P2 was revised on 2026-10-11). */
const BANK_P2 = JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v4.json", import.meta.url), "utf8")).reasoning.prompts.find((x) => x.id === "P2").text;
import { fileURLToPath } from "node:url";
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createChildTurnClient } = await import(path.join(APP_ROOT, "src/lib/family-assistant-client.ts"));
const { envelopeRawText } = await import(path.join(APP_ROOT, "src/lib/family-assistant-turn.ts"));
const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
/** The receipt the real bridge will sign (same construction; the stub holds the same synthetic secret as the app server). */
function stubReceipt({ sub, sid, key, message, text }) {
  // v2 receipt: the FIXTURE's run metadata (a stub, honestly named) travels authenticated, as the real executor's would (R4-06)
  const claims = { v: 2, iss: "family-child-bridge", sub, sid, key, req: sha(message), res: sha(text), iat: Math.floor(Date.now() / 1000), mdl: "fixture/stub-nabu", run: `stub-run-${stubN}` };
  const json = "{" + ["v", "iss", "sub", "sid", "key", "req", "res", "iat", "mdl", "run"].map((k) => JSON.stringify(k) + ":" + JSON.stringify(claims[k])).join(",") + "}";
  const payload = b64u(Buffer.from(json, "utf8"));
  return "fcr1." + payload + "." + b64u(createHmac("sha256", STUB_SECRET).update("fcr1." + payload).digest());
}
/** Decode the child's turns from the dispatch (the stub's "reading" of the child; a real assistant reads them itself). */
function childTurnsOf(message) {
  const hist = [...message.matchAll(/^Kind \((?:getippt|gesprochen)\): „(.*)“$/gm)].map((m) => m[1]);
  const last = message.slice(message.indexOf("Letzte Antwort des Kindes:") + "Letzte Antwort des Kindes:".length).trim();
  return [...hist, last];
}
const NUM = { eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, sechsunddreissig: 36, achtunddreissig: 38, zweiundvierzig: 42 };
const norm = (t) => t.toLowerCase().replace(/[a-zäöü]+/g, (w) => (NUM[w] !== undefined ? String(NUM[w]) : w));
/**
 * A plausible structured reading of the child's words (what a competent assistant would write), round 3: every relation
 * CITED verbatim from the child's own text («…»). The stub cites the exact span it read the relation from.
 */
function readChild(texts) {
  const read = (src) => {
    const low = src.toLowerCase();
    const terms = [];
    let method = "keine";
    for (const m of low.matchAll(/(\d+)\s*mal\s*(\d+)(?:\s*(?:ist|sind|=)\s*(\d+))?/g)) { terms.push([`${m[1]}x${m[2]}=${Number(m[1]) * Number(m[2])}`, src.slice(m.index, m.index + m[0].length)]); method = "malnehmen"; }
    for (const m of low.matchAll(/(\d+)\s*minus\s*(\d+)(?:\s*(?:ist|sind|=)\s*(\d+))?/g)) { terms.push([`${m[1]}-${m[2]}=${Number(m[1]) - Number(m[2])}`, src.slice(m.index, m.index + m[0].length)]); if (method === "keine") method = "abziehen"; }
    for (const m of low.matchAll(/(\d+)\s*(?:geteilt durch|durch)\s*(\d+)(?:\s*(?:ist|=)\s*(\d+))?(?:\s*rest\s*(\d+))?/g)) { terms.push([`${m[1]}:${m[2]}=${Math.floor(Number(m[1]) / Number(m[2]))}R${Number(m[1]) % Number(m[2])}`, src.slice(m.index, m.index + m[0].length)]); method = "teilen"; }
    const full = low.match(/(\d+)\s*(?:volle\s+)?boote?(?:\s+voll)?/);
    const rest = low.match(/(\d+)\s*(?:kisten\s*)?(?:bleiben\s+|sind\s+)?übrig/);
    return { terms, method, full: full ? [Number(full[1]), src.slice(full.index, full.index + full[0].length)] : null, rest: rest ? [Number(rest[1]), src.slice(rest.index, rest.index + rest[0].length)] : null };
  };
  // A competent reader takes the LATEST explanation; earlier turns only fill gaps.
  const latest = read(texts[texts.length - 1]);
  const earlier = texts.slice(0, -1).map(read);
  const fromEarlier = (k) => earlier.map((e) => e[k]).reverse().find(Boolean) ?? null;
  const terms = latest.terms.length ? latest.terms : fromEarlier("terms") ?? [];
  const method = latest.terms.length ? latest.method : earlier.map((e) => e.method).reverse().find((m) => m !== "keine") ?? "keine";
  return { method, terms, full: latest.full ?? fromEarlier("full"), rest: latest.rest ?? fromEarlier("rest") };
}
/** The reset schema v5 (seven lines): per criterion a level with «passages» and a rationale. */
const crit = (level, passages, why) => `${level}${passages.length ? " " + passages.map((p) => `«${p}»`).join(" ") : ""} | ${why}`;
const schema = (r) => [`ANTWORT: ${r.answer ?? "Danke — ich verstehe deinen Weg."}`, `ART: ${r.kind ?? "abschluss"}`, `PROMPT: ${r.prompt ?? "-"}`, `RECHENWEG: ${r.s ?? crit("unsicher", [], "noch offen")}`, `MENGEN: ${r.q ?? crit("unsicher", [], "noch offen")}`, `BEDEUTUNG: ${r.m ?? crit("unsicher", [], "noch offen")}`, `WIDERSPRUCH: ${r.w ?? "-"}`].join("\n");
const SEMANTIC_OK = "INHALT: ja; der Satz nennt die beladenen Boote\nGANZER_SATZ: ja\nUNKLARE_WOERTER: -\nSATZBAU: -\nFRAGE: -";
const SEMANTIC_METAL = "INHALT: nein; kein deutscher Satz über den Hafen\nGANZER_SATZ: nein\nUNKLARE_WOERTER: Metal, stake\nSATZBAU: -\nFRAGE: Was hast du mit den Pfählen gemacht?";
function stubReply(message) {
  if (/Gespräch über den Rechenweg/.test(message)) {
    const turns = childTurnsOf(message);
    const reading = readChild(turns);
    const lastTurn = turns[turns.length - 1];
    const hints = message.slice(message.indexOf("Hinweise des Lernsystems"), message.indexOf("Bisheriges Gespräch"));
    const clarificationsLeft = (hints.match(/noch (\d) Klärungsfrage/) ?? [null, "0"])[1] !== "0";
    const used = stub.calls.filter((c) => c.kind === "reasoning" && c.prompt).length;
    // the GULLIBLE assistant closes at once with "everything demonstrated", citing the child's whole last turn (contract containment: stored as NABU'S assessment, never a deterministic verdict)
    if (stub.reasoning === "gullible") return { kind: "reasoning", text: schema({ answer: "Super, das stimmt genau so!", kind: "abschluss", s: crit("gezeigt", [lastTurn], "alles da"), q: crit("gezeigt", [lastTurn], "alles da"), m: crit("gezeigt", [lastTurn], "alles da") }) };
    if (stub.reasoning === "prober") return { kind: "reasoning", text: schema({ answer: "Erzähl mir mehr.", kind: "klaerung", prompt: "P1" }), prompt: "P1" };
    if (stub.reasoning === "teacher") return { kind: "reasoning", text: schema({ answer: "Rechne 6 mal 6, das sind 36; 38 minus 36 sind 2.", kind: "lehre", s: crit("noch-nicht", [], "nichts gesagt"), q: crit("noch-nicht", [], "nichts gesagt"), m: crit("noch-nicht", [], "nichts gesagt") }) };
    if (stub.reasoning === "legacy") return { kind: "reasoning", text: "Danke — ich verstehe deinen Weg. [[NABU-URTEIL: erklaert]]" };
    // HONEST: assesses from its reading of the child's words; clarifies from the bank while allowed; closes when the reading is complete; otherwise teaches (supported)
    const complete = reading.method !== "keine" && reading.full !== null && reading.rest !== null;
    const strategyPassage = reading.terms.length ? reading.terms[0][1] : null;
    if (complete) return { kind: "reasoning", text: schema({ answer: "Danke — ich verstehe deinen Weg, so hast du es gerechnet.", kind: "abschluss", s: crit("gezeigt", [strategyPassage], "Rechnung genannt"), q: crit("gezeigt", [reading.full[1], reading.rest[1]], "volle Boote und Rest verbunden"), m: crit("gezeigt", [reading.full[1]], "Boote benannt"), w: /Rechnung stimmt nicht und wurde nicht korrigiert: „([^“]+)“/.test(hints) ? hints.match(/Rechnung stimmt nicht und wurde nicht korrigiert: „([^“]+)“/)[1] : "-" }) };
    if (clarificationsLeft) { const prompt = used % 2 === 0 ? "P1" : "P2"; return { kind: "reasoning", text: schema({ answer: "Erzähl mir mehr.", kind: "klaerung", prompt, s: strategyPassage ? crit("teilweise", [strategyPassage], "Rechnung genannt, Weg unklar") : crit("unsicher", [], "nichts Konkretes"), q: reading.rest ? crit("teilweise", [reading.rest[1]], "Rest genannt") : crit("noch-nicht", [], "kein Rest"), m: crit("unsicher", [], "Bedeutung offen") }), prompt }; }
    return { kind: "reasoning", text: schema({ answer: "Schau: 6 Boote mal 6 Kisten sind 36, und 38 minus 36 sind 2 übrig.", kind: "lehre", s: crit("noch-nicht", [], "kein eigener Weg"), q: crit("noch-nicht", [], "nicht verbunden"), m: crit("noch-nicht", [], "nicht benannt") }) };
  }
  if (/Prüfung eines Satzes/.test(message)) return { kind: "writing", text: stub.writing === "metal" ? SEMANTIC_METAL : stub.writing === "partial" ? "INHALT: ja" : SEMANTIC_OK };
  return { kind: "free", text: "Ich bin der Stub-Nabu. Frag mich zur Aufgabe." };
}
let stubN = 0;
const stubServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.url === "/__mode") {
      Object.assign(stub, JSON.parse(raw || "{}"));
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stub));
    }
    if (req.url !== "/v1/child-turn") return res.writeHead(404).end();
    const body = JSON.parse(raw || "{}");
    const auth = String(req.headers.authorization ?? "");
    const reply = stubReply(String(body.message ?? ""));
    stub.calls.push({ message: String(body.message ?? "").slice(0, 4000), idempotencyKey: String(body.idempotencyKey ?? ""), length: String(body.message ?? "").length, kind: reply.kind, prompt: reply.prompt ?? null, mode: reply.kind === "reasoning" ? stub.reasoning : stub.writing, bearerShape: /^Bearer fct1\./.test(auth), history: /Bisheriges Gespräch/.test(String(body.message)), findings: /Hinweise des Lernsystems/.test(String(body.message)), rules: /Jeder passende Weg zählt/.test(String(body.message)), bank: /Klärungsfragen \(Liste\)/.test(String(body.message)), criteria: /Kriterien:/.test(String(body.message)), fields: Object.keys(body).sort().join(","), tagInChildText: /Letzte Antwort des Kindes:[^]*\[\[/.test(String(body.message)) });
    stubN += 1;
    stub.hits = (stub.hits ?? 0) + 1;
    if (stub.down) return res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ v: 1, status: "error", child: "santiago", blocks: [], meta: { requestId: `stub-${stubN}` }, error: { code: "unavailable", message: "stub down", retryable: true } }));
    // sign: true → a real-shape receipt over the EXACT message and reply bytes; "malformed" → a present but unusable receipt (R2-01); false → none
    const receipt = stub.sign === "malformed" ? "garbage-not-a-receipt" : stub.sign ? stubReceipt({ sub: "santiago", sid: "learn", key: String(body.idempotencyKey ?? ""), message: String(body.message ?? ""), text: reply.text }) : undefined;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ v: 1, status: "ok", child: "santiago", blocks: [{ type: "text", text: reply.text }], meta: { requestId: `stub-${stubN}`, ...(receipt ? { receipt } : {}) } }));
  });
});
await new Promise((r) => stubServer.listen(STUB_PORT, "127.0.0.1", r));
const setStub = (patch) => Object.assign(stub, patch);
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", "[visit5]", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
}
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
async function api(method, url, body, cookie = assistant, bearer, base = BASE) {
  const r = await fetch(base + url, { method, redirect: "manual", headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}
/** Mint a child learning session. The production route admits 30 mints per child per minute (anti-abuse); every child page load mints
 *  one too, so a fast lane can fill the window — then wait for it to roll instead of carrying on without a credential. */
const mintWaits = [];
async function mintChild(childId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const r = await api("POST", "/api/family/learning/session", { childId });
    if (r.json?.token) return r.json.token;
    if (r.status !== 429) throw new Error(`child session mint for ${childId}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    mintWaits.push({ childId, at: new Date().toISOString(), attempt });
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`child session mint for ${childId}: the mint window did not roll within 80 s`);
}
let bearer = await mintChild("santiago").catch(() => null);
if (!bearer) {
  console.error("could not mint a child session; is the server up with the same AUTH_SECRET?");
  process.exit(2);
}
const TZ = "Europe/Zurich";
const view = async () => {
  const r = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, bearer);
  if (!r.json || !r.json.view) throw new Error(`mission read without a view: ${r.status} ${JSON.stringify(r.json).slice(0, 300)} (bearer ${bearer ? "set" : "MISSING"})`);
  return r.json.view;
};
let opN = 0;
const contextOf = (v) => ({ erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null });
async function opRaw(o, key) {
  const v = await view();
  return api("PUT", "/api/family/learning/mission", { op: o, expectedRevision: v.revision, idempotencyKey: key, context: contextOf(v), tz: TZ }, assistant, bearer);
}
async function op(o, key = `v5j-${(opN += 1)}`) {
  const r = await opRaw(o, key);
  if (r.status !== 200 || (r.json.status !== "applied" && r.json.status !== "replayed")) throw new Error(`op ${o.op}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
async function ack() {
  const v = await view();
  if (v.lastLesson) await op({ op: "lesson-feedback-seen", id: v.lastLesson.id });
}
async function setLayout(layout) {
  const current = await api("GET", "/api/family/learning/parent/settings?child=santiago", null, owner);
  return (await api("PUT", "/api/family/learning/parent/settings", { child: "santiago", expectedErasureGeneration: current.json.erasureGeneration, keyboardLayout: layout }, owner)).status;
}
const evidence = async () => (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json;
const lang = (segmentId, stepId, response, modality = "typed") => ({ op: "language-step", segmentId, stepId, response, modality });
const CH = ["'", "ö", "z"];

/** Erase the child (owner route) and rebuild four finished visits through the child API (acknowledging each lesson end). */
async function fourVisitsDone() {
  await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  bearer = await mintChild("santiago");
  for (const o of [{ op: "start-visit" }, { op: "name-base", name: "Fixture Basis" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "explain", text: "Ich habe geteilt.", modality: "typed" });
  await op({ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" });
  await op({ op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Fixture Basis", seconds: 20 });
  await ack();
  await op({ op: "save-log", text: "Tag eins." });
  await op({ op: "reflect", optionId: "easy" });
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" });
  await op({ op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 });
  await ack();
  await op({ op: "save-log", text: "Der Garten ist fertig." });
  await op({ op: "reflect", optionId: "easy" });
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "choose-station", theme: "turtles" });
  if ((await setLayout("ch-de-qwertz")) !== 200) throw new Error("layout");
  await op({ op: "typing-check", observed: CH });
  for (let i = 0; i < 2; i += 1) {
    await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" });
    await ack();
  }
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  for (const o of [{ op: "explain", text: "Fünf mal sechs sind dreissig.", modality: "typed" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")]) await op(o);
  await ack();
  for (const o of [{ op: "build-station", spot: "beach" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }, { op: "write-transfer", text: "Morgen zählen wir 3 Schildkröten.", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy" });
  // Besuch 4: the pier chapter; the typing course advances through lessons 2 and 3 (two good rounds each) and ends with ONE good
  // round on lesson 4 (a/ö) — the real-shape baseline: saved at lesson 4, one burst, no decision to advance yet.
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  for (const [lessonId, lines, rounds] of [["TYPE-CH-COURSE-2", ["ddd kkk", "fdk jkd"], 2], ["TYPE-CH-COURSE-3", ["sss lll", "sdf jkl"], 2], ["TYPE-CH-COURSE-4", ["aaa ööö", "asdf jklö"], 1]]) {
    for (let i = 0; i < rounds; i += 1) {
      await op({ op: "typing-burst", lessonId, lines, seconds: 15, comfort: "ok" });
      await ack();
    }
  }
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" });
  await ack();
  for (const o of [{ op: "explain", text: "Sechs mal sieben ist 42, drei bleiben.", modality: "typed" }, lang("LANG-EN-PIER", "listen", "", "listen"), lang("LANG-EN-PIER", "pick", "wood", "word-choice"), lang("LANG-EN-PIER", "produce", "we need wood"), lang("LANG-EN-PIER", "reuse", "rope", "word-choice")]) await op(o);
  await ack();
  for (const o of [{ op: "build-pier", spot: "bay" }, { op: "save-log", text: "Heute steht der Steg in der Bucht." }, { op: "revise-log", text: "Heute steht der Steg in der Bucht." }, { op: "write-transfer", text: "Morgen bringt das Boot 5 Kisten.", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy" });
}

/** The raw stored row (storage boundary). */
async function rawRow() {
  const c = createClient({ url: "file:" + DB });
  try {
    const row = (await c.execute("SELECT state_json, content_version FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
    return { state: JSON.parse(String(row.state_json)), contentVersion: Number(row.content_version) };
  } finally {
    c.close();
  }
}
async function patchRow(mutate) {
  const c = createClient({ url: "file:" + DB });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const row = (await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
      const state = JSON.parse(String(row.state_json));
      const next = mutate(state) ?? state;
      await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, content_version = ? WHERE child_id = 'santiago'", args: [JSON.stringify(next), next.contentVersion] });
      break;
    } catch (e) {
      if (!/SQLITE_BUSY/.test(String(e)) || attempt >= 50) throw e;
      await settle(100);
    }
  }
  c.close();
}
/** Four finished visits, then the row stripped to the released version-3 shape (no harbor/reasoning/logReviews keys, version 3). */
async function productionShape() {
  await fourVisitsDone();
  await patchRow((s) => {
    delete s.harbor;
    delete s.reasoning;
    delete s.logReviews;
    delete s.logReviewSemantics;
    s.contentVersion = 3;
    return s;
  });
}
async function capApi(p) {
  const r = await fetch(CAP_BASE + p, { redirect: "manual", headers: { cookie: `${COOKIE}=${assistant}`, authorization: "Bearer " + bearer } });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function makeContext(options) {
  const c = await browser.newContext(options);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE && u.origin !== STUB_ORIGIN) return r.abort("blockedbyclient");
    // The child TTS route and the transcription route never leave the machine in this harness; the bridge hop goes to the loopback stub.
    if (u.origin === BASE && /\/api\/family\/(assistant\/tts|transcribe)/.test(u.pathname)) return r.abort("blockedbyclient");
    return r.continue();
  });
  return c;
}
const desktop = await makeContext({ viewport: { width: 1280, height: 900 } });
await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
const tablet = await makeContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false, reducedMotion: "reduce" });
await tablet.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
const p = await desktop.newPage();
p.setDefaultTimeout(15000);
const t = await tablet.newPage();
t.setDefaultTimeout(15000);
const pageErrors = [];
for (const pg of [p, t]) pg.on("pageerror", (e) => pageErrors.push(String(e)));
const shots = [];
const shot = async (page, name, { full = false } = {}) => {
  const file = `visit5-${name}${page === t ? "-tablet" : ""}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: full });
  fs.writeFileSync(path.join(OUT, file.replace(/\.png$/, ".txt")), await page.locator("body").innerText());
  shots.push(file);
};
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const tid = (id, page = p) => page.getByTestId(id);
const body = async (page = p) => page.locator("body").innerText();
async function activeTestId(page = p) {
  for (let i = 0; i < 12; i += 1) {
    const id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? (document.activeElement && document.activeElement !== document.body ? document.activeElement.tagName : null));
    if (id) return id;
    await settle(50);
  }
  return page.evaluate(() => document.activeElement?.tagName ?? null);
}
/** Wait (bounded) until the deliberate focus landed on the given control; returns the active test id. */
async function waitActive(testId, page = p, ms = 3000) {
  const until = Date.now() + ms;
  let id = await activeTestId(page);
  while (id !== testId && Date.now() < until) {
    await settle(100);
    id = await activeTestId(page);
  }
  return id;
}
async function enterOn(testId, page = p) {
  for (let i = 0; i < 24; i += 1) {
    if ((await activeTestId(page)) === testId) break;
    await settle(50);
  }
  await page.keyboard.press("Enter");
}
const opens = [];
async function paceMint() {
  const now = Date.now();
  while (opens.length && now - opens[0] > 61_000) opens.shift();
  if (opens.length >= 27) {
    await new Promise((r) => setTimeout(r, 61_000 - (now - opens[0]) + 200));
    opens.length = 0;
  }
  opens.push(Date.now());
}
async function goto(page, url) {
  await paceMint();
  await page.goto(BASE + url);
  await page.waitForLoadState("load");
  await settle(500);
}
async function typeLine(page, selectorTestId, text) {
  const input = tid(selectorTestId, page);
  await input.waitFor();
  const active = await activeTestId(page);
  check(`focus: ${selectorTestId} is the active element before typing ("${text}")`, active === selectorTestId, active);
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press("Enter");
}
async function guarded(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(`harness: ${name} ran without an uncaught error (${String(error && error.stack ? error.stack : error).split("\n")[0]})`, false, String(error && error.stack ? error.stack : error).slice(0, 900));
    try {
      await p.screenshot({ path: path.join(OUT, `visit5-FAILURE-${name}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `visit5-FAILURE-${name}.txt`), await p.locator("body").innerText());
    } catch {
      /* ignore */
    }
  }
}
const worldAttr = (page, name) => (name === "data-world-next" || name === "data-world-running" ? tid("world-screen", page) : page.locator("[data-testid='world-screen'] [data-island-variant='full']").first()).getAttribute(name);
const siteState = (page, visit) => page.locator(`[data-part='site'][data-visit='${visit}']`).first().getAttribute("data-state");
const avatarAt = (page = p) => page.locator("[data-testid='island-stage-frame'] [data-island-variant]").first().getAttribute("data-avatar-at");

/** ID03/ID22 (2026-10-11): portrait-map audit on the tablet page `t` — whole island contained, flags inside and tappable, labels readable. */
const portraitMapAudit = async (label, flagIds) => {
  const vw = t.viewportSize();
  const framing = await t.locator("[data-island-variant='full']").getAttribute("data-island-framing");
  const flags = [];
  for (const id of flagIds) { const b = await tid(`world-site-${id}`, t).boundingBox(); flags.push({ id, box: b, inside: !!(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vw.width && b.y + b.height <= vw.height) }); }
  const chips = await t.locator("[data-testid^='island-label-']").evaluateAll((ns, w) => ns.map((n) => { const r = n.getBoundingClientRect(); return { id: n.getAttribute("data-testid"), inside: r.left >= 0 && r.right <= w, font: parseFloat(getComputedStyle(n).fontSize) }; }), vw.width);
  const office = chips.find((c) => c.id === "island-label-office");
  // every completed flag opens its report by TAP (touch emulation) and the report closes again
  const tapped = [];
  for (const id of flagIds) {
    const done = (await tid(`world-site-${id}`, t).locator("[data-part='site']").getAttribute("data-state")) === "done";
    if (!done) continue;
    await tid(`world-site-${id}`, t).tap({ timeout: 4000 }).catch((e) => tapped.push({ id, error: String(e).slice(0, 80) }));
    const opened = await tid("visit-report", t).waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
    const visit = opened ? await tid("visit-report", t).getAttribute("data-report-visit") : null;
    tapped.push({ id, opened, visit });
    if (opened) { await t.getByRole("button", { name: /Zur Karte/ }).first().click().catch(() => {}); await settle(300); }
  }
  const doneCount = flags.length ? tapped.filter((x) => x.opened).length : 0;
  const expectedDone = tapped.filter((x) => "opened" in x).length;
  await t.locator("[data-testid='island-labels-toggle']").click();
  await settle(300);
  const captions = await t.locator("[data-testid='island-svg'] text").evaluateAll((ns, w) => ns.map((n) => { const r = n.getBoundingClientRect(); return { t: n.textContent?.trim(), inside: r.left >= 0 && r.right <= w && r.width > 0 }; }).filter((c) => /Besuch|Vorräte|Logbuch|Garten|Basis|Wörterbuch/.test(c.t ?? "")), vw.width);
  await shot(t, `map-${label}-all-signs`);
  await t.locator("[data-testid='island-labels-toggle']").click();
  await settle(200);
  check(`ID03/ID22 portrait map (${label}, 820 × 1180): the map CONTAINS the whole island (framing contain); every flag (${flagIds.join(", ")}) lies inside the viewport, every completed flag opens its report by tap; the office label is visible at 14 px; in all-signs mode every caption is inside the viewport`, framing === "contain" && flags.every((f) => f.inside) && doneCount === expectedDone && expectedDone >= 1 && !!office && office.inside && office.font >= 13 && captions.length >= 4 && captions.every((c) => c.inside), { framing, flags, chips, tapped, captions: captions.map((c) => [c.t, c.inside]) });
};

// ---------------------------------------------------------------------------
// S1 — progression: the one next action from the completed-four-visits (version-3) shape; the island on the map; the cap
// ---------------------------------------------------------------------------
/** The saved-explain / deferred-report fixtures (D1 + D3): run inside S3 in the ordinary lane, or alone with --d3-only. */
async function d3Fixtures() {
  setStub({ down: true });

    // --- D1 (scope reduction): a SAVED explain stage, built by the accepted state machine with the rule switched OFF in this harness process
    //     (the r2 behaviour; the server keeps the production rule), then opened on this candidate. Two fixtures: (a) explain active with one
    //     captured child turn and a pending dispatch; (b) explain active with no conversation yet (the independent reviewer's exact case).
    const smod = await import("../src/lib/family-learning-state.ts");
    const cmod = await import("../src/lib/family-learning-content.ts");
    const dmod = await import("../src/lib/family-learning-deferral.ts");
    const fmod = await import("../src/lib/family-learning-feedback.ts");
    const contentV4 = cmod.asLearningContent(JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v4.json", import.meta.url), "utf8")));
    let tL = Date.now(); let nL = 0;
    const envL = { content: contentV4, settings: { ...smod.EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz" }, now: () => new Date((tL += 30_000)), newId: () => `legacy-${(nL += 1)}` };
    const runL = (st, ops) => { let s = st; for (const o of ops) { s = smod.ensureItemShown(s, contentV4, envL.now()).state; s = smod.applyLearningOp(s, o, envL).state; } return smod.ensureItemShown(s, contentV4, envL.now()).state; };
    const ackL = (st) => { const pend = fmod.lastLessonFeedback(st, contentV4); return pend ? runL(st, [{ op: "lesson-feedback-seen", id: pend.id }]) : st; };
    const legacyFixture = async (withTurn, withAssessment = false, withRetraction = false) => {
      // the desktop page must not poll the mission API while the child is erased and rebuilt (a read during the erasure window returns no view)
      await p.goto("about:blank");
      await productionShape();
      await op({ op: "start-visit" });
      await op({ op: "resume-base" });
      await op({ op: "enter-workplace", workplace: "planning" });
      dmod.setLiveTutorDeferredForTests(false);
      try {
        await patchRow((state) => {
          let s = runL(state, [{ op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6 voll, 2 übrig", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }]);
          s = ackL(s);
          if (withTurn) s = runL(s, [{ op: "reasoning-turn", text: "6 mal 6 ist 36 und 2 übrig", modality: "typed" }]);
          if (withAssessment) {
            // a VERIFIED closing assessment captured before the deferral (claims bound to the pending dispatch, as the mission route hands them to the op)
            const pend = s.reasoning["EQ-HARBOR"].pending;
            // a verified CLARIFICATION reply: assessment revision 1 stored, the conversation and the stage stay open (the partly assessed saved state)
            const text = schema({ answer: "Erzähl mir mehr.", kind: "klaerung", prompt: "P1", s: crit("unsicher", [], "noch offen"), q: crit("unsicher", [], "noch offen"), m: crit("unsicher", [], "noch offen") });
            s = runL(s, [{ op: "reasoning-reply", turnId: pend.turnId, ok: true, text, receipt: { sub: "santiago", sid: "learn", key: pend.turnId, req: pend.reqHash, res: sha(text), iat: 1 } }]);
            // round 4: an ordinary typed retraction after the assessment — the stored revision becomes stale, criteria read uncertain
            if (withRetraction) s = runL(s, [{ op: "reasoning-turn", text: "Nein, das stimmt nicht — das war nicht mein Weg.", modality: "typed" }]);
          }
          return s;
        });
      } finally {
        dmod.setLiveTutorDeferredForTests(null);
      }
    };
    for (const mode of ["turn", "none", "assessed", "retracted"]) {
      const withTurn = mode !== "none";
      const withAssessment = mode === "assessed" || mode === "retracted";
      await legacyFixture(withTurn, withAssessment, mode === "retracted");
      const saved = (await rawRow()).state;
      const savedVisit = saved.visits.find((v) => v.id === "v6");
      const savedReasoning = saved.reasoning?.["EQ-HARBOR"] ?? null;
      const attemptsBefore = JSON.stringify(saved.math["EQ-HARBOR"].attempts);
      const stageSaved = savedVisit.route[savedVisit.stageIndex];
      await goto(p, "/family/learn/mission?child=santiago");
      await tid("reasoning-deferred").waitFor({ timeout: 15000 });
      await settle(800);
      const viewSaved = await view();
      check(`D1 (saved explain stage, ${withTurn ? "with a captured turn and a pending dispatch" : "no conversation yet"}): the stored stage really is explain (${stageSaved}); opened on this candidate it shows the deferral card with Weiter — no live invitation, no sidebar opened by itself, no microphone, pending dispatch not sent, captured turn kept; zero calls`, stageSaved === "explain" && (savedReasoning && !withAssessment ? !!savedReasoning.pending : true) && (withAssessment ? savedReasoning?.status !== "done" && (savedReasoning.assessments?.length ?? 0) >= 1 : true) && viewSaved.visit?.stage === "explain" && viewSaved.reasoning?.deferred === true && viewSaved.reasoning?.pending === null && (await tid("reasoning-deferred").getAttribute("data-child-turns")) === (mode === "retracted" ? "2" : withTurn ? "1" : "0") && (await tid("reasoning-open").count()) === 0 && (await tid("stage-skip").count()) === 0 && (await tid("nabu-sidebar").count()) === 0 && (await tid("mic-start").count()) === 0 && (stub.hits ?? 0) === 0, { stageSaved, pending: savedReasoning?.pending ? "yes" : "none", childTurns: await tid("reasoning-deferred").getAttribute("data-child-turns"), hits: stub.hits ?? 0 });
      await tid("nabu-bubble").click();
      await tid("nabu-sidebar").waitFor();
      check(`D1 (bubble on the saved explain stage, ${withTurn ? "turn" : "no turn"}): the sidebar shows the deferral notice only — no input, no mic, no pending send`, (await tid("nabu-deferred").count()) === 1 && (await tid("nabu-input").count()) === 0 && (await tid("mic-start").count()) === 0 && (stub.hits ?? 0) === 0, await tid("nabu-sidebar").innerText());
      if (withTurn) await shot(p, "deferred-resume-explain-desktop");
      await tid("nabu-close").click().catch(() => {});
      await tid("reasoning-deferred-continue").click();
      await tid("keeper-supplier").waitFor({ timeout: 15000 });
      const after = (await rawRow()).state;
      const afterVisit = after.visits.find((v) => v.id === "v6");
      const afterReasoning = after.reasoning?.["EQ-HARBOR"] ?? null;
      check(`D1 (Weiter, ${withTurn ? "turn" : "no turn"}): the owner-deferred transition moves the visit to LANG-ES-HARBOR without a child skip or a failed answer; the deferral is recorded as such; ${withTurn ? "the captured turn is kept and the conversation closed with reason owner-deferred, method unscored (no new credit)" : "no reasoning state is invented"}; the numeric attempts are byte-identical; zero calls`, afterVisit.route[afterVisit.stageIndex] === "LANG-ES-HARBOR" && JSON.stringify(afterVisit.skippedStages) === JSON.stringify([{ stage: "explain", reason: "deferred" }]) && (withTurn ? !!afterReasoning && afterReasoning.status === "done" && afterReasoning.closeReason === "owner-deferred" && (withAssessment ? JSON.stringify(afterReasoning.assessments) === JSON.stringify(savedReasoning.assessments) : afterReasoning.method === "unscored") && afterReasoning.pending === null && afterReasoning.turns.filter((x) => x.role === "child").length === (mode === "retracted" ? 2 : 1) && afterReasoning.turns.filter((x) => x.role === "child")[0].text === savedReasoning.turns.filter((x) => x.role === "child")[0].text : !afterReasoning) && JSON.stringify(after.math["EQ-HARBOR"].attempts) === attemptsBefore && (stub.hits ?? 0) === 0, { stage: afterVisit.route[afterVisit.stageIndex], skipped: afterVisit.skippedStages, reasoning: afterReasoning && { status: afterReasoning.status, closeReason: afterReasoning.closeReason, method: afterReasoning.method, turns: afterReasoning.turns.length }, hits: stub.hits ?? 0 });
      // D3 (round 3): the child's Zwischenstand and the parent read the SAME thing about what was and was not assessed
      await tid("hud-stop").click();
      await tid("world-screen").waitFor();
      await p.getByRole("button", { name: "Zwischenstand" }).first().click();
      await tid("visit-report").waitFor();
      const scopeLine = (await tid("report-deferred-scope").innerText()).trim();
      const expectEarlier = withAssessment;
      const parentCtxD3 = await makeContext({ viewport: { width: 1280, height: 900 } });
      await parentCtxD3.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
      const ppD3 = await parentCtxD3.newPage();
      await goto(ppD3, "/family/learn/parent");
      await settle(800);
      // the visit is still RUNNING here: the parent's Rückblick lists completed visits only; the retained conversation and its
      // assessment (if any) are read on the Deutsch tab (reasoning transcript block), exactly where the independent reviewer looked
      await ppD3.locator("button[role='tab']", { hasText: "Deutsch" }).first().click();
      await settle(600);
      const rvD3 = await body(ppD3);
      const parentBlocks = await ppD3.locator("[data-testid='parent-reasoning']").count();
      await parentCtxD3.close();
      check(`D3 (${mode}): the child's Zwischenstand scope line is derived from the visit's own evidence — ${expectEarlier ? "the earlier verified assessment stands and no further one came today, content/sentence not assessed" : "reasoning, content and sentence structure not assessed"} — and the parent (Deutsch tab, running visit) shows the same: ${expectEarlier ? "the retained conversation WITH Nabu's assessment" : withTurn ? "the retained turn without any assessment" : "no conversation block at all"}; never 'not assessed' for something that was`, (expectEarlier ? /frühere Einschätzung im Bericht gespeichert/.test(scopeLine) && !/bestehen|gilt/.test(scopeLine) && /Inhalt und Satzbau wurden heute nicht beurteilt/.test(scopeLine) && !/Rechenweg, Inhalt und Satzbau wurden heute nicht beurteilt/.test(scopeLine) && parentBlocks >= 1 && /Nabus Einschätzung/.test(rvD3) && (mode !== "retracted" || (/unsicher/.test(rvD3) && afterReasoning.assessments[0].stale === true)) : scopeLine === "Rechenweg, Inhalt und Satzbau wurden heute nicht beurteilt." && (withTurn ? parentBlocks >= 1 && !/Nabus Einschätzung: (Rechenweg|gezeigt|teilweise)/.test(rvD3) : parentBlocks === 0)) && (await tid("report-deferred-scope").getAttribute("data-reasoning-earlier")) === (expectEarlier ? "true" : "false"), { scopeLine, parentBlocks, parentHasAssessment: /Nabus Einschätzung/.test(rvD3), stale: afterReasoning?.assessments?.[0]?.stale ?? null, parentUncertain: /unsicher/.test(rvD3) });
      if (withAssessment) await shot(p, mode === "retracted" ? "deferred-partial-report-retracted-desktop" : "deferred-partial-report-assessed-desktop");
      await p.getByRole("button", { name: /Zur Karte/ }).first().click().catch(() => {});
    }

}

await guarded("S1", async () => {
  if (D3_ONLY) return;
  await productionShape();
  const row0 = await rawRow();
  check("fixture: the stored row is the released shape (content version 3, four finished visits, no harbor/reasoning/logReviews keys) and the typing course is saved at lesson 4 (a/ö) after ONE good burst", row0.contentVersion === 3 && row0.state.visits.filter((v) => v.finishedAt).length === 4 && !("harbor" in row0.state) && !("reasoning" in row0.state) && row0.state.typing.course.lessonIndex === 3 && row0.state.typing.course.bursts.filter((b) => b.lessonId === "TYPE-CH-COURSE-4").length === 1, { visits: row0.state.visits.map((v) => v.id), lessonIndex: row0.state.typing.course.lessonIndex });
  const v = await view();
  check("F1/F2: exactly one next action — Besuch 5 (internal v6), available now; four reports; the wordbook and harbor are served", v.next.visit === "v6" && v.next.ordinal === 5 && v.next.availableAt === null && v.progress.next.kind === "start" && v.progress.next.label === "Besuch 5 — Der Hafen" && v.progress.completedTotal === 4 && v.reports.length === 4 && v.harbor !== null && v.wordbook !== null, v.next);
  const row1 = await rawRow();
  check("reads (migration on load) do not rewrite the stored row; repeated reads are identical", JSON.stringify(row1.state) === JSON.stringify(row0.state) && row1.contentVersion === 3 && JSON.stringify((await view()).next) === JSON.stringify(v.next));
  await goto(p, "/family/learn?child=santiago");
  await tid("world-screen").waitFor();
  await settle(600);
  const facts = { next: await worldAttr(p, "data-world-next"), v6: await siteState(p, "v6"), harbor: await worldAttr(p, "data-world-harbor"), keeper: await p.locator("[data-part='character-keeper']").count(), planner: await p.locator("[data-part='character-planner']").count(), supplier: await p.locator("[data-part='character-supplier']").count(), pier: await worldAttr(p, "data-world-pier"), station: await worldAttr(p, "data-world-station"), start: (await tid("cockpit-start").innerText()).trim() };
  check("F1 map: the island draws the saved base/station/pier AND the three workplaces with their keepers; Besuch 5 is flagged next; the one action says 'Besuch 5 starten'", facts.next === "v6" && facts.v6 === "next" && facts.harbor === "crates" && facts.keeper === 1 && facts.planner === 1 && facts.supplier === 1 && facts.pier === "built" && facts.station === "built" && /Besuch 5 starten/.test(facts.start), facts);
  check("F4 map: the Nabu bubble is present and Nabu opens as a pane bound to the map page", (await tid("nabu-bubble").count()) === 1);
  await tid("nabu-bubble").click();
  await tid("nabu-sidebar").waitFor();
  check("F4 map: without a running visit the sidebar is listen-only (no bridge question can be recorded as task help)", (await tid("nabu-sidebar").getAttribute("data-mode")) === "free" && (await tid("nabu-input").count()) === 0 && /nur zuhören/.test(await tid("nabu-sidebar").innerText()));
  await shot(p, "map-before-desktop");
  await p.keyboard.press("Escape");
  await tid("hud-wordbook").click();
  await tid("wordbook").waitFor();
  check("F3 wordbook: the words met so far are listed per language with picture, meaning and example — no status, count or rank", (await tid("wordbook-es").count()) === 1 && (await tid("wordbook-en").count()) === 1 && (await p.locator("[data-testid^='wordbook-word-']").count()) >= 5 && !/selbständig|%|Rang/.test(await tid("wordbook").innerText()));
  await shot(p, "wordbook-desktop");
  await p.keyboard.press("Escape");
  await goto(t, "/family/learn?child=santiago");
  await tid("world-screen", t).waitFor();
  await settle(600);
  await shot(t, "map-before");
  await portraitMapAudit("before", ["v1", "v2", "v4", "v5", "v6"]);
  if (CAP_BASE) {
    const capped = await capApi(`/api/family/learning/mission?tz=${TZ}`);
    check("rollback: the version-3 cap serves the same rows with 'all visits done' (no v6 offered), four reports, no harbor", capped.status === 200 && capped.json.view.next.reason === "all-visits-done" && capped.json.view.reports.length === 4 && capped.json.view.harbor === null, capped.json?.view?.next);
  }
  // sibling isolation — a privilege/isolation probe: NOT part of the ordinary lane (excluded, not-tested there)
  if (!ORDINARY) {
  const isabel = await mintChild("isabel");
  const iv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabel);
  const iput = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: 0, idempotencyKey: "isabel-1", context: { erasureGeneration: 0, visit: null } }, assistant, isabel);
  check("isolation: Isabel's credential sees no mission (prepared:false) and cannot mutate (404); the owner-only parent routes refuse the assistant account", iv.status === 200 && iv.json.prepared === false && iv.json.view === null && iput.status === 404 && (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, assistant)).status === 403);
  }
});

// ---------------------------------------------------------------------------
// S2 — the full journey in the browser (planning first, then typing, then the closing check), with renders and the storage boundary
// ---------------------------------------------------------------------------
await guarded("S2", async () => {
  if (D3_ONLY) return;
  // temporary Visit 5 scope reduction: the tutor endpoint is deliberately UNAVAILABLE for the whole journey (503 on any hit); every hit is counted
  setStub({ down: true });
  await productionShape();
  const row0 = await rawRow();
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("start-visit").waitFor();
  check("start: the start screen names the harbor chapter and the button says Besuch 5 starten", (await tid("start-visit").getAttribute("data-visit")) === "v6" && /Besuch 5 starten/.test(await tid("start-visit").innerText()) && /Hafen/.test(await body()));
  await enterOn("start-visit");
  await tid("stage-continue").waitFor();
  const row1 = await rawRow();
  check("compat: the first write migrates the row to version 4 with exactly the additive keys harbor/reasoning/logReviews/logReviewSemantics; history and the pilot upgrade date untouched", row1.contentVersion === 4 && JSON.stringify(Object.keys(row1.state).filter((k) => !(k in row0.state)).sort()) === '["harbor","logReviewSemantics","logReviews","reasoning"]' && JSON.stringify(row1.state.visits.slice(0, 4)) === JSON.stringify(row0.state.visits) && row1.state.upgradedAt === row0.state.upgradedAt && Array.isArray(row1.state.visits[4].route), Object.keys(row1.state).sort());
  check("restore: the chapter's story (who / make / done) in three beats; Weiter focused", (await p.locator("[data-testid='mission-intro'] [data-testid='story-beat-item']").count()) === 3 && /38 Kisten/.test(await body()) && (await activeTestId()) === "stage-continue");
  await p.keyboard.press("Enter");
  await tid("island-stage").waitFor();
  await settle(700);
  check("F1 island hub: both workplaces open, the closing check locked; direct-entry buttons present; the avatar stands on the quay; keyboard focus on the first direct button", (await tid("island-direct-typing").getAttribute("data-status")) === "open" && (await tid("island-direct-planning").getAttribute("data-status")) === "open" && (await tid("island-direct-closing").getAttribute("data-status")) === "locked" && (await tid("island-direct-closing").isDisabled()) && (await avatarAt()) === "harbor" && (await waitActive("island-direct-typing")) === "island-direct-typing");
  await shot(p, "island-hub-desktop");
  // --- UI pass 2026-10-11: focused labels as screen-space chips (fixed font size), no overlap, inside the stage; the folded captions return
  //     with the on-stage toggle (mouse AND keyboard), and nothing else moves.
  const chipAudit = async (page, viewport) => {
    const frame = await tid("island-stage-frame", page).boundingBox();
    const ids = ["workshop", "office", "harbormaster"];
    const boxes = [];
    for (const id of ids) {
      const el = tid(`island-label-${id}`, page);
      const box = await el.boundingBox();
      const font = await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
      const text = (await el.innerText()).trim();
      boxes.push({ id, box, font, text });
    }
    const inside = boxes.every((b) => b.box && frame && b.box.x >= frame.x - 1 && b.box.y >= frame.y - 1 && b.box.x + b.box.width <= frame.x + frame.width + 1 && b.box.y + b.box.height <= frame.y + frame.height + 1);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i].box, b = boxes[j].box; if (a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) overlaps.push(`${boxes[i].id}/${boxes[j].id}`); }
    const svgSigns = await page.locator("[data-testid='island-svg'] text").evaluateAll((ns) => ns.map((n) => n.textContent?.trim()).filter((t) => /Vorräte|Logbuch|Garten|Besuch [0-9]|Kisten warten|Wörterbuch|Basis$/.test(t ?? "")));
    const fontsOk = boxes.every((b) => b.font >= 13);
    const texts = boxes.map((b) => b.text.replace(/[✓▶→🔒↺]/g, "").trim());
    check(`labels (${viewport}): the three workplace labels are screen-space chips with a fixed ≥13 px font, inside the stage, not overlapping each other; the small in-stage captions (Vorräte/Logbuch/Garten/Besuch n/Kisten/Wörterbuch) are folded away by default`, fontsOk && inside && overlaps.length === 0 && texts.join("|") === "Tipp-Werkstatt|Planungsbüro|Hafenmeister" && svgSigns.length === 0 && (await tid("island-labels", page).getAttribute("data-labels")) === "focused", { boxes, overlaps, svgSigns, frame });
  };
  await chipAudit(p, "desktop");
  {
    // keyboard: Tab to the toggle, Enter — the folded captions come back; the walkable stage, the hotspots and the direct buttons are untouched
    const toggle = tid("island-labels-toggle");
    await toggle.focus();
    await p.keyboard.press("Enter");
    await settle(200);
    const allSigns = await p.locator("[data-testid='island-svg'] text").evaluateAll((ns) => ns.map((n) => n.textContent?.trim()).filter((t) => /Vorräte|Logbuch|Garten|Besuch [0-9]|Kisten warten|Wörterbuch/.test(t ?? "")));
    await shot(p, "island-hub-all-labels-desktop");
    check("labels toggle (keyboard): Enter on the focused 'Alle Schilder' button restores every in-stage caption (Vorräte, Logbuch, Garten, Besuch 1–4, Kisten warten am Kai, Wörterbuch), aria-pressed=true; the hotspots and direct buttons stay", (await toggle.getAttribute("aria-pressed")) === "true" && allSigns.length >= 8 && (await tid("island-labels").getAttribute("data-labels")) === "all" && (await tid("island-go-workshop").count()) === 1 && (await tid("island-direct-typing").count()) === 1, { allSigns });
    await toggle.click();
    await settle(200);
    check("labels toggle (tap): a second activation folds the captions away again", (await toggle.getAttribute("aria-pressed")) === "false" && (await tid("island-labels").getAttribute("data-labels")) === "focused");
  }
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("island-stage", t).waitFor();
  await settle(500);
  await shot(t, "island-hub");
  await chipAudit(t, "tablet");
  // click/tap: walk to the office and enter planning first
  await tid("island-go-office").click();
  await tid("island-arrived").waitFor({ timeout: 10000 });
  check("F1 walk: tapping the Planungsbüro walks the avatar there (path animation) and shows the arrival card with Herr Baumann's German line and 'Eintreten'", (await avatarAt()) === "office" && (await tid("island-arrived").getAttribute("data-place")) === "office" && (await tid("island-character").getAttribute("data-language")) === "de" && (await tid("island-enter-planning").count()) === 1 && (await waitActive("island-enter-planning")) === "island-enter-planning");
  {
    const ob = await p.locator("[data-plate='office']").boundingBox();
    const av = await p.locator("[data-part='avatar-anchor']").boundingBox();
    const ax = av ? av.x + av.width / 2 : null;
    check("office door (visual round 2): after the walk the avatar stands in front of the painted office DOOR (42–61 % of the plate width)", !!(ob && ax !== null && ax >= ob.x + ob.width * 0.42 && ax <= ob.x + ob.width * 0.61), { ob, ax });
    // art probe B2 (2026-10-11): the avatar is the painted child at its natural size (shorter than the painted adults), the keepers are painted
    const childPlate = await p.locator("[data-part='avatar-anchor'] [data-part='avatar'][data-painted='true'] image[data-plate='child']").boundingBox();
    const keeperPlate = await p.locator("[data-part='character-keeper'][data-painted='true'] image[data-plate='keeper']").boundingBox();
    const paintedKeepers = await p.locator("[data-part^='character-'][data-painted='true'] image[data-plate]").count();
    check("art probe B2: the avatar and the three keepers are painted plates (natural scale from one sheet: the child is shorter than Mrs Finley)", !!(childPlate && keeperPlate && childPlate.height < keeperPlate.height && childPlate.height > keeperPlate.height * 0.6) && paintedKeepers === 3, { child: childPlate && [childPlate.width, childPlate.height], keeper: keeperPlate && [keeperPlate.width, keeperPlate.height], paintedKeepers });
  }
  {
    // art probe B1: the painted shop's door (on the tablet hub, which is still at the hub): walk there when the shop is a walkable destination here
    const shopEnabled = (await tid("island-go-shop", t).count()) === 1 && (await tid("island-go-shop", t).getAttribute("data-enabled")) === "true";
    if (shopEnabled) {
      await tid("island-go-shop", t).click();
      await settle(2500);
      const sb = await t.locator("[data-plate='shop']").boundingBox();
      const av = await t.locator("[data-part='avatar-anchor']").boundingBox();
      const ax = av ? av.x + av.width / 2 : null;
      check("shop door (art probe B1): after the walk the avatar stands in front of the painted shop DOOR (42–61 % of the plate width)", !!(sb && ax !== null && ax >= sb.x + sb.width * 0.42 && ax <= sb.x + sb.width * 0.61), { sb, ax });
      await shot(t, "island-shop-arrival");
    } else {
      check("shop door (art probe B1): the shop is not a walkable destination at this hub state — door arrival NOT exercised here (recorded, not verified)", true, { shopEnabled });
    }
  }
  await shot(p, "island-arrived-desktop");
  await p.keyboard.press("Enter");
  await tid("math-question").waitFor();
  const routed = await rawRow();
  check("F1 route: planning first reorders the route (EQ-HARBOR right after the island, typing later), nothing done is touched", routed.state.visits[4].route.slice(1, 4).join(",") === "island,EQ-HARBOR,explain" && routed.state.visits[4].route.indexOf("typing-course") > routed.state.visits[4].route.indexOf("log") && JSON.stringify(routed.state.harbor.entered) === '["planning"]');
  check("F1 EQ-HARBOR: Herr Baumann's beat, the 38-Kisten setup, the two fields Volle Boote / Kisten übrig; the first field is focused; no generic microphone anywhere on the task", (await tid("keeper-planner").count()) === 1 && /38 Kisten/.test(await tid("math-setup").innerText()) && /Wie viele Boote werden voll/.test(await tid("math-question").innerText()) && (await tid("math-answer-full").count()) === 1 && (await waitActive("math-answer-full")) === "math-answer-full" && (await tid("mic-start").count()) === 0 && !/🎙️/.test(await p.locator("main").innerText()));
  await shot(p, "math-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("math-question", t).waitFor();
  await shot(t, "math");
  // --- temporary Visit 5 scope reduction: the free question is deferred on this visit — the bubble opens, says so in one line, offers no input, sends nothing
  await tid("nabu-bubble").click();
  await tid("nabu-sidebar").waitFor();
  check("scope reduction (free question on the task): the sidebar is in free mode, shows the plain deferral notice, has no input and no microphone, and no call leaves (stub hits 0, no tutor_question event)", (await tid("nabu-sidebar").getAttribute("data-mode")) === "free" && (await tid("nabu-deferred").count()) === 1 && (await tid("nabu-input").count()) === 0 && (await tid("mic-start").count()) === 0 && !/Was möchtest du wissen|Mikrofon/.test(await tid("nabu-sidebar").innerText()) && !/laut erklären kannst du unten rechts/.test(await body()) && (stub.hits ?? 0) === 0 && (await evidence()).supports.filter((x) => x.kind === "tutor_question").length === 0, await tid("nabu-sidebar").innerText());
  await shot(p, "deferred-free-question-desktop");
  await tid("nabu-close").click().catch(() => {});
  await tid("math-answer-full").click();
  await waitActive("math-answer-full");
  await p.keyboard.type("5");
  await p.keyboard.press("Tab");
  await p.keyboard.type("8");
  await p.keyboard.press("Enter");
  await tid("clarification").waitFor();
  const activeAfterClarify = await waitActive("math-answer-full");
  check("F2 EQ-HARBOR: a wrong part A gets the reviewed clarification (full boats first); the field is focused again", /Zähle die vollen Boote/.test(await tid("clarification").innerText()) && activeAfterClarify === "math-answer-full", activeAfterClarify);
  await p.keyboard.type("6");
  await p.keyboard.press("Tab");
  await p.keyboard.type("2");
  await p.keyboard.press("Enter");
  await tid("math-decision").waitFor();
  // --- D2 (scope reduction): Stopp after a correct part A → map → the bubble shows only the deferral notice (no input, no mic, no retry/"Frage sagen"); Continue resumes part B; zero calls
  await tid("hud-stop").click();
  await tid("world-screen").waitFor();
  await settle(400);
  await tid("nabu-bubble").click();
  await tid("nabu-sidebar").waitFor();
  const mapSidebarText = await tid("nabu-sidebar").innerText();
  check("D2 (map after Stopp, running deferred visit): the map bubble shows the plain deferral notice only — no input, no microphone, no 'Frage sagen', no retry invitation; no call left", (await tid("nabu-deferred").count()) === 1 && (await tid("nabu-input").count()) === 0 && (await tid("mic-start").count()) === 0 && !/Frage sagen|Was möchtest du wissen|Versuch es gleich nochmal|Mikrofon läuft/.test(mapSidebarText) && (stub.hits ?? 0) === 0, mapSidebarText);
  await shot(p, "deferred-map-bubble-desktop");
  await p.keyboard.press("Escape");
  await tid("cockpit-start").click();
  await tid("math-decision").waitFor();
  const resumedRow = (await rawRow()).state;
  check("D2 (Continue from the stopped map): the visit resumes at part B with part A intact (6 full, 2 remaining recorded), no input stuck, no call left", !!resumedRow.math?.["EQ-HARBOR"]?.quotientResult && resumedRow.math["EQ-HARBOR"].quotientResult.full === 6 && resumedRow.math["EQ-HARBOR"].quotientResult.remaining === 2 && (await tid("nabu-sidebar").count()) === 0 && (stub.hits ?? 0) === 0, { quotient: resumedRow.math?.["EQ-HARBOR"]?.quotientResult, hits: stub.hits ?? 0 });
  await waitActive("math-answer-needed");
  const activeB = await waitActive("math-answer-needed");
  check("F1 part B: after a correct part A the decision question (boats for ALL crates) appears with part A acknowledged; the needed field is focused", /Wie viele Boote braucht ihr dafür insgesamt/.test(await tid("math-question").innerText()) && /6 Boote voll, 2 Kisten übrig/.test(await tid("math-part-a").innerText()) && activeB === "math-answer-needed", activeB);
  await shot(p, "math-part-b-desktop");
  await p.keyboard.type("7");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  const afterMath = await evidence();
  const harborAttempts = afterMath.attempts.filter((a) => a.taskId === "EQ-HARBOR");
  check("F2 EQ-HARBOR evidence: three attempts — part A wrong, part A right (supported after the clarification), part B right on its first try but still 'supported' (help on the item is cumulative and conservative); the lesson end names the correction", harborAttempts.length === 3 && harborAttempts[0].correct === false && harborAttempts[1].evidence === "supported" && harborAttempts[2].correct === true && harborAttempts[2].evidence === "supported" && harborAttempts[2].objective === "quotient-groups-needed" && (await tid("lesson-end").getAttribute("data-close")) === "corrected-with-help", harborAttempts.map((a) => [a.objective, a.correct, a.evidence]));
  check("F4: the Nabu sidebar does NOT open over the lesson end (the conversation waits for the acknowledgement)", (await tid("nabu-sidebar").count()) === 0);
  await shot(p, "math-lesson-end-desktop");
  await enterOn("lesson-continue");
  // --- temporary Visit 5 scope reduction: the explain stage is DEFERRED — after the lesson end the visit goes straight to the supplier;
  //     no sidebar opens by itself, no microphone, no dialogue, no tutor call. The deferral is recorded as such (never "übersprungen").
  await tid("keeper-supplier").waitFor();
  const rowDeferred = (await rawRow()).state;
  const v6Deferred = rowDeferred.visits.find((v) => v.id === "v6");
  const evDeferred = await evidence();
  check("scope reduction (reasoning): after the harbor lesson end the visit continues at the supplier; the explain stage was passed by the server with reason 'deferred'; no reasoning state, no reasoning_turn/explanation sample, no tutor_question/tutor_reply event, no sidebar opened by itself, no microphone, zero stub hits", (await tid("reasoning-stage").count()) === 0 && (await tid("nabu-sidebar").count()) === 0 && (await tid("mic-start").count()) === 0 && !!v6Deferred?.skippedStages.some((s) => s.stage === "explain" && s.reason === "deferred") && !rowDeferred.reasoning?.["EQ-HARBOR"] && evDeferred.samples.filter((s) => s.visitId === "v6" && (s.kind === "reasoning_turn" || s.kind === "explanation")).length === 0 && evDeferred.supports.filter((s) => s.visitId === "v6" && (s.kind === "tutor_question" || s.kind === "tutor_reply")).length === 0 && (stub.hits ?? 0) === 0, { skipped: v6Deferred?.skippedStages, hits: stub.hits ?? 0 });
  // the Nabu bubble is still there; opening it shows the one plain notice and no input — nothing is sent
  await tid("nabu-bubble").click();
  await tid("nabu-sidebar").waitFor();
  check("scope reduction (bubble on the supplier stage): the sidebar shows the plain deferral notice, offers no input, no microphone and sends nothing", (await tid("nabu-deferred").count()) === 1 && (await tid("nabu-input").count()) === 0 && (await tid("mic-start").count()) === 0 && (stub.hits ?? 0) === 0, await tid("nabu-sidebar").innerText());
  await shot(p, "deferred-bubble-desktop");
  await tid("nabu-close").click().catch(() => {});
  await goto(t, "/family/learn/mission?child=santiago");
  await settle(600);
  await shot(t, "deferred-supplier");
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("keeper-supplier").waitFor();
  // Spanish supplier: Rosa's welcome in Spanish; the translation is recorded as help BEFORE it is shown
  check("F1 supplier: Rosa greets in Spanish (distinct keeper); the Spanish segment starts with her question; no microphone", (await tid("keeper-supplier").getAttribute("data-language")) === "es" && /Hola, capitán/.test(await tid("keeper-supplier").innerText()) && (await tid("language-continue-step").count()) === 1 && (await tid("mic-start").count()) === 0);
  await tid("character-translate").click();
  await tid("character-translation").waitFor();
  const glossEv = (await evidence()).supports.filter((s) => s.kind === "gloss" && s.payload?.word === "rosa-welcome");
  check("F3/F4 translation as help: 'Was heisst das?' records a gloss support on the segment before the German line is shown", glossEv.length === 1 && /Willkommen im Hafen/.test(await tid("character-translation").innerText()));
  await shot(p, "spanish-desktop");
  check("F4 focus: after the translation is shown, keyboard focus sits on the translation (never dropped to the page)", (await waitActive("character-translation")) === "character-translation");
  await tid("language-continue-step").click();
  await tid("language-input").waitFor();
  check("F3 recall before exposure: the produce step comes BEFORE any sentence shows herramientas; the word list is a help button (not opened)", /Necesitamos/.test(await body()) && (await tid("language-sentence").count()) === 0 && (await waitActive("language-input")) === "language-input");
  check("IV5-11: nothing on the recall screen shows the target word (no heading 'NECESITAMOS HERRAMIENTAS'); the HUD wordbook is marked as help during a recall step", !/herramientas/i.test(await body()) && (await tid("hud-wordbook").getAttribute("data-help")) === "true", (await body()).match(/.{0,40}herramientas.{0,40}/i)?.[0] ?? "clean");
  await p.keyboard.type("necesitamos herramientas");
  await p.keyboard.press("Enter");
  await tid("pick-cuerdas").waitFor({ timeout: 15000 });
  await tid("pick-cuerdas").click();
  await tid("pick-agua").waitFor();
  check("F3 recognition: cuerdas picked from the pictured supplies — delivered to the base (ropes for the boats)", ((await view()).base.supplies.cuerdas ?? 0) === 1);
  await tid("pick-agua").click();
  await tid("lesson-end").waitFor();
  const langEv = await evidence();
  check("F3 evidence: 'necesitamos herramientas' is independent phrase production (recall in a new context, translation help was on the segment and is recorded); cuerdas/agua recognised", langEv.attempts.some((a) => a.taskId === "LANG-ES-HARBOR/produce" && a.correct === true && a.objective === "language-es-production") && langEv.attempts.some((a) => a.taskId === "LANG-ES-HARBOR/pick" && a.correct === true) && langEv.attempts.some((a) => a.taskId === "LANG-ES-HARBOR/reuse" && a.correct === true), langEv.attempts.filter((a) => a.taskId.startsWith("LANG-ES-HARBOR")).map((a) => [a.taskId, a.evidence, a.support]));
  await enterOn("lesson-continue");
  await tid("harbor-plan").waitFor();
  check("F1 plan: the saved arithmetic (6 full, 2 left, 7 boats) and the three reviewed destinations; ropes acknowledged; first destination focused", /6 Boote sind voll, 2 Kisten bleiben übrig — 7 Boote fahren los/.test(await tid("harbor-plan-load").innerText()) && (await tid("harbor-destination-lighthouse").count()) === 1 && /Seilen von Rosa/.test(await body()) && (await waitActive("harbor-destination-lighthouse")) === "harbor-destination-lighthouse");
  await shot(p, "plan-desktop");
  await p.keyboard.press("Enter");
  await tid("log-input").waitFor();
  const afterPlan = await view();
  check("F1 world change: after the acknowledged plan the saved island has 6 loaded boats, the leftover crates, the destination and the ropes", afterPlan.scene.harbor.planned && afterPlan.scene.harbor.destination === "lighthouse" && afterPlan.scene.harbor.roped && afterPlan.scene.harbor.fullBoats === 6 && afterPlan.scene.harbor.remaining === 2, afterPlan.scene.harbor);
  check("F2 captain's log: Herr Baumann asks for one own sentence; the prompt names what was built or transported; the field is focused; no microphone", /Kapitänslogbuch/.test(await body()) && /gebaut oder transportiert/.test(await body()) && (await waitActive("log-input")) === "log-input" && (await tid("mic-start").count()) === 0);
  await p.reload();
  await p.waitForLoadState("load");
  await tid("log-input").waitFor();
  check("reload mid-visit resumes at the same stage (log) with the same route; the plan survived", (await view()).visit?.stage === "log" && (await view()).scene.harbor.planned === true);
  // filled, not keystroked: a dropped keystroke under load (continuation run 2) changed the token boundaries of the stored original
  await tid("log-input").fill("wir haben 6 bote beladen und 2 kisten sind übrig");
  await tid("log-save").click();
  await tid("island-stage").waitFor();
  await settle(600);
  check("F1 island after planning: the office is done, the workshop open, the closing check still locked; the avatar stands at the office", (await tid("island-direct-planning").getAttribute("data-status")) === "done" && (await tid("island-direct-typing").getAttribute("data-status")) === "open" && (await tid("island-direct-closing").getAttribute("data-status")) === "locked" && (await avatarAt()) === "office");
  await shot(p, "island-after-planning-desktop");
  // keyboard-only movement: focus the stage, ArrowLeft walks from the office to the workshop, Enter enters
  await p.focus("[data-testid='island-svg']");
  await p.keyboard.press("ArrowLeft");
  await settle(1400);
  await tid("island-arrived").waitFor();
  check("F1 keyboard: ArrowLeft from the office walks to the Tipp-Werkstatt; the arrival card shows Mrs Finley's English line and the enter control takes focus", (await avatarAt()) === "workshop" && (await tid("island-character").getAttribute("data-language")) === "en" && /Welcome back/.test(await tid("island-character").innerText()) && (await waitActive("island-enter-typing")) === "island-enter-typing");
  await shot(p, "island-workshop-arrival-desktop");
  // experience continuation (2026-10-11): the painted Tipp-Werkstatt plate is a mounted raster layer — it must actually load, and
  // the walk hit target must cover the whole plate box (the painted house is bigger than the vector one).
  {
    // visual round 2: every painted plate (workshop, office, shop) is a static asset, served, inside its hit target; keepers stand clear of the doors
    const plateAudit = [];
    // B3 (2026-10-12): the painted harbormaster kiosk joins the audit (static asset, served, hit target covers the plate box; no keeper rule)
    for (const id of ["office", "shop", "harbormaster"]) {
      const el = p.locator(`[data-plate='${id}']`);
      const href = (await el.count()) === 1 ? await el.getAttribute("href") : null;
      const res = href ? await p.request.get(new URL(href, BASE).toString()) : null;
      const box = (await el.count()) === 1 ? await el.boundingBox() : null;
      const hit = await p.locator(`[data-testid='island-go-${id}'] rect`).boundingBox();
      const cover = !!(box && hit && hit.x <= box.x + 1 && hit.y <= box.y + 1 && hit.x + hit.width >= box.x + box.width - 1 && hit.y + hit.height >= box.y + box.height - 1);
      const keeper = id === "harbormaster" ? null : await p.locator(`[data-part='character-${id === "office" ? "planner" : "supplier"}']`).boundingBox();
      const doorL = box ? box.x + box.width * 0.42 : 0, doorR = box ? box.x + box.width * 0.61 : 0;
      const keeperClear = id === "harbormaster" ? true : !!(keeper && box && (keeper.x + keeper.width <= doorL || keeper.x >= doorR));
      plateAudit.push({ id, href, status: res?.status(), png: res ? (await res.body()).subarray(0, 8).toString("hex") === "89504e470d0a1a0a" : false, cover, keeperClear, box, hit, keeper });
    }
    check("plates (visual round 2 + B3 kiosk): the painted office, shop and harbormaster kiosk are mounted as static assets (/_next/static, PNG bytes served), each hit target covers its plate box, and Herr Baumann / Rosa stand clear of the painted doors", plateAudit.every((a) => a.href && /^\/_next\/static\//.test(a.href) && a.status === 200 && a.png && a.cover && a.keeperClear), plateAudit);
    const plate = p.locator("[data-plate='workshop']");
    const plateHref = (await plate.count()) === 1 ? await plate.getAttribute("href") : null;
    const plateRes = plateHref ? await p.request.get(new URL(plateHref, BASE).toString()) : null;
    const anon = await p.context().browser().newContext();
    const anonRes = plateHref ? await anon.request.get(new URL(plateHref, BASE).toString(), { maxRedirects: 0 }) : null;
    const anonPng = anonRes ? anonRes.status() === 200 && (await anonRes.body()).subarray(0, 8).toString("hex") === "89504e470d0a1a0a" : false;
    await anon.close();
    const plateBox = (await plate.count()) === 1 ? await plate.boundingBox() : null;
    const hitBox = await p.locator("[data-testid='island-go-workshop'] rect").boundingBox();
    const covered = !!(plateBox && hitBox && hitBox.x <= plateBox.x + 1 && hitBox.y <= plateBox.y + 1 && hitBox.x + hitBox.width >= plateBox.x + plateBox.width - 1 && hitBox.y + hitBox.height >= plateBox.y + plateBox.height - 1);
    const signBox = await tid("island-label-workshop").boundingBox();
    const signClear = !!(signBox && plateBox && signBox.y + signBox.height <= plateBox.y + 1);
    // door arrival: the avatar's feet (ground point) stand within the painted door span (the door is at one third of the painted width)
    const avatarBox = await p.locator("[data-part='avatar-anchor']").boundingBox();
    const avatarX = avatarBox ? avatarBox.x + avatarBox.width / 2 : null;
    const doorOk = !!(plateBox && avatarX !== null && avatarX >= plateBox.x + plateBox.width * 0.26 && avatarX <= plateBox.x + plateBox.width * 0.41);
    const officeBox = await p.locator("[data-part='office']").boundingBox();
    const noHouseOverlap = !!(plateBox && officeBox && plateBox.x + plateBox.width <= officeBox.x + 1);
    const plateCount = await plate.count();
    const contentType = plateRes ? (plateRes.headers()["content-type"] ?? "") : "";
    const pngMagic = plateRes ? (await plateRes.body()).subarray(0, 8).toString("hex") === "89504e470d0a1a0a" : false;
    check("plate (continuation): the painted Tipp-Werkstatt plate is mounted on the island as a build-time static asset (/_next/static, outside the auth gate — same locally and on Vercel), its PNG bytes are served to the child session AND to a cookieless request without redirect, the walk hit target covers the whole plate box, the label chip sits clear above the painted roof, the avatar arrives at the painted DOOR, and the house does not overlap the office", plateCount === 1 && /^\/_next\/static\//.test(plateHref ?? "") && plateRes?.status() === 200 && pngMagic && anonPng && covered && signClear && doorOk && noHouseOverlap, { plateHref, plateCount, status: plateRes?.status(), contentType, pngMagic, anonStatus: anonRes?.status(), anonPng, covered, signClear, doorOk, noHouseOverlap, plateBox, hitBox, signBox, avatarX, officeBox });
  }
  await p.keyboard.press("Enter");
  await tid("typing-course").waitFor();
  // The saved progression decision (one good round on lesson 4 → "one more on the same keys") is shown first, as released; nothing replayed.
  if ((await tid("decision-card").count()) > 0) {
    check("F1 typing continuation: the saved decision card (lesson 4, one good round → repeat, NOT advance) is shown before any round — nothing replayed", (await tid("decision-card").getAttribute("data-decision")) === "repeat", await tid("decision-card").getAttribute("data-decision"));
    await shot(p, "typing-decision-desktop");
    await tid("another-burst").click();
  }
  await tid("course-input").waitFor();
  check("F1 typing workshop: Mrs Finley's English line with a translation on tap; the Swiss-German course continues at the saved lesson 4 (a/ö), hands cue compact; instruction unaffected by the keeper's language", (await tid("keeper-keeper").getAttribute("data-language")) === "en" && (await tid("typing-course").getAttribute("data-lesson")) === "TYPE-CH-COURSE-4" && (await tid("hands-keyboard").getAttribute("data-compact")) === "true" && /Jetzt: „a“/.test(await body()), await tid("typing-course").getAttribute("data-lesson"));
  await shot(p, "typing-desktop");
  await typeLine(p, "course-input", "aaa ööö");
  await typeLine(p, "course-input", "asdf jklö");
  await tid("comfort-ok").waitFor();
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  await enterOn("lesson-continue");
  await tid("decision-card").waitFor();
  const courseRow = (await rawRow()).state.typing.course;
  check("F1 typing continuation: the second good round on lesson 4 advances at the correct point — decision 'advance', lesson 5 (g/h) is next, two good bursts on lesson 4 recorded, nothing earlier rewritten", (await tid("decision-card").getAttribute("data-decision")) === "advance" && courseRow.lessonIndex === 4 && courseRow.bursts.filter((b) => b.lessonId === "TYPE-CH-COURSE-4").length === 2 && courseRow.completed.includes("TYPE-CH-COURSE-4") && /g und h/.test(await body()), { decision: await tid("decision-card").getAttribute("data-decision"), lessonIndex: courseRow.lessonIndex });
  await tid("course-continue").click();
  await tid("island-stage").waitFor();
  await settle(500);
  check("F1 island after both: the closing check opens (Hafenmeister), both workplaces done", (await tid("island-direct-closing").getAttribute("data-status")) === "open" && (await tid("island-direct-typing").getAttribute("data-status")) === "done" && /Beides geschafft/.test(await body()));
  await shot(p, "island-closing-open-desktop");
  await tid("island-direct-closing").click();
  await tid("math-question").waitFor();
  await waitActive("math-answer-full");
  check("F2 closing check (a): a fresh small variation (26 Kisten, 5 pro Boot) — same-day application, labelled as a check", /26 Kisten/.test(await tid("math-setup").innerText()) && (await view()).math?.id === "EQ-HARBOR-CHECK");
  await p.keyboard.type("5");
  await p.keyboard.press("Tab");
  await p.keyboard.type("1");
  await p.keyboard.press("Enter");
  await tid("math-decision").waitFor();
  await tid("math-answer-needed").click();
  await waitActive("math-answer-needed");
  await p.keyboard.type("6");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  check("F2 closing check (a) evidence: both parts independent on the first attempt", (await evidence()).attempts.filter((a) => a.taskId === "EQ-HARBOR-CHECK").every((a) => a.evidence === "independent") && (await tid("lesson-end").getAttribute("data-close")) === "none-needed");
  await enterOn("lesson-continue");
  await tid("language-input").waitFor();
  check("F2 closing check (b): recall of the word met today (cuerdas) without the sentence that showed it", /Necesitamos/.test(await body()) && (await tid("language-sentence").count()) === 0 && (await view()).language?.id === "LANG-ES-HARBOR-CHECK");
  // focus explicitly: the view refresh after the check above can steal the autofocus (harness race, not a product path)
  await tid("language-input").click();
  await waitActive("language-input");
  await p.keyboard.type("necesitamos cuerdas");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  await enterOn("lesson-continue");
  // scope reduction: the stub stays DOWN; the review must appear without any waiting state or hop
  await tid("log-review").waitFor({ timeout: 30000 });
  const reviewView = await view();
  const semanticRecord = (await rawRow()).state.logReviewSemantics.at(-1);
  check("F2 closing check (c) writing review (scope reduction): the sentence was reviewed MECHANICALLY only — two taught points (capitalisation, spelling), punctuation deferred, the suggestion shown as help, meaning/completeness/grammar reported as NOT assessed (unchecked), no assistant point, no 'alles richtig', no semantic record", reviewView.logReview?.points.length === 2 && reviewView.logReview.taught.every((f) => f.source === "rule") && [...new Set(reviewView.logReview.taught.map((f) => f.aspect))].sort().join(",") === "capitalization,spelling" && reviewView.logReview.unchecked.includes("meaning") && reviewView.logReview.unchecked.includes("grammar") && reviewView.logReview.suggestion !== null && !/alles richtig/.test(await body()) && semanticRecord === undefined && reviewView.logReview.semanticStatus === "unavailable", { taught: reviewView.logReview?.taught.map((f) => f.id), unchecked: reviewView.logReview?.unchecked, clean: reviewView.logReview?.clean, semantic: reviewView.logReview?.semanticStatus });
  const writingSupports = (await evidence()).supports.filter((x) => x.taskId === "WRITE-LOG-HARBOR");
  check("scope reduction: NO semantic dispatch was recorded for the captain's log (no tutor_question for WRITE-LOG-HARBOR), the review view carried no pending hop and says 'deferred'", writingSupports.length === 0 && reviewView.logReview?.pending === null && reviewView.logReview?.semanticDeferred === true && (await tid("log-review-deferred").count()) === 1, { writingSupports: writingSupports.length, pending: reviewView.logReview?.pending, deferred: reviewView.logReview?.semanticDeferred });
  await shot(p, "log-review-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("log-review", t).waitFor();
  await shot(t, "log-review");
  await tid("log-review-input").fill("Wir haben 6 Boote beladen und 2 Kisten sind übrig.");
  await tid("log-review-save").click();
  await tid("lesson-end").waitFor();
  const reviewEv = (await evidence()).state.logReviews.at(-1);
  check("F2 revision evidence (scope reduction, §6): original kept, revision stored apart, every taught MECHANICAL criterion 'corrected' (capitalisation, spelling), the semantic criteria (meaning, completeness, grammar) are 'unassessed' because the semantic hop is deferred, nothing is globally 'correct' (correct = null); help mode 'supported' (the suggestion was shown)", reviewEv.original === "wir haben 6 bote beladen und 2 kisten sind übrig" && reviewEv.revised === "Wir haben 6 Boote beladen und 2 Kisten sind übrig." && (reviewEv.criteria ?? reviewEv.evaluation?.criteria ?? []).some((c) => c.aspect === "capitalization" && c.status === "corrected") && (reviewEv.criteria ?? reviewEv.evaluation?.criteria ?? []).some((c) => c.aspect === "spelling" && c.status === "corrected") && (reviewEv.criteria ?? reviewEv.evaluation?.criteria ?? []).filter((c) => c.aspect === "meaning" || c.aspect === "grammar").every((c) => c.status === "unassessed") && (reviewEv.correct ?? null) === null && reviewEv.evidence === "supported", { criteria: (reviewEv.criteria ?? reviewEv.evaluation?.criteria ?? []).map((c) => c.id + ":" + c.status), correct: reviewEv.correct ?? null, evidence: reviewEv.evidence });
  await shot(p, "writing-lesson-end-desktop");
  await enterOn("lesson-continue");
  await tid("summary").waitFor();
  await tid("summary-next-button").click();
  await tid("reflect").waitFor();
  await tid("difficulty-right").click();
  await tid("enjoyment-yes").click();
  await tid("clarity-clear").click();
  await tid("reflect-submit").click();
  await tid("visit-report").waitFor();
  const done = await view();
  check("F2 report: opens by itself after the visit (Besuch 5, complete); the world block lists the loaded boats, the ropes, the plan and the revised log; the artifact is the child's revised sentence; count 5; no sixth visit promised", (await tid("visit-report").getAttribute("data-report-visit")) === "v6" && (await tid("visit-report").getAttribute("data-report-partial")) === "false" && /6 Boote voll beladen, 2 Kisten übrig, 7 Boote für alle/.test(await tid("report-world").innerText()) && /mit Seilen festgemacht/.test(await tid("report-world").innerText()) && (await tid("report-artifact").getAttribute("data-artifact-kind")) === "log-review" && !/Besuch 6/.test(await body()) && done.progress.completedTotal === 5 && done.next.reason === "all-visits-done", { next: done.next, total: done.progress.completedTotal });
  check("D3 (fresh deferred visit): the completed child report discloses plainly that reasoning, content and sentence structure were not assessed (no earlier assessment exists)", (await tid("report-deferred-scope").innerText()).trim() === "Rechenweg, Inhalt und Satzbau wurden heute nicht beurteilt." && (await tid("report-deferred-scope").getAttribute("data-reasoning-earlier")) === "false", await tid("report-deferred-scope").innerText());
  check("F2 report lessons: math (harbor), language (supplier), typing, math (check), language (check), writing (review) — each with its honest close", (await p.locator("[data-testid='report-lesson']").count()) === 6 && (await p.locator("[data-testid='report-lesson'][data-lesson-kind='writing']").getAttribute("data-close")) === "corrected-with-practice");
  await shot(p, "report-desktop");
  await shot(p, "report-full-desktop", { full: true });
  await goto(t, p.url().replace(BASE, ""));
  await tid("visit-report", t).waitFor();
  await shot(t, "report");
  await tid("report-back").click();
  await tid("world-screen").waitFor();
  await settle(600);
  const mapFacts = { harbor: await worldAttr(p, "data-world-harbor"), boats: await p.locator("[data-testid='world-screen'] [data-part='harbor-boat']").count(), roped: await p.locator("[data-testid='world-screen'] [data-part='harbor']").first().getAttribute("data-harbor-roped"), signpost: await p.locator("[data-testid='world-screen'] [data-part='signpost']").count(), v6: await siteState(p, "v6"), next: await worldAttr(p, "data-world-next"), action: (await tid("world-action").innerText()).slice(0, 80) };
  check("F1 map after: 7 boats (6 full + the leftovers), roped, the signpost to the lighthouse island, Besuch 5 flagged done, no further action", mapFacts.harbor === "planned" && mapFacts.boats === 7 && mapFacts.roped === "yes" && mapFacts.signpost === 1 && mapFacts.v6 === "done" && mapFacts.next === "" && /Alle Besuche|Alles gespeichert/.test(mapFacts.action), mapFacts);
  await shot(p, "map-after-desktop");
  await goto(t, "/family/learn?child=santiago");
  await tid("world-screen", t).waitFor();
  await settle(600);
  await shot(t, "map-after");
  await portraitMapAudit("after", ["v1", "v2", "v4", "v5", "v6"]);
  await tid("world-site-v6").click();
  await tid("visit-report").waitFor();
  check("F2 reopen: the report reopens from the map flag and from the URL after a reload", (await tid("visit-report").getAttribute("data-report-visit")) === "v6");
  // the URL carries ?report=v6 at once (synchronous commit): an IMMEDIATE reload keeps the report (independent review timing note)
  const urlAtOnce = p.url();
  await p.reload();
  await p.waitForLoadState("load");
  const keptAfterImmediateReload = await tid("visit-report").waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("report URL (timing): ?report=v6 is in the URL the moment the flag opens the report, and an immediate reload keeps the report open", /report=v6/.test(urlAtOnce) && keptAfterImmediateReload, { urlAtOnce });
  for (let i = 0; i < 40 && !/report=v6/.test(p.url()); i += 1) await settle(100);
  await p.reload();
  await p.waitForLoadState("load");
  await tid("visit-report").waitFor();
  check("F2 reopen after reload: ?report=v6 restores the report", (await tid("visit-report").getAttribute("data-report-visit")) === "v6" && /report=v6/.test(p.url()));
  await p.keyboard.press("Escape");
  // wordbook after the visit: German words met through the captain's log
  await tid("hud-wordbook").click();
  await tid("wordbook").waitFor();
  check("F3 wordbook after: German words from the captain's log (Boot, Kiste, übrig) and the Spanish supplier words (cuerdas, herramientas) are listed; nothing is scored", (await tid("wordbook-de").count()) === 1 && (await tid("wordbook-word-DE-BOOT").count()) === 1 && (await tid("wordbook-word-ES-CUERDAS").count()) === 1 && !/selbständig|%|Rang/.test(await tid("wordbook").innerText()));
  await shot(p, "wordbook-after-desktop");
  await p.keyboard.press("Escape");
  const ev = await evidence();
  const v6 = ev.completions.filter((c) => c.visitId === "v6");
  const de = ev.vocabulary.entries.filter((e) => e.language === "de");
  const herr = ev.vocabulary.entries.find((e) => e.entryId === "ES-HERRAMIENTAS").dimensions.recall;
  const herrObs = ev.vocabulary.observations.find((o) => o.entryId === "ES-HERRAMIENTAS" && o.dimension === "recall" && o.taskId === "LANG-ES-HARBOR");
  check("parent evidence: exactly one review for Besuch 5 (content version 4, current rules); five reviews in total; the ledger has 9 German entries with writing observations from the typed ORIGINAL (bote → incorrect, übrig → independent); herramientas was recalled correctly but AFTER Rosa's translation was opened — recorded as supported (gloss), never independent; cuerdas recalled the same day independently, never 'repeated'", v6.length === 1 && v6[0].contentVersion === 4 && v6[0].derivation?.status === "current" && ev.completions.length === 5 && de.length === 9 && de.find((e) => e.entryId === "DE-BOOT").dimensions.writing.incorrect === 1 && de.find((e) => e.entryId === "DE-UEBRIG").dimensions.writing.independentCorrect === 1 && herr.status === "supported-only" && herr.supportedCorrect === 1 && herrObs?.support.includes("gloss") && ev.vocabulary.entries.find((e) => e.entryId === "ES-CUERDAS").dimensions.recall.status === "independent" && ev.visits.some((x) => x.id === "v6" && x.ordinal === 5), { completions: ev.completions.map((c) => [c.visitId, c.contentVersion]), herr: [herr.status, herrObs?.support], de: de.map((e) => [e.entryId, e.dimensions.writing.status]) });
  const review = v6[0].review;
  check("parent review (scope reduction): answer vs reasoning separated — the EQ-HARBOR attempts keep their own evidence; the reasoning objective is reported as DEFERRED BY THE OWNER (outcome deferred-by-owner, evidence unscored, uncertainty names the deferral) — neither credit nor failure; the captain's log review line with original/taught/clean/revision; missingness listed", review.learning.objectives.some((o) => o.taskId === "EQ-HARBOR/reasoning" && o.objective === "explain-own-method" && o.outcome === "deferred-by-owner" && o.evidence === "unscored" && /ausgesetzt/.test(o.uncertainty ?? "")) && review.learning.objectives.some((o) => o.taskId.startsWith("EQ-HARBOR/") && o.objective === "quotient-with-remainder") && review.learning.objectives.some((o) => o.objective === "writing-review-revision") && /ausgesetzt/.test(review.learning.whatHappened.join(" ")) && !/ausgelassen: explain/.test(review.learning.whatHappened.join(" ")), review.learning.objectives.map((o) => [o.taskId, o.objective, o.outcome, o.evidence]));
  // stale tab at the storage boundary — a stale-request probe: NOT part of the ordinary lane
  if (!ORDINARY) {
  const rowDone = await rawRow();
  const stale = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: rowDone.state.revision - 3, idempotencyKey: `stale-${Date.now()}`, context: { erasureGeneration: 0, visit: null }, tz: TZ }, assistant, bearer);
  const rowAfter = await rawRow();
  check("stale tab: a request from an older view is refused (409 stale) and the stored row is unchanged", stale.status === 409 && stale.json?.status === "stale" && JSON.stringify(rowAfter.state) === JSON.stringify(rowDone.state), { status: stale.status });
  }
  // the parent cockpit is rendered in an OWNER session page (the child page is not the parent; until 2026-10-11 this render
  // silently showed the child's profile chooser because the tab click was caught and ignored)
  const parentCtx = await makeContext({ viewport: { width: 1280, height: 900 } });
  await parentCtx.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
  const pp = await parentCtx.newPage();
  await goto(pp, "/family/learn/parent");
  await settle(800);
  await pp.locator("button[role='tab']", { hasText: "Deutsch" }).first().click();
  await settle(400);
  await shot(pp, "parent-de-desktop", { full: true });
  check("parent render: the Deutsch tab of the parent cockpit is rendered in an owner session (not the child's profile chooser); with the live conversation deferred there is no reasoning transcript block, the writing-review block is present", /Lern-Evidenz/.test(await body(pp)) && !/Choose your profile/.test(await body(pp)) && (await pp.locator("[data-testid='parent-log-reviews']").count()) >= 1 && (await pp.locator("[data-testid='parent-reasoning']").count()) === 0, { reasoningBlocks: await pp.locator("[data-testid='parent-reasoning']").count() });
  // --- ID27 / ID28 (2026-10-11): the Mathe tab lists the CURRENT arithmetic (both harbor parts and the fresh check) from the canonical
  //     objective map, with the part and the help distinction; the support list describes every ordinary reply by origin AND delivery
  //     and agrees with the Deutsch transcript (what the child actually saw).
  const parentMathAudit = async (label, expect) => {
    await pp.locator("button[role='tab']", { hasText: "Mathe" }).first().click();
    await settle(400);
    const rows = await pp.locator("[data-objective]").evaluateAll((ns) => ns.map((n) => ({ objective: n.getAttribute("data-objective"), part: n.getAttribute("data-part"), row: n.closest("li")?.innerText ?? "" })));
    const harborRows = rows.filter((r) => /EQ-HARBOR v/.test(r.row) && !/EQ-HARBOR-CHECK/.test(r.row));
    const checkRows = rows.filter((r) => /EQ-HARBOR-CHECK v/.test(r.row));
    const partsA = harborRows.filter((r) => r.part === "A").length;
    const partsB = harborRows.filter((r) => r.part === "B").length;
    const oldRows = rows.filter((r) => /EQ-(ENTRY|STATION|PIER) v/.test(r.row)).length;
    const evidenceWords = (r) => (r.row.match(/selbständig|unabhängig|mit Hilfe|falsch|korrigiert|nicht bewertet|independent|supported|incorrect/gi) ?? []).map((w) => w.toLowerCase());
    const ev = (await evidence()).attempts.filter((a) => a.taskId === "EQ-HARBOR" || a.taskId === "EQ-HARBOR-CHECK").map((a) => [a.taskId, a.objective, a.evidence, a.correct]);
    check(`ID27 parent Mathe (${label}): the table lists both EQ-HARBOR parts (${expect.harbor} attempts: ${expect.partsA} × Teil A, ${expect.partsB} × Teil B) and the fresh EQ-HARBOR-CHECK (${expect.check} attempts) with their help distinction, while the older EQ-ENTRY/STATION/PIER rows stay`, harborRows.length === expect.harbor && partsA === expect.partsA && partsB === expect.partsB && checkRows.length === expect.check && oldRows >= 3 && harborRows.every((r) => evidenceWords(r).length >= 1), { harborRows: harborRows.map((r) => r.row.slice(0, 120)), checkRows: checkRows.map((r) => r.row.slice(0, 120)), oldRows, ev });
    await shot(pp, `parent-math-${label}-desktop`, { full: true });
    // ID28: every ordinary reply in "Hilfe und Tutor" carries a delivery; verified replies the child saw are never "zurückgehalten"
    const deliveries = await pp.locator("[data-delivery]").evaluateAll((ns) => ns.map((n) => ({ delivery: n.getAttribute("data-delivery"), origin: n.getAttribute("data-origin"), text: n.innerText.slice(0, 160) })));
    const reasoningState = (await rawRow()).state.reasoning["EQ-HARBOR"];
    const shownTurns = (reasoningState?.turns ?? []).filter((t) => t.role === "nabu" && (t.source === "assistant" || t.source === "reviewed") && (t.kind === "dialogue" || t.kind === "prompt-bank")).length;
    const displayed = deliveries.filter((d) => d.delivery === "displayed" || d.delivery === "reviewed-prompt").length;
    const verifiedWithheld = deliveries.filter((d) => d.origin === "verified" && /zurückgehalten, dem Kind nicht gezeigt/.test(d.text)).length;
    const usedInReview = deliveries.filter((d) => d.delivery === "used-in-review").length;
    const missingRunData = deliveries.filter((d) => (d.delivery === "displayed" || d.delivery === "reviewed-prompt" || d.delivery === "used-in-review") && /Beleg ohne Laufdaten/.test(d.text)).length;
    check(`ID28 parent support (${label}, scope reduction): the Mathe support list contains NO tutor reply for Besuch 5 (nothing was dispatched), the transcript shows no Nabu line, and no verified reply is called "zurückgehalten"`, deliveries.length === 0 && shownTurns === 0 && verifiedWithheld === 0, { deliveries, shownTurns, verifiedWithheld, usedInReview, missingRunData });
  };
  await parentMathAudit("corrected-first", { harbor: 3, partsA: 2, partsB: 1, check: 2 });
  // scope reduction: the parent READS the deferral — Deutsch tab (writing card: semantic aspects deferred) and Rückblick tab (reasoning objective deferred-by-owner)
  await pp.locator("button[role='tab']", { hasText: "Deutsch" }).first().click();
  await settle(400);
  const deTxt = await body(pp);
  await pp.locator("button[role='tab']", { hasText: "Rückblick" }).first().click();
  await settle(600);
  const rvTxt = await body(pp);
  await shot(pp, "parent-review-deferred-desktop", { full: true });
  check("scope reduction (parent rendered): the Deutsch writing card says the semantic check is deferred (ausgesetzt, nicht beurteilt) and shows no assistant reply; the Rückblick lists the reasoning objective as deferred-by-owner with the deferral named — neither 'nicht geschafft' nor a method credit; no 'Nicht beglaubigt' and no transcript block", /Prüfung von Bedeutung, Vollständigkeit und Satzbau in dieser Übergangsversion ausgesetzt/.test(deTxt) && !/Assistent \(beglaubigt/.test(deTxt) && /deferred-by-owner/.test(rvTxt) && /ausgesetzt/.test(rvTxt) && !/explained-independently|explained-after-probing|explained-with-support/.test(rvTxt), { de: /ausgesetzt/.test(deTxt), rv: /deferred-by-owner/.test(rvTxt) });
  await parentCtx.close();
});

// ---------------------------------------------------------------------------
// S3 — idempotency and the version-3 cap: a replayed key returns the stored outcome; the cap parks a running v6 untouched
// ---------------------------------------------------------------------------
await guarded("S3", async () => {
  if (D3_ONLY) { await d3Fixtures(); return; }
  await productionShape();
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  if (ORDINARY) {
    // ordinary: enter the planning office once (no duplicate-key replay probe in this lane)
    await op({ op: "enter-workplace", workplace: "planning" });
  } else {
  const first = await opRaw({ op: "enter-workplace", workplace: "planning" }, "replay-key-1");
  const again = await opRaw({ op: "enter-workplace", workplace: "planning" }, "replay-key-1");
  check("idempotency: the same key twice applies once and replays the stored outcome (no second route change, no second entry)", first.json.status === "applied" && again.json.status === "replayed" && JSON.stringify((await rawRow()).state.harbor.entered) === '["planning"]', { first: first.json.status, again: again.json.status });
  }
  const before = await rawRow();
  if (!CAP_BASE) {
    check("rollback cap: --cap-base given", false, "no capped server");
    return;
  }
  const capped = await capApi(`/api/family/learning/mission?tz=${TZ}`);
  check("rollback: the version-3 cap reads the same rows, parks the running Besuch 5 (chapter-unavailable), counts 4 completions, narrates 4 reports, keeps the pier; no harbor view", capped.status === 200 && capped.json.view.visit === null && capped.json.view.next.reason === "chapter-unavailable" && capped.json.view.progress.completedTotal === 4 && capped.json.view.reports.length === 4 && capped.json.view.scene.pier.built === true && capped.json.view.harbor === null, { status: capped.status, next: capped.json?.view?.next });
  const refused = await fetch(CAP_BASE + "/api/family/learning/mission", { method: "PUT", headers: { cookie: `${COOKIE}=${assistant}`, authorization: "Bearer " + bearer, "content-type": "application/json" }, body: JSON.stringify({ op: { op: "start-visit" }, expectedRevision: capped.json.view.revision, idempotencyKey: `cap-${Date.now()}`, context: { erasureGeneration: 0, visit: null }, tz: TZ }) });
  const after = await rawRow();
  check("rollback: the capped build refuses to start anything (refused or stale, never applied) and writes nothing", (refused.status === 422 || refused.status === 409) && JSON.stringify(after.state) === JSON.stringify(before.state) && after.contentVersion === before.contentVersion, { status: refused.status });
  const parent = await fetch(CAP_BASE + "/api/family/learning/parent/evidence?child=santiago", { redirect: "manual", headers: { cookie: `${COOKIE}=${owner}` } });
  const parentJson = await parent.json();
  check("rollback: the parent cockpit on the capped build still reads every row (4 reviews, 5 visits incl. the parked one)", parent.status === 200 && parentJson.completions.length === 4 && parentJson.state.visits.length === 5);
  const resumed = await view();
  check("forward: the uncapped build resumes exactly at EQ-HARBOR with the chosen route, nothing rewritten", resumed.visit?.id === "v6" && resumed.visit?.stage === "EQ-HARBOR" && JSON.stringify((await rawRow()).state) === JSON.stringify(before.state));
  // --- API-level adversarial run at the storage boundary: forged replies (no receipt, tampered receipt, wrong turn), the strict
  //     schema, a VERIFIED stub-signed acceptance, the captain's log "10 Metal stake" through dispatch-first semantic review.
  const stubTurn = async (message, key) => {
    const r = await fetch(`${STUB_ORIGIN}/v1/child-turn`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer fct1.harness.direct" }, body: JSON.stringify({ message, idempotencyKey: key }) });
    const j = await r.json();
    return { text: j.blocks.map((b) => b.text).join("\n\n"), receipt: j.meta.receipt };
  };
  if (ORDINARY) {
    // ordinary completion path (no trust probes): answer the harbor item; the explain stage is DEFERRED (owner scope reduction) and passed
    // by the server with reason "deferred" — no tutor call — then the same completion-semantics tail (skip → locked → nachholen → check opens)
    await op({ op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" });
    await op({ op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" });
    await ack();
    const afterHarbor = await view();
    const rowHarbor = (await rawRow()).state;
    const v6row = rowHarbor.visits.find((v) => v.id === "v6");
    check("scope reduction (API, correct-first): after the harbor answers the visit stands at LANG-ES-HARBOR; the explain stage was passed with reason 'deferred' (not the child's skip), no reasoning state exists and no tutor call left", afterHarbor.visit?.stage === "LANG-ES-HARBOR" && !!v6row?.skippedStages.some((s) => s.stage === "explain" && s.reason === "deferred") && !rowHarbor.reasoning?.["EQ-HARBOR"] && (stub.hits ?? 0) === 0, { stage: afterHarbor.visit?.stage, skipped: v6row?.skippedStages, hits: stub.hits ?? 0 });
    // ID27 (correct-first): the parent Mathe table shows the two harbor parts as independent first-try answers
    const parentCtx3 = await makeContext({ viewport: { width: 1280, height: 900 } });
    await parentCtx3.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
    const pp3 = await parentCtx3.newPage();
    await goto(pp3, "/family/learn/parent");
    await settle(800);
    await pp3.locator("button[role='tab']", { hasText: "Mathe" }).first().click();
    await settle(400);
    const rows = await pp3.locator("[data-objective]").evaluateAll((ns) => ns.map((n) => ({ part: n.getAttribute("data-part"), row: n.closest("li")?.innerText ?? "" })));
    const harborRows = rows.filter((r) => /EQ-HARBOR v/.test(r.row) && !/EQ-HARBOR-CHECK/.test(r.row));
    const evA = (await evidence()).attempts.filter((a) => a.taskId === "EQ-HARBOR").map((a) => [a.objective, a.evidence, a.correct]);
    check("ID27 parent Mathe (correct-first): EQ-HARBOR Teil A and Teil B each appear once as a correct, independent first attempt (no help) — the current arithmetic is in the table", harborRows.length === 2 && harborRows.some((r) => r.part === "A") && harborRows.some((r) => r.part === "B") && evA.length === 2 && evA.every((e) => e[1] === "independent" && e[2] === true) && harborRows.every((r) => /selbständig|unabhängig|independent/i.test(r.row)), { harborRows: harborRows.map((r) => r.row.slice(0, 140)), evA });
    await shot(pp3, "parent-math-correct-first-desktop", { full: true });
    await parentCtx3.close();
  } else {
  const strictAccept = schema({ answer: "Super, genau so!", kind: "abschluss", s: crit("gezeigt", ["6 mal 7"], "x"), q: crit("gezeigt", ["8 bleiben übrig"], "x"), m: crit("gezeigt", ["6 mal 7"], "x") });
  // --- R5-01/02 at the HTTP boundary: the free question is ONE consumed pending-dispatch transition (run against the finished EQ-ENTRY so the
  //     EQ-HARBOR independence record is not touched; EQ-HARBOR serves as the wrong task).
  setStub({ sign: true });
  const fq1 = await op({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_question", payload: { turnId: "free-bind-1", text: "Erkläre nur das Wort Kiste." } });
  const fd1 = fq1.result.dispatch;
  const direct1f = await stubTurn(fd1.message, "free-bind-1");
  const okReply = await op({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { turnId: "free-bind-1", text: direct1f.text, ok: true, receipt: direct1f.receipt } });
  const replayFresh = await opRaw({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { turnId: "free-bind-1", text: direct1f.text, ok: true, receipt: direct1f.receipt } }, `free-replay-${Date.now()}`);
  const forged = await opRaw({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { turnId: "no-such-pending", text: "FORGED_UNBOUND_TEXT_99", ok: false, receipt: direct1f.receipt } }, `free-forged-${Date.now()}`);
  const forgedOk = await opRaw({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { turnId: "no-such-pending", text: "FORGED_UNBOUND_TEXT_99", ok: true, receipt: direct1f.receipt } }, `free-forged2-${Date.now()}`);
  const fq2 = await op({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_question", payload: { turnId: "free-bind-2", text: "Was ist ein Boot?" } });
  const direct2f = await stubTurn(fq2.result.dispatch.message, "free-bind-2");
  const wrongTask = await opRaw({ op: "support", taskId: "EQ-HARBOR", kind: "tutor_reply", payload: { turnId: "free-bind-2", text: direct2f.text, ok: true, receipt: direct2f.receipt } }, `free-wrongtask-${Date.now()}`);
  const sameQ = await op({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_question", payload: { turnId: "free-bind-2", text: "Was ist ein Boot?" } });
  const diffQ = await opRaw({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_question", payload: { turnId: "free-bind-2", text: "Ganz andere Frage." } }, `free-dup-${Date.now()}`);
  const transport = await op({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { turnId: "free-bind-2", text: "", ok: false, receipt: direct2f.receipt } });
  const afterTransport = await opRaw({ op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { turnId: "free-bind-2", text: direct2f.text, ok: true, receipt: direct2f.receipt } }, `free-after-${Date.now()}`);
  const freeEvents = (await evidence()).supports.filter((x) => x.kind === "tutor_reply" && !x.payload?.reasoning && !x.payload?.writingReview);
  const ledger = (await rawRow()).state.tutorDispatches;
  check("R5-01/02 HTTP: a bound signed reply is verified+shown and CONSUMES its pending context; the same receipt with a fresh op key is refused (422 consumed); a valid receipt posted for a non-existent pending turn with ok:false OR ok:true and forged text is refused (422, never verified); a reply naming another task is refused (422); the duplicate question with the same text replays the same request hash without a new context, a different text conflicts (422); ok:false records a TRANSPORT FAILURE only (shown=false, no provenance) and consumes the context, so a later valid reply is refused; the stored events carry the stable origins", okReply.result.origin === "verified" && okReply.result.shown === true && replayFresh.status === 422 && /consumed/.test(JSON.stringify(replayFresh.json)) && forged.status === 422 && /no pending/.test(JSON.stringify(forged.json)) && forgedOk.status === 422 && wrongTask.status === 422 && /different task/.test(JSON.stringify(wrongTask.json)) && sameQ.result.replayed === true && sameQ.result.dispatch.reqHash === fq2.result.dispatch.reqHash && diffQ.status === 422 && transport.result.shown === false && transport.result.transportFailure === true && afterTransport.status === 422 && ledger.filter((d) => d.turnId === "free-bind-2").length === 1 && ledger.find((d) => d.turnId === "free-bind-1").status === "consumed" && ledger.find((d) => d.turnId === "free-bind-2").status === "failed" && freeEvents.some((e) => e.payload.origin === "verified" && e.payload.shown === true && e.payload.provenance?.model === "fixture/stub-nabu") && freeEvents.some((e) => e.payload.classification === "transport-failure" && e.payload.shown === false && e.payload.provenance === null) && !freeEvents.some((e) => /FORGED_UNBOUND/.test(e.payload.text ?? "")), { ok: okReply.result, replay: replayFresh.status, forged: forged.status, forgedOk: forgedOk.status, wrongTask: wrongTask.status, sameQ: { replayed: sameQ.result.replayed }, diffQ: diffQ.status, transport: transport.result, after: afterTransport.status });
  // the ACTUAL parent rendering: the verified free reply shows as beglaubigt with executor-reported provenance; the transport failure is withheld; no forged text anywhere
  const ownerCtx = await makeContext({ viewport: { width: 1280, height: 900 } });
  await ownerCtx.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
  const op2 = await ownerCtx.newPage();
  op2.setDefaultTimeout(15000);
  await goto(op2, "/family/learn/parent");
  await settle(800);
  await shot(op2, "parent-free-bind-desktop", { full: true });
  const parentText = await body(op2);
  // R5-06 at the storage boundary: a PRE-ORIGIN-SCHEMA tutor_reply row (no origin, no shown) is inserted directly into the support table;
  // the parent withholds it as "Herkunft: unbekannt", the raw bytes stay in the evidence store untouched (no rewrite of historical rows)
  {
    const c = createClient({ url: "file:" + DB });
    try {
      const mission = (await c.execute("SELECT mission_id FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
      await c.execute({ sql: "INSERT INTO family_learning_support_events (id, child_id, mission_id, visit_id, task_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: ["legacy-r6-1", "santiago", String(mission.mission_id), "v1", "EQ-ENTRY", "tutor_reply", JSON.stringify({ text: "LEGACY_UNSIGNED_REPLY_ONLY", turnId: "legacy-turn" }), "2026-10-01T10:00:00.000Z"] });
    } finally { c.close(); }
  }
  const legacyStored = (await evidence()).supports.find((x) => x.id === "legacy-r6-1");
  await goto(op2, "/family/learn/parent");
  await settle(800);
  await shot(op2, "parent-legacy-withheld-desktop", { full: true });
  const parentLegacy = await body(op2);
  check("R5-06 stored + rendered: a legacy tutor_reply row without any origin is returned by the evidence API with its raw bytes UNCHANGED (no rewrite, no origin invented) and the parent renders it withheld as 'Herkunft: unbekannt' — the prose LEGACY_UNSIGNED_REPLY_ONLY appears nowhere on the page", legacyStored?.payload?.text === "LEGACY_UNSIGNED_REPLY_ONLY" && legacyStored?.payload?.origin === undefined && legacyStored?.payload?.shown === undefined && !/LEGACY_UNSIGNED_REPLY_ONLY/.test(parentLegacy) && /Antwort aus der Zeit vor der Herkunftsprüfung \(Herkunft: unbekannt\)/.test(parentLegacy), { stored: legacyStored?.payload, exposed: /LEGACY_UNSIGNED/.test(parentLegacy), withheldLabel: /Herkunft: unbekannt/.test(parentLegacy) });
  await ownerCtx.close();
  check("R5-01/05/06 parent render: the verified free reply is shown with 'beglaubigt' and 'vom Executor gemeldet … fixture/stub-nabu'; the transport-failure event is rendered as a failed transfer with nothing shown; FORGED_UNBOUND_TEXT_99 appears nowhere; no 'nicht offengelegt' claim", /beglaubigt/.test(parentText) && /vom Executor gemeldet[^\n]*fixture\/stub-nabu/.test(parentText) && /Übertragung fehlgeschlagen — keine Antwort, nichts gezeigt/.test(parentText) && !/FORGED_UNBOUND_TEXT_99/.test(parentText) && !/nicht offengelegt/.test(parentText), { hasForged: /FORGED_UNBOUND/.test(parentText) });
  await op({ op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" });
  await op({ op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" });
  await ack();
  // turn 1: the honest stub's reply, posted with a TAMPERED receipt → present-but-invalid: withheld (unavailable line), recorded as receipt-invalid, the conversation stays open — distinct from absent
  setStub({ reasoning: "honest" });
  const t1 = await op({ op: "reasoning-turn", text: "Ich habe 6 mal 7 gerechnet und 8 bleiben übrig.", modality: "spoken" });
  const wrongId = await opRaw({ op: "reasoning-reply", turnId: "forged-turn", ok: true, text: strictAccept }, `forged-${Date.now()}`);
  const direct1 = await stubTurn(t1.result.dispatch.message, t1.result.dispatch.turnId);
  const mismatched = await opRaw({ op: "reasoning-reply", turnId: t1.result.dispatch.turnId, ok: true, text: direct1.text + " ", receipt: direct1.receipt }, `mismatch-${Date.now()}`);
  const overlong = await opRaw({ op: "reasoning-reply", turnId: t1.result.dispatch.turnId, ok: true, text: direct1.text + " ".repeat(4000), receipt: direct1.receipt }, `overlong-${Date.now()}`);
  const tampered = await op({ op: "reasoning-reply", turnId: t1.result.dispatch.turnId, ok: true, text: direct1.text, receipt: direct1.receipt.slice(0, -3) + "abc" });
  const stateAfterTampered = (await rawRow()).state.reasoning["EQ-HARBOR"];
  const tamperedEvidence = (await evidence()).supports.filter((x) => x.kind === "tutor_reply" && x.payload?.reasoning).at(-1);
  check("R2-01/R2-02 at the API (reset trust): a reply for a wrong turn id is refused (422); a valid receipt over OTHER bytes (trailing space) is refused (422, no normalisation); an overlong reply is refused explicitly (422, never truncated); a TAMPERED receipt is origin 'invalid' — the text is WITHHELD (local line, source local), never stored in the transcript, no assessment, the conversation stays open", wrongId.status === 422 && mismatched.status === 422 && /does not match/.test(JSON.stringify(mismatched.json)) && overlong.status === 422 && /too long/i.test(JSON.stringify(overlong.json)) && tampered.result.done === false && tampered.result.kind === "withheld" && tampered.result.source === "local" && tampered.result.origin === "invalid" && stateAfterTampered.status === "open" && stateAfterTampered.method === null && stateAfterTampered.unavailable === 1 && stateAfterTampered.origins.invalid === 1 && stateAfterTampered.assessments.length === 0 && !stateAfterTampered.turns.some((t) => /verstehe deinen Weg|Super/.test(t.text)) && tamperedEvidence?.payload?.classification === "origin-invalid" && tamperedEvidence?.payload?.receiptProblem === "bad-signature", { wrong: wrongId.status, mismatched: mismatched.status, overlong: overlong.status, tampered: tampered.result, classification: tamperedEvidence?.payload?.classification });
  // the same through the REAL client library (parser + transport) against a bridge that returns a malformed receipt: the client keeps it (never drops it to "absent"), the server records it as invalid
  setStub({ sign: "malformed" });
  const t2 = await op({ op: "reasoning-turn", text: "Ich habe 6 mal 7 gerechnet und 8 bleiben übrig.", modality: "spoken" });
  const realClient = createChildTurnClient({ fetchImpl: (url, init) => fetch(String(url).startsWith("/") ? BASE + String(url) : String(url), { ...init, headers: { ...(init?.headers ?? {}), cookie: `${COOKIE}=${assistant}`, authorization: String(url).startsWith("/") ? "Bearer " + bearer : init?.headers?.Authorization ?? init?.headers?.authorization ?? "" } }) });
  const viaClient = await realClient.ask({ childId: "santiago", sessionSuffix: "learn", message: t2.result.dispatch.message }, { idempotencyKey: t2.result.dispatch.turnId, noTruncate: true });
  const clientReceipt = viaClient.ok ? viaClient.envelope.meta.receipt ?? null : null;
  const malformedPosted = viaClient.ok ? await op({ op: "reasoning-reply", turnId: t2.result.dispatch.turnId, ok: true, text: envelopeRawText(viaClient.envelope), receipt: clientReceipt }) : null;
  const stateAfterMalformed = (await rawRow()).state.reasoning["EQ-HARBOR"];
  const sentExact = stub.calls.filter((c) => c.kind === "reasoning").at(-1);
  check("R2-01 through the real client (reset trust): a malformed receipt from the bridge reaches the server as PRESENT (not dropped to absent), origin 'malformed', the text withheld behind the local line; the client sent the dispatch message EXACTLY; two untrusted replies reach the scaffold, still no assessment", viaClient.ok && clientReceipt === "garbage-not-a-receipt" && malformedPosted?.result?.kind === "withheld" && malformedPosted?.result?.origin === "malformed" && stateAfterMalformed.unavailable === 2 && stateAfterMalformed.status === "scaffold" && stateAfterMalformed.method === null && stateAfterMalformed.origins.malformed === 1 && stateAfterMalformed.origins.invalid === 1 && stateAfterMalformed.assessments.length === 0 && sentExact.length === t2.result.dispatch.message.length && sentExact.idempotencyKey === t2.result.dispatch.turnId, { ok: viaClient.ok, receipt: clientReceipt, posted: malformedPosted?.result, status: stateAfterMalformed.status });
  setStub({ sign: true });
  // the legacy tag-style reply is not the schema: tested at the parser boundary here (the pending slot is used up above)
  const legacyParsed = await opRaw({ op: "reasoning-reply", turnId: t2.result.dispatch.turnId, ok: true, text: "Super, genau so! [[NABU-URTEIL: erklaert]]" }, `legacy-${Date.now()}`);
  check("IV5-02 at the API: a reply when nothing is pending is refused; the tag-style reply never counts (the parser boundary is covered in the unit suite and the browser run)", legacyParsed.status === 422, legacyParsed.status);
  // the counters choice re-opens the dialogue with one more turn (a support, recorded); the honest stub's VERIFIED cited acceptance closes 'with support'
  await op({ op: "reasoning-choice", choice: "counters" });
  const t3 = await op({ op: "reasoning-turn", text: "Nein: 6 mal 6 ist 36, 38 minus 36 ist 2, also 6 Boote voll und 2 übrig.", modality: "typed" });
  const direct = await stubTurn(t3.result.dispatch.message, t3.result.dispatch.turnId);
  const verified = await op({ op: "reasoning-reply", turnId: t3.result.dispatch.turnId, ok: true, text: direct.text, receipt: direct.receipt });
  const stateVerified = (await rawRow()).state.reasoning["EQ-HARBOR"];
  const gullibleEvidence = (await evidence()).supports.filter((x) => x.kind === "tutor_reply" && x.payload?.reasoning).at(-1);
  const parentNow = (await evidence()).completions;
  check("IV5-03 / containment at the API (reset): the honest stub's VERIFIED reply closes with Nabu's assessment stored as revision 1 (passages grounded in the child's turn), the support mode is 'supported' (counters) so the label is 'explained-with-support'; the reply event carries the assessment and classification 'closing'; the item's own answer record is unchanged", verified.result.done === true && verified.result.method === "explained-with-support" && verified.result.source === "assistant" && verified.result.origin === "verified" && stateVerified.final && stateVerified.final.revision === 1 && stateVerified.final.ungrounded === false && stateVerified.supportMode === "supported" && stateVerified.supportEvents.some((e) => e.kind === "counters") && stateVerified.origins.verified === 1 && gullibleEvidence?.payload?.classification === "closing" && gullibleEvidence?.payload?.assessment?.revision === 1 && (await rawRow()).state.math["EQ-HARBOR"].supportGiven.length === 0, { verified: verified.result, final: stateVerified.final && Object.values(stateVerified.final.criteria).map((c) => [c.level, c.grounding]) });
  void parentNow;
  }
  await op({ op: "skip-stage", stage: "LANG-ES-HARBOR", reason: "child" });
  await op({ op: "plan-harbor", destination: "ship" });
  await op({ op: "save-log", text: "10 Metal stake" });
  await op({ op: "enter-workplace", workplace: "typing" });
  await op({ op: "skip-stage", stage: "typing-course", reason: "child" });
  const afterSkip = await view();
  const closingLocked = await opRaw({ op: "enter-workplace", workplace: "closing" }, `closing-locked-${Date.now()}`);
  check("IV5-10 / completion semantics: skipping the typing round is NOT completion — the workplace reads 'skipped', the scene does not count it, the closing check stays LOCKED (entering it is refused), the visit is not finished (partial recap only)", afterSkip.harbor.workplaces.find((w) => w.id === "typing").status === "skipped" && afterSkip.scene.harbor.workplaces.typing === false && afterSkip.harbor.workplaces.find((w) => w.id === "closing").status === "locked" && closingLocked.status === 422 && afterSkip.visit?.id === "v6" && !afterSkip.progress.completed.some((c) => c.visit === "v6"), afterSkip.harbor.workplaces.map((w) => [w.id, w.status]));
  // catching up: the skipped workshop is entered again; real typing there makes it done and unlocks the check
  const reenter = await op({ op: "enter-workplace", workplace: "typing" });
  const lessonView = await view();
  const lesson = lessonView.typingCourse?.lesson;
  if (lesson) await op({ op: "typing-burst", lessonId: lesson.id, lines: lesson.lines, seconds: 20, comfort: "ok" });
  await ack();
  await op({ op: "typing-course-continue" });
  const afterCatchUp = await view();
  const rowCatchUp = (await rawRow()).state;
  check("completion semantics: the skipped workshop can be re-entered ('nachholen'); after a real typing round it reads done, the scene counts it, the closing check opens; the earlier skip stays recorded as caught up", reenter.result.reentered === true && lessonView.visit?.stage === "typing-course" && afterCatchUp.harbor.workplaces.find((w) => w.id === "typing").status === "done" && afterCatchUp.scene.harbor.workplaces.typing === true && afterCatchUp.harbor.workplaces.find((w) => w.id === "closing").status === "open" && rowCatchUp.visits.find((v) => v.id === "v6").skippedStages.some((sk) => sk.stage === "typing-course" && sk.undone === true) && JSON.stringify(rowCatchUp.harbor.reentered) === '["typing"]', { statuses: afterCatchUp.harbor.workplaces.map((w) => [w.id, w.status]), lesson: lesson?.id });
  await op({ op: "enter-workplace", workplace: "closing" });
  await op({ op: "answer-quotient", itemId: "EQ-HARBOR-CHECK", full: 5, remaining: 1, raw: "5, 1", modality: "typed" });
  await op({ op: "answer-needed", itemId: "EQ-HARBOR-CHECK", needed: 6, raw: "6", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "LANG-ES-HARBOR-CHECK", reason: "child" });
  if (!ORDINARY) {
  const pendingReview = (await view()).logReview;
  const beforeDispatch = await opRaw({ op: "review-log-semantic", turnId: pendingReview.pending.turnId, ok: true, text: SEMANTIC_METAL }, `sem-early-${Date.now()}`);
  const semanticStale = await opRaw({ op: "review-log-dispatch", turnId: "wr-v6-forged" }, `sem-forged-${Date.now()}`);
  const dispatched = await op({ op: "review-log-dispatch", turnId: pendingReview.pending.turnId });
  setStub({ writing: "metal" });
  const semanticDirect = await stubTurn(dispatched.result.message, pendingReview.pending.turnId);
  const unverifiedSemantic = await opRaw({ op: "review-log-semantic", turnId: pendingReview.pending.turnId, ok: true, text: semanticDirect.text }, `sem-unverified-${Date.now()}`);
  check("IV5-12/03 at the API: a reply before the dispatch record is refused; a dispatch for another sentence is refused; a reply without a receipt is applied as 'unverified' (meaning and grammar unchecked; only the mechanical fallback speaks)", beforeDispatch.status === 422 && /not recorded first/.test(JSON.stringify(beforeDispatch.json)) && semanticStale.status === 422 && dispatched.result.status === "pending" && unverifiedSemantic.status === 200 && unverifiedSemantic.json.result.status === "unverified" && unverifiedSemantic.json.result.unchecked.includes("meaning") && unverifiedSemantic.json.result.unchecked.includes("grammar") && unverifiedSemantic.json.result.taught.includes("completeness:verb"), { early: beforeDispatch.status, stale: semanticStale.status, unverified: unverifiedSemantic.json?.result });
  const metalReview = (await view()).logReview;
  check("F2 '10 Metal stake' without a verified reply: the original is kept exactly; meaning and grammar are NOT checked (never 'in Ordnung'); the mechanical fallback teaches one uncertain completeness point and asks one honest question (no verb, no task word) and never flags 'Metal'/'stake' as spelling", metalReview.original === "10 Metal stake" && metalReview.semanticStatus === "unverified" && JSON.stringify(metalReview.unchecked) === '["meaning","grammar"]' && metalReview.points.some((pt) => pt.aspect === "completeness" && pt.certainty === "uncertain") && metalReview.clarify && /Was wolltest du mit deinem Satz sagen/.test(metalReview.clarify.question) && !/Geprüft und in Ordnung: Inhalt/.test(metalReview.summary) && !/Geprüft und in Ordnung: [^.]*Satzbau/.test(metalReview.summary) && !metalReview.taught.some((t) => t.aspect === "spelling") && JSON.stringify(metalReview.uncheckedWords) === '["Metal","stake"]', { taught: metalReview.taught.map((t) => t.id), summary: metalReview.summary });
  const revised = await op({ op: "review-log", text: "Wir haben 10 Pfähle in den Steg geschlagen.", clarifications: { question: "Pfähle aus Metall für den Steg", bogus: "x" } });
  const lr = (await rawRow()).state.logReviews.at(-1);
  check("F2 '10 Metal stake' revision: with semantic aspects unchecked the mechanical points decide; the clarification is stored verbatim and unscored; original and revision stay apart; the parent evidence line matches the stored evidence", JSON.stringify(lr.clarifications) === '{"question":"Pfähle aus Metall für den Steg"}' && lr.original === "10 Metal stake" && lr.revised === "Wir haben 10 Pfähle in den Steg geschlagen." && lr.evidence === revised.result.evidence && (await evidence()).attempts.filter((a) => a.taskId === "WRITE-LOG-HARBOR").at(-1).evidence === lr.evidence, { outcome: revised.result, evidence: lr.evidence });
  await ack();
  }
  // the same sentence WITHOUT the assistant (bridge down): a fresh visit is not possible here, so the pure rule is asserted through the unit suite; the storage boundary above proves the binding.

  if (ORDINARY) {
    // typing-first FULL completion through the API with the tutor endpoint unavailable: both workplace orders complete without a live hop
    await productionShape();
    await op({ op: "start-visit" });
    await op({ op: "resume-base" });
    await op({ op: "enter-workplace", workplace: "typing" });
    const tv = await view();
    const tLesson = tv.typingCourse?.lesson;
    if (tLesson) await op({ op: "typing-burst", lessonId: tLesson.id, lines: tLesson.lines, seconds: 20, comfort: "ok" });
    await ack();
    await op({ op: "typing-course-continue" });
    await op({ op: "enter-workplace", workplace: "planning" });
    await op({ op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" });
    await op({ op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" });
    await ack();
    await op({ op: "skip-stage", stage: "LANG-ES-HARBOR", reason: "child" });
    await op({ op: "plan-harbor", destination: "ship" });
    await op({ op: "save-log", text: "wir haben 6 bote beladen und 2 kisten sind übrig" });
    await op({ op: "enter-workplace", workplace: "closing" });
    await op({ op: "answer-quotient", itemId: "EQ-HARBOR-CHECK", full: 5, remaining: 1, raw: "5, 1", modality: "typed" });
    await op({ op: "answer-needed", itemId: "EQ-HARBOR-CHECK", needed: 6, raw: "6", modality: "typed" });
    await ack();
    await op({ op: "skip-stage", stage: "LANG-ES-HARBOR-CHECK", reason: "child" });
    const tfReview = (await view()).logReview;
    await op({ op: "review-log", text: "Wir haben 6 Boote beladen und 2 Kisten sind übrig." });
    await ack();
    const tfSummary = await view();
    if (tfSummary.visit?.stage === "summary") await op({ op: "summary-seen" });
    const tfReflect = await view();
    if (tfReflect.visit?.stage === "reflect") await op({ op: "reflect", optionId: null, difficultySkipped: true });
    const tfRow = (await rawRow()).state;
    const tfVisit = tfRow.visits.find((v) => v.id === "v6");
    const tfView = await view();
    const tfEv = await evidence();
    check("scope reduction (API, typing-first): typing → planning → closing completes the visit with the tutor endpoint down — finished, report present and not partial, 5 completions, typing block before planning in the route, explain passed as 'deferred', the writing review had no semantic dispatch (pending null, unavailable, deferred) and mechanical criteria only, zero tutor events, zero stub hits", !!tfVisit?.finishedAt && tfView.progress.completedTotal === 5 && (tfView.reports.find((r) => r.visit === "v6")?.partial === false) && Array.isArray(tfVisit?.route) && tfVisit.route.indexOf("typing-course") < tfVisit.route.indexOf("EQ-HARBOR") && !!tfVisit?.skippedStages.some((s) => s.stage === "explain" && s.reason === "deferred") && tfReview?.pending === null && tfReview?.semanticStatus === "unavailable" && tfReview?.semanticDeferred === true && tfEv.supports.filter((x) => x.visitId === "v6" && (x.kind === "tutor_question" || x.kind === "tutor_reply")).length === 0 && (stub.hits ?? 0) === 0, { finished: tfVisit?.finishedAt, completed: tfView.progress.completedTotal, route: tfVisit?.route, skipped: tfVisit?.skippedStages, review: tfReview && { pending: tfReview.pending, status: tfReview.semanticStatus, deferred: tfReview.semanticDeferred, unchecked: tfReview.unchecked }, hits: stub.hits ?? 0 });
  }
  if (ORDINARY && !D3_ONLY) await d3Fixtures();
  // --- temporary Visit 5 scope reduction (owner, 2026-10-11): the tutor endpoint was DOWN for the whole run; nothing may have left the app
  {
    const ev = await evidence();
    const v6Tutor = ev.supports.filter((x) => x.visitId === "v6" && (x.kind === "tutor_question" || x.kind === "tutor_reply"));
    check("scope reduction: zero outbound tutor calls across the whole run (stub hits 0) and zero tutor_question/tutor_reply events for Besuch 5 — normal journey, reopen, save/resume, free bubble and writing review all completed without a live hop", (stub.hits ?? 0) === 0 && v6Tutor.length === 0, { hits: stub.hits ?? 0, v6Tutor: v6Tutor.length });
  }
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

if (mintWaits.length) console.log(`NOTE [visit5] child session mint window (30/min/child) was full ${mintWaits.length} time(s); the harness waited for it to roll: ${JSON.stringify(mintWaits.slice(0, 5))}`);
await browser.close();
await new Promise((r) => stubServer.close(r));
const summary = { base: BASE, capBase: CAP_BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, pageErrors };
fs.writeFileSync(path.join(OUT, "visit5-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nvisit5: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
