// Visit 7 — LOOPBACK STUB of the family runtime's Nokt route for the browser-mediated turn checks (never the real
// bridge, never a model).
//
//   FAMILY_BRIDGE_TOKEN_SECRET=<synthetic ≥32 chars> node scripts/visit7-nokt-stub-bridge.mjs <port> <log.jsonl> <app-origin>
//
// Serves POST /v1/nokt/turn to the BROWSER: CORS for exactly <app-origin> (preflight included, bearer only, never
// credentials), the app-minted fcm1 token checked with the same synthetic secret (HMAC, audience family-child-media,
// session `learn`), then a SCRIPTED fictional reply signed with an fcr1 receipt — the construction the runtime candidate
// uses (src/nokt/receipt.ts). The app can only verify; signing exists here, in a test tool, and nowhere in the app.
// Every call is logged (shape only): origin, token verdict, whether the request held an "answer" field, the app's phase.
//
// Script by call order (fictional model outputs, including adversarial ones):
//   1  a neutral clarification, correctly signed                    → shown as Nokt
//   2  «teach» label with the answer in the assessment phase, signed → withheld by the app (intent-not-in-phase)
//   3  a fine clarification, receipt signed with ANOTHER secret      → withheld (origin invalid)
//   4+ a fine reply after a 3 s delay (the page navigates away)      → never recorded as a Nokt line
// SCRIPTED HISTORY (round 12): a body carrying `scripted: "<reply JSON>"` is answered with exactly that text, signed — so a
// fictional earlier Nokt line can be put through the REAL dispatch → verification → engine path before one final live
// turn goes to the model. Labelled `scripted: true` in the log; never counted as a model attempt. The real runtime
// refuses this field (closed body).
import http from "node:http";
import fs from "node:fs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const port = Number(process.argv[2] || 3299);
const log = process.argv[3] || "/tmp/visit7-nokt-stub-bridge.jsonl";
const APP_ORIGIN = process.argv[4] || "http://127.0.0.1:3196";
const SECRET = process.env.FAMILY_BRIDGE_TOKEN_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("FAMILY_BRIDGE_TOKEN_SECRET (synthetic, ≥ 32 chars) is required");
  process.exit(2);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const b64u = (s) => Buffer.from(s).toString("base64url");
function tokenVerdict(header) {
  const m = /^Bearer\s+(fcm1)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header ?? "");
  if (!m) return { ok: false, why: "missing" };
  const expected = createHmac("sha256", SECRET).update(`${m[1]}.${m[2]}`).digest("base64url");
  if (expected.length !== m[3].length || !timingSafeEqual(Buffer.from(expected), Buffer.from(m[3]))) return { ok: false, why: "signature" };
  const claims = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
  if (claims.aud !== "family-child-media" || claims.sid !== "learn") return { ok: false, why: "audience" };
  return { ok: true, sub: claims.sub };
}
function receipt({ child, turnId, request, reply, secret = SECRET }) {
  const claims = { v: 2, iss: "family-child-bridge", sub: child, sid: "learn", key: turnId, req: sha(JSON.stringify(request)), res: sha(reply), iat: Math.floor(Date.now() / 1000), mdl: "openai/stub-fictional", run: `stub-run-${n}` };
  const payload = b64u(JSON.stringify(claims));
  return `fcr1.${payload}.${createHmac("sha256", secret).update(`fcr1.${payload}`).digest("base64url")}`;
}
const say = (text, intent) => JSON.stringify({ v: 1, say: text, intent, outcome: null });
const cors = { "access-control-allow-origin": APP_ORIGIN, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin", "cache-control": "no-store" };
let n = 0;
http
  .createServer((req, res) => {
    const origin = req.headers.origin ?? null;
    if (req.url !== "/v1/nokt/turn") return res.writeHead(404).end();
    if (origin !== APP_ORIGIN) {
      fs.appendFileSync(log, JSON.stringify({ refused: "origin", origin, method: req.method }) + "\n");
      return res.writeHead(403).end();
    }
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    if (req.method !== "POST") return res.writeHead(405, cors).end();
    const verdict = tokenVerdict(req.headers.authorization);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      if (!verdict.ok) {
        fs.appendFileSync(log, JSON.stringify({ refused: `token-${verdict.why}`, origin }) + "\n");
        return res.writeHead(401, cors).end();
      }
      const { turnId, request, scripted } = JSON.parse(raw);
      if (typeof scripted === "string") {
        fs.appendFileSync(log, JSON.stringify({ scripted: true, at: new Date().toISOString(), origin, child: verdict.sub, phase: request?.context?.phase ?? null, transcript: request?.transcript?.length ?? 0 }) + "\n");
        return res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ ok: true, reply: scripted, receipt: receipt({ child: verdict.sub, turnId, request, reply: scripted }) }));
      }
      n += 1;
      fs.appendFileSync(log, JSON.stringify({ n, at: new Date().toISOString(), origin, child: verdict.sub, cookie: Boolean(req.headers.cookie), answerField: /"answer"/.test(JSON.stringify(request)), phase: request?.context?.phase ?? null, transcript: request?.transcript?.length ?? 0 }) + "\n");
      let reply;
      let secret = SECRET;
      if (n === 1) reply = say("Was sollst du bei dieser Frage herausfinden?", "clarify");
      else if (n === 2) reply = say("Es sind 4 Tragen, und 2 Setzlinge bleiben übrig.", "teach");
      else if (n === 3) {
        reply = say("Wie bist du auf deine Zahl gekommen?", "ask-method");
        secret = "stub-forger-secret-not-the-shared-one-0123456789";
      } else {
        await new Promise((r) => setTimeout(r, 3000));
        reply = say("Erzähl mir mehr.", "clarify");
      }
      res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ ok: true, reply, receipt: receipt({ child: verdict.sub, turnId, request, reply, secret }) }));
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`nokt stub bridge on 127.0.0.1:${port} for ${APP_ORIGIN}`));
