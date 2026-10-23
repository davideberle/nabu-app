// Visit 7 — LOOPBACK STUB of the tutor backend for the Nokt turn checks (never the real bridge, never a model).
//
//   FAMILY_BRIDGE_TOKEN_SECRET=<synthetic ≥32 chars> node scripts/visit7-nokt-stub-bridge.mjs <port> <log.jsonl>
//
// Answers POST /nokt/turn with SCRIPTED fictional replies and signs an fcr1 receipt over them with the SAME synthetic secret
// the isolated app server is started with — the construction the real bridge uses (claims in declared order, HMAC-SHA256).
// The app can only verify; signing exists here, in a test tool, and nowhere in the app. Every call is logged (shape only):
// whether a bridge bearer came, whether the request held an "answer" field, the app's phase, the transcript length.
//
// Script by call order (fictional model outputs, including adversarial ones):
//   1  a neutral clarification, correctly signed                    → shown as Nokt
//   2  «teach» label with the answer in the assessment phase, signed → withheld by the app (intent-not-in-phase)
//   3  a fine clarification, receipt signed with ANOTHER secret      → withheld (origin invalid)
//   4+ a fine reply after a 3 s delay (the client cancels meanwhile) → never recorded as a Nokt line
import http from "node:http";
import fs from "node:fs";
import { createHash, createHmac } from "node:crypto";

const port = Number(process.argv[2] || 3299);
const log = process.argv[3] || "/tmp/visit7-nokt-stub-bridge.jsonl";
const SECRET = process.env.FAMILY_BRIDGE_TOKEN_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("FAMILY_BRIDGE_TOKEN_SECRET (synthetic, ≥ 32 chars) is required");
  process.exit(2);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const b64u = (s) => Buffer.from(s).toString("base64url");
function receipt({ turnId, request, reply, secret = SECRET }) {
  const claims = { v: 1, iss: "family-child-bridge", sub: "santiago", sid: "learn", key: turnId, req: sha(JSON.stringify(request)), res: sha(reply), iat: Math.floor(Date.now() / 1000) };
  const payload = b64u(JSON.stringify(claims));
  return `fcr1.${payload}.${createHmac("sha256", secret).update(`fcr1.${payload}`).digest("base64url")}`;
}
const say = (text, intent) => JSON.stringify({ v: 1, say: text, intent, outcome: null });
let n = 0;
http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/nokt/turn") {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      n += 1;
      const { turnId, request } = JSON.parse(raw);
      fs.appendFileSync(log, JSON.stringify({ n, at: new Date().toISOString(), bearer: /^Bearer fcm1\./.test(req.headers.authorization ?? ""), answerField: /"answer"/.test(JSON.stringify(request)), phase: request?.context?.phase ?? null, transcript: request?.transcript?.length ?? 0 }) + "\n");
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
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ reply, receipt: receipt({ turnId, request, reply, secret }) }));
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`nokt stub bridge on 127.0.0.1:${port}`));
