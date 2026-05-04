import { NextResponse } from "next/server";
import { getRoomProjections } from "@/lib/music-domain";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rooms = await getRoomProjections();
    return NextResponse.json({ rooms });
  } catch (error) {
    return NextResponse.json(
      { rooms: [], error: error instanceof Error ? error.message : "Music room state unavailable" },
      { status: 502 }
    );
  }
}
