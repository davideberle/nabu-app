import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { NO_STORE } from "@/lib/family-learning-auth";
import { catalogKey } from "@/lib/family-learning-narration";
import { servedNarrationCatalog } from "@/lib/family-narration-catalog-server";
import { clipEtag, clipPlaybackRate, isNarrationLineId, NARRATION_RATE_HEADER, readNarrationClip, resolveLineVoice } from "@/lib/family-narration-store";
import { isVoiceSlot } from "@/lib/family-voice-registry";

/**
 * GET /api/family/learning/narration/:slot/:id
 *
 * Isabel Visit 2 (I2-06) + six-slot story voices: the PRERECORDED clip of one reviewed line in its character's voice slot. Only
 * an authenticated household session reaches it, only catalogued (slot, line) pairs are answered, and the clip is read from
 * storage — this route never calls a voice provider and never synthesises anything. 404 = not recorded (the browser then uses a
 * native device voice of the slot's language, or none).
 *
 * Visit 10 (Nov 8): the URL names the slot and the text, NOT the voice, so a day of `max-age` let a device replay a clip of the
 * slot's previous voice after a re-record (Hannah → Ava). Every play now revalidates against an ETag derived from the voice.
 *
 * Nov 18: the voice is resolved per LINE (`resolveLineVoice`: a finished visit's or the chess coach's line keeps the slot's
 * previous voice). A clip recorded at a provider speed carries `X-Narration-Rate: 1`, so the player does not slow it twice.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slot: string; id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { slot, id } = await params;
  const line = isVoiceSlot(slot) && isNarrationLineId(id) ? servedNarrationCatalog().find((l) => catalogKey(l) === catalogKey({ slot, id })) : undefined;
  if (!line) return NextResponse.json({ error: "Unknown line" }, { status: 404, headers: NO_STORE });
  // Nov 18: the line's own voice (a finished visit's line keeps the slot's previous voice); the ETag and the stored clip follow it.
  const etag = clipEtag(line);
  const rate = clipPlaybackRate(resolveLineVoice(line));
  const cacheHeaders = { "Cache-Control": "private, no-cache", ...(etag ? { ETag: etag } : {}), ...(rate !== null ? { [NARRATION_RATE_HEADER]: String(rate) } : {}), "Referrer-Policy": "no-referrer" };
  if (etag && request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: cacheHeaders });
  const stream = await readNarrationClip(line);
  if (!stream) return NextResponse.json({ error: "Not recorded" }, { status: 404, headers: NO_STORE });
  return new NextResponse(stream, { status: 200, headers: { "Content-Type": "audio/mpeg", ...cacheHeaders } });
}
