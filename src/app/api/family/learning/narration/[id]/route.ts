import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { NO_STORE } from "@/lib/family-learning-auth";
import { servedNarrationCatalog } from "@/lib/family-narration-catalog-server";
import { isNarrationLineId, readNarrationClip } from "@/lib/family-narration-store";

/**
 * GET /api/family/learning/narration/:id
 *
 * Isabel Visit 2 (I2-06): the PRERECORDED clip of one reviewed narration line. Only an authenticated household session reaches
 * it, only catalogued line ids of the served content are answered, and the clip is read from storage — this route never calls a
 * voice provider and never synthesises anything. 404 = not recorded (the browser then uses the device's German voice, or none).
 * The clip is keyed by its text, so it may be cached privately on the device.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { id } = await params;
  if (!isNarrationLineId(id) || !servedNarrationCatalog().some((l) => l.id === id)) return NextResponse.json({ error: "Unknown line" }, { status: 404, headers: NO_STORE });
  const stream = await readNarrationClip(id);
  if (!stream) return NextResponse.json({ error: "Not recorded" }, { status: 404, headers: NO_STORE });
  return new NextResponse(stream, { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", "Referrer-Policy": "no-referrer" } });
}
