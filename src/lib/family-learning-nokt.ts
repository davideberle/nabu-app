// ---------------------------------------------------------------------------
// Nokt (Santiago's tutor) — availability on the learning surface (content v6, N7-03/N7-04).
//
// Real-child AI is OFF (CHILD_ASSISTANT_AI_ENABLED = false): in every deployed
// build Nokt is `unavailable`. The panel then says so in child words and points
// to the reviewed hint; nothing is sent, transcribed, spoken or scored.
//
// `fictional-stub` exists ONLY to render and test the planned interaction
// (push-to-talk → visible transcript → written reply → speech of that reply,
// typed fallback) with canned, clearly fictional replies. It is honoured only
// on an isolated local database: the explicit flag, a local NABU_DB_DIR, no
// Turso URL and no Vercel environment. Its replies never come from a model; it
// never records a tutor outcome and never changes evidence: the server still
// records every Nokt opening with `available: false`.
// Push-to-talk is real in that mode (microphone → /api/family/learning/nokt/
// transcribe → the editable transcript); the recognizer behind it is chosen in
// `family-learning-nokt-stt.ts` — a fake by default, OpenAI only on request.
// Transcription being configured for a deployment does NOT change this mode.
//
// `subscription` (activation round 16) is the REAL conversation: Nokt's replies come from the family runtime on the
// Mac mini (ChatGPT subscription, daily allowance there). Default OFF: only the explicit
// `FAMILY_NOKT_CONVERSATION=subscription` turns it on, and only when the bridge is ready (an https bridge URL and the
// shared token secret). Without that it is `unavailable`, exactly as before.
// ---------------------------------------------------------------------------

export type NoktMode = "unavailable" | "fictional-stub" | "subscription";

/** The bridge the browser must reach for a real Nokt turn: an https URL and a shared secret of at least 32 characters. */
export function noktBridgeReady(env: Record<string, string | undefined>): boolean {
  let url: URL;
  try {
    url = new URL(env.FAMILY_ASSISTANT_BRIDGE_URL ?? "");
  } catch {
    return false;
  }
  return url.protocol === "https:" && (env.FAMILY_BRIDGE_TOKEN_SECRET ?? "").length >= 32;
}

export function noktModeFromEnv(env: Record<string, string | undefined>): NoktMode {
  const isolated = !!env.NABU_DB_DIR && !env.TURSO_DATABASE_URL && !env.VERCEL && !env.VERCEL_ENV && !env.VERCEL_URL;
  if (env.FAMILY_NOKT_FICTIONAL_STUB === "1" && isolated) return "fictional-stub";
  if (env.FAMILY_NOKT_CONVERSATION === "subscription" && noktBridgeReady(env)) return "subscription";
  return "unavailable";
}

/** The planned turn shape of the German voice tutor. A transport is injected; production has none. */
/** `app` = reviewed app text shown instead of a withheld or unreachable Nokt reply — never attributed to Nokt. */
export type NoktTurn = { id: string; role: "child" | "nokt" | "app"; text: string; via: "voice" | "typed"; at: number };

export type NoktTransport = {
  kind: "fictional-stub";
  /** The written reply to one child turn, bound to the task on screen. */
  reply: (input: { text: string; step: string; part: string | null; turns: number }) => Promise<{ ok: true; text: string } | { ok: false }>;
};

/** Canned, clearly fictional replies — never presented as a real tutor result. */
export function fictionalNoktTransport(): NoktTransport {
  const lines = [
    "Was sollst du bei dieser Frage herausfinden?",
    "Wie bist du auf deine Zahl gekommen?",
    "Danke. Probier es oben noch einmal oder öffne den Hinweis.",
  ];
  return {
    kind: "fictional-stub",
    reply: async ({ turns }) => ({ ok: true, text: lines[Math.min(turns, lines.length - 1)] }),
  };
}
