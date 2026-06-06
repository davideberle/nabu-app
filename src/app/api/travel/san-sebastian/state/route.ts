import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getTravelItemStates, setTravelItemStatus } from "@/lib/db";
import {
  TRIP_ID,
  getAllItemIds,
  getItemById,
} from "@/data/travel-san-sebastian";

const VALID_STATUSES = new Set(["idea", "planned", "done"]);

export async function GET() {
  const states = await getTravelItemStates(TRIP_ID);
  const result: Record<string, string> = {};
  for (const [itemId, state] of states) {
    result[itemId] = state.status;
  }
  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { itemId, status } = body as { itemId?: string; status?: string };

  if (!itemId || !status) {
    return NextResponse.json(
      { error: "itemId and status are required" },
      { status: 400 }
    );
  }

  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "status must be 'idea', 'planned', or 'done'" },
      { status: 400 }
    );
  }

  if (!getItemById(itemId)) {
    return NextResponse.json(
      { error: "Unknown item id" },
      { status: 404 }
    );
  }

  await setTravelItemStatus(
    TRIP_ID,
    itemId,
    status as "idea" | "planned" | "done"
  );

  return NextResponse.json({ ok: true, itemId, status });
}
