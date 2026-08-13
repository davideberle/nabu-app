import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  CHILD_TTS_CONTENT_TYPE,
  parseChildTtsRequest,
  synthesizeChildSpeech,
  TtsConfigError,
  TtsUpstreamError,
  type ChildTtsRequestIssue,
} from "@/lib/family-tts";

/**
 * POST /api/family/assistant/tts
 *
 * Speaks one assistant reply in the selected child's voice.
 *
 * The narrow shape is the point: an authenticated household session sends
 * exactly `{ childId, text }` and receives transient MP3 bytes. The ElevenLabs
 * key and the voice IDs live only on this side; the browser never sees a
 * provider URL, a voice ID, or an upstream error body. Audio is generated per
 * request and never stored, and the text being spoken is never logged — it is
 * a child's conversation.
 *
 * Authentication happens before any of the body is read, so an unauthenticated
 * caller learns nothing about what this route accepts.
 */

/** Responses carry a child's spoken reply; a shared iPad must not cache them. */
const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Per-child synthesis budget for this server instance. One request per
 * assistant reply is the normal rate, so this bounds a stuck client without
 * ever getting in a child's way. Mirrors the session mint route's shape.
 */
const SYNTHS_PER_WINDOW = 30;
const SYNTH_WINDOW_MS = 60_000;
const synthWindows = new Map<string, { startedAt: number; count: number }>();

function admitSynthesis(childId: string, nowMs: number): boolean {
  const existing = synthWindows.get(childId);
  if (!existing || nowMs - existing.startedAt >= SYNTH_WINDOW_MS) {
    synthWindows.set(childId, { startedAt: nowMs, count: 1 });
    return true;
  }
  if (existing.count >= SYNTHS_PER_WINDOW) return false;
  existing.count += 1;
  return true;
}

/** Adult-readable refusal per issue. Never echoes any part of the request. */
const ISSUE_MESSAGES: Record<ChildTtsRequestIssue, string> = {
  "not-an-object": "Body must be a JSON object",
  "unknown-field": "Body accepts exactly childId and text",
  "invalid-child": "childId must be santiago or isabel",
  "empty-text": "text must not be empty",
  "overlong-text": "text is too long to speak",
};

export async function POST(request: Request) {
  // Authentication strictly precedes validation.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const parsed = parseChildTtsRequest(body);
  if (!parsed.ok) {
    const status = parsed.issue === "overlong-text" ? 413 : 400;
    return NextResponse.json({ error: ISSUE_MESSAGES[parsed.issue] }, { status, headers: NO_STORE });
  }

  if (!admitSynthesis(parsed.request.childId, Date.now())) {
    return NextResponse.json(
      { error: "Too many speech requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } },
    );
  }

  try {
    const speech = await synthesizeChildSpeech(parsed.request);
    return new NextResponse(speech.audio, {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": speech.contentType },
    });
  } catch (error) {
    if (error instanceof TtsConfigError) {
      // Which variable is missing is an operator fact; the client only learns
      // that speech is unavailable, and falls back to browser synthesis.
      console.error("[family/assistant/tts] not configured: ELEVENLABS_API_KEY is unset");
      return NextResponse.json(
        { error: "Text-to-speech is not configured" },
        { status: 503, headers: NO_STORE },
      );
    }
    if (error instanceof TtsUpstreamError) {
      // Status only: an upstream validation body can echo request content, and
      // the request content is a child's conversation.
      console.error(`[family/assistant/tts] upstream failure (status ${error.status})`);
      return NextResponse.json(
        { error: "Text-to-speech failed" },
        { status: 502, headers: NO_STORE },
      );
    }
    console.error("[family/assistant/tts] unexpected failure", error);
    return NextResponse.json(
      { error: "Text-to-speech failed" },
      { status: 502, headers: NO_STORE },
    );
  }
}
