import { NextResponse } from "next/server";
import { getRoomProjections } from "@/lib/music-domain";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ room: string }> }
) {
  const { room } = await params;
  try {
    const rooms = await getRoomProjections();
    const projection = rooms.find(
      (entry) => entry.room.toLowerCase() === decodeURIComponent(room).toLowerCase()
    );

    if (!projection) {
      return NextResponse.json({ error: `Unknown room: ${room}` }, { status: 404 });
    }

    return NextResponse.json(projection);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch room state" },
      { status: 502 }
    );
  }
}
