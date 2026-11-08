import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { NO_STORE } from "@/lib/family-learning-auth";
import { catalogKey } from "@/lib/family-learning-narration";
import { servedNarrationCatalog } from "@/lib/family-narration-catalog-server";
import { clipEtag, isNarrationLineId, readNarrationClip } from "@/lib/family-narration-store";
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
 */
export async function GET(request: Request, { params }: { params: Promise<{ slot: string; id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { slot, id } = await params;
  if (!isVoiceSlot(slot) || !isNarrationLineId(id) || !servedNarrationCatalog().some((l) => catalogKey(l) === catalogKey({ slot, id }))) return NextResponse.json({ error: "Unknown line" }, { status: 404, headers: NO_STORE });
  const etag = clipEtag(slot, id);
  const cacheHeaders = { "Cache-Control": "private, no-cache", ...(etag ? { ETag: etag } : {}), "Referrer-Policy": "no-referrer" };
  if (etag && request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: cacheHeaders });
  const stream = await readNarrationClip(slot, id);
  if (!stream) return NextResponse.json({ error: "Not recorded" }, { status: 404, headers: NO_STORE });
  return new NextResponse(stream, { status: 200, headers: { "Content-Type": "audio/mpeg", ...cacheHeaders } });
}
