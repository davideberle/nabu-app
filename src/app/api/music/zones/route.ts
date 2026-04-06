import { NextResponse } from "next/server";

const SONOS_API = "http://localhost:5005";

export async function GET() {
  try {
    const res = await fetch(`${SONOS_API}/zones`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
