import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { NO_STORE } from "@/lib/family-learning-auth";
import { catalogKey } from "@/lib/family-learning-narration";
import { servedNarrationCatalog } from "@/lib/family-narration-catalog-server";
import { isNarrationLineId, readNarrationClip } from "@/lib/family-narration-store";
import { isVoiceSlot } from "@/lib/family-voice-registry";

/**
 * GET /api/family/learning/narration/:slot/:id
 *
 * Isabel Visit 2 (I2-06) + six-slot story voices: the PRERECORDED clip of one reviewed line in its character's voice slot. Only
 * an authenticated household session reaches it, only catalogued (slot, line) pairs are answered, and the clip is read from
 * storage — this route never calls a voice provider and never synthesises anything. 404 = not recorded (the browser then uses a
 * native device voice of the slot's language, or none). Keyed by slot and text, so it may be cached privately on the device.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slot: string; id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { slot, id } = await params;
  if (!isVoiceSlot(slot) || !isNarrationLineId(id) || !servedNarrationCatalog().some((l) => catalogKey(l) === catalogKey({ slot, id }))) return NextResponse.json({ error: "Unknown line" }, { status: 404, headers: NO_STORE });
  const stream = await readNarrationClip(slot, id);
  if (!stream) return NextResponse.json({ error: "Not recorded" }, { status: 404, headers: NO_STORE });
  return new NextResponse(stream, { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", "Referrer-Policy": "no-referrer" } });
}
