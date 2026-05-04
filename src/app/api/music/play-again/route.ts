import { NextResponse } from "next/server";
import { resolveMusicRequest } from "@/lib/music-domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name : "";
    const room = typeof body.room === "string" ? body.room : "Living Room";
    const type = typeof body.type === "string" ? body.type : undefined;

    if (!name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const result = await resolveMusicRequest({ action: "play", query: name, room, type, source: "companion-app" });
    return NextResponse.json(result, { status: result.ok === false ? 502 : 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Play again failed" },
      { status: 502 }
    );
  }
}
