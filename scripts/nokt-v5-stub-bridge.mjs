// Nov 18 (Nokt prompt v5) — LOOPBACK STUB of the family runtime's Nokt route: never the real bridge, never a model, zero
// model turns. Signs fictional replies with fcr1 receipts the way the runtime does, so the app's real dispatch → verification
// → guard path runs. Unlike visit10-nokt-bridge.mjs (kept unchanged for the other render checks) its canned lines follow the
// v5 rules: a real hint without a question after «weiss nicht», guided questions in the writing step, the right sentence only
// at the safety limit, one question in the look back.
//   FAMILY_BRIDGE_TOKEN_SECRET=<synthetic ≥32 chars> node scripts/nokt-v5-stub-bridge.mjs <port> <app-origin> [ok|fail|slow]
// `fail`: every turn answers 503. `slow`: replies after 4 s (to close the panel while Nokt is still awaited).
import http from "node:http";
import { createHash, createHmac } from "node:crypto";

const port = Number(process.argv[2] || 3789);
const APP_ORIGIN = process.argv[3] || "http://127.0.0.1:3781";
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
  const claims = { v: 2, iss: "family-child-bridge", sub: child, sid: "learn", key: turnId, req: sha(JSON.stringify(request)), res: sha(reply), iat: Math.floor(Date.now() / 1000), mdl: "openai/stub-fictional-v5", run: `stub-${turnId}` };
  const payload = b64u(JSON.stringify(claims));
  return `fcr1.${payload}.${createHmac("sha256", SECRET).update(`fcr1.${payload}`).digest("base64url")}`;
}
const STUCK = /\b(weiss|weiß|weis)\b.*\bnicht\b|keine ahnung|hilf|hilfe|was (muss|soll) ich/i;
const fix = (t) => {
  let s = String(t ?? "").trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};
function answer(request) {
  const c = request.context ?? {};
  const tr = request.transcript ?? [];
  const kids = tr.filter((t) => t.role === "child").length;
  const lastChild = [...tr].reverse().find((t) => t.role === "child")?.text ?? "";
  if (c.closeNow) return say("Danke, dass du mir das erzählt hast. Probier es jetzt selbst.", "close");
  if (c.purpose === "diagnostic") return kids === 0 ? say("Wie bist du auf deine Zahl gekommen?", "ask-method") : say("Geh einmal mit dem Finger rundherum und zähl mit.", "teach");
  const w = c.writing ?? {};
  switch (c.phase) {
    case "begruessung": return say("Hallo Santi! Heute geht es um die Schildkröte. Bist du bereit?", "ask");
    case "antwort": return say("Super, los geht's.", "close");
    case "begleiten": return STUCK.test(lastChild) ? say("Hier geht es darum, was die Figur braucht. Probier es einfach, die Wörter-Hilfe zeigt dir Wörter.", "respond") : say("Was denkst du, was du hier tun sollst?", "ask");
    case "satz": {
      if (/ferstaucht/.test(w.hisSentence ?? "") && !STUCK.test(lastChild)) return say("Schau dir das Wort «ferstaucht» an. Mit welchem Buchstaben beginnt es?", "correct");
      if (w.appFound?.length === 0 && w.isSentence !== false && !STUCK.test(lastChild)) return say("Dein Satz ist richtig. Gut gemacht!", "close");
      if (w.isSentence === false) return say("Wer ist in deinem Satz, die Schildkröte?", "ask");
      if (STUCK.test(lastChild)) return say("Schau auf das Ende von deinem Satz.", "respond");
      return tr.at(-1)?.via === "typed" && kids > 1 ? say("Genau. Warum fehlt er bei dir?", "ask") : say("Was kommt am Ende eines Satzes?", "ask");
    }
    case "vorzeigen": return w.appFound?.length === 0 && w.isSentence !== false ? say("Jetzt ist er richtig. Super!", "close") : say(`Wir machen es zusammen: «${fix(w.hisSentence)}» Tipp ihn unten selbst ab.`, "correct");
    case "abschreiben": return say("Tipp den Satz oben genau ab.", "respond");
    case "naechstes": return kids === 0 ? say("Danke für deine Arbeit heute! Was möchtest du beim nächsten Mal machen? Tipp unten ein Bild an oder «Überspringen».", "ask") : say("Du kannst unten ein Bild antippen oder «Überspringen».", "respond");
    case "abschluss":
    case "schliessen": return say("Danke dir. Bis zum nächsten Mal!", "close");
    default: return say("Erzähl mir mehr.", "respond");
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
      setTimeout(() => res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ ok: true, reply, receipt: receipt({ child, turnId, request, reply }) })), MODE === "slow" ? 4000 : 500);
    });
  })
  .listen(port, "127.0.0.1", () => console.log("nokt v5 stub bridge", port, MODE));
