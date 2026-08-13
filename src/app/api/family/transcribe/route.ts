import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  AUDIO_UPLOAD_ISSUE_MESSAGES,
  checkAudioUpload,
  createTranscriptionAdmission,
  transcribeAudio,
  TranscriptionConfigError,
} from "@/lib/family-transcription";

/**
 * POST /api/family/transcribe
 * Accepts multipart/form-data with an `audio` file field.
 * Returns { transcript, provider, model }.
 *
 * Authentication strictly precedes admission, body parsing and validation.
 * Refusal messages are closed strings — nothing the client sent (content
 * type, size, field values) is ever reflected back, and neither the audio
 * nor the transcript is ever logged.
 */

/** Responses carry a child's spoken words; a shared iPad must not cache them. */
const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Per-instance admission window, keyed by the authenticated identity below —
 * checked before the multipart body is even parsed, so a runaway client
 * cannot spend upload bandwidth or ElevenLabs credit.
 */
const admitTranscription = createTranscriptionAdmission();

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  // The key is the authenticated household identity, never a client-supplied
  // field: the allowlisted Google email that passed the sign-in callback.
  const identity = session.user.email?.toLowerCase() ?? "household";
  if (!admitTranscription(identity, Date.now())) {
    return NextResponse.json(
      { error: "Too many transcription requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    // Also the effective bound for bodies the platform refuses to buffer:
    // a closed 400, never a reflection of what was sent.
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400, headers: NO_STORE },
    );
  }

  const upload = checkAudioUpload(formData.get("audio"));
  if (!upload.ok) {
    return NextResponse.json(
      { error: AUDIO_UPLOAD_ISSUE_MESSAGES[upload.issue] },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await transcribeAudio(upload.file);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TranscriptionConfigError) {
      return NextResponse.json(
        { error: "Speech-to-text service is not configured" },
        { status: 503, headers: NO_STORE },
      );
    }
    // Upstream status/detail is operator-only; never the recording itself.
    console.error("[family/transcribe] transcription failed", error);
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 502, headers: NO_STORE },
    );
  }
}
