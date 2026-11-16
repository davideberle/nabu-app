import { NextResponse } from "next/server";
import { canDirectlyApprove, parseDirectApproval, approveDirectSubmission, DirectApprovalConflict } from "@/lib/family-direct-approval";
import { routineDefinitions } from "@/data/family-routines";
import { getCompletion } from "@/lib/family-db";
import { getDb } from "@/lib/db";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };

/** Explicit owner-approved, existing-submission-only capability. No create, delete, hold, redo, config or general admin authority. */
export async function POST(request: Request) {
  if (!canDirectlyApprove(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  const input = parseDirectApproval(body);
  if (!input) return NextResponse.json({ error: "Invalid approval fields" }, { status: 400, headers });
  const routine = routineDefinitions.find(r => r.id === input.routineId);
  if (!routine || !routine.assignedTo.includes(input.personId)) return NextResponse.json({ error: "Unknown activity for child" }, { status: 400, headers });
  // Reuse the existing migration/record reader; never create a completion here.
  await getCompletion(input.week, input.personId, input.routineId, input.day);
  try {
    const receipt = await approveDirectSubmission(await getDb(), input, routine);
    const completion = await getCompletion(input.week, input.personId, input.routineId, input.day);
    return NextResponse.json({ ...receipt, identity: { week: input.week, personId: input.personId, routineId: input.routineId, day: input.day }, completion }, { headers });
  } catch (error) {
    if (error instanceof DirectApprovalConflict) return NextResponse.json({ error: error.message }, { status: 409, headers });
    throw error;
  }
}
