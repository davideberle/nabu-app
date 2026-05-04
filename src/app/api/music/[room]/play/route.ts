import { NextResponse } from "next/server";
import { resolveMusicRequest } from "@/lib/music-domain";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ room: string }> }
) {
  const { room } = await params;
  try {
    const result = await resolveMusicRequest({
      action: "resume",
      room: decodeURIComponent(room),
      source: "companion-app-legacy-route",
    });
    return NextResponse.json(result, { status: result.ok === false ? 502 : 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to resume" },
      { status: 502 }
    );
  }
}
