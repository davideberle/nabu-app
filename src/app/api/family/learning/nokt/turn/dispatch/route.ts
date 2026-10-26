import { randomUUID } from "node:crypto";
import { buildChildBridgeSession } from "@/lib/family-assistant-bridge";
import { refuse } from "@/lib/family-learning-auth";
import { applyMutation, ExposureUnsettledError } from "@/lib/family-learning-db";
import { NOKT_SESSION_SUFFIX } from "@/lib/family-learning-nokt-turn";
import { NOKT_TALK_PURPOSES, type NoktTalkPurpose } from "@/lib/family-learning-nokt-talk";
import { mutationResponse, NOKT_TURN_ID, noktTurnPrereqs } from "@/lib/family-learning-nokt-route";

/**
 * POST /api/family/learning/nokt/turn/dispatch — step 1 of a browser-mediated Nokt turn (content v6, N7-03/N7-06; content v7).
 *   task talk:  `{ step, part, purpose: "diagnostic" | "reflection", entry, sessionId, turnId, text, via, expectedRevision, context, tz? }`
 *   other talk: `{ purpose: "home" | "welcome" | "visit" | "writing" | "debrief", sessionId, turnId, text?, via?, expectedRevision, context, tz? }`
 *
 * Records his line (or, for an opener, nothing yet) and builds the request on the SERVER from what he can see — never an
 * answer key; the request hash is stored with the dispatch. Returns that exact request plus a minted bridge token for
 * session `learn`, so the browser on the Mac mini can send `{ turnId, request }` to `<bridge>/v1/nokt/turn` (the hosted app
 * cannot reach the family runtime on the private network). Nothing here calls a model or the bridge. Idempotent by
 * `<turnId>-d`. Only the task talk can later carry an assessment; the other purposes never do.
 */
export async function POST(request: Request) {
  const pre = await noktTurnPrereqs(request);
  if (!pre.ok) return pre.response;
  const { step, part, purpose, entry, sessionId, turnId, text, via, choice } = pre.body;
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 80 || typeof turnId !== "string" || !NOKT_TURN_ID.test(turnId)) return refuse(400, "sessionId and turnId are required");
  const talk = typeof purpose === "string" && (NOKT_TALK_PURPOSES as readonly string[]).includes(purpose);
  if (!talk && (typeof step !== "string" || typeof part !== "string")) return refuse(400, "step, part, sessionId and turnId are required");
  if (talk && (step !== undefined || part !== undefined)) return refuse(400, "the page of this conversation is the server's, not the client's");
  try {
    const op = talk
      ? ({ op: "nokt-talk", action: { a: "dispatch", purpose: purpose as NoktTalkPurpose, sessionId, turnId, ...(text !== undefined ? { text: text as string, via: via as "typed" } : {}), ...(typeof choice === "string" && choice.length <= 40 ? { choice } : {}) } } as const)
      : ({ op: "mission", action: { a: "tutor-dispatch", step: step as string, part: part as string, purpose: purpose as "diagnostic", entry: entry as "manual", turnId, sessionId, text: text as string, via: via as "typed" } } as const);
    const dispatched = await applyMutation(pre.db, { child: pre.child, op, idempotencyKey: `${turnId}-d`, expectedRevision: pre.expectedRevision, context: pre.context }, pre.content, () => new Date(), { timeZone: pre.timeZone, vocabulary: pre.vocabulary, tutor: { available: true } });
    if (dispatched.status !== "applied") return mutationResponse(dispatched);
    const result = dispatched.result as { request?: unknown; reqHash?: string };
    if (!result.request || !result.reqHash) return refuse(500, "Nokt turn could not be prepared");
    const session = buildChildBridgeSession({ config: pre.bridge, childId: pre.child, sessionSuffix: NOKT_SESSION_SUFFIX, jti: randomUUID(), nowMs: Date.now() });
    return mutationResponse(dispatched, { turnId, request: result.request, reqHash: result.reqHash, bridge: { url: session.bridgeUrl, token: session.token, expiresAt: session.expiresAt } });
  } catch (error) {
    if (error instanceof ExposureUnsettledError) return refuse(503, "The task could not be saved as shown; try again");
    throw error;
  }
}
