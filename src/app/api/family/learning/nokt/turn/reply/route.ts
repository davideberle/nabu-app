import { refuse } from "@/lib/family-learning-auth";
import { applyMutation, ExposureUnsettledError } from "@/lib/family-learning-db";
import { noktReceiptInput } from "@/lib/family-learning-nokt-turn";
import { mutationResponse, NOKT_TURN_ID, noktTurnPrereqs } from "@/lib/family-learning-nokt-route";

/**
 * POST /api/family/learning/nokt/turn/reply — step 3 of a browser-mediated Nokt turn.
 *   `{ step, turnId, reply: string | null, receipt: string | null, expectedRevision, context, tz? }`
 *
 * `reply`/`receipt` are what the family runtime returned to the browser, passed through EXACTLY (no normalisation,
 * no slicing); `null` when the runtime could not be reached. The receipt's signature is checked here with the existing
 * shared secret; the engine binds it to its own dispatch (child, sid "learn", turn, request hash, exact reply bytes)
 * and applies the app-owned phases and guards. Only a verified, accepted reply is Nokt's line; anything else is
 * withheld behind the reviewed app line. A second reply to the same turn is refused (idempotency `<turnId>-r`, then
 * the engine's one-reply rule).
 */
export async function POST(request: Request) {
  const pre = await noktTurnPrereqs(request);
  if (!pre.ok) return pre.response;
  const { step, turnId, reply, receipt } = pre.body;
  if (typeof step !== "string" || typeof turnId !== "string" || !NOKT_TURN_ID.test(turnId)) return refuse(400, "step and turnId are required");
  if (reply !== null && typeof reply !== "string") return refuse(400, "reply must be a string or null");
  if (typeof reply === "string" && reply.length > 4000) return refuse(422, "Reply too long; it is refused, never truncated");
  try {
    const replied = await applyMutation(pre.db, { child: pre.child, op: { op: "mission", action: { a: "tutor-reply", step, turnId, reply: reply ?? "" } }, idempotencyKey: `${turnId}-r`, expectedRevision: pre.expectedRevision, context: pre.context }, pre.content, () => new Date(), { timeZone: pre.timeZone, vocabulary: pre.vocabulary, tutor: { available: true, receipt: reply === null ? null : noktReceiptInput(receipt, pre.bridge.secret) } });
    return mutationResponse(replied);
  } catch (error) {
    if (error instanceof ExposureUnsettledError) return refuse(503, "The task could not be saved as shown; try again");
    throw error;
  }
}
