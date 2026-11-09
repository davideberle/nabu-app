import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, refuse, requireOwnerOrReleaseKey } from "@/lib/family-learning-auth";
import { loadLearningContentFor, loadVocabularyInventoryFor } from "@/lib/family-learning-content-server";
import { readChildViewNoWrite } from "@/lib/family-learning-db";
import { readParentEvidence } from "@/lib/family-learning-evidence-server";

/**
 * GET /api/family/learning/parent/release-snapshot
 *
 * Both children's learning records and their current view, for comparing before and after a release. Owner session or the
 * release key. It writes nothing: no derived upkeep, and no item is marked as shown.
 */
export async function GET(request: Request) {
  const access = await requireOwnerOrReleaseKey(request, "records-snapshot");
  if (!access.ok) return access.response;
  try {
    const db = await getDb();
    const snapshot: Record<string, unknown> = {};
    for (const child of ["isabel", "santiago"] as const) {
      const ev = await readParentEvidence(child, { noDerivedWrites: true });
      const content = loadLearningContentFor(child);
      const view = content && content.child === child ? await readChildViewNoWrite(db, child, content, new Date(), { timeZone: "Europe/Zurich", vocabulary: loadVocabularyInventoryFor(child) }) : null;
      snapshot[child] = { ev, view };
    }
    return NextResponse.json(snapshot, { headers: NO_STORE });
  } catch {
    return refuse(503, "The snapshot could not be read");
  }
}
