import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getWineCellarStatuses, markBottleOut, markBottleAvailable } from "@/lib/db";
import { wineBottles } from "@/data/wine-cellar";

export async function GET() {
  const statuses = await getWineCellarStatuses();
  const bottles = wineBottles.map((b) => ({
    ...b,
    status: statuses.get(b.id)?.status ?? "available",
  }));
  return NextResponse.json(bottles);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { bottleId, action } = body as { bottleId?: string; action?: string };

  if (!bottleId || !action) {
    return NextResponse.json(
      { error: "bottleId and action are required" },
      { status: 400 }
    );
  }

  if (!wineBottles.some((b) => b.id === bottleId)) {
    return NextResponse.json({ error: "Unknown bottle" }, { status: 404 });
  }

  if (action === "mark-out") {
    await markBottleOut(bottleId);
  } else if (action === "mark-available") {
    await markBottleAvailable(bottleId);
  } else {
    return NextResponse.json(
      { error: "action must be 'mark-out' or 'mark-available'" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, bottleId, status: action === "mark-out" ? "out" : "available" });
}
