import { refuse, NO_STORE, requireChildLearning } from "@/lib/family-learning-auth";
import { loadLearningContent } from "@/lib/family-learning-content-server";
import { noktSttModeFromEnv, noktTranscriberFor, NoktSttUpstreamError } from "@/lib/family-learning-nokt-stt";
import { AUDIO_UPLOAD_ISSUE_MESSAGES, checkAudioUpload, createTranscriptionAdmission } from "@/lib/family-transcription";

/**
 * POST /api/family/learning/nokt/transcribe — one push-to-talk turn for Nokt.
 * multipart/form-data with an `audio` file → `{ transcript, provider, model }`.
 * The transcript goes back to the child, who sees it, may correct it and
 * decides whether to send it; this route never forwards it anywhere.
 *
 * Order: household session + child learning credential, then the provider
 * gate (real-child transcription is not activated: 503 outside the isolated
 * fictional database), then admission, then the body. Refusals are closed
 * strings; neither the audio nor the transcript is stored or logged. A
 * cancelled request (the child cancelled, closed Nokt or changed task)
 * aborts the upstream call through `request.signal`.
 */

/** Separate from the household transcription window: Nokt turns never spend the assistant's budget, and vice versa. */
const admitNoktTranscription = createTranscriptionAdmission();

export async function POST(request: Request) {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return guard.response;

  const transcriber = noktTranscriberFor(noktSttModeFromEnv(process.env));
  if (!transcriber) return refuse(503, "Nokt cannot listen right now");

  let content;
  try {
    content = loadLearningContent();
  } catch {
    return refuse(503, "Learning content is not available");
  }
  if (guard.child !== content.child) return refuse(404, "No mission is prepared for this child");

  if (!admitNoktTranscription(`nokt:${guard.child}`, Date.now())) {
    return Response.json({ error: "Too many transcription requests" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return refuse(400, "Expected multipart/form-data");
  }
  const upload = checkAudioUpload(formData.get("audio"));
  if (!upload.ok) return refuse(400, AUDIO_UPLOAD_ISSUE_MESSAGES[upload.issue]);

  try {
    const result = await transcriber.transcribe(upload.file, request.signal);
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    if (request.signal.aborted) return refuse(499, "Cancelled");
    // Operator detail is the upstream status or the error class only — never the recording or a transcript.
    console.error("[family/learning/nokt/transcribe] transcription failed", error instanceof NoktSttUpstreamError ? error.status : error instanceof Error ? error.name : "unknown");
    return refuse(502, "Transcription failed");
  }
}
