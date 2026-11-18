// ---------------------------------------------------------------------------
// Nokt panel telemetry for parents (Nov 18, Nokt diagnosis proposal 3).
//
// Pure: counts the closed `nokt` telemetry events of one visit (family-learning-telemetry-schema.ts) and renders the one
// parent evidence line («Nokt: 3× geöffnet, 2× gesprochen, …»). The events carry no text and no audio; neither does this.
// Kept apart from the summary module so the parent page can render the line without the mission engine.
// ---------------------------------------------------------------------------

type TelemetryEvent = { t: number; kind: string; detail?: Record<string, unknown> };

/** Nov 18: counts of the Nokt panel's closed telemetry events for one visit (no text, no audio). */
export type NoktPanelSummary = {
  opened: number;
  closed: number;
  /** The state at the LAST panel close, if any. */
  lastClose: "speaking" | "waiting" | "idle" | null;
  closedWhile: { speaking: number; waiting: number; idle: number };
  micStarts: number;
  micLive: number;
  /** The recording itself failed (no microphone, refused, recorder error). */
  micFailed: number;
  /** Median ms from mic start to «Jetzt sprechen!», when measured. */
  micLiveMedianMs: number | null;
  transcribed: number;
  transcriptEmpty: number;
  transcriptFailed: number;
  sentSpoken: number;
  sentTyped: number;
  replies: number;
  /** Replies that were not Nokt's line (withheld → app line) or failed. */
  repliesApp: number;
  repliesFailed: number;
  /** Median ms from his send to the reply, when measured. */
  replyMedianMs: number | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/** Nov 18: summarise the Nokt panel events of one visit; null when none arrived. */
export function summariseNoktPanel(events: TelemetryEvent[] | null): NoktPanelSummary | null {
  const list = (events ?? []).filter((e) => e.kind === "nokt" && typeof e.detail?.event === "string").sort((a, b) => a.t - b.t);
  if (!list.length) return null;
  const out: NoktPanelSummary = { opened: 0, closed: 0, lastClose: null, closedWhile: { speaking: 0, waiting: 0, idle: 0 }, micStarts: 0, micLive: 0, micFailed: 0, micLiveMedianMs: null, transcribed: 0, transcriptEmpty: 0, transcriptFailed: 0, sentSpoken: 0, sentTyped: 0, replies: 0, repliesApp: 0, repliesFailed: 0, replyMedianMs: null };
  const micMs: number[] = [];
  const replyMs: number[] = [];
  for (const e of list) {
    const d = e.detail ?? {};
    const ms = typeof d.ms === "number" ? d.ms : null;
    switch (d.event) {
      case "panel-open": out.opened += 1; break;
      case "panel-close": {
        out.closed += 1;
        const st = d.nokt === "speaking" || d.nokt === "waiting" || d.nokt === "idle" ? d.nokt : null;
        if (st) out.closedWhile[st] += 1;
        out.lastClose = st;
        break;
      }
      case "mic-start": out.micStarts += 1; break;
      case "mic-live": out.micLive += 1; if (ms !== null) micMs.push(ms); break;
      case "mic-failed": out.micFailed += 1; break;
      case "stt-ok": out.transcribed += 1; break;
      case "stt-empty": out.transcriptEmpty += 1; break;
      case "stt-failed": out.transcriptFailed += 1; break;
      case "sent-spoken": out.sentSpoken += 1; break;
      case "sent-typed": out.sentTyped += 1; break;
      case "reply-shown": out.replies += 1; if (ms !== null) replyMs.push(ms); break;
      case "reply-app": out.replies += 1; out.repliesApp += 1; if (ms !== null) replyMs.push(ms); break;
      case "reply-failed": out.repliesFailed += 1; if (ms !== null) replyMs.push(ms); break;
    }
  }
  out.micLiveMedianMs = median(micMs);
  out.replyMedianMs = median(replyMs);
  return out;
}

const CLOSE_DE = { speaking: "während Nokt sprach", waiting: "während er auf Nokts Antwort wartete", idle: "als Nokt still war" } as const;
const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

/** Nov 18: the one parent evidence line per visit (German, like the surrounding parent review). */
export function noktPanelLine(n: NoktPanelSummary): string {
  const parts = [`Nokt: ${n.opened}× geöffnet`, `${n.sentSpoken}× gesprochen`, `${n.sentTyped}× getippt`];
  if (n.micStarts) parts.push(`Mikrofon ${n.micStarts}× gestartet${n.micLiveMedianMs !== null ? ` (bis «Jetzt sprechen!» typisch ${sec(n.micLiveMedianMs)})` : ""}`);
  const micTrouble = n.micFailed + n.transcriptEmpty + n.transcriptFailed;
  if (micTrouble) parts.push(`${micTrouble} Mikrofon-Fehler (${[n.micFailed ? `${n.micFailed} Aufnahme` : "", n.transcriptEmpty ? `${n.transcriptEmpty} leer` : "", n.transcriptFailed ? `${n.transcriptFailed} Abschrift fehlgeschlagen` : ""].filter(Boolean).join(", ")})`);
  if (n.replies || n.repliesFailed) parts.push(`${n.replies + n.repliesFailed} Antworten${n.repliesApp || n.repliesFailed ? ` (davon ${n.repliesApp} App-Hinweis, ${n.repliesFailed} ohne Antwort)` : ""}${n.replyMedianMs !== null ? `, Wartezeit typisch ${sec(n.replyMedianMs)}` : ""}`);
  parts.push(n.closed ? `zuletzt geschlossen ${CLOSE_DE[n.lastClose ?? "idle"]}` : "nie selbst geschlossen");
  return parts.join(", ");
}
