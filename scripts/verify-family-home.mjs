// Self-check harness for the unified Family Home + coin-metered play candidate (2026-10-04).
// HTTP + headless-browser journeys against a LOCAL production server (scripts/run-family-home-server.sh) with a
// synthetic AUTH_SECRET, an isolated SQLite database seeded with SYNTHETIC "Fixture Basis" rows, and an isolated Game
// Studio child adapter (read-only against the local Studio library). Nothing touches production.
//
//   AUTH_SECRET=<same as server> node scripts/verify-family-home.mjs --base http://127.0.0.1:3181 --out <dir>
//
// Builder self-check, not the independent acceptance (GP-10). Results: <out>/results.json + screenshots.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";
import { audioSafeChromiumLaunchOptions } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = opt("--base", "http://127.0.0.1:3181").replace(/\/$/, "");
const out = opt("--out", "/tmp/nfh-selfcheck");
fs.mkdirSync(out, { recursive: true });
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("AUTH_SECRET required");
const COOKIE = "authjs.session-token";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/.npm-global/lib/node_modules/playwright`);

const results = [];
function record(id, name, ok, detail = "") {
  results.push({ id, name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
}
async function sessionCookie(email) {
  const now = Math.floor(Date.now() / 1000);
  return `${COOKIE}=${await encode({ token: { email, name: email, sub: email, iat: now, exp: now + 3600 }, secret, salt: COOKIE, maxAge: 3600 })}`;
}
async function call(method, p, { cookie, bearer, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  if (body !== undefined) h["content-type"] = "application/json";
  const url = p.startsWith("http") ? p : base + p;
  const res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, location: res.headers.get("location"), headers: res.headers, text, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const assistant = await sessionCookie("assistant@davideberle.com");
const owner = await sessionCookie("info@davideberle.com");
await call("GET", "/api/family/wallet", { cookie: assistant }); // warm migrations

// ---------------------------------------------------------------------------
// HTTP: access, denials, wallet, purchase, lease lifecycle, activity
// ---------------------------------------------------------------------------
{
  const r = await call("GET", "/login", { cookie: assistant });
  record("H-01", "shared child account lands on /family/home", r.status === 302 && r.location?.endsWith("/family/home"), `${r.status} ${r.location}`);
  const root = await call("GET", "/", { cookie: assistant });
  record("H-02", "child account is redirected from adult surfaces to Family Home", root.status === 302 && root.location?.endsWith("/family/home"), `${root.status} ${root.location}`);
  const parent = await call("GET", "/family/learn/parent", { cookie: assistant });
  record("H-03", "child account never reaches the parent learning page", parent.status === 302, `${parent.status}`);
  const ownerHome = await call("GET", "/family/home?child=santiago", { cookie: owner });
  record("H-04", "owner can open a child shortcut", ownerHome.status === 200, `${ownerHome.status}`);
  for (const p of ["/family/home", "/family/home?child=isabel", "/family/activity?child=santiago", "/family/games?child=santiago", "/family/assistant", "/family/plan?child=santiago", "/family/rewards?child=santiago", "/family/listen?child=santiago", "/family/learn?child=santiago", "/family/rewards/chess?child=santiago", "/games/adaptive-chess-coach/index.html"]) {
    const x = await call("GET", p, { cookie: assistant });
    record("H-05", `legacy and new child routes resolve: ${p}`, x.status === 200, `${x.status}`);
  }
  const chessRedirect = await call("GET", "/family/games/play?game=adaptive-chess-coach&child=santiago", { cookie: assistant });
  record("H-06", "chess stays on its free local launch page", [302, 307, 308].includes(chessRedirect.status) && chessRedirect.location?.includes("/family/rewards/chess"), `${chessRedirect.status} ${chessRedirect.location}`);
}
{
  record("H-10", "play state without session → 401", (await call("GET", "/api/family/play/state")).status === 401);
  record("H-11", "play state with session but no bearer → 401", (await call("GET", "/api/family/play/state", { cookie: assistant })).status === 401);
  const learn = await call("POST", "/api/family/learning/session", { cookie: assistant, body: { childId: "santiago" } });
  const asLearning = await call("GET", "/api/family/play/state", { cookie: assistant, bearer: learn.json?.token });
  record("H-12", "a learning credential is refused as a games bearer", asLearning.status === 401, `${asLearning.status}`);
  const refund = await call("POST", "/api/family/play/purchases/abc12345/refund", { cookie: assistant, body: { reason: "x" } });
  record("H-13", "child account cannot reach the refund (compensation) route", refund.status === 403, `${refund.status}`);
  const refundOwner = await call("POST", "/api/family/play/purchases/abc12345/refund", { cookie: owner, body: { reason: "x" } });
  record("H-14", "owner refund route exists and reports an unknown purchase", refundOwner.status === 404, `${refundOwner.status}`);
  const settleAnon = await call("POST", "/api/family/play/leases/lease-abcdefghijkl/settle", { body: { consumedSeconds: 1, end: false } });
  record("H-15", "unsigned settlement is refused", settleAnon.status === 401, `${settleAnon.status}`);
}

const wallet0 = (await call("GET", "/api/family/wallet", { cookie: assistant })).json;
const santiago0 = wallet0.wallets.santiago.balance;
const isabel0 = wallet0.wallets.isabel.balance;
record("H-20", "seeded fixture wallets read back (santiago 8, isabel 2)", santiago0 === 8 && isabel0 === 2, JSON.stringify({ santiago0, isabel0 }));
const completionsBefore = (await call("GET", "/api/family/activity?person=santiago", { cookie: assistant })).json.items.filter((i) => i.kind === "claim").length;

const mintS = (await call("POST", "/api/family/games/session", { cookie: assistant, body: { childId: "santiago" } })).json;
const mintI = (await call("POST", "/api/family/games/session", { cookie: assistant, body: { childId: "isabel" } })).json;
record("H-21", "games session mints a bearer and a Studio library credential", mintS?.token && mintS?.studio?.url && mintS?.studio?.token, mintS?.studio?.url);
const state0 = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
record("H-22", "GP-01 price is 3 coins / 900 s, chess free, allowance starts at zero", state0.price.coins === 3 && state0.price.seconds === 900 && state0.freeGameIds.includes("adaptive-chess-coach") && state0.remainingSeconds === 0, JSON.stringify(state0.price));

const key = `selfcheck-${Date.now()}`;
const buy1 = await call("POST", "/api/family/play/purchases", { cookie: assistant, bearer: mintS.token, body: { idempotencyKey: key } });
const buy2 = await call("POST", "/api/family/play/purchases", { cookie: assistant, bearer: mintS.token, body: { idempotencyKey: key } });
record("H-23", "GP-02 purchase debits 3 coins and grants 900 s once; the same key replays", buy1.status === 201 && buy1.json.balance === santiago0 - 3 && buy1.json.remainingSeconds === 900 && buy2.status === 200 && buy2.json.replayed === true && buy2.json.balance === santiago0 - 3, `${buy1.status}/${buy2.status} ${buy1.json?.balance} ${buy2.json?.balance}`);
const wallet1 = (await call("GET", "/api/family/wallet", { cookie: assistant })).json;
record("H-24", "FH-06 the wallet projection shows the same debit", wallet1.wallets.santiago.balance === santiago0 - 3 && wallet1.wallets.santiago.spent === 3, JSON.stringify(wallet1.wallets.santiago));
const buyI = await call("POST", "/api/family/play/purchases", { cookie: assistant, bearer: mintI.token, body: { idempotencyKey: `${key}-i` } });
record("H-25", "GP-02 insufficient funds commits nothing", buyI.status === 409 && (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.isabel.balance === isabel0, `${buyI.status}`);

const SNAKE = "6bd56478-5ea0-4f2a-a2db-be8549a88d05";
const lease1 = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: SNAKE, mode: "play", device: "harness-a" } });
record("H-30", "lease for an approved paid game: metered, budget 900, Studio credential issued", lease1.status === 201 && lease1.json.lease.metered && lease1.json.lease.budgetSeconds === 900 && lease1.json.studio?.token, `${lease1.status}`);
const studio = lease1.json.studio;
const leaseId = lease1.json.lease.id;
const lease2 = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: SNAKE, mode: "play", device: "harness-b" } });
record("H-31", "GP-03 a second device cannot take a parallel lease", lease2.status === 409 && lease2.json.heldBy?.leaseId === leaseId, `${lease2.status}`);
const wrongChild = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintI.token, body: { gameId: SNAKE, mode: "play" } });
record("H-32", "GP-08 the sibling has no allowance and gets no metered lease", wrongChild.status === 402, `${wrongChild.status}`);

const content = await call("GET", `${studio.url}/v1/play/${leaseId}/${SNAKE}/index.html?credential=${encodeURIComponent(studio.token)}`);
record("H-33", "guarded content served with the injected guard and pinned frame-ancestors", content.status === 200 && content.text.includes("data-family-play-guard") && content.headers.get("content-security-policy") === `frame-ancestors ${new URL(base).origin}`, `${content.status}`);
const rawContent = await call("GET", `${studio.url}/v1/play/${leaseId}/${SNAKE}/index.html`);
record("H-34", "raw content URL without the lease credential is refused", rawContent.status === 401, `${rawContent.status}`);
const otherGame = await call("GET", `${studio.url}/v1/play/${leaseId}/adaptive-chess-coach/index.html?credential=${encodeURIComponent(studio.token)}`);
record("H-35", "the lease credential cannot open a different game", otherGame.status === 403, `${otherGame.status}`);
const libraryCredAsLease = await call("POST", `${studio.url}/v1/play/${leaseId}/tick`, { bearer: mintS.studio.token, body: { active: true } });
record("H-36", "a library credential cannot tick a lease", libraryCredAsLease.status === 403, `${libraryCredAsLease.status}`);
const siblingTick = await call("POST", `${studio.url}/v1/play/${leaseId}/tick`, { bearer: mintI.studio.token, body: { active: true } });
record("H-37", "the sibling's credential cannot tick this lease", siblingTick.status === 403, `${siblingTick.status}`);

const t0 = await call("POST", `${studio.url}/v1/play/${leaseId}/tick`, { bearer: studio.token, body: { active: true } });
await sleep(2100);
const t1 = await call("POST", `${studio.url}/v1/play/${leaseId}/tick`, { bearer: studio.token, body: { active: true } });
await sleep(2100);
const t2 = await call("POST", `${studio.url}/v1/play/${leaseId}/tick`, { bearer: studio.token, body: { active: false, hidden: true } });
await sleep(2100);
const t3 = await call("POST", `${studio.url}/v1/play/${leaseId}/tick`, { bearer: studio.token, body: { active: false, hidden: true } });
record("H-38", "GP-04/05 server clock: foreground seconds count, hidden seconds do not", t0.json.remainingSeconds === 900 && t1.json.remainingSeconds <= 898 && t1.json.remainingSeconds >= 896 && t2.json.remainingSeconds <= t1.json.remainingSeconds && t3.json.remainingSeconds === t2.json.remainingSeconds, JSON.stringify([t0.json.remainingSeconds, t1.json.remainingSeconds, t2.json.remainingSeconds, t3.json.remainingSeconds]));
const ended = await call("POST", `${studio.url}/v1/play/${leaseId}/end`, { bearer: studio.token, body: { reason: "harness" } });
await sleep(400);
const stateAfter = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
record("H-39", "GP-07 settlement reached Family: allowance consumed by the measured seconds, lease closed", ended.json.ended && stateAfter.activeLease === null && stateAfter.remainingSeconds < 900 && stateAfter.remainingSeconds >= 893, JSON.stringify({ remaining: stateAfter.remainingSeconds, consumed: ended.json.consumedSeconds }));
const afterEnd = await call("POST", `${studio.url}/v1/play/${leaseId}/tick`, { bearer: studio.token, body: { active: true } });
record("H-40", "an ended lease stays ended (410)", afterEnd.status === 410, `${afterEnd.status}`);
const replaySettle = await call("POST", "/api/family/play/leases/" + leaseId + "/settle", { body: { consumedSeconds: 5000, end: true }, headers: { "x-family-play-timestamp": "1", "x-family-play-signature": "v1=00" } });
record("H-41", "a forged settlement is refused", replaySettle.status === 401, `${replaySettle.status}`);
const lease3 = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: SNAKE, mode: "play", device: "harness-c" } });
record("H-42", "GP-03 the next lease carries the remaining allowance as its budget", lease3.status === 201 && lease3.json.lease.budgetSeconds === stateAfter.remainingSeconds, `${lease3.json?.lease?.budgetSeconds}`);
await call("POST", `/api/family/play/leases/${lease3.json.lease.id}/release`, { cookie: assistant, bearer: mintS.token, body: { reason: "harness" } });
const editLease = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintI.token, body: { gameId: SNAKE, mode: "edit" } });
record("H-43", "GP-04 Edit mode is an unmetered lease even without allowance", editLease.status === 201 && editLease.json.lease.metered === false, `${editLease.status}`);
await call("POST", `/api/family/play/leases/${editLease.json?.lease?.id}/release`, { cookie: assistant, bearer: mintI.token, body: { reason: "harness" } });

{
  const red = await call("POST", "/api/family/redemptions", { cookie: assistant, body: { personId: "santiago", rewardId: "friends", idempotencyKey: `${key}-r` } });
  const red2 = await call("POST", "/api/family/redemptions", { cookie: assistant, body: { personId: "santiago", rewardId: "friends", idempotencyKey: `${key}-r` } });
  const w = (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.santiago;
  record("H-50", "FH-07 a confirmed redemption debits once; a duplicate tap replays", red.status === 200 && red2.status === 200 && red2.json.replayed === true && w.spent === 3 + red.json.chargedPoints, JSON.stringify({ spent: w.spent, charged: red.json?.chargedPoints }));
  const act = (await call("GET", "/api/family/activity?person=santiago", { cookie: assistant })).json;
  const ids = act.items.map((i) => i.id);
  const pending = act.items.find((i) => i.id.endsWith("s-kumon:5"));
  const redo = act.items.find((i) => i.id.endsWith("2026-W39:santiago:s-piano:4"));
  record("H-51", "FH-08 activity is source-linked, unique, one item per claim, pending/redo earn nothing", new Set(ids).size === ids.length && pending?.status === "pending" && pending.coinDelta === null && redo?.status === "try-again" && redo.coinDelta === null && act.items.some((i) => i.kind === "play-purchase" && i.coinDelta === -3) && act.items.some((i) => i.kind === "redemption"), `${ids.length} items`);
  record("H-52", "FH-08 the sibling's activity never contains the other child's items", (await call("GET", "/api/family/activity?person=isabel", { cookie: assistant })).json.items.every((i) => i.personId === "isabel"));
  const completionsAfter = act.items.filter((i) => i.kind === "claim").length;
  record("H-53", "GP-09 no completion rows were created or lost by play/purchase/redeem", completionsAfter === completionsBefore, `${completionsBefore} → ${completionsAfter}`);
  const walletByWeek = await call("GET", "/api/family/redemptions?week=2026-W12", { cookie: assistant });
  record("H-54", "weekly filters never change the wallet balance", walletByWeek.status === 200 && (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.santiago.balance === w.balance);
}

// ---------------------------------------------------------------------------
// Browser journeys — desktop keyboard and tablet touch
// ---------------------------------------------------------------------------
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function context(viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, baseURL: base });
  await ctx.addCookies([{ name: COOKIE, value: assistant.split("=").slice(1).join("="), url: base }]);
  return ctx;
}
const shot = async (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });

{
  const ctx = await context({ width: 1280, height: 800 }, false);
  const page = await ctx.newPage();
  await page.goto("/family/home");
  const dialog = page.getByRole("dialog", { name: "Choose your profile" });
  await dialog.waitFor({ timeout: 15000 });
  record("B-01", "FH-02 bare /family/home shows the profile chooser", await dialog.isVisible());
  record("B-02", "FH-03 no device-specific identity question", !(await page.content()).includes("using the iPad"));
  await shot(page, "desktop-01-chooser");
  await page.keyboard.press("Enter"); // first card is focused on open
  await page.waitForURL(/child=santiago/, { timeout: 10000 });
  await page.getByRole("heading", { name: /Hey Santiago/ }).waitFor();
  record("B-03", "keyboard: Enter on the focused card opens Santiago's Home with the child in the URL", page.url().includes("/family/home?child=santiago"));
  const walletNow = (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.santiago.balance;
  await page.getByText(`You have ${walletNow} coins`).waitFor({ timeout: 10000 });
  const chip = page.getByRole("link", { name: new RegExp(`^${walletNow} coins`) });
  record("B-04", "FH-06 Home balance and header chip show the same authoritative number", await chip.isVisible(), `${walletNow}`);
  for (const label of ["Record something I did", "Redeem", "See activity", "Lernen", "Ask Nabu", "Games", "Music", "Hörspiele"]) {
    record("B-05", `FH-01 Home reaches: ${label}`, await page.getByRole("link", { name: new RegExp(label) }).first().isVisible());
  }
  await page.waitForFunction(() => !document.body.innerText.includes("wird geladen"), null, { timeout: 15000 }).catch(() => {});
  const learnText = await page.getByRole("link", { name: /Lernen/ }).innerText();
  record("B-06", "FH-05 learning entry shows a saved-state label, not a loading placeholder", !/wird geladen/.test(learnText), learnText.replace(/\s+/g, " ").slice(0, 80));
  await shot(page, "desktop-02-home-santiago");
  await page.getByRole("link", { name: /See activity/ }).click();
  await page.waitForURL(/\/family\/activity\?child=santiago/);
  await page.getByRole("list", { name: "Activity" }).waitFor({ timeout: 15000 });
  const items = await page.locator("[data-activity-id]").count();
  record("B-07", "FH-08 Activity renders the chronology", items >= 8, `${items} items`);
  await page.getByRole("button", { name: "This week" }).click();
  const weekItems = await page.locator("[data-activity-id]").count();
  record("B-08", "weekly filter narrows the list and keeps the wallet chip", weekItems < items && (await chip.isVisible()), `${weekItems} < ${items}`);
  await shot(page, "desktop-03-activity");
  // Profile switch → the other child's Home
  await page.getByRole("button", { name: /switch profile/ }).click();
  await page.getByRole("button", { name: /Open Isabel/ }).click();
  await page.waitForURL(/\/family\/home\?child=isabel/, { timeout: 10000 });
  await page.getByRole("heading", { name: /Hi Isabel/ }).waitFor();
  const isabelNow = (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.isabel.balance;
  await page.getByText(`You have ${isabelNow} coins`).waitFor({ timeout: 10000 });
  const headings = await page.getByRole("heading", { level: 1 }).allInnerTexts();
  record("B-09", "switching profiles opens the other child's Home with their own wallet (no sibling flash)", page.url().includes("child=isabel") && headings.some((h) => /Hi Isabel/.test(h)) && !headings.some((h) => /Santiago/.test(h)), `isabel=${isabelNow} shown; headings=${headings.join("|")}`);
  await shot(page, "desktop-04-home-isabel");
  const fresh = await ctx.newPage();
  await fresh.goto("/family/home");
  record("B-10", "FH-02 a fresh bare entry shows the chooser again (no remembered profile)", await fresh.getByRole("dialog", { name: "Choose your profile" }).isVisible());
  await fresh.goto("/family/rewards");
  record("B-11", "a bare legacy route also leads to the chooser", await fresh.getByRole("dialog", { name: "Choose your profile" }).isVisible());
  await fresh.close();
  // Redeem confirm step from Home
  await page.getByRole("link", { name: "🏅 Redeem" }).click();
  await page.waitForURL(/\/family\/rewards\?child=isabel/);
  await page.getByRole("region", { name: "Coin wallet" }).waitFor({ timeout: 15000 });
  const getIt = page.getByRole("button", { name: "Get it" }).first();
  const affordable = (await getIt.count()) > 0 && (await getIt.isEnabled().catch(() => false));
  if (affordable) {
    await getIt.click();
    record("B-12", "FH-07 redeeming asks for confirmation with the exact cost first", await page.getByRole("button", { name: /Yes, get it for/ }).isVisible());
    await page.getByRole("button", { name: "Not now" }).click();
  } else {
    record("B-12", "FH-07 redeem shows the shortfall when unaffordable (no confirm needed)", (await page.getByRole("button", { name: /more$/ }).count()) > 0);
  }
  await shot(page, "desktop-05-rewards-isabel");
  await ctx.close();
}

{
  const ctx = await context({ width: 1024, height: 768 }, true);
  const page = await ctx.newPage();
  await page.goto("/family/home");
  await page.getByRole("dialog", { name: "Choose your profile" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Open Santiago/ }).tap();
  await page.waitForURL(/child=santiago/);
  await page.getByRole("link", { name: /Games/ }).first().tap();
  await page.waitForURL(/\/family\/games\?child=santiago/);
  await page.getByRole("region", { name: "Play time" }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("[data-remaining-seconds]") !== null, null, { timeout: 15000 });
  const remainingShown = await page.locator("[data-remaining-seconds]").first().getAttribute("data-remaining-seconds");
  const expected = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json.remainingSeconds;
  record("T-01", "GP-05 Games shows the server's remaining allowance", Number(remainingShown) === expected, `${remainingShown} vs ${expected}`);
  await page.getByText("Free").first().waitFor();
  record("T-02", "GP-01 chess is listed free; the approved paid game shows 3 coins / 15 min", (await page.getByText("Chess Coach").count()) > 0 && (await page.getByText("🪙 3 / 15 min").count()) > 0);
  record("T-03", "approved library comes from the child adapter (Super Snake approved for Santiago)", (await page.locator(`[data-game-id="${SNAKE}"]`).count()) === 1);
  await shot(page, "tablet-01-games");
  await page.locator(`[data-game-id="${SNAKE}"]`).getByRole("link", { name: /Play/ }).tap();
  await page.waitForURL(/\/family\/games\/play\?game=/);
  const frame = page.locator("iframe[title^='Game for']");
  await frame.waitFor({ timeout: 20000 });
  const src = await frame.getAttribute("src");
  record("T-04", "guarded play loads the game only through the Studio lease URL", src?.includes("/v1/play/") && src.includes("credential="), src?.slice(0, 80));
  await page.waitForFunction(() => /\d+:\d\d/.test(document.querySelector("[data-remaining-seconds]")?.textContent || ""), null, { timeout: 20000 });
  const clock1 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  await page.waitForTimeout(6000);
  const clock2 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  record("T-05", "GP-05 the play clock is the server's and moves while playing in the foreground", Number(clock2) < Number(clock1), `${clock1} → ${clock2}`);
  await shot(page, "tablet-02-playing");
  await page.getByRole("button", { name: /Pause/ }).tap();
  await page.getByRole("dialog", { name: "Paused" }).waitFor();
  await page.waitForTimeout(1500); // the immediate pause tick settles the last active interval
  const paused1 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  await page.waitForTimeout(6000);
  const paused2 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  record("T-06", "GP-04 an explicit pause stops the clock", Number(paused2) >= Number(paused1) - 1, `${paused1} → ${paused2}`);
  await shot(page, "tablet-03-paused");
  await page.getByRole("button", { name: /Continue/ }).tap();
  await page.getByRole("link", { name: /Games/ }).first().tap();
  await page.waitForURL(/\/family\/games\?child=santiago/);
  await sleep(600);
  const st = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
  record("T-07", "leaving the game releases the lease and the remaining time is persisted server-side", st.activeLease === null && st.remainingSeconds < expected, JSON.stringify({ before: expected, after: st.remainingSeconds }));
  // Isabel's library: no Super Snake, chess free
  const p2 = await ctx.newPage();
  await p2.goto("/family/games?child=isabel");
  await p2.getByRole("region", { name: "Approved games" }).waitFor({ timeout: 15000 });
  await p2.waitForFunction(() => !document.body.innerText.includes("Loading the library"), null, { timeout: 15000 });
  record("T-08", "GP-08 the sibling's library does not include a game approved only for Santiago", (await p2.locator(`[data-game-id="${SNAKE}"]`).count()) === 0);
  await shot(p2, "tablet-04-games-isabel");
  await ctx.close();
}
await browser.close();

const summary = { base, at: new Date().toISOString(), total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => r.id), results };
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${summary.total} passed${summary.failed.length ? `; failed: ${summary.failed.join(", ")}` : ""}`);
process.exit(summary.failed.length ? 1 : 0);
