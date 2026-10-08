#!/usr/bin/env node
// Seeds the ISOLATED local SQLite (NABU_DB_DIR) for the Family simplification self-check with SYNTHETIC rows only.
//   AUTH_SECRET=<synthetic> node scripts/seed-family-fixture.mjs --base http://127.0.0.1:3191 --db /tmp/nfs-localdb/nabu.db
// Warms the server first (so the runtime schema guards create every table), then inserts:
//   - two weeks of completions for both children in every review state, with explicit provenance;
//   - a parent-approved activity occurring TODAY (Europe/Zurich) for Santiago only (chess eligible), none for Isabel;
//   - one historical redemption of a now-retired reward ("friends") for Santiago in 2026-W40.
// Never run against a production database.
import { createClient } from "@libsql/client";
import { encode } from "@auth/core/jwt";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = opt("--base", "http://127.0.0.1:3191");
const db = opt("--db", "/tmp/nfs-localdb/nabu.db");
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("AUTH_SECRET required");
if (/production|turso|libsql:\/\//.test(db)) throw new Error("refusing a non-local database");

const COOKIE = "authjs.session-token";
const now = Math.floor(Date.now() / 1000);
const cookie = `${COOKIE}=${await encode({ token: { email: "assistant@davideberle.com", name: "a", sub: "a", iat: now, exp: now + 3600 }, secret, salt: COOKIE, maxAge: 3600 })}`;
for (let i = 0; i < 10; i += 1) {
  const w = await fetch(`${base}/api/family/wallet`, { headers: { cookie } }).catch(() => null);
  if (w && w.status === 200) break;
  await new Promise((r) => setTimeout(r, 1000));
}
// Play tables are created lazily by the play routes: touch one so the chess allowance table exists for direct checks.
await fetch(`${base}/api/family/play/state`, { headers: { cookie } }).catch(() => null);

// Zurich "today" the same way the server derives it.
const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const get = (t) => parts.find((p) => p.type === t).value;
const wall = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
const todayIso = wall.toISOString().slice(0, 10);
const jsDay = wall.getUTCDay();
const todayDay = jsDay === 0 ? 6 : jsDay - 1;
const w = new Date(wall); const dn = w.getUTCDay() || 7; w.setUTCDate(w.getUTCDate() + 4 - dn);
const ys = new Date(Date.UTC(w.getUTCFullYear(), 0, 1));
const todayWeek = `${w.getUTCFullYear()}-W${String(Math.ceil(((w - ys) / 86400000 + 1) / 7)).padStart(2, "0")}`;

const c = createClient({ url: `file:${db}` });
const rows = [
  // [person, routine, week, day, status, created_at, reviewed_at, credit_count, awarded_points, summary, approval_source]
  ["santiago", "s-kumon", "2026-W40", 0, "done", "2026-09-28T15:00:00.000Z", "2026-09-28T18:00:00.000Z", 2, 2, "Fixture Basis: two sheets", "parent-review"],
  ["santiago", "s-piano", "2026-W40", 1, "done", "2026-09-29T15:00:00.000Z", "2026-09-29T18:00:00.000Z", 1, 1, null, null], // legacy parent review (reviewed_at only)
  ["santiago", "s-exercise", "2026-W40", 2, "done", "2026-09-30T15:00:00.000Z", null, 1, 1, null, null], // self-marked, legacy (no provenance)
  ["santiago", "s-physio", "2026-W40", 3, "done", "2026-10-01T15:00:00.000Z", "2026-10-01T18:00:00.000Z", 1, 1, null, "parent-review"],
  ["santiago", "s-table-dinner", "2026-W40", 4, "done", "2026-10-02T15:00:00.000Z", "2026-10-02T18:00:00.000Z", 1, 1, null, "parent-review"],
  ["santiago", "s-extra-bonus", "2026-W40", 5, "done", "2026-10-03T15:00:00.000Z", "2026-10-03T18:00:00.000Z", 1, 1, null, "parent-review"],
  ["santiago", "s-kumon", "2026-W40", 5, "pending_review", "2026-10-03T16:00:00.000Z", null, 1, null, "Fixture Basis: one sheet waiting", null],
  ["santiago", "s-piano", "2026-W39", 4, "redo", "2026-09-25T15:00:00.000Z", "2026-09-25T18:00:00.000Z", 1, null, null, null],
  ["santiago", "s-physio", "2026-W39", 2, "on_hold", "2026-09-23T15:00:00.000Z", "2026-09-23T18:00:00.000Z", 1, null, "Fixture Basis: held", null],
  ["isabel", "i-kumon", "2026-W40", 0, "done", "2026-09-28T15:00:00.000Z", "2026-09-28T18:00:00.000Z", 2, 2, "Fixture Basis: two sheets", "parent-review"],
  ["isabel", "i-piano", "2026-W40", 1, "pending_review", "2026-10-02T15:00:00.000Z", null, 1, null, null, null],
  // TODAY: Santiago has a parent-approved activity occurring today (chess unlocked); Isabel has only a pending one.
  ["santiago", "s-kumon", todayWeek, todayDay, "done", `${todayIso}T06:30:00.000Z`, `${todayIso}T07:00:00.000Z`, 1, 1, "Fixture Basis: today's sheet", "parent-review"],
  ["isabel", "i-kumon", todayWeek, todayDay, "pending_review", `${todayIso}T06:40:00.000Z`, null, 1, null, "Fixture Basis: today's sheet, waiting", null],
];
for (const r of rows) await c.execute({ sql: "INSERT OR REPLACE INTO family_completions (person_id, routine_id, week, day, status, created_at, reviewed_at, credit_count, awarded_points, normalized_summary, approval_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: r });
await c.execute({ sql: "INSERT OR REPLACE INTO family_reward_redemptions (id, person_id, reward_id, week, created_at, charged_points) VALUES (?,?,?,?,?,?)", args: ["fixture-redemption-friends-w40", "santiago", "friends", "2026-W40", "2026-10-02T17:00:00.000Z", 3] });
const wallet = await (await fetch(`${base}/api/family/wallet`, { headers: { cookie } })).json();
console.log(JSON.stringify({ seeded: rows.length, today: { date: todayIso, week: todayWeek, day: todayDay }, wallets: { santiago: wallet.wallets.santiago, isabel: wallet.wallets.isabel } }));
