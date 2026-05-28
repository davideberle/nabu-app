import { NextResponse } from "next/server";
import { getGardenSnapshotFromBlob } from "@/lib/garden-irrigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getGardenSnapshotFromBlob();
  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : 206,
    headers: { "Cache-Control": "no-store" },
  });
}
