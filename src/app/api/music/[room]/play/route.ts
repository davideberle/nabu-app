import { NextResponse } from "next/server";

const SONOS_API = "http://localhost:5005";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ room: string }> }
) {
  const { room } = await params;
  try {
    const res = await fetch(`${SONOS_API}/${encodeURIComponent(room)}/play`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to play" }, { status: 502 });
  }
}
