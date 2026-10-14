// Domain-owned fail-closed boundary. No provider or legacy-runtime fallback.
import { CHILD_SESSION_SUFFIX_PATTERN, isChildId, type ChildTurnEnvelope } from "./family-assistant-turn.ts";

export const CHILD_ASSISTANT_AI_ENABLED = false;
export const CHILD_ASSISTANT_UNAVAILABLE = "Nabu's chat is temporarily unavailable while we replace the assistant. Your saved work stays safe.";
export const CHILD_TUTOR_UNAVAILABLE = "Nabus Gespräch ist vorübergehend nicht verfügbar. Deine Aufgaben und gespeicherten Arbeiten bleiben erhalten.";
export const LISTENING_SESSION_SUFFIX = "listening";

export function childAssistantUnavailable(child: string): ChildTurnEnvelope {
  return { v: 1, status: "error", child, blocks: [], meta: { requestId: "client-retirement" },
    error: { code: "temporarily_unavailable", message: CHILD_ASSISTANT_UNAVAILABLE, retryable: false } };
}

/** Only an explicit, closed, non-AI listening request may receive a token. */
export function readRetirementSessionRequest(body: unknown):
  | { status: 200; childId: "santiago" | "isabel"; sessionSuffix: typeof LISTENING_SESSION_SUFFIX }
  | { status: 400 | 503; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, error: "Invalid request body" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["childId", "sessionSuffix", "purpose"].includes(key))) return { status: 400, error: "Unsupported request field" };
  if (!isChildId(record.childId)) return { status: 400, error: "childId must be santiago or isabel" };
  if (record.sessionSuffix !== undefined && (typeof record.sessionSuffix !== "string" || !CHILD_SESSION_SUFFIX_PATTERN.test(record.sessionSuffix))) return { status: 400, error: "Invalid sessionSuffix" };
  if (record.purpose === undefined || record.purpose === "assistant") return { status: 503, error: CHILD_ASSISTANT_UNAVAILABLE };
  if (record.purpose !== "listening") return { status: 400, error: "Unsupported purpose" };
  if (record.sessionSuffix !== LISTENING_SESSION_SUFFIX) return { status: 400, error: "Listening requires its own session" };
  return { status: 200, childId: record.childId, sessionSuffix: LISTENING_SESSION_SUFFIX };
}
