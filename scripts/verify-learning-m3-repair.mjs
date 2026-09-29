// Real-browser regression for the two independent M3 findings (2026-09-29):
//  1. Read-aloud / tutor speech failure must show an accessible
//     audio-unavailable state instead of looking successful; text and manual
//     controls stay usable; help recording stays conservative; stop, child
//     switch (dispose) and late acknowledgements never show a stale notice or
//     start audio.
//  2. A direct mission link or an in-flight child switch to a child without a
//     prepared mission shows the honest not-prepared state (shared with the
//     cockpit), never a "temporary load failure" or "your base is saved".
//  3. Independent adversarial findings A01–A07 (M3-repair review): a mounted
//     read-aloud control whose speech was cancelled by ANOTHER speaker (the
//     tutor reading its reply) settles back to idle and can retry; retry clears
//     the previous notice while pending; Stopp during a held TTS ignores a
//     late failure; a closed tutor panel ignores a late speech failure; and a
//     malformed HTTP-200 mission response is a recoverable load error on both
//     surfaces, never "not prepared" — while the server's explicit
//     prepared:false answer still is.
//  4. r3 (independent M3 r2 review): a matching-child view that is incomplete
//     or contradictory ({"view":{"child":"santiago"}} and the prepared:false
//     variant) must be rejected by the runtime ChildView guard and show the
//     recoverable load error without any page exception; a malformed write
//     response must not crash the mission either; valid views still render.
//
// Runs against a LOCAL production server (synthetic AUTH_SECRET, fresh
// NABU_DB_DIR). Headless Chromium, project audio guard installed, muted: no
// audio is ever produced; TTS is blocked or answered with synthetic bytes.
// Session cookies are real Auth.js JWEs minted locally. No real .env, data,
// OAuth or external service.
//
//   AUTH_SECRET=<same as server> node scripts/verify-learning-m3-repair.mjs --base http://127.0.0.1:3124 --out /tmp/<dir>

import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt("--base", "http://127.0.0.1:3124").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-m3-repair");
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) is required");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
}
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
async function api(method, url, body, cookie = assistant, bearer) {
  const r = await fetch(BASE + url, { method, headers: { cookie: `${COOKIE}=${cookie}`, "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}
const bearer = (await api("POST", "/api/family/learning/session", { childId: "santiago" })).json.token;
const view = async () => (await api("GET", "/api/family/learning/mission", null, assistant, bearer)).json.view;
const supports = async () => ((await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json.supports ?? []).map((s) => s.kind);

const AUDIO_NOTICE = /Vorlesen geht gerade nicht/;
const NOT_PREPARED = "Deine Expedition ist noch nicht vorbereitet";
const MISLEADING = /lädt gerade nicht|Basis ist gespeichert/;

const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await installBrowserAudioGuard(c);
const ttsRequests = [];
// TTS is blocked by default (fetch failure). Everything nonlocal and the assistant/transcribe endpoints are blocked too.
let ttsMode = "blocked";
let ttsGate = null; // when set, the NEXT TTS request waits here before failing; later requests fail at once
await c.route("**/*", async (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== BASE) return r.abort("blockedbyclient");
  if (/\/api\/family\/assistant\/tts/.test(u.pathname)) {
    const mode = ttsMode;
    ttsRequests.push(mode);
    if (mode === "garbage") return r.fulfill({ status: 200, headers: { "content-type": "audio/mpeg" }, body: Buffer.from("this is not audio data at all", "utf8") });
    if (mode === "hold" && ttsGate) {
      const gate = ttsGate; // only this one request is held (like the reviewer's probe)
      ttsGate = null;
      ttsMode = "blocked";
      await gate;
    }
    return r.abort("blockedbyclient").catch(() => {});
  }
  if (/\/api\/family\/(assistant\/|transcribe)/.test(u.pathname)) return r.abort("blockedbyclient");
  return r.continue();
});
await c.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
const p = await c.newPage();
p.setDefaultTimeout(8000);
const shot = async (name) => {
  await p.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, name + ".txt"), await p.locator("body").innerText());
};
const click = (name) => p.getByRole("button", { name, exact: true }).click();
const body = () => p.locator("body").innerText();
const notices = () => p.getByRole("status").filter({ hasText: AUDIO_NOTICE }).count();
const answerUsable = () => p.getByLabel("Antwort", { exact: true }).isEnabled();

/** Hold the next matching request until released (after the real response was fetched). */
function holdNext(pattern, predicate = () => true) {
  let release, resolveHeld;
  const gate = new Promise((r) => (release = r));
  const held = new Promise((r) => (resolveHeld = r));
  let once = true;
  const handler = async (r) => {
    if (!once || !predicate(r.request())) return r.continue();
    once = false;
    const real = await r.fetch();
    const b = await real.body();
    resolveHeld(real.status());
    await gate;
    await r.fulfill({ response: real, body: b }).catch(() => {});
  };
  return { held, release, arm: () => p.route(pattern, handler), disarm: () => p.unroute(pattern, handler) };
}

try {
  // --------------------------------------------------------------------
  // Reach the first math item through the real UI (fresh database).
  // --------------------------------------------------------------------
  await p.goto(BASE + "/family/learn?child=santiago");
  await p.getByRole("link", { name: "Start", exact: false }).click();
  await click("Los geht's");
  await p.getByLabel("Name der Basis").fill("Repair Basis");
  await p.getByLabel("Name der Basis").press("Enter");
  await p.getByRole("heading", { name: "Wo steht „Repair Basis“?" }).waitFor();
  const v0 = await view();
  await click(new RegExp(v0.locations[0].label));
  await p.getByLabel("Antwort", { exact: true }).waitFor();
  check("setup: first math item reached with a named, placed base", (await view()).base?.name === "Repair Basis");

  // --------------------------------------------------------------------
  // Finding 1a — failed TTS fetch: honest unavailable state, controls usable,
  // help recorded conservatively, no success claim.
  // --------------------------------------------------------------------
  await click("🔊 Vorlesen");
  await p.getByRole("status").filter({ hasText: AUDIO_NOTICE }).waitFor();
  await shot("1a-audio-unavailable");
  check("1a failed TTS fetch shows an accessible audio-unavailable notice (role=status)", (await notices()) === 1);
  check("1a the request really failed at the TTS boundary (blocked fetch), no audio produced", ttsRequests.length === 1 && ttsRequests[0] === "blocked");
  check("1a typed answer and read-aloud controls stay usable; no stuck Stopp", (await answerUsable()) && (await p.getByRole("button", { name: "🔊 Vorlesen", exact: true }).isEnabled()) && (await p.getByRole("button", { name: "Stopp", exact: false }).count()) === 0);
  check("1a repeat/slow controls appear (help was recorded before playing)", (await p.getByRole("button", { name: "Vorlesen nochmal", exact: true }).count()) === 1 && (await p.getByRole("button", { name: "Vorlesen langsam", exact: true }).count()) === 1);
  check("1a read_aloud help is recorded conservatively even though nothing was heard", (await supports()).includes("read_aloud"));

  // 1b — retry via "Nochmal": notice cleared on start, shown again on failure, never duplicated; no new help record.
  const supportsBefore = (await supports()).filter((k) => k === "read_aloud").length;
  await click("Vorlesen nochmal");
  await p.getByRole("status").filter({ hasText: AUDIO_NOTICE }).waitFor();
  check("1b retry fails again with exactly one notice and no duplicate help record", (await notices()) === 1 && ttsRequests.length === 2 && (await supports()).filter((k) => k === "read_aloud").length === supportsBefore);

  // 1c — playback error (TTS returns 200 with undecodable bytes): still unavailable, never "played".
  ttsMode = "garbage";
  await click("Vorlesen langsam");
  await p.getByRole("status").filter({ hasText: AUDIO_NOTICE }).waitFor({ timeout: 15000 });
  await shot("1c-playback-error");
  check("1c undecodable audio (playback error) also reports unavailable, controls usable", (await notices()) === 1 && (await answerUsable()) && ttsRequests[2] === "garbage");
  ttsMode = "blocked";

  // 1d — stop while the help acknowledgement is pending: no notice, no TTS request, not playing.
  {
    const hold = holdNext("**/api/family/learning/mission", (req) => req.method() === "PUT");
    await hold.arm();
    const ttsBefore = ttsRequests.length;
    // A fresh text: pick the prompt again after a reload so the control has no recorded help yet.
    await p.reload();
    await p.getByLabel("Antwort", { exact: true }).waitFor();
    await click("🔊 Vorlesen");
    await hold.held;
    await click("■ Stopp");
    hold.release();
    await p.waitForTimeout(600);
    check("1d stop during the pending acknowledgement: no notice, no TTS request, not playing", (await notices()) === 0 && ttsRequests.length === ttsBefore && (await p.getByRole("button", { name: "Stopp", exact: false }).count()) === 0 && (await answerUsable()));
    await hold.disarm();
  }

  // 1e — tutor reply: reply text shown, speech fails → honest note; reply text stays.
  await p.route("**/api/family/assistant/session", (r) => r.fulfill({ json: { child: "santiago", sessionSuffix: "learn", token: "synthetic-only", expiresAt: Date.now() + 600000, bridgeUrl: BASE } }));
  await p.route("**/v1/child-turn", (r) => r.fulfill({ json: { v: 1, status: "ok", child: "santiago", blocks: [{ type: "text", text: "TUTOR_FIXTURE_REPLY: Teile die Pakete in vier gleiche Haufen." }], meta: { requestId: "m3-repair-fixture" } } }));
  await click("💬 Tutor");
  await p.getByLabel("Frage an den Tutor").fill("Wie teile ich?");
  await click("Fragen");
  await p.getByText("TUTOR_FIXTURE_REPLY", { exact: false }).waitFor();
  await p.getByText("Vorlesen geht gerade nicht — die Antwort steht oben zum Lesen.").waitFor();
  await shot("1e-tutor-speech-unavailable");
  check("1e tutor reply is shown and a failed read-aloud adds an honest note (reply stays readable)", (await body()).includes("TUTOR_FIXTURE_REPLY") && (await body()).includes("die Antwort steht oben zum Lesen"));
  await p.unroute("**/v1/child-turn");
  await p.unroute("**/api/family/assistant/session");

  // 1f — child switch (dispose) while the help acknowledgement is pending: Isabel's honest state, no notice, no TTS, no late audio.
  {
    await p.reload();
    await p.getByLabel("Antwort", { exact: true }).waitFor();
    const hold = holdNext("**/api/family/learning/mission", (req) => req.method() === "PUT");
    await hold.arm();
    const ttsBefore = ttsRequests.length;
    await click("🔊 Vorlesen");
    await hold.held;
    await p.getByRole("button", { name: "Santiago is using the iPad — switch child" }).click();
    await p.getByRole("button", { name: /Isabel/ }).click();
    hold.release();
    await p.getByRole("heading", { name: NOT_PREPARED }).waitFor();
    await p.waitForTimeout(500);
    await shot("1f-switch-during-pending-play");
    const b = await body();
    check("1f child switch during a pending play: Isabel's honest not-prepared state, no audio notice, no TTS request, nothing of Santiago", b.includes(NOT_PREPARED) && !AUDIO_NOTICE.test(b) && !MISLEADING.test(b) && !b.includes("Repair Basis") && ttsRequests.length === ttsBefore);
    await hold.disarm();
  }

  // --------------------------------------------------------------------
  // Finding 2 — honest not-prepared state on the mission path.
  // --------------------------------------------------------------------
  await p.goto(BASE + "/family/learn/mission?child=isabel");
  await p.getByRole("heading", { name: NOT_PREPARED }).waitFor();
  await shot("2a-direct-mission-link-isabel");
  check("2a direct mission link for Isabel shows the shared not-prepared state, no load-failure or saved-base wording", !MISLEADING.test(await body()) && (await p.getByRole("status").filter({ hasText: NOT_PREPARED }).count()) === 1);
  await p.goto(BASE + "/family/learn?child=isabel");
  await p.getByRole("heading", { name: NOT_PREPARED }).waitFor();
  check("2b cockpit for Isabel shows the same state (unchanged)", !MISLEADING.test(await body()));

  // 2c — the reviewer's flow: in-flight tutor turn, actual chooser switch to Isabel.
  await p.goto(BASE + "/family/learn/mission?child=santiago");
  await p.getByLabel("Antwort", { exact: true }).waitFor();
  await p.route("**/api/family/assistant/session", (r) => r.fulfill({ json: { child: "santiago", sessionSuffix: "learn", token: "synthetic-only", expiresAt: Date.now() + 600000, bridgeUrl: BASE } }));
  let release, reached;
  const gate = new Promise((r) => (release = r));
  const waiting = new Promise((r) => (reached = r));
  await p.route("**/v1/child-turn", async (r) => {
    reached();
    await gate;
    await r.fulfill({ json: { v: 1, status: "ok", child: "santiago", blocks: [{ type: "text", text: "LATE_SANTIAGO_ONLY_ANSWER 6" }], meta: { requestId: "m3-repair-late" } } }).catch(() => {});
  });
  await click("💬 Tutor");
  await p.getByLabel("Frage an den Tutor").fill("Wie teile ich?");
  await click("Fragen");
  await waiting;
  await p.getByRole("button", { name: "Santiago is using the iPad — switch child" }).click();
  await p.getByRole("button", { name: /Isabel/ }).click();
  release();
  await p.getByRole("heading", { name: NOT_PREPARED }).waitFor();
  await p.waitForTimeout(800);
  await shot("2c-switch-inflight");
  {
    const b = await body();
    check("2c in-flight tutor switch to Isabel: honest not-prepared state, late Santiago reply and base never appear, no misleading wording", b.includes(NOT_PREPARED) && !b.includes("LATE_SANTIAGO_ONLY_ANSWER") && !b.includes("Repair Basis") && !MISLEADING.test(b) && b.includes("Isabel"));
  }
  await p.unroute("**/v1/child-turn");
  await p.unroute("**/api/family/assistant/session");

  // 2d — switching back: Santiago's base is still there (no data lost by the honest state).
  await p.getByRole("button", { name: "Isabel is using the iPad — switch child" }).click();
  await p.getByRole("button", { name: /Santiago/ }).click();
  await p.getByLabel("Antwort", { exact: true }).waitFor();
  // The base name is not printed on the math screen; the API view is the durable truth.
  check("2d switching back to Santiago restores the mission (task shown) with the same durable base", (await view()).base?.name === "Repair Basis" && (await p.getByLabel("Antwort", { exact: true }).count()) === 1);

  // 2e — a genuine transient failure still says so, without claiming a saved base.
  await p.route("**/api/family/learning/mission", (r) => (r.request().method() === "GET" ? r.abort("internetdisconnected") : r.continue()));
  await p.goto(BASE + "/family/learn/mission?child=santiago");
  await p.getByRole("status").filter({ hasText: "Die Expedition lädt gerade nicht. Versuch es gleich nochmal." }).waitFor();
  check("2e a real load failure shows the honest transient message without a saved-base claim", !(await body()).includes("Basis ist gespeichert") && !(await body()).includes(NOT_PREPARED));
  await p.unroute("**/api/family/learning/mission");
  // --------------------------------------------------------------------
  // A01–A06 — cross-speaker cancellation and late failures on a mounted control.
  // --------------------------------------------------------------------
  const holdTts = () => {
    let release;
    ttsGate = new Promise((r) => (release = r));
    ttsMode = "hold";
    const before = ttsRequests.length;
    const reached = async () => {
      await p.waitForFunction(() => true); // yield
      for (let i = 0; i < 80 && ttsRequests.length === before; i++) await p.waitForTimeout(100);
      if (ttsRequests.length === before) throw new Error("held TTS request never arrived");
    };
    return { reached, release: () => { ttsMode = "blocked"; ttsGate = null; release(); } };
    // (ttsMode/ttsGate are already reset by the route handler once the held request arrived)
  };
  const tutorFixtures = async () => {
    await p.route("**/api/family/assistant/session", (r) => r.fulfill({ json: { child: "santiago", sessionSuffix: "learn", token: "synthetic-only", expiresAt: Date.now() + 600000, bridgeUrl: BASE } }));
    await p.route("**/v1/child-turn", (r) => r.fulfill({ json: { v: 1, status: "ok", child: "santiago", blocks: [{ type: "text", text: "TUTOR_FIXTURE_REPLY: Teile die Pakete in gleiche Haufen." }], meta: { requestId: "m3-a01" } } }));
  };
  const TUTOR_NOTE = "Vorlesen geht gerade nicht — die Antwort steht oben zum Lesen.";
  await p.goto(BASE + "/family/learn/mission?child=santiago");
  await p.getByLabel("Antwort", { exact: true }).waitFor();
  {
    // A01/A02: hold the prompt's TTS (after its help acknowledgement), let the tutor's speech supersede and fail, then release.
    const hold = holdTts();
    await click("🔊 Vorlesen");
    await hold.reached();
    await tutorFixtures();
    await click("💬 Tutor");
    await p.getByLabel("Frage an den Tutor").fill("Wie teile ich?");
    await click("Fragen");
    await p.getByText(TUTOR_NOTE).waitFor();
    hold.release();
    await p.waitForTimeout(600);
    const state = { mainEnabled: await p.getByRole("button", { name: "🔊 Vorlesen", exact: true }).isEnabled(), repeatEnabled: await p.getByRole("button", { name: "Vorlesen nochmal", exact: true }).isEnabled(), slowEnabled: await p.getByRole("button", { name: "Vorlesen langsam", exact: true }).isEnabled(), stopCount: await p.getByRole("button", { name: "■ Stopp", exact: true }).count(), answerEnabled: await answerUsable(), promptNotices: await notices(), tutorNotes: await p.getByText(TUTOR_NOTE).count(), tts: ttsRequests.slice(-2) };
    await shot("A01-cross-speaker-cancellation");
    check("A01 prompt control cancelled by the tutor's speech settles back to idle: Vorlesen/Nochmal/Langsam enabled, no Stopp", state.mainEnabled && state.repeatEnabled && state.slowEnabled && state.stopCount === 0, state);
    check("A02 cross-speaker cancellation keeps the typed answer usable and shows no stale prompt notice (only the tutor's own note)", state.answerEnabled && state.promptNotices === 0 && state.tutorNotes === 1, state);
    // A03 (retry after interruption): the same control plays again and reports its own failure honestly.
    await click("🔊 Vorlesen");
    await p.getByRole("status").filter({ hasText: AUDIO_NOTICE }).waitFor();
    check("A03 retry after an interruption works and reports its own failure (one notice)", (await notices()) === 1 && (await p.getByRole("button", { name: "🔊 Vorlesen", exact: true }).isEnabled()));
  }
  {
    // A04/A05: retry clears the previous notice while its TTS is held; Stopp during the held TTS ignores the late failure.
    const hold = holdTts();
    await click("Vorlesen nochmal");
    await hold.reached();
    check("A04 retry clears the previous unavailable notice while the new request is pending", (await notices()) === 0 && (await p.getByRole("button", { name: "■ Stopp", exact: true }).count()) === 1);
    await click("■ Stopp");
    hold.release();
    await p.waitForTimeout(400);
    check("A05 Stopp during a held TTS: late failure ignored, controls enabled, no notice", (await notices()) === 0 && (await p.getByRole("button", { name: "🔊 Vorlesen", exact: true }).isEnabled()) && (await p.getByRole("button", { name: "■ Stopp", exact: true }).count()) === 0);
  }
  {
    // A06: close the tutor while its speech is held; a late failure must not appear in the reopened panel.
    const notesBefore = await p.getByText(TUTOR_NOTE).count();
    const hold = holdTts();
    await p.getByLabel("Frage an den Tutor").fill("Wie teile ich jetzt?");
    await click("Fragen");
    await hold.reached();
    await p.getByRole("button", { name: "Tutor schliessen", exact: true }).click();
    hold.release();
    await p.waitForTimeout(300);
    await click("💬 Tutor");
    await p.waitForTimeout(300);
    check("A06 a closed tutor panel ignores a late speech failure after reopening", (await p.getByText(TUTOR_NOTE).count()) <= notesBefore);
    await p.unroute("**/v1/child-turn");
    await p.unroute("**/api/family/assistant/session");
  }
  // --------------------------------------------------------------------
  // A07 — malformed HTTP-200 mission responses are load errors, not absence.
  // --------------------------------------------------------------------
  const LOAD_ERROR = "Die Expedition lädt gerade nicht. Versuch es gleich nochmal.";
  const withMissionGet = async (payload, fn) => {
    const handler = (r) => (r.request().method() === "GET" ? r.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }) : r.continue());
    await p.route("**/api/family/learning/mission", handler);
    try {
      await fn();
    } finally {
      await p.unroute("**/api/family/learning/mission", handler);
    }
  };
  for (const [label, payload] of [["unexpected object", { unexpected: "malformed-response" }], ["view without child", { view: { revision: 1 } }], ["prepared flag for another child", { view: null, prepared: false, child: "isabel" }]]) {
    await withMissionGet(payload, async () => {
      await p.goto(BASE + "/family/learn/mission?child=santiago");
      await p.getByRole("status").filter({ hasText: LOAD_ERROR }).waitFor();
      const b = await body();
      check(`A07 mission: malformed 200 (${label}) is a recoverable load error, not "not prepared", no saved-base claim`, !b.includes(NOT_PREPARED) && !b.includes("Basis ist gespeichert"));
      await p.goto(BASE + "/family/learn?child=santiago");
      await p.getByRole("status").filter({ hasText: LOAD_ERROR }).waitFor();
      check(`A07 cockpit: malformed 200 (${label}) is a recoverable load error too`, !(await body()).includes(NOT_PREPARED));
    });
  }
  await shot("A07-malformed-mission-response");
  // r3 — the reviewer's exact matching-child probes on both surfaces: no page error, recoverable load error.
  for (const [label, payload] of [["child-only", { view: { child: "santiago" } }], ["contradictory", { child: "santiago", prepared: false, view: { child: "santiago" } }], ["partial-visit", { view: { child: "santiago", revision: 1, visit: { id: "v1" } } }]]) {
    for (const [surface, url] of [["mission", "/family/learn/mission?child=santiago"], ["cockpit", "/family/learn?child=santiago"]]) {
      const errors = [];
      const onError = (e) => errors.push(e.message);
      p.on("pageerror", onError);
      await withMissionGet(payload, async () => {
        await p.goto(BASE + url);
        await p.getByRole("status").filter({ hasText: LOAD_ERROR }).waitFor();
        const b = await body();
        check(`X-${label}-${surface} matching-child malformed view is a recoverable load error: no page exception, no error boundary, not "not prepared"`, errors.length === 0 && !b.includes("couldn’t load") && !b.includes("Application error") && !b.includes(NOT_PREPARED) && !b.includes("Basis ist gespeichert"), { errors });
      });
      p.off("pageerror", onError);
      if (label === "child-only" && surface === "mission") await shot("X-child-only-mission");
    }
  }
  // r3 — the write-response seam: a malformed applied view must not crash the mission; the durable state is untouched.
  {
    await p.goto(BASE + "/family/learn/mission?child=santiago");
    await p.getByLabel("Antwort", { exact: true }).waitFor();
    const errors = [];
    const onError = (e) => errors.push(e.message);
    p.on("pageerror", onError);
    const handler = (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "applied", view: { child: "santiago" }, result: {} }) }) : r.continue());
    await p.route("**/api/family/learning/mission", handler);
    await p.getByLabel("Antwort", { exact: true }).fill("6");
    await click("Fertig");
    await p.getByText("Etwas hat nicht geklappt. Versuch es nochmal.").waitFor();
    await p.unroute("**/api/family/learning/mission", handler);
    p.off("pageerror", onError);
    const v = await view();
    check("X-write-seam malformed applied view is refused: honest notice, no page exception, task unchanged, durable state intact", errors.length === 0 && (await answerUsable()) && v.math?.id === "EQ-ENTRY" && v.base?.name === "Repair Basis", { errors, math: v.math?.id });
  }
  await withMissionGet({ view: null, prepared: false, child: "santiago" }, async () => {
    await p.goto(BASE + "/family/learn/mission?child=santiago");
    await p.getByRole("heading", { name: NOT_PREPARED }).waitFor();
    check("A07 the server's explicit prepared:false answer is still the not-prepared state", !(await body()).includes(LOAD_ERROR));
  });
  await p.goto(BASE + "/family/learn/mission?child=santiago");
  await p.getByLabel("Antwort", { exact: true }).waitFor();
  check("A07 the real mission is intact afterwards (durable base unchanged)", (await view()).base?.name === "Repair Basis");
} catch (error) {
  check("browser harness completion", false, String(error && error.stack ? error.stack : error));
  await shot("harness-failure").catch(() => {});
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, "m3-repair-results.json"), JSON.stringify(results, null, 2));
  console.log("SUMMARY", results.filter((r) => r.ok).length, "/", results.length);
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}
