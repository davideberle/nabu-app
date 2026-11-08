// Visit 10 (Nov 8) — LOOPBACK STUB of the family runtime's Nokt route for the render checks: never the real bridge, never a
// model, zero model turns. Signs fictional replies with fcr1 receipts the way the runtime does, so the app's real
// dispatch → verification → guard path runs.
//   FAMILY_BRIDGE_TOKEN_SECRET=<synthetic ≥32 chars> node scripts/visit10-nokt-bridge.mjs <port> <app-origin> [ok|fail]
// `fail`: every turn answers 503, for the "Nokt fails, one friendly line, the visit continues" path.
import http from "node:http";
import { createHash, createHmac } from "node:crypto";

const port = Number(process.argv[2] || 3299);
const APP_ORIGIN = process.argv[3] || "http://127.0.0.1:3611";
const MODE = process.argv[4] || "ok";
const SECRET = process.env.FAMILY_BRIDGE_TOKEN_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("FAMILY_BRIDGE_TOKEN_SECRET (synthetic, ≥ 32 chars) is required");
  process.exit(2);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const b64u = (s) => Buffer.from(s).toString("base64url");
const say = (text, intent) => JSON.stringify({ v: 1, say: text, intent, outcome: null });
function receipt({ child, turnId, request, reply }) {
  const claims = { v: 2, iss: "family-child-bridge", sub: child, sid: "learn", key: turnId, req: sha(JSON.stringify(request)), res: sha(reply), iat: Math.floor(Date.now() / 1000), mdl: "openai/stub-fictional", run: `stub-${turnId}` };
  const payload = b64u(JSON.stringify(claims));
  return `fcr1.${payload}.${createHmac("sha256", SECRET).update(`fcr1.${payload}`).digest("base64url")}`;
}
function answer(request) {
  const c = request.context ?? {};
  const kids = (request.transcript ?? []).filter((t) => t.role === "child").length;
  if (c.closeNow) return say("Danke, dass du mir das erzählt hast. Probier es jetzt selbst.", "close");
  if (c.purpose === "diagnostic") {
    if (kids === 0) return say(`Warum hast du ${c.attempts?.at(-1) ?? "das"} ${c.unit ?? ""} gerechnet?`.replace(/ +/g, " ").replace(" ?", "?"), "ask-method");
    return kids === 1 ? say("Was misst du da genau?", "ask-method") : say("Geh einmal mit dem Finger rundherum. Wie viele Seiten sind es?", "teach");
  }
  switch (c.phase) {
    case "begruessung": return say("Hallo Santi! Heute bauen wir eine Wasserleitung. Bist du bereit?", "ask");
    case "antwort": return say("Super, los geht's beim Planungsbüro.", "close");
    case "satz": return kids <= 1 ? say("Das Wasser fliesst, schön. Welches Wort schreibt man hier gross?", "ask") : say("Schau deinen Satz jetzt noch einmal selbst an.", "close");
    case "rueckblick-start": return say("Was war heute knifflig?", "ask");
    case "rueckblick": return say("Das merke ich mir. Was würdest du jemandem zeigen?", "ask");
    case "naechstes": return say("Was möchtest du beim nächsten Mal machen?", "ask");
    case "abschluss":
    case "schliessen": return say("Danke dir. Bis zum nächsten Mal!", "close");
    case "begleiten": return say("Was denkst du, was du hier tun sollst?", "ask");
    default: return say("Erzähl mir mehr.", "ask");
  }
}
const cors = { "access-control-allow-origin": APP_ORIGIN, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin", "cache-control": "no-store" };
http
  .createServer((req, res) => {
    if (req.url !== "/v1/nokt/turn") return res.writeHead(404).end();
    if (req.headers.origin !== APP_ORIGIN) return res.writeHead(403).end();
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (MODE === "fail") return res.writeHead(503, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ ok: false, code: "unavailable" }));
      const m = /^Bearer\s+fcm1\.([A-Za-z0-9_-]+)\./.exec(req.headers.authorization ?? "");
      const child = m ? JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")).sub : "santiago";
      const { turnId, request } = JSON.parse(raw);
      const reply = answer(request);
      setTimeout(() => res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ ok: true, reply, receipt: receipt({ child, turnId, request, reply }) })), 500);
    });
  })
  .listen(port, "127.0.0.1", () => console.log("visit10 stub bridge", port, MODE));
