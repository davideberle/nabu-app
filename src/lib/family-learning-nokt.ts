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
// Transcription being configured for a deployment does NOT change this mode:
// outside the isolated stub Nokt stays `unavailable` (no replies, no mic).
// ---------------------------------------------------------------------------

export type NoktMode = "unavailable" | "fictional-stub";

export function noktModeFromEnv(env: Record<string, string | undefined>): NoktMode {
  const isolated = !!env.NABU_DB_DIR && !env.TURSO_DATABASE_URL && !env.VERCEL && !env.VERCEL_ENV && !env.VERCEL_URL;
  return env.FAMILY_NOKT_FICTIONAL_STUB === "1" && isolated ? "fictional-stub" : "unavailable";
}

/** The planned turn shape of the German voice tutor. A transport is injected; production has none. */
export type NoktTurn = { id: string; role: "child" | "nokt"; text: string; via: "voice" | "typed"; at: number };

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
