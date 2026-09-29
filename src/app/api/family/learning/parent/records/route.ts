import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { deleteChildRecords } from "@/lib/family-learning-db";

/**
 * DELETE /api/family/learning/parent/records?child=santiago|isabel&confirm=<child>
 *
 * Removes every learning record for one child: mission state, the mutation
 * ledger, attempts, exposures, support events, work samples and parent
 * settings. Derived summaries are computed from those rows, so nothing
 * survives. The deletion is audited with row counts.
 *
 * Retention boundary reported honestly: the child's *conversations* with the
 * tutor live on the family bridge (Mac mini) under their own retention and are
 * not touched here. The UI states this before the parent confirms.
 */
export async function DELETE(request: Request) {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  const params = new URL(request.url).searchParams;
  const child = params.get("child");
  if (!isChildId(child)) return refuse(400, "child must be santiago or isabel");
  if (params.get("confirm") !== child) return refuse(400, "confirm must repeat the child id");
  const counts = await deleteChildRecords(await getDb(), child, parent.adminEmail);
  return NextResponse.json(
    { deleted: true, child, counts, retainedElsewhere: "Tutor conversations on the family bridge are a separate retention boundary and were not deleted." },
    { headers: NO_STORE },
  );
}
