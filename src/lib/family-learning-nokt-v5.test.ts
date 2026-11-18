// Nov 18 — Nokt prompt v5 (helper on a task, strict teacher on the sentence) and the closed Nokt panel telemetry.
// Pure checks only; every text below is invented (no child record).
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { asksQuestion, isSentenceText, isStuckOrHelp, quotedSentence, rewritesSentence, sameWords } from "./family-learning-nokt-contract.ts";
import { checkTalkReply, NOKT_TALK_PROMPT_VERSION, talkSystemPrompt, writingPhase, type NoktTalkPhase, type NoktTalkPurpose, type NoktTalkReply } from "./family-learning-nokt-talk.ts";
import { NOKT_TELEMETRY_EVENTS, sanitizeTelemetryEvent, sanitizeTelemetryEvents, TELEMETRY_KINDS } from "./family-learning-telemetry-schema.ts";
import { createTelemetryBuffer, noteNokt } from "./family-learning-telemetry.ts";
import { noktPanelLine, summariseNoktPanel } from "./family-learning-nokt-telemetry.ts";
import { summariseTelemetry } from "./family-learning-summary.ts";

const r = (say: string, intent: NoktTalkReply["intent"] = "respond"): NoktTalkReply => ({ v: 1, say, intent, outcome: null });
const none = { numbers: [], phrases: [] };
const kid = (text: string) => ({ role: "child" as const, text });
const nokt = (text: string) => ({ role: "nokt" as const, text });
const check = (purpose: NoktTalkPurpose, phase: NoktTalkPhase, transcript: { role: "child" | "nokt"; text: string }[], reply: NoktTalkReply, extra: Partial<Parameters<typeof checkTalkReply>[1]> = {}) =>
  checkTalkReply(reply, { purpose, phase, transcript, open: none, ...extra });

describe("prompt v5", () => {
  it("is a new version with the helper rules for tasks and the teacher rules for the sentence", () => {
    equal(NOKT_TALK_PROMPT_VERSION, "nokt-talk-de-2026-11-18-v5");
    const visit = talkSystemPrompt("visit");
    ok(/Helfer, kein Quizmaster/.test(visit));
    ok(/hat deine Antwort KEINE Frage/.test(visit));
    ok(/Höchstens jede zweite Antwort von dir hat eine Frage/.test(visit));
    const writing = talkSystemPrompt("writing");
    ok(/strenger, freundlicher Lehrer/.test(writing));
    ok(/Was kommt am Ende eines Satzes\?/.test(writing));
    ok(/schreibst seinen Satz nie richtig für ihn hin/.test(writing));
    const debrief = talkSystemPrompt("debrief");
    ok(/nur EINE Frage/.test(debrief) && /Überspringen/.test(debrief));
    for (const p of ["home", "welcome", "visit", "writing", "debrief"] as const) {
      const sys = talkSystemPrompt(p);
      ok(!sys.includes("ß"), `${p}: Swiss spelling`);
      ok(sys.length < 6000, `${p}: fits the runtime's system limit (${sys.length})`);
    }
  });
});

describe("«weiss nicht» and help requests", () => {
  it("recognises the common variants", () => {
    for (const t of ["weiss nicht", "Ich weiss nicht", "ich weiß es nicht", "weiss ich nicht", "Weis ich echt nicht", "keine Ahnung", "k.A.", "KA", "hilf mir", "Hilfe!", "ich brauche Hilfe", "ich brauch hilfe", "was muss ich machen?", "Was soll ich hier tun", "ich verstehe das nicht", "kannst du mir helfen?", "hä?", "ich weiss nicht was man braucht …"]) ok(isStuckOrHelp(t), t);
  });
  it("does not fire on ordinary answers", () => {
    for (const t of ["Necesitamos un tubo", "Ich will es jetzt fertig machen.", "ein Haus", "die Pläne", "Ich weiss es: zwölf", "Karotten"]) ok(!isStuckOrHelp(t), t);
  });
  it("a sentence has three words and is not a help line", () => {
    ok(isSentenceText("Die Schildkröte schwimmt."));
    ok(!isSentenceText("Schildkröte schwimmt"));
    ok(!isSentenceText("ich weiss nicht was"));
    ok(asksQuestion("Was meinst du?") && !asksQuestion("Probier es einfach."));
  });
});

describe("guard — task help (purpose visit): helper, not quizmaster", () => {
  const stuck = [nokt("Rosa fragt dich etwas."), kid("weiss nicht")];
  it("refuses a question right after «weiss nicht» or a help request; the same help without a question passes", () => {
    deepStrictEqual(check("visit", "begleiten", stuck, r("Womit könntest du Wasser holen?", "ask")), { ok: false, reason: "question-when-stuck" });
    deepStrictEqual(check("visit", "begleiten", [kid("hilf mir")], r("Rosa fragt, was wir brauchen. Was siehst du auf dem Bild?", "respond")), { ok: false, reason: "question-when-stuck" });
    deepStrictEqual(check("visit", "begleiten", stuck, r("Rosa fragt auf Deutsch: Was brauchen wir für das Wasser? Probier es einfach.")), { ok: true });
  });
  it("never two question lines in a row", () => {
    const asked = [nokt("Was denkst du, was Rosa will?"), kid("Wasser")];
    deepStrictEqual(check("visit", "begleiten", asked, r("Und womit holt man Wasser?", "ask")), { ok: false, reason: "question-in-a-row" });
    deepStrictEqual(check("visit", "begleiten", asked, r("Genau, Rosa braucht Wasser für den Teich.")), { ok: true });
    const told = [nokt("Rosa braucht Wasser."), kid("ok")];
    deepStrictEqual(check("visit", "begleiten", told, r("Was könnte das Wasser bringen?", "ask")), { ok: true }, "one question every two lines is allowed");
  });
  it("does NOT apply in the writing step: guided questions are wanted there, also after «weiss nicht»", () => {
    const w = { versions: ["die schildkröte schwimmt"], roundOk: null };
    deepStrictEqual(check("writing", "satz", [kid("die schildkröte schwimmt"), nokt("Was kommt am Anfang eines Satzes?"), kid("weiss nicht")], r("Schau auf das erste Wort. Ist der erste Buchstabe gross oder klein?", "ask"), { writing: w }), { ok: true });
    deepStrictEqual(check("writing", "satz", [nokt("Was kommt am Ende eines Satzes?"), kid("ein Punkt")], r("Warum fehlt er bei dir?", "ask"), { writing: w }), { ok: true });
  });
  it("the earlier guards fire exactly as before, and first", () => {
    const open = { numbers: [], phrases: ["tubo"] };
    deepStrictEqual(checkTalkReply(r("Sag einfach tubo?", "ask"), { purpose: "visit", phase: "begleiten", transcript: [kid("weiss nicht")], open }), { ok: false, reason: "answer-disclosed" });
    deepStrictEqual(check("visit", "begleiten", [kid("weiss nicht")], r("Was? Wie?", "ask")), { ok: false, reason: "several-questions" });
    deepStrictEqual(check("visit", "begleiten", [nokt("Was brauchst du?"), kid("x")], r("Was brauchst du?", "ask")), { ok: false, reason: "repeated-question" });
    deepStrictEqual(check("visit", "schliessen", [kid("weiss nicht")], r("Probier es.", "respond")), { ok: false, reason: "must-close" });
    deepStrictEqual(check("visit", "begleiten", [kid("weiss nicht")], r("Du bekommst Münzen.")), { ok: false, reason: "promises-reward" });
    deepStrictEqual(checkTalkReply(null, { purpose: "visit", phase: "begleiten", transcript: [], open: none }), { ok: false, reason: "malformed" });
    const numbers = { numbers: [{ answer: 12, unit: "m", visible: ["Das Beet ist 3 m breit."], childSaid: [] }], phrases: [] };
    deepStrictEqual(checkTalkReply(r("Es sind 12 m."), { purpose: "visit", phase: "begleiten", transcript: [], open: numbers }), { ok: false, reason: "answer-disclosed" });
  });
  it("home, welcome and the look back keep their v4 behaviour (the new task guards are scoped to the visit talk)", () => {
    deepStrictEqual(check("home", "zuhause", [nokt("Wie geht's?"), kid("weiss nicht")], r("Möchtest du lernen?", "ask")), { ok: true });
    deepStrictEqual(check("debrief", "naechstes", [nokt("Was möchtest du?"), kid("weiss nicht")], r("Was magst du am liebsten?", "ask")), { ok: true });
  });
});

describe("guard — the writing step: no sentence written for him before the limit", () => {
  const his = "die schildkröte hat sich den fuss ferstaucht";
  const w = (roundOk: boolean | null) => ({ versions: [his], roundOk });
  it("finds a rewrite of his sentence, never his own sentence quoted back", () => {
    ok(rewritesSentence("Schreib: «Die Schildkröte hat sich den Fuss verstaucht.»", his));
    ok(rewritesSentence("Die schildkröte hat sich den fuss verstaucht", his), "one word fixed");
    ok(!rewritesSentence("Du hast geschrieben: «die schildkröte hat sich den fuss ferstaucht». Schau dir das letzte Wort an.", his));
    ok(!rewritesSentence("Schau dir das Wort «ferstaucht» an. Mit welchem Buchstaben beginnt es?", his));
    ok(rewritesSentence("Die Schildkröte schwimmt im Teich.", "Die Schildkröte schwimmt im Teich"), "only the full stop added");
    ok(!rewritesSentence("Du schreibst: Die Schildkröte schwimmt im Teich. Super!", "Die Schildkröte schwimmt im Teich."), "his own sentence with his own full stop");
  });
  it("refuses the rewrite in «satz», allows it at the safety limit; there a real sentence must be shown", () => {
    deepStrictEqual(check("writing", "satz", [kid(his)], r("Richtig wäre: «Die Schildkröte hat sich den Fuss verstaucht.»", "correct"), { writing: w(false) }), { ok: false, reason: "writes-sentence" });
    deepStrictEqual(check("writing", "vorzeigen", [kid(his)], r("Wir machen es zusammen: «Die Schildkröte hat sich den Fuss verstaucht.» Tipp ihn unten selbst ab.", "correct"), { writing: w(false) }), { ok: true });
    deepStrictEqual(check("writing", "vorzeigen", [kid(his)], r("Schau noch einmal genau hin.", "correct"), { writing: w(false) }), { ok: false, reason: "shows-no-sentence" });
  });
  it("never closes while the sentence is not right; closes when the app's check passes", () => {
    deepStrictEqual(check("writing", "satz", [kid(his)], r("Schön geschrieben!", "close"), { writing: w(false) }), { ok: false, reason: "closes-unfinished" });
    deepStrictEqual(check("writing", "satz", [kid("ja")], r("Tschüss!", "close"), { writing: w(null) }), { ok: false, reason: "closes-unfinished" });
    deepStrictEqual(check("writing", "satz", [kid("Die Schildkröte schwimmt.")], r("Dein Satz ist richtig!", "close"), { writing: w(true) }), { ok: true });
    deepStrictEqual(check("writing", "schliessen", [kid("ok")], r("Danke für deine Arbeit!", "close"), { writing: w(null) }), { ok: true });
  });
  it("the phase moves to «vorzeigen» at the third wrong rewrite (or the ceiling), then «abschreiben»", () => {
    const round = (verdict: "ok" | "needs-work" | "pending") => ({ text: "x y z", at: "t", found: [], sentence: true, verdict });
    equal(writingPhase({ rounds: [round("needs-work"), round("pending")], shown: null }, 2, 1), "satz");
    equal(writingPhase({ rounds: [round("needs-work"), round("needs-work"), round("needs-work"), round("pending")], shown: null }, 4, 3), "vorzeigen");
    equal(writingPhase({ rounds: [round("needs-work")], shown: null }, 14, null), "vorzeigen", "the hard ceiling");
    equal(writingPhase({ rounds: [round("needs-work")], shown: { text: "A b c.", at: "t", by: "nokt" } }, 5, null), "abschreiben");
    equal(writingPhase({ rounds: [round("needs-work")], shown: { text: "A b c.", at: "t", by: "nokt" } }, 14, null), "schliessen");
  });
  it("reads the shown sentence and compares his copy by its words", () => {
    equal(quotedSentence("So geht es: «Die Schildkröte schwimmt.» Tipp ihn ab."), "Die Schildkröte schwimmt.");
    equal(quotedSentence("Das Wort «Fuss» ist richtig."), null);
    ok(sameWords("die schildkröte  schwimmt.", "Die Schildkröte schwimmt."));
    ok(!sameWords("Die Schildkröte schwimt.", "Die Schildkröte schwimmt."));
  });
});

describe("Nokt panel telemetry — closed names, no text", () => {
  it("adds one closed kind with closed event names", () => {
    ok((TELEMETRY_KINDS as readonly string[]).includes("nokt"));
    deepStrictEqual([...NOKT_TELEMETRY_EVENTS], ["panel-open", "panel-close", "mic-start", "mic-live", "mic-failed", "stt-ok", "stt-empty", "stt-failed", "sent-typed", "sent-spoken", "reply-shown", "reply-app", "reply-failed"]);
  });
  it("refuses unknown names, purposes and states; never copies another key (no text field is possible)", () => {
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "transcript", text: "hallo" } }), null);
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "panel-open", purpose: "chat" } }), null);
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "panel-close", nokt: "laughing" } }), null);
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "panel-close" } }), null, "a close always says what Nokt was doing");
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "sent-typed", nokt: "idle" } }), null);
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "sent-typed", ms: 10 } }), null, "durations only on the timed events");
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "mic-live", ms: 700_000 } }), null, "bounded");
    equal(sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", detail: { event: "mic-live", ms: "900" } }), null);
    const kept = sanitizeTelemetryEvent({ t: 1, kind: "nokt", stage: "mission", text: "x", detail: { event: "sent-spoken", purpose: "visit", transcript: "ich weiss nicht", audio: "AAAA" } });
    deepStrictEqual(kept, { t: 1, kind: "nokt", stage: "mission", detail: { event: "sent-spoken", purpose: "visit" } });
    deepStrictEqual(sanitizeTelemetryEvent({ t: 2, kind: "nokt", stage: "mission", detail: { event: "panel-close", purpose: "task", nokt: "speaking" } }), { t: 2, kind: "nokt", stage: "mission", detail: { event: "panel-close", purpose: "task", nokt: "speaking" } });
    deepStrictEqual(sanitizeTelemetryEvent({ t: 3, kind: "nokt", stage: null, detail: { event: "reply-shown", ms: 6400 } }), { t: 3, kind: "nokt", stage: null, detail: { event: "reply-shown", ms: 6400 } });
  });
  it("the producer counts as activity, clamps durations and goes through the same schema", () => {
    let b = createTelemetryBuffer();
    b = noteNokt(b, 1000, { event: "mic-live", purpose: "visit", ms: 9_999_999 });
    b = noteNokt(b, 1100, { event: "bogus" as never });
    equal(b.events.length, 1);
    deepStrictEqual(b.events[0].detail, { event: "mic-live", purpose: "visit", ms: 600_000 });
    ok(b.activeSince !== null);
  });
  it("one parent line per visit; absent when no Nokt event arrived", () => {
    const ev = (t: number, detail: Record<string, unknown>) => ({ t, kind: "nokt", stage: "mission", detail });
    const events = sanitizeTelemetryEvents([
      ev(1, { event: "panel-open", purpose: "visit" }),
      ev(2, { event: "mic-start", purpose: "visit" }),
      ev(3, { event: "mic-live", purpose: "visit", ms: 900 }),
      ev(4, { event: "stt-ok", purpose: "visit" }),
      ev(5, { event: "sent-spoken", purpose: "visit" }),
      ev(6, { event: "reply-shown", purpose: "visit", ms: 6000 }),
      ev(7, { event: "panel-close", purpose: "visit", nokt: "idle" }),
      ev(8, { event: "panel-open", purpose: "task" }),
      ev(9, { event: "mic-start", purpose: "task" }),
      ev(10, { event: "stt-empty", purpose: "task" }),
      ev(11, { event: "sent-typed", purpose: "task" }),
      ev(12, { event: "reply-app", purpose: "task", ms: 8000 }),
      ev(13, { event: "panel-open", purpose: "visit" }),
      ev(14, { event: "sent-spoken", purpose: "visit" }),
      ev(15, { event: "panel-close", purpose: "visit", nokt: "speaking" }),
    ], 200);
    const n = summariseNoktPanel(events)!;
    deepStrictEqual([n.opened, n.closed, n.sentSpoken, n.sentTyped, n.transcriptEmpty, n.micStarts, n.lastClose, n.replyMedianMs], [3, 2, 2, 1, 1, 2, "speaking", 7000]);
    equal(noktPanelLine(n), "Nokt: 3× geöffnet, 2× gesprochen, 1× getippt, Mikrofon 2× gestartet (bis «Jetzt sprechen!» typisch 0,9 s), 1 Mikrofon-Fehler (1 leer), 2 Antworten (davon 1 App-Hinweis, 0 ohne Antwort), Wartezeit typisch 7,0 s, zuletzt geschlossen während Nokt sprach");
    const summary = summariseTelemetry(events as never, 1);
    equal(summary.nokt!.opened, 3);
    equal(summariseTelemetry([{ t: 1, kind: "stage-enter", stage: "mission" }], 1).nokt, undefined, "no Nokt events: unknown, never zero");
  });
});
